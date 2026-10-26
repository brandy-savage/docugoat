// Automated accessibility checks (axe-core) on the main screens, light and dark.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const summary = violations.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
  if (summary.length) console.log(summary.join('\n'));
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'), summary.join('\n')).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`main screens have no serious accessibility violations (${scheme})`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'axe results are browser-independent');
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.locator('.topbar').waitFor();
    await audit(page, 'welcome');

    await page.getByRole('button', { name: 'Try the sample contract' }).click();
    await page.locator('#findings .finding').first().waitFor();
    await audit(page, 'document');

    await page.locator('.finding-head', { hasText: 'Pre-existing IP' }).click();
    await page.locator('.para', { hasText: 'Signed and sealed' }).click();
    await page.locator('#search').fill('customer');
    await audit(page, 'finding + editor + search');

    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    await audit(page, 'rules dialog');
  });
}
