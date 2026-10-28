import { z } from 'zod';
import { AudioCueField, FeedbackSchema, IdSchema, MatchOptionsSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult, type ValidationIssue } from '../grading/types';
import { canonicalAnswer, matchAnswer, MISMATCH_MESSAGES } from '../grading/normalize';
import { compilePatterns, expandPattern, matchesCompiled, patternProblem } from '../grammar/patterns';
import { outcome, type ItemDefinition } from './definition';

/**
 * Open sentence answer graded by teacher-approved rules: sentence
 * transformation, error correction, sentence combining, completion, short
 * answers. Nothing outside the teacher's patterns is ever marked correct;
 * unmatched answers go to teacher review by default instead of being guessed.
 */
export const ErrorRuleSchema = z.object({
  id: IdSchema,
  /** Pattern describing a common wrong answer, e.g. "She {have|haves} finished." */
  pattern: ShortTextSchema,
  /** Error category, e.g. "subject-verb agreement". */
  errorType: z.string().max(80),
  feedback: ShortTextSchema.default(''),
});
export type ErrorRule = z.infer<typeof ErrorRuleSchema>;

/** A content word or phrase the answer must contain to keep its meaning. Alternatives allowed. */
export const KeywordSchema = z.object({ id: IdSchema, forms: z.array(ShortTextSchema).min(1) });

