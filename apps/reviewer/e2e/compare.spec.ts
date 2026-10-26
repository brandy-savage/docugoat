// Side-by-side comparison in a real browser: start a comparison against a
// counterparty's revised draft, pick sides, survive a reload, download the
// merged redline and finish. Also audits the comparison screen with axe.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openDocx } from '@docugoat/docx/document';
import { partTexts } from '@docugoat/docx/paragraphs';
import { buildDocx, SAMPLE_COMMENTS, sampleMsaBody } from '../tests/fixtures/docx-builder.ts';

const SAMPLE = readFileSync('public/samples/sample-msa.docx');

/** The counterparty's draft: the sample with a payment change, a new clause and the IP clause removed. */
const REVISED = (() => {
  let body = sampleMsaBody()
    .replace('ninety (90)', 'sixty (60)')
    .replace('All work product, including Provider’s pre-existing tools and methodologies, shall be the exclusive property of Customer.', '');
  // A new paragraph just before the "Fees and Payment" heading.
  const at = body.lastIndexOf('<w:p>', body.indexOf('Fees and Payment'));
  body = body.slice(0, at) + '<w:p><w:r><w:t>Provider may engage subcontractors with Customer’s prior written consent.</w:t></w:r></w:p>' + body.slice(at);
  return Buffer.from(buildDocx({ body, comments: SAMPLE_COMMENTS, image: true }));
})();

async function startComparison(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the sample contract' }).click();
  await expect(page.locator('.review-bar strong')).toHaveText('Sample MSA.docx');
  await page.getByRole('button', { name: 'Compare this document side by side with another draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare with…' });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'Counterparty draft.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: REVISED,
  });
  await expect(page.locator('.compare')).toBeVisible();
}

/** Picks saved in IndexedDB for the comparison in progress. */
function savedPickCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('contract-reviewer');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('settings').objectStore('settings').getAll();
          all.onsuccess = () => {
            const record = (all.result as Array<{ picks?: object }>).find((r) => r && 'picks' in r);
            open.result.close();
            resolve(record ? Object.keys(record.picks!).length : 0);
          };
        };
      }),
  );
}

test('compare with a revised draft, pick sides, reload, download and finish', async ({ page }) => {
  await startComparison(page);
  await expect(page.locator('.cmp-heads')).toContainText('Counterparty draft.docx');
  const changes = page.locator('.cmp-row.change');
  await expect(changes).toHaveCount(3);
  await expect(page.locator('.cmp-bar h2')).toHaveText('3 differences');
  await expect(page.locator('#findings')).toBeHidden();

  // The payment difference shows a word-level redline on each side.
  const payment = changes.filter({ hasText: 'days of receipt' });
  // (The closing parenthesis is common to both, so it isn't marked.)
  await expect(payment.locator('.del')).toHaveText('ninety (90');
  await expect(payment.locator('.ins')).toHaveText('sixty (60');

  // Take their payment terms by clicking their side; keep our IP clause.
  await payment.getByRole('button', { name: /^Use this/ }).click();
  await expect(payment.locator('.cmp-cell.chosen')).toContainText('sixty (60)');
  const ip = changes.filter({ hasText: 'All work product' });
  await ip.getByRole('button', { name: /^Keep this/ }).click();
  await expect(page.locator('.cmp-bar')).toContainText('2 of 3 decided');

  // Keyboard: the last pick (the IP clause, third in reading order) is
  // highlighted; J wraps to the first difference, the new clause; 2 takes it.
  await expect(ip).toHaveClass(/current/);
  const sub = changes.filter({ hasText: 'subcontractors' });
  await page.keyboard.press('j');
  await expect(sub).toHaveClass(/current/);
  await page.keyboard.press('2');
  await expect(page.locator('.cmp-bar')).toContainText('3 of 3 decided · 2 taken from');

  // Picks survive a reload: reopening the document resumes the comparison.
  await expect.poll(() => savedPickCount(page)).toBe(3);
  await page.reload();
  await page.locator('.doc-open', { hasText: 'Sample MSA.docx' }).click();
  await expect(page.locator('.cmp-bar')).toContainText('3 of 3 decided');

  // Download the merged redline straight from the comparison.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /tracked changes/ }).click()]);
  // WebKit on Linux replaces spaces in download names with underscores.
  expect(download.suggestedFilename().replaceAll('_', ' ')).toBe('Sample MSA (redline).docx');
  const merged = openDocx(readFileSync((await download.path())!)).main;
  const accepted = partTexts(merged, 'accepted').join('\n');
  expect(accepted).toContain('within sixty (60) days');
  expect(accepted).toContain('Provider may engage subcontractors with Customer’s prior written consent.');
  expect(accepted).toContain('All work product');
  expect(partTexts(merged, 'rejected')).toEqual(partTexts(openDocx(SAMPLE).main, 'rejected'));

  // Finish: back to the document, with the merged differences as proposed changes.
  await page.getByRole('button', { name: /^Finish/ }).click();
  await expect(page.locator('.compare')).toHaveCount(0);
  await expect(page.locator('.review-bar')).toContainText('2 proposed changes');
  await expect(page.locator('.para.edited .ins')).toHaveText('sixty (60');
  await expect(page.locator('.para.proposed-insert')).toContainText('subcontractors');
  await page.reload();
  await page.locator('.doc-open', { hasText: 'Sample MSA.docx' }).click();
  await expect(page.locator('.review-bar')).toContainText('2 proposed changes');
  await expect(page.locator('.compare')).toHaveCount(0);
});

test('cancelling a comparison restores the document as it was', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await startComparison(page);
  await page.getByRole('button', { name: /for the rest$/ }).last().click();
  await expect(page.locator('.cmp-bar')).toContainText('3 of 3 decided');
  await page.getByRole('button', { name: 'Cancel comparison' }).click();
  await expect(page.locator('.compare')).toHaveCount(0);
  await expect(page.locator('.review-bar')).toContainText('click any paragraph to edit it');
});

test('comparing a document with itself reports no differences', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the sample contract' }).click();
  await page.getByRole('button', { name: 'Compare this document side by side with another draft' }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'Copy.docx', mimeType: 'application/octet-stream', buffer: SAMPLE });
  await expect(page.locator('#toast')).toContainText('That file is this document');
  await expect(page.locator('.compare')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`comparison screen has no serious accessibility violations (${scheme})`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'axe results are browser-independent');
    await page.emulateMedia({ colorScheme: scheme });
    await startComparison(page);
    await page.locator('.cmp-row.change').first().getByRole('button', { name: /^Use this/ }).click();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, serious.map((v) => `${v.id}: ${v.help} e.g. ${v.nodes[0]?.target.join(' ')}`).join('\n')).toEqual([]);
  });
}
