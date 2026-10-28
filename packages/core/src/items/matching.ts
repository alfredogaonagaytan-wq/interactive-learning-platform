import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, ImageRefSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { outcome, outcomeFeedback, sameText, type ItemDefinition } from './definition';

/**
 * Matching (words ↔ definitions, images ↔ words). Students place each
 * right-hand card next to a left-hand prompt. Extra right-hand cards act as
 * distractors. Cards with identical text are interchangeable.
 */
export const MatchPairSchema = z.object({
  id: IdSchema,
  left: ShortTextSchema.default(''),
  leftImage: ImageRefSchema.nullable().default(null),
  right: ShortTextSchema,
});
export const MatchingItemSchema = z.object({
  type: z.literal('matching'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema.default(''),
  pairs: z.array(MatchPairSchema).max(30),
  distractors: z.array(ShortTextSchema).max(20).default([]),
  points: PointsSchema.default(1),
  scoring: z.enum(['per-pair', 'all-or-nothing']).default('per-pair'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type MatchingItem = z.infer<typeof MatchingItemSchema>;
export type MatchPair = z.infer<typeof MatchPairSchema>;
/** matches: pairId (left) -> card id */
export interface MatchingResponse {
  matches: Record<string, string>;
}

export function matchingCards(item: MatchingItem): Array<{ id: string; text: string }> {
  return [...item.pairs.map((p) => ({ id: `r-${p.id}`, text: p.right })), ...item.distractors.map((d, i) => ({ id: `d-${i}`, text: d }))];
}

export const matchingDefinition: ItemDefinition<MatchingItem, MatchingResponse> = {
  type: 'matching',
  label: 'Matching',
  scorable: true,
  emptyResponse: () => ({ matches: {} }),
  isAnswered: (_i, r) => !!r && Object.keys(r.matches).length > 0,
  maxScore: (i) => i.points,
  assets: (i) => i.pairs.flatMap((p) => (p.leftImage ? [p.leftImage.assetId] : [])),
  grade(item, response) {
    const cards = new Map(matchingCards(item).map((c) => [c.id, c.text]));
    const parts: PartResult[] = item.pairs.map((p) => {
      const given = cards.get(response?.matches[p.id] ?? '');
      if (given === undefined) return { partId: p.id, correct: false, reason: 'blank' };
      const correct = sameText(given, p.right);
      return { partId: p.id, correct, given, ...(correct ? {} : { reason: 'no-match' as const }) };
    });
    const n = parts.filter((x) => x.correct).length;
    const total = item.pairs.length;
    const raw = total === 0 ? 0 : item.scoring === 'all-or-nothing' ? (n === total ? item.points : 0) : (item.points * n) / total;
    const score = roundScore(raw);
    const status = outcome(score, item.points, parts.some((x) => x.given !== undefined));
    const feedback = outcomeFeedback(item.feedback, status);
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const at = (message: string) => issues.push({ itemId: item.id, path: 'pairs', message });
    if (item.pairs.length < 2) at('Add at least two pairs.');
    if (item.pairs.some((p) => !p.left.trim() && !p.leftImage)) at('Each pair needs text or an image on the left.');
    if (item.pairs.some((p) => !p.right.trim())) at('Each pair needs a match on the right.');
    if (item.pairs.some((p) => p.leftImage && !p.leftImage.decorative && !p.leftImage.alt.trim() && !p.left.trim())) at('Add alt text to each image (describe it for screen-reader users).');
    if (item.distractors.some((d) => !d.trim())) at('An extra card is empty.');
    return issues;
  },
  correctAnswers: (i) => i.pairs.map((p) => `${p.left || p.leftImage?.alt || 'image'} → ${p.right}`),
  describeResponse(i, r) {
    const cards = new Map(matchingCards(i).map((c) => [c.id, c.text]));
    return i.pairs.map((p) => `${p.left || p.leftImage?.alt || 'image'} → ${cards.get(r?.matches[p.id] ?? '') ?? '—'}`).join('; ');
  },
};
