// The detection engine: evaluates JSON rules against plain text blocks.
// It knows nothing about DOCX or the UI; any parser that produces blocks of
// text can feed it.

import { fnv1a } from '@docugoat/util/hash';
import { compare, extractValues } from './extract.ts';
import { normalize, phraseTokens, splitSentences, tokenize, type Token } from './normalize.ts';
import type {
  Condition,
  CoverageResult,
  ExcludeScope,
  Finding,
  Location,
  Rule,
  ScanBlock,
  ScanContext,
  ScanResult,
  Scope,
} from './types.ts';

// --- Units: the text a rule is evaluated against -----------------------------

interface Part {
  block: number;
  srcStart: number;
  srcEnd: number;
}

interface Seg {
  block: number;
  /** Range in the unit's normalized text. */
  ns: number;
  ne: number;
  /** Normalized offset (relative to ns) → source offset in the block. */
  map: number[];
}

export interface Unit {
  scope: Scope;
  text: string;
  tokens: Token[];
  segs: Seg[];
  parts: Part[];
}

interface Hit {
  s: number;
  e: number;
  /** Token range [ts, te). */
  ts: number;
  te: number;
  label: string;
}

interface Result {
  ok: boolean;
  hits: Hit[];
}

export class PreparedText {
  private cache = new Map<Scope, Unit[]>();
  private sentenceCache = new Map<number, Unit[]>();

  constructor(readonly blocks: readonly ScanBlock[]) {}

  units(scope: Scope): Unit[] {
    let units = this.cache.get(scope);
    if (units) return units;
    const all = this.blocks.map((b, i) => ({ block: i, srcStart: 0, srcEnd: b.text.length }));
    if (scope === 'sentence') {
      units = this.blocks.flatMap((_, i) => this.sentencesOf(i));
    } else if (scope === 'paragraph') {
      units = all.filter((p) => p.srcEnd > 0).map((p) => buildUnit(this.blocks, 'paragraph', [p]));
    } else if (scope === 'section') {
      const groups: Part[][] = [];
      for (const p of all) {
        if (this.blocks[p.block]!.heading || groups.length === 0) groups.push([]);
        groups[groups.length - 1]!.push(p);
      }
      units = groups.map((g) => buildUnit(this.blocks, 'section', g));
    } else {
      units = [buildUnit(this.blocks, 'document', all)];
    }
    this.cache.set(scope, units);
    return units;
  }

  sentencesOf(block: number): Unit[] {
    let units = this.sentenceCache.get(block);
    if (!units) {
      units = splitSentences(this.blocks[block]!.text).map(([s, e]) =>
        buildUnit(this.blocks, 'sentence', [{ block, srcStart: s, srcEnd: e }]),
      );
      this.sentenceCache.set(block, units);
    }
    return units;
  }

  toLocation(unit: Unit, s: number, e: number): Location {
    const seg = unit.segs.find((g) => s >= g.ns && s < g.ne) ?? unit.segs[unit.segs.length - 1]!;
    const last = Math.min(e, seg.ne) - 1;
    return {
      blockId: this.blocks[seg.block]!.id,
      start: seg.map[s - seg.ns] ?? 0,
      end: (seg.map[Math.max(last, s) - seg.ns] ?? 0) + 1,
    };
  }

  partLocations(unit: Unit): Location[] {
    return unit.parts.map((p) => ({ blockId: this.blocks[p.block]!.id, start: p.srcStart, end: p.srcEnd }));
  }
}

function buildUnit(blocks: readonly ScanBlock[], scope: Scope, parts: Part[]): Unit {
  let text = '';
  const segs: Seg[] = [];
  const tokens: Token[] = [];
  for (const part of parts) {
    const n = normalize(blocks[part.block]!.text.slice(part.srcStart, part.srcEnd), part.srcStart);
    if (text) text += '\n';
    const base = text.length;
    text += n.text;
    segs.push({ block: part.block, ns: base, ne: base + n.text.length, map: n.map });
    tokens.push(...tokenize(n.text, part.block, base));
  }
  return { scope, text, tokens, segs, parts };
}

// --- Condition evaluation --------------------------------------------------

const compiled = new WeakMap<object, string[][] | RegExp>();

