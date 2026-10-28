import { z } from 'zod';
import { AudioCueField, IdSchema, PointsSchema, ShortTextSchema, SkillTagsSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { rubricMax, writingChecks, WritingTaskSchema, type WritingResponse } from '../reading/writing';
import type { ItemDefinition } from './definition';

/** Stand-alone structured writing (e.g. a CER explanation after a lab) without a reading. */
export const WritingItemSchema = z.object({
  type: z.literal('writing'),
  id: IdSchema,
  audioCue: AudioCueField,
  title: ShortTextSchema.default(''),
  task: WritingTaskSchema,
  scoring: z.enum(['teacher-review', 'completion', 'none']).default('teacher-review'),
  points: PointsSchema.default(10),
  skills: SkillTagsSchema,
});
export type WritingItem = z.infer<typeof WritingItemSchema>;

const hasText = (r: WritingResponse | undefined) => !!r && Object.values(r.sections).some((t) => t.trim());

export const writingDefinition: ItemDefinition<WritingItem, WritingResponse> = {
  type: 'writing',
  label: 'Structured writing',
  scorable: true,
  emptyResponse: () => ({ sections: {}, successChecks: {}, rubricSelf: {} }),
  isAnswered: (_i, r) => hasText(r),
  maxScore: (i) => (i.scoring === 'none' ? 0 : i.scoring === 'teacher-review' && i.task.rubric.length ? rubricMax(i.task.rubric) : i.points),
  grade(item, response) {
    const checks = writingChecks(item.task, response);
    const parts: PartResult[] = checks.map((c) => ({ partId: c.id, correct: c.met, given: `${c.label}: ${c.detail}`, ...(c.met ? {} : { reason: 'missing' as const }) }));
    const max = writingDefinition.maxScore(item);
    const base = { itemId: item.id, itemType: item.type, parts, skills: item.skills, maxScore: max };
    if (item.scoring === 'none') return { ...base, status: 'ungraded', score: 0, maxScore: 0 };
    if (!hasText(response)) return { ...base, status: 'unanswered', score: 0 };
    if (item.scoring === 'teacher-review') return { ...base, status: 'needs-review', score: 0, feedback: 'Your teacher will assess your writing with the rubric.' };
    const met = checks.filter((c) => c.met).length;
    const score = roundScore(checks.length ? (max * met) / checks.length : max);
    return { ...base, score, status: score >= max ? 'correct' : score > 0 ? 'partial' : 'incorrect' };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    if (item.task.sections.length === 0) issues.push({ itemId: item.id, path: 'task', message: 'Add at least one writing section.' });
    if (item.task.sections.some((s) => !s.label.trim())) issues.push({ itemId: item.id, path: 'task', message: 'A writing section has no name.' });
    return issues;
  },
  correctAnswers: () => [],
  describeResponse: (i, r) => i.task.sections.map((s) => `${s.label}: ${(r?.sections[s.id] ?? '').trim() || '—'}`).join(' | '),
};
