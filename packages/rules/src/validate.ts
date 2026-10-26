// Validates rulepacks with readable, path-based messages. Rules are user
// data and must be checked before they are run.

import type { Condition, Rulepack } from './types.ts';

const SEVERITIES = ['high', 'medium', 'low', 'info'];
const SCOPES = ['sentence', 'paragraph', 'section', 'document'];
const EXCLUDE_SCOPES = ['unit', 'sentence', 'matched_sentence', 'paragraph'];
const RULE_TYPES = ['presence', 'absence', 'threshold'];
const DOC_TYPES = ['msa', 'sow', 'nda', 'other'];
const PERSPECTIVES = ['service_provider', 'customer', 'discloser', 'recipient', 'mutual'];
const EXTRACTS = ['duration_days', 'money', 'percent', 'number'];
const OPS = ['>', '>=', '<', '<=', '==', '!='];
const POSITIONS = ['preferred', 'fallback', 'delete', 'insert', 'escalate', 'no_change'];
const ACTIONS = ['replaceSentence', 'replaceParagraph', 'deleteSentence', 'deleteParagraph', 'insertAfter', 'appendToParagraph'];
const CONDITION_KEYS = ['phrase', 'regex', 'any', 'all', 'not', 'near', 'ordered', 'count'];
const MAX_REGEX_LENGTH = 500;
// A quantified group that itself contains a quantifier, e.g. (a+)+ or (?:\w+\s?)*.
const NESTED_QUANTIFIER = /\((?:\?:)?(?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;

type Obj = Record<string, unknown>;

export function validateRulepack(input: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  if (!isObj(input)) return ['The file is not a JSON object'];
  if (input.format !== 'contract-reviewer.rulepack') err('format', 'must be "contract-reviewer.rulepack"');
  if (input.formatVersion !== 1) err('formatVersion', 'must be 1');
  for (const key of ['id', 'name', 'version']) if (!isStr(input[key])) err(key, 'must be a non-empty string');
  if (!Array.isArray(input.rules)) err('rules', 'must be an array');
  if (!Array.isArray(input.templates)) err('templates', 'must be an array');

  const templateIds = new Set<string>();
  (Array.isArray(input.templates) ? input.templates : []).forEach((t: unknown, i: number) => {
    const p = `templates[${i}]`;
    if (!isObj(t)) return err(p, 'must be an object');
    if (!isStr(t.id)) err(`${p}.id`, 'must be a non-empty string');
    else if (templateIds.has(t.id)) err(`${p}.id`, `duplicate id "${t.id}"`);
    else templateIds.add(t.id);
    if (!isStr(t.title)) err(`${p}.title`, 'must be a non-empty string');
    if (!isStr(t.category)) err(`${p}.category`, 'must be a non-empty string');
    if (typeof t.text !== 'string') err(`${p}.text`, 'must be a string');
    oneOf(t.position, POSITIONS, `${p}.position`, err);
    oneOf(t.action, ACTIONS, `${p}.action`, err);
  });

  const ruleIds = new Set<string>();
  (Array.isArray(input.rules) ? input.rules : []).forEach((r: unknown, i: number) => {
    const p = `rules[${i}]`;
    if (!isObj(r)) return err(p, 'must be an object');
    const where = isStr(r.id) ? `${p} (${r.id})` : p;
    if (!isStr(r.id)) err(`${p}.id`, 'must be a non-empty string');
    else if (ruleIds.has(r.id)) err(`${where}.id`, 'duplicate id');
    else ruleIds.add(r.id);
    if (!Number.isInteger(r.version)) err(`${where}.version`, 'must be an integer');
    for (const key of ['name', 'category']) if (!isStr(r[key])) err(`${where}.${key}`, 'must be a non-empty string');
    if (typeof r.enabled !== 'boolean') err(`${where}.enabled`, 'must be true or false');
    oneOf(r.severity, SEVERITIES, `${where}.severity`, err);
    oneOf(r.type, RULE_TYPES, `${where}.type`, err);

    if (r.appliesTo !== undefined) {
      if (!isObj(r.appliesTo)) err(`${where}.appliesTo`, 'must be an object');
      else {
        listOf(r.appliesTo.documentTypes, DOC_TYPES, `${where}.appliesTo.documentTypes`, err);
        listOf(r.appliesTo.reviewPerspective, PERSPECTIVES, `${where}.appliesTo.reviewPerspective`, err);
      }
    }

    if (!isObj(r.match)) err(`${where}.match`, 'must be an object');
    else {
      if (r.match.scope !== undefined) oneOf(r.match.scope, SCOPES, `${where}.match.scope`, err);
      const { scope: _s, exclude, ...cond } = r.match;
      validateCondition(cond, `${where}.match`, err);
      if (exclude !== undefined) {
        if (!isObj(exclude)) err(`${where}.match.exclude`, 'must be an object');
        else {
          const { scope, ...exCond } = exclude;
          if (scope !== undefined) oneOf(scope, EXCLUDE_SCOPES, `${where}.match.exclude.scope`, err);
          validateCondition(exCond, `${where}.match.exclude`, err);
        }
      }
    }
    if (r.partial !== undefined) validateCondition(r.partial, `${where}.partial`, err);

    if (r.type === 'threshold') {
      if (!isObj(r.threshold)) err(`${where}.threshold`, 'is required for threshold rules');
      else {
        oneOf(r.threshold.extract, EXTRACTS, `${where}.threshold.extract`, err);
        oneOf(r.threshold.op, OPS, `${where}.threshold.op`, err);
        if (typeof r.threshold.value !== 'number') err(`${where}.threshold.value`, 'must be a number');
      }
    }

    if (!isObj(r.review)) err(`${where}.review`, 'must be an object');
    else {
      if (!isStr(r.review.title)) err(`${where}.review.title`, 'must be a non-empty string');
      if (!isStr(r.review.message)) err(`${where}.review.message`, 'must be a non-empty string');
      if (r.review.templateIds !== undefined) {
        if (!Array.isArray(r.review.templateIds)) err(`${where}.review.templateIds`, 'must be an array');
        else for (const id of r.review.templateIds) {
          if (!templateIds.has(id as string)) err(`${where}.review.templateIds`, `unknown template "${String(id)}"`);
        }
      }
    }

    if (r.tests !== undefined) {
      if (!isObj(r.tests)) err(`${where}.tests`, 'must be an object');
      else for (const key of ['shouldMatch', 'shouldNotMatch']) {
        const list = r.tests[key];
        if (list !== undefined && !(Array.isArray(list) && list.every((x) => typeof x === 'string'))) {
          err(`${where}.tests.${key}`, 'must be an array of strings');
        }
      }
    }
  });

  return errors;
}

function validateCondition(c: unknown, path: string, err: (p: string, m: string) => void): void {
  if (!isObj(c)) return err(path, 'must be a condition object');
  const keys = Object.keys(c).filter((k) => CONDITION_KEYS.includes(k));
  if (keys.length !== 1) {
    return err(path, `must have exactly one of ${CONDITION_KEYS.join(', ')} (found ${keys.length ? keys.join(', ') : 'none'})`);
  }
  const key = keys[0] as keyof Condition & string;
  const v = c[key];
  switch (key) {
    case 'phrase':
      if (!isStr(v) || !/[\p{L}\p{N}]/u.test(v)) err(`${path}.phrase`, 'must contain at least one word');
      break;
    case 'regex':
      if (!isStr(v)) err(`${path}.regex`, 'must be a non-empty string');
      else if (v.length > MAX_REGEX_LENGTH) err(`${path}.regex`, `must be under ${MAX_REGEX_LENGTH} characters`);
      else {
        try {
          new RegExp(v, 'u');
          if (NESTED_QUANTIFIER.test(v)) {
            err(`${path}.regex`, 'has a nested quantifier such as (a+)+, which can hang the browser on long text');
          }
          if (/(?<!\\)[A-Z]/.test(v.replace(/\\[pPu]\{[^}]*\}/g, '').replace(/\\./g, ''))) {
            err(`${path}.regex`, 'contains upper-case letters, but rules match against lower-case text, so use lower-case');
          }
        } catch (e) {
          err(`${path}.regex`, `invalid: ${(e as Error).message}`);
        }
      }
      break;
    case 'any':
    case 'all':
    case 'near':
    case 'ordered':
      if (!Array.isArray(v) || v.length === 0) err(`${path}.${key}`, 'must be a non-empty array');
      else v.forEach((child, i) => validateCondition(child, `${path}.${key}[${i}]`, err));
      if ((key === 'near' || key === 'ordered') && c.within !== undefined && !(Number.isInteger(c.within) && (c.within as number) >= 0)) {
        err(`${path}.within`, 'must be a non-negative integer');
      }
      if (key === 'near' && c.within === undefined) err(`${path}.within`, 'is required for near');
      break;
    case 'not':
      validateCondition(v, `${path}.not`, err);
      break;
    case 'count':
      validateCondition(v, `${path}.count`, err);
      for (const k of ['min', 'max']) {
        if (c[k] !== undefined && !(Number.isInteger(c[k]) && (c[k] as number) >= 0)) err(`${path}.${k}`, 'must be a non-negative integer');
      }
      break;
  }
}

function oneOf(v: unknown, allowed: string[], path: string, err: (p: string, m: string) => void): void {
  if (!allowed.includes(v as string)) err(path, `must be one of ${allowed.join(', ')}`);
}

function listOf(v: unknown, allowed: string[], path: string, err: (p: string, m: string) => void): void {
  if (v === undefined) return;
  if (!Array.isArray(v)) return err(path, 'must be an array');
  for (const x of v) if (!allowed.includes(x as string)) err(path, `"${String(x)}" is not one of ${allowed.join(', ')}`);
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function parseRulepack(json: string): { pack: Rulepack | null; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { pack: null, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const errors = validateRulepack(data);
  return { pack: errors.length ? null : (data as Rulepack), errors };
}
