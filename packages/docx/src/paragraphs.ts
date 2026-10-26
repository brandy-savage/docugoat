// Indexes a WordprocessingML part (document.xml, header*.xml, ...) into
// paragraphs and runs, keeping the source location of everything.

import { fnv1a } from '@docugoat/util/hash';
import { childElements, firstChild, parseXml, type XmlDocument, type XmlElement } from './xml.ts';

export { fnv1a };

export interface RunToken {
  /** One character of paragraph text. */
  ch: string;
  /** Raw source for element tokens such as <w:tab/> or <w:br/>; absent for text. */
  xml?: string;
}

export interface RunContext {
  /** Inside an existing tracked insertion (w:ins / w:moveTo). */
  inserted: boolean;
  /** The enclosing w:ins element, when inside an ordinary tracked insertion. */
  insWrapper: XmlElement | null;
  /** Inside a tracked move (w:moveFrom / w:moveTo). */
  moved: boolean;
  /** Inside an existing tracked deletion (w:del / w:moveFrom). */
  deleted: boolean;
  /** Part of a field: instruction, result, or a w:fldSimple. */
  field: boolean;
}

export interface RunInfo {
  el: XmlElement;
  rPr: XmlElement | undefined;
  tokens: RunToken[];
  /** Range in the paragraph's current (changes-accepted) text. */
  textStart: number;
  textEnd: number;
  context: RunContext;
  /** Why this run's text cannot be rewritten, or null if it can. */
  lockReason: string | null;
}

export interface ParagraphInfo {
  index: number;
  el: XmlElement;
  pPr: XmlElement | undefined;
  runs: RunInfo[];
  /** Paragraph text with existing tracked changes accepted. */
  text: string;
  /** Fingerprint of the paragraph's source, used to detect stale edits. */
  hash: string;
  styleId: string | null;
  markInserted: boolean;
  markDeleted: boolean;
  /** The paragraph mark cannot be removed (last block in its container or a section break). */
  markRequired: boolean;
}

export interface PartIndex {
  path: string;
  doc: XmlDocument;
  paragraphs: ParagraphInfo[];
  byElement: Map<XmlElement, ParagraphInfo>;
  /** Highest numeric w:id in the part; new revision ids must be larger. */
  maxRevisionId: number;
}

export type ViewMode = 'accepted' | 'rejected';

const TEXT_ELEMENTS: Record<string, string> = {
  'w:tab': '\t',
  'w:br': '\n',
  'w:cr': '\n',
  'w:noBreakHyphen': '‑',
  'w:softHyphen': '­',
};

// Run children that carry no text and can be dropped when a run is split.
const IGNORABLE_RUN_CHILDREN = new Set(['w:rPr', 'w:lastRenderedPageBreak']);

// Wrappers whose runs are ordinary, editable text.
const TRANSPARENT_WRAPPERS = new Set([
  'w:hyperlink',
  'w:smartTag',
  'w:customXml',
  'w:sdt',
  'w:sdtContent',
  'w:dir',
  'w:bdo',
]);

const BLOCK_ELEMENTS = new Set(['w:p', 'w:tbl', 'w:sdt', 'w:customXml']);

export function indexPart(path: string, xml: string): PartIndex {
  const doc = parseXml(xml);
  const paragraphs: ParagraphInfo[] = [];
  const byElement = new Map<XmlElement, ParagraphInfo>();
  let maxRevisionId = 0;

  // Iterative depth-first walk: hostile documents can nest deeper than the call stack.
  const stack: XmlElement[] = [doc.root];
  while (stack.length) {
    const el = stack.pop()!;
    const id = el.attrs['w:id'];
    if (id !== undefined && /^-?\d+$/.test(id)) maxRevisionId = Math.max(maxRevisionId, Number(id));

    if (el.name === 'w:p') {
      const info = indexParagraph(doc, el, paragraphs.length);
      paragraphs.push(info);
      byElement.set(el, info);
    }
    for (let i = el.children.length - 1; i >= 0; i--) {
      const child = el.children[i]!;
      if (child.kind === 'element') stack.push(child);
    }
  }

  // Nested paragraphs (text boxes) were visited too; keep only outermost ones.
  const outermost = paragraphs.filter((p) => !hasParagraphAncestor(p.el));
  outermost.forEach((p, i) => (p.index = i));
  byElement.clear();
  for (const p of outermost) byElement.set(p.el, p);

  return { path, doc, paragraphs: outermost, byElement, maxRevisionId };
}

function hasParagraphAncestor(el: XmlElement): boolean {
  for (let p = el.parent; p; p = p.parent) if (p.name === 'w:p') return true;
  return false;
}

