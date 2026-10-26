// Rule, playbook and finding types. Rules are data: a controlled set of
// matching operators, never executable code.

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type Scope = 'sentence' | 'paragraph' | 'section' | 'document';
export type DocumentType = 'msa' | 'sow' | 'nda' | 'other';
export type Perspective = 'service_provider' | 'customer' | 'discloser' | 'recipient' | 'mutual';

export type Condition =
  /** Words in sequence. Case, punctuation, quotes and hyphenation are normalized; `word*` matches a prefix. */
  | { phrase: string }
  /** A regular expression over the normalized (lower-cased, whitespace-collapsed) text. */
  | { regex: string }
  | { any: Condition[] }
  | { all: Condition[] }
  | { not: Condition }
  /** Every term occurs within `within` words of the first. */
  | { near: Condition[]; within: number }
  /** Terms occur in this order, each within `within` words of the previous (default: anywhere in scope). */
  | { ordered: Condition[]; within?: number }
  /** The term occurs at least `min` and at most `max` times. */
  | { count: Condition; min?: number; max?: number };

export type ExcludeScope = 'unit' | 'sentence' | 'matched_sentence' | 'paragraph';

export type MatchSpec = Condition & {
  scope?: Scope;
  /** Suppress the finding when this matches in the given scope around the hits. */
  exclude?: Condition & { scope?: ExcludeScope };
};

export type ExtractKind = 'duration_days' | 'money' | 'percent' | 'number';
export type CompareOp = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface RuleTests {
  shouldMatch?: string[];
  shouldNotMatch?: string[];
}

export interface Rule {
  id: string;
  version: number;
  name: string;
  category: string;
  enabled: boolean;
  severity: Severity;
  appliesTo?: { documentTypes?: DocumentType[]; reviewPerspective?: Perspective[] };
  /** presence: flag matching language · absence: flag missing language · threshold: flag values beyond a limit. */
  type: 'presence' | 'absence' | 'threshold';
  match: MatchSpec;
  /** absence only: related language that makes the provision "possibly incomplete" rather than missing. */
  partial?: Condition;
  /** threshold only. */
  threshold?: { extract: ExtractKind; op: CompareOp; value: number };
  review: {
    title: string;
    /** May contain {{value}} for threshold rules. */
    message: string;
    recommendedAction?: string;
    templateIds?: string[];
  };
  tests?: RuleTests;
}

export type TemplateAction =
  | 'replaceSentence'
  | 'replaceParagraph'
  | 'deleteSentence'
  | 'deleteParagraph'
  | 'insertAfter'
  | 'appendToParagraph';

export interface ClauseTemplate {
  id: string;
  category: string;
  position: 'preferred' | 'fallback' | 'delete' | 'insert' | 'escalate' | 'no_change';
  title: string;
  action: TemplateAction;
  /** Approved text; may contain {{VARIABLE}} placeholders. */
  text: string;
  explanation?: string;
  version?: number;
  approvedBy?: string;
  /** Illustrative language that is not company-approved. */
  sample?: boolean;
}

export interface Rulepack {
  format: 'contract-reviewer.rulepack';
  formatVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  rules: Rule[];
  templates: ClauseTemplate[];
}

// --- Engine input and output ---------------------------------------------

export interface ScanBlock {
  /** Stable id used for locations, e.g. `p12` or `ins3`. */
  id: string;
  text: string;
  /** Starts a new section (a heading). */
  heading?: boolean;
}

export interface ScanContext {
  documentType?: DocumentType;
  perspective?: Perspective;
}

export interface Location {
  blockId: string;
  start: number;
  end: number;
}

export interface Finding {
  /** Stable across rescans while the matched text is unchanged. */
  fingerprint: string;
  ruleId: string;
  ruleVersion: number;
  kind: Rule['type'];
  severity: Severity;
  category: string;
  title: string;
  message: string;
  /** The text ranges that triggered the rule. */
  hits: Location[];
  /** The whole unit (sentence, paragraph, ...) the rule matched in. */
  unit: Location[];
  matchedTerms: string[];
  excerpt: string;
  coverage?: 'not_located' | 'possibly_incomplete';
  value?: number;
  templateIds: string[];
}

export interface CoverageResult {
  ruleId: string;
  title: string;
  state: 'located' | 'possibly_incomplete' | 'not_located';
  hits: Location[];
}

export interface ScanResult {
  findings: Finding[];
  coverage: CoverageResult[];
  /** Rules that failed to run (e.g. an invalid regex), with the reason. */
  errors: Array<{ ruleId: string; message: string }>;
}
