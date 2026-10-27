import { changeCount, compareBlocks, mergeEdits, type CompareRow, type CompareText, type Side } from '@docugoat/review/compare';
import { exportDocx, openDocx, revisionDate, type OpenedDocx } from '@docugoat/docx/document';
import type { Edit, RevisionOptions } from '@docugoat/docx/edits';
import type { ParagraphInfo } from '@docugoat/docx/paragraphs';
import { applyPlannedChange, currentBlocks, withContentEdit, type DocBlock } from '@docugoat/review/bridge';
import { scan, search } from '@docugoat/rules/engine';
import { fillTemplate, planChange } from '@docugoat/rules/playbook';
import samplePack from '@docugoat/rules/sample-pack.json';
import type { ClauseTemplate, Finding, Location, Rulepack, ScanResult } from '@docugoat/rules/types';
import { validateRulepack } from '@docugoat/rules/validate';
import {
  requestPersistence,
  ReviewStore,
  storageEstimate,
  type ComparisonRecord,
  type DocumentRecord,
  type FindingStatus,
  type ReviewProfile,
  type ReviewRecord,
  type VersionRecord,
} from '../storage/store.ts';
import { openCompareDialog, renderCompareView, type CompareTarget } from './compare-view.ts';
import { button, isActionable, renderFindingsPanel } from './findings.ts';
import { el, renderPart, type Mark, type ParagraphState } from './render.ts';
import { openRulesDialog } from './rules-dialog.ts';

const SAMPLE_PACK = samplePack as Rulepack;

interface Session {
  record: DocumentRecord;
  docx: OpenedDocx;
  edits: Edit[];
  versions: VersionRecord[];
  savedAt: Date | null;
  review: ReviewRecord;
  blocks: DocBlock[];
  scan: ScanResult;
}

type Editing = { kind: 'paragraph'; index: number } | { kind: 'insert'; editIndex: number } | null;

/** A comparison in progress: the stored record plus view state. */
interface Comparison {
  record: ComparisonRecord;
  rows: CompareRow[];
  errors: Map<number, string>;
  fold: boolean;
  expanded: Set<number>;
  current: number | null;
}

const AUTHOR_KEY = 'contract-reviewer.author';
const RULEPACK_KEY = 'rulepack';

