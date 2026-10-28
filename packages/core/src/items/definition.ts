import type { Item } from '../schema/activity';
import type { ItemResult, ValidationIssue } from '../grading/types';

export interface GradeContext {
  language: string;
}

/**
 * The framework-independent half of a question-type plugin. The UI half
 * (editor + player) lives in apps/web/src/plugins and is keyed by the same type.
 */
export interface ItemDefinition<I extends Item = Item, R = unknown> {
  type: I['type'];
  label: string;
  scorable: boolean;
  emptyResponse(item: I): R;
  isAnswered(item: I, response: R | undefined): boolean;
  grade(item: I, response: R | undefined, ctx: GradeContext): ItemResult;
  validate(item: I): ValidationIssue[];
  /** Human-readable correct answers, for reports when disclosure is allowed. */
  correctAnswers(item: I): string[];
  /** Human-readable student response, for reports. */
  describeResponse(item: I, response: R | undefined): string;
  maxScore(item: I): number;
  /** Asset ids referenced by this item (images), for packaging. */
  assets?(item: I): string[];
}

export function outcome(score: number, max: number, answered: boolean): ItemResult['status'] {
  if (!answered) return 'unanswered';
  if (score >= max) return 'correct';
  if (score > 0) return 'partial';
  return 'incorrect';
}

/** Choose teacher feedback for an outcome. */
export function outcomeFeedback(fb: { correct?: string | undefined; incorrect?: string | undefined }, status: ItemResult['status'], extra: Array<string | undefined> = []): string | undefined {
  const general = status === 'correct' ? fb.correct : status === 'unanswered' ? undefined : fb.incorrect;
  const text = [...extra, general].filter(Boolean).join(' ');
  return text || undefined;
}

/** Common credit rule for "select/place" items: (right - wrong) / total, never below 0. */
export function penalisedFraction(right: number, wrong: number, total: number): number {
  return total > 0 ? Math.max(0, (right - wrong) / total) : 0;
}

export function sameText(a: string, b: string): boolean {
  return a.normalize('NFC').trim() === b.normalize('NFC').trim();
}
