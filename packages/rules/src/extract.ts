// Value extraction for threshold rules. Works on normalized text and returns
// ranges in that text.

import type { CompareOp, ExtractKind } from './types.ts';

export interface Extracted {
  value: number;
  s: number;
  e: number;
}

const UNITS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Parse "forty-five", "one hundred twenty", "ninety" and similar. */
export function parseNumberWords(words: string): number | null {
  const parts = words.trim().split(/[\s-]+/).filter((w) => w !== 'and');
  if (parts.length === 0) return null;
  let total = 0;
  let current = 0;
  for (const w of parts) {
    if (w in UNITS) current += UNITS[w]!;
    else if (w in TENS) current += TENS[w]!;
    else if (w === 'hundred') current = (current || 1) * 100;
    else if (w === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
    } else return null;
  }
  return total + current;
}

const NUMBER_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)';
const DURATION_RE = new RegExp(
  `(?:\\b(\\d+(?:\\.\\d+)?)|\\b(${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*))?\\s*(?:\\((\\d+(?:\\.\\d+)?)\\))?\\s*(?:business |calendar |working )?(day|week|month|year)s?\\b`,
  'g',
);
const DAYS_PER: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

export function extractValues(text: string, kind: ExtractKind): Extracted[] {
  const out: Extracted[] = [];
  if (kind === 'duration_days') {
    for (const m of text.matchAll(DURATION_RE)) {
      const n = m[3] ? Number(m[3]) : m[1] ? Number(m[1]) : m[2] ? parseNumberWords(m[2]) : null;
      if (n === null || Number.isNaN(n)) continue;
      const s = m.index! + (m[0].length - m[0].trimStart().length);
      out.push({ value: n * DAYS_PER[m[4]!]!, s, e: m.index! + m[0].length });
    }
  } else if (kind === 'money') {
    for (const m of text.matchAll(/(?:\$|usd\s?|eur\s?|€|£)\s?(\d[\d,]*(?:\.\d+)?)\s?(million|thousand|k|m)?\b/g)) {
      const scale = { million: 1e6, m: 1e6, thousand: 1e3, k: 1e3 }[m[2] ?? ''] ?? 1;
      out.push({ value: Number(m[1]!.replace(/,/g, '')) * scale, s: m.index!, e: m.index! + m[0].length });
    }
  } else if (kind === 'percent') {
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?(?:%|percent\b)/g)) {
      out.push({ value: Number(m[1]), s: m.index!, e: m.index! + m[0].length });
    }
  } else {
    for (const m of text.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) {
      out.push({ value: Number(m[0].replace(/,/g, '')), s: m.index!, e: m.index! + m[0].length });
    }
  }
  return out;
}

export function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
}
