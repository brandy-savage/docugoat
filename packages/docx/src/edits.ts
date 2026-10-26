// Applies edit operations to a WordprocessingML part by splicing new XML into
// the original source. Only the edited paragraphs change; inside an edited
// paragraph only the runs an edit touches are rewritten.

import { applyHunks, diffText, type Hunk } from './diff.ts';
import type { ParagraphInfo, PartIndex, RunInfo, RunToken } from './paragraphs.ts';
import { escapeAttr, escapeText, type XmlElement } from './xml.ts';

export type Edit =
  | {
      type: 'replaceText';
      part: string;
      paraIndex: number;
      paraHash: string;
      /** The paragraph's complete new text. */
      text: string;
    }
  | {
      type: 'insertParagraph';
      part: string;
      afterIndex: number;
      anchorHash: string;
      text: string;
      /** Copy paragraph and run formatting from the anchor paragraph, or use none. */
      format: 'anchor' | 'plain';
    }
  | {
      type: 'deleteParagraph';
      part: string;
      paraIndex: number;
      paraHash: string;
    };

export interface RevisionOptions {
  /** `tracked` emits Word tracked changes; `clean` applies edits directly. */
  mode: 'tracked' | 'clean';
  author: string;
  /** ISO 8601 timestamp, e.g. 2026-10-18T12:00:00Z. */
  date: string;
}

export class EditError extends Error {
  constructor(
    message: string,
    readonly edit: Edit,
  ) {
    super(message);
    this.name = 'EditError';
  }
}

/** Allocates w:id values for new revisions, above any id already in the package. */
export class RevisionIds {
  constructor(private next: number) {}
  take(): number {
    return this.next++;
  }
}

interface Splice {
  start: number;
  end: number;
  xml: string;
}

export function applyEditsToPart(
  index: PartIndex,
  edits: readonly Edit[],
  opts: RevisionOptions,
  ids: RevisionIds,
): string {
  const source = index.doc.source;
  const contentEdits = new Map<number, Edit>();
  const inserts = new Map<number, Edit[]>();

  for (const edit of edits) {
    if (edit.part !== index.path) continue;
    if (edit.type === 'insertParagraph') {
      checkAnchor(index, edit.afterIndex, edit.anchorHash, edit);
      inserts.set(edit.afterIndex, [...(inserts.get(edit.afterIndex) ?? []), edit]);
    } else {
      checkAnchor(index, edit.paraIndex, edit.paraHash, edit);
      if (contentEdits.has(edit.paraIndex)) {
        throw new EditError(`Paragraph ${edit.paraIndex} has more than one content edit`, edit);
      }
      contentEdits.set(edit.paraIndex, edit);
    }
  }

  const splices: Splice[] = [];
  const touched = new Set([...contentEdits.keys(), ...inserts.keys()]);
  for (const i of [...touched].sort((a, b) => a - b)) {
    const p = index.paragraphs[i]!;
    const content = contentEdits.get(i);
    let xml = content ? rewriteParagraph(source, p, content, opts, ids) : source.slice(p.el.start, p.el.end);
    for (const ins of inserts.get(i) ?? []) {
      if (ins.type === 'insertParagraph') xml += newParagraph(source, p, ins.text, ins.format, opts, ids);
    }
    splices.push({ start: p.el.start, end: p.el.end, xml });
  }
  return applySplices(source, 0, source.length, splices);
}

/** Returns why an edit cannot be applied, or null if it can. */
export function checkEdit(index: PartIndex, edit: Edit, opts: RevisionOptions): string | null {
  try {
    applyEditsToPart(index, [edit], opts, new RevisionIds(index.maxRevisionId + 1));
    return null;
  } catch (err) {
    if (err instanceof EditError) return err.message;
    throw err;
  }
}

function checkAnchor(index: PartIndex, i: number, hash: string, edit: Edit): void {
  const p = index.paragraphs[i];
  if (!p) throw new EditError(`Paragraph ${i} does not exist in ${index.path}`, edit);
  if (p.hash !== hash) {
    throw new EditError(`Paragraph ${i} no longer matches the text this edit was made against`, edit);
  }
}