function phraseVariants(cond: { phrase: string }): string[][] {
  let v = compiled.get(cond) as string[][] | undefined;
  if (!v) {
    const base = phraseTokens(cond.phrase);
    v = [base];
    // "non-compete" also matches "noncompete".
    if (cond.phrase.includes('-')) v.push(phraseTokens(cond.phrase.replace(/-/g, '')));
    v = v.filter((x) => x.length > 0);
    compiled.set(cond, v);
  }
  return v;
}

function regexOf(cond: { regex: string }): RegExp {
  let re = compiled.get(cond) as RegExp | undefined;
  if (!re) {
    re = new RegExp(cond.regex, 'gu');
    compiled.set(cond, re);
  }
  return re;
}

function tokenMatches(pattern: string, token: string): boolean {
  return pattern.endsWith('*') ? token.startsWith(pattern.slice(0, -1)) : token === pattern;
}

export function evaluate(cond: Condition, unit: Unit): Result {
  if ('phrase' in cond) {
    const hits: Hit[] = [];
    const { tokens } = unit;
    for (let i = 0; i < tokens.length; i++) {
      for (const v of phraseVariants(cond)) {
        if (i + v.length > tokens.length) continue;
        let ok = true;
        for (let k = 0; k < v.length && ok; k++) {
          const tok = tokens[i + k]!;
          ok = tok.block === tokens[i]!.block && tokenMatches(v[k]!, tok.t);
        }
        if (ok) {
          hits.push({ s: tokens[i]!.s, e: tokens[i + v.length - 1]!.e, ts: i, te: i + v.length, label: `“${cond.phrase}”` });
          break;
        }
      }
    }
    return { ok: hits.length > 0, hits };
  }

  if ('regex' in cond) {
    // Each paragraph separately, so a match can't run across a paragraph break.
    const hits: Hit[] = [];
    for (const seg of unit.segs) {
      for (const m of unit.text.slice(seg.ns, seg.ne).matchAll(regexOf(cond))) {
        if (m[0].length === 0) continue;
        const s = seg.ns + m.index!;
        const e = s + m[0].length;
        hits.push({ s, e, ts: tokenIndexAtOrAfter(unit.tokens, s), te: tokenIndexAtOrAfter(unit.tokens, e), label: `/${cond.regex}/` });
      }
    }
    return { ok: hits.length > 0, hits };
  }

  if ('any' in cond) {
    const results = cond.any.map((c) => evaluate(c, unit));
    const ok = results.some((r) => r.ok);
    return { ok, hits: ok ? results.flatMap((r) => (r.ok ? r.hits : [])) : [] };
  }

  if ('all' in cond) {
    const results: Result[] = [];
    for (const c of cond.all) {
      const r = evaluate(c, unit);
      if (!r.ok) return { ok: false, hits: [] };
      results.push(r);
    }
    return { ok: true, hits: results.flatMap((r) => r.hits) };
  }

  if ('not' in cond) {
    return { ok: !evaluate(cond.not, unit).ok, hits: [] };
  }

  if ('near' in cond) {
    return proximity(cond.near.map((c) => evaluate(c, unit)), cond.within, false);
  }

  if ('ordered' in cond) {
    return proximity(cond.ordered.map((c) => evaluate(c, unit)), cond.within ?? Infinity, true);
  }

  if ('count' in cond) {
    const r = evaluate(cond.count, unit);
    const n = r.hits.length;
    const ok = n >= (cond.min ?? 1) && n <= (cond.max ?? Infinity);
    return { ok, hits: ok ? r.hits : [] };
  }

  throw new Error(`Unknown condition: ${JSON.stringify(cond).slice(0, 80)}`);
}

function tokenIndexAtOrAfter(tokens: Token[], pos: number): number {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid]!.e <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Words between two hits (0 when adjacent or overlapping). */
function gap(a: Hit, b: Hit): number {
  if (b.ts >= a.te) return b.ts - a.te;
  if (a.ts >= b.te) return a.ts - b.te;
  return 0;
}

function proximity(results: Result[], within: number, ordered: boolean): Result {
  if (results.length === 0 || results.some((r) => !r.ok)) return { ok: false, hits: [] };
  const [first, ...rest] = results;
  const out: Hit[] = [];
  for (const anchor of first!.hits) {
    const chosen = [anchor];
    let prev = anchor;
    let ok = true;
    for (const r of rest) {
      let best: Hit | null = null;
      for (const b of r.hits) {
        if (ordered && b.ts < prev.te) continue;
        const d = ordered ? b.ts - prev.te : gap(anchor, b);
        if (d <= within && (!best || d < (ordered ? best.ts - prev.te : gap(anchor, best)))) best = b;
      }
      if (!best) {
        ok = false;
        break;
      }
      chosen.push(best);
      prev = best;
    }
    if (ok) out.push(...chosen);
  }
  const unique = [...new Map(out.map((h) => [`${h.s}:${h.e}`, h])).values()].sort((a, b) => a.s - b.s);
  return { ok: unique.length > 0, hits: unique };
}

