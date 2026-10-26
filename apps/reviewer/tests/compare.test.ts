// Comparison and merge: aligning two documents, and turning per-difference
// picks into edits whose export satisfies the usual invariants.

import { describe, expect, it } from 'vitest';
import { changeCount, compareBlocks, compareKey, mergeEdits, type CompareText, type Side } from '@docugoat/review/compare';
import { exportDocx, openDocx, type OpenedDocx } from '@docugoat/docx/document';
import type { Edit } from '@docugoat/docx/edits';
import { partTexts } from '@docugoat/docx/paragraphs';
import { currentBlocks } from '@docugoat/review/bridge';
import { buildDocx, sampleMsa } from './fixtures/docx-builder.ts';
import { CLEAN, expectWellFormed, findParagraph, replaceText, TRACKED } from './helpers.ts';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plainDocx = (paras: string[]) =>
  openDocx(buildDocx({ body: paras.map((t) => (t ? `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>` : '<w:p/>')).join('') }));
const texts = (paras: string[]): CompareText[] => paras.map((text) => ({ text }));
const keys = (xs: Array<{ text: string }>) => xs.map((x) => compareKey(x.text)).filter(Boolean);

function allPicks(docx: OpenedDocx, edits: Edit[], other: CompareText[], side: Side) {
  const rows = compareBlocks(currentBlocks(docx, edits), other);
  const picks = Object.fromEntries(rows.flatMap((r) => (r.kind === 'change' ? [[r.id, side]] : [])));
  return { rows, ...mergeEdits(docx, edits, rows, picks, TRACKED) };
}

/**
 * Export both ways and check the merged text and the usual invariants.
 * Empty paragraphs are ignored: deleting a paragraph whose mark Word
 * requires (such as the last one) leaves it empty rather than removing it.
 */
function expectExports(docx: OpenedDocx, edits: Edit[]) {
  const nonEmpty = (xs: string[]) => xs.filter(Boolean);
  const expected = nonEmpty(currentBlocks(docx, edits).map((b) => b.text));
  for (const opts of [TRACKED, CLEAN]) {
    const main = openDocx(exportDocx(docx, edits, opts)).main;
    expectWellFormed(main.doc.source);
    expect(nonEmpty(partTexts(main, 'accepted'))).toEqual(expected);
    if (opts === TRACKED) expect(partTexts(main, 'rejected')).toEqual(partTexts(docx.main, 'rejected'));
  }
}

describe('compareBlocks', () => {
  it('matches paragraphs regardless of quote style, spacing and empty paragraphs', () => {
    const docx = plainDocx(['The “Customer” agrees.', '', 'Fees are due in 30 days.', 'Governing law: Delaware.']);
    const rows = compareBlocks(currentBlocks(docx, []), texts(['The "Customer"  agrees. ', 'Fees are due in 90 days.', '', 'Governing law: Delaware.']));
    expect(rows.map((r) => r.kind)).toEqual(['same', 'change', 'same']);
    const change = rows[1]!;
    expect(change.kind === 'change' && [change.base.map((b) => b.text), change.other.map((t) => t.text)]).toEqual([
      ['Fees are due in 30 days.'],
      ['Fees are due in 90 days.'],
    ]);
  });

  it('treats case and wording as differences', () => {
    const docx = plainDocx(['Customer shall pay.']);
    expect(changeCount(compareBlocks(currentBlocks(docx, []), texts(['customer shall pay.'])))).toBe(1);
  });

  it('groups adjacent differences and numbers them in reading order', () => {
    const docx = plainDocx(['A.', 'B.', 'C.', 'D.', 'E.']);
    const rows = compareBlocks(currentBlocks(docx, []), texts(['A.', 'B2.', 'C2.', 'D.', 'New.', 'E.']));
    expect(rows.filter((r) => r.kind === 'change').map((r) => r.kind === 'change' && [r.id, r.base.length, r.other.length])).toEqual([
      [0, 2, 2],
      [1, 0, 1],
    ]);
  });
});