function rewriteParagraph(
  source: string,
  p: ParagraphInfo,
  edit: Edit,
  opts: RevisionOptions,
  ids: RevisionIds,
): string {
  if (edit.type === 'deleteParagraph') return deleteParagraph(source, p, edit, opts, ids);
  if (edit.type !== 'replaceText') throw new EditError('Unexpected edit type', edit);
  const hunks = diffText(p.text, normalizeInput(edit.text));
  if (hunks.length === 0) return source.slice(p.el.start, p.el.end);
  return applyHunksToParagraph(source, p, hunks, edit, opts, ids);
}

// --- Text replacement -------------------------------------------------------

interface Insertion {
  /** Run the insertion is placed in, or null to append to an empty paragraph. */
  run: RunInfo | null;
  /** Paragraph text offset the insertion is placed at. */
  pos: number;
  text: string;
  rPr: string;
  /**
   * Source offset to place the insertion at instead of inside `run`: just
   * before or after another reviewer's tracked insertion, never inside it.
   */
  at?: number;
}

function applyHunksToParagraph(
  source: string,
  p: ParagraphInfo,
  hunks: Hunk[],
  edit: Edit,
  opts: RevisionOptions,
  ids: RevisionIds,
): string {
  const textRuns = p.runs.filter((r) => !r.context.deleted && r.textEnd > r.textStart);
  const wrappers = insertionRanges(textRuns);
  hunks = expandOverInsertions(hunks, wrappers, p.text);
  const insertions: Insertion[] = [];
  const deleted: Array<[number, number]> = [];

  for (const h of hunks) {
    if (h.end > h.start) {
      const hit = textRuns.filter((r) => r.textStart < h.end && r.textEnd > h.start);
      for (const r of hit) {
        if (r.lockReason) throw locked(p, r, edit);
      }
      deleted.push([h.start, h.end]);
      if (h.insert) {
        const run = hit[hit.length - 1]!;
        insertions.push({ run, pos: h.end, text: h.insert, rPr: insertionRPr(source, hit[0]!), at: outsideInsertion(run, h.end, wrappers) });
      }
    } else if (h.insert) {
      const host = insertionHost(p, textRuns, h.start, edit);
      insertions.push({
        run: host,
        pos: h.start,
        text: h.insert,
        rPr: host ? insertionRPr(source, host) : '',
        at: host ? outsideInsertion(host, h.start, wrappers) : undefined,
      });
    }
  }

  const isDeleted = (pos: number) => deleted.some(([s, e]) => pos >= s && pos < e);
  const splices: Splice[] = [];

  for (const ins of insertions) {
    if (ins.at !== undefined) splices.push({ start: ins.at, end: ins.at, xml: insertedRun(ins.text, ins.rPr, opts, ids) });
  }

  for (const run of textRuns) {
    const runInsertions = insertions.filter((ins) => ins.run === run && ins.at === undefined);
    const starts = tokenStarts(run);
    const hasDeletion = starts.some((pos) => isDeleted(pos));
    if (!hasDeletion && runInsertions.length === 0) continue;

    const pieces: string[] = [];
    let group: RunToken[] = [];
    let groupDeleted = false;
    const flush = () => {
      if (group.length) pieces.push(runPiece(source, run, group, groupDeleted, opts, ids));
      group = [];
    };
    const emitInsertionsAt = (pos: number) => {
      for (const ins of runInsertions) {
        if (ins.pos !== pos) continue;
        flush();
        pieces.push(insertedRun(ins.text, ins.rPr, opts, ids));
      }
    };

    run.tokens.forEach((token, k) => {
      const pos = starts[k]!;
      emitInsertionsAt(pos);
      const del = isDeleted(pos);
      if (del !== groupDeleted) flush();
      groupDeleted = del;
      group.push(token);
    });
    emitInsertionsAt(run.textEnd);
    flush();
    splices.push({ start: run.el.start, end: run.el.end, xml: pieces.join('') });
  }

  const orphan = insertions.filter((ins) => ins.run === null);
  if (orphan.length) {
    const xml = orphan.map((ins) => insertedRun(ins.text, ins.rPr, opts, ids)).join('');
    if (p.el.selfClosing) {
      return openTag(source, p.el) + xml + '</w:p>';
    }
    splices.push({ start: p.el.closeStart, end: p.el.closeStart, xml });
  }

  return applySplices(source, p.el.start, p.el.end, splices);
}

