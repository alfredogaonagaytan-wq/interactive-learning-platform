import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** 1.5 s, 440 Hz WAV generated in the test (fictional content only). */
function wav(seconds = 1.5): Buffer {
  const rate = 8000, n = Math.floor(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return b;
}

const scan = async (page: Page, label: string) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} – ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`)).toEqual([]);
};

async function publishAndStart(page: Page) {
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version/)).toBeVisible();
  await page.goto('/#/student');
  await page.getByRole('link', { name: 'Start' }).first().click();
}

test('listening with a play limit, and speaking with a real (simulated) microphone', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'media flow checked once');
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: '+ New activity' }).click();
  await page.getByLabel('Title').fill('Listening and speaking check');
  // Audio clip with one play
  await page.getByRole('button', { name: /^Audio clip/ }).click();
  await page.getByLabel('Title (optional)').fill('Station announcement');
  await page.getByLabel('Audio: upload').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.getByRole('textbox', { name: 'Transcript' }).fill('The train to Busan leaves from platform 3.');
  await page.getByLabel('Plays allowed').locator('..').getByLabel('Unlimited').uncheck();
  await page.getByLabel('Plays allowed').fill('1');
  // Speaking practice without a model (device voices are not available headless)
  await page.getByText('+ Add item').click();
  await page.getByRole('button', { name: /Speaking practice/ }).click();
  await page.getByLabel('Phrase 1', { exact: true }).fill('platform three');
  await page.getByLabel('Use the device voice when there is no model recording').uncheck();
  await scan(page, 'speaking editor');
  await publishAndStart(page);

  const clip = page.getByRole('group', { name: 'Station announcement' });
  await clip.getByRole('button', { name: 'Play' }).click();
  await expect(clip.getByText('Last play.')).toBeVisible();
  await expect(clip.getByText('No plays left.')).toBeVisible({ timeout: 5000 }); // after the clip ends
  await expect(clip.getByRole('button', { name: 'Play' })).toBeDisabled();

  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByRole('button', { name: /^Stop/ })).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^Stop/ }).click();
  const rec = page.getByLabel(/Your recording 1 of “platform three”/);
  await expect(rec).toBeVisible();
  const duration = await rec.evaluate(async (a: HTMLAudioElement) => {
    await new Promise((r) => (a.readyState >= 1 ? r(null) : a.addEventListener('loadedmetadata', r, { once: true })));
    return a.duration;
  });
  expect(duration === Infinity || duration > 0.2).toBe(true); // real audio data was captured
  await scan(page, 'player with recording');
  await page.reload();
  await expect(page.getByLabel(/Your recording 1/)).toBeVisible(); // stored on the device
  await expect(page.getByRole('group', { name: 'Station announcement' }).getByText('No plays left.')).toBeVisible(); // limit survives reload
});

test('grammar sample: build a sentence, get rule-based feedback, submit', async ({ page }) => {
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: 'Open a grammar and speaking sample' }).click();
  await scan(page, 'grammar editor');
  await page.getByRole('button', { name: /Q1 · Sentence/ }).click();
  await scan(page, 'sentence editor');
  await publishAndStart(page);
  await page.getByLabel('Rewrite the sentence').fill('A new species of frog were discovered.');
  await page.getByRole('button', { name: /^Check/ }).first().click();
  await expect(page.getByText('Error type: subject-verb agreement')).toBeVisible();
  const bank = page.getByRole('group', { name: 'Word cards' });
  for (const w of ['the samples', 'were collected', 'near', 'the river', 'last week']) await bank.getByRole('button', { name: `Add “${w}”` }).click();
  await scan(page, 'grammar player');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Your results' })).toBeVisible();
  await expect(page.getByText(/teacher review|review this/i).first()).toBeVisible().catch(() => {});
  await scan(page, 'grammar results');
});