describe('mergeEdits', () => {
  const base = ['Title', 'One paragraph that was later split.', 'Kept.', 'Removed later.', 'Also kept.', 'Changed ending.'];
  const other = ['Title', 'One paragraph', 'that was', 'later split.', 'Kept.', 'Also kept.', 'Brand new clause.', 'Changed ending, revised.'];

  it('taking every difference from the other document reproduces its text', () => {
    const docx = plainDocx(base);
    const { edits, errors } = allPicks(docx, [], texts(other), 'other');
    expect(errors.size).toBe(0);
    expect(keys(currentBlocks(docx, edits))).toEqual(keys(texts(other)));
    expectExports(docx, edits);
  });

  it('keeping every difference leaves the edit list unchanged', () => {
    const docx = plainDocx(base);
    const start: Edit[] = [replaceText(docx, findParagraph(docx, 'Kept.'), 'Kept, with my edit.')];
    expect(allPicks(docx, start, texts(other), 'base').edits).toEqual(start);
    const rows = compareBlocks(currentBlocks(docx, start), texts(other));
    expect(mergeEdits(docx, start, rows, {}, TRACKED).edits).toEqual(start);
  });

  it('merges a mix of picks and can be re-run from the same starting edits', () => {
    const docx = plainDocx(base);
    const rows = compareBlocks(currentBlocks(docx, []), texts(other));
    const ids = rows.flatMap((r) => (r.kind === 'change' ? [r.id] : []));
    const picks = Object.fromEntries(ids.map((id, i) => [id, i % 2 ? 'base' : 'other'])) as Record<number, Side>;
    const first = mergeEdits(docx, [], rows, picks, TRACKED);
    expect(first.errors.size).toBe(0);
    // Changing your mind is a pure recomputation from the starting edits.
    expect(mergeEdits(docx, [], rows, picks, TRACKED).edits).toEqual(first.edits);
    const merged = keys(currentBlocks(docx, first.edits));
    for (const row of rows) {
      if (row.kind !== 'change') continue;
      const wanted = picks[row.id] === 'other' ? row.other : row.base;
      const unwanted = picks[row.id] === 'other' ? row.base : row.other;
      for (const t of wanted) expect(merged).toContain(compareKey(t.text));
      for (const t of unwanted) expect(merged).not.toContain(compareKey(t.text));
    }
    expectExports(docx, first.edits);
  });

  it('works on top of existing proposed edits, including proposed paragraphs', () => {
    const docx = plainDocx(base);
    const kept = findParagraph(docx, 'Kept.');
    const start: Edit[] = [
      replaceText(docx, findParagraph(docx, 'Changed ending.'), 'Changed ending, my version.'),
      { type: 'insertParagraph', part: docx.mainPath, afterIndex: kept.index, anchorHash: kept.hash, text: 'My proposed clause.', format: 'anchor' },
      { type: 'insertParagraph', part: docx.mainPath, afterIndex: kept.index, anchorHash: kept.hash, text: 'My second clause.', format: 'anchor' },
    ];
    const target = ['Title', 'One paragraph that was later split.', 'Kept.', 'My proposed clause, revised.', 'Inserted between.', 'My second clause.', 'Removed later.', 'Also kept.', 'Changed ending.'];
    const { edits, errors } = allPicks(docx, start, texts(target), 'other');
    expect(errors.size).toBe(0);
    expect(keys(currentBlocks(docx, edits))).toEqual(keys(texts(target)));
    expectExports(docx, edits);
  });

  it('removes a proposed paragraph when the other document lacks it', () => {
    const docx = plainDocx(base);
    const kept = findParagraph(docx, 'Kept.');
    const start: Edit[] = [{ type: 'insertParagraph', part: docx.mainPath, afterIndex: kept.index, anchorHash: kept.hash, text: 'Drop me.', format: 'anchor' }];
    const { edits } = allPicks(docx, start, texts(base), 'other');
    expect(edits).toEqual([]);
  });

  it('reports text added before the first paragraph instead of guessing', () => {
    const docx = plainDocx(['Body.']);
    const { rows, errors, edits } = allPicks(docx, [], texts(['Preamble.', 'Body.']), 'other');
    expect(rows[0]!.kind).toBe('change');
    expect(errors.get(0)).toMatch(/first paragraph/);
    expect(edits).toEqual([]);
  });

  it('skips differences that touch fields and applies the rest', () => {
    const docx = openDocx(sampleMsa());
    const other = currentBlocks(docx, []).map((b) => ({
      text: b.text
        .replace('within ninety (90) days', 'within thirty (30) days')
        .replace('Section 3.1 survive', 'Section 4.2 survive')
        .replace(/^All work product.*$/, ''),
      heading: b.heading,
    }));
    other.splice(3, 0, { text: 'Provider may subcontract with notice.', heading: false });
    const { rows, edits, errors } = allPicks(docx, [], other, 'other');
    expect(changeCount(rows)).toBe(4);
    // "3.1" is the result of a REF field, which can't be rewritten.
    expect([...errors.values()]).toEqual([expect.stringMatching(/field/)]);
    const merged = currentBlocks(docx, edits).map((b) => b.text).join('\n');
    expect(merged).toContain('within thirty (30) days');
    expect(merged).toContain('Provider may subcontract with notice.');
    expect(merged).not.toContain('All work product');
    expectExports(docx, edits);
  });
});

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('random merges', () => {
  it('keep every invariant across 200 random document pairs and picks', () => {
    const rand = rng(7);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    const WORDS = ['Provider', 'shall', 'not', 'Customer’s', '“Fees”', '(30)', 'days', '&', '<b>', 'notice', 'cap'];
    const sentence = () => Array.from({ length: 2 + Math.floor(rand() * 6) }, () => pick(WORDS)).join(' ') + '.';
    for (let round = 0; round < 200; round++) {
      const baseParas = Array.from({ length: 2 + Math.floor(rand() * 10) }, () => (rand() < 0.1 ? '' : sentence()));
      const docx = plainDocx(baseParas);
      // The other document: the base with paragraphs changed, dropped, split and added.
      const otherParas = baseParas.flatMap((t, i) => {
        const r = rand();
        if (i === 0) return [t];
        if (r < 0.15) return [];
        if (r < 0.3) return [sentence()];
        if (r < 0.4) return [t, sentence()];
        if (r < 0.45) return [t.slice(0, 5), t.slice(5)];
        return [t];
      });
      const rows = compareBlocks(currentBlocks(docx, []), texts(otherParas));
      const picks: Record<number, Side> = {};
      for (const r of rows) if (r.kind === 'change' && rand() < 0.7) picks[r.id] = rand() < 0.5 ? 'base' : 'other';
      const { edits, errors } = mergeEdits(docx, [], rows, picks, TRACKED);
      const allOther = Object.keys(picks).length === changeCount(rows) && Object.values(picks).every((s) => s === 'other');
      if (allOther && errors.size === 0) expect(keys(currentBlocks(docx, edits))).toEqual(keys(texts(otherParas)));
      expectExports(docx, edits);
    }
  });
});
