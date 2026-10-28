import { z } from 'zod';
import { IdSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { isApproved, readingUnits, ReadingDocSchema, type ReadingDoc } from '../reading/document';
import { countWords, rubricMax, writingChecks, WritingTaskSchema, type RequirementCheck, type WritingResponse } from '../reading/writing';
import { randomId } from '../ids';
import type { ItemDefinition } from './definition';

/**
 * Cornell-style Observation Notes: the original reading beside a notes panel.
 * Students highlight and tag text with the teacher's observation symbols,
 * answer paragraph prompts, keep Cornell notes and write a structured response
 * (CER / TCTAC / Toulmin / custom). Structure is checked automatically; quality
 * is assessed by the teacher with the rubric.
 */
export const SYMBOL_COLORS = ['amber', 'sky', 'rose', 'green', 'violet', 'teal', 'orange', 'slate'] as const;
export const ObservationSymbolSchema = z.object({
  id: IdSchema,
  /** Short code shown on the highlight, e.g. "EV", "?", "VOC". */
  code: z.string().min(1).max(4),
  label: ShortTextSchema,
  description: ShortTextSchema.default(''),
  color: z.enum(SYMBOL_COLORS).default('amber'),
});
export type ObservationSymbol = z.infer<typeof ObservationSymbolSchema>;

export const ObservationNotesItemSchema = z.object({
  type: z.literal('observation-notes'),
  id: IdSchema,
  title: ShortTextSchema.default(''),
  instructions: TextSchema.default(''),
  reading: ReadingDocSchema,
  symbols: z.array(ObservationSymbolSchema).min(1).max(12),
  /** Questions attached to particular paragraphs/units of the reading. */
  prompts: z.array(z.object({ id: IdSchema, unitId: IdSchema.or(z.string().max(120)), question: ShortTextSchema })).max(50).default([]),
  cornell: z.object({ enabled: z.boolean().default(true), summaryMinWords: z.number().int().min(0).max(1000).default(0) }).default({ enabled: true, summaryMinWords: 0 }),
  /** Minimum observations per symbol id. */
  minAnnotations: z.record(z.string(), z.number().int().min(0).max(100)).default({}),
  answerAllPrompts: z.boolean().default(true),
  writing: WritingTaskSchema.nullable().default(null),
  scoring: z.enum(['teacher-review', 'completion', 'none']).default('teacher-review'),
  points: PointsSchema.default(10),
  skills: SkillTagsSchema,
});
export type ObservationNotesItem = z.infer<typeof ObservationNotesItemSchema>;

export const AnnotationSchema = z.object({
  id: IdSchema,
  unitId: z.string().max(120),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  /** The exact text highlighted (stored so a report can show it). */
  quote: z.string().max(5000),
  symbolId: IdSchema,
  note: z.string().max(5000).default(''),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export interface ObservationNotesResponse extends WritingResponse {
  annotations: Annotation[];
  prompts: Record<string, string>;
  cues: Array<{ id: string; text: string }>;
  notes: string;
  summary: string;
}

export const SYMBOL_PRESETS: Record<'science' | 'ela', { label: string; symbols: () => ObservationSymbol[] }> = {
  science: {
    label: 'Science (CER)',
    symbols: () => [
      { id: randomId('sym'), code: 'VOC', label: 'Vocabulary', description: 'A science word to know', color: 'sky' },
      { id: randomId('sym'), code: '?', label: 'Question or confusion', description: 'Something I wonder or do not understand', color: 'rose' },
      { id: randomId('sym'), code: 'KEY', label: 'Key concept', description: 'A main science idea', color: 'violet' },
      { id: randomId('sym'), code: 'EV', label: 'Evidence', description: 'Data or facts that support a claim', color: 'green' },
      { id: randomId('sym'), code: 'C→E', label: 'Cause and effect', description: 'Something that makes something else happen', color: 'orange' },
      { id: randomId('sym'), code: 'CMP', label: 'Comparison', description: 'How two things are alike or different', color: 'teal' },
    ],
  },
  ela: {
    label: 'ELA (argument / Toulmin)',
    symbols: () => [
      { id: randomId('sym'), code: 'CL', label: 'Claim', description: 'The author’s position', color: 'violet' },
      { id: randomId('sym'), code: 'EV', label: 'Evidence', description: 'Support the author gives', color: 'green' },
      { id: randomId('sym'), code: 'R', label: 'Reasoning', description: 'How the author connects evidence to the claim', color: 'amber' },
      { id: randomId('sym'), code: 'CA', label: 'Counterargument', description: 'An opposing view and the response', color: 'rose' },
      { id: randomId('sym'), code: 'VOC', label: 'Vocabulary / word choice', description: 'A word or phrase worth noticing', color: 'sky' },
      { id: randomId('sym'), code: '?', label: 'Question', description: 'Something I wonder about', color: 'slate' },
    ],
  },
};

/** Annotations whose anchor still matches the reading exactly (others are ignored, never guessed). */
export function validAnnotations(reading: ReadingDoc, annotations: Annotation[]): Annotation[] {
  const units = new Map(readingUnits(reading).map((u) => [u.id, u.text]));
  return annotations.filter((a) => {
    const t = units.get(a.unitId);
    return t !== undefined && a.end > a.start && a.end <= t.length && t.slice(a.start, a.end) === a.quote;
  });
}

export function observationChecks(item: ObservationNotesItem, r: ObservationNotesResponse | undefined): RequirementCheck[] {
  const checks: RequirementCheck[] = [];
  const anns = validAnnotations(item.reading, r?.annotations ?? []);
  for (const s of item.symbols) {
    const min = item.minAnnotations[s.id] ?? 0;
    if (min > 0) {
      const n = anns.filter((a) => a.symbolId === s.id).length;
      checks.push({ id: `ann:${s.id}`, label: `Mark at least ${min} × ${s.label} (${s.code})`, met: n >= min, detail: `${n} marked` });
    }
  }
  if (item.answerAllPrompts && item.prompts.length > 0) {
    const n = item.prompts.filter((p) => (r?.prompts[p.id] ?? '').trim()).length;
    checks.push({ id: 'prompts', label: 'Answer every paragraph question', met: n === item.prompts.length, detail: `${n} of ${item.prompts.length} answered` });
  }
  if (item.cornell.enabled && item.cornell.summaryMinWords > 0) {
    const n = countWords(r?.summary ?? '');
    checks.push({ id: 'summary', label: `Summary: at least ${item.cornell.summaryMinWords} words`, met: n >= item.cornell.summaryMinWords, detail: `${n} words` });
  }
  if (item.writing) checks.push(...writingChecks(item.writing, r));
  return checks;
}

const hasWork = (r: ObservationNotesResponse | undefined) =>
  !!r && (r.annotations.length > 0 || Object.values(r.prompts).some((t) => t.trim()) || r.notes.trim() !== '' || r.summary.trim() !== '' || r.cues.some((c) => c.text.trim()) || Object.values(r.sections ?? {}).some((t) => t.trim()));

export const observationNotesDefinition: ItemDefinition<ObservationNotesItem, ObservationNotesResponse> = {
  type: 'observation-notes',
  label: 'Observation notes',
  scorable: true,
  emptyResponse: () => ({ annotations: [], prompts: {}, cues: [], notes: '', summary: '', sections: {}, successChecks: {}, rubricSelf: {} }),
  isAnswered: (_i, r) => hasWork(r),
  maxScore: (i) => (i.scoring === 'none' ? 0 : i.scoring === 'teacher-review' && i.writing?.rubric.length ? rubricMax(i.writing.rubric) : i.points),
  assets: (i) => [
    ...(i.reading.original?.assetId ? [i.reading.original.assetId] : []),
    ...i.reading.blocks.flatMap((b) => (b.kind === 'figure' && b.image ? [b.image.assetId] : [])),
  ],
  grade(item, response) {
    const checks = observationChecks(item, response);
    const parts: PartResult[] = checks.map((c) => ({ partId: c.id, correct: c.met, given: `${c.label}: ${c.detail}`, ...(c.met ? {} : { reason: 'missing' as const }) }));
    const max = observationNotesDefinition.maxScore(item);
    const base = { itemId: item.id, itemType: item.type, parts, skills: item.skills, maxScore: max };
    if (item.scoring === 'none') return { ...base, status: 'ungraded', score: 0, maxScore: 0 };
    if (!hasWork(response)) return { ...base, status: 'unanswered', score: 0 };
    if (item.scoring === 'teacher-review') return { ...base, status: 'needs-review', score: 0, feedback: 'Your teacher will read your notes and writing. The checklist shows which requirements are already met.' };
    const met = checks.filter((c) => c.met).length;
    const score = roundScore(checks.length ? (max * met) / checks.length : max);
    return { ...base, score, status: score >= max ? 'correct' : score > 0 ? 'partial' : 'incorrect', feedback: 'Points are for completing the required parts; your teacher may also review the quality.' };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const at = (path: string, message: string) => issues.push({ itemId: item.id, path, message });
    if (item.reading.blocks.length === 0) at('reading', 'Add the reading (paste it or upload a file).');
    else if (!isApproved(item.reading)) at('reading', 'Compare the reading with the original and approve it before publishing.');
    const codes = item.symbols.map((s) => s.code.trim().toLowerCase());
    if (new Set(codes).size !== codes.length) at('symbols', 'Two observation symbols use the same code.');
    if (item.symbols.some((s) => !s.label.trim() || !s.code.trim())) at('symbols', 'Every symbol needs a code and a name.');
    const units = new Set(readingUnits(item.reading).map((u) => u.id));
    if (item.prompts.some((p) => !units.has(p.unitId))) at('prompts', 'A paragraph question points to text that is no longer in the reading.');
    if (item.prompts.some((p) => !p.question.trim())) at('prompts', 'A paragraph question is empty.');
    if (item.writing) {
      if (item.writing.sections.length === 0) at('writing', 'The writing task has no sections.');
      if (item.writing.sections.some((s) => !s.label.trim())) at('writing', 'A writing section has no name.');
      if (item.writing.rubric.some((c) => !c.label.trim() || c.levels.some((l) => !l.label.trim()))) at('writing', 'Every rubric criterion and level needs a name.');
    }
    return issues;
  },
  correctAnswers: () => [],
  describeResponse(item, r) {
    if (!r) return '';
    const anns = validAnnotations(item.reading, r.annotations);
    const bySym = item.symbols.map((s) => `${s.code}: ${anns.filter((a) => a.symbolId === s.id).length}`).join(', ');
    const writing = item.writing ? item.writing.sections.map((s) => `${s.label}: ${(r.sections[s.id] ?? '').trim() || '—'}`).join(' | ') : '';
    return [`Observations (${bySym})`, r.summary.trim() ? `Summary: ${r.summary.trim()}` : '', writing].filter(Boolean).join(' || ');
  },
};
