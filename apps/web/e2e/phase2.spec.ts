import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openSortingSample(page: Page) {
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: 'Open a drag-and-drop sample' }).click();
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
}

async function publishAndStart(page: Page) {
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version/)).toBeVisible();
  await page.goto('/#/student');
  await page.getByRole('link', { name: 'Start' }).first().click();
}

/** Real mouse drag: press, move past the drag threshold, then move to the target and release. */
async function dragTo(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>, ghost = true) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  if (ghost) await expect(page.locator('.drag-ghost')).toBeVisible();
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('pointer drag works for drag-the-words, drag-and-drop and sequencing', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse dragging is covered on desktop; phones use the tap test');
  await openSortingSample(page);
  await publishAndStart(page);
  // drag the words
  const bank = page.getByRole('group', { name: 'Words to place' });
  await dragTo(page, bank.getByRole('button', { name: 'producers' }), page.getByRole('button', { name: /^Gap 1 of 3: empty/ }));
  await expect(page.getByRole('button', { name: /^Gap 1 of 3: producers/ })).toBeVisible();
  // drag from one gap to another moves the word
  await dragTo(page, page.getByRole('button', { name: /^Gap 1 of 3: producers/ }), page.getByRole('button', { name: /^Gap 3 of 3: empty/ }));
  await expect(page.getByRole('button', { name: /^Gap 3 of 3: producers/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Gap 1 of 3: empty/ })).toBeVisible();
  // drag-and-drop zones
  const cards = page.getByRole('group', { name: 'Cards', exact: true });
  await page.getByRole('group', { name: 'Decomposers' }).scrollIntoViewIfNeeded();
  await dragTo(page, cards.getByRole('button', { name: 'mushroom' }), page.getByRole('group', { name: 'Decomposers' }));
  await expect(page.getByRole('group', { name: 'Decomposers' }).getByRole('button', { name: /mushroom/ })).toBeVisible();
  // sequencing by handle
  const seq = page.getByRole('group', { name: /Put the food chain/ });
  const items = seq.getByRole('listitem');
  const firstText = await items.first().textContent();
  await items.nth(2).scrollIntoViewIfNeeded();
  await dragTo(page, items.first().locator('.seq-handle'), items.nth(2), false);
  await expect(items.first()).not.toHaveText(firstText!);
  // everything persists across reload
  await page.reload();
  await expect(page.getByRole('button', { name: /^Gap 3 of 3: producers/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Decomposers' }).getByRole('button', { name: /mushroom/ })).toBeVisible();
});

test('tap-to-place works on touch screens', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch only');
  await openSortingSample(page);
  await publishAndStart(page);
  const bank = page.getByRole('group', { name: 'Words to place' });
  await bank.getByRole('button', { name: 'sunlight' }).tap();
  await page.getByRole('button', { name: /^Gap 2 of 3: empty/ }).tap();
  await expect(page.getByRole('button', { name: /^Gap 2 of 3: sunlight/ })).toBeVisible();
  const cards = page.getByRole('group', { name: 'Cards', exact: true });
  await cards.getByRole('button', { name: 'owl' }).tap();
  await page.getByRole('button', { name: 'Place owl in Consumers' }).tap();
  await expect(page.getByRole('group', { name: 'Consumers' }).getByRole('button', { name: /owl/ })).toBeVisible();
});

test('teacher uploads an image, draws a hotspot, exports and re-imports the zip; student finds the hotspot', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'one browser is enough for this long flow');
  // Make a real PNG (a screenshot) to upload.
  await page.goto('/');
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 300 } });
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: '+ New activity' }).click();
  await page.getByLabel('Title').fill('Find the logo');
  // The add menu starts open for an empty activity.
  await page.getByRole('button', { name: /Find the hotspot/ }).click();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Click the marked area.');
  await page.getByLabel('Image: upload').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Alt text (describe the image)').fill('Screenshot of the app header');
  const canvas = page.locator('.region-canvas');
  await expect(canvas.locator('img')).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  // Draw from 20%,40% to 50%,70% (well clear of the sticky toolbar).
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Hotspot 1 label')).toBeVisible();
  await page.getByLabel('Hotspot 1 label').fill('Middle-left area');
  // Export (zip), then import as a copy
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.ilp\.zip$/);
  const path = testInfo.outputPath('pkg.ilp.zip');
  await file.saveAs(path);
  await page.goto('/#/teacher');
  await page.getByLabel('Import activity file').setInputFiles(path);
  await expect(page.getByText(/Imported 1 activit/)).toBeVisible();
  await page.getByRole('link', { name: 'Find the logo (imported)' }).click();
  await page.getByRole('button', { name: /Q1 · Find the hotspot/ }).click();
  await expect(page.locator('.region-canvas img')).toBeVisible(); // image came through the zip
  await publishAndStart(page);
  const stage = page.getByRole('button', { name: /Screenshot of the app header/ });
  await stage.scrollIntoViewIfNeeded();
  const s2 = (await stage.boundingBox())!;
  await page.mouse.click(s2.x + s2.width * 0.35, s2.y + s2.height * 0.55);
  await page.getByRole('button', { name: /^Check/ }).click();
  await expect(page.getByText('Correct', { exact: true })).toBeVisible();
});

test('no serious accessibility violations on Phase 2 activity types', async ({ page }) => {
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${label}: ${v.id} – ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`)).toEqual([]);
  };
  await openSortingSample(page);
  for (const name of [/Drag the words/, /Matching/, /Sequencing/, /Drag and drop/]) {
    await page.getByRole('button', { name }).first().click();
    await scan(`editor ${name}`);
  }
  await publishAndStart(page);
  await scan('player');
  // with a card picked up (receiving state) and after checking
  await page.getByRole('group', { name: 'Words to place' }).getByRole('button').first().click();
  await scan('player picked');
  for (const b of await page.getByRole('button', { name: /^Check/ }).all()) await b.click();
  await scan('player checked');
});
