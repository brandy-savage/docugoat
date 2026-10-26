// Side-by-side comparison view and the dialog that starts a comparison. The
// view is plain rendering; the App owns the state and reacts to the hooks.
// All document text is inserted with textContent, never as HTML.

import { changeCount, type CompareRow, type Side } from '@docugoat/review/compare';
import { diffText } from '@docugoat/docx/diff';
import type { DocumentRecord, VersionRecord } from '../storage/store.ts';
import { button } from './findings.ts';
import { el } from './render.ts';

export interface CompareViewModel {
  baseName: string;
  otherName: string;
  rows: CompareRow[];
  picks: Readonly<Record<number, Side>>;
  /** Differences that couldn't be applied, by id, with the reason. */
  errors: ReadonlyMap<number, string>;
  /** Collapse runs of unchanged paragraphs. */
  fold: boolean;
  /** Unchanged runs the reviewer opened, by the index of their first row. */
  expanded: ReadonlySet<number>;
  /** The highlighted difference, for keyboard navigation. */
  current: number | null;
}

export interface CompareViewHooks {
  onPick(id: number, side: Side): void;
  onFillUndecided(side: Side): void;
  onClearPicks(): void;
  onFold(fold: boolean): void;
  onExpand(runStart: number): void;
  onStep(delta: number): void;
  onFinish(): void;
  onCancel(): void;
  onExport(kind: 'tracked' | 'clean'): void;
}

export function renderCompareView(m: CompareViewModel, hooks: CompareViewHooks): HTMLElement {
  const view = el('section', 'compare');
  view.setAttribute('aria-label', 'Document comparison');
  view.append(compareBar(m, hooks), columnHeads(m));

  const body = el('div', 'cmp-rows');
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const start = run[0]!;
    if (m.fold && !m.expanded.has(start)) {
      const fold = el('div', 'cmp-fold');
      fold.append(button(`Show ${run.length} unchanged paragraph${run.length === 1 ? '' : 's'}`, () => hooks.onExpand(start), 'small'));
      body.append(fold);
    } else {
      for (const i of run) body.append(sameRow(m.rows[i] as Extract<CompareRow, { kind: 'same' }>));
    }
    run = [];
  };
  m.rows.forEach((row, i) => {
    if (row.kind === 'same') return run.push(i);
    flush();
    body.append(changeRow(row, m, hooks));
  });
  flush();
  if (!m.rows.length) {
    const empty = el('p', 'muted cmp-empty');
    empty.textContent = 'Neither document has any text to compare.';
    body.append(empty);
  }
  view.append(body);
  return view;
}

function compareBar(m: CompareViewModel, hooks: CompareViewHooks): HTMLElement {
  const total = changeCount(m.rows);
  const picks = Object.values(m.picks);
  const fromOther = picks.filter((p) => p === 'other').length;
  const decided = picks.length;

  const bar = el('div', 'cmp-bar');
  const title = el('div', 'cmp-title');
  const h = el('h2');
  h.textContent = `${total} difference${total === 1 ? '' : 's'}`;
  const sub = el('p', 'muted small');
  sub.textContent = `${decided} of ${total} decided · ${fromOther} taken from “${m.otherName}”. Undecided differences keep this document’s text.`;
  const meter = el('div', 'cmp-meter');
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-label', 'Differences decided');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(total));
  meter.setAttribute('aria-valuenow', String(decided));
  const fill = el('span');
  fill.style.width = `${total ? (100 * decided) / total : 100}%`;
  meter.append(fill);
  title.append(h, sub, meter);

  const tools = el('div', 'cmp-tools');
  const foldLabel = el('label', 'cmp-check');
  const fold = el('input');
  fold.type = 'checkbox';
  fold.id = 'cmp-fold';
  fold.checked = m.fold;
  fold.addEventListener('change', () => hooks.onFold(fold.checked));
  foldLabel.append(fold, ' Hide unchanged');
  const pos = el('span', 'cmp-pos');
  pos.textContent = m.current === null ? `– / ${total}` : `${m.current + 1} / ${total}`;
  const prev = button('↑', () => hooks.onStep(-1), 'icon', 'Previous difference (K)');
  const next = button('↓', () => hooks.onStep(1), 'icon', 'Next difference (J)');
  prev.disabled = next.disabled = total === 0;
  tools.append(foldLabel, el('span', 'spacer'), prev, pos, next);

  const bulk = el('div', 'cmp-tools');
  const keepRest = button('Keep this document for the rest', () => hooks.onFillUndecided('base'), 'small');
  const takeRest = button(`Use “${m.otherName}” for the rest`, () => hooks.onFillUndecided('other'), 'small');
  keepRest.disabled = takeRest.disabled = decided === total;
  const clear = button('Clear picks', () => hooks.onClearPicks(), 'small');
  clear.disabled = decided === 0;
  bulk.append(keepRest, takeRest, clear);

  const finish = el('div', 'cmp-tools');
  finish.append(
    button('Download redline', () => hooks.onExport('tracked'), 'small', 'Download the merged document with tracked changes (.docx)'),
    button('Download clean', () => hooks.onExport('clean'), 'small', 'Download the merged document with changes applied (.docx)'),
    el('span', 'spacer'),
    button('Cancel comparison', () => hooks.onCancel(), 'small danger'),
    button('Finish', () => hooks.onFinish(), 'small primary', 'Finish: keep the merged changes and return to the document'),
  );

  bar.append(title, tools, bulk, finish);
  return bar;
}

