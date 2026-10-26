// The findings panel: summary, review settings, finding list and details.

import { fillTemplate, templateVariables } from '@docugoat/rules/playbook';
import type { ClauseTemplate, DocumentType, Finding, Perspective, ScanResult, Severity } from '@docugoat/rules/types';
import type { FindingStatus, ReviewProfile } from '../storage/store.ts';
import { el } from './render.ts';

export interface FindingsView {
  result: ScanResult;
  statusOf(fingerprint: string): FindingStatus;
  selected: string | null;
  filter: 'open' | 'all';
  profile: ReviewProfile;
  templates: Map<string, ClauseTemplate>;
  applyError: string | null;
  packName: string;
}

export interface FindingsCallbacks {
  onSelect(fingerprint: string | null): void;
  onStatus(fingerprint: string, status: FindingStatus): void;
  onFilter(filter: 'open' | 'all'): void;
  onProfile(profile: ReviewProfile): void;
  onApply(finding: Finding, template: ClauseTemplate, variables: Record<string, string>): void;
  onOpenRules(): void;
}

const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low', 'info'];
const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  accepted_risk: 'Risk accepted',
  dismissed: 'Dismissed',
  escalated: 'Escalated',
};
const DOC_TYPES: Array<[DocumentType, string]> = [['msa', 'MSA'], ['sow', 'SOW'], ['nda', 'NDA'], ['other', 'Other']];
const PERSPECTIVES: Array<[Perspective, string]> = [
  ['service_provider', 'Service provider'],
  ['customer', 'Customer'],
  ['discloser', 'Discloser'],
  ['recipient', 'Recipient'],
  ['mutual', 'Mutual'],
];

export const isActionable = (s: FindingStatus) => s === 'open' || s === 'escalated';

export function renderFindingsPanel(view: FindingsView, cb: FindingsCallbacks): HTMLElement {
  const panel = el('div', 'findings-inner');
  const { findings, errors } = view.result;
  const actionable = findings.filter((f) => isActionable(view.statusOf(f.fingerprint)));

  // Summary
  const summary = el('div', 'summary');
  for (const sev of ['high', 'medium', 'low'] as const) {
    const n = actionable.filter((f) => f.kind !== 'absence' && f.severity === sev).length;
    summary.append(stat(String(n), sev === 'high' ? 'High' : sev === 'medium' ? 'Medium' : 'Low', `sev-${sev}`));
  }
  summary.append(stat(String(actionable.filter((f) => f.kind === 'absence').length), 'Missing', 'sev-missing'));
  panel.append(summary);

  panel.append(profileSection(view.profile, cb));

  const toolbar = el('div', 'findings-toolbar');
  const filter = el('div', 'segmented');
  for (const [value, label] of [['open', `Open (${actionable.length})`], ['all', `All (${findings.length})`]] as const) {
    const b = button(label, () => cb.onFilter(value), view.filter === value ? 'seg active' : 'seg');
    b.setAttribute('aria-pressed', String(view.filter === value));
    filter.append(b);
  }
  const rules = button(`Rules: ${view.packName}`, () => cb.onOpenRules(), 'link-btn');
  rules.title = 'Manage rules and approved language';
  toolbar.append(filter, rules);
  panel.append(toolbar);

  for (const e of errors) {
    const warn = el('div', 'notice error');
    warn.textContent = `Rule ${e.ruleId} could not run: ${e.message}`;
    panel.append(warn);
  }

  const shown = view.filter === 'open' ? actionable : findings;
  const flagged = shown.filter((f) => f.kind !== 'absence');
  const missing = shown.filter((f) => f.kind === 'absence');

  if (shown.length === 0) {
    const empty = el('p', 'muted empty-state');
    empty.textContent = findings.length ? 'All findings have been handled.' : 'No issues found by the enabled rules.';
    panel.append(empty);
  }

  if (flagged.length) {
    panel.append(heading('Flagged language'));
    const sorted = [...flagged].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
    panel.append(findingList(sorted, view, cb));
  }
  if (missing.length) {
    panel.append(heading('Missing provisions'));
    panel.append(findingList(missing, view, cb));
  }

  const located = view.result.coverage.filter((c) => c.state === 'located');
  if (located.length) {
    const details = el('details', 'coverage');
    const sum = el('summary');
    sum.textContent = `Provisions located (${located.length})`;
    details.append(sum);
    const ul = el('ul');
    for (const c of located) {
      const li = el('li');
      li.textContent = `✓ ${c.title.replace(/^No /, '')}`;
      ul.append(li);
    }
    details.append(ul);
    panel.append(details);
  }

  const disclaimer = el('p', 'muted small disclaimer');
  disclaimer.textContent = 'Rule-based flags surface wording for human review; they are not legal advice.';
  panel.append(disclaimer);
  return panel;
}

