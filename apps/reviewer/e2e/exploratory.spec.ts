// Exploratory scenarios: the edges of the UI that unit tests can't reach.

import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openDocx } from '@docugoat/docx/document';
import { partTexts } from '@docugoat/docx/paragraphs';
import { buildDocx, kitchenSink } from '../tests/fixtures/docx-builder.ts';

const SAMPLE = readFileSync('public/samples/sample-msa.docx');
const NDA = readFileSync('tests/fixtures/corpus/pydocx-nda.docx');
const SOW = readFileSync('tests/fixtures/corpus/pydocx-sow.docx');

async function drop(page: Page, files: Array<[string, Uint8Array]>) {
  await page.locator('.topbar').waitFor(); // the app has started and installed its drop handler
  await page.evaluate((list) => {
    const dt = new DataTransfer();
    for (const [name, data] of list) dt.items.add(new File([new Uint8Array(data)], name));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
  }, files.map(([n, b]) => [n, [...b]] as [string, number[]]));
}

async function download(page: Page, label: string): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export ▾' }).click();
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
  return readFileSync((await d.path())!);
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'v1' : undefined));
  page.on('pageerror', (e) => {
    throw new Error(`Uncaught page error: ${e.message}`);
  });
  await page.goto('/');
});

test('imports several files at once and switches between them', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE], ['NDA.docx', NDA], ['SOW.docx', SOW]]);
  await expect(page.locator('.doc-list li')).toHaveCount(3);
  await expect(page.locator('.review-bar strong')).toHaveText('SOW.docx');
  await expect(page.locator('.profile summary')).toContainText('SOW');
  await expect(page.locator('#findings')).toContainText('Set-off / withholding');
  await expect(page.locator('#findings')).toContainText('High insurance limits');

  await page.locator('.doc-open', { hasText: 'NDA.docx' }).click();
  await expect(page.locator('.profile summary')).toContainText('Mutual · NDA');
  const panel = page.locator('#findings');
  await expect(panel).toContainText('Residuals clause');
  await expect(panel).toContainText('Perpetual confidentiality');
  await expect(panel.locator('.finding', { hasText: 'Missing standard exclusions' })).toContainText('Incomplete');
  await expect(panel).not.toContainText('No limitation of liability'); // MSA/SOW-only rule
});

test('deleting the open document returns to the start screen cleanly', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE]]);
  await page.locator('#search').fill('customer');
  await page.getByRole('button', { name: 'Delete MSA.docx' }).click();
  await expect(page.getByText('Drop a Word contract here')).toBeVisible();
  await expect(page.locator('#search')).toBeDisabled();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#search-count')).toHaveText('');
  await expect(page.locator('#findings')).toBeHidden();
});

test('search results stay correct after an edit removes matches', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE]]);
  await page.locator('#search').fill('competitor');
  await expect(page.locator('#search-count')).toHaveText('1 of 1');
  await page.locator('.para', { hasText: 'competitor of Customer' }).click({ position: { x: 5, y: 5 } });
  const area = page.locator('.editor textarea');
  await area.fill((await area.inputValue()).replace('competitor', 'person'));
  await area.press('Control+Enter');
  await expect(page.locator('#search-count')).toHaveText('No matches');
});

test('abandoned empty paragraphs are discarded', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE]]);
  await page.locator('.para', { hasText: 'All work product' }).click({ position: { x: 5, y: 5 } });
  await page.getByRole('button', { name: 'Insert paragraph after' }).click();
  await expect(page.locator('.editor.inserting')).toBeVisible();
  await page.locator('.para', { hasText: /^MASTER SERVICES AGREEMENT$/ }).click();
  await expect(page.locator('.proposed-insert')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('.para', { hasText: 'All work product' }).click({ position: { x: 5, y: 5 } });
  await page.getByRole('button', { name: 'Insert paragraph after' }).click();
  await page.locator('.editor.inserting textarea').press('Escape');
  await expect(page.locator('.proposed-insert')).toHaveCount(0);
  await expect(page.locator('.review-bar')).not.toContainText('proposed change');
});

test('delete and restore a paragraph', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE]]);
  const para = page.locator('.para', { hasText: 'IN WITNESS WHEREOF' });
  await para.click();
  await page.getByRole('button', { name: 'Delete paragraph' }).click();
  await expect(page.locator('.para.proposed-delete')).toContainText('IN WITNESS WHEREOF');
  await page.locator('.para.proposed-delete').click();
  await page.getByRole('button', { name: 'Restore paragraph' }).click();
  await expect(page.locator('.para.proposed-delete')).toHaveCount(0);
});

test('review decisions and profile survive a reload', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE]]);
  const panel = page.locator('#findings');
  await panel.locator('.finding-head', { hasText: 'Broad audit rights' }).or(panel.locator('.finding-head', { hasText: 'Implied services' })).first().click();
  await panel.getByRole('button', { name: 'Accept risk' }).click();
  await panel.locator('.profile summary').click();
  await panel.getByLabel('Our company').fill('Provider LLC');
  await panel.getByLabel('Our company').press('Tab');
  await page.waitForTimeout(300); // let IndexedDB commit; a person can't reload faster than this

  await page.reload();
  await page.locator('.doc-open', { hasText: 'MSA.docx' }).click();
  await panel.getByRole('button', { name: /^All/ }).click();
  await expect(panel.locator('.finding', { hasText: 'Implied services' })).toContainText('Risk accepted');
  await panel.locator('.profile summary').click();
  await expect(panel.getByLabel('Our company')).toHaveValue('Provider LLC');

  // Switching the agreement type re-runs the rules.
  await panel.getByLabel('Agreement type').selectOption('nda');
  await expect(panel).not.toContainText('No limitation of liability');
  await expect(panel).toContainText('Missing standard exclusions');
});