function columnHeads(m: CompareViewModel): HTMLElement {
  const heads = el('div', 'cmp-heads');
  for (const [label, name] of [['This document', m.baseName], ['Compared with', m.otherName]] as const) {
    const head = el('div');
    const small = el('span', 'muted small');
    small.textContent = label;
    const strong = el('strong');
    strong.textContent = name;
    head.append(small, strong);
    heads.append(head);
  }
  return heads;
}

function sameRow(row: Extract<CompareRow, { kind: 'same' }>): HTMLElement {
  const r = el('div', 'cmp-row same');
  for (const [text, heading] of [[row.base.text, row.base.heading], [row.other.text, row.other.heading]] as const) {
    const cell = el('div', 'cmp-cell');
    const p = el('p', heading ? 'cmp-para heading' : 'cmp-para');
    p.textContent = text;
    cell.append(p);
    r.append(cell);
  }
  return r;
}

interface Piece {
  text: string;
  className?: string;
}

/** Word-level redline of the two sides: deletions on the left, insertions on the right. */
function redline(base: string, other: string): { left: Piece[]; right: Piece[] } {
  const left: Piece[] = [];
  const right: Piece[] = [];
  let pos = 0;
  for (const h of diffText(base, other)) {
    const same = base.slice(pos, h.start);
    left.push({ text: same });
    right.push({ text: same });
    left.push({ text: base.slice(h.start, h.end), className: 'del' });
    right.push({ text: h.insert, className: 'ins' });
    pos = h.end;
  }
  left.push({ text: base.slice(pos) });
  right.push({ text: base.slice(pos) });
  return { left: left.filter((p) => p.text), right: right.filter((p) => p.text) };
}

/** Render pieces as paragraphs, starting a new one at each newline. */
function renderPieces(container: HTMLElement, pieces: Piece[]): void {
  let p = el('p', 'cmp-para');
  container.append(p);
  for (const piece of pieces) {
    piece.text.split('\n').forEach((part, i) => {
      if (i > 0) {
        p = el('p', 'cmp-para');
        container.append(p);
      }
      if (!part) return;
      const span = el('span', piece.className);
      span.textContent = part;
      p.append(span);
    });
  }
}

