import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { strToU8, zipSync } from 'fflate';
import { createActivity, publishActivity, readingUnits, type ObservationNotesItem, type ReadingDoc } from '@ilp/core';
import { ReadingView } from '../src/reading/ReadingView';
import { ReadingEditor } from '../src/reading/ReadingEditor';
import { importDocx, importHtml, importPlainText } from '../src/reading/importers';
import { ActivityPlayer } from '../src/student/ActivityPlayer';
import { ConfirmProvider } from '../src/ui/dialog';
import { listAttempts, putActivity, putVersion } from '../src/storage/db';
import { sampleObservationActivity } from '../src/teacher/sample';
import { useState } from 'react';

const TEXT = `Line one of a poem,
  indented line two — with “curly quotes” and 3½ cups.

Second paragraph: CO₂ → H₂CO₃.   Three spaces kept.`;

function docOf(blocks = importPlainText(TEXT)): ReadingDoc {
  return { title: '', attribution: '', original: null, blocks, numbering: true, approval: null };
}

describe('source-text integrity', () => {
  it('renders every unit exactly as stored, including whitespace, symbols and line breaks', () => {
    const doc = docOf();
    const { container } = render(<ReadingView doc={doc} annotations={[]} symbols={[]} />);
    const rendered = [...container.querySelectorAll('[data-unit-id]')].map((el) => el.textContent);
    expect(rendered).toEqual(readingUnits(doc).map((u) => u.text));
    expect(rendered.join('\n\n')).toBe(TEXT);
  });

  it('highlights do not change the text (symbol codes are CSS, not text)', () => {
    const doc = docOf();
    const unit = readingUnits(doc)[1]!;
    const quote = 'CO₂ → H₂CO₃';
    const start = unit.text.indexOf(quote);
    const ann = { id: 'ann_1', unitId: unit.id, start, end: start + quote.length, quote, symbolId: 'sym_1', note: '' };
    const { container } = render(<ReadingView doc={doc} annotations={[ann]} symbols={[{ id: 'sym_1', code: 'EV', label: 'Evidence', description: '', color: 'green' }]} />);
    const el = container.querySelector(`[data-unit-id="${unit.id}"]`)!;
    expect(el.textContent).toBe(unit.text);
    expect(el.querySelector('mark')?.getAttribute('data-code')).toBe('EV');
  });
});

