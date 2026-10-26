// Document-level API: open a .docx, read its paragraphs, export with edits.

import { applyEditsToPart, RevisionIds, type Edit, type RevisionOptions } from './edits.ts';
import { mainDocumentPath, readPackage, writePackage, type DocxPackage } from './package.ts';
import { indexPart, type PartIndex } from './paragraphs.ts';

export interface OpenedDocx {
  pkg: DocxPackage;
  mainPath: string;
  main: PartIndex;
  /** Highest w:id across all XML parts, so new revision ids never collide. */
  maxRevisionId: number;
}

export class DocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxError';
  }
}

export function openDocx(bytes: Uint8Array): OpenedDocx {
  const pkg = readPackage(bytes);
  const mainPath = mainDocumentPath(pkg);
  const main = indexPart(mainPath, decodePart(pkg, mainPath));
  const root = main.doc.root.name;
  if (root !== 'w:document') {
    if (/:document$|^document$/.test(root)) {
      throw new DocxError(`This document uses the XML namespace prefix “${root.split(':')[0]}” instead of “w”, which is not supported yet`);
    }
    throw new DocxError(`This is not a Word document (its main part is <${root}>)`);
  }

  let maxRevisionId = 0;
  for (const [name, data] of pkg.entries) {
    if (!name.endsWith('.xml')) continue;
    const xml = new TextDecoder().decode(data);
    for (const m of xml.matchAll(/\bw:id="(-?\d+)"/g)) maxRevisionId = Math.max(maxRevisionId, Number(m[1]));
  }
  return { pkg, mainPath, main, maxRevisionId };
}

/**
 * Rebuild the package with edits applied. Parts without edits are copied
 * byte-for-byte; edited parts change only inside edited paragraphs.
 */
export function exportDocx(docx: OpenedDocx, edits: readonly Edit[], opts: RevisionOptions): Uint8Array {
  const entries = new Map(docx.pkg.entries);
  const ids = new RevisionIds(docx.maxRevisionId + 1);

  const byPart = new Map<string, Edit[]>();
  for (const edit of edits) byPart.set(edit.part, [...(byPart.get(edit.part) ?? []), edit]);

  for (const [path, partEdits] of byPart) {
    const index = path === docx.mainPath ? docx.main : indexPart(path, decodePart(docx.pkg, path));
    const xml = applyEditsToPart(index, partEdits, opts, ids);
    entries.set(path, new TextEncoder().encode(xml));
  }
  return writePackage({ entries });
}

/**
 * Decode an XML part, keeping any byte-order mark in the string so that
 * re-encoding reproduces the original bytes exactly.
 */
export function decodePart(pkg: DocxPackage, path: string): string {
  const data = pkg.entries.get(path);
  if (!data) throw new DocxError(`Part ${path} does not exist`);
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) {
    throw new DocxError(`Part ${path} is UTF-16 encoded, which is not supported`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    throw new DocxError(`Part ${path} is not valid UTF-8`);
  }
}

export function revisionDate(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
