// Local persistence in IndexedDB.
//
// Originals are stored once and never modified. A version is a named snapshot
// of the edit list made against that original; the working draft is the edit
// list currently being worked on, saved automatically.

import type { CompareText, Side } from '@docugoat/review/compare';
import type { Edit } from '@docugoat/docx/edits';
import type { DocumentType, Perspective } from '@docugoat/rules/types';

export interface DocumentRecord {
  id: string;
  name: string;
  size: number;
  sha256: string;
  importedAt: string;
}

export interface VersionRecord {
  id: string;
  documentId: string;
  label: string;
  createdAt: string;
  edits: Edit[];
}

export interface DraftRecord {
  documentId: string;
  updatedAt: string;
  edits: Edit[];
}

export type FindingStatus = 'open' | 'resolved' | 'accepted_risk' | 'dismissed' | 'escalated';

export interface ReviewProfile {
  documentType: DocumentType;
  perspective: Perspective;
  /** Template variables such as COMPANY_NAME and COUNTERPARTY. */
  variables: Record<string, string>;
}

/** Reviewer decisions for one document, keyed by finding fingerprint. */
export interface ReviewRecord {
  documentId: string;
  profile: ReviewProfile;
  statuses: Record<string, { status: FindingStatus; note?: string; updatedAt: string }>;
}

/**
 * A comparison in progress. The other document's text is a snapshot, so
 * later changes to it (or deleting it) can't shift the reviewer's picks.
 */
export interface ComparisonRecord {
  documentId: string;
  otherName: string;
  other: CompareText[];
  /** The open document's edits when the comparison started; picks apply on top. */
  baseEdits: Edit[];
  picks: Record<number, Side>;
  startedAt: string;
}

const DB_VERSION = 2;
const comparisonKey = (documentId: string) => `comparison:${documentId}`;

export interface StoreOptions {
  name?: string;
  factory?: IDBFactory;
  now?: () => Date;
}

export class ReviewStore {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly now: () => Date,
  ) {}

  static async open(opts: StoreOptions = {}): Promise<ReviewStore> {
    const factory = opts.factory ?? indexedDB;
    const request = factory.open(opts.name ?? 'contract-reviewer', DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const docs = db.createObjectStore('documents', { keyPath: 'id' });
        docs.createIndex('sha256', 'sha256', { unique: true });
        db.createObjectStore('originals');
        const versions = db.createObjectStore('versions', { keyPath: 'id' });
        versions.createIndex('documentId', 'documentId');
        db.createObjectStore('drafts', { keyPath: 'documentId' });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore('reviews', { keyPath: 'documentId' });
        db.createObjectStore('settings');
      }
    };
    const db = await settle(request);
    return new ReviewStore(db, opts.now ?? (() => new Date()));
  }

  close(): void {
    this.db.close();
  }

  /** Store an imported file. Importing identical bytes again returns the existing record. */
  async importDocument(name: string, bytes: Uint8Array): Promise<{ record: DocumentRecord; existing: boolean }> {
    const sha256 = await sha256Hex(bytes);
    const found = await this.read('documents', (s) => s.index('sha256').get(sha256));
    if (found) return { record: found as DocumentRecord, existing: true };

    const record: DocumentRecord = {
      id: crypto.randomUUID(),
      name,
      size: bytes.length,
      sha256,
      importedAt: this.now().toISOString(),
    };
    const tx = this.db.transaction(['documents', 'originals'], 'readwrite');
    tx.objectStore('documents').add(record);
    // Store a standalone copy so the caller's buffer can't alias stored data.
    tx.objectStore('originals').add(bytes.slice().buffer, record.id);
    await done(tx);
    return { record, existing: false };
  }

  async listDocuments(): Promise<DocumentRecord[]> {
    const all = (await this.read('documents', (s) => s.getAll())) as DocumentRecord[];
    return all.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async getOriginal(documentId: string): Promise<Uint8Array> {
    const buffer = (await this.read('originals', (s) => s.get(documentId))) as ArrayBuffer | undefined;
    if (!buffer) throw new Error(`No stored original for document ${documentId}`);
    return new Uint8Array(buffer);
  }

  async deleteDocument(documentId: string): Promise<void> {
    const versions = await this.listVersions(documentId);
    const tx = this.db.transaction(['documents', 'originals', 'versions', 'drafts', 'reviews', 'settings'], 'readwrite');
    tx.objectStore('documents').delete(documentId);
    tx.objectStore('settings').delete(comparisonKey(documentId));
    tx.objectStore('originals').delete(documentId);
    tx.objectStore('drafts').delete(documentId);
    tx.objectStore('reviews').delete(documentId);
    for (const v of versions) tx.objectStore('versions').delete(v.id);
    await done(tx);
  }

  async saveVersion(documentId: string, label: string, edits: Edit[]): Promise<VersionRecord> {
    const record: VersionRecord = {
      id: crypto.randomUUID(),
      documentId,
      label,
      createdAt: this.now().toISOString(),
      edits: structuredClone(edits),
    };
    await this.write('versions', (s) => s.add(record));
    return record;
  }

  async listVersions(documentId: string): Promise<VersionRecord[]> {
    const all = (await this.read('versions', (s) => s.index('documentId').getAll(documentId))) as VersionRecord[];
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteVersion(versionId: string): Promise<void> {
    await this.write('versions', (s) => s.delete(versionId));
  }

  async saveDraft(documentId: string, edits: Edit[]): Promise<void> {
    const record: DraftRecord = { documentId, updatedAt: this.now().toISOString(), edits: structuredClone(edits) };
    await this.write('drafts', (s) => s.put(record));
  }

  async getDraft(documentId: string): Promise<DraftRecord | undefined> {
    return (await this.read('drafts', (s) => s.get(documentId))) as DraftRecord | undefined;
  }

  async getReview(documentId: string): Promise<ReviewRecord | undefined> {
    return (await this.read('reviews', (s) => s.get(documentId))) as ReviewRecord | undefined;
  }

  async saveReview(review: ReviewRecord): Promise<void> {
    await this.write('reviews', (s) => s.put(structuredClone(review)));
  }

  async getComparison(documentId: string): Promise<ComparisonRecord | undefined> {
    return this.getSetting<ComparisonRecord>(comparisonKey(documentId));
  }

  async saveComparison(record: ComparisonRecord): Promise<void> {
    await this.setSetting(comparisonKey(record.documentId), record);
  }

  async deleteComparison(documentId: string): Promise<void> {
    await this.deleteSetting(comparisonKey(documentId));
  }

  /** App-wide settings, such as the active rulepack. */
  async getSetting<T>(key: string): Promise<T | undefined> {
    return (await this.read('settings', (s) => s.get(key))) as T | undefined;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.write('settings', (s) => s.put(structuredClone(value), key));
  }

  async deleteSetting(key: string): Promise<void> {
    await this.write('settings', (s) => s.delete(key));
  }

  private async read(store: string, op: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
    return settle(op(this.db.transaction(store, 'readonly').objectStore(store)));
  }

  private async write(store: string, op: (s: IDBObjectStore) => IDBRequest): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    op(tx.objectStore(store));
    await done(tx);
  }
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  return (await navigator.storage?.persist?.()) ?? false;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const est = await navigator.storage?.estimate?.();
  return est ? { usage: est.usage ?? 0, quota: est.quota ?? 0 } : null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}
