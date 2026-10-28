import { describe, expect, it } from 'vitest';
import {
  blocksFromPlainText, citedParagraphs, countWords, FRAMEWORK_PRESETS, getItemDefinition, isApproved, observationChecks, paragraphNumbers, readingHash,
  readingPlainText, readingUnits, sha256Hex, sha256HexSync, sliceRuns, SYMBOL_PRESETS, validAnnotations, writingChecks, createItem, validateActivity, createActivity,
  type ObservationNotesItem, type ObservationNotesResponse, type ReadingDoc,
} from '../src';

let n = 0;
const id = () => `blk_${n++}`;

const SOURCE = `Ocean Acidification

The ocean absorbs about a quarter of the carbon dioxide (CO₂) that people release.
When CO₂ dissolves in seawater, it forms carbonic acid — lowering the water's pH.

Shells of oysters, clams and some plankton are made of calcium carbonate; in more acidic water,
they are harder to build — and may even dissolve.`;

function doc(): ReadingDoc {
  n = 0;
  const blocks = blocksFromPlainText(SOURCE, id);
  blocks[0] = { kind: 'heading', id: blocks[0]!.id, level: 2, runs: (blocks[0] as unknown as { runs: Array<{ text: string }> }).runs };
  return { title: 'Ocean Acidification', attribution: 'Fictional sample text', original: null, blocks, numbering: true, approval: null };
}

describe('sync SHA-256', () => {
  it('matches WebCrypto for ASCII, Unicode and multi-block input', async () => {
    for (const s of ['', 'abc', 'Ocean CO₂ 학교 ☃', 'x'.repeat(1000)]) expect(sha256HexSync(s)).toBe(await sha256Hex(s));
  });
});

describe('reading document', () => {
  it('imports plain text without changing a single character', () => {
    const d = doc();
    expect(readingPlainText(d)).toBe(SOURCE.split(/\n\n/).join('\n'));
    // the line break inside paragraph 2 survives
    expect(readingUnits(d)[2]!.text).toContain('acidic water,\nthey');
  });
  it('numbers paragraphs (not headings) and can be turned off', () => {
    const d = doc();
    expect([...paragraphNumbers(d).values()]).toEqual([1, 2]);
    expect(paragraphNumbers({ ...d, numbering: false }).size).toBe(0);
    expect(readingUnits(d).map((u) => u.paragraph)).toEqual([null, 1, 2]);
  });
  it('approval is invalidated by any change, even one character', () => {
    const d = doc();
    const approved = { ...d, approval: { hash: readingHash(d), approvedAt: new Date().toISOString() } };
    expect(isApproved(approved)).toBe(true);
    const edited = structuredClone(approved);
    const p = edited.blocks[1] as { runs: Array<{ text: string }> };
    p.runs[0]!.text = p.runs[0]!.text.replace('quarter', 'Quarter');
    expect(isApproved(edited)).toBe(false);
  });
  it('lists table cells, list items and captions as annotatable units', () => {
    const d: ReadingDoc = { ...doc(), blocks: [
      { kind: 'list', id: 'l', ordered: true, items: [[{ text: 'one' }], [{ text: 'two' }]] },
      { kind: 'table', id: 't', caption: [{ text: 'Table 1' }], rows: [[{ runs: [{ text: 'pH' }], header: true }], [{ runs: [{ text: '8.1' }], header: false }]] },
      { kind: 'figure', id: 'f', image: null, caption: [{ text: 'Figure 1. Shell' }], missing: '' },
      { kind: 'page', id: 'p', label: 'Page 2' },
    ] };
    expect(readingUnits(d).map((u) => u.id)).toEqual(['l:0', 'l:1', 't:cap', 't:0:0', 't:1:0', 'f:cap']);
  });
  it('slices formatted runs at character offsets', () => {
    expect(sliceRuns([{ text: 'The ' }, { text: 'ocean', i: true }, { text: ' absorbs' }], 2, 7)).toEqual([{ text: 'e ' }, { text: 'oce', i: true }]);
  });
});

function notesItem(): ObservationNotesItem {
  const base = createItem('observation-notes') as ObservationNotesItem;
  const reading = doc();
  reading.approval = { hash: readingHash(reading), approvedAt: new Date().toISOString() };
  const symbols = SYMBOL_PRESETS.science.symbols();
  const ev = symbols.find((s) => s.code === 'EV')!;
  return {
    ...base, reading, symbols, minAnnotations: { [ev.id]: 2 },
    prompts: [{ id: 'prm_1', unitId: reading.blocks[1]!.id, question: 'What does the ocean absorb?' }],
    cornell: { enabled: true, summaryMinWords: 5 },
    writing: { ...base.writing!, minCitations: 1, requiredTerms: ['carbonic acid'] },
  };
}

