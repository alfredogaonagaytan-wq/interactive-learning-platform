import { describe, expect, it } from 'vitest';
import {
  builderCards, compilePatterns, createActivity, diffWords, dictationResult, expandPattern, getItemDefinition, gradeActivity, matchesCompiled,
  migrateActivityJson, PatternError, patternProblem, transcriptMatches, validateActivity,
  type DictationItem, type SentenceBuilderItem, type SentenceResponseItem, type SpeakingItem,
} from '../src';
import { mc } from './fixtures';

const ctx = { language: 'en' };
const strictCase = { caseSensitive: true, punctuationSensitive: false, accentSensitive: true, equivalences: [] };

describe('answer patterns', () => {
  it('expands alternatives and optional parts', () => {
    expect(expandPattern("She {has|'s} {already |}finished.").sort()).toEqual(["She 's already finished.", "She 's finished.", 'She has already finished.', 'She has finished.'].sort());
  });
  it('supports escaped braces and reports syntax errors', () => {
    expect(expandPattern('a \\{b\\} c')).toEqual(['a {b} c']);
    expect(() => expandPattern('She {has')).toThrow(PatternError);
    expect(() => expandPattern('a | b')).toThrow(/only allowed inside/);
    expect(patternProblem(['ok', '{bad'])).toMatch(/never closed/);
  });
  it('refuses patterns that explode combinatorially', () => {
    const huge = Array.from({ length: 12 }, () => '{a|b}').join(' ');
    expect(() => expandPattern(huge)).toThrow(/more than/);
  });
  it('matches after normalisation, never beyond the pattern set', () => {
    const c = compilePatterns(['The cat {sat|was sitting} on the mat.'], strictCase);
    expect(matchesCompiled('The cat  was sitting on the mat', c, strictCase)).toBeTruthy();
    expect(matchesCompiled('The cat sits on the mat.', c, strictCase)).toBeNull();
  });
});

function transform(over: Partial<SentenceResponseItem> = {}): SentenceResponseItem {
  return {
    type: 'sentence-response', id: 'itm_sr', audioCue: null, task: 'transform', prompt: 'Rewrite in the passive voice.', source: 'The students wrote the report.', starter: '',
    accepted: ['The report was written by the students.', 'The report was written{| by them}.'],
    errorRules: [{ id: 'r1', pattern: 'The report {was wrote|is wrote|was writed} by the students.', errorType: 'verb form', feedback: 'Use the past participle: written.' }],
    keywords: [{ id: 'k1', forms: ['report'] }, { id: 'k2', forms: ['students', 'them'] }], meaningWeight: 0.5,
    match: strictCase, unmatched: 'review', points: 2, feedback: {}, skills: ['passive voice'], ...over,
  };
}

