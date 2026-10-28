import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, MatchOptionsSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { canonicalAnswer } from '../grading/normalize';
import { outcome, outcomeFeedback, sameText, type ItemDefinition } from './definition';

/**
 * Sentence reconstruction (word order). The teacher writes the correct
 * sentence; it is split into word cards (or chunks separated by " / ").
 * Other correct orders can be listed as alternatives.
 */
export const SentenceBuilderItemSchema = z.object({
  type: z.literal('sentence-builder'),
  id: IdSchema,
  audioCue: AudioCueField,
  prompt: TextSchema.default('Put the words in the correct order.'),
  sentence: ShortTextSchema,
  alternatives: z.array(ShortTextSchema).max(20).default([]),
  distractors: z.array(ShortTextSchema).max(10).default([]),
  /** Show cards in lower case so the capital letter does not reveal the first word. */
  lowercaseCards: z.boolean().default(false),
  match: MatchOptionsSchema.default({ caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }),
  points: PointsSchema.default(1),
  scoring: z.enum(['all-or-nothing', 'per-position']).default('all-or-nothing'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type SentenceBuilderItem = z.infer<typeof SentenceBuilderItemSchema>;
export interface SentenceBuilderResponse {
  /** Card ids in the student's sentence, in order. */
  order: string[];
}

export interface BuilderCards {
  cards: Array<{ id: string; text: string }>;
  /** Final punctuation shown fixed at the end of the line (not a card). */
  ending: string;
  /** Card texts of the model sentence, in order. */
  solution: string[];
}

export function splitSentence(sentence: string): { parts: string[]; ending: string } {
  const trimmed = sentence.trim();
  const m = /^(.*?)([.?!]+)$/s.exec(trimmed);
  const body = m ? m[1]!.trim() : trimmed;
  const ending = m ? m[2]! : '';
  const parts = body.includes('/') ? body.split('/').map((p) => p.trim()).filter(Boolean) : body.split(/\s+/).filter(Boolean);
  return { parts, ending };
}

export function builderCards(item: SentenceBuilderItem): BuilderCards {
  const { parts, ending } = splitSentence(item.sentence);
  const show = (t: string) => (item.lowercaseCards && t !== 'I' && !t.startsWith('I\'') ? t.toLocaleLowerCase() : t);
  return {
    cards: [...parts.map((p, i) => ({ id: `w${i}`, text: show(p) })), ...item.distractors.map((d, i) => ({ id: `x${i}`, text: show(d) }))],
    ending,
    solution: parts.map(show),
  };
}

export function builtSentence(item: SentenceBuilderItem, order: string[]): string {
  const { cards, ending } = builderCards(item);
  const byId = new Map(cards.map((c) => [c.id, c.text]));
  return order.map((id) => byId.get(id) ?? '').join(' ') + ending;
}

export const sentenceBuilderDefinition: ItemDefinition<SentenceBuilderItem, SentenceBuilderResponse> = {
  type: 'sentence-builder',
  label: 'Sentence builder',
  scorable: true,
  emptyResponse: () => ({ order: [] }),
  isAnswered: (_i, r) => !!r && r.order.length > 0,
  maxScore: (i) => i.points,
  grade(item, response, ctx) {
    const order = response?.order ?? [];
    const { cards, solution } = builderCards(item);
    const byId = new Map(cards.map((c) => [c.id, c.text]));
    const built = builtSentence(item, order);
    // Lower-cased cards: never penalise the student for capitalisation we removed.
    const opts = item.lowercaseCards ? { ...item.match, caseSensitive: false } : item.match;
    const targets = [item.sentence, ...item.alternatives].map((s) => canonicalAnswer(s, opts, ctx.language));
    const full = order.length > 0 && targets.includes(canonicalAnswer(built, opts, ctx.language));
    const parts: PartResult[] = solution.map((t, i) => {
      const given = byId.get(order[i] ?? '');
      return { partId: String(i), correct: full || (given !== undefined && sameText(given, t)), ...(given !== undefined ? { given } : { reason: 'blank' as const }) };
    });
    const n = parts.filter((p) => p.correct).length;
    const extra = Math.max(0, order.length - solution.length);
    const raw = full ? item.points : item.scoring === 'per-position' && solution.length ? (item.points * Math.max(0, n - extra)) / solution.length : 0;
    const score = roundScore(raw);
    const status = outcome(score, item.points, order.length > 0);
    const feedback = outcomeFeedback(item.feedback, status);
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const { parts } = splitSentence(item.sentence);
    if (parts.length < 2) issues.push({ itemId: item.id, path: 'sentence', message: 'The sentence needs at least two words or chunks.' });
    if (parts.length > 30) issues.push({ itemId: item.id, path: 'sentence', message: 'Use at most 30 cards (group words with “ / ”).' });
    return issues;
  },
  correctAnswers: (i) => [i.sentence, ...i.alternatives],
  describeResponse: (i, r) => (r && r.order.length ? builtSentence(i, r.order) : ''),
};
