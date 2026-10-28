import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, PointsSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { SegmentSchema, type BlankSegment, type Segment } from './fillBlanks';
import { outcome, outcomeFeedback, sameText, type ItemDefinition } from './definition';

/**
 * Dropdown cloze: each gap is a select box. In each gap the FIRST option is
 * the correct one; the others are distractors. Options are shuffled per
 * attempt in the player.
 */
export const DropdownClozeItemSchema = z.object({
  type: z.literal('dropdown-cloze'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema.default(''),
  segments: z.array(SegmentSchema).max(500),
  points: PointsSchema.default(1),
  scoring: z.enum(['per-blank', 'all-or-nothing']).default('per-blank'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type DropdownClozeItem = z.infer<typeof DropdownClozeItemSchema>;
export interface DropdownClozeResponse {
  values: Record<string, string>;
}

const gaps = (segments: Segment[]) => segments.filter((s): s is BlankSegment => s.kind === 'blank');

export const dropdownClozeDefinition: ItemDefinition<DropdownClozeItem, DropdownClozeResponse> = {
  type: 'dropdown-cloze',
  label: 'Dropdown cloze',
  scorable: true,
  emptyResponse: () => ({ values: {} }),
  isAnswered: (i, r) => !!r && gaps(i.segments).some((b) => !!r.values[b.id]),
  maxScore: (i) => i.points,
  grade(item, response) {
    const blanks = gaps(item.segments);
    const parts: PartResult[] = blanks.map((b) => {
      const given = response?.values[b.id];
      if (!given) return { partId: b.id, correct: false, reason: 'blank' };
      const correct = sameText(given, b.answers[0] ?? '');
      return { partId: b.id, correct, given, ...(correct ? {} : { reason: 'no-match' as const }) };
    });
    const n = parts.filter((p) => p.correct).length;
    const raw = blanks.length === 0 ? 0 : item.scoring === 'all-or-nothing' ? (n === blanks.length ? item.points : 0) : (item.points * n) / blanks.length;
    const score = roundScore(raw);
    const status = outcome(score, item.points, parts.some((p) => p.given !== undefined));
    const feedback = outcomeFeedback(item.feedback, status);
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const blanks = gaps(item.segments);
    if (blanks.length === 0) issues.push({ itemId: item.id, path: 'segments', message: 'Add at least one dropdown using [correct | wrong | wrong].' });
    if (blanks.some((b) => b.answers.length < 2)) issues.push({ itemId: item.id, path: 'segments', message: 'Each dropdown needs at least two options: [correct | wrong].' });
    if (blanks.some((b) => new Set(b.answers.map((a) => a.trim())).size !== b.answers.length)) issues.push({ itemId: item.id, path: 'segments', message: 'A dropdown repeats the same option.' });
    return issues;
  },
  correctAnswers: (i) => gaps(i.segments).map((b) => b.answers[0] ?? ''),
  describeResponse: (i, r) => gaps(i.segments).map((b) => r?.values[b.id] || '—').join('; '),
};
