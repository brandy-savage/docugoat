// Renders a part's body as a readable page. This is a review view, not a
// layout engine: it shows structure, emphasis, tables, existing revisions,
// proposed changes and highlights. All document text is inserted with
// textContent, never as HTML.

import { diffText } from '@docugoat/docx/diff';
import type { ParagraphInfo, PartIndex, RunInfo } from '@docugoat/docx/paragraphs';
import { childElements, firstChild, type XmlElement } from '@docugoat/docx/xml';
import { insertBlockId, paragraphBlockId } from '@docugoat/review/bridge';

export interface ParagraphState {
  /** Proposed replacement text, if the paragraph has been edited. */
  text?: string;
  deleted?: boolean;
  /** Paragraphs proposed for insertion after this one. */
  inserted: Array<{ id: number; text: string }>;
}

/** A highlighted range in a block's current text. */
export interface Mark {
  start: number;
  end: number;
  className: string;
  /** Finding fingerprint, when the mark belongs to a finding. */
  finding?: string;
}

export interface RenderHooks {
  stateOf(p: ParagraphInfo): ParagraphState;
  marksFor(blockId: string): Mark[];
  isEditing(p: ParagraphInfo): boolean;
  isEditingInsert(id: number): boolean;
  renderEditor(p: ParagraphInfo): HTMLElement;
  renderInsertEditor(p: ParagraphInfo, id: number): HTMLElement;
  onSelect(p: ParagraphInfo): void;
  onSelectInsert(p: ParagraphInfo, id: number): void;
  onSelectFinding(fingerprint: string): void;
}

/** A piece of rendered text; `offset` is its position in the block's current text, or null if not part of it. */
interface Segment {
  text: string;
  offset: number | null;
  className?: string;
  style?: Partial<Pick<CSSStyleDeclaration, 'fontWeight' | 'fontStyle' | 'textDecoration'>>;
}

export function renderPart(index: PartIndex, hooks: RenderHooks): HTMLElement {
  const page = el('article', 'page');
  const body = firstChild(index.doc.root, 'w:body') ?? index.doc.root;
  renderBlocks(body, index, hooks, page);
  return page;
}

// Deeper nesting than any real document uses; stops hostile files from overflowing the stack.
const MAX_BLOCK_DEPTH = 64;

function renderBlocks(container: XmlElement, index: PartIndex, hooks: RenderHooks, out: HTMLElement, depth = 0): void {
  if (depth > MAX_BLOCK_DEPTH) {
    const note = el('p', 'muted small');
    note.textContent = '(Content nested too deeply to display.)';
    out.append(note);
    return;
  }
  for (const child of childElements(container)) {
    if (child.name === 'w:p') {
      const p = index.byElement.get(child);
      if (p) renderParagraphWithInserts(p, hooks, out);
    } else if (child.name === 'w:tbl') {
      out.append(renderTable(child, index, hooks, depth + 1));
    } else if (child.name === 'w:sdt') {
      const content = firstChild(child, 'w:sdtContent');
      if (content) renderBlocks(content, index, hooks, out, depth + 1);
    } else if (child.name === 'w:customXml') {
      renderBlocks(child, index, hooks, out, depth + 1);
    }
  }
}

function renderTable(tbl: XmlElement, index: PartIndex, hooks: RenderHooks, depth: number): HTMLElement {
  const table = el('table', 'doc-table');
  for (const tr of childElements(tbl, 'w:tr')) {
    const row = el('tr');
    for (const tc of childElements(tr, 'w:tc')) {
      const cell = el('td');
      const tcPr = firstChild(tc, 'w:tcPr');
      const span = tcPr && firstChild(tcPr, 'w:gridSpan');
      if (span?.attrs['w:val']) cell.colSpan = Number(span.attrs['w:val']);
      renderBlocks(tc, index, hooks, cell, depth + 1);
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

function renderParagraphWithInserts(p: ParagraphInfo, hooks: RenderHooks, out: HTMLElement): void {
  const state = hooks.stateOf(p);
  out.append(hooks.isEditing(p) ? hooks.renderEditor(p) : renderParagraph(p, state, hooks));
  for (const ins of state.inserted) {
    if (hooks.isEditingInsert(ins.id)) {
      out.append(hooks.renderInsertEditor(p, ins.id));
      continue;
    }
    const blockId = insertBlockId(ins.id);
    const block = paragraphShell(p, 'para proposed-insert');
    block.dataset.block = blockId;
    const segments: Segment[] = ins.text ? [{ text: ins.text, offset: 0, className: 'ins' }] : [{ text: '(empty paragraph)', offset: null, className: 'ins' }];
    renderSegments(block, segments, hooks.marksFor(blockId), hooks);
    block.addEventListener('click', () => hooks.onSelectInsert(p, ins.id));
    out.append(block);
  }
}

function renderParagraph(p: ParagraphInfo, state: ParagraphState, hooks: RenderHooks): HTMLElement {
  const blockId = paragraphBlockId(p.index);
  const block = paragraphShell(p, 'para');
  block.dataset.block = blockId;
  block.tabIndex = 0;
  block.addEventListener('click', () => hooks.onSelect(p));
  block.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === block) hooks.onSelect(p);
  });

  let segments: Segment[];
  if (state.deleted) {
    block.classList.add('proposed-delete');
    segments = [{ text: p.text || ' ', offset: null, className: 'del' }];
  } else if (state.text !== undefined) {
    block.classList.add('edited');
    segments = redlineSegments(p.text, state.text);
  } else {
    segments = p.runs.map(runSegment);
    if (!p.text) block.classList.add('empty');
  }
  renderSegments(block, segments, state.deleted ? [] : hooks.marksFor(blockId), hooks);
  return block;
}

