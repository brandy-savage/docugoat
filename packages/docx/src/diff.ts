// Word-level diff producing character-range hunks against the original text.

export interface Hunk {
  /** Range in the original text that is removed (may be empty). */
  start: number;
  end: number;
  /** Text inserted in place of the range (may be empty). */
  insert: string;
}

const TOKEN_RE = /\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
// Above this many DP cells, fall back to one hunk between common prefix/suffix.
const MAX_DP_CELLS = 4_000_000;

export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

export function diffText(original: string, revised: string): Hunk[] {
  if (original === revised) return [];
  const a = tokenize(original);
  const b = tokenize(revised);

  // Trim the common prefix and suffix so the DP only covers the changed middle.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const aMid = a.slice(pre, a.length - suf);
  const bMid = b.slice(pre, b.length - suf);
  const baseOffset = a.slice(0, pre).join('').length;

  const ops =
    (aMid.length + 1) * (bMid.length + 1) > MAX_DP_CELLS
      ? [
          ...aMid.map((t) => ({ op: 'del' as const, t })),
          ...bMid.map((t) => ({ op: 'ins' as const, t })),
        ]
      : lcsOps(aMid, bMid);

  return mergeHunks(original, opsToHunks(ops, baseOffset));
}

export type Op = { op: 'eq' | 'del' | 'ins'; t: string };

/**
 * Align two sequences (tokens, or whole paragraphs) by longest common
 * subsequence. Past the size limit, the changed middle becomes one block of
 * deletions followed by one block of insertions.
 */
export function diffSequences(a: readonly string[], b: readonly string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const aMid = a.slice(pre, a.length - suf);
  const bMid = b.slice(pre, b.length - suf);
  const middle =
    (aMid.length + 1) * (bMid.length + 1) > MAX_DP_CELLS
      ? [...aMid.map((t) => ({ op: 'del' as const, t })), ...bMid.map((t) => ({ op: 'ins' as const, t }))]
      : lcsOps(aMid, bMid);
  const eq = (t: string): Op => ({ op: 'eq', t });
  return [...a.slice(0, pre).map(eq), ...middle, ...a.slice(a.length - suf).map(eq)];
}

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1]! + 1
          : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'eq', t: a[i]! });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      ops.push({ op: 'del', t: a[i++]! });
    } else {
      ops.push({ op: 'ins', t: b[j++]! });
    }
  }
  while (i < n) ops.push({ op: 'del', t: a[i++]! });
  while (j < m) ops.push({ op: 'ins', t: b[j++]! });
  return ops;
}

function opsToHunks(ops: Op[], baseOffset: number): Hunk[] {
  const hunks: Hunk[] = [];
  let pos = baseOffset;
  let current: Hunk | null = null;
  for (const { op, t } of ops) {
    if (op === 'eq') {
      if (current) hunks.push(current);
      current = null;
      pos += t.length;
      continue;
    }
    current ??= { start: pos, end: pos, insert: '' };
    if (op === 'del') {
      current.end += t.length;
      pos += t.length;
    } else {
      current.insert += t;
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

/**
 * Join replacement hunks separated only by whitespace or a little
 * punctuation, so "ninety (90)" → "thirty (30)" reads as one deletion and one
 * insertion instead of alternating word-by-word changes.
 */
function mergeHunks(original: string, hunks: Hunk[]): Hunk[] {
  return hunks.reduce<Hunk[]>((out, h) => {
    const prev = out[out.length - 1];
    const gap = prev ? original.slice(prev.end, h.start) : '';
    const smallGap = /^\s+$/.test(gap) || /^[^\p{L}\p{N}]{1,3}$/u.test(gap);
    if (prev && smallGap && prev.end > prev.start && h.end > h.start) {
      prev.insert += gap + h.insert;
      prev.end = h.end;
    } else {
      out.push({ ...h });
    }
    return out;
  }, []);
}

export function applyHunks(original: string, hunks: Hunk[]): string {
  let out = '';
  let pos = 0;
  for (const h of hunks) {
    out += original.slice(pos, h.start) + h.insert;
    pos = h.end;
  }
  return out + original.slice(pos);
}