export class App {
  private session: Session | null = null;
  private documents: DocumentRecord[] = [];
  private pack: Rulepack = SAMPLE_PACK;
  private editing: Editing = null;
  private editorError: string | null = null;
  private selected: string | null = null;
  private filter: 'open' | 'all' = 'open';
  private applyError: string | null = null;
  private searchHits: Location[] = [];
  private searchIndex = 0;
  private comparison: Comparison | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: ReviewStore,
  ) {}

  async start(): Promise<void> {
    this.root.innerHTML = '';
    this.root.append(this.shell());
    this.installDropZone();
    const stored = await this.store.getSetting<Rulepack>(RULEPACK_KEY);
    if (stored && validateRulepack(stored).length === 0) this.pack = stored;
    this.documents = await this.store.listDocuments();
    this.renderSidebar();
    this.renderAll();
    void this.renderStorage();
  }

  // --- Layout -------------------------------------------------------------

  /** Name of the open document, or null. Used by host pages (e.g. the signing flow). */
  get openDocumentName(): string | null {
    return this.session?.record.name ?? null;
  }

  /** The open document as it currently reads, exported with pending edits applied (tracked or clean). */
  currentExport(mode: 'tracked' | 'clean'): { name: string; bytes: Uint8Array } | null {
    const s = this.session;
    if (!s) return null;
    return { name: s.record.name, bytes: exportDocx(s.docx, s.edits, this.revisionOptions(mode)) };
  }

  /** Subscribe to document open/close so a host can enable actions. */
  onSessionChange(listener: (name: string | null) => void): () => void {
    this.sessionListeners.add(listener);
    return () => { this.sessionListeners.delete(listener); };
  }
  private sessionListeners = new Set<(name: string | null) => void>();

  private shell(): HTMLElement {
    const wrap = el('div', 'app');
    wrap.innerHTML = `
      <header class="topbar">
        <div class="brand"><span class="mark">§</span> Contract Reviewer</div>
        <div class="search-bar" role="search">
          <input id="search" type="search" placeholder="Search document  (word*  or  /regex/)" aria-label="Search document" disabled>
          <span id="search-count" class="search-count"></span>
          <button id="search-prev" class="btn icon" aria-label="Previous match" disabled>↑</button>
          <button id="search-next" class="btn icon" aria-label="Next match" disabled>↓</button>
        </div>
        <div class="actions">
          <label class="author">Author <input id="author" type="text" autocomplete="name" placeholder="Your name"></label>
          <button id="rules" class="btn">Rules</button>
          <button id="import" class="btn">Import .docx</button>
          <div class="menu" id="export-menu">
            <button id="export" class="btn primary" disabled>Export ▾</button>
            <div class="menu-items" hidden>
              <button data-export="tracked">Tracked changes (.docx)</button>
              <button data-export="clean">Clean, changes applied (.docx)</button>
              <button data-export="original">Original file</button>
              <button data-export="report">Review report (.html)</button>
            </div>
          </div>
        </div>
        <input id="file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden multiple>
      </header>
      <aside class="sidebar" id="sidebar"></aside>
      <main class="main" id="main"></main>
      <aside class="findings" id="findings" aria-label="Findings"></aside>
      <div class="drop-overlay" id="drop-overlay" hidden><div>Drop .docx files to import</div></div>
      <div class="toast" id="toast" role="status" hidden></div>`;

    const author = wrap.querySelector<HTMLInputElement>('#author')!;
    author.value = readPref(AUTHOR_KEY) ?? '';
    author.addEventListener('change', () => writePref(AUTHOR_KEY, author.value.trim()));

    const file = wrap.querySelector<HTMLInputElement>('#file')!;
    wrap.querySelector('#import')!.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      void this.importFiles([...(file.files ?? [])]);
      file.value = '';
    });
    wrap.querySelector('#rules')!.addEventListener('click', () => this.openRules());

    const searchInput = wrap.querySelector<HTMLInputElement>('#search')!;
    searchInput.addEventListener('input', () => this.runSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.stepSearch(e.shiftKey ? -1 : 1);
      if (e.key === 'Escape') {
        searchInput.value = '';
        this.runSearch('');
      }
    });
    wrap.querySelector('#search-prev')!.addEventListener('click', () => this.stepSearch(-1));
    wrap.querySelector('#search-next')!.addEventListener('click', () => this.stepSearch(1));
    window.addEventListener('keydown', (e) => {
      // Escape cancels editing wherever focus is (dialogs handle their own Escape).
      if (e.key === 'Escape' && this.editing && !document.querySelector('dialog[open]') && !(e.target instanceof HTMLTextAreaElement)) {
        if (this.discardEmptyInsert() === null) this.finishEdit(null);
        return;
      }
      if (this.comparison && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target) && !document.querySelector('dialog[open]')) {
        if (e.key === 'j' || e.key === 'n') this.stepComparison(1);
        if (e.key === 'k' || e.key === 'p') this.stepComparison(-1);
        if ((e.key === '1' || e.key === '2') && this.comparison.current !== null) {
          this.pick(this.comparison.current, e.key === '1' ? 'base' : 'other');
          this.stepComparison(1);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && this.session) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    const menu = wrap.querySelector<HTMLElement>('#export-menu')!;
    const items = menu.querySelector<HTMLElement>('.menu-items')!;
    menu.querySelector('#export')!.addEventListener('click', (e) => {
      e.stopPropagation();
      items.hidden = !items.hidden;
    });
    document.addEventListener('click', () => (items.hidden = true));
    items.addEventListener('click', (e) => {
      const kind = (e.target as HTMLElement).dataset.export;
      if (kind) void this.export(kind as 'tracked' | 'clean' | 'original' | 'report');
    });
    return wrap;
  }

  private $<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  private installDropZone(): void {
    const overlay = this.$('#drop-overlay');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      overlay.hidden = false;
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) overlay.hidden = true;
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      void this.importFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }

  // --- Documents ----------------------------------------------------------

  /** Import files into the library and, unless `open` is false, open the last one. */
  async importFiles(files: File[], open = true): Promise<DocumentRecord | null> {
    let last: DocumentRecord | null = null;
    for (const f of files) {
      if (!/\.docx$/i.test(f.name)) {
        this.toast(`${f.name}: only .docx files can be imported for now`);
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      try {
        openDocx(bytes); // validate before storing
      } catch (err) {
        this.toast(`${f.name}: ${(err as Error).message}`);
        continue;
      }
      try {
        const { record, existing } = await this.store.importDocument(f.name, bytes);
        if (existing) this.toast(`${f.name} is already in your library as “${record.name}”`);
        last = record;
      } catch (err) {
        this.toast(`${f.name} could not be saved in this browser: ${(err as Error).message || 'storage error'}. Free up space or export your work first.`);
      }
    }
    if (!last) return null;
    void requestPersistence();
    this.documents = await this.store.listDocuments();
    if (open) await this.openDocument(last.id);
    else this.renderSidebar();
    return last;
  }

  async importSample(): Promise<void> {
    const res = await fetch('samples/sample-msa.docx');
    if (!res.ok) return this.toast('Could not load the sample contract');
    const blob = await res.blob();
    await this.importFiles([new File([blob], 'Sample MSA.docx')]);
  }

  async openDocument(id: string): Promise<void> {
    const record = this.documents.find((d) => d.id === id);
    if (!record) return;
    try {
      const docx = openDocx(await this.store.getOriginal(id));
      const draft = await this.store.getDraft(id);
      const review = (await this.store.getReview(id)) ?? { documentId: id, profile: guessProfile(record, docx), statuses: {} };
      const edits = draft?.edits ?? [];
      const blocks = currentBlocks(docx, edits);
      this.session = {
        record,
        docx,
        edits,
        versions: await this.store.listVersions(id),
        savedAt: draft ? new Date(draft.updatedAt) : null,
        review,
        blocks,
        scan: scan(blocks, this.pack.rules, review.profile),
      }; this.sessionListeners.forEach((l) => l(this.session?.record.name ?? null));
      this.comparison = null;
      const comparison = await this.store.getComparison(id);
      if (comparison) this.enterComparison(comparison);
    } catch (err) {
      this.toast(`Could not open ${record.name}: ${(err as Error).message}`);
      return;
    }
    this.editing = null;
    this.selected = null;
    this.searchHits = [];
    const searchInput = this.$<HTMLInputElement>('#search');
    searchInput.value = '';
    searchInput.disabled = !!this.comparison;
    this.renderSidebar();
    this.renderAll();
  }

  private async deleteDocument(record: DocumentRecord): Promise<void> {
    if (!confirm(`Delete “${record.name}” and all of its saved versions from this browser?`)) return;
    await this.store.deleteDocument(record.id);
    if (this.session?.record.id === record.id) {
      this.session = null; this.sessionListeners.forEach((l) => l(this.session?.record.name ?? null));
      this.comparison = null;
      this.editing = null;
      this.selected = null;
      const input = this.$<HTMLInputElement>('#search');
      input.value = '';
      input.disabled = true;
      this.searchHits = [];
      this.updateSearchCount('');
    }
    this.documents = await this.store.listDocuments();
    this.renderSidebar();
    this.renderAll();
    void this.renderStorage();
  }

  // --- Versions -----------------------------------------------------------

  private async saveVersion(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const label = prompt('Name this version', `Version ${s.versions.length + 1}`);
    if (label === null) return;
    await this.store.saveVersion(s.record.id, label.trim() || `Version ${s.versions.length + 1}`, s.edits);
    s.versions = await this.store.listVersions(s.record.id);
    this.renderSidebar();
    this.toast('Version saved');
  }

  private async restoreVersion(v: VersionRecord): Promise<void> {
    const s = this.session;
    if (!s) return;
    if (this.comparison) return this.toast('Finish or cancel the comparison before restoring a version');
    if (s.edits.length && !confirm(`Replace the working draft with “${v.label}”?`)) return;
    this.editing = null;
    this.setEdits(structuredClone(v.edits));
    this.toast(`Restored “${v.label}”`);
  }

  private async deleteVersion(v: VersionRecord): Promise<void> {
    const s = this.session;
    if (!s || !confirm(`Delete version “${v.label}”?`)) return;
    await this.store.deleteVersion(v.id);
    s.versions = await this.store.listVersions(s.record.id);
    this.renderSidebar();
  }

  /**
   * Persist the working draft. Edits change only on explicit actions, so
   * every change is written straight away; a reload never loses one.
   */
  private async saveDraft(): Promise<void> {
    const s = this.session;
    if (!s) return;
    await this.store.saveDraft(s.record.id, s.edits);
    s.savedAt = new Date();
    const status = this.root.querySelector('#draft-status');
    if (status) status.textContent = draftStatus(s);
  }

  // --- Edits and scanning ---------------------------------------------------

  /** Replace the edit list, save the draft, rescan, and re-render. */
  private setEdits(edits: Edit[]): void {
    const s = this.session!;
    s.edits = edits;
    void this.saveDraft();
    this.rescan();
    this.renderAll();
  }

  private rescan(): void {
    const s = this.session;
    if (!s) return;
    s.blocks = currentBlocks(s.docx, s.edits);
    s.scan = scan(s.blocks, this.pack.rules, s.review.profile);
    if (this.selected && !s.scan.findings.some((f) => f.fingerprint === this.selected)) this.selected = null;
    const input = this.root.querySelector<HTMLInputElement>('#search');
    if (input?.value) {
      this.searchHits = search(s.blocks, input.value);
      this.searchIndex = Math.min(this.searchIndex, Math.max(0, this.searchHits.length - 1));
      this.updateSearchCount(input.value);
    }
  }

  private stateOf(p: ParagraphInfo): ParagraphState {
    const s = this.session!;
    const state: ParagraphState = { inserted: [] };
    s.edits.forEach((e, i) => {
      if (e.type === 'replaceText' && e.paraIndex === p.index) state.text = e.text;
      if (e.type === 'deleteParagraph' && e.paraIndex === p.index) state.deleted = true;
      if (e.type === 'insertParagraph' && e.afterIndex === p.index) state.inserted.push({ id: i, text: e.text });
    });
    return state;
  }

  private revisionOptions(mode: 'tracked' | 'clean'): RevisionOptions {
    return { mode, author: this.$<HTMLInputElement>('#author').value.trim() || 'Reviewer', date: revisionDate() };
  }

  /** Replace a paragraph's content edit; returns an error message if refused. */
  private setContentEdit(p: ParagraphInfo, edit: Edit | null): string | null {
    const s = this.session!;
    const { edits, error } = withContentEdit(s.docx, s.edits, p, edit, this.revisionOptions('tracked'));
    if (error) return error;
    this.editing = null;
    this.setEdits(edits);
    return null;
  }

  // --- Findings ---------------------------------------------------------------

  private statusOf(fingerprint: string): FindingStatus {
    return this.session?.review.statuses[fingerprint]?.status ?? 'open';
  }

  private async setStatus(fingerprint: string, status: FindingStatus): Promise<void> {
    const s = this.session!;
    if (status === 'open') delete s.review.statuses[fingerprint];
    else s.review.statuses[fingerprint] = { status, updatedAt: new Date().toISOString() };
    await this.store.saveReview(s.review);
    this.renderAll();
  }

  private async setProfile(profile: ReviewProfile): Promise<void> {
    const s = this.session!;
    s.review.profile = profile;
    await this.store.saveReview(s.review);
    this.rescan();
    this.renderAll();
  }

  private selectFinding(fingerprint: string | null): void {
    this.selected = fingerprint;
    this.applyError = null;
    this.renderAll();
    if (!fingerprint) return;
    requestAnimationFrame(() => {
      const mark = this.root.querySelector(`#main mark.active`);
      mark?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.root.querySelector(`#findings li[data-finding="${CSS.escape(fingerprint)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  private applyTemplate(finding: Finding, template: ClauseTemplate, variables: Record<string, string>): void {
    const s = this.session!;
    const { text, missing } = fillTemplate(template.text, variables);
    if (missing.length) return;
    const change = planChange(template, finding, s.blocks, text);
    const { edits, error } = applyPlannedChange(s.docx, s.edits, change, this.revisionOptions('tracked'));
    if (error) {
      this.applyError = error;
      this.renderAll();
      return;
    }
    // Remember variables the reviewer filled in for next time.
    const filled = Object.fromEntries(Object.entries(variables).filter(([, v]) => v.trim()));
    s.review.profile = { ...s.review.profile, variables: { ...s.review.profile.variables, ...filled } };
    s.review.statuses[finding.fingerprint] = { status: 'resolved', note: `Applied ${template.id}`, updatedAt: new Date().toISOString() };
    void this.store.saveReview(s.review);
    this.applyError = null;
    this.selected = null;
    this.setEdits(edits);
    this.toast(`Applied “${template.title}” as a tracked change`);
  }

  private marksFor(blockId: string): Mark[] {
    const s = this.session;
    if (!s) return [];
    const marks: Mark[] = [];
    for (const f of s.scan.findings) {
      const active = f.fingerprint === this.selected;
      if (!active && !isActionable(this.statusOf(f.fingerprint))) continue;
      for (const h of f.hits) {
        if (h.blockId !== blockId) continue;
        marks.push({ start: h.start, end: h.end, className: active ? 'hit active' : `hit sev-${f.severity}`, finding: f.fingerprint });
      }
    }
    this.searchHits.forEach((h, i) => {
      if (h.blockId === blockId) marks.push({ start: h.start, end: h.end, className: i === this.searchIndex ? 'search current' : 'search' });
    });
    return marks;
  }

  // --- Search -------------------------------------------------------------------

  private runSearch(query: string): void {
    const s = this.session;
    this.searchHits = s ? search(s.blocks, query) : [];
    this.searchIndex = 0;
    this.renderMain();
    this.updateSearchCount(query);
    this.scrollToSearchHit();
  }

  private stepSearch(delta: number): void {
    if (!this.searchHits.length) return;
    this.searchIndex = (this.searchIndex + delta + this.searchHits.length) % this.searchHits.length;
    this.renderMain();
    this.updateSearchCount(this.$<HTMLInputElement>('#search').value);
    this.scrollToSearchHit();
  }

  private updateSearchCount(query: string): void {
    const n = this.searchHits.length;
    this.$('#search-count').textContent = query.trim() ? (n ? `${this.searchIndex + 1} of ${n}` : 'No matches') : '';
    this.$<HTMLButtonElement>('#search-prev').disabled = n < 2;
    this.$<HTMLButtonElement>('#search-next').disabled = n < 2;
  }

  private scrollToSearchHit(): void {
    requestAnimationFrame(() => this.root.querySelector('#main mark.search.current')?.scrollIntoView({ block: 'center' }));
  }

  // --- Comparison -------------------------------------------------------------------

  private openCompare(): void {
    const s = this.session;
    if (!s) return;
    openCompareDialog({
      documents: this.documents.filter((d) => d.id !== s.record.id),
      versions: s.versions,
      pendingEdits: s.edits.length,
      onChoose: (target) => void this.startComparison(target),
      onImport: async (file) => {
        const record = await this.importFiles([file], false);
        if (record && record.id === s.record.id) return this.toast('That file is this document; choose a different draft');
        if (record) await this.startComparison({ kind: 'document', id: record.id });
      },
    });
  }

  private async startComparison(target: CompareTarget): Promise<void> {
    const s = this.session;
    if (!s) return;
    let otherName: string;
    let other: CompareText[];
    try {
      if (target.kind === 'version') {
        const v = s.versions.find((x) => x.id === target.id);
        if (!v) return;
        otherName = `${v.label} (saved version)`;
        other = currentBlocks(s.docx, v.edits).map((b) => ({ text: b.text, heading: b.heading }));
      } else {
        const d = this.documents.find((x) => x.id === target.id);
        if (!d) return;
        const docx = openDocx(await this.store.getOriginal(d.id));
        const draft = await this.store.getDraft(d.id);
        otherName = d.name;
        other = currentBlocks(docx, draft?.edits ?? []).map((b) => ({ text: b.text, heading: b.heading }));
      }
    } catch (err) {
      return this.toast(`Could not open the other document: ${(err as Error).message}`);
    }
    const record: ComparisonRecord = {
      documentId: s.record.id,
      otherName,
      other,
      baseEdits: structuredClone(s.edits),
      picks: {},
      startedAt: new Date().toISOString(),
    };
    if (changeCount(compareBlocks(s.blocks, other)) === 0) {
      return this.toast(`No differences: this document and “${otherName}” have the same text`);
    }
    await this.store.saveComparison(record);
    this.editing = null;
    this.enterComparison(record);
    this.renderAll();
  }

  private enterComparison(record: ComparisonRecord): void {
    const s = this.session!;
    const rows = compareBlocks(currentBlocks(s.docx, record.baseEdits), record.other);
    const { edits, errors } = mergeEdits(s.docx, record.baseEdits, rows, record.picks, this.revisionOptions('tracked'));
    this.comparison = { record, rows, errors, fold: true, expanded: new Set(), current: null };
    this.$<HTMLInputElement>('#search').disabled = true;
    // The picks are the source of truth while comparing. The draft is saved
    // separately, so if the page closed between the two saves, rebuild it.
    if (JSON.stringify(edits) !== JSON.stringify(s.edits)) {
      s.edits = edits;
      void this.saveDraft();
      this.rescan();
    }
  }

  /** Recompute the merged edits from the starting edits and the current picks. */
  private setPicks(picks: Record<number, Side>): void {
    const c = this.comparison;
    const s = this.session;
    if (!c || !s) return;
    c.record.picks = picks;
    void this.store.saveComparison(c.record);
    const { edits, errors } = mergeEdits(s.docx, c.record.baseEdits, c.rows, picks, this.revisionOptions('tracked'));
    c.errors = errors;
    this.setEdits(edits);
  }

  private pick(id: number, side: Side): void {
    const c = this.comparison;
    if (!c) return;
    const picks = { ...c.record.picks };
    if (picks[id] === side) delete picks[id];
    else picks[id] = side;
    c.current = id;
    this.setPicks(picks);
  }

  private stepComparison(delta: number): void {
    const c = this.comparison;
    if (!c) return;
    const total = changeCount(c.rows);
    if (!total) return;
    c.current = c.current === null ? (delta > 0 ? 0 : total - 1) : (c.current + delta + total) % total;
    this.renderMain();
    requestAnimationFrame(() =>
      this.root.querySelector(`#main [data-change="${c.current}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  }

  private async finishComparison(): Promise<void> {
    const c = this.comparison;
    const s = this.session;
    if (!c || !s) return;
    // Only "use the other version" picks can fail, so errors are all among them.
    const taken = Object.values(c.record.picks).filter((p) => p === 'other').length - c.errors.size;
    await this.store.deleteComparison(s.record.id);
    this.comparison = null;
    this.$<HTMLInputElement>('#search').disabled = false;
    this.renderAll();
    this.toast(taken ? `Merged ${taken} difference${taken === 1 ? '' : 's'} from “${c.record.otherName}” as tracked changes` : 'Comparison finished with no changes taken');
  }

  private async cancelComparison(): Promise<void> {
    const c = this.comparison;
    const s = this.session;
    if (!c || !s) return;
    if (Object.keys(c.record.picks).length && !confirm('Cancel the comparison and undo the changes it made?')) return;
    await this.store.deleteComparison(s.record.id);
    this.comparison = null;
    this.$<HTMLInputElement>('#search').disabled = false;
    this.setEdits(structuredClone(c.record.baseEdits));
  }

  private renderComparison(c: Comparison): HTMLElement {
    const s = this.session!;
    return renderCompareView(
      {
        baseName: s.record.name,
        otherName: c.record.otherName,
        rows: c.rows,
        picks: c.record.picks,
        errors: c.errors,
        fold: c.fold,
        expanded: c.expanded,
        current: c.current,
      },
      {
        onPick: (id, side) => this.pick(id, side),
        onFillUndecided: (side) => {
          const picks = { ...c.record.picks };
          for (const row of c.rows) if (row.kind === 'change') picks[row.id] ??= side;
          this.setPicks(picks);
        },
        onClearPicks: () => this.setPicks({}),
        onFold: (fold) => {
          c.fold = fold;
          c.expanded.clear();
          this.renderMain();
        },
        onExpand: (start) => {
          c.expanded.add(start);
          this.renderMain();
        },
        onStep: (delta) => this.stepComparison(delta),
        onFinish: () => void this.finishComparison(),
        onCancel: () => void this.cancelComparison(),
        onExport: (kind) => void this.export(kind),
      },
    );
  }

  // --- Rules ----------------------------------------------------------------------

  private openRules(): void {
    openRulesDialog(this.pack, {
      onSave: async (pack) => {
        this.pack = pack;
        await this.store.setSetting(RULEPACK_KEY, pack);
        this.rescan();
        this.renderAll();
      },
      onReset: async () => {
        this.pack = SAMPLE_PACK;
        await this.store.deleteSetting(RULEPACK_KEY);
        this.rescan();
        this.renderAll();
        return SAMPLE_PACK;
      },
      toast: (m) => this.toast(m),
    });
  }

  // --- Editing ------------------------------------------------------------

  private renderEditor(p: ParagraphInfo): HTMLElement {
    const s = this.session!;
    const state = this.stateOf(p);
    const box = el('div', 'editor');
    const area = el('textarea');
    area.value = state.text ?? p.text;
    area.setAttribute('aria-label', `Edit paragraph ${p.index + 1}`);
    const error = el('div', 'editor-error');
    error.textContent = this.editorError ?? '';
    error.hidden = !this.editorError;

    const save = () => {
      const text = area.value;
      const edit: Edit | null =
        text === p.text ? null : { type: 'replaceText', part: s.docx.mainPath, paraIndex: p.index, paraHash: p.hash, text };
      this.finishEdit(this.setContentEdit(p, edit));
    };
    const actions = el('div', 'editor-actions');
    actions.append(
      button('Save', save, 'primary', 'Save (⌘/Ctrl+Enter)'),
      button('Cancel', () => this.finishEdit(null)),
      el('span', 'spacer'),
      button('Insert paragraph after', () => {
        const edits: Edit[] = [
          ...s.edits,
          { type: 'insertParagraph', part: s.docx.mainPath, afterIndex: p.index, anchorHash: p.hash, text: '', format: 'anchor' },
        ];
        this.editing = { kind: 'insert', editIndex: edits.length - 1 };
        this.setEdits(edits);
      }),
      button(state.deleted ? 'Restore paragraph' : 'Delete paragraph', () => {
        const edit: Edit | null = state.deleted ? null : { type: 'deleteParagraph', part: s.docx.mainPath, paraIndex: p.index, paraHash: p.hash };
        this.finishEdit(this.setContentEdit(p, edit));
      }, 'danger'),
    );
    if (state.text !== undefined) actions.append(button('Revert to original', () => this.finishEdit(this.setContentEdit(p, null))));

    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
      if (e.key === 'Escape') this.finishEdit(null);
    });
    box.append(area, error, actions);
    requestAnimationFrame(() => {
      autosize(area);
      area.focus();
    });
    area.addEventListener('input', () => autosize(area));
    return box;
  }

  private renderInsertEditor(_p: ParagraphInfo, editIndex: number): HTMLElement {
    const s = this.session!;
    const edit = s.edits[editIndex];
    const box = el('div', 'editor inserting');
    if (!edit || edit.type !== 'insertParagraph') return box;
    const area = el('textarea');
    area.value = edit.text;
    area.placeholder = 'Text of the new paragraph';
    let format = edit.format;
    const remove = () => {
      this.editing = null;
      this.setEdits(s.edits.filter((_, i) => i !== editIndex));
    };
    const save = () => {
      if (!area.value.trim()) return remove();
      this.editing = null;
      this.setEdits(s.edits.map((e, i) => (i === editIndex ? { ...edit, text: area.value, format } : e)));
    };
    const formatLabel = el('label', 'format');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = format === 'anchor';
    check.addEventListener('change', () => (format = check.checked ? 'anchor' : 'plain'));
    formatLabel.append(check, ' Match formatting of the paragraph above');

    const actions = el('div', 'editor-actions');
    actions.append(
      button('Save', save, 'primary'),
      button('Cancel', () => (edit.text ? this.finishEdit(null) : remove())),
      el('span', 'spacer'),
      formatLabel,
      button('Remove', remove, 'danger'),
    );
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
      if (e.key === 'Escape') (edit.text ? this.finishEdit(null) : remove());
    });
    box.append(area, actions);
    requestAnimationFrame(() => {
      autosize(area);
      area.focus();
    });
    area.addEventListener('input', () => autosize(area));
    return box;
  }

  /**
   * Leaving the editor of a proposed paragraph that is still empty discards
   * it, so abandoned "Insert paragraph after" clicks don't reach the export.
   * Returns the removed edit's index.
   */
  private discardEmptyInsert(): number | null {
    const s = this.session;
    const e = this.editing;
    if (!s || e?.kind !== 'insert') return null;
    const edit = s.edits[e.editIndex];
    if (edit?.type !== 'insertParagraph' || edit.text.trim()) return null;
    this.editing = null;
    s.edits = s.edits.filter((_, i) => i !== e.editIndex);
    void this.saveDraft();
    this.rescan();
    this.renderFindings();
    return e.editIndex;
  }

  private finishEdit(error: string | null): void {
    this.editorError = error;
    if (!error) this.editing = null;
    this.renderMain();
  }

  // --- Export -------------------------------------------------------------

  private async export(kind: 'tracked' | 'clean' | 'original' | 'report'): Promise<void> {
    const s = this.session;
    if (!s) return;
    await this.saveDraft();
    const base = s.record.name.replace(/\.docx$/i, '');
    try {
      if (kind === 'original') {
        download(await this.store.getOriginal(s.record.id), s.record.name, DOCX_TYPE);
      } else if (kind === 'report') {
        download(new TextEncoder().encode(this.reportHtml()), `${base} (review report).html`, 'text/html');
      } else {
        const bytes = exportDocx(s.docx, s.edits, this.revisionOptions(kind));
        download(bytes, `${base} (${kind === 'tracked' ? 'redline' : 'clean'}).docx`, DOCX_TYPE);
      }
    } catch (err) {
      this.toast(`Export failed: ${(err as Error).message}`);
    }
  }

  private reportHtml(): string {
    const s = this.session!;
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = s.scan.findings
      .map((f) => {
        const st = s.review.statuses[f.fingerprint];
        return `<tr><td>${esc(f.severity)}</td><td>${esc(f.title)}<br><small>${esc(f.ruleId)}</small></td><td>${esc(f.excerpt || '—')}</td><td>${esc(st?.status.replace('_', ' ') ?? 'open')}${st?.note ? `<br><small>${esc(st.note)}</small>` : ''}</td></tr>`;
      })
      .join('');
    const resolved = Object.entries(s.review.statuses).filter(([fp]) => !s.scan.findings.some((f) => f.fingerprint === fp));
    return `<!doctype html><meta charset="utf-8"><title>Review report: ${esc(s.record.name)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 16px;color:#1d2330}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d7dbe0;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f4f6}small{color:#646d7c}</style>
<h1>Review report</h1>
<p><strong>${esc(s.record.name)}</strong> · reviewed ${new Date().toLocaleString()} by ${esc(this.revisionOptions('tracked').author)}<br>
Rulepack: ${esc(this.pack.name)} ${esc(this.pack.version)} · Perspective: ${esc(s.review.profile.perspective.replace('_', ' '))} · Type: ${esc(s.review.profile.documentType.toUpperCase())}<br>
${s.edits.length} proposed change(s); ${resolved.length} finding(s) resolved by edits no longer appear below.</p>
<table><tr><th>Severity</th><th>Finding</th><th>Text</th><th>Status</th></tr>${rows || '<tr><td colspan="4">No open findings.</td></tr>'}</table>
<p><small>Rule-based flags surface wording for human review; they are not legal advice.</small></p>`;
  }

  // --- Rendering ----------------------------------------------------------

  private renderAll(): void {
    this.renderMain();
    this.renderFindings();
  }

  private renderSidebar(): void {
    const side = this.$('#sidebar');
    side.innerHTML = '';

    const docsHead = el('h2');
    docsHead.textContent = 'Documents';
    side.append(docsHead);
    if (this.documents.length === 0) {
      const empty = el('p', 'muted small');
      empty.textContent = 'Nothing imported yet.';
      side.append(empty);
    }
    const list = el('ul', 'doc-list');
    for (const d of this.documents) {
      const li = el('li');
      if (d.id === this.session?.record.id) li.classList.add('active');
      const open = el('button', 'doc-open');
      const name = el('span', 'name');
      name.textContent = d.name;
      const meta = el('span', 'meta');
      meta.textContent = `${new Date(d.importedAt).toLocaleDateString()} · ${formatBytes(d.size)}`;
      open.append(name, meta);
      open.addEventListener('click', () => void this.openDocument(d.id));
      li.append(open, button('×', () => void this.deleteDocument(d), 'icon', `Delete ${d.name}`));
      list.append(li);
    }
    side.append(list);

    const s = this.session;
    if (s) {
      const head = el('h2');
      head.textContent = 'Versions';
      const status = el('p', 'muted small');
      status.id = 'draft-status';
      status.textContent = draftStatus(s);
      side.append(head, status, button('Save version', () => void this.saveVersion(), 'full'));
      const vlist = el('ul', 'version-list');
      for (const v of [...s.versions].reverse()) {
        const li = el('li');
        const label = el('span', 'name');
        label.textContent = v.label;
        const meta = el('span', 'meta');
        meta.textContent = `${new Date(v.createdAt).toLocaleString()} · ${v.edits.length} change${v.edits.length === 1 ? '' : 's'}`;
        const info = el('div');
        info.append(label, meta);
        li.append(info, button('Restore', () => void this.restoreVersion(v), 'small'), button('×', () => void this.deleteVersion(v), 'icon', `Delete ${v.label}`));
        vlist.append(li);
      }
      side.append(vlist);
    }

    const storage = el('p', 'muted small storage');
    storage.id = 'storage';
    side.append(storage);
  }

  private async renderStorage(): Promise<void> {
    const est = await storageEstimate();
    const node = this.root.querySelector('#storage');
    if (est && node) node.textContent = `Stored in this browser only · ${formatBytes(est.usage)} used`;
  }

  private renderFindings(): void {
    const panel = this.$('#findings');
    const s = this.session;
    const show = !!s && !this.comparison;
    panel.hidden = !show;
    this.root.querySelector('.app')!.classList.toggle('has-findings', show);
    this.root.querySelector('.app')!.classList.toggle('comparing', !!this.comparison);
    if (!s || !show) return;
    const scroll = panel.scrollTop;
    panel.innerHTML = '';
    panel.append(
      renderFindingsPanel(
        {
          result: s.scan,
          statusOf: (fp) => this.statusOf(fp),
          selected: this.selected,
          filter: this.filter,
          profile: s.review.profile,
          templates: new Map(this.pack.templates.map((t) => [t.id, t])),
          applyError: this.applyError,
          packName: this.pack.name,
        },
        {
          onSelect: (fp) => this.selectFinding(fp),
          onStatus: (fp, st) => void this.setStatus(fp, st),
          onFilter: (f) => {
            this.filter = f;
            this.renderFindings();
          },
          onProfile: (p) => void this.setProfile(p),
          onApply: (f, t, v) => this.applyTemplate(f, t, v),
          onOpenRules: () => this.openRules(),
        },
      ),
    );
    panel.scrollTop = scroll;
  }

  private renderMain(): void {
    const main = this.$('#main');
    const s = this.session;
    this.$<HTMLButtonElement>('#export').disabled = !s;
    const scroll = main.scrollTop;
    main.innerHTML = '';

    if (!s) {
      main.append(this.welcome());
      return;
    }
    if (this.comparison) {
      main.append(this.renderComparison(this.comparison));
      main.scrollTop = scroll;
      return;
    }

    const bar = el('div', 'review-bar');
    const name = el('strong');
    name.textContent = s.record.name;
    const changes = s.edits.length;
    bar.append(
      name,
      ` · ${changes ? `${changes} proposed change${changes === 1 ? '' : 's'}` : 'click any paragraph to edit it'}`,
      el('span', 'spacer'),
      button('Compare with…', () => this.openCompare(), 'small', 'Compare this document side by side with another draft'),
    );
    main.append(bar);

    main.append(
      renderPart(s.docx.main, {
        stateOf: (p) => this.stateOf(p),
        marksFor: (id) => this.marksFor(id),
        isEditing: (p) => this.editing?.kind === 'paragraph' && this.editing.index === p.index,
        isEditingInsert: (id) => this.editing?.kind === 'insert' && this.editing.editIndex === id,
        renderEditor: (p) => this.renderEditor(p),
        renderInsertEditor: (p, id) => this.renderInsertEditor(p, id),
        onSelect: (p) => {
          this.discardEmptyInsert();
          this.editorError = null;
          this.editing = { kind: 'paragraph', index: p.index };
          this.renderMain();
        },
        onSelectInsert: (_p, id) => {
          const removed = this.discardEmptyInsert();
          if (removed === id) return this.renderMain();
          this.editing = { kind: 'insert', editIndex: removed !== null && removed < id ? id - 1 : id };
          this.renderMain();
        },
        onSelectFinding: (fp) => this.selectFinding(fp),
      }),
    );
    main.scrollTop = scroll;
  }

  private welcome(): HTMLElement {
    const box = el('section', 'welcome');
    box.innerHTML = `
      <div class="drop-target">
        <div class="big">Drop a Word contract here</div>
        <p>or use <strong>Import .docx</strong> above. Files never leave this browser.</p>
      </div>
      <p class="muted">The rules engine flags risky and missing provisions. Fix them with approved language or your own edits, then export a Word document with tracked changes. Only the paragraphs you change are touched.</p>`;
    const sample = button('Try the sample contract', () => void this.importSample(), 'primary');
    box.querySelector('.drop-target')!.append(sample);
    return box;
  }

  private toast(message: string): void {
    const t = this.$('#toast');
    t.textContent = message;
    t.hidden = false;
    window.clearTimeout(Number(t.dataset.timer));
    t.dataset.timer = String(window.setTimeout(() => (t.hidden = true), 4000));
  }
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A starting review profile, guessed from the title and the parties' defined terms. */
export function guessProfile(record: DocumentRecord, docx: OpenedDocx): ReviewProfile {
  const opening = docx.main.paragraphs.slice(0, 3).map((p) => p.text).join(' ');
  // The title decides; the opening text only breaks ties, because an SOW's
  // first sentence usually names the MSA that governs it.
  const title = `${record.name} ${docx.main.paragraphs.find((p) => p.text.trim())?.text ?? ''}`.toLowerCase();
  const typeOf = (text: string): ReviewProfile['documentType'] | null =>
    /statement of work|\bsow\b/.test(text)
      ? 'sow'
      : /non-?disclosure|confidentiality agreement|\bnda\b/.test(text)
        ? 'nda'
        : /master (services |service |consulting )?agreement|\bmsa\b/.test(text)
          ? 'msa'
          : null;
  const documentType = typeOf(title) ?? typeOf(opening.toLowerCase()) ?? 'msa';
  const perspective = documentType === 'nda' ? 'mutual' : 'service_provider';

  // Defined party terms such as (the “Customer”) or ("Provider").
  const terms = [...opening.matchAll(/\((?:the\s+)?[“"]([A-Z][\w ]{1,30})[”"]\)/g)].map((m) => m[1]!);
  const variables: Record<string, string> = {};
  const provider = terms.find((t) => /provider|vendor|supplier|consultant|contractor|seller/i.test(t));
  const customer = terms.find((t) => /customer|client|buyer|purchaser|company/i.test(t) && t !== provider);
  if (provider) variables.COMPANY_NAME = provider;
  if (customer) variables.COUNTERPARTY = customer;
  return { documentType, perspective, variables };
}

function draftStatus(s: Session): string {
  return s.savedAt ? `Working draft autosaved ${s.savedAt.toLocaleTimeString()}` : 'Working draft (no changes yet)';
}

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit'].includes(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function autosize(area: HTMLTextAreaElement): void {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function download(bytes: Uint8Array, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type }));
  const a = el('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; ignore storage being unavailable.
  }
}
