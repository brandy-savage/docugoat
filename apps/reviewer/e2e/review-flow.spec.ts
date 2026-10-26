// Drives the built app in a real browser: import, edit, version, reload,
// restore and export, then verifies the downloaded files.

import { expect, test, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openDocx } from '@docugoat/docx/document';
import { partTexts } from '@docugoat/docx/paragraphs';

const SAMPLE = readFileSync('public/samples/sample-msa.docx');

async function dropFile(page: Page, name: string, bytes: Buffer) {
  await page.locator('.topbar').waitFor(); // the app has started and installed its drop handler
  await page.evaluate(
    ({ name, data }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], name));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
    },
    { name, data: [...bytes] },
  );
}

async function exportAs(page: Page, label: string): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export ▾' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
  return readDownload(download);
}

async function readDownload(download: Download): Promise<Buffer> {
  return readFileSync((await download.path())!);
}

// Click near the paragraph's start: a click that lands on a rule highlight
// selects the finding instead, and where highlights fall depends on line wrapping.
async function openEditor(page: Page, contains: string) {
  await page.locator('.para', { hasText: contains }).first().click({ position: { x: 5, y: 5 } });
}

async function editParagraph(page: Page, contains: string, transform: (text: string) => string) {
  await openEditor(page, contains);
  const area = page.locator('.editor textarea');
  await area.fill(transform(await area.inputValue()));
  await page.locator('.editor').getByRole('button', { name: 'Save (⌘/Ctrl+Enter)' }).click();
}

test('import, edit, version, reload, restore and export', async ({ page }) => {
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'First pass' : undefined));
  await page.goto('/');
  await expect(page.getByText('Drop a Word contract here')).toBeVisible();

  await page.locator('#author').fill('E2E Reviewer');
  await page.locator('#author').dispatchEvent('change');

  // Import by drag and drop.
  await dropFile(page, 'Customer MSA.docx', SAMPLE);
  await expect(page.locator('.review-bar strong')).toHaveText('Customer MSA.docx');
  await expect(page.locator('.page')).toContainText('MASTER SERVICES AGREEMENT');
  await expect(page.locator('.doc-table')).toContainText('$25,000');

  // A tracked-change-aware edit with a redline preview.
  await editParagraph(page, 'shall not', (t) => t.replace('shall not', 'may'));
  const edited = page.locator('.para.edited');
  await expect(edited.locator('.del')).toHaveText('shall not');
  await expect(edited.locator('.ins')).toHaveText('may');

  // Edits the engine cannot make safely are refused with an explanation.
  await openEditor(page, 'survive termination');
  const area = page.locator('.editor textarea');
  await area.fill((await area.inputValue()).replace('3.1', '4.1'));
  await page.locator('.editor').getByRole('button', { name: 'Save (⌘/Ctrl+Enter)' }).click();
  await expect(page.locator('.editor-error')).toContainText('part of a field');
  await page.locator('.editor').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.locator('.version-list')).toContainText('First pass');

  // The draft and versions survive a reload.
  await page.reload();
  await page.locator('.doc-open', { hasText: 'Customer MSA.docx' }).click();
  await expect(page.locator('.para.edited .ins')).toHaveText('may');

  // Make a further edit, then restore the saved version.
  await editParagraph(page, 'All work product', () => 'Customer owns deliverables made for it.');
  await expect(page.locator('.para.edited')).toHaveCount(2);
  await page.locator('.version-list li', { hasText: 'First pass' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.para.edited')).toHaveCount(1);

  // Tracked export: accept-all gives the edit; reject-all gives the original.
  const tracked = await exportAs(page, 'Tracked changes (.docx)');
  const original = openDocx(SAMPLE).main;
  const out = openDocx(tracked).main;
  expect(partTexts(out, 'accepted').join('\n')).toContain('Provider may provide services');
  expect(partTexts(out, 'rejected')).toEqual(partTexts(original, 'rejected'));
  expect(out.doc.source).toContain('w:author="E2E Reviewer"');

  // Clean export applies the edit without revisions by our author.
  const clean = openDocx(await exportAs(page, 'Clean, changes applied (.docx)')).main;
  expect(partTexts(clean, 'accepted').join('\n')).toContain('Provider may provide services');
  expect(clean.doc.source).not.toContain('E2E Reviewer');

  // The original is returned byte-for-byte.
  expect((await exportAs(page, 'Original file')).equals(SAMPLE)).toBe(true);
});

