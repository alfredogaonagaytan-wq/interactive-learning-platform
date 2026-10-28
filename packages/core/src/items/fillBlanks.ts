import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, MatchOptionsSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';

export const BlankSegmentSchema = z.object({
  kind: z.literal('blank'),
  id: IdSchema,
  /** First answer is the model answer; the rest are accepted alternatives. */
  answers: z.array(ShortTextSchema).min(1).max(50),
  hint: ShortTextSchema.optional(),
});
export const TextSegmentSchema = z.object({ kind: z.literal('text'), text: TextSchema });
export const SegmentSchema = z.discriminatedUnion('kind', [TextSegmentSchema, BlankSegmentSchema]);
export type BlankSegment = z.infer<typeof BlankSegmentSchema>;
export type Segment = z.infer<typeof SegmentSchema>;

/**
 * Fill in the blanks (typed cloze). The passage is stored as structured
 * segments, not as markup, so the data model does not depend on editor syntax.
 */
export const FillBlanksItemSchema = z.object({
  type: z.literal('fill-blanks'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema.default(''),
  segments: z.array(SegmentSchema).max(500),
  match: MatchOptionsSchema.default({ caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }),
  points: PointsSchema.default(1),
  /** per-blank: points are shared equally between blanks. */
  scoring: z.enum(['per-blank', 'all-or-nothing']).default('per-blank'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type FillBlanksItem = z.infer<typeof FillBlanksItemSchema>;
export interface FillBlanksResponse {
  values: Record<string, string>;
}

/**
 * Editor markup <-> segments.
 * Syntax: "The cat [sat | was sitting] on the mat."  Use \[ and \] for literal brackets.
 * Alternatives are separated by "|". Existing blank ids/hints are preserved by position.
 */
export function parseBlankMarkup(markup: string, previous: Segment[] = [], newId: () => string): Segment[] {
  const prevBlanks = previous.filter((s): s is BlankSegment => s.kind === 'blank');
  const segments: Segment[] = [];
  let text = '';
  let blankIndex = 0;
  for (let i = 0; i < markup.length; i++) {
    const ch = markup[i]!;
    if (ch === '\\' && (markup[i + 1] === '[' || markup[i + 1] === ']')) {
      text += markup[i + 1];
      i++;
      continue;
    }
    if (ch === '[') {
      const end = findClose(markup, i + 1);
      if (end === -1) {
        text += ch;
        continue;
      }
      const inner = markup.slice(i + 1, end).replace(/\\([[\]])/g, '$1');
      const answers = inner.split('|').map((a) => a.trim()).filter((a) => a.length > 0);
      if (answers.length === 0) {
        text += markup.slice(i, end + 1);
        i = end;
        continue;
      }
      if (text) segments.push({ kind: 'text', text });
      text = '';
      const prev = prevBlanks[blankIndex];
      segments.push({ kind: 'blank', id: prev?.id ?? newId(), answers, ...(prev?.hint ? { hint: prev.hint } : {}) });
      blankIndex++;
      i = end;
      continue;
    }
    text += ch;
  }
  if (text) segments.push({ kind: 'text', text });
  return segments;
}

function findClose(s: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '[') return -1;
    if (s[j] === ']') return j;
  }
  return -1;
}

export function serializeBlankMarkup(segments: Segment[]): string {
  const esc = (t: string) => t.replace(/([[\]])/g, '\\$1');
  return segments.map((s) => (s.kind === 'text' ? esc(s.text) : `[${s.answers.map(esc).join(' | ')}]`)).join('');
}

export function blanksOf(item: FillBlanksItem): BlankSegment[] {
  return item.segments.filter((s): s is BlankSegment => s.kind === 'blank');
}
