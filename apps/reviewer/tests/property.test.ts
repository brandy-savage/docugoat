// Randomized edits against every paragraph of the sample contract. Each
// export must satisfy the same invariants as the hand-written cases.

import { describe, expect, it } from 'vitest';
import { exportDocx, openDocx } from '@docugoat/docx/document';
import { checkEdit, type Edit } from '@docugoat/docx/edits';
import { partTexts } from '@docugoat/docx/paragraphs';
import { sampleMsa } from './fixtures/docx-builder.ts';
import { CLEAN, expectOtherEntriesIdentical, expectWellFormed, exportedMain, skeleton, TRACKED } from './helpers.ts';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const WORDS = ['reasonable', 'mutual', 'Provider', 'shall', 'not', '(30)', 'days', 'written', 'notice', '—', 'cap', 'Customer’s', '&', '<b>'];

function mutate(text: string, rand: () => number): string {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const words = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(WORDS)).join(' ');
  let out = text;
  for (let n = 1 + Math.floor(rand() * 3); n > 0; n--) {
    const a = Math.floor(rand() * (out.length + 1));
    const b = Math.min(out.length, a + Math.floor(rand() * 25));
    const kind = rand();
    if (kind < 0.33) out = out.slice(0, a) + out.slice(b);
    else if (kind < 0.66) out = out.slice(0, a) + ' ' + words() + ' ' + out.slice(a);
    else out = out.slice(0, a) + words() + out.slice(b);
  }
  return out;
}

const original = sampleMsa();
const accepted = partTexts(openDocx(original).main, 'accepted');
const rejected = partTexts(openDocx(original).main, 'rejected');

describe.each([TRACKED, CLEAN])('random edits (%o)', (opts) => {
  it('hold every invariant across 300 random exports', () => {
    const rand = rng(opts.mode === 'tracked' ? 42 : 7);
    let applied = 0;
    let refused = 0;

    for (let iter = 0; iter < 300; iter++) {
      const docx = openDocx(original);
      const targets = docx.main.paragraphs.filter(() => rand() < 0.25);
      const edits: Edit[] = [];
      for (const p of targets) {
        const edit: Edit = { type: 'replaceText', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash, text: mutate(p.text, rand) };
        if (checkEdit(docx.main, edit, opts)) refused++;
        else edits.push(edit);
      }
      applied += edits.length;

      const out = exportDocx(docx, edits, opts);
      const after = exportedMain(out);
      const expected = [...accepted];
      for (const e of edits) if (e.type === 'replaceText') expected[e.paraIndex] = e.text;

      expect(partTexts(after, 'accepted')).toEqual(expected);
      if (opts.mode === 'tracked') expect(partTexts(after, 'rejected')).toEqual(rejected);
      const placeholders = new Map(edits.map((e) => [(e as { paraIndex: number }).paraIndex, '<P/>']));
      expect(skeleton(after, placeholders)).toBe(skeleton(docx.main, placeholders));
      expectOtherEntriesIdentical(original, out, ['word/document.xml']);
      expectWellFormed(after.doc.source);

      // Exports must themselves round-trip exactly.
      const again = exportDocx(openDocx(out), [], opts);
      expect(Buffer.from(again).equals(Buffer.from(out))).toBe(true);
    }

    // Sanity: the generator exercised both paths.
    expect(applied).toBeGreaterThan(300);
    expect(refused).toBeGreaterThan(0);
  });
});
