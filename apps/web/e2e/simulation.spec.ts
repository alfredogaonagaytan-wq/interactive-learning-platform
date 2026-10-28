import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Simulation mode end to end in a real browser: fictional teacher and student,
 * the simulated submission service (same service code) running in the page.
 * Verifies that no request goes to any Google host.
 */
test('fictional teacher assigns, fictional student submits, teacher sees it — with no Google traffic', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'one full flow is enough; phone layouts are covered by the other suites');
  test.setTimeout(90_000);
  const googleRequests: string[] = [];
  page.on('request', (r) => { if (/google|gstatic|googleapis/.test(new URL(r.url()).host)) googleRequests.push(r.url()); });

  await page.goto('/#/simulation');
  await page.getByRole('button', { name: 'Start Simulation mode' }).click();
  expect(googleRequests).toEqual([]); // a device that never signed in does not even load Google's script
  const banner = page.getByRole('region', { name: 'Simulation mode' });
  await expect(banner).toContainText('SIMULATION');

  await page.getByRole('button', { name: 'Create fictional teacher' }).click();
  await expect(page.getByRole('status')).toContainText(/You are now acting as Ms Example/);
  await page.getByRole('button', { name: 'Add 5 fictional students' }).click();
  await expect(page.getByRole('button', { name: /Act as Ada Example/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create a sample class' }).click();
  await expect(page.getByRole('status')).toContainText(/Created “Sample class” with 5 fictional students/);

  // Build and publish (a sample activity), then assign it to the sample class.
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: 'Open a sample activity' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: 'Assign' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Assign' }).click();
  const link = await dialog.getByRole('textbox', { name: 'Assignment link' }).inputValue();
  expect(link).toMatch(/#\/a\/asg_[a-z0-9]+\?b=SIMULATED/);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Become a fictional student and complete it.
  await banner.getByRole('combobox', { name: /Acting as/ }).selectOption({ label: 'Ada Example (student)' });
  await page.goto(`/${link.slice(link.indexOf('#'))}`);
  await expect(page.getByText(/Assignment for student number/)).toContainText('S01');
  await page.getByRole('textbox', { name: /Blank 1 of 3/ }).fill('went');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  const delivery = page.getByRole('status').filter({ hasText: 'Delivery (SIMULATED)' });
  await expect(delivery).toContainText(/Done — SIMULATED receipt rct_/);
  await expect(delivery).toContainText('Not a real submission');

  // Back to the teacher: the submission is in the simulated service.
  await banner.getByRole('combobox', { name: /Acting as/ }).selectOption({ label: 'Ms Example (teacher)' });
  await page.goto('/#/classes');
  await page.getByRole('button', { name: 'Submissions' }).first().click();
  await expect(page.getByRole('main')).toContainText('S01');
  await page.goto('/#/setup-service');
  await expect(page.getByRole('heading', { name: 'Storage (simulated)' })).toBeVisible();
  await expect(page.getByText(/Access: only files the service created/)).toBeVisible();

  for (const route of ['#/simulation', '#/setup-service', '#/classes', '#/settings']) {
    await page.goto(`/${route}`);
    await expect(page.locator('main h1').first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${route}: ${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
  }
  expect(googleRequests).toEqual([]);
});

test('real mode setup page shows the two permissions and a connection-code field', async ({ page }) => {
  await page.goto('/#/setup-service');
  await expect(page.getByText('See, edit, create, and delete only the specific Google Drive files you use with this app')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Connection code' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});
