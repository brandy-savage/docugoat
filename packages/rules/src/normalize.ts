// Text normalization with an offset map back to the source, so matches on
// normalized text can be highlighted in the original.

export interface Normalized {
  text: string;
  /** map[i] is the source offset of normalized character i. */
  map: number[];
}

const QUOTES: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '`': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
};
const DASHES = /[‐‑‒–—―−﹘﹣－]/;
const SPACES = /[\s  -   　]/;
const DROPPED = /[­​‌‍⁠﻿]/;

/**
 * Lower-case, fold quotes, dashes and diacritics, drop soft hyphens and
 * zero-width characters, and collapse whitespace runs to one space.
 */
export function normalize(source: string, offset = 0): Normalized {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (DROPPED.test(ch)) continue;
    let out: string;
    if (SPACES.test(ch)) out = ' ';
    else if (QUOTES[ch]) out = QUOTES[ch]!;
    else if (DASHES.test(ch)) out = '-';
    else out = ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (const c of out) {
      if (c === ' ' && (text.endsWith(' ') || text === '')) continue;
      text += c;
      map.push(offset + i);
    }
  }
  return { text, map };
}

export interface Token {
  /** Normalized token text. */
  t: string;
  /** Offsets in the unit's normalized text. */
  s: number;
  e: number;
  /** Index of the block the token belongs to. */
  block: number;
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string, block = 0, base = 0): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    out.push({ t: m[0], s: base + m.index!, e: base + m.index! + m[0].length, block });
  }
  return out;
}

/** Pattern tokens for a phrase; a trailing `*` on a word makes it a prefix. */
export function phraseTokens(phrase: string): string[] {
  return normalize(phrase).text.match(/[\p{L}\p{N}]+\*?/gu) ?? [];
}

// Abbreviations that end with a period without ending a sentence.
const ABBREVIATIONS = new Set([
  'inc', 'ltd', 'llc', 'llp', 'co', 'corp', 'no', 'nos', 'sec', 'secs', 'art', 'para', 'e.g', 'i.e', 'etc',
  'vs', 'v', 'mr', 'mrs', 'ms', 'dr', 'st', 'u.s', 'u.k', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
  'sep', 'sept', 'oct', 'nov', 'dec', 'approx', 'cf', 'ex', 'exh', 'sch',
]);

/** Split text into sentence ranges [start, end) of the source string. */
export function splitSentences(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  const re = /[.!?]["'’”)\]]*\s+(?=["'‘“(\[]?[\p{Lu}\p{N}])/gu;
  for (const m of text.matchAll(re)) {
    const end = m.index! + 1;
    const word = /([\p{L}.]+)\.$/u.exec(text.slice(Math.max(start, end - 12), end))?.[1]?.toLowerCase();
    if (word && (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word))) continue;
    const stop = m.index! + m[0].trimEnd().length;
    out.push([start, stop]);
    start = m.index! + m[0].length;
  }
  if (start < text.length) out.push([start, text.length]);
  return out.filter(([s, e]) => text.slice(s, e).trim().length > 0);
}
