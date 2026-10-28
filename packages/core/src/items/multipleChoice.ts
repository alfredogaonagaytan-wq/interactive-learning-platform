import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';

export const ChoiceSchema = z.object({
  id: IdSchema,
  text: ShortTextSchema,
  correct: z.boolean(),
  /** Shown when the student selects this choice and feedback is visible. */
  feedback: ShortTextSchema.optional(),
});
export type Choice = z.infer<typeof ChoiceSchema>;

/**
 * Multiple choice ("single") and multiple response ("multiple").
 * Partial credit for multiple response is opt-in:
 *   score = points * max(0, (correctSelected - incorrectSelected) / totalCorrect)
 */
export const MultipleChoiceItemSchema = z.object({
  type: z.literal('multiple-choice'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema,
  mode: z.enum(['single', 'multiple']).default('single'),
  choices: z.array(ChoiceSchema).max(20),
  shuffleChoices: z.boolean().default(false),
  points: PointsSchema.default(1),
  scoring: z.enum(['all-or-nothing', 'partial']).default('all-or-nothing'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type MultipleChoiceItem = z.infer<typeof MultipleChoiceItemSchema>;
export interface MultipleChoiceResponse {
  choiceIds: string[];
}
