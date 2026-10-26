import { describe, expect, it } from 'vitest';
import { openDocx } from '@docugoat/docx/document';
import { runRuleTests, scan, search } from '@docugoat/rules/engine';
import { extractValues, parseNumberWords } from '@docugoat/rules/extract';
import { normalize, splitSentences } from '@docugoat/rules/normalize';
import { fillTemplate, planChange } from '@docugoat/rules/playbook';
import samplePack from '@docugoat/rules/sample-pack.json' with { type: 'json' };
import type { Rule, Rulepack, ScanBlock } from '@docugoat/rules/types';
import { parseRulepack, validateRulepack } from '@docugoat/rules/validate';
import { sampleMsa } from './fixtures/docx-builder.ts';

const pack = samplePack as Rulepack;

const blocks = (...texts: string[]): ScanBlock[] => texts.map((text, i) => ({ id: `b${i}`, text }));

function rule(match: Rule['match'], extra: Partial<Rule> = {}): Rule {
  return {
    id: 'T-1', version: 1, name: 'test', category: 'test', enabled: true, severity: 'high', type: 'presence',
    match, review: { title: 'Test', message: 'Test' }, ...extra,
  };
}

const hitText = (b: ScanBlock[], loc: { blockId: string; start: number; end: number }) =>
  b.find((x) => x.id === loc.blockId)!.text.slice(loc.start, loc.end);

describe('normalization', () => {
  it('folds case, quotes, dashes, spaces and diacritics, keeping a source map', () => {
    const src = 'Provider’s  “Non‑Compete” Café­';
    const n = normalize(src);
    expect(n.text).toBe('provider\'s "non-compete" cafe');
    expect(src[n.map[n.text.indexOf('cafe')]!]).toBe('C');
  });

  it('splits sentences without breaking on abbreviations or section numbers', () => {
    const text = 'Customer ABC, Inc. shall pay. See Section 3.1 for details. U.S. law applies! Done';
    expect(splitSentences(text).map(([s, e]) => text.slice(s, e))).toEqual([
      'Customer ABC, Inc. shall pay.',
      'See Section 3.1 for details.',
      'U.S. law applies!',
      'Done',
    ]);
  });
});

describe('conditions', () => {
  it('matches phrases regardless of case, punctuation, quotes and hyphenation', () => {
    const b = blocks('The NON-COMPETE applies.', 'The noncompete applies.', 'A non compete applies.');
    const r = scan(b, [rule({ scope: 'paragraph', phrase: 'non-compete' })]);
    expect(r.findings.map((f) => f.hits[0]!.blockId)).toEqual(['b0', 'b1', 'b2']);
    expect(hitText(b, r.findings[0]!.hits[0]!)).toBe('NON-COMPETE');
  });

  it('supports prefix wildcards', () => {
    const r = scan(blocks('Competitors of Customer', 'competing firms', 'compete'), [rule({ phrase: 'compet*' })]);
    expect(r.findings).toHaveLength(3);
  });

  it('does not match regexes across paragraphs', () => {
    const r = scan(blocks('Each party’s liability', 'shall not exceed the fees.'), [rule({ scope: 'document', regex: 'liability[^.]{0,80}shall not exceed' })]);
    expect(r.findings).toHaveLength(0);
  });

  it('does not match phrases across paragraphs', () => {
    const r = scan(blocks('Provider shall not', 'provide services.'), [rule({ scope: 'document', phrase: 'shall not provide' })]);
    expect(r.findings).toHaveLength(0);
  });

  it('evaluates all / any / not', () => {
    const r = scan(blocks('Provider shall not compete.', 'Provider may compete.', 'Provider shall not disclose.'), [
      rule({ all: [{ phrase: 'compete' }, { not: { phrase: 'may' } }] }),
    ]);
    expect(r.findings.map((f) => f.hits[0]!.blockId)).toEqual(['b0']);
  });

  it('evaluates near within N words', () => {
    const b = blocks('shall not solicit any employee', 'shall not solicit or hire, directly or indirectly, through any agent or other person, any employee');
    const r = scan(b, [rule({ near: [{ phrase: 'solicit' }, { phrase: 'employee' }], within: 3 })]);
    expect(r.findings.map((f) => f.hits[0]!.blockId)).toEqual(['b0']);
  });

  it('evaluates ordered terms', () => {
    const r = scan(blocks('assign then consent', 'consent then assign'), [rule({ ordered: [{ phrase: 'assign' }, { phrase: 'consent' }] })]);
    expect(r.findings.map((f) => f.hits[0]!.blockId)).toEqual(['b0']);
  });

  it('evaluates count', () => {
    const r = scan(blocks('shall shall shall', 'shall'), [rule({ count: { phrase: 'shall' }, min: 3 })]);
    expect(r.findings).toHaveLength(1);
  });

  it('evaluates regex over normalized text and maps hits back', () => {
    const b = blocks('Pay within  NINETY days');
    const r = scan(b, [rule({ regex: 'within \\w+ days' })]);
    expect(hitText(b, r.findings[0]!.hits[0]!)).toBe('within  NINETY days');
  });

  it('applies exclusions in the matched sentence only', () => {
    const r = scan(
      blocks('Provider shall not compete. Nothing herein shall restrict hiring.', 'Nothing herein shall restrict Provider, who shall not compete.'),
      [rule({ scope: 'paragraph', phrase: 'shall not compete', exclude: { scope: 'matched_sentence', phrase: 'nothing herein shall restrict' } })],
    );
    expect(r.findings.map((f) => f.hits[0]!.blockId)).toEqual(['b0']);
  });

  it('groups section scope under headings', () => {
    const b: ScanBlock[] = [
      { id: 'h1', text: 'Fees', heading: true },
      { id: 'p1', text: 'Customer pays monthly.' },
      { id: 'h2', text: 'Term', heading: true },
      { id: 'p2', text: 'Late payments accrue interest.' },
    ];
    const r = scan(b, [rule({ scope: 'section', all: [{ phrase: 'fees' }, { phrase: 'interest' }] })]);
    expect(r.findings).toHaveLength(0);
    const r2 = scan(b, [rule({ scope: 'section', all: [{ phrase: 'term' }, { phrase: 'interest' }] })]);
    expect(r2.findings).toHaveLength(1);
  });

  it('reports invalid rules as errors instead of throwing', () => {
    const r = scan(blocks('x'), [rule({ regex: '(' })]);
    expect(r.errors[0]!.ruleId).toBe('T-1');
  });
});

