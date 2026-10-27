import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { exportDocx, openDocx } from '@docugoat/docx/document';
import { ReviewStore } from '@docugoat/reviewer/storage/store';
import { sampleMsa } from './fixtures/docx-builder.ts';
import { findParagraph, replaceText, texts, TRACKED } from './helpers.ts';

let store: ReviewStore | undefined;
afterEach(() => store?.close());

async function freshStore() {
  let tick = 0;
  store = await ReviewStore.open({
    factory: new IDBFactory(),
    now: () => new Date(Date.UTC(2026, 9, 18, 12, 0, tick++)),
  });
  return store;
}

describe('ReviewStore', () => {
  it('keeps a comparison in progress and drops it with its document', async () => {
    const s = await freshStore();
    const { record } = await s.importDocument('Customer MSA.docx', sampleMsa());
    const comparison = {
      documentId: record.id,
      otherName: 'Counterparty draft.docx',
      other: [{ text: 'Fees are due in 90 days.' }],
      baseEdits: [],
      picks: { 0: 'other' as const },
      startedAt: '2026-10-18T12:00:00Z',
    };
    await s.saveComparison(comparison);
    expect(await s.getComparison(record.id)).toEqual(comparison);
    await s.deleteDocument(record.id);
    expect(await s.getComparison(record.id)).toBeUndefined();
  });

  it('stores the original byte-for-byte', async () => {
    const s = await freshStore();
    const bytes = sampleMsa();
    const { record } = await s.importDocument('Customer MSA.docx', bytes);
    expect(record.size).toBe(bytes.length);
    expect(Buffer.from(await s.getOriginal(record.id)).equals(Buffer.from(bytes))).toBe(true);
  });

  it('deduplicates repeated imports by content hash', async () => {
    const s = await freshStore();
    const bytes = sampleMsa();
    const first = await s.importDocument('a.docx', bytes);
    const second = await s.importDocument('copy of a.docx', bytes);
    expect(second.existing).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(await s.listDocuments()).toHaveLength(1);
  });

  it('saves versions as edit snapshots that reproduce the same export', async () => {
    const s = await freshStore();
    const bytes = sampleMsa();
    const { record } = await s.importDocument('msa.docx', bytes);

    const docx = openDocx(bytes);
    const p = findParagraph(docx, 'shall not provide services');
    const v1 = [replaceText(docx, p, p.text.replace('shall not', 'may'))];
    const q = findParagraph(docx, 'All work product');
    const v2 = [...v1, replaceText(docx, q, 'Customer owns deliverables; Provider retains pre-existing IP.')];

    await s.saveVersion(record.id, 'First pass', v1);
    await s.saveVersion(record.id, 'With IP fix', v2);
    v1.length = 0; // stored versions must not alias caller arrays

    const versions = await s.listVersions(record.id);
    expect(versions.map((v) => v.label)).toEqual(['First pass', 'With IP fix']);
    expect(versions[0]!.edits).toHaveLength(1);

    // Restoring a version from storage reproduces the export exactly.
    const reopened = openDocx(await s.getOriginal(record.id));
    const fromStore = exportDocx(reopened, versions[1]!.edits, TRACKED);
    const direct = exportDocx(openDocx(bytes), v2, TRACKED);
    expect(Buffer.from(fromStore).equals(Buffer.from(direct))).toBe(true);
    expect(texts(fromStore, 'accepted')[q.index]).toBe('Customer owns deliverables; Provider retains pre-existing IP.');
  });

  it('autosaves and restores a working draft', async () => {
    const s = await freshStore();
    const { record } = await s.importDocument('msa.docx', sampleMsa());
    expect(await s.getDraft(record.id)).toBeUndefined();
    const docx = openDocx(sampleMsa());
    const p = findParagraph(docx, 'All work product');
    await s.saveDraft(record.id, [replaceText(docx, p, 'one')]);
    await s.saveDraft(record.id, [replaceText(docx, p, 'two')]);
    const draft = await s.getDraft(record.id);
    expect(draft?.edits).toEqual([replaceText(docx, p, 'two')]);
  });

  it('stores review decisions and settings', async () => {
    const s = await freshStore();
    const { record } = await s.importDocument('msa.docx', sampleMsa());
    const review = {
      documentId: record.id,
      profile: { documentType: 'msa' as const, perspective: 'service_provider' as const, variables: { COMPANY_NAME: 'Provider LLC' } },
      statuses: { 'RULE-1:abc': { status: 'dismissed' as const, updatedAt: '2026-10-18T12:00:00Z' } },
    };
    await s.saveReview(review);
    expect(await s.getReview(record.id)).toEqual(review);
    await s.setSetting('rulepack', { id: 'x' });
    expect(await s.getSetting('rulepack')).toEqual({ id: 'x' });
    await s.deleteSetting('rulepack');
    expect(await s.getSetting('rulepack')).toBeUndefined();
  });

  it('upgrades a version 1 database without losing documents', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('contract-reviewer', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('documents', { keyPath: 'id' }).createIndex('sha256', 'sha256', { unique: true });
        db.createObjectStore('originals');
        db.createObjectStore('versions', { keyPath: 'id' }).createIndex('documentId', 'documentId');
        db.createObjectStore('drafts', { keyPath: 'documentId' });
      };
      req.onsuccess = () => {
        const tx = req.result.transaction('documents', 'readwrite');
        tx.objectStore('documents').add({ id: 'old', name: 'old.docx', size: 1, sha256: 'x', importedAt: '2026-01-01T00:00:00Z' });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
    store = await ReviewStore.open({ factory });
    expect((await store.listDocuments()).map((d) => d.id)).toEqual(['old']);
    expect(await store.getReview('old')).toBeUndefined();
  });

  it('deletes a document with its versions, draft and review', async () => {
    const s = await freshStore();
    const { record } = await s.importDocument('msa.docx', sampleMsa());
    await s.saveVersion(record.id, 'v1', []);
    await s.saveDraft(record.id, []);
    await s.saveReview({ documentId: record.id, profile: { documentType: 'msa', perspective: 'service_provider', variables: {} }, statuses: {} });
    await s.deleteDocument(record.id);
    expect(await s.getReview(record.id)).toBeUndefined();
    expect(await s.listDocuments()).toEqual([]);
    expect(await s.listVersions(record.id)).toEqual([]);
    expect(await s.getDraft(record.id)).toBeUndefined();
    await expect(s.getOriginal(record.id)).rejects.toThrow();
  });
});