describe('importers', () => {
  it('pasted HTML keeps wording, emphasis, line breaks, lists and tables; strips scripts; never fetches external images', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const html = `<h2>The Water Cycle</h2>
      <p>Water <b>evaporates</b> from   the ocean,<br>then <span style="font-style:italic">condenses</span>.</p>
      <script>alert(1)</script><img src="https://evil.example/x.png" onerror="alert(2)">
      <ul><li>Evaporation</li><li>Condensation</li></ul>
      <table><caption>Table 1</caption><tr><th>Stage</th><th>Temp</th></tr><tr><td>Vapour</td><td>&gt; 100 °C</td></tr></table>`;
    const { blocks, skippedImages } = await importHtml(html);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(skippedImages).toBe(1);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'figure', 'list', 'table']);
    const p = blocks[1] as Extract<typeof blocks[number], { kind: 'paragraph' }>;
    expect(p.runs).toEqual([{ text: 'Water ' }, { text: 'evaporates', b: true }, { text: ' from the ocean,\nthen ' }, { text: 'condenses', i: true }, { text: '.' }]);
    const fig = blocks[2] as Extract<typeof blocks[number], { kind: 'figure' }>;
    expect(fig.missing).toMatch(/evil\.example.*not downloaded/);
    const t = blocks[4] as Extract<typeof blocks[number], { kind: 'table' }>;
    expect(t.rows[1]![1]!.runs[0]!.text).toBe('> 100 °C');
    expect(JSON.stringify(blocks)).not.toMatch(/alert/);
  });

  it('reads a .docx with headings, bold text and paragraphs', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Photosynthesis</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Plants use </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>sunlight</w:t></w:r><w:r><w:t xml:space="preserve"> to make glucose.</w:t></w:r></w:p>
</w:body></w:document>`;
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': strToU8(xml),
    });
    const { blocks } = await importDocx(docx);
    expect(blocks[0]).toMatchObject({ kind: 'heading', runs: [{ text: 'Photosynthesis' }] });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Plants use ' }, { text: 'sunlight', b: true }, { text: ' to make glucose.' }] });
  });
});

function EditorHarness({ initial }: { initial: ReadingDoc }) {
  const [doc, setDoc] = useState(initial);
  return <ConfirmProvider><ReadingEditor doc={doc} onChange={setDoc} /></ConfirmProvider>;
}

describe('reading approval', () => {
  it('approval is required and is invalidated by any edit', async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={docOf()} />);
    await user.click(screen.getByRole('checkbox', { name: /I compared this text with the original/ }));
    expect(screen.getByText('Approved')).toBeInTheDocument();
    const block = screen.getByLabelText('Block 2 text');
    await user.type(block, '!');
    expect(await screen.findByText(/changed after you approved it/)).toBeInTheDocument();
  });

  it('paste of plain text imports paragraphs without changes', async () => {
    render(<EditorHarness initial={docOf([])} />);
    const box = screen.getByRole('textbox', { name: 'Paste the reading here' });
    await act(async () => {
      fireEvent.paste(box, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? TEXT : '') } });
    });
    expect(await screen.findByLabelText('Block 1 text')).toHaveValue(TEXT.split('\n\n')[0]);
  });
});

async function playSample() {
  const a = sampleObservationActivity();
  const { version, draft } = await publishActivity(a);
  await putActivity(draft);
  await putVersion(version);
  render(<ConfirmProvider><ActivityPlayer version={version} mode="student" /></ConfirmProvider>);
  return version;
}

describe('observation notes workspace', () => {
  it('sample publishes only because its reading is approved', async () => {
    const a = sampleObservationActivity();
    (a.items[0] as ObservationNotesItem).reading.approval = null;
    await expect(publishActivity(a)).rejects.toThrow(/approve/);
  });

  it('keyboard path: add an observation by paragraph + exact words; wrong words are rejected', async () => {
    const v = await playSample();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '+ Add an observation' }));
    await user.selectOptions(screen.getByLabelText('Paragraph'), screen.getByRole('option', { name: /^¶2:/ }));
    await user.type(screen.getByLabelText(/Exact words/), 'not in the text');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/not in that paragraph/);
    await user.clear(screen.getByLabelText(/Exact words/));
    await user.type(screen.getByLabelText(/Exact words/), 'carbonic acid');
    await user.selectOptions(screen.getByLabelText('Symbol'), screen.getByRole('option', { name: 'VOC — Vocabulary' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('“carbonic acid”')).toBeInTheDocument();
    expect(document.querySelector('mark.obs')?.textContent).toBe('carbonic acid');
    await waitFor(async () => expect(((await listAttempts(v.activityId))[0]?.responses[v.activity.items[0]!.id] as { annotations: unknown[] })?.annotations).toHaveLength(1));
  });

  it('mouse/touch path: select text, choose a symbol from the toolbar', async () => {
    await playSample();
    const user = userEvent.setup();
    const unit = (await screen.findAllByText(/oysters, clams, corals/))[0]!;
    const textNode = unit.firstChild!;
    const s = textNode.textContent!.indexOf('oysters, clams, corals');
    const range = document.createRange();
    range.setStart(textNode, s);
    range.setEnd(textNode, s + 'oysters, clams, corals'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(unit);
    const toolbar = await screen.findByRole('toolbar', { name: 'Mark selected words as' });
    await user.click(within(toolbar).getByRole('button', { name: 'Mark as Evidence' }));
    expect(screen.getByText('“oysters, clams, corals”')).toBeInTheDocument();
    expect(document.querySelector('mark.obs')?.getAttribute('data-code')).toBe('EV');
  });

  it('writing: insert cited evidence from notes, live checklist, teacher-review on submit', async () => {
    await playSample();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '+ Add an observation' }));
    await user.selectOptions(screen.getByLabelText('Paragraph'), screen.getByRole('option', { name: /^¶3:/ }));
    await user.type(screen.getByLabelText(/Exact words/), 'there are fewer carbonate ions available');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('tab', { name: 'Writing' }));
    const picker = screen.getByLabelText('Insert evidence into Evidence');
    await user.selectOptions(picker, within(picker).getByRole('option', { name: /fewer carbonate ions/ }));
    const evidence = screen.getByRole('textbox', { name: 'Evidence' });
    expect(evidence).toHaveValue('“there are fewer carbonate ions available” (¶3)');
    expect(screen.getByText(/cited ¶3/)).toBeInTheDocument();
    expect(screen.getByText(/Use the term “carbonate”/).closest('li')).toHaveClass('met');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Your teacher will review this')).toBeInTheDocument();
  });
});

void createActivity;
