import { z } from 'zod';
import { IdSchema } from './common';

/**
 * A student's work on one published version. Stored locally (IndexedDB) and
 * autosaved continuously; later synced to Drive / submitted to the broker.
 * Contains no names or emails — only the pseudonymous number if known.
 */
export const AttemptSchema = z.object({
  kind: z.literal('ilp.attempt'),
  schemaVersion: z.literal(1),
  id: IdSchema,
  activityId: IdSchema,
  version: z.number().int().min(1),
  contentHash: z.string(),
  /** student = real work; preview = teacher's student-preview (never submitted). */
  mode: z.enum(['student', 'preview']),
  assignmentId: IdSchema.nullable().default(null),
  attemptNumber: z.number().int().min(1),
  status: z.enum(['in-progress', 'submitted']),
  responses: z.record(z.string(), z.unknown()).default({}),
  /** How many times "Check" was used per item (immediate feedback mode). */
  checks: z.record(z.string(), z.number().int().min(0)).default({}),
  hintsUsed: z.record(z.string(), z.number().int().min(0)).default({}),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable().default(null),
  /** Sync state for later phases; Phase 1 is always "local-only". */
  sync: z.enum(['local-only', 'pending', 'synced', 'conflict', 'error']).default('local-only'),
});
export type Attempt = z.infer<typeof AttemptSchema>;
