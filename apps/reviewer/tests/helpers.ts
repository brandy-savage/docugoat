import { XMLValidator } from 'fast-xml-parser';
import { unzipSync } from 'fflate';
import { expect } from 'vitest';
import { openDocx, type OpenedDocx } from '@docugoat/docx/document';
import type { Edit, RevisionOptions } from '@docugoat/docx/edits';
import { partTexts, type ParagraphInfo, type PartIndex, type ViewMode } from '@docugoat/docx/paragraphs';

export const TRACKED: RevisionOptions = { mode: 'tracked', author: 'Provider Legal', date: '2026-10-18T12:00:00Z' };
export const CLEAN: RevisionOptions = { ...TRACKED, mode: 'clean' };

export function entries(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(bytes)));
}

export function texts(bytes: Uint8Array, mode: ViewMode): string[] {
  return partTexts(openDocx(bytes).main, mode);
}

export function findParagraph(docx: OpenedDocx, contains: string): ParagraphInfo {
  const p = docx.main.paragraphs.find((para) => para.text.includes(contains));
  if (!p) throw new Error(`No paragraph contains “${contains}”`);
  return p;
}

export function replaceText(docx: OpenedDocx, p: ParagraphInfo, text: string): Extract<Edit, { type: 'replaceText' }> {
  return { type: 'replaceText', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash, text };
}

export function expectWellFormed(xml: string): void {
  const result = XMLValidator.validate(xml.replace(/^﻿/, ''));
  expect(result, JSON.stringify(result)).toBe(true);
}

/** Every entry other than the listed ones is byte-identical to the original. */
export function expectOtherEntriesIdentical(before: Uint8Array, after: Uint8Array, changed: string[]): void {
  const a = entries(before);
  const b = entries(after);
  expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
  for (const [name, data] of a) {
    if (changed.includes(name)) continue;
    expect(Buffer.from(b.get(name)!).equals(Buffer.from(data)), `${name} changed`).toBe(true);
  }
}

/**
 * Replace the given paragraphs with placeholders and return the rest of the
 * part's source. Two parts with equal skeletons differ only in those paragraphs.
 */
export function skeleton(index: PartIndex, replace: Map<number, string>): string {
  const src = index.doc.source;
  let out = '';
  let pos = 0;
  for (const p of index.paragraphs) {
    const placeholder = replace.get(p.index);
    if (placeholder === undefined) continue;
    out += src.slice(pos, p.el.start) + placeholder;
    pos = p.el.end;
  }
  return out + src.slice(pos);
}

/** The part's XML after an export, ready for structural assertions. */
export function exportedMain(bytes: Uint8Array): PartIndex {
  return openDocx(bytes).main;
}

export function count(haystack: string, needle: RegExp): number {
  return haystack.match(needle)?.length ?? 0;
}