/**
 * Paragraph text offset of each token. Offsets count UTF-16 code units, so a
 * token outside the Basic Multilingual Plane (an emoji, 𝟑) spans two.
 */
function tokenStarts(run: RunInfo): number[] {
  let pos = run.textStart;
  return run.tokens.map((t) => {
    const start = pos;
    pos += t.ch.length;
    return start;
  });
}

/** Text range covered by each existing tracked insertion (w:ins) in the paragraph. */
function insertionRanges(textRuns: RunInfo[]): Map<XmlElement, [number, number]> {
  const ranges = new Map<XmlElement, [number, number]>();
  for (const r of textRuns) {
    const w = r.context.insWrapper;
    if (!w) continue;
    const range = ranges.get(w);
    ranges.set(w, range ? [Math.min(range[0], r.textStart), Math.max(range[1], r.textEnd)] : [r.textStart, r.textEnd]);
  }
  return ranges;
}

/**
 * Widen hunks that change part of another reviewer's insertion so they
 * replace the whole insertion. Our deletion then nests inside their w:ins and
 * our insertion sits beside it, which is how Word responds to a redline.
 */
function expandOverInsertions(hunks: Hunk[], ranges: Map<XmlElement, [number, number]>, original: string): Hunk[] {
  let out = hunks.map((h) => ({ ...h }));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [s, e] of ranges.values()) {
      const touching = out.filter((h) => (h.end > h.start ? h.start < e && h.end > s : h.start > s && h.start < e));
      if (touching.length === 0) continue;
      const start = Math.min(s, ...touching.map((h) => h.start));
      const end = Math.max(e, ...touching.map((h) => h.end));
      if (touching.length === 1 && touching[0]!.start === start && touching[0]!.end === end) continue;
      const local = touching.map((h) => ({ start: h.start - start, end: h.end - start, insert: h.insert }));
      const merged = { start, end, insert: applyHunks(original.slice(start, end), local) };
      out = [...out.filter((h) => !touching.includes(h)), merged].sort((a, b) => a.start - b.start);
      changed = true;
    }
  }
  return out;
}

/** Where an insertion at `pos` in `run` must go to stay outside another reviewer's insertion. */
function outsideInsertion(run: RunInfo, pos: number, ranges: Map<XmlElement, [number, number]>): number | undefined {
  const w = run.context.insWrapper;
  const range = w && ranges.get(w);
  if (!w || !range) return undefined;
  if (pos >= range[1]) return w.end;
  if (pos <= range[0]) return w.start;
  throw new Error('Insertion inside another tracked insertion should have been widened');
}

/** Choose the run a pure insertion at `pos` goes into, preferring the preceding run. */
function insertionHost(p: ParagraphInfo, textRuns: RunInfo[], pos: number, edit: Edit): RunInfo | null {
  const before = textRuns.find((r) => r.textStart < pos && pos <= r.textEnd);
  const after = textRuns.find((r) => r.textStart <= pos && pos < r.textEnd);
  if (!before && !after) return null;
  if (before && !before.lockReason) return before;
  if (after && !after.lockReason) return after;
  throw locked(p, (before ?? after)!, edit);
}

function locked(p: ParagraphInfo, run: RunInfo, edit: Edit): EditError {
  const snippet = p.text.slice(run.textStart, run.textEnd).trim().slice(0, 40);
  return new EditError(`Cannot change “${snippet}” because ${run.lockReason}`, edit);
}

function runPiece(
  source: string,
  run: RunInfo,
  tokens: RunToken[],
  deleted: boolean,
  opts: RevisionOptions,
  ids: RevisionIds,
): string {
  if (!deleted && tokens.length === run.tokens.length) return source.slice(run.el.start, run.el.end);
  if (deleted && opts.mode === 'clean') return '';
  const rPr = run.rPr ? source.slice(run.rPr.start, run.rPr.end) : '';
  const body = openTag(source, run.el) + rPr + tokensXml(tokens, deleted ? 'w:delText' : 'w:t') + '</w:r>';
  return deleted ? `<w:del ${revisionAttrs(opts, ids)}>${body}</w:del>` : body;
}

