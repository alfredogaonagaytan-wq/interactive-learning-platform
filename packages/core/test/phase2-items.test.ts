import { describe, expect, it } from 'vitest';
import {
  dragWordTokens, getItemDefinition, hitTest, matchingCards, tokenizeMarkWords,
  type DragDropItem, type DragWordsItem, type DropdownClozeItem, type HotspotItem, type MarkWordsItem, type MatchingItem, type SequencingItem,
} from '../src';

const ctx = { language: 'en' };
const fb = { feedback: {}, skills: ['vocab'] };

describe('drag the words', () => {
  const item: DragWordsItem = {
    type: 'drag-words', id: 'itm_dw', prompt: '', distractors: ['go', 'the'], points: 2, scoring: 'per-blank', ...fb,
    segments: [
      { kind: 'text', text: 'I ' }, { kind: 'blank', id: 'b1', answers: ['went'] },
      { kind: 'text', text: ' to ' }, { kind: 'blank', id: 'b2', answers: ['the'] }, { kind: 'text', text: ' park.' },
    ],
  };
  const def = getItemDefinition('drag-words');
  it('offers one token per gap plus distractors', () => {
    expect(dragWordTokens(item).map((t) => t.text)).toEqual(['went', 'the', 'go', 'the']);
  });
  it('grades placements; identical tokens are interchangeable', () => {
    expect(def.grade(item, { placements: { b1: 't-b1', b2: 'd-1' } }, ctx)).toMatchObject({ status: 'correct', score: 2 });
    expect(def.grade(item, { placements: { b1: 'd-0', b2: 't-b2' } }, ctx)).toMatchObject({ status: 'partial', score: 1 });
    expect(def.grade(item, { placements: {} }, ctx).status).toBe('unanswered');
  });
  it('validates', () => {
    expect(def.validate({ ...item, segments: [] })[0]?.message).toMatch(/gap/);
  });
});

describe('dropdown cloze', () => {
  const item: DropdownClozeItem = {
    type: 'dropdown-cloze', id: 'itm_dd', prompt: '', points: 1, scoring: 'all-or-nothing', ...fb,
    segments: [{ kind: 'text', text: 'She ' }, { kind: 'blank', id: 'b1', answers: ['has', 'have', 'having'] }, { kind: 'text', text: ' a cat.' }],
  };
  const def = getItemDefinition('dropdown-cloze');
  it('first option is correct', () => {
    expect(def.grade(item, { values: { b1: 'has' } }, ctx).status).toBe('correct');
    expect(def.grade(item, { values: { b1: 'have' } }, ctx).status).toBe('incorrect');
    expect(def.correctAnswers(item)).toEqual(['has']);
  });
  it('requires at least two distinct options', () => {
    expect(def.validate({ ...item, segments: [{ kind: 'blank', id: 'b', answers: ['x'] }] }).length).toBeGreaterThan(0);
    expect(def.validate({ ...item, segments: [{ kind: 'blank', id: 'b', answers: ['x', 'x'] }] }).length).toBeGreaterThan(0);
  });
});

describe('matching', () => {
  const item: MatchingItem = {
    type: 'matching', id: 'itm_m', prompt: '', distractors: ['carnivore'], points: 3, scoring: 'per-pair', ...fb,
    pairs: [
      { id: 'p1', left: 'producer', leftImage: null, right: 'makes its own food' },
      { id: 'p2', left: 'consumer', leftImage: null, right: 'eats other organisms' },
      { id: 'p3', left: 'decomposer', leftImage: null, right: 'breaks down dead matter' },
    ],
  };
  const def = getItemDefinition('matching');
  it('scores per pair and penalises nothing for unused distractors', () => {
    expect(matchingCards(item)).toHaveLength(4);
    const r = def.grade(item, { matches: { p1: 'r-p1', p2: 'r-p3', p3: 'd-0' } }, ctx);
    expect(r.score).toBe(1);
    expect(r.parts.map((p) => p.correct)).toEqual([true, false, false]);
  });
  it('requires alt text for image-only prompts', () => {
    const withImg = { ...item, pairs: item.pairs.map((p, i) => (i === 0 ? { ...p, left: '', leftImage: { assetId: 'ast_x', alt: '', decorative: false } } : p)) };
    expect(def.validate(withImg).map((i) => i.message).join()).toMatch(/alt text/);
    expect(def.assets!(withImg)).toEqual(['ast_x']);
  });
});

describe('sequencing', () => {
  const item: SequencingItem = {
    type: 'sequencing', id: 'itm_s', prompt: '', display: 'paragraph', points: 4, scoring: 'per-position', ...fb,
    steps: ['a', 'b', 'c', 'd'].map((t) => ({ id: `s${t}`, text: `step ${t}`, image: null })),
  };
  const def = getItemDefinition('sequencing');
  it('per-position credit', () => {
    expect(def.grade(item, { order: ['sa', 'sb', 'sc', 'sd'] }, ctx).status).toBe('correct');
    expect(def.grade(item, { order: ['sa', 'sb', 'sd', 'sc'] }, ctx).score).toBe(2);
  });
  it('all-or-nothing', () => {
    expect(def.grade({ ...item, scoring: 'all-or-nothing' }, { order: ['sa', 'sb', 'sd', 'sc'] }, ctx).score).toBe(0);
  });
  it('an untouched or malformed order is unanswered, not graded', () => {
    expect(def.grade(item, { order: [] }, ctx).status).toBe('unanswered');
    expect(def.grade(item, { order: ['sa', 'sa', 'sb', 'sc'] }, ctx).status).toBe('unanswered');
  });
  it('rejects duplicate steps that make the order ambiguous', () => {
    expect(def.validate({ ...item, steps: [item.steps[0]!, { ...item.steps[1]!, text: 'step a' }] }).length).toBe(1);
  });
});