export const SentenceResponseItemSchema = z.object({
  type: z.literal('sentence-response'),
  id: IdSchema,
  audioCue: AudioCueField,
  /** Template that sets the wording students see. */
  task: z.enum(['transform', 'correct', 'combine', 'complete', 'answer']).default('transform'),
  prompt: TextSchema,
  /** Sentence(s) shown to the student, e.g. the sentence to correct or transform. */
  source: TextSchema.default(''),
  /** Pre-filled text in the answer box (e.g. the start of the sentence). */
  starter: ShortTextSchema.default(''),
  accepted: z.array(ShortTextSchema).max(50),
  errorRules: z.array(ErrorRuleSchema).max(50).default([]),
  /** Meaning check: every keyword must appear. Empty = meaning is not scored separately. */
  keywords: z.array(KeywordSchema).max(20).default([]),
  /** Share of the points for meaning (0–1); only used when keywords exist. */
  meaningWeight: z.number().min(0).max(1).default(0.5),
  match: MatchOptionsSchema.default({ caseSensitive: true, punctuationSensitive: false, accentSensitive: true, equivalences: [] }),
  /** What happens when an answer matches no accepted pattern and no error rule. */
  unmatched: z.enum(['review', 'incorrect']).default('review'),
  points: PointsSchema.default(1),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type SentenceResponseItem = z.infer<typeof SentenceResponseItemSchema>;
export interface SentenceResponseResponse {
  text: string;
}

export const TASK_LABELS: Record<SentenceResponseItem['task'], string> = {
  transform: 'Rewrite the sentence',
  correct: 'Correct the sentence',
  combine: 'Combine the sentences',
  complete: 'Complete the sentence',
  answer: 'Write your answer',
};

function containsPhrase(answerCanon: string, phraseCanon: string): boolean {
  return phraseCanon !== '' && ` ${answerCanon} `.includes(` ${phraseCanon} `);
}

export function meaningCheck(item: SentenceResponseItem, text: string, language: string): { ok: boolean; missing: string[] } {
  const opts = { ...item.match, caseSensitive: false, punctuationSensitive: false };
  const a = canonicalAnswer(text, opts, language);
  const missing = item.keywords.filter((k) => !k.forms.some((f) => containsPhrase(a, canonicalAnswer(f, opts, language)))).map((k) => k.forms[0]!);
  return { ok: missing.length === 0, missing };
}

export const sentenceResponseDefinition: ItemDefinition<SentenceResponseItem, SentenceResponseResponse> = {
  type: 'sentence-response',
  label: 'Sentence response',
  scorable: true,
  emptyResponse: (i) => ({ text: i.starter }),
  isAnswered: (i, r) => !!r && r.text.trim() !== '' && r.text.trim() !== i.starter.trim(),
  maxScore: (i) => i.points,
  grade(item, response, ctx) {
    const text = response?.text ?? '';
    const base = { itemId: item.id, itemType: item.type, maxScore: item.points, skills: item.skills };
    if (!text.trim() || text.trim() === item.starter.trim()) {
      return { ...base, status: 'unanswered', score: 0, parts: [{ partId: 'accuracy', correct: false, reason: 'blank' }] };
    }
    const hasMeaning = item.keywords.length > 0;
    const meaning = hasMeaning ? meaningCheck(item, text, ctx.language) : { ok: true, missing: [] };
    const meaningPoints = hasMeaning ? item.points * item.meaningWeight : 0;
    const meaningPart: PartResult[] = hasMeaning ? [{ partId: 'meaning', correct: meaning.ok, ...(meaning.ok ? {} : { reason: 'missing' as const, given: meaning.missing.join(', ') }) }] : [];

    const accepted = compilePatterns(item.accepted, item.match, ctx.language);
    if (matchesCompiled(text, accepted, item.match, ctx.language)) {
      return { ...base, status: 'correct', score: item.points, parts: [{ partId: 'accuracy', correct: true, given: text }, ...meaningPart.map((p) => ({ ...p, correct: true }))], ...(item.feedback.correct ? { feedback: item.feedback.correct } : {}) };
    }
    for (const rule of item.errorRules) {
      if (matchesCompiled(text, compilePatterns([rule.pattern], item.match, ctx.language), item.match, ctx.language)) {
        const score = roundScore(meaning.ok ? meaningPoints : 0);
        const status = outcome(score, item.points, true);
        const feedback = [rule.feedback, item.feedback.incorrect].filter(Boolean).join(' ');
        return { ...base, status, score, parts: [{ partId: 'accuracy', correct: false, given: text, reason: 'error-rule' }, ...meaningPart], ...(rule.errorType ? { errorTags: [rule.errorType] } : {}), ...(feedback ? { feedback } : {}) };
      }
    }
    // Explain near-misses (capitalization / punctuation / accents) deterministically.
    const forms = [...accepted.forms.values()];
    const m = matchAnswer(text, forms, item.match, ctx.language);
    const nearMiss = m.reason && m.reason !== 'no-match' && m.reason !== 'blank';
    if (item.unmatched === 'review' && !nearMiss) {
      return { ...base, status: 'needs-review', score: 0, parts: [{ partId: 'accuracy', correct: false, given: text }, ...meaningPart], feedback: 'Your teacher will review this answer.' };
    }
    const score = roundScore(meaning.ok ? meaningPoints : 0);
    const feedback = [nearMiss ? MISMATCH_MESSAGES[m.reason!] : '', item.feedback.incorrect].filter(Boolean).join(' ');
    return { ...base, status: outcome(score, item.points, true), score, parts: [{ partId: 'accuracy', correct: false, given: text, reason: m.reason ?? 'no-match' }, ...meaningPart], ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const at = (path: string, message: string) => issues.push({ itemId: item.id, path, message });
    if (!item.prompt.trim()) at('prompt', 'Instructions are empty.');
    if (!item.accepted.some((a) => a.trim())) at('accepted', 'Add at least one accepted answer.');
    const problem = patternProblem([...item.accepted, ...item.errorRules.map((r) => r.pattern)]);
    if (problem) at('accepted', problem);
    if (item.errorRules.some((r) => !r.pattern.trim())) at('errorRules', 'A common-mistake rule has no pattern.');
    if (!problem) {
      const ok = compilePatterns(item.accepted, item.match);
      for (const r of item.errorRules) {
        if (expandPattern(r.pattern).some((s) => matchesCompiled(s, ok, item.match))) at('errorRules', `The mistake pattern “${r.pattern.slice(0, 40)}” also matches an accepted answer.`);
      }
    }
    return issues;
  },
  correctAnswers: (i) => {
    try {
      return i.accepted.flatMap((p) => expandPattern(p)).slice(0, 10);
    } catch {
      return i.accepted;
    }
  },
  describeResponse: (_i, r) => r?.text ?? '',
};