describe('sentence response (grammar engine)', () => {
  const def = getItemDefinition('sentence-response');
  it('accepts any teacher-approved form', () => {
    expect(def.grade(transform(), { text: 'The report was written by the students.' }, ctx)).toMatchObject({ status: 'correct', score: 2 });
    expect(def.grade(transform(), { text: 'The report was written' }, ctx).status).toBe('correct');
  });
  it('tags known mistakes with an error type and separates meaning from accuracy', () => {
    const r = def.grade(transform(), { text: 'The report was wrote by the students.' }, ctx);
    expect(r).toMatchObject({ status: 'partial', score: 1, errorTags: ['verb form'] });
    expect(r.parts.find((p) => p.partId === 'meaning')?.correct).toBe(true);
    expect(r.parts.find((p) => p.partId === 'accuracy')?.reason).toBe('error-rule');
    expect(r.feedback).toMatch(/past participle/);
  });
  it('sends unmatched answers to teacher review instead of inventing a grade', () => {
    const r = def.grade(transform(), { text: 'Someone wrote it.' }, ctx);
    expect(r.status).toBe('needs-review');
    expect(r.score).toBe(0);
  });
  it('can mark unmatched answers incorrect when the teacher chooses, with meaning credit kept separate', () => {
    const r = def.grade(transform({ unmatched: 'incorrect' }), { text: 'The report has been written by the students.' }, ctx);
    expect(r).toMatchObject({ status: 'partial', score: 1 });
    const miss = def.grade(transform({ unmatched: 'incorrect' }), { text: 'It was done.' }, ctx);
    expect(miss).toMatchObject({ status: 'incorrect', score: 0 });
    expect(miss.parts.find((p) => p.partId === 'meaning')?.given).toMatch(/report/);
  });
  it('explains capitalisation-only mistakes deterministically (no review needed)', () => {
    const r = def.grade(transform(), { text: 'the report was written by the students.' }, ctx);
    expect(r).toMatchObject({ status: 'partial', score: 1 }); // meaning credit kept, accuracy lost
    expect(r.feedback).toMatch(/capitalization/);
  });
  it('treats the untouched starter as unanswered', () => {
    expect(def.grade(transform({ starter: 'The report' }), { text: 'The report' }, ctx).status).toBe('unanswered');
  });
  it('rejects a mistake rule that overlaps an accepted answer', () => {
    const bad = transform({ errorRules: [{ id: 'r', pattern: 'The report was written by the students.', errorType: 'x', feedback: '' }] });
    expect(def.validate(bad).map((i) => i.message).join()).toMatch(/also matches an accepted answer/);
  });
  it('needs-review items are excluded from the automatic total', () => {
    const a = createActivity('x');
    a.items = [transform(), mc()];
    const r = gradeActivity(a, { itm_sr: { text: 'Totally different.' }, itm_mc: { choiceIds: ['c1', 'c2'] } });
    expect(r).toMatchObject({ score: 2, maxScore: 2 });
    expect(r.counts['needs-review']).toBe(1);
  });
});

describe('sentence builder (reconstruction)', () => {
  const item: SentenceBuilderItem = {
    type: 'sentence-builder', id: 'itm_sb', audioCue: null, prompt: '', sentence: 'Yesterday / I / went to / the park.', alternatives: ['I went to the park yesterday.'],
    distractors: ['go'], lowercaseCards: true, match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, points: 2, scoring: 'per-position', feedback: {}, skills: ['word order'],
  };
  const def = getItemDefinition('sentence-builder');
  it('splits chunks, detaches final punctuation, keeps "I" capitalised', () => {
    const c = builderCards(item);
    expect(c.cards.map((x) => x.text)).toEqual(['yesterday', 'I', 'went to', 'the park', 'go']);
    expect(c.ending).toBe('.');
  });
  it('accepts the model order and listed alternatives', () => {
    expect(def.grade(item, { order: ['w0', 'w1', 'w2', 'w3'] }, ctx).status).toBe('correct');
    expect(def.grade(item, { order: ['w1', 'w2', 'w3', 'w0'] }, ctx).status).toBe('correct');
  });
  it('gives per-position credit when configured and penalises extra cards', () => {
    expect(def.grade(item, { order: ['w0', 'w1', 'w3', 'w2'] }, ctx).score).toBe(1);
    expect(def.grade(item, { order: ['w0', 'w1', 'w2', 'w3', 'x0'] }, ctx).score).toBe(1.5);
  });
});