describe('rule types', () => {
  it('flags missing provisions and partial coverage', () => {
    const absence = rule({ phrase: 'limitation of liability' }, { type: 'absence', partial: { phrase: 'liable' } });
    expect(scan(blocks('Provider shall perform.'), [absence]).findings[0]!.coverage).toBe('not_located');
    expect(scan(blocks('Provider is liable for negligence.'), [absence]).findings[0]!.coverage).toBe('possibly_incomplete');
    const located = scan(blocks('7. Limitation of Liability. ...'), [absence]);
    expect(located.findings).toHaveLength(0);
    expect(located.coverage[0]!.state).toBe('located');
  });

  it('extracts and compares durations', () => {
    expect(parseNumberWords('forty-five')).toBe(45);
    expect(parseNumberWords('one hundred twenty')).toBe(120);
    expect(extractValues('within ninety (90) days', 'duration_days').map((v) => v.value)).toEqual([90]);
    expect(extractValues('two (2) years and 45 business days', 'duration_days').map((v) => v.value)).toEqual([730, 45]);
    expect(extractValues('cover $5 million or $250,000', 'money').map((v) => v.value)).toEqual([5e6, 250000]);

    const threshold = rule({ phrase: 'pay' }, { type: 'threshold', threshold: { extract: 'duration_days', op: '>', value: 60 }, review: { title: 'T', message: 'Due in {{value}} days' } });
    const b = blocks('Customer shall pay within ninety (90) days.', 'Customer shall pay within thirty (30) days.');
    const r = scan(b, [threshold]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.message).toBe('Due in 90 days');
    expect(hitText(b, r.findings[0]!.hits[0]!)).toBe('ninety (90) days');
  });

  it('filters by document type and perspective', () => {
    const r = rule({ phrase: 'residuals' }, { appliesTo: { documentTypes: ['nda'], reviewPerspective: ['discloser'] } });
    expect(scan(blocks('residuals'), [r], { documentType: 'msa' }).findings).toHaveLength(0);
    expect(scan(blocks('residuals'), [r], { documentType: 'nda', perspective: 'recipient' }).findings).toHaveLength(0);
    expect(scan(blocks('residuals'), [r], { documentType: 'nda', perspective: 'discloser' }).findings).toHaveLength(1);
  });

  it('keeps fingerprints stable when other text changes', () => {
    const r = rule({ scope: 'sentence', phrase: 'competitor' });
    const a = scan(blocks('Intro.', 'Provider shall not serve any competitor.'), [r]).findings[0]!;
    const b = scan(blocks('A rewritten intro paragraph.', 'Other text. Provider shall not serve any competitor.'), [r]).findings[0]!;
    expect(b.fingerprint).toBe(a.fingerprint);
  });
});

describe('search', () => {
  it('finds normalized phrases and regexes', () => {
    const b = blocks('Customer’s “Security Policy”', 'security-policy updates');
    expect(search(b, "customer's security policy").map((l) => hitText(b, l))).toEqual(['Customer’s “Security Policy']);
    expect(search(b, '/secur\\w+/')).toHaveLength(2);
    expect(search(b, '/(/')).toEqual([]);
    expect(search(b, '  ')).toEqual([]);
  });
});

