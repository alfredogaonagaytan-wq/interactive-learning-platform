import { z } from 'zod';
import { IdSchema, ShortTextSchema, TextSchema } from '../schema/common';
import { randomId } from '../ids';

/**
 * Structured writing frameworks (CER, TCTAC, Toulmin, or the teacher's own),
 * deterministic requirement checks, and rubrics for teacher assessment.
 * Requirement checks verify structure only (length, evidence citations,
 * required terms); quality is always assessed by the teacher with the rubric.
 */
export const WritingSectionSchema = z.object({
  id: IdSchema,
  label: ShortTextSchema,
  guidance: TextSchema.default(''),
  starters: z.array(ShortTextSchema).max(10).default([]),
  minWords: z.number().int().min(0).max(5000).default(0),
});
export type WritingSection = z.infer<typeof WritingSectionSchema>;

export const RubricLevelSchema = z.object({ id: IdSchema, label: ShortTextSchema, points: z.number().min(0).max(100), descriptor: TextSchema.default('') });
export const RubricCriterionSchema = z.object({ id: IdSchema, label: ShortTextSchema, levels: z.array(RubricLevelSchema).min(1).max(8) });
export const RubricSchema = z.array(RubricCriterionSchema).max(20);
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const WritingTaskSchema = z.object({
  framework: z.enum(['cer', 'tctac', 'toulmin', 'custom']).default('cer'),
  prompt: TextSchema.default(''),
  sections: z.array(WritingSectionSchema).max(12),
  /** Minimum distinct paragraph citations such as (¶3) across the writing. */
  minCitations: z.number().int().min(0).max(50).default(0),
  /** Terms the writing must use (case-insensitive), e.g. key vocabulary. */
  requiredTerms: z.array(ShortTextSchema).max(30).default([]),
  rubric: RubricSchema.default([]),
  /** "I can…" statements students can tick while writing. */
  successCriteria: z.array(z.object({ id: IdSchema, text: ShortTextSchema })).max(20).default([]),
  /** Let students rate themselves on the rubric (the teacher still decides). */
  rubricSelfAssessment: z.boolean().default(false),
});
export type WritingTask = z.infer<typeof WritingTaskSchema>;

export interface WritingResponse {
  sections: Record<string, string>;
  successChecks: Record<string, boolean>;
  rubricSelf: Record<string, string>;
}

const sid = (_p: 'sec') => randomId('sec');

export const FRAMEWORK_PRESETS: Record<Exclude<WritingTask['framework'], 'custom'>, { label: string; sections: () => WritingSection[] }> = {
  cer: {
    label: 'Claim, Evidence, Reasoning (CER)',
    sections: () => [
      { id: sid('sec'), label: 'Claim', guidance: 'One sentence that answers the question.', starters: ['I claim that…', 'The evidence shows that…'], minWords: 8 },
      { id: sid('sec'), label: 'Evidence', guidance: 'Data or quotations from the text that support your claim. Cite the paragraph, e.g. (¶3).', starters: ['According to paragraph…', 'The data show…'], minWords: 20 },
      { id: sid('sec'), label: 'Reasoning', guidance: 'Explain why the evidence supports the claim, using the science idea.', starters: ['This evidence supports my claim because…', 'This shows that…'], minWords: 25 },
    ],
  },
  tctac: {
    label: 'TCTAC (Topic, Context, Text evidence, Analysis, Conclusion)',
    sections: () => [
      { id: sid('sec'), label: 'Topic sentence', guidance: 'State your main point.', starters: ['In the text, the author shows that…'], minWords: 8 },
      { id: sid('sec'), label: 'Context', guidance: 'Briefly explain where the evidence comes from.', starters: ['Earlier in the text…', 'When…'], minWords: 10 },
      { id: sid('sec'), label: 'Text evidence', guidance: 'Quote or paraphrase the text and cite the paragraph, e.g. (¶4).', starters: ['The author writes, “…” (¶ )'], minWords: 10 },
      { id: sid('sec'), label: 'Analysis', guidance: 'Explain how the evidence proves your point.', starters: ['This shows…', 'The word “…” suggests…'], minWords: 25 },
      { id: sid('sec'), label: 'Concluding sentence', guidance: 'Connect back to your main point.', starters: ['Therefore…', 'In conclusion…'], minWords: 8 },
    ],
  },
  toulmin: {
    label: 'Toulmin argument (Claim, Grounds, Warrant, Backing, Qualifier, Rebuttal)',
    sections: () => [
      { id: sid('sec'), label: 'Claim', guidance: 'Your position.', starters: ['I argue that…'], minWords: 8 },
      { id: sid('sec'), label: 'Grounds', guidance: 'Evidence from the text (cite paragraphs).', starters: ['In paragraph…, the author states…'], minWords: 15 },
      { id: sid('sec'), label: 'Warrant', guidance: 'Why the grounds support the claim.', starters: ['This matters because…'], minWords: 15 },
      { id: sid('sec'), label: 'Backing', guidance: 'Further support for the warrant.', starters: ['This is supported by…'], minWords: 0 },
      { id: sid('sec'), label: 'Qualifier', guidance: 'Limits of the claim (usually, in most cases…).', starters: ['In most cases…'], minWords: 0 },
      { id: sid('sec'), label: 'Rebuttal', guidance: 'A counterargument and your response.', starters: ['Some might argue that…, however…'], minWords: 15 },
    ],
  },
};

export const countWords = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Distinct paragraph citations: (¶3), ¶ 3, (para 3), (paragraph 3), (p. 3) is NOT counted (page). */
export function citedParagraphs(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?:¶\s*|\bpara(?:graph)?\.?\s+)(\d{1,4})/gi)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

export function rubricMax(rubric: RubricCriterion[]): number {
  return rubric.reduce((s, c) => s + Math.max(0, ...c.levels.map((l) => l.points)), 0);
}

export interface RequirementCheck {
  id: string;
  label: string;
  met: boolean;
  detail: string;
}

export function writingChecks(task: WritingTask, r: WritingResponse | undefined): RequirementCheck[] {
  const checks: RequirementCheck[] = [];
  const all = task.sections.map((s) => r?.sections[s.id] ?? '').join('\n');
  for (const s of task.sections) {
    if (s.minWords > 0) {
      const n = countWords(r?.sections[s.id] ?? '');
      checks.push({ id: `words:${s.id}`, label: `${s.label}: at least ${s.minWords} words`, met: n >= s.minWords, detail: `${n} words` });
    }
  }
  if (task.minCitations > 0) {
    const c = citedParagraphs(all);
    checks.push({ id: 'citations', label: `Cite at least ${task.minCitations} paragraph${task.minCitations === 1 ? '' : 's'}`, met: c.length >= task.minCitations, detail: c.length ? `cited ¶${c.join(', ¶')}` : 'no citations yet' });
  }
  for (const term of task.requiredTerms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    checks.push({ id: `term:${term}`, label: `Use the term “${term}”`, met: re.test(all), detail: re.test(all) ? 'used' : 'not used yet' });
  }
  return checks;
}
