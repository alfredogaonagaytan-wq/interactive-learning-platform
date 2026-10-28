import { z } from 'zod';
import { ContentItemSchema } from '../items/content';
import { FillBlanksItemSchema } from '../items/fillBlanks';
import { MultipleChoiceItemSchema } from '../items/multipleChoice';
import { TrueFalseItemSchema } from '../items/trueFalse';
import { IdSchema, LanguageTagSchema, ShortTextSchema, TextSchema } from './common';

export const CURRENT_SCHEMA_VERSION = 1 as const;

/**
 * All item types share one discriminated union. New question types are added
 * here (schema) + in items/registry.ts (grading) + in the web plugin registry (UI).
 */
export const ItemSchema = z.discriminatedUnion('type', [
  ContentItemSchema,
  MultipleChoiceItemSchema,
  TrueFalseItemSchema,
  FillBlanksItemSchema,
]);
export type Item = z.infer<typeof ItemSchema>;
export type ItemType = Item['type'];

export const ActivitySettingsSchema = z.object({
  /** Number of full submissions allowed. null = unlimited. */
  maxAttempts: z.number().int().min(1).max(100).nullable().default(null),
  /**
   * immediate     – students may "Check" each item while working
   * on-submit     – results appear after submitting
   * after-release – results stay hidden until the teacher releases them
   */
  feedbackTiming: z.enum(['immediate', 'on-submit', 'after-release']).default('immediate'),
  /** Checks allowed per item in immediate mode. null = unlimited. */
  checksPerItem: z.number().int().min(1).max(20).nullable().default(null),
  /** When correct answers may be shown to students. */
  answerReveal: z.enum(['never', 'after-submit', 'after-final-attempt', 'after-release']).default('after-submit'),
  showHints: z.boolean().default(true),
  shuffleItems: z.boolean().default(false),
  /** Percentage needed to be reported as "met". null = no threshold. */
  passingPercent: z.number().min(0).max(100).nullable().default(null),
});
export type ActivitySettings = z.infer<typeof ActivitySettingsSchema>;
export const DEFAULT_SETTINGS: ActivitySettings = ActivitySettingsSchema.parse({});

export const ActivitySchema = z.object({
  kind: z.literal('ilp.activity'),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: IdSchema,
  title: ShortTextSchema,
  description: TextSchema.default(''),
  language: LanguageTagSchema.default('en'),
  subject: z.string().max(120).default(''),
  gradeBand: z.string().max(60).default(''),
  items: z.array(ItemSchema).max(500),
  settings: ActivitySettingsSchema.default(DEFAULT_SETTINGS),
  /** Increments on every saved edit of the draft. */
  revision: z.number().int().min(0).default(0),
  /** Latest published version number, if any. */
  publishedVersion: z.number().int().min(1).nullable().default(null),
  /** Draft revision that was last published (to detect unpublished changes). */
  publishedRevision: z.number().int().min(0).nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Activity = z.infer<typeof ActivitySchema>;

/**
 * Immutable snapshot students actually complete. Editing the draft never
 * changes a published version, so completed submissions keep their meaning.
 */
export const PublishedVersionSchema = z.object({
  kind: z.literal('ilp.publishedVersion'),
  activityId: IdSchema,
  version: z.number().int().min(1),
  publishedAt: z.iso.datetime(),
  contentHash: z.string().startsWith('sha256:'),
  activity: ActivitySchema,
});
export type PublishedVersion = z.infer<typeof PublishedVersionSchema>;