function ann(item: ObservationNotesItem, unitIndex: number, quote: string, code: string) {
  const u = readingUnits(item.reading)[unitIndex]!;
  const start = u.text.indexOf(quote);
  return { id: `ann_${quote.length}${code}`, unitId: u.id, start, end: start + quote.length, quote, symbolId: item.symbols.find((s) => s.code === code)!.id, note: '' };
}

describe('observation notes', () => {
  it('ignores annotations whose anchor no longer matches the text', () => {
    const item = notesItem();
    const good = ann(item, 1, 'a quarter of the carbon dioxide', 'EV');
    const bad = { ...good, id: 'ann_bad', quote: 'something else' };
    expect(validAnnotations(item.reading, [good, bad])).toEqual([good]);
  });

  it('checks structure deterministically and leaves quality to the teacher', () => {
    const item = notesItem();
    const [claim, evidence, reasoning] = item.writing!.sections;
    const r: ObservationNotesResponse = {
      annotations: [ann(item, 1, 'a quarter of the carbon dioxide', 'EV'), ann(item, 2, 'harder to build', 'EV')],
      prompts: { prm_1: 'About a quarter of the CO2.' }, cues: [], notes: '', summary: 'The ocean absorbs CO2 and becomes more acidic, harming shells.',
      sections: { [claim!.id]: 'Ocean acidification makes it harder for shellfish to survive.', [evidence!.id]: 'The text says CO₂ forms carbonic acid and lowers pH (¶1). Shells are harder to build (¶2). That is strong evidence from both paragraphs of the article.', [reasoning!.id]: 'too short' },
      successChecks: {}, rubricSelf: {},
    };
    const checks = observationChecks(item, r);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.met]));
    expect(byId[`ann:${item.symbols.find((s) => s.code === 'EV')!.id}`]).toBe(true);
    expect(byId.prompts).toBe(true);
    expect(byId.summary).toBe(true);
    expect(byId.citations).toBe(true);
    expect(byId['term:carbonic acid']).toBe(true);
    expect(byId[`words:${reasoning!.id}`]).toBe(false);
    const res = getItemDefinition('observation-notes').grade(item, r, { language: 'en' });
    expect(res.status).toBe('needs-review');
    expect(res.score).toBe(0);
    const completion = getItemDefinition('observation-notes').grade({ ...item, scoring: 'completion' }, r, { language: 'en' });
    expect(completion.status).toBe('partial');
  });

  it('cannot be published until the reading is approved', () => {
    const item = notesItem();
    const a = createActivity('x');
    a.items = [{ ...item, reading: { ...item.reading, approval: null } }];
    expect(validateActivity(a).map((i) => i.message).join()).toMatch(/approve it before publishing/);
    a.items = [item];
    expect(validateActivity(a)).toEqual([]);
  });

  it('rubric maximum is used for teacher-reviewed writing', () => {
    const item = notesItem();
    item.writing!.rubric = [{ id: 'rub_1', label: 'Claim', levels: [{ id: 'l1', label: 'Beginning', points: 1, descriptor: '' }, { id: 'l2', label: 'Secure', points: 4, descriptor: '' }] }];
    expect(getItemDefinition('observation-notes').maxScore(item)).toBe(4);
  });
});

describe('writing helpers', () => {
  it('counts words and distinct paragraph citations (pages are not paragraphs)', () => {
    expect(countWords('  one two\nthree ')).toBe(3);
    expect(citedParagraphs('(¶3) and ¶ 3 and (paragraph 5), (para. 7), p. 9')).toEqual([3, 5, 7]);
  });
  it('presets exist for CER, TCTAC and Toulmin', () => {
    expect(FRAMEWORK_PRESETS.cer.sections().map((s) => s.label)).toEqual(['Claim', 'Evidence', 'Reasoning']);
    expect(FRAMEWORK_PRESETS.tctac.sections()).toHaveLength(5);
    expect(FRAMEWORK_PRESETS.toulmin.sections().map((s) => s.label)).toContain('Rebuttal');
  });
  it('required terms match whole words only', () => {
    const task = (createItem('writing') as Extract<ReturnType<typeof createItem>, { type: 'writing' }>).task;
    const checks = writingChecks({ ...task, sections: task.sections.slice(0, 1), requiredTerms: ['pH'] }, { sections: { [task.sections[0]!.id]: 'The phone is new.' }, successChecks: {}, rubricSelf: {} });
    expect(checks.find((c) => c.id === 'term:pH')?.met).toBe(false);
  });
});