test('rulepack import: bad files are refused, good ones replace the rules', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE]]);
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  const dialog = page.locator('dialog');
  const input = dialog.locator('input[type=file]');

  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nope"}') });
  await expect(page.locator('#toast')).toContainText('Rulepack not imported');

  const pack = {
    format: 'contract-reviewer.rulepack', formatVersion: 1, id: 'custom', name: 'Custom pack', version: '1.0.0',
    rules: [{
      id: 'CUSTOM-1', version: 1, name: 'Mentions retainer', category: 'Custom', enabled: true, severity: 'low', type: 'presence',
      match: { phrase: 'monthly retainer' }, review: { title: 'Retainer mentioned', message: 'Check the retainer.' },
      tests: { shouldMatch: ['Monthly retainer'], shouldNotMatch: ['Hourly fees'] },
    }],
    templates: [],
  };
  await input.setInputFiles({ name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
  await expect(dialog.locator('h2')).toHaveText('Custom pack');
  await dialog.getByRole('button', { name: 'Close' }).click();
  const panel = page.locator('#findings');
  await expect(panel.locator('.finding')).toHaveCount(1);
  await expect(panel).toContainText('Retainer mentioned');

  await page.reload();
  await page.locator('.doc-open').click();
  await expect(panel).toContainText('Retainer mentioned');

  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await dialog.getByRole('button', { name: 'Reset to sample' }).click();
  await expect(dialog.locator('h2')).toHaveText('Sample commercial playbook');
});

test('document text is never interpreted as HTML', async ({ page }) => {
  const evil = '&lt;img src=x onerror="window.__xss=1"&gt;&lt;script&gt;window.__xss=2&lt;/script&gt; Provider shall not provide services to any competitor.';
  const bytes = buildDocx({ body: `<w:p><w:r><w:t xml:space="preserve">${evil}</w:t></w:r></w:p>` });
  await drop(page, [['<b>evil</b>.docx', bytes]]);
  await expect(page.locator('.review-bar strong')).toHaveText('<b>evil</b>.docx');
  await expect(page.locator('.page')).toContainText('<img src=x onerror="window.__xss=1">');
  await expect(page.locator('.page img, .page script')).toHaveCount(0);
  const report = (await download(page, 'Review report (.html)')).toString();
  expect(report).not.toContain('<img src=x');
  expect(report).toContain('&lt;b&gt;evil&lt;/b&gt;.docx');
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test('keyboard-only editing', async ({ page }) => {
  await drop(page, [['MSA.docx', SAMPLE]]);
  await page.locator('.para', { hasText: 'Signed and sealed' }).focus();
  await page.keyboard.press('Enter');
  const area = page.locator('.editor textarea');
  await expect(area).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' Witnessed.');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.para.edited .ins')).toContainText('Witnessed');
  await page.locator('.para', { hasText: /^MASTER SERVICES AGREEMENT$/ }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('.editor')).toHaveCount(0);
});

test('works at phone width without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await drop(page, [['MSA.docx', SAMPLE]]);
  await expect(page.locator('#findings .finding').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('emoji and complex structures edit and export correctly', async ({ page }) => {
  await drop(page, [['sink.docx', kitchenSink()]]);
  await page.locator('.para', { hasText: 'Fees 💰' }).click();
  const area = page.locator('.editor textarea');
  await area.fill('Fees 💰 are due 🗓️ within 𝟒𝟓 days.');
  await area.press('Control+Enter');
  const out = openDocx(await download(page, 'Tracked changes (.docx)')).main;
  expect(partTexts(out, 'accepted')[0]).toBe('Fees 💰 are due 🗓️ within 𝟒𝟓 days.');
  expect(partTexts(out, 'rejected')).toEqual(partTexts(openDocx(kitchenSink()).main, 'rejected'));
});

test('a long contract imports, scans and re-scans quickly', async ({ page }) => {
  // Shared CI runners are 2-3x slower than a dev machine, and run several browsers at once.
  const slack = process.env.CI ? 2.5 : 1;
  const para = (i: number) => `<w:p><w:r><w:t xml:space="preserve">${i}. Provider shall not provide services to any competitor of Customer, and Customer shall pay all invoices within ninety (90) days of receipt. Customer may audit all books and records at any time.</w:t></w:r></w:p>`;
  const body = Array.from({ length: 1500 }, (_, i) => (i % 25 === 0 ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Section ${i}</w:t></w:r></w:p>` : para(i))).join('');
  const bytes = buildDocx({ body });

  const t0 = Date.now();
  await drop(page, [['long.docx', bytes]]);
  await expect(page.locator('#findings .finding').first()).toBeVisible({ timeout: 8000 * slack });
  const importMs = Date.now() - t0;

  await page.locator('.para', { hasText: /^1\. Provider/ }).click({ position: { x: 5, y: 5 } });
  const t1 = Date.now();
  await page.locator('.editor textarea').fill('1. Provider may serve anyone.');
  await page.locator('.editor textarea').press('Control+Enter');
  await expect(page.locator('.para.edited')).toHaveCount(1);
  const editMs = Date.now() - t1;
  console.log(`PERF long contract: import+scan+render ${importMs} ms, edit+rescan+render ${editMs} ms`);
  expect(importMs).toBeLessThan(8000 * slack);
  expect(editMs).toBeLessThan(3000 * slack);
});

test('corrupted files show a clear error', async ({ page }) => {
  const bytes = new Uint8Array(SAMPLE).slice(0, 2000);
  await drop(page, [['broken.docx', bytes]]);
  await expect(page.locator('#toast')).toContainText('broken.docx');
  await expect(page.getByText('Drop a Word contract here')).toBeVisible();
});