test('rules: findings, highlights, approved language, search and rule admin', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await dropFile(page, 'Customer MSA.docx', SAMPLE);
  const panel = page.locator('#findings');

  // The scan runs on import; text split across formatting runs is still found.
  await expect(panel.locator('.finding', { hasText: 'Potential non-compete' })).toBeVisible();
  await expect(panel.locator('.finding', { hasText: 'No limitation of liability' })).toBeVisible();
  await expect(page.locator('#main mark.hit').first()).toBeVisible();

  // Selecting a finding highlights its text in the document.
  await panel.locator('.finding-head', { hasText: 'Long payment terms' }).click();
  // The match spans the counterparty's tracked insertion and the next run, so it renders as two marks.
  await expect.poll(async () => (await page.locator('#main mark.active').allTextContents()).join('')).toBe('ninety (90) days');

  // Apply approved language over the counterparty's own tracked change.
  await panel.getByRole('button', { name: 'Apply as redline' }).click();
  await expect(page.locator('#toast')).toContainText('Applied');
  await expect(page.locator('.para.edited .ins', { hasText: 'thirty (30' })).toBeVisible();
  await expect(panel.locator('.finding', { hasText: 'Long payment terms' })).toHaveCount(0);
  await expect(panel.locator('.finding', { hasText: 'Pay-if-paid' })).toHaveCount(0);

  // Insert a missing clause, with a variable filled in.
  await panel.locator('.finding-head', { hasText: 'No governing law' }).click();
  await panel.locator('.var-form input').fill('Delaware');
  await panel.getByRole('button', { name: 'Apply as redline' }).click();
  await expect(page.locator('.proposed-insert', { hasText: 'State of Delaware' })).toBeVisible();

  // Dismiss a finding; it leaves the open list but stays under "All".
  await panel.locator('.finding-head', { hasText: 'Implied services' }).click();
  await panel.getByRole('button', { name: 'Dismiss' }).click();
  await expect(panel.locator('.finding', { hasText: 'Implied services' })).toHaveCount(0);
  await panel.getByRole('button', { name: /^All/ }).click();
  await expect(panel.locator('.finding', { hasText: 'Implied services' })).toContainText('Dismissed');

  // Search, including wildcards.
  await page.locator('#search').fill('sow');
  await expect(page.locator('#search-count')).toHaveText('1 of 2');
  await page.locator('#search').press('Enter');
  await expect(page.locator('#search-count')).toHaveText('2 of 2');
  await expect(page.locator('#main mark.search.current')).toHaveText('SOW');
  await page.locator('#search').fill('compet*');
  await expect(page.locator('#main mark.search')).toHaveText('competitor');
  await page.locator('#search').fill('/pre-?existing/');
  await expect(page.locator('#search-count')).toHaveText('1 of 1');

  // Rule admin: tests pass; disabling a rule removes its findings.
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('pass their built-in tests');
  await dialog.getByLabel('Enable Implied or unbounded scope').uncheck();
  await dialog.getByRole('tab', { name: 'Try on text' }).click();
  await dialog.locator('textarea').fill('Vendor shall indemnify Customer against any and all claims.');
  await expect(dialog.locator('.test-results')).toContainText('Broad indemnity');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(panel.locator('.finding', { hasText: 'Implied services' })).toHaveCount(0);

  // The redline export still satisfies the invariants.
  const out = openDocx(await exportAs(page, 'Tracked changes (.docx)')).main;
  expect(partTexts(out, 'rejected')).toEqual(partTexts(openDocx(SAMPLE).main, 'rejected'));
  const accepted = partTexts(out, 'accepted').join('\n');
  expect(accepted).toContain('within thirty (30) days of receipt');
  expect(accepted).not.toContain('ninety');
  expect(accepted).toContain('governed by the laws of the State of Delaware');
});

test('rejects files that are not Word documents', async ({ page }) => {
  await page.goto('/');
  await dropFile(page, 'notes.docx', Buffer.from('not a zip'));
  await expect(page.locator('#toast')).toContainText('Not a zip archive');
});