function findingList(findings: Finding[], view: FindingsView, cb: FindingsCallbacks): HTMLElement {
  const ul = el('ul', 'finding-list');
  for (const f of findings) {
    const status = view.statusOf(f.fingerprint);
    const selected = view.selected === f.fingerprint;
    const li = el('li', `finding sev-${f.severity}${selected ? ' selected' : ''}${isActionable(status) ? '' : ' handled'}`);
    li.dataset.finding = f.fingerprint;

    const head = el('button', 'finding-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(selected));
    const pill = el('span', `pill sev-${f.kind === 'absence' ? 'missing' : f.severity}`);
    pill.textContent = f.kind === 'absence' ? (f.coverage === 'possibly_incomplete' ? 'Incomplete' : 'Missing') : f.severity;
    const title = el('span', 'finding-title');
    title.textContent = f.title;
    head.append(pill, title);
    if (status !== 'open') {
      const badge = el('span', `status status-${status}`);
      badge.textContent = STATUS_LABEL[status];
      head.append(badge);
    }
    if (!selected && f.excerpt) {
      const ex = el('span', 'finding-excerpt');
      ex.textContent = f.excerpt;
      head.append(ex);
    }
    head.addEventListener('click', () => cb.onSelect(selected ? null : f.fingerprint));
    li.append(head);
    if (selected) li.append(findingDetails(f, status, view, cb));
    ul.append(li);
  }
  return ul;
}

function findingDetails(f: Finding, status: FindingStatus, view: FindingsView, cb: FindingsCallbacks): HTMLElement {
  const box = el('div', 'finding-details');
  const msg = el('p');
  msg.textContent = f.message;
  box.append(msg);

  if (f.excerpt) {
    const q = el('blockquote');
    q.textContent = f.excerpt;
    box.append(q);
  }

  const meta = el('div', 'meta-row');
  const rule = el('code');
  rule.textContent = f.ruleId;
  meta.append(rule, ` · ${f.category}`);
  box.append(meta);
  if (f.matchedTerms.length) {
    const terms = el('div', 'terms');
    terms.append('Matched ');
    for (const t of f.matchedTerms) {
      const chip = el('span', 'chip');
      chip.textContent = t;
      terms.append(chip);
    }
    box.append(terms);
  }

  const actions = el('div', 'status-actions');
  const set = (s: FindingStatus) => () => cb.onStatus(f.fingerprint, s);
  if (isActionable(status)) {
    actions.append(
      button('Resolve', set('resolved'), 'small'),
      button('Accept risk', set('accepted_risk'), 'small'),
      button('Dismiss', set('dismissed'), 'small'),
    );
    if (status !== 'escalated') actions.append(button('Escalate', set('escalated'), 'small'));
    else actions.append(button('Clear escalation', set('open'), 'small'));
  } else {
    actions.append(button('Reopen', set('open'), 'small'));
  }
  box.append(actions);

  const templates = f.templateIds.map((id) => view.templates.get(id)).filter((t): t is ClauseTemplate => !!t);
  if (templates.length) {
    const h = el('h4');
    h.textContent = 'Approved language';
    box.append(h);
    if (view.applyError) {
      const err = el('div', 'notice error');
      err.textContent = view.applyError;
      box.append(err);
    }
    for (const t of templates) box.append(templateCard(f, t, view, cb));
  }
  return box;
}

function templateCard(f: Finding, t: ClauseTemplate, view: FindingsView, cb: FindingsCallbacks): HTMLElement {
  const card = el('div', 'template');
  const head = el('div', 'template-head');
  const pos = el('span', `pos pos-${t.position}`);
  pos.textContent = t.position.replace('_', ' ');
  const title = el('strong');
  title.textContent = t.title;
  head.append(pos, title);
  if (t.sample) {
    const sample = el('span', 'sample-badge');
    sample.textContent = 'Sample text';
    sample.title = 'Illustrative language, not company-approved';
    head.append(sample);
  }
  card.append(head);
  if (t.explanation) {
    const ex = el('p', 'muted small');
    ex.textContent = t.explanation;
    card.append(ex);
  }

  const values: Record<string, string> = { ...view.profile.variables };
  const preview = el('p', 'template-text');
  const update = () => {
    preview.textContent = '';
    if (!t.text) {
      preview.textContent = describeAction(t, f);
      preview.classList.add('muted');
      return;
    }
    // Show filled values, and highlight placeholders still missing.
    const filled = fillTemplate(t.text, values).text;
    for (const part of filled.split(/(\{\{\s*[A-Z0-9_]+\s*\}\})/)) {
      if (/^\{\{/.test(part)) {
        const v = el('span', 'var-missing');
        v.textContent = part.replace(/[{}\s]/g, '');
        preview.append(v);
      } else preview.append(part);
    }
  };

  const vars = templateVariables(t.text);
  const missing = vars.filter((v) => !view.profile.variables[v]?.trim());
  if (missing.length) {
    const form = el('div', 'var-form');
    for (const v of missing) {
      const label = el('label');
      label.append(humanize(v));
      const input = el('input');
      input.type = 'text';
      input.addEventListener('input', () => {
        values[v] = input.value;
        update();
      });
      label.append(input);
      form.append(label);
    }
    card.append(form);
  }
  update();
  card.append(preview);

  const where = el('p', 'muted small');
  where.textContent = describeAction(t, f);
  const apply = button('Apply as redline', () => {
    const { missing: still } = fillTemplate(t.text, values);
    if (still.length) {
      preview.classList.add('shake');
      setTimeout(() => preview.classList.remove('shake'), 400);
      return;
    }
    cb.onApply(f, t, values);
  }, 'primary small');
  const row = el('div', 'template-actions');
  row.append(where, apply);
  card.append(row);
  return card;
}

function describeAction(t: ClauseTemplate, f: Finding): string {
  switch (t.action) {
    case 'replaceSentence': return 'Replaces the flagged sentence.';
    case 'replaceParagraph': return 'Replaces the flagged paragraph.';
    case 'deleteSentence': return 'Deletes the flagged sentence.';
    case 'deleteParagraph': return 'Deletes the flagged paragraph.';
    case 'appendToParagraph': return 'Adds to the end of the flagged paragraph.';
    case 'insertAfter': return f.hits.length || f.unit.length ? 'Inserts a new paragraph after the flagged one.' : 'Inserts a new paragraph before the signature block.';
  }
}

function profileSection(profile: ReviewProfile, cb: FindingsCallbacks): HTMLElement {
  const details = el('details', 'profile');
  const summary = el('summary');
  const type = DOC_TYPES.find(([v]) => v === profile.documentType)?.[1] ?? '';
  const persp = PERSPECTIVES.find(([v]) => v === profile.perspective)?.[1] ?? '';
  summary.textContent = `Review as ${persp} · ${type}`;
  details.append(summary);

  const grid = el('div', 'profile-grid');
  const change = (patch: Partial<ReviewProfile>) => cb.onProfile({ ...profile, ...patch, variables: { ...profile.variables, ...patch.variables } });
  grid.append(
    select('Agreement type', DOC_TYPES, profile.documentType, (v) => change({ documentType: v as DocumentType })),
    select('Our perspective', PERSPECTIVES, profile.perspective, (v) => change({ perspective: v as Perspective })),
    text('Our company', profile.variables.COMPANY_NAME ?? '', (v) => change({ variables: { COMPANY_NAME: v } })),
    text('Counterparty', profile.variables.COUNTERPARTY ?? '', (v) => change({ variables: { COUNTERPARTY: v } })),
  );
  details.append(grid);
  return details;
}

function select(label: string, options: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = el('label');
  wrap.append(label);
  const s = el('select');
  for (const [v, l] of options) {
    const o = el('option');
    o.value = v;
    o.textContent = l;
    o.selected = v === value;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  wrap.append(s);
  return wrap;
}

function text(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = el('label');
  wrap.append(label);
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value.trim()));
  wrap.append(input);
  return wrap;
}

function stat(value: string, label: string, className: string): HTMLElement {
  const s = el('div', `stat ${className}`);
  const v = el('strong');
  v.textContent = value;
  const l = el('span');
  l.textContent = label;
  s.append(v, l);
  return s;
}

function heading(text: string): HTMLElement {
  const h = el('h3');
  h.textContent = text;
  return h;
}

function humanize(name: string): string {
  return name.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function button(label: string, onClick: () => void, variant = '', title?: string): HTMLButtonElement {
  const b = el('button', `btn ${variant}`.trim());
  b.type = 'button';
  b.textContent = label;
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
