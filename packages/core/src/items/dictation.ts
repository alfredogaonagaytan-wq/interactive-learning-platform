import { z } from 'zod';
import { AudioRefSchema, FeedbackSchema, IdSchema, MatchOptionsSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { normalizeAnswer, applyEquivalences } from '../grading/normalize';
import { outcome, outcomeFeedback, type ItemDefinition } from './definition';

/**
 * Dictation: listen and type. Grading aligns the typed words with the
 * expected words (edit distance on words) and counts mistakes: a missing,
 * extra or wrong word is 1; with `typoHalf`, a word one letter off counts 0.5.
 * score = points × max(0, 1 − mistakes / words).
 */
export const DictationItemSchema = z.object({
  type: z.literal('dictation'),
  id: IdSchema,
  prompt: TextSchema.default('Listen and write what you hear.'),
  audio: AudioRefSchema.nullable().default(null),
  /** The exact text spoken. Alternatives allow other acceptable spellings of the whole text. */
  text: TextSchema,
  alternatives: z.array(TextSchema).max(10).default([]),
  maxPlays: z.number().int().min(1).max(20).nullable().default(3),
  slowSpeed: z.boolean().default(true),
  typoHalf: z.boolean().default(true),
  match: MatchOptionsSchema.default({ caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }),
  points: PointsSchema.default(1),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type DictationItem = z.infer<typeof DictationItemSchema>;
export interface DictationResponse {
  text: string;
}

export interface WordDiff {
  op: 'match' | 'typo' | 'wrong' | 'missing' | 'extra';
  expected?: string;
  given?: string;
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

const words = (s: string, item: DictationItem, lang: string) => {
  const n = applyEquivalences(normalizeAnswer(s, item.match, lang), item.match, lang);
  // When punctuation matters, keep it attached to words but compare it as part of the word.
  return n ? n.split(' ') : [];
};

/** Word-level alignment (minimum mistakes). Deterministic: ties prefer match/substitution, then deletion. */
export function diffWords(expected: string[], given: string[], typoHalf: boolean): { mistakes: number; ops: WordDiff[] } {
  const n = expected.length;
  const m = given.length;
  const sub = (e: string, g: string) => (e === g ? 0 : typoHalf && e.length >= 4 && lev(e, g) === 1 ? 0.5 : 1);
  const cost: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) cost[i]![0] = i;
  for (let j = 0; j <= m; j++) cost[0]![j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) cost[i]![j] = Math.min(cost[i - 1]![j - 1]! + sub(expected[i - 1]!, given[j - 1]!), cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
  const ops: WordDiff[] = [];
  let i = n;
  let j = m;
  // Traceback preference: exact/typo pairs, then missing, then extra, then wrong-word pairs.
  // (Readers understand "missing ... extra" better than two unrelated wrong words.)
  while (i > 0 || j > 0) {
    const diag = i > 0 && j > 0 ? sub(expected[i - 1]!, given[j - 1]!) : Infinity;
    if (diag < 1 && cost[i]![j] === cost[i - 1]![j - 1]! + diag) {
      ops.push({ op: diag === 0 ? 'match' : 'typo', expected: expected[i - 1]!, given: given[j - 1]! });
      i--;
      j--;
    } else if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      ops.push({ op: 'missing', expected: expected[i - 1]! });
      i--;
    } else if (j > 0 && cost[i]![j] === cost[i]![j - 1]! + 1) {
      ops.push({ op: 'extra', given: given[j - 1]! });
      j--;
    } else {
      ops.push({ op: 'wrong', expected: expected[i - 1]!, given: given[j - 1]! });
      i--;
      j--;
    }
  }
  return { mistakes: cost[n]![m]!, ops: ops.reverse() };
}

export function dictationResult(item: DictationItem, text: string, language: string): { mistakes: number; words: number; ops: WordDiff[] } {
  const given = words(text, item, language);
  let best: { mistakes: number; words: number; ops: WordDiff[] } | null = null;
  for (const target of [item.text, ...item.alternatives]) {
    const exp = words(target, item, language);
    const d = diffWords(exp, given, item.typoHalf);
    if (!best || d.mistakes < best.mistakes) best = { ...d, words: exp.length };
  }
  return best!;
}

export const dictationDefinition: ItemDefinition<DictationItem, DictationResponse> = {
  type: 'dictation',
  label: 'Dictation',
  scorable: true,
  emptyResponse: () => ({ text: '' }),
  isAnswered: (_i, r) => !!r && r.text.trim() !== '',
  maxScore: (i) => i.points,
  assets: (i) => (i.audio ? [i.audio.assetId] : []),
  grade(item, response, ctx) {
    const text = response?.text ?? '';
    const base = { itemId: item.id, itemType: item.type, maxScore: item.points, skills: item.skills };
    if (!text.trim()) return { ...base, status: 'unanswered', score: 0, parts: [] };
    const r = dictationResult(item, text, ctx.language);
    const score = roundScore(r.words ? item.points * Math.max(0, 1 - r.mistakes / r.words) : 0);
    const status = outcome(score, item.points, true);
    const parts: PartResult[] = r.ops.map((o, k) => ({
      partId: String(k),
      correct: o.op === 'match',
      ...(o.given !== undefined ? { given: o.given } : {}),
      ...(o.op === 'match' ? {} : { reason: o.op === 'wrong' ? ('wrong-word' as const) : o.op }),
    }));
    const summary = r.mistakes > 0 ? `${r.mistakes} mistake${r.mistakes === 1 ? '' : 's'} in ${r.words} words.` : undefined;
    const feedback = outcomeFeedback(item.feedback, status, [summary]);
    return { ...base, status, score, parts, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    if (!item.audio) issues.push({ itemId: item.id, path: 'audio', message: 'Choose or record the audio to dictate.' });
    if (!item.text.trim()) issues.push({ itemId: item.id, path: 'text', message: 'Enter the exact text that is spoken.' });
    return issues;
  },
  correctAnswers: (i) => [i.text],
  describeResponse: (_i, r) => r?.text ?? '',
};
