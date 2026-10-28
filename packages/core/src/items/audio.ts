import { z } from 'zod';
import { AudioRefSchema, IdSchema, ShortTextSchema, TextSchema } from '../schema/common';
import type { ValidationIssue } from '../grading/types';
import type { ItemDefinition } from './definition';

/**
 * Listening clip (not scored). Questions link to it through their `audioCue`.
 * Play limits are counted per attempt and survive reloads.
 */
export const AudioItemSchema = z.object({
  type: z.literal('audio'),
  id: IdSchema,
  title: ShortTextSchema.default(''),
  instructions: TextSchema.default(''),
  audio: AudioRefSchema.nullable().default(null),
  /** null = unlimited. Each play from the start (or of a linked segment) counts once. */
  maxPlays: z.number().int().min(1).max(20).nullable().default(null),
  /** Playback speeds students may choose; [1] hides the control. */
  speeds: z.array(z.number().min(0.5).max(2)).min(1).default([0.75, 1]),
  /** When students may read the transcript. */
  transcript: z.enum(['never', 'on-request', 'after-submit', 'always']).default('after-submit'),
});
export type AudioItem = z.infer<typeof AudioItemSchema>;

export const audioDefinition: ItemDefinition<AudioItem, Record<string, never>> = {
  type: 'audio',
  label: 'Audio clip',
  scorable: false,
  emptyResponse: () => ({}),
  isAnswered: () => true,
  grade: (item) => ({ itemId: item.id, itemType: item.type, status: 'ungraded', score: 0, maxScore: 0, parts: [], skills: [] }),
  validate(item) {
    const issues: ValidationIssue[] = [];
    if (!item.audio) issues.push({ itemId: item.id, path: 'audio', message: 'Choose or record an audio file.' });
    if (item.audio && item.transcript !== 'never' && !item.audio.transcript.trim()) {
      issues.push({ itemId: item.id, path: 'transcript', message: 'Add a transcript (needed for deaf and hard-of-hearing students), or set the transcript to “never shown”.' });
    }
    return issues;
  },
  correctAnswers: () => [],
  describeResponse: () => '',
  maxScore: () => 0,
  assets: (i) => (i.audio ? [i.audio.assetId] : []),
};