function insertedRun(text: string, rPr: string, opts: RevisionOptions, ids: RevisionIds): string {
  const run = `<w:r>${rPr}${textXml(text)}</w:r>`;
  return opts.mode === 'tracked' ? `<w:ins ${revisionAttrs(opts, ids)}>${run}</w:ins>` : run;
}

/** Formatting for inserted text: the host run's properties without its own revision history. */
function insertionRPr(source: string, run: RunInfo): string {
  return run.rPr ? withoutChildren(source, run.rPr, new Set(['w:rPrChange'])) : '';
}

// --- Paragraph deletion -----------------------------------------------------

const PARAGRAPH_LEVEL_OK = new Set([
  'w:pPr',
  'w:r',
  'w:ins',
  'w:del',
  'w:moveFrom',
  'w:moveTo',
  'w:hyperlink',
  'w:smartTag',
  'w:customXml',
  'w:sdt',
  'w:fldSimple',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:proofErr',
  'w:permStart',
  'w:permEnd',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
]);

function deleteParagraph(
  source: string,
  p: ParagraphInfo,
  edit: Edit,
  opts: RevisionOptions,
  ids: RevisionIds,
): string {
  for (const child of p.el.children) {
    if (child.kind === 'element' && !PARAGRAPH_LEVEL_OK.has(child.name)) {
      throw new EditError(`Cannot delete this paragraph because it contains ${child.name}`, edit);
    }
  }
  const live = p.runs.filter((r) => !r.context.deleted);
  for (const run of live) {
    if (run.context.moved) throw new EditError('Cannot delete a paragraph containing a tracked move', edit);
    if (source.slice(run.el.start, run.el.end).includes('<w:txbxContent')) {
      throw new EditError('Cannot delete a paragraph containing a text box', edit);
    }
  }

  if (opts.mode === 'clean') {
    if (!p.markRequired) return '';
    return applySplices(
      source,
      p.el.start,
      p.el.end,
      live.map((r) => ({ start: r.el.start, end: r.el.end, xml: '' })),
    );
  }

  const splices: Splice[] = live.map((run) => ({
    start: run.el.start,
    end: run.el.end,
    xml: `<w:del ${revisionAttrs(opts, ids)}>${toDeletedRun(source.slice(run.el.start, run.el.end))}</w:del>`,
  }));

  if (!p.markRequired && !p.markDeleted) {
    const mark = `<w:del ${revisionAttrs(opts, ids)}/>`;
    if (p.el.selfClosing) return openTag(source, p.el) + buildPPr(source, undefined, false, mark) + '</w:p>';
    const pPrXml = buildPPr(source, p.pPr, false, mark);
    if (p.pPr) splices.push({ start: p.pPr.start, end: p.pPr.end, xml: pPrXml });
    else splices.push({ start: p.el.openEnd, end: p.el.openEnd, xml: pPrXml });
  }
  return applySplices(source, p.el.start, p.el.end, splices);
}

function toDeletedRun(runXml: string): string {
  return runXml
    .replace(/<w:t(?=[\s>/])/g, '<w:delText')
    .replace(/<\/w:t>/g, '</w:delText>')
    .replace(/<w:instrText(?=[\s>/])/g, '<w:delInstrText')
    .replace(/<\/w:instrText>/g, '</w:delInstrText>');
}

// --- Paragraph insertion ----------------------------------------------------

function newParagraph(
  source: string,
  anchor: ParagraphInfo,
  text: string,
  format: 'anchor' | 'plain',
  opts: RevisionOptions,
  ids: RevisionIds,
): string {
  const mark = opts.mode === 'tracked' ? `<w:ins ${revisionAttrs(opts, ids)}/>` : null;
  const pPr = buildPPr(source, format === 'anchor' ? anchor.pPr : undefined, true, mark);
  const firstRun = anchor.runs.find((r) => !r.context.deleted && r.textEnd > r.textStart);
  const rPr = format === 'anchor' && firstRun ? insertionRPr(source, firstRun) : '';
  const runs = normalizeInput(text) ? insertedRun(normalizeInput(text), rPr, opts, ids) : '';
  return `<w:p>${pPr}${runs}</w:p>`;
}

// --- XML building helpers ---------------------------------------------------

