import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, PointsSchema, SkillTagsSchema, TextSchema } from '../schema/common';

export const TrueFalseItemSchema = z.object({
  type: z.literal('true-false'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema,
  correct: z.boolean(),
  /** Labels can be localised or changed (e.g. "Agree"/"Disagree"). */
  trueLabel: z.string().max(80).default('True'),
  falseLabel: z.string().max(80).default('False'),
  points: PointsSchema.default(1),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type TrueFalseItem = z.infer<typeof TrueFalseItemSchema>;
export interface TrueFalseResponse {
  value: boolean | null;
}