function indexParagraph(doc: XmlDocument, el: XmlElement, index: number): ParagraphInfo {
  const pPr = firstChild(el, 'w:pPr');
  const markRPr = pPr && firstChild(pPr, 'w:rPr');
  const runs: RunInfo[] = [];
  collectRuns(doc.source, el, { inserted: false, insWrapper: null, moved: false, deleted: false, field: false }, runs, []);

  let cursor = 0;
  let text = '';
  for (const run of runs) {
    run.textStart = cursor;
    if (!run.context.deleted) {
      const t = run.tokens.map((tok) => tok.ch).join('');
      text += t;
      cursor += t.length;
    }
    run.textEnd = cursor;
  }

  const styleEl = pPr && firstChild(pPr, 'w:pStyle');
  const hasSectionBreak = !!(pPr && firstChild(pPr, 'w:sectPr'));
  return {
    index,
    el,
    pPr,
    runs,
    text,
    hash: fnv1a(doc.source.slice(el.start, el.end)),
    styleId: styleEl?.attrs['w:val'] ?? null,
    markInserted: !!(markRPr && (firstChild(markRPr, 'w:ins') || firstChild(markRPr, 'w:moveTo'))),
    markDeleted: !!(markRPr && (firstChild(markRPr, 'w:del') || firstChild(markRPr, 'w:moveFrom'))),
    markRequired: hasSectionBreak || isLastBlock(el),
  };
}

function isLastBlock(el: XmlElement): boolean {
  const parent = el.parent;
  if (!parent) return true;
  const siblings = childElements(parent);
  const after = siblings.slice(siblings.indexOf(el) + 1);
  return !after.some((s) => BLOCK_ELEMENTS.has(s.name));
}

type FieldPhase = 'instr' | 'result';

function collectRuns(
  source: string,
  el: XmlElement,
  ctx: RunContext,
  out: RunInfo[],
  fields: FieldPhase[],
): void {
  for (const child of el.children) {
    if (child.kind !== 'element') continue;
    switch (child.name) {
      case 'w:r':
        out.push(indexRun(source, child, ctx, fields));
        break;
      case 'w:ins':
        collectRuns(source, child, { ...ctx, inserted: true, insWrapper: child }, out, fields);
        break;
      case 'w:moveTo':
        collectRuns(source, child, { ...ctx, inserted: true, moved: true }, out, fields);
        break;
      case 'w:del':
        collectRuns(source, child, { ...ctx, deleted: true }, out, fields);
        break;
      case 'w:moveFrom':
        collectRuns(source, child, { ...ctx, deleted: true, moved: true }, out, fields);
        break;
      case 'w:fldSimple':
        collectRuns(source, child, { ...ctx, field: true }, out, fields);
        break;
      default:
        // Anything else (math, alternate content, ...) is opaque: its text is
        // not part of the editable paragraph text.
        if (TRANSPARENT_WRAPPERS.has(child.name)) collectRuns(source, child, ctx, out, fields);
    }
  }
}

function indexRun(source: string, el: XmlElement, ctx: RunContext, fields: FieldPhase[]): RunInfo {
  const tokens: RunToken[] = [];
  let rPr: XmlElement | undefined;
  let inField = ctx.field || fields.length > 0;
  let opaque: string | null = null;

  for (const child of el.children) {
    if (child.kind !== 'element') continue;
    if (child.name === 'w:rPr') {
      rPr = child;
    } else if (child.name === 'w:t' || child.name === 'w:delText') {
      for (const node of child.children) {
        if (node.kind === 'text') for (const ch of node.value) tokens.push({ ch });
      }
    } else if (child.name in TEXT_ELEMENTS) {
      tokens.push({ ch: TEXT_ELEMENTS[child.name]!, xml: source.slice(child.start, child.end) });
    } else if (child.name === 'w:fldChar') {
      inField = true;
      const type = child.attrs['w:fldCharType'];
      if (type === 'begin') fields.push('instr');
      else if (type === 'separate' && fields.length) fields[fields.length - 1] = 'result';
      else if (type === 'end') fields.pop();
    } else if (child.name === 'w:instrText' || child.name === 'w:delInstrText') {
      inField = true;
    } else if (!IGNORABLE_RUN_CHILDREN.has(child.name)) {
      opaque ??= child.name;
    }
  }

  // Field instruction text is never visible paragraph text.
  const visibleTokens = fields.length > 0 && fields[fields.length - 1] === 'instr' && !ctx.field ? [] : tokens;

  let lockReason: string | null = null;
  if (ctx.moved) lockReason = 'it is part of a tracked move';
  else if (inField) lockReason = 'it is part of a field (cross-reference, page number, etc.)';
  else if (opaque) lockReason = `the run contains non-text content (${opaque})`;

  return {
    el,
    rPr,
    tokens: visibleTokens,
    textStart: 0,
    textEnd: 0,
    context: { ...ctx, field: inField },
    lockReason,
  };
}

/** Paragraph text with all existing changes accepted or rejected. */
export function viewText(p: ParagraphInfo, mode: ViewMode): string {
  let text = '';
  for (const run of p.runs) {
    const hidden = mode === 'accepted' ? run.context.deleted : run.context.inserted;
    if (!hidden) text += run.tokens.map((t) => t.ch).join('');
  }
  return text;
}

/**
 * The part's paragraph texts as Word would show them after "Accept all" or
 * "Reject all": a paragraph whose mark disappears merges into the next one.
 */
export function partTexts(index: PartIndex, mode: ViewMode): string[] {
  const out: string[] = [];
  let carry = '';
  for (const p of index.paragraphs) {
    const text = carry + viewText(p, mode);
    const markGone = mode === 'accepted' ? p.markDeleted : p.markInserted;
    if (markGone) {
      carry = text;
      continue;
    }
    out.push(text);
    carry = '';
  }
  if (carry) out.push(carry);
  return out;
}
