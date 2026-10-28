import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function createSampleAndPublish(page: Page) {
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: 'Open a sample activity' }).click();
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
}

test('teacher publishes, student works, reloads without losing work, submits', async ({ page }) => {
  await createSampleAndPublish(page);
  await page.getByRole('link', { name: 'Student', exact: true }).click();
  await page.getByRole('link', { name: 'Start' }).click();
  await page.getByRole('textbox', { name: /Blank 1 of 3/ }).fill('went');
  await page.getByRole('textbox', { name: /Blank 2 of 3/ }).fill('Saw');
  await expect(page.getByText(/Saved on this device/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: /Blank 1 of 3/ })).toHaveValue('went');
  await expect(page.getByRole('textbox', { name: /Blank 2 of 3/ })).toHaveValue('Saw');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible();
  await expect(page.getByText(/points/).first()).toBeVisible();
  // Report download works
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report (JSON)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/report\.json$/);
});

test('works offline after the first visit (PWA)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await createSampleAndPublish(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Interactive Learning Platform home' })).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await page.goto('/#/student');
  await page.getByRole('link', { name: 'Start' }).click();
  await page.getByRole('textbox', { name: /Blank 1 of 3/ }).fill('went');
  await expect(page.getByText(/Offline — work is kept on this device/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: /Blank 1 of 3/ })).toHaveValue('went');
  await context.setOffline(false);
});

test('has an installable web app manifest', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href!)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});

test('no serious accessibility violations on main screens', async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${label}: ${v.id} – ${v.help} (${v.nodes.length})`)).toEqual([]);
  };
  await page.goto('/');
  await scan('home');
  await createSampleAndPublish(page);
  await scan('editor');
  await page.goto('/#/teacher');
  await scan('library');
  await page.goto('/#/student');
  await page.getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  await scan('player');
});