describe('mark the words', () => {
  it('tokenizes with punctuation outside words and supports escaped asterisks', () => {
    const toks = tokenizeMarkWords('The dog *ran*, then *jumped*! 5 \\* 2');
    const words = toks.filter((t) => t.kind === 'word');
    expect(words.map((w) => w.text)).toEqual(['The', 'dog', 'ran', 'then', 'jumped', '5', '2']);
    expect(words.filter((w) => w.kind === 'word' && w.correct).map((w) => w.text)).toEqual(['ran', 'jumped']);
    expect(toks.map((t) => t.text).join('')).toBe('The dog ran, then jumped! 5 * 2');
  });
  const item: MarkWordsItem = { type: 'mark-words', id: 'itm_mw', prompt: 'Click the verbs', text: 'She *sings* and *dances* well.', points: 2, ...fb };
  const def = getItemDefinition('mark-words');
  it('wrong clicks cancel right ones, never below zero', () => {
    expect(def.grade(item, { selected: [1, 3] }, ctx).status).toBe('correct');
    expect(def.grade(item, { selected: [1] }, ctx).score).toBe(1);
    expect(def.grade(item, { selected: [1, 0] }, ctx).score).toBe(0);
    expect(def.grade(item, { selected: [0, 2, 4] }, ctx).score).toBe(0);
  });
  it('needs at least one marked word', () => {
    expect(def.validate({ ...item, text: 'no stars' }).length).toBe(1);
  });
});

describe('drag and drop zones', () => {
  const item: DragDropItem = {
    type: 'drag-drop', id: 'itm_dd', prompt: '', background: null, points: 3, scoring: 'per-item', ...fb,
    zones: [
      { id: 'z1', label: 'Metals', showLabel: true, x: 0, y: 0, w: 50, h: 50, capacity: null },
      { id: 'z2', label: 'Non-metals', showLabel: true, x: 50, y: 0, w: 50, h: 50, capacity: null },
    ],
    draggables: [
      { id: 'd1', text: 'iron', image: null, correctZoneIds: ['z1'] },
      { id: 'd2', text: 'copper', image: null, correctZoneIds: ['z1'] },
      { id: 'd3', text: 'oxygen', image: null, correctZoneIds: ['z2'] },
      { id: 'd4', text: 'water (compound)', image: null, correctZoneIds: [] },
    ],
  };
  const def = getItemDefinition('drag-drop');
  it('credits correct placements and penalises wrong ones (incl. distractors)', () => {
    expect(def.grade(item, { placements: { d1: 'z1', d2: 'z1', d3: 'z2' } }, ctx).status).toBe('correct');
    expect(def.grade(item, { placements: { d1: 'z1', d2: 'z1', d3: 'z2', d4: 'z2' } }, ctx).score).toBe(2);
    expect(def.grade(item, { placements: { d1: 'z2' } }, ctx).score).toBe(0);
  });
  it('validates zones, references and capacity', () => {
    expect(def.validate(item)).toEqual([]);
    expect(def.validate({ ...item, zones: [{ ...item.zones[0]!, capacity: 1 }, item.zones[1]!] }).map((i) => i.message).join()).toMatch(/holds 1/);
    expect(def.validate({ ...item, zones: [item.zones[0]!] }).map((i) => i.message).join()).toMatch(/no longer exists/);
  });
});

describe('find the hotspot', () => {
  const item: HotspotItem = {
    type: 'hotspot', id: 'itm_h', prompt: 'Click the nucleus', image: { assetId: 'ast_cell', alt: 'Animal cell diagram', decorative: false }, allowListAlternative: true, points: 1, ...fb,
    hotspots: [
      { id: 'h1', label: 'Nucleus', shape: 'ellipse', x: 40, y: 40, w: 20, h: 20, correct: true },
      { id: 'h2', label: 'Cell membrane', shape: 'rect', x: 0, y: 0, w: 100, h: 10, correct: false, feedback: 'That is the membrane.' },
    ],
  };
  const def = getItemDefinition('hotspot');
  it('hit-tests ellipses and rectangles', () => {
    expect(hitTest(item, 50, 50)?.id).toBe('h1');
    expect(hitTest(item, 41, 41)).toBeUndefined(); // inside the box, outside the ellipse
    expect(hitTest(item, 5, 5)?.id).toBe('h2');
  });
  it('grades clicks and list choices the same way', () => {
    expect(def.grade(item, { point: { x: 50, y: 52 }, hotspotId: null }, ctx).status).toBe('correct');
    expect(def.grade(item, { point: null, hotspotId: 'h1' }, ctx).status).toBe('correct');
    const miss = def.grade(item, { point: { x: 5, y: 5 }, hotspotId: null }, ctx);
    expect(miss.status).toBe('incorrect');
    expect(miss.feedback).toMatch(/membrane/);
    expect(def.describeResponse(item, { point: { x: 90, y: 90 }, hotspotId: null })).toBe('outside any area');
  });
  it('requires an image with alt text and a correct hotspot', () => {
    const msgs = def.validate({ ...item, image: null, hotspots: [] }).map((i) => i.message).join();
    expect(msgs).toMatch(/Choose an image/);
    expect(msgs).toMatch(/correct/);
  });
});
