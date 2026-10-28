import { describe, expect, it } from 'vitest';
import { matchAnswer, normalizeAnswer, canonicalAnswer, type MatchOptions } from '../src';

const lenient: MatchOptions = { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] };
const strict: MatchOptions = { caseSensitive: true, punctuationSensitive: true, accentSensitive: true, equivalences: [] };

describe('normalizeAnswer', () => {
  it('collapses irrelevant whitespace including non-breaking spaces', () => {
    expect(normalizeAnswer('  the   dog\t ran ', strict)).toBe('the dog ran');
  });
  it('treats curly and straight apostrophes the same even when punctuation matters', () => {
    expect(normalizeAnswer('don’t', strict)).toBe("don't");
  });
  it('folds case only when allowed', () => {
    expect(normalizeAnswer('Paris', lenient)).toBe('paris');
    expect(normalizeAnswer('Paris', strict)).toBe('Paris');
  });
  it('removes punctuation only when allowed', () => {
    expect(normalizeAnswer("Don't stop!", lenient)).toBe('dont stop');
    expect(normalizeAnswer('well-known', lenient)).toBe('well known');
  });
  it('keeps accents by default but can ignore them', () => {
    expect(normalizeAnswer('café', lenient)).toBe('café');
    expect(normalizeAnswer('café', { ...lenient, accentSensitive: false })).toBe('cafe');
  });
  it('handles Korean text without altering it', () => {
    expect(normalizeAnswer(' 학교에  갑니다. ', lenient)).toBe('학교에 갑니다');
  });
});

describe('matchAnswer', () => {
  it('accepts any of several correct answers', () => {
    expect(matchAnswer('had eaten', ['ate', 'had eaten'], lenient).matched).toBe(true);
    expect(matchAnswer('eated', ['ate', 'had eaten'], lenient)).toEqual({ matched: false, reason: 'no-match' });
  });
  it('reports blank answers', () => {
    expect(matchAnswer('   ', ['ate'], lenient)).toEqual({ matched: false, reason: 'blank' });
  });
  it('explains capitalization-only mistakes without awarding credit', () => {
    expect(matchAnswer('paris', ['Paris'], strict)).toEqual({ matched: false, reason: 'capitalization' });
  });
  it('explains punctuation-only mistakes', () => {
    expect(matchAnswer('Its raining', ["It's raining"], strict)).toEqual({ matched: false, reason: 'punctuation' });
  });
  it('explains accent-only mistakes', () => {
    expect(matchAnswer('cafe', ['café'], lenient)).toEqual({ matched: false, reason: 'accents' });
  });
  it('applies teacher-defined equivalences on whole words', () => {
    const opts = { ...lenient, equivalences: [["don't", 'do not']] };
    expect(matchAnswer('I do not know', ["I don't know"], opts).matched).toBe(true);
    expect(canonicalAnswer('do nothing', opts)).toBe('do nothing');
  });
  it('ignores empty accepted answers', () => {
    expect(matchAnswer('x', ['', ' '], lenient).matched).toBe(false);
  });
});
