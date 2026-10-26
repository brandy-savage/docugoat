// Exact recreation: importing a document and exporting it with no effective
// edits must reproduce every part of the package byte-for-byte.

import { describe, expect, it } from 'vitest';
import { decodePart, exportDocx, openDocx } from '@docugoat/docx/document';
import { applyEditsToPart, RevisionIds, type Edit } from '@docugoat/docx/edits';
import { buildDocx, quirkyDocx, sampleMsa } from './fixtures/docx-builder.ts';
import { CLEAN, entries, TRACKED } from './helpers.ts';

const fixtures: Record<string, Uint8Array> = {
  'sample MSA': sampleMsa(),
  'quirky serialization (BOM, CRLF, CDATA, entities)': quirkyDocx(),
  'single empty paragraph': buildDocx({ body: '<w:p/>' }),
};

describe.each(Object.entries(fixtures))('%s', (_name, original) => {
  it('exports with no edits to identical part contents', () => {
    const out = exportDocx(openDocx(original), [], TRACKED);
    const before = entries(original);
    const after = entries(out);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, data] of before) {
      expect(Buffer.from(after.get(name)!).equals(Buffer.from(data)), name).toBe(true);
    }
  });

  it('reproduces document.xml through the decode → splice → encode path', () => {
    const docx = openDocx(original);
    const xml = applyEditsToPart(docx.main, [], TRACKED, new RevisionIds(1));
    expect(xml).toBe(decodePart(docx.pkg, docx.mainPath));
    const reencoded = new TextEncoder().encode(xml);
    expect(Buffer.from(reencoded).equals(Buffer.from(docx.pkg.entries.get(docx.mainPath)!))).toBe(true);
  });

  it.each([TRACKED, CLEAN])('treats unchanged paragraph text as a no-op (%o)', (opts) => {
    const docx = openDocx(original);
    const edits: Edit[] = docx.main.paragraphs.map((p) => ({
      type: 'replaceText',
      part: docx.mainPath,
      paraIndex: p.index,
      paraHash: p.hash,
      text: p.text,
    }));
    const out = exportDocx(docx, edits, opts);
    for (const [name, data] of entries(original)) {
      expect(Buffer.from(entries(out).get(name)!).equals(Buffer.from(data)), name).toBe(true);
    }
  });

  it('produces deterministic archives', () => {
    const docx = openDocx(original);
    const a = exportDocx(docx, [], TRACKED);
    const b = exportDocx(docx, [], TRACKED);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('re-imports its own export identically', () => {
    const once = exportDocx(openDocx(original), [], TRACKED);
    const twice = exportDocx(openDocx(once), [], TRACKED);
    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
  });
});

describe('quirky fixture', () => {
  it('keeps the byte-order mark', () => {
    const out = exportDocx(openDocx(quirkyDocx()), [], TRACKED);
    expect([...entries(out).get('word/document.xml')!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
