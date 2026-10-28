import { z } from 'zod';
import { IdSchema, ShortTextSchema, TextSchema } from '../schema/common';

/** Non-scored instructional text block (instructions, a short reading, a transition). */
export const ContentItemSchema = z.object({
  type: z.literal('content'),
  id: IdSchema,
  title: ShortTextSchema.default(''),
  body: TextSchema.default(''),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;
export type ContentResponse = Record<string, never>;