function changeRow(row: Extract<CompareRow, { kind: 'change' }>, m: CompareViewModel, hooks: CompareViewHooks): HTMLElement {
  const pick = m.picks[row.id];
  const r = el('div', `cmp-row change${pick ? ' decided' : ''}${m.current === row.id ? ' current' : ''}`);
  r.dataset.change = String(row.id);
  const baseText = row.base.map((b) => b.text).join('\n');
  const otherText = row.other.map((t) => t.text).join('\n');
  const { left, right } = redline(baseText, otherText);

  const where = row.base.length
    ? row.base.map((b) => (b.paraIndex === null ? 'proposed' : `¶${b.paraIndex + 1}`)).join(', ')
    : 'not in this document';
  const sides: Array<[Side, Piece[], string, string]> = [
    ['base', left, where, 'Keep this'],
    ['other', right, row.other.length ? '' : 'not in the other document', 'Use this'],
  ];
  for (const [side, pieces, note, label] of sides) {
    const cell = el('div', `cmp-cell${pick === side ? ' chosen' : ''}${pieces.length ? '' : ' absent'}`);
    const head = el('div', 'cmp-cell-head');
    const meta = el('span', 'muted small');
    meta.textContent = note;
    const choose = button(label, () => hooks.onPick(row.id, side), `small cmp-pick${pick === side ? ' on' : ''}`);
    choose.setAttribute('aria-pressed', String(pick === side));
    choose.setAttribute('aria-label', `${label}: difference ${row.id + 1}, ${side === 'base' ? m.baseName : m.otherName}`);
    head.append(meta, choose);
    cell.append(head);
    if (pieces.length) renderPieces(cell, pieces);
    else {
      const gone = el('p', 'cmp-para muted');
      gone.textContent = side === 'base' ? '(nothing; using this side adds the text on the right)' : '(nothing; using this side removes the text on the left)';
      cell.append(gone);
    }
    cell.addEventListener('click', () => {
      // Selecting text to copy shouldn't count as a pick.
      if (!getSelection()?.isCollapsed) return;
      hooks.onPick(row.id, side);
    });
    r.append(cell);
  }
  const error = m.errors.get(row.id);
  if (error) {
    const note = el('p', 'notice error cmp-error');
    note.textContent = `Can’t use the other version here: ${error}. This difference keeps this document’s text; edit the paragraph by hand after finishing.`;
    r.append(note);
  }
  return r;
}

export interface CompareTarget {
  kind: 'document' | 'version';
  id: string;
}

export interface CompareDialogOptions {
  documents: DocumentRecord[];
  versions: VersionRecord[];
  /** Proposed changes in the open document, which the comparison includes. */
  pendingEdits: number;
  onChoose(target: CompareTarget): void;
  onImport(file: File): void;
}

export function openCompareDialog(opts: CompareDialogOptions): void {
  const dialog = el('dialog', 'rules-dialog compare-dialog');
  dialog.setAttribute('aria-labelledby', 'compare-dialog-title');
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());

  const head = el('header', 'dialog-head');
  const title = el('div');
  const h = el('h2');
  h.id = 'compare-dialog-title';
  h.textContent = 'Compare with…';
  const sub = el('p', 'muted small');
  sub.textContent =
    'See the differences side by side and choose, for each one, which text to keep. Your choices become tracked changes in this document; no file is modified.' +
    (opts.pendingEdits ? ` The comparison includes your ${opts.pendingEdits} proposed change${opts.pendingEdits === 1 ? '' : 's'}.` : '');
  title.append(h, sub);
  head.append(title, button('Close', () => dialog.close(), 'small'));

  const body = el('div', 'dialog-body');
  const choose = (target: CompareTarget) => {
    dialog.close();
    opts.onChoose(target);
  };
  const section = (heading: string, items: Array<{ name: string; meta: string; target: CompareTarget }>, empty: string) => {
    const h3 = el('h3', 'cmp-dialog-h');
    h3.textContent = heading;
    body.append(h3);
    if (!items.length) {
      const p = el('p', 'muted small');
      p.textContent = empty;
      body.append(p);
      return;
    }
    const list = el('ul', 'cmp-targets');
    for (const item of items) {
      const li = el('li');
      const b = el('button', 'doc-open');
      b.type = 'button';
      const name = el('span', 'name');
      name.textContent = item.name;
      const meta = el('span', 'meta');
      meta.textContent = item.meta;
      b.append(name, meta);
      b.addEventListener('click', () => choose(item.target));
      li.append(b);
      list.append(li);
    }
    body.append(list);
  };

  section(
    'Documents in your library',
    opts.documents.map((d) => ({ name: d.name, meta: `Imported ${new Date(d.importedAt).toLocaleDateString()}`, target: { kind: 'document', id: d.id } })),
    'No other documents yet. Import the other draft below.',
  );
  section(
    'Saved versions of this document',
    [...opts.versions].reverse().map((v) => ({
      name: v.label,
      meta: `${new Date(v.createdAt).toLocaleString()} · ${v.edits.length} change${v.edits.length === 1 ? '' : 's'}`,
      target: { kind: 'version', id: v.id },
    })),
    'No saved versions.',
  );

  const file = el('input');
  file.type = 'file';
  file.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  file.hidden = true;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    dialog.close();
    opts.onImport(f);
  });
  const importRow = el('div', 'dialog-actions cmp-dialog-import');
  importRow.append(button('Import another .docx to compare…', () => file.click()), file);
  body.append(importRow);

  dialog.append(head, body);
  dialog.showModal();
}