const MARK_REVISIONS = new Set(['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']);

/**
 * Rebuild paragraph properties. `forCopy` drops what must not be duplicated
 * into a new paragraph (section breaks, revision history). `markRevision` is
 * added to the paragraph mark's run properties.
 */
function buildPPr(source: string, pPr: XmlElement | undefined, forCopy: boolean, markRevision: string | null): string {
  if (!pPr) return markRevision ? `<w:pPr><w:rPr>${markRevision}</w:rPr></w:pPr>` : '';

  let out = openTag(source, pPr);
  let placed = markRevision === null;
  for (const child of pPr.children) {
    if (child.kind === 'text') {
      out += source.slice(child.start, child.end);
      continue;
    }
    if (forCopy && (child.name === 'w:sectPr' || child.name === 'w:pPrChange')) continue;
    if (child.name === 'w:rPr') {
      out += buildMarkRPr(source, child, forCopy, markRevision);
      placed = true;
      continue;
    }
    if (!placed && (child.name === 'w:sectPr' || child.name === 'w:pPrChange')) {
      out += `<w:rPr>${markRevision}</w:rPr>`;
      placed = true;
    }
    out += source.slice(child.start, child.end);
  }
  if (!placed) out += `<w:rPr>${markRevision}</w:rPr>`;
  return out + '</w:pPr>';
}

function buildMarkRPr(source: string, rPr: XmlElement, forCopy: boolean, markRevision: string | null): string {
  const kept = rPr.children.filter(
    (c) => !(forCopy && c.kind === 'element' && (MARK_REVISIONS.has(c.name) || c.name === 'w:rPrChange')),
  );
  // Revision markers lead CT_ParaRPr; put the new one after any existing ones.
  let at = 0;
  kept.forEach((c, i) => {
    if (c.kind === 'element' && MARK_REVISIONS.has(c.name)) at = i + 1;
  });
  const parts = kept.map((c) => source.slice(c.start, c.end));
  if (markRevision) parts.splice(at, 0, markRevision);
  return openTag(source, rPr) + parts.join('') + '</w:rPr>';
}

function withoutChildren(source: string, el: XmlElement, drop: Set<string>): string {
  if (el.selfClosing) return source.slice(el.start, el.end);
  const kept = el.children.filter((c) => !(c.kind === 'element' && drop.has(c.name)));
  return openTag(source, el) + kept.map((c) => source.slice(c.start, c.end)).join('') + `</${el.name}>`;
}

/** The element's start tag, always in non-self-closing form. */
function openTag(source: string, el: XmlElement): string {
  const tag = source.slice(el.start, el.openEnd);
  return el.selfClosing ? tag.replace(/\s*\/>$/, '>') : tag;
}

function revisionAttrs(opts: RevisionOptions, ids: RevisionIds): string {
  return `w:id="${ids.take()}" w:author="${escapeAttr(opts.author)}" w:date="${escapeAttr(opts.date)}"`;
}

function tokensXml(tokens: RunToken[], textTag: 'w:t' | 'w:delText'): string {
  let out = '';
  let text = '';
  const flush = () => {
    if (text) out += `<${textTag} xml:space="preserve">${escapeText(text)}</${textTag}>`;
    text = '';
  };
  for (const token of tokens) {
    if (token.xml !== undefined) {
      flush();
      out += token.xml;
    } else {
      text += token.ch;
    }
  }
  flush();
  return out;
}

const CHAR_ELEMENTS: Record<string, string> = {
  '\t': '<w:tab/>',
  '\n': '<w:br/>',
  '‑': '<w:noBreakHyphen/>',
  '­': '<w:softHyphen/>',
};

function textXml(text: string): string {
  return tokensXml(
    [...text].map((ch) => (ch in CHAR_ELEMENTS ? { ch, xml: CHAR_ELEMENTS[ch]! } : { ch })),
    'w:t',
  );
}

/** Normalize user-entered text to what a paragraph can hold. */
export function normalizeInput(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

function applySplices(source: string, from: number, to: number, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let pos = from;
  for (const s of sorted) {
    if (s.start < pos) throw new Error('Overlapping splices');
    out += source.slice(pos, s.start) + s.xml;
    pos = s.end;
  }
  return out + source.slice(pos, to);
}