describe('dictation', () => {
  const item: DictationItem = {
    type: 'dictation', id: 'itm_d', prompt: '', audio: { assetId: 'ast_a', transcript: '' }, text: 'The water cycle never stops.', alternatives: [],
    maxPlays: 3, slowSpeed: true, typoHalf: true, match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, points: 5, feedback: {}, skills: [],
  };
  const def = getItemDefinition('dictation');
  it('aligns words: missing, extra, wrong and typos', () => {
    const d = diffWords(['the', 'water', 'cycle', 'never', 'stops'], ['the', 'watter', 'cycle', 'stops', 'now'], true);
    expect(d.ops.map((o) => o.op)).toEqual(['match', 'typo', 'match', 'missing', 'match', 'extra']);
    expect(diffWords(['a', 'dog'], ['a', 'cat'], true).ops.map((o) => o.op)).toEqual(['match', 'wrong']);
    expect(d.mistakes).toBe(2.5);
  });
  it('scores 1 − mistakes/words', () => {
    expect(def.grade(item, { text: 'the water cycle never stops' }, ctx)).toMatchObject({ status: 'correct', score: 5 });
    expect(def.grade(item, { text: 'The watter cycle stops.' }, ctx).score).toBe(3.5); // typo 0.5 + missing 1
    expect(dictationResult(item, 'completely different words here', 'en').mistakes).toBeGreaterThan(3);
  });
  it('typos count fully when typo tolerance is off', () => {
    expect(def.grade({ ...item, typoHalf: false }, { text: 'The watter cycle never stops.' }, ctx).score).toBe(4);
  });
});

describe('speaking practice', () => {
  const item: SpeakingItem = {
    type: 'speaking', id: 'itm_sp', prompt: '', language: 'en-GB', targets: [{ id: 't1', text: 'thirty-three', focus: '/θ/', modelAudio: null }, { id: 't2', text: 'Thank you', focus: '', modelAudio: null }],
    ttsFallback: true, modelBeforeRecording: true, maxRecordings: null, maxSeconds: 30, submission: 'required', selfAssessment: true, speechToText: false, scoring: 'completion', points: 2, feedback: {}, skills: ['pronunciation'],
  };
  const def = getItemDefinition('speaking');
  const resp = (sel: string | null) => ({ targets: { t1: { recordings: 2, selectedRecordingId: sel, selfRating: 2 as const, heard: null } } });
  it('awards completion credit only, and says so', () => {
    const r = def.grade(item, resp('rec_1'), ctx);
    expect(r).toMatchObject({ status: 'partial', score: 1 });
    expect(r.feedback).toMatch(/not for pronunciation accuracy/);
  });
  it('a required submission needs a chosen recording', () => {
    expect(def.grade(item, resp(null), ctx).score).toBe(0);
  });
  it('teacher-review mode never auto-scores', () => {
    expect(def.grade({ ...item, scoring: 'teacher-review' }, resp('rec_1'), ctx).status).toBe('needs-review');
  });
  it('reports speech-to-text as what was heard, not as a score', () => {
    const d = def.describeResponse(item, { targets: { t1: { recordings: 1, selectedRecordingId: null, selfRating: null, heard: { transcript: 'thirty three', matched: true, onDevice: false } } } });
    expect(d).toMatch(/not a pronunciation score/);
  });
  it('transcript comparison ignores case, punctuation and hyphens', () => {
    expect(transcriptMatches('thirty-three', 'Thirty three', 'en')).toBe(true);
    expect(transcriptMatches('thirty-three', 'dirty tree', 'en')).toBe(false);
  });
});

describe('audio blocks and cues', () => {
  it('validates transcripts and links', () => {
    const a = createActivity('Listening');
    a.items = [
      { type: 'audio', id: 'itm_au', title: 'Clip 1', instructions: '', audio: { assetId: 'ast_1', transcript: '' }, maxPlays: 2, speeds: [1], transcript: 'after-submit' },
      { ...mc(), audioCue: { audioItemId: 'itm_missing', start: 5, end: 2 } },
    ];
    const msgs = validateActivity(a).map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/Add a transcript/);
    expect(msgs).toMatch(/no longer exists/);
    expect(msgs).toMatch(/ends before it starts/);
  });
  it('migrates v2 activities to v3', () => {
    expect(migrateActivityJson({ schemaVersion: 2, pools: [] })).toMatchObject({ schemaVersion: 3 });
  });
});