describe('sample rulepack', () => {
  it('is valid', () => {
    expect(validateRulepack(pack)).toEqual([]);
  });

  it.each(pack.rules.map((r) => [r.id, r] as const))('%s passes its embedded tests', (_id, r) => {
    expect(runRuleTests(r).failures).toEqual([]);
  });

  it('every rule has positive and negative examples', () => {
    for (const r of pack.rules) {
      expect(r.tests?.shouldMatch?.length, r.id).toBeGreaterThan(0);
      expect(r.tests?.shouldNotMatch?.length, r.id).toBeGreaterThan(0);
    }
  });

  it('finds the expected issues in the sample contract, including text split across runs', () => {
    const docx = openDocx(sampleMsa());
    const b = docx.main.paragraphs.map((p) => ({ id: `p${p.index}`, text: p.text, heading: p.styleId?.startsWith('Heading') ?? false }));
    const r = scan(b, pack.rules, { documentType: 'msa', perspective: 'service_provider' });
    expect(r.errors).toEqual([]);
    const ids = new Set(r.findings.map((f) => f.ruleId));
    for (const id of [
      'RESTRICT-NONCOMPETE-001', 'IP-PREEXISTING-001', 'PAYMENT-TERMS-001', 'PAYMENT-PAYIFPAID-001', 'SCOPE-IMPLIED-001',
      'CHANGE-UNILATERAL-001', 'SECURITY-INCORPORATED-001', 'LIABILITY-MISSING-001', 'GOVLAW-MISSING-001', 'CONFIDENTIALITY-MISSING-001',
    ]) expect(ids, id).toContain(id);
    // NDA-only rules don't run against an MSA.
    expect(ids).not.toContain('NDA-EXCLUSIONS-MISSING-001');

    const nonCompete = r.findings.find((f) => f.ruleId === 'RESTRICT-NONCOMPETE-001')!;
    expect(nonCompete.matchedTerms).toEqual(expect.arrayContaining(['“shall not”', '“provid* services”', '“competitor*”']));
    expect(nonCompete.hits.map((h) => hitText(b, h))).toContain('provide services');
  });
});

describe('validation', () => {
  it('reports problems with paths', () => {
    const bad = structuredClone(pack) as unknown as { rules: Array<Record<string, unknown>> };
    bad.rules[0]!.severity = 'urgent';
    (bad.rules[1]!.match as Record<string, unknown>).any = [];
    (bad.rules[2]!.review as Record<string, unknown>).templateIds = ['NOPE'];
    const errors = validateRulepack(bad);
    expect(errors).toEqual([
      'rules[0] (RESTRICT-NONCOMPETE-001).severity: must be one of high, medium, low, info',
      'rules[1] (RESTRICT-NONCOMPETE-002).match.any: must be a non-empty array',
      'rules[2] (RESTRICT-EXCLUSIVITY-001).review.templateIds: unknown template "NOPE"',
    ]);
  });

  it('rejects invalid JSON and regexes', () => {
    expect(parseRulepack('{').errors[0]).toMatch(/Not valid JSON/);
    const bad = structuredClone(pack);
    bad.rules[0]!.match = { regex: '(' };
    expect(validateRulepack(bad)[0]).toMatch(/regex: invalid/);
  });
});

describe('playbook', () => {
  const b = blocks('First sentence. Provider shall not compete. Last sentence.');
  const finding = scan(b, [rule({ scope: 'sentence', phrase: 'compete' })]).findings[0]!;
  const t = (action: string, text = '') => ({ id: 'X', category: 'c', position: 'preferred', title: 't', action, text }) as never;

  it('fills variables and reports missing ones', () => {
    expect(fillTemplate('{{COMPANY_NAME}} and {{ COUNTERPARTY }}', { COMPANY_NAME: 'Provider LLC' })).toEqual({
      text: 'Provider LLC and {{ COUNTERPARTY }}',
      missing: ['COUNTERPARTY'],
    });
  });

  it('replaces and deletes just the matched sentence', () => {
    expect(planChange(t('replaceSentence'), finding, b, 'Provider may compete.')).toEqual({
      kind: 'replaceText', blockId: 'b0', text: 'First sentence. Provider may compete. Last sentence.',
    });
    expect(planChange(t('deleteSentence'), finding, b, '')).toEqual({ kind: 'replaceText', blockId: 'b0', text: 'First sentence. Last sentence.' });
  });

  it('deletes the paragraph when its only sentence is deleted', () => {
    const one = blocks('Provider shall not compete.');
    const f = scan(one, [rule({ scope: 'sentence', phrase: 'compete' })]).findings[0]!;
    expect(planChange(t('deleteSentence'), f, one, '')).toEqual({ kind: 'deleteBlock', blockId: 'b0' });
  });

  it('inserts with no anchor for missing clauses', () => {
    const f = scan(b, [rule({ phrase: 'governing law' }, { type: 'absence' })]).findings[0]!;
    expect(planChange(t('insertAfter'), f, b, 'Governing law.')).toEqual({ kind: 'insertAfter', blockId: null, text: 'Governing law.' });
  });
});
