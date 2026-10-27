// Rule administration: enable/disable rules, run their tests, try them on
// pasted text, edit the rulepack as JSON, import and export.

import { runRuleTests, scan } from '@docugoat/rules/engine';
import type { Rulepack } from '@docugoat/rules/types';
import { parseRulepack } from '@docugoat/rules/validate';
import { button } from './findings.ts';
import { el } from './render.ts';

export interface RulesDialogCallbacks {
  onSave(pack: Rulepack): Promise<void>;
  onReset(): Promise<Rulepack>;
  toast(message: string): void;
}

type Tab = 'rules' | 'test' | 'json';

export function openRulesDialog(initial: Rulepack, cb: RulesDialogCallbacks): void {
  let pack = structuredClone(initial);
  let tab: Tab = 'rules';
  let testText = '';

  const dialog = el('dialog', 'rules-dialog');
  dialog.setAttribute('aria-label', 'Rules and approved language');
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());

  const save = async (next: Rulepack) => {
    pack = next;
    await cb.onSave(structuredClone(next));
    render();
  };

  const render = () => {
    dialog.innerHTML = '';
    const head = el('header', 'dialog-head');
    const title = el('div');
    const h = el('h2');
    h.textContent = pack.name;
    const sub = el('p', 'muted small');
    sub.textContent = `Version ${pack.version} · ${pack.rules.length} rules · ${pack.templates.length} clause templates`;
    title.append(h, sub);

    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const { pack: parsed, errors } = parseRulepack(await f.text());
      if (!parsed) {
        cb.toast(`Rulepack not imported: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
        return;
      }
      await save(parsed);
      cb.toast(`Imported “${parsed.name}”`);
    });

    const actions = el('div', 'dialog-actions');
    actions.append(
      button('Import…', () => file.click()),
      button('Export', () => download(JSON.stringify(pack, null, 2), `${pack.id}-${pack.version}.json`)),
      button('Reset to sample', async () => {
        if (!confirm('Replace the current rulepack with the built-in sample?')) return;
        pack = await cb.onReset();
        render();
      }),
      button('Close', () => dialog.close(), 'primary'),
      file,
    );
    head.append(title, actions);
    dialog.append(head);

    if (pack.description) {
      const d = el('p', 'notice');
      d.textContent = pack.description;
      dialog.append(d);
    }

    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [['rules', 'Rules'], ['test', 'Try on text'], ['json', 'Edit JSON']] as const) {
      const b = button(label, () => {
        tab = id;
        render();
      }, tab === id ? 'tab active' : 'tab');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab === id));
      tabs.append(b);
    }
    dialog.append(tabs);

    const body = el('div', 'dialog-body');
    if (tab === 'rules') body.append(rulesTable(pack, save));
    else if (tab === 'test') body.append(testPanel(pack, testText, (t) => (testText = t)));
    else body.append(jsonEditor(pack, save, cb));
    dialog.append(body);
  };

  render();
  dialog.showModal();
}

function rulesTable(pack: Rulepack, save: (p: Rulepack) => Promise<void>): HTMLElement {
  const wrap = el('div');
  const results = new Map(pack.rules.map((r) => [r.id, safeTests(r)]));
  const failing = [...results.values()].filter((r) => !r.passed).length;
  const summary = el('p', failing ? 'notice error' : 'notice ok');
  summary.textContent = failing
    ? `${failing} rule${failing === 1 ? '' : 's'} failing their built-in tests.`
    : `All ${pack.rules.length} rules pass their built-in tests.`;
  wrap.append(summary);

  const table = el('table', 'rules-table');
  const head = el('tr');
  for (const h of ['On', 'Severity', 'Rule', 'Type', 'Applies to', 'Tests']) {
    const th = el('th');
    th.textContent = h;
    head.append(th);
  }
  table.append(head);
  for (const r of pack.rules) {
    const tr = el('tr');
    const on = el('input');
    on.type = 'checkbox';
    on.checked = r.enabled;
    on.setAttribute('aria-label', `Enable ${r.name}`);
    on.addEventListener('change', () => {
      const next = structuredClone(pack);
      next.rules.find((x) => x.id === r.id)!.enabled = on.checked;
      void save(next);
    });
    const sev = el('span', `pill sev-${r.type === 'absence' ? 'missing' : r.severity}`);
    sev.textContent = r.severity;
    const name = el('div');
    const strong = el('strong');
    strong.textContent = r.name;
    const id = el('code');
    id.textContent = r.id;
    name.append(strong, el('br'), id);
    const res = results.get(r.id)!;
    const tests = el('span', res.passed ? 'test-pass' : 'test-fail');
    tests.textContent = res.passed ? `✓ ${(r.tests?.shouldMatch?.length ?? 0) + (r.tests?.shouldNotMatch?.length ?? 0)}` : '✗ failing';
    if (!res.passed) tests.title = res.failures.map((f) => `Expected ${f.expected}: ${f.text}`).join('\n');
    const applies = [r.appliesTo?.documentTypes?.join(', ').toUpperCase(), r.appliesTo?.reviewPerspective?.join(', ').replace(/_/g, ' ')].filter(Boolean).join(' · ') || 'All';
    for (const content of [on, sev, name, r.type, applies, tests]) {
      const td = el('td');
      td.append(content);
      tr.append(td);
    }
    if (!r.enabled) tr.classList.add('disabled');
    table.append(tr);
  }
  wrap.append(table);
  return wrap;
}

function safeTests(rule: Rulepack['rules'][number]) {
  try {
    return runRuleTests(rule);
  } catch (err) {
    return { ruleId: rule.id, passed: false, failures: [{ expected: 'match' as const, text: (err as Error).message }] };
  }
}

function testPanel(pack: Rulepack, initial: string, remember: (t: string) => void): HTMLElement {
  const wrap = el('div', 'test-panel');
  const help = el('p', 'muted small');
  help.textContent = 'Paste contract language to see which enabled rules trigger. Separate paragraphs with blank lines. Document-type and perspective filters are ignored here.';
  const area = el('textarea');
  area.rows = 6;
  area.value = initial;
  area.placeholder = 'e.g. During the Term, Provider shall not provide services to any competitor of Customer.';
  const out = el('div', 'test-results');
  const run = () => {
    remember(area.value);
    out.innerHTML = '';
    if (!area.value.trim()) return;
    const blocks = area.value.split(/\n\s*\n/).map((text, i) => ({ id: `t${i}`, text }));
    const result = scan(blocks, pack.rules.filter((r) => r.type !== 'absence'));
    if (result.findings.length === 0) {
      out.textContent = 'No rules triggered.';
      return;
    }
    for (const f of result.findings) {
      const item = el('div', 'test-hit');
      const pill = el('span', `pill sev-${f.severity}`);
      pill.textContent = f.severity;
      const t = el('strong');
      t.textContent = ` ${f.title} `;
      const id = el('code');
      id.textContent = f.ruleId;
      const terms = el('div', 'muted small');
      terms.textContent = `Matched: ${f.matchedTerms.join(', ')}`;
      item.append(pill, t, id, terms);
      out.append(item);
    }
  };
  area.addEventListener('input', run);
  wrap.append(help, area, out);
  run();
  return wrap;
}

function jsonEditor(pack: Rulepack, save: (p: Rulepack) => Promise<void>, cb: RulesDialogCallbacks): HTMLElement {
  const wrap = el('div', 'json-editor');
  const area = el('textarea');
  area.spellcheck = false;
  area.value = JSON.stringify(pack, null, 2);
  const errors = el('ul', 'json-errors');
  const status = el('span', 'muted small');
  const validate = () => {
    const { pack: parsed, errors: errs } = parseRulepack(area.value);
    errors.innerHTML = '';
    for (const e of errs.slice(0, 20)) {
      const li = el('li');
      li.textContent = e;
      errors.append(li);
    }
    status.textContent = errs.length ? `${errs.length} problem${errs.length === 1 ? '' : 's'}` : 'Valid';
    return parsed;
  };
  area.addEventListener('input', () => validate());
  const actions = el('div', 'editor-actions');
  actions.append(
    button('Save rulepack', async () => {
      const parsed = validate();
      if (!parsed) return cb.toast('Fix the problems before saving');
      await save(parsed);
      cb.toast('Rulepack saved');
    }, 'primary'),
    status,
  );
  wrap.append(area, actions, errors);
  validate();
  return wrap;
}

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
