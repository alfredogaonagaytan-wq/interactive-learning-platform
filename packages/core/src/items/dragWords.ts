import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { SegmentSchema, type BlankSegment, type Segment } from './fillBlanks';
import { outcome, outcomeFeedback, sameText, type ItemDefinition } from './definition';

/**
 * Drag the words: students move word tokens into gaps. Each gap's first
 * answer becomes a draggable token; other answers are also accepted in that
 * gap. Identical tokens are interchangeable (grading compares text).
 */
export const DragWordsItemSchema = z.object({
  type: z.literal('drag-words'),
  id: IdSchema,
  /** Optional link to an audio clip in this activity (listening tasks). */
  audioCue: AudioCueField,
  prompt: TextSchema.default(''),
  segments: z.array(SegmentSchema).max(500),
  distractors: z.array(ShortTextSchema).max(30).default([]),
  points: PointsSchema.default(1),
  scoring: z.enum(['per-blank', 'all-or-nothing']).default('per-blank'),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type DragWordsItem = z.infer<typeof DragWordsItemSchema>;
/** placements: blankId -> tokenId */
export interface DragWordsResponse {
  placements: Record<string, string>;
}

export interface WordToken {
  id: string;
  text: string;
}

const gaps = (segments: Segment[]) => segments.filter((s): s is BlankSegment => s.kind === 'blank');

/** Tokens offered to the student: one per gap (its first answer) plus distractors. Stable ids. */
export function dragWordTokens(item: DragWordsItem): WordToken[] {
  return [...gaps(item.segments).map((b) => ({ id: `t-${b.id}`, text: b.answers[0] ?? '' })), ...item.distractors.map((d, i) => ({ id: `d-${i}`, text: d }))];
}

export const dragWordsDefinition: ItemDefinition<DragWordsItem, DragWordsResponse> = {
  type: 'drag-words',
  label: 'Drag the words',
  scorable: true,
  emptyResponse: () => ({ placements: {} }),
  isAnswered: (_i, r) => !!r && Object.keys(r.placements).length > 0,
  maxScore: (i) => i.points,
  grade(item, response) {
    const tokens = new Map(dragWordTokens(item).map((t) => [t.id, t.text]));
    const blanks = gaps(item.segments);
    const parts: PartResult[] = blanks.map((b) => {
      const tokenId = response?.placements[b.id];
      const given = tokenId ? tokens.get(tokenId) : undefined;
      if (given === undefined) return { partId: b.id, correct: false, reason: 'blank' };
      const correct = b.answers.some((a) => sameText(a, given));
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
    if (gaps(item.segments).length === 0) issues.push({ itemId: item.id, path: 'segments', message: 'Add at least one gap using [square brackets].' });
    if (item.distractors.some((d) => !d.trim())) issues.push({ itemId: item.id, path: 'distractors', message: 'An extra word is empty.' });
    return issues;
  },
  correctAnswers: (i) => gaps(i.segments).map((b) => b.answers.join(' / ')),
  describeResponse(i, r) {
    const tokens = new Map(dragWordTokens(i).map((t) => [t.id, t.text]));
    return gaps(i.segments).map((b) => tokens.get(r?.placements[b.id] ?? '') ?? '—').join('; ');
  },
};
