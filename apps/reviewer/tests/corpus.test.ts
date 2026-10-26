// Every document in tests/fixtures/corpus (plus the built-in fixtures) must
// survive exact recreation and random edits with all invariants intact, and
// scan without rule errors. Drop real contracts into the corpus folder to
// test against them.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportDocx, openDocx } from '@docugoat/docx/document';
import { checkEdit, type Edit } from '@docugoat/docx/edits';
import { partTexts } from '@docugoat/docx/paragraphs';
import { currentBlocks } from '@docugoat/review/bridge';
import { scan } from '@docugoat/rules/engine';
import samplePack from '@docugoat/rules/sample-pack.json' with { type: 'json' };
import type { Rulepack } from '@docugoat/rules/types';
import { kitchenSink, quirkyDocx, sampleMsa } from './fixtures/docx-builder.ts';
import { CLEAN, entries, expectOtherEntriesIdentical, expectWellFormed, exportedMain, skeleton, TRACKED } from './helpers.ts';

const dir = join(import.meta.dirname, 'fixtures', 'corpus');
const corpus: Array<[string, Uint8Array]> = [
  ['sample MSA', sampleMsa()],
  ['quirky', quirkyDocx()],
  ['kitchen sink', kitchenSink()],
  ...readdirSync(dir).filter((f) => f.endsWith('.docx')).map((f) => [f, new Uint8Array(readFileSync(join(dir, f)))] as [string, Uint8Array]),
];

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function mutate(text: string, rand: () => number): string {
  const words = ['shall', 'not', '🙂', '𝟏', 'Provider', '&', '<x>', '—', 'thirty (30)', '\t'];
  let out = text;
  for (let n = 1 + Math.floor(rand() * 3); n > 0; n--) {
    // Cut only at code point boundaries; edits never split a surrogate pair.
    const cps = [...out];
    const a = Math.floor(rand() * (cps.length + 1));
    const b = Math.min(cps.length, a + Math.floor(rand() * 12));
    const w = words[Math.floor(rand() * words.length)]!;
    const k = rand();
    out = k < 0.33 ? [...cps.slice(0, a), ...cps.slice(b)].join('') : k < 0.66 ? [...cps.slice(0, a), ` ${w} `, ...cps.slice(a)].join('') : [...cps.slice(0, a), w, ...cps.slice(b)].join('');
  }
  return out;
}

describe.each(corpus)('%s', (_name, original) => {
  const docx = openDocx(original);
  const accepted = partTexts(docx.main, 'accepted');
  const rejected = partTexts(docx.main, 'rejected');

  it('recreates every part exactly with no edits', () => {
    const out = entries(exportDocx(docx, [], TRACKED));
    for (const [name, data] of entries(original)) expect(Buffer.from(out.get(name)!).equals(Buffer.from(data)), name).toBe(true);
  });

  it('scans without rule errors', () => {
    const r = scan(currentBlocks(docx, []), (samplePack as Rulepack).rules);
    expect(r.errors).toEqual([]);
  });

  it.each([TRACKED, CLEAN])('keeps every invariant under random edits (%o)', (opts) => {
    const rand = rng(opts.mode === 'tracked' ? 11 : 13);
    for (let iter = 0; iter < 120; iter++) {
      const d = openDocx(original);
      const edits: Edit[] = [];
      for (const p of d.main.paragraphs) {
        if (rand() > 0.3) continue;
        const roll = rand();
        const edit: Edit =
          roll < 0.8
            ? { type: 'replaceText', part: d.mainPath, paraIndex: p.index, paraHash: p.hash, text: mutate(p.text, rand) }
            : roll < 0.9
              ? { type: 'deleteParagraph', part: d.mainPath, paraIndex: p.index, paraHash: p.hash }
              : { type: 'insertParagraph', part: d.mainPath, afterIndex: p.index, anchorHash: p.hash, text: mutate('New clause text.', rand), format: rand() < 0.5 ? 'anchor' : 'plain' };
        if (!checkEdit(d.main, edit, opts)) edits.push(edit);
      }
      const out = exportDocx(d, edits, opts);
      const after = exportedMain(out);
      expectWellFormed(after.doc.source);
      expectOtherEntriesIdentical(original, out, [d.mainPath]);

      // Expected accept-all text, built from the edits.
      const expected: string[] = [];
      const deletedMarks = new Set<number>();
      d.main.paragraphs.forEach((p, i) => {
        const content = edits.find((e) => e.type !== 'insertParagraph' && e.paraIndex === i);
        if (content?.type === 'deleteParagraph') {
          if (p.markRequired || p.markDeleted) expected.push(''); else deletedMarks.add(i);
        } else expected.push(content?.type === 'replaceText' ? content.text.replace(/\r\n?/g, '\n') : p.text);
        for (const e of edits) if (e.type === 'insertParagraph' && e.afterIndex === i) expected.push(e.text);
      });
      // Compare paragraph by paragraph only when no marks were merged, else compare the joined text.
      const got = partTexts(after, 'accepted');
      if (deletedMarks.size === 0 && !d.main.paragraphs.some((p) => p.markDeleted || p.markInserted)) expect(got).toEqual(expected);
      else expect(got.join('')).toBe(expected.join(''));

      if (opts.mode === 'tracked') expect(partTexts(after, 'rejected')).toEqual(rejected);
      if (edits.length === 0) expect(partTexts(after, 'accepted')).toEqual(accepted);

      // Only touched paragraphs change.
      const touched = new Set(edits.map((e) => (e.type === 'insertParagraph' ? e.afterIndex : e.paraIndex)));
      if (edits.every((e) => e.type === 'replaceText')) {
        const ph = new Map([...touched].map((i) => [i, '<P/>']));
        expect(skeleton(after, ph)).toBe(skeleton(d.main, ph));
      }

      // And the export itself round-trips exactly.
      const again = exportDocx(openDocx(out), [], opts);
      expect(Buffer.from(again).equals(Buffer.from(out))).toBe(true);
    }
  });
});