/** Original text with a proposed revision shown inline; offsets refer to the revised text. */
function redlineSegments(original: string, revised: string): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  let offset = 0;
  const keep = (text: string) => {
    if (!text) return;
    out.push({ text, offset });
    offset += text.length;
  };
  for (const h of diffText(original, revised)) {
    keep(original.slice(pos, h.start));
    if (h.end > h.start) out.push({ text: original.slice(h.start, h.end), offset: null, className: 'del' });
    if (h.insert) {
      out.push({ text: h.insert, offset, className: 'ins' });
      offset += h.insert.length;
    }
    pos = h.end;
  }
  keep(original.slice(pos));
  return out;
}

function runSegment(run: RunInfo): Segment {
  const text = run.tokens.map((t) => t.ch).join('');
  const props = run.rPr ? new Set(childElements(run.rPr).filter(isOn).map((c) => c.name)) : new Set<string>();
  const classes: string[] = [];
  if (run.context.inserted) classes.push('existing-ins');
  if (run.context.deleted) classes.push('existing-del');
  if (run.context.field) classes.push('field');
  if (run.rPr && firstChild(run.rPr, 'w:rStyle')?.attrs['w:val'] === 'Hyperlink') classes.push('link');
  return {
    text,
    offset: run.context.deleted ? null : run.textStart,
    className: classes.join(' ') || undefined,
    style: {
      fontWeight: props.has('w:b') ? '700' : '',
      fontStyle: props.has('w:i') ? 'italic' : '',
      textDecoration: props.has('w:strike') ? 'line-through' : props.has('w:u') ? 'underline' : '',
    },
  };
}

/** Render segments, wrapping the parts covered by marks in <mark> elements. */
function renderSegments(container: HTMLElement, segments: Segment[], marks: Mark[], hooks: RenderHooks): void {
  for (const seg of segments) {
    if (!seg.text) continue;
    const covering = seg.offset === null ? [] : marks.filter((m) => m.start < seg.offset! + seg.text.length && m.end > seg.offset!);
    if (covering.length === 0) {
      container.append(segmentSpan(seg, seg.text));
      continue;
    }
    const base = seg.offset!;
    const cuts = new Set([0, seg.text.length]);
    for (const m of covering) {
      cuts.add(Math.max(0, m.start - base));
      cuts.add(Math.min(seg.text.length, m.end - base));
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i]!, points[i + 1]!];
      const piece = segmentSpan(seg, seg.text.slice(a, b));
      const active = covering.filter((m) => m.start < base + b && m.end > base + a);
      if (active.length === 0) {
        container.append(piece);
        continue;
      }
      const mark = el('mark', active.map((m) => m.className).join(' '));
      const finding = active.find((m) => m.finding)?.finding;
      if (finding) {
        mark.dataset.finding = finding;
        mark.addEventListener('click', (e) => {
          e.stopPropagation();
          hooks.onSelectFinding(finding);
        });
      }
      mark.append(piece);
      container.append(mark);
    }
  }
}

function segmentSpan(seg: Segment, text: string): HTMLElement {
  const s = el('span', seg.className);
  s.textContent = text;
  if (seg.style) Object.assign(s.style, seg.style);
  return s;
}

function paragraphShell(p: ParagraphInfo, className: string): HTMLElement {
  const block = el('p', className);
  if (p.styleId) block.dataset.style = p.styleId;
  const numPr = p.pPr && firstChild(p.pPr, 'w:numPr');
  if (numPr) {
    const level = Number(firstChild(numPr, 'w:ilvl')?.attrs['w:val'] ?? 0);
    block.classList.add('numbered');
    block.style.setProperty('--level', String(level));
  }
  const jc = p.pPr && firstChild(p.pPr, 'w:jc')?.attrs['w:val'];
  if (jc === 'center' || jc === 'right') block.style.textAlign = jc;
  return block;
}

function isOn(prop: XmlElement): boolean {
  const val = prop.attrs['w:val'];
  return val === undefined || !['0', 'false', 'off', 'none'].includes(val);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
