import { z } from 'zod';
import { ID_PATTERN } from '../ids';

export const IdSchema = z.string().regex(ID_PATTERN, 'Invalid identifier');

/** Plain text authored by teachers. Rendered as text (never as HTML) in Phase 1. */
export const TextSchema = z.string().max(20_000);
export const ShortTextSchema = z.string().max(2_000);

/** BCP 47 language tag, e.g. "en", "en-US", "ko", "es-MX". */
export const LanguageTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Use a language tag such as en, en-US or ko');

export const FeedbackSchema = z.object({
  correct: ShortTextSchema.optional(),
  incorrect: ShortTextSchema.optional(),
  hint: ShortTextSchema.optional(),
  explanation: ShortTextSchema.optional(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

/**
 * Teacher-controlled answer matching. Defaults are deliberately forgiving about
 * things that are usually irrelevant (case, punctuation, extra spaces, curly
 * vs straight quotes) and strict about accents, which carry meaning in many
 * languages. Teachers can tighten any of these per item.
 */
export const MatchOptionsSchema = z.object({
  caseSensitive: z.boolean().default(false),
  punctuationSensitive: z.boolean().default(false),
  accentSensitive: z.boolean().default(true),
  /** Teacher-defined equivalent forms, e.g. ["do not", "don't"]. Each group is a set of interchangeable phrases. */
  equivalences: z.array(z.array(ShortTextSchema).min(2)).default([]),
});
export type MatchOptions = z.infer<typeof MatchOptionsSchema>;

export const SkillTagsSchema = z.array(z.string().min(1).max(80)).max(20).default([]);

export const PointsSchema = z.number().min(0).max(1000);
