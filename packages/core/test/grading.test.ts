import { describe, expect, it } from 'vitest';
import { getItemDefinition, gradeActivity, validateActivity } from '../src';
import { blanks, mc, sampleActivity, tf } from './fixtures';

const ctx = { language: 'en' };

describe('multiple choice', () => {
  const def = getItemDefinition('multiple-choice');
  it('all-or-nothing requires exactly the correct set', () => {
    expect(def.grade(mc(), { choiceIds: ['c1', 'c2'] }, ctx).score).toBe(2);
    expect(def.grade(mc(), { choiceIds: ['c1'] }, ctx).score).toBe(0);
    expect(def.grade(mc(), { choiceIds: ['c1', 'c2', 'c3'] }, ctx).status).toBe('incorrect');
  });
  it('partial credit only when configured, and penalises wrong picks', () => {
    const item = mc({ scoring: 'partial' });
    expect(def.grade(item, { choiceIds: ['c1'] }, ctx)).toMatchObject({ score: 1, status: 'partial' });
    expect(def.grade(item, { choiceIds: ['c1', 'c3'] }, ctx).score).toBe(0);
    expect(def.grade(item, { choiceIds: ['c1', 'c2', 'c3'] }, ctx).score).toBe(1);
  });
  it('single mode', () => {
    const item = mc({ mode: 'single', choices: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }] });
    expect(def.grade(item, { choiceIds: ['a'] }, ctx).status).toBe('correct');
    expect(def.grade(item, { choiceIds: ['b'] }, ctx).status).toBe('incorrect');
    expect(def.grade(item, { choiceIds: [] }, ctx).status).toBe('unanswered');
  });
  it('validation catches common authoring mistakes', () => {
    expect(def.validate(mc({ mode: 'single' })).map((i) => i.message).join()).toMatch(/exactly one correct/);
    expect(def.validate(mc({ choices: [{ id: 'a', text: 'A', correct: false }] })).length).toBeGreaterThan(0);
  });
  it('returns teacher feedback for the outcome', () => {
    expect(def.grade(mc(), { choiceIds: ['c3'] }, ctx).feedback).toMatch(/breathe air/);
  });
});

describe('true/false', () => {
  const def = getItemDefinition('true-false');
  it('grades both values and unanswered', () => {
    expect(def.grade(tf(), { value: true }, ctx).status).toBe('correct');
    expect(def.grade(tf(), { value: false }, ctx).status).toBe('incorrect');
    expect(def.grade(tf(), { value: null }, ctx).status).toBe('unanswered');
    expect(def.grade(tf(), undefined, ctx).status).toBe('unanswered');
  });
});

describe('fill in the blanks (grammar answers)', () => {
  const def = getItemDefinition('fill-blanks');
  it('correct and incorrect verb forms', () => {
    const r = def.grade(blanks([['went'], ['ate', 'had eaten']]), { values: { blk_0: 'goed', blk_1: 'had eaten' } }, ctx);
    expect(r.status).toBe('partial');
    expect(r.score).toBe(1);
    expect(r.parts.map((p) => p.correct)).toEqual([false, true]);
  });
  it('all-or-nothing scoring', () => {
    const item = blanks([['went'], ['ate']], { scoring: 'all-or-nothing' });
    expect(def.grade(item, { values: { blk_0: 'went', blk_1: 'eat' } }, ctx).score).toBe(0);
    expect(def.grade(item, { values: { blk_0: 'Went', blk_1: ' ate ' } }, ctx).score).toBe(2);
  });
  it('capitalization-sensitive items explain the mistake', () => {
    const item = blanks([['Monday']], { match: { caseSensitive: true, punctuationSensitive: false, accentSensitive: true, equivalences: [] } });
    const r = def.grade(item, { values: { blk_0: 'monday' } }, ctx);
    expect(r.status).toBe('incorrect');
    expect(r.parts[0]?.reason).toBe('capitalization');
    expect(r.feedback).toMatch(/capitalization/);
  });
  it('splits points across three blanks without floating-point drift', () => {
    const item = blanks([['a'], ['b'], ['c']], { points: 1 });
    expect(def.grade(item, { values: { blk_0: 'a', blk_1: 'x', blk_2: 'x' } }, ctx).score).toBe(0.33);
  });
});

describe('gradeActivity', () => {
  it('totals scorable items and ignores content blocks', () => {
    const a = sampleActivity();
    const r = gradeActivity(a, {
      itm_mc: { choiceIds: ['c1', 'c2'] },
      itm_tf: { value: false },
      itm_fb: { values: { blk_0: 'went', blk_1: 'ate' } },
    });
    expect(r.maxScore).toBe(5);
    expect(r.score).toBe(4);
    expect(r.percent).toBe(80);
    expect(r.counts.ungraded).toBe(1);
  });
  it('is deterministic', () => {
    const a = sampleActivity();
    const resp = { itm_fb: { values: { blk_0: 'went', blk_1: '' } } };
    expect(gradeActivity(a, resp)).toEqual(gradeActivity(a, resp));
  });
  it('sample activity validates', () => {
    expect(validateActivity(sampleActivity())).toEqual([]);
  });
});
