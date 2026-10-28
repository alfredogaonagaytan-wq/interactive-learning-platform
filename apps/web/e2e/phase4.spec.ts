import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Minimal valid two-page PDF with real text objects (fictional content). */
function pdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const fontId = 3 + pages.length * 2;
  pages.forEach((lines, i) => {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    let y = 720;
    const ops = lines.map((l) => {
      if (l === '') { y -= 30; return ''; }
      const s = `BT /F1 14 Tf 72 ${y} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`;
      y -= 18;
      return s;
    }).join('\n');
    add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
  });
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
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

test('teacher imports a PDF, approves it; student selects text with the mouse and marks it', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'desktop flow');
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: '+ New activity' }).click();
  await page.getByLabel('Title').fill('Volcano reading');
  await page.getByRole('button', { name: /Observation notes/ }).click();
  await page.getByLabel('Upload reading file').setInputFiles({
    name: 'volcanoes.pdf', mimeType: 'application/pdf',
    buffer: pdf([['Volcanoes form where magma rises.', 'Magma that reaches the surface is lava.', '', 'Ash clouds can travel far.'], ['Page two text about eruptions.']]),
  });
  await expect(page.getByText(/Imported 2 pages/)).toBeVisible();
  await expect(page.getByLabel('Block 2 text')).toHaveValue('Volcanoes form where magma rises.\nMagma that reaches the surface is lava.');
  await page.getByRole('button', { name: 'Join wrapped lines in paragraphs' }).click();
  await expect(page.getByLabel('Block 2 text')).toHaveValue('Volcanoes form where magma rises. Magma that reaches the surface is lava.');
  await scan(page, 'reading editor');
  // Publishing is blocked until approval
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('alert')).toContainText('approve it before publishing');
  await page.getByRole('checkbox', { name: /I compared this text with the original/ }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  for (const t of ['Symbols', 'Questions', 'Notes & writing', 'Scoring']) {
    await page.getByRole('tab', { name: t }).click();
    await scan(page, `editor ${t}`);
  }
  await publishAndStart(page);

  const para = page.locator('.reading [data-unit-id]').filter({ hasText: 'Magma that reaches' });
  const box = (await para.boundingBox())!;
  // Drag-select the start of the paragraph with a real mouse
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const toolbar = page.getByRole('toolbar', { name: 'Mark selected words as' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Mark as Key concept' }).click();
  const mark = page.locator('mark.obs');
  await expect(mark).toHaveCount(1);
  const quote = await mark.textContent();
  expect('Volcanoes form where magma rises. Magma that reaches the surface is lava.'.startsWith(quote!.trim())).toBe(true);
  // The reading text itself is unchanged by highlighting
  await expect(para).toHaveText('Volcanoes form where magma rises. Magma that reaches the surface is lava.');
  await scan(page, 'workspace with highlight');
  await page.getByRole('tab', { name: 'Writing' }).click();
  await scan(page, 'writing tab');
  await page.reload();
  await expect(page.locator('mark.obs')).toHaveCount(1); // autosaved
});

test('observation notes sample works on a phone with the Reading / Notes switch', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('/#/teacher');
  await page.getByRole('button', { name: 'Open an observation notes sample' }).click();
  await publishAndStart(page);
  await expect(page.locator('.obs-reading')).toBeVisible();
  await expect(page.locator('.obs-notes')).toBeHidden();
  await page.getByRole('button', { name: /^Notes/ }).tap();
  await page.getByRole('button', { name: '+ Add an observation' }).tap();
  const paraSelect = page.getByLabel('Paragraph', { exact: true });
  await paraSelect.selectOption({ label: (await paraSelect.locator('option').nth(2).textContent())! });
  await page.getByLabel(/Exact words/).fill('carbonic acid');
  await page.getByRole('button', { name: 'Add', exact: true }).tap();
  await expect(page.locator('.obs-group blockquote', { hasText: 'carbonic acid' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Reading' }).tap();
  await expect(page.locator('mark.obs')).toHaveText('carbonic acid');
  await scan(page, 'phone workspace');
});