// --- Scanning --------------------------------------------------------------

export function ruleApplies(rule: Rule, ctx: ScanContext): boolean {
  const types = rule.appliesTo?.documentTypes;
  const perspectives = rule.appliesTo?.reviewPerspective;
  if (ctx.documentType && types?.length && !types.includes(ctx.documentType)) return false;
  if (ctx.perspective && perspectives?.length && !perspectives.includes(ctx.perspective)) return false;
  return true;
}

export function scan(blocks: readonly ScanBlock[], rules: readonly Rule[], ctx: ScanContext = {}): ScanResult {
  const doc = new PreparedText(blocks);
  const result: ScanResult = { findings: [], coverage: [], errors: [] };
  const seen = new Map<string, number>();

  for (const rule of rules) {
    if (!rule.enabled || !ruleApplies(rule, ctx)) continue;
    try {
      if (rule.type === 'absence') scanAbsence(doc, rule, result);
      else scanUnits(doc, rule, result);
    } catch (err) {
      result.errors.push({ ruleId: rule.id, message: (err as Error).message });
    }
  }

  // Disambiguate identical fingerprints (the same sentence appearing twice).
  for (const f of result.findings) {
    const n = (seen.get(f.fingerprint) ?? 0) + 1;
    seen.set(f.fingerprint, n);
    if (n > 1) f.fingerprint += `#${n}`;
  }

  const order = new Map(blocks.map((b, i) => [b.id, i]));
  const position = (f: Finding) => {
    const loc = f.hits[0] ?? f.unit[0];
    return loc ? (order.get(loc.blockId) ?? 0) * 1e6 + loc.start : Infinity;
  };
  result.findings.sort((a, b) => position(a) - position(b));
  return result;
}

function scanUnits(doc: PreparedText, rule: Rule, result: ScanResult): void {
  const scope = rule.match.scope ?? 'paragraph';
  for (const unit of doc.units(scope)) {
    const r = evaluate(rule.match, unit);
    if (!r.ok || excluded(doc, rule, unit, r.hits)) continue;

    let hits = r.hits;
    let value: number | undefined;
    if (rule.type === 'threshold') {
      const t = rule.threshold;
      if (!t) throw new Error('Threshold rule has no threshold');
      const violating = extractValues(unit.text, t.extract).filter((v) => compare(v.value, t.op, t.value));
      if (violating.length === 0) continue;
      value = violating[0]!.value;
      hits = violating.map((v) => ({ s: v.s, e: v.e, ts: 0, te: 0, label: unit.text.slice(v.s, v.e) }));
    }

    const locations = hits.length ? hits.map((h) => doc.toLocation(unit, h.s, h.e)) : doc.partLocations(unit);
    const key = scope === 'sentence' || scope === 'paragraph' ? unit.text : hits.map((h) => unit.text.slice(h.s, h.e)).join('|');
    result.findings.push({
      fingerprint: `${rule.id}:${fnv1a(key)}`,
      ruleId: rule.id,
      ruleVersion: rule.version,
      kind: rule.type,
      severity: rule.severity,
      category: rule.category,
      title: rule.review.title,
      message: rule.review.message.replace(/\{\{value\}\}/g, value === undefined ? '' : String(value)),
      hits: locations,
      unit: doc.partLocations(unit),
      matchedTerms: [...new Set(r.hits.map((h) => h.label))],
      excerpt: excerptOf(doc, unit, hits[0]),
      value,
      templateIds: rule.review.templateIds ?? [],
    });
  }
}

