import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, ImageRefSchema, PointsSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { outcome, outcomeFeedback, type ItemDefinition } from './definition';

/**
 * Ordering / sequencing / paragraph sorting. Steps are stored in the correct
 * order; the player presents a shuffled order that is never already correct.
 */
export const SequenceStepSchema = z.object({
  id: IdSchema,
  text: TextSchema.default(''),
  image: ImageRefSchema.nullable().default(null),
});
export const SequencingItemSchema = z.object({
  type: z.literal('sequencing'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema.default(''),
  /** "paragraph" renders long text blocks (Sort the Paragraphs); "list" renders compact cards. */
  display: z.enum(['list', 'paragraph']).default('list'),
  steps: z.array(SequenceStepSchema).max(30),
  points: PointsSchema.default(1),
  /** per-position: credit for each step in its correct place. */
  scoring: z.enum(['per-position', 'all-or-nothing']).default('per-position'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type SequencingItem = z.infer<typeof SequencingItemSchema>;
export interface SequencingResponse {
  /** Step ids in the student's order. Empty = not yet touched. */
  order: string[];
}

export const sequencingDefinition: ItemDefinition<SequencingItem, SequencingResponse> = {
  type: 'sequencing',
  label: 'Sequencing',
  scorable: true,
  emptyResponse: () => ({ order: [] }),
  isAnswered: (_i, r) => !!r && r.order.length > 0,
  maxScore: (i) => i.points,
  assets: (i) => i.steps.flatMap((s) => (s.image ? [s.image.assetId] : [])),
  grade(item, response) {
    const order = response?.order ?? [];
    const valid = order.length === item.steps.length && item.steps.every((s) => order.includes(s.id));
    const parts: PartResult[] = item.steps.map((s, i) => {
      const correct = valid && order[i] === s.id;
      return { partId: s.id, correct, ...(valid ? { given: String(order.indexOf(s.id) + 1) } : {}), ...(correct ? {} : { reason: valid ? ('no-match' as const) : ('blank' as const) }) };
    });
    const n = parts.filter((p) => p.correct).length;
    const total = item.steps.length;
    const raw = !valid || total === 0 ? 0 : item.scoring === 'all-or-nothing' ? (n === total ? item.points : 0) : (item.points * n) / total;
    const score = roundScore(raw);
    const status = outcome(score, item.points, valid);
    const feedback = outcomeFeedback(item.feedback, status);
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    if (item.steps.length < 2) issues.push({ itemId: item.id, path: 'steps', message: 'Add at least two steps.' });
    if (item.steps.some((s) => !s.text.trim() && !s.image)) issues.push({ itemId: item.id, path: 'steps', message: 'A step is empty.' });
    const texts = item.steps.filter((s) => !s.image).map((s) => s.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) issues.push({ itemId: item.id, path: 'steps', message: 'Two steps have the same text, so the correct order would be ambiguous.' });
    return issues;
  },
  correctAnswers: (i) => i.steps.map((s, k) => `${k + 1}. ${s.text || s.image?.alt || 'image'}`),
  describeResponse(i, r) {
    const byId = new Map(i.steps.map((s) => [s.id, s.text || s.image?.alt || 'image']));
    return (r?.order ?? []).map((id, k) => `${k + 1}. ${byId.get(id) ?? '?'}`).join('; ');
  },
};
