// Side-by-side comparison of the open document with another text (another
// document in the library, or a saved version), and merging: the reviewer
// picks a side for each difference, and every "use the other version" pick
// becomes an ordinary edit against the open document's original. Nothing is
// regenerated, so the merge exports as a tracked-change redline like any
// other edit.

import type { OpenedDocx } from '@docugoat/docx/document';
import { diffSequences } from '@docugoat/docx/diff';
import { checkEdit, type Edit, type RevisionOptions } from '@docugoat/docx/edits';
import type { DocBlock } from './bridge.ts';

/** A paragraph of the document being compared against. */
export interface CompareText {
  text: string;
  heading?: boolean;
}

export type CompareRow =
  | { kind: 'same'; base: DocBlock; other: CompareText }
  /** `id` numbers the differences in reading order; picks are keyed by it. */
  | { kind: 'change'; id: number; base: DocBlock[]; other: CompareText[] };

/** `base` keeps the open document's text; `other` takes the compared document's. */
export type Side = 'base' | 'other';

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"' };

/**
 * The text two paragraphs are matched on: curly and straight quotes, spacing
 * and invisible characters don't count as differences. Case, wording,
 * numbers and punctuation do.
 */
export function compareKey(text: string): string {
  return text
    .replace(/[­​‌‍⁠﻿]/g, '')
    .replace(/[‘’“”]/g, (q) => QUOTES[q]!)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Align the open document's blocks with the other document's paragraphs.
 * Empty paragraphs are left out on both sides: they are spacing, not content.
 */
export function compareBlocks(base: readonly DocBlock[], other: readonly CompareText[]): CompareRow[] {
  const a = base.filter((b) => compareKey(b.text));
  const b = other.filter((t) => compareKey(t.text));
  const ops = diffSequences(a.map((x) => compareKey(x.text)), b.map((x) => compareKey(x.text)));

  const rows: CompareRow[] = [];
  let i = 0;
  let j = 0;
  let change: Extract<CompareRow, { kind: 'change' }> | null = null;
  let ids = 0;
  for (const { op } of ops) {
    if (op === 'eq') {
      change = null;
      rows.push({ kind: 'same', base: a[i++]!, other: b[j++]! });
      continue;
    }
    if (!change) {
      change = { kind: 'change', id: ids++, base: [], other: [] };
      rows.push(change);
    }
    if (op === 'del') change.base.push(a[i++]!);
    else change.other.push(b[j++]!);
  }
  return rows;
}

export function changeCount(rows: readonly CompareRow[]): number {
  return rows.filter((r) => r.kind === 'change').length;
}

/**
 * Build the edit list for a set of picks, starting from the edits the open
 * document had when the comparison began. Undecided differences keep the open
 * document's text. A difference whose edits can't be made safely (a field,
 * a tracked move, nothing to anchor an insertion to) is skipped and reported
 * in `errors`, keyed by its id.
 */
export function mergeEdits(
  docx: OpenedDocx,
  baseEdits: readonly Edit[],
  rows: readonly CompareRow[],
  picks: Readonly<Record<number, Side>>,
  opts: RevisionOptions,
): { edits: Edit[]; errors: Map<number, string> } {
  const work = structuredClone(baseEdits) as Edit[];
  // Blocks refer to proposed paragraphs by their index in `baseEdits`; hold
  // the edit objects themselves, because indices shift as edits are removed.
  const proposed = [...work];
  const errors = new Map<number, string>();

  const contentIndex = (paraIndex: number) => work.findIndex((e) => e.type !== 'insertParagraph' && e.paraIndex === paraIndex);
  const setContent = (paraIndex: number, edit: Edit | null) => {
    const at = contentIndex(paraIndex);
    if (at >= 0) work.splice(at, 1);
    if (edit) work.push(edit);
  };

  rows.forEach((row, r) => {
    if (row.kind !== 'change' || picks[row.id] !== 'other') return;
    const steps: Array<() => void> = [];
    let problem: string | null = null;
    const check = (edit: Edit) => checkEdit(docx.main, edit, opts);

    const setText = (block: DocBlock, text: string) => {
      if (block.paraIndex === null) {
        const edit = proposed[block.editIndex!] as Extract<Edit, { type: 'insertParagraph' }>;
        steps.push(() => (edit.text = text));
        return;
      }
      const p = docx.main.paragraphs[block.paraIndex]!;
      const edit: Edit | null =
        text === p.text ? null : { type: 'replaceText', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash, text };
      const refused = edit && check(edit);
      if (refused) problem ??= refused;
      else steps.push(() => setContent(p.index, edit));
    };

    const remove = (block: DocBlock) => {
      if (block.paraIndex === null) {
        const edit = proposed[block.editIndex!]!;
        steps.push(() => work.splice(work.indexOf(edit), 1));
        return;
      }
      const p = docx.main.paragraphs[block.paraIndex]!;
      const del: Edit = { type: 'deleteParagraph', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash };
      // Some paragraph marks can't go (the last paragraph in a table cell,
      // a section break); emptying the paragraph is the closest we can get.
      const empty: Edit = { type: 'replaceText', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash, text: '' };
      const edit = !check(del) ? del : !check(empty) ? empty : null;
      if (edit) steps.push(() => setContent(p.index, edit));
      else problem ??= check(del);
    };

    const shared = Math.min(row.base.length, row.other.length);
    for (let k = 0; k < shared; k++) setText(row.base[k]!, row.other[k]!.text);
    for (const block of row.base.slice(shared)) remove(block);

    const added = row.other.slice(shared);
    if (added.length) {
      const prev = rows[r - 1];
      const anchor = shared > 0 ? row.base[shared - 1]! : prev?.kind === 'same' ? prev.base : null;
      if (!anchor) {
        problem ??= 'Text before the first paragraph can’t be inserted; edit the first paragraph instead';
      } else {
        const anchorEdit = anchor.paraIndex === null ? (proposed[anchor.editIndex!] as Extract<Edit, { type: 'insertParagraph' }>) : null;
        const afterIndex = anchorEdit ? anchorEdit.afterIndex : anchor.paraIndex!;
        const anchorHash = anchorEdit ? anchorEdit.anchorHash : docx.main.paragraphs[afterIndex]!.hash;
        const inserts = added.map(
          (t): Edit => ({ type: 'insertParagraph', part: docx.mainPath, afterIndex, anchorHash, text: t.text, format: 'anchor' }),
        );
        const refused = check(inserts[0]!);
        if (refused) problem ??= refused;
        steps.push(() => {
          // Proposed paragraphs after the same original paragraph appear in
          // edit-list order, so place these right after the anchor.
          let at = anchorEdit
            ? work.indexOf(anchorEdit) + 1
            : work.findIndex((e) => e.type === 'insertParagraph' && e.afterIndex === afterIndex);
          if (at < 0) at = work.length;
          work.splice(at, 0, ...inserts);
        });
      }
    }

    if (problem) errors.set(row.id, problem);
    else steps.forEach((step) => step());
  });

  return { edits: work, errors };
}