function scanAbsence(doc: PreparedText, rule: Rule, result: ScanResult): void {
  const unit = doc.units('document')[0]!;
  const r = evaluate(rule.match, unit);
  if (r.ok) {
    result.coverage.push({ ruleId: rule.id, title: rule.review.title, state: 'located', hits: r.hits.map((h) => doc.toLocation(unit, h.s, h.e)) });
    return;
  }
  const partial = rule.partial ? evaluate(rule.partial, unit) : null;
  const state = partial?.ok ? 'possibly_incomplete' : 'not_located';
  const hits = partial?.ok ? partial.hits.map((h) => doc.toLocation(unit, h.s, h.e)) : [];
  result.coverage.push({ ruleId: rule.id, title: rule.review.title, state, hits });
  result.findings.push({
    fingerprint: `${rule.id}:absent`,
    ruleId: rule.id,
    ruleVersion: rule.version,
    kind: 'absence',
    severity: rule.severity,
    category: rule.category,
    title: rule.review.title,
    message: rule.review.message,
    hits,
    unit: [],
    matchedTerms: partial?.ok ? [...new Set(partial.hits.map((h) => h.label))] : [],
    excerpt: partial?.ok ? excerptOf(doc, unit, partial.hits[0]) : '',
    coverage: state,
    templateIds: rule.review.templateIds ?? [],
  });
}

function excluded(doc: PreparedText, rule: Rule, unit: Unit, hits: Hit[]): boolean {
  const ex = rule.match.exclude;
  if (!ex) return false;
  const scope: ExcludeScope = ex.scope ?? 'unit';
  if (scope === 'unit' || hits.length === 0) return evaluate(ex, unit).ok;

  for (const h of hits) {
    const loc = doc.toLocation(unit, h.s, h.e);
    const block = doc.blocks.findIndex((b) => b.id === loc.blockId);
    const around =
      scope === 'paragraph'
        ? doc.units('paragraph').filter((u) => u.parts[0]!.block === block)
        : doc.sentencesOf(block).filter((u) => u.parts[0]!.srcStart <= loc.start && loc.start < u.parts[0]!.srcEnd);
    if (around.some((u) => evaluate(ex, u).ok)) return true;
  }
  return false;
}

function excerptOf(doc: PreparedText, unit: Unit, hit: Hit | undefined, max = 280): string {
  if (unit.scope === 'sentence' || unit.scope === 'paragraph' || !hit) {
    const p = unit.parts[0]!;
    const text = doc.blocks[p.block]!.text.slice(p.srcStart, p.srcEnd).trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }
  const loc = doc.toLocation(unit, hit.s, hit.e);
  const text = doc.blocks.find((b) => b.id === loc.blockId)!.text;
  const from = Math.max(0, loc.start - 120);
  const to = Math.min(text.length, loc.end + 120);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

// --- Search ----------------------------------------------------------------

/**
 * Find text in blocks. Plain queries use phrase matching (normalized, `word*`
 * for prefixes); `/pattern/` searches with a regular expression.
 */
export function search(blocks: readonly ScanBlock[], query: string): Location[] {
  const q = query.trim();
  if (!q) return [];
  const regex = /^\/(.+)\/$/.exec(q);
  let cond: Condition;
  if (regex) {
    try {
      new RegExp(regex[1]!, 'u');
    } catch {
      return [];
    }
    cond = { regex: regex[1]! };
  } else {
    if (phraseTokens(q).length === 0) return [];
    cond = { phrase: q };
  }
  const doc = new PreparedText(blocks);
  return doc.units('paragraph').flatMap((unit) => evaluate(cond, unit).hits.map((h) => doc.toLocation(unit, h.s, h.e)));
}

// --- Rule tests --------------------------------------------------------------

export interface RuleTestResult {
  ruleId: string;
  passed: boolean;
  failures: Array<{ expected: 'match' | 'no match'; text: string }>;
}

/** Run a rule's embedded examples. A "match" means the rule raises a finding. */
export function runRuleTests(rule: Rule): RuleTestResult {
  const failures: RuleTestResult['failures'] = [];
  const raises = (text: string) => {
    const blocks = text.split(/\n+/).map((t, i) => ({ id: `t${i}`, text: t }));
    const r = scan(blocks, [{ ...rule, enabled: true }]);
    if (r.errors.length) throw new Error(r.errors[0]!.message);
    return r.findings.length > 0;
  };
  for (const text of rule.tests?.shouldMatch ?? []) if (!raises(text)) failures.push({ expected: 'match', text });
  for (const text of rule.tests?.shouldNotMatch ?? []) if (raises(text)) failures.push({ expected: 'no match', text });
  return { ruleId: rule.id, passed: failures.length === 0, failures };
}
