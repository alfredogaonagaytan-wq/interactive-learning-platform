import type { MismatchReason } from './normalize';

export type ItemStatus =
  | 'correct'
  | 'partial'
  | 'incorrect'
  | 'unanswered'
  /** Cannot be graded reliably by rules; a teacher must review. Never auto-scored. */
  | 'needs-review'
  /** Non-scored content (instructions, readings). */
  | 'ungraded';

export interface PartResult {
  /** Choice id, blank id, etc. */
  partId: string;
  correct: boolean;
  given?: string;
  reason?: MismatchReason | 'wrong-choice' | 'missed-choice' | 'typo' | 'missing' | 'extra' | 'wrong-word' | 'error-rule';
}

export interface ItemResult {
  itemId: string;
  itemType: string;
  status: ItemStatus;
  score: number;
  maxScore: number;
  parts: PartResult[];
  skills: string[];
  /** Teacher-authored feedback chosen for this outcome (may be empty). */
  feedback?: string;
  /** Error types identified by teacher rules, e.g. "subject-verb agreement". */
  errorTags?: string[];
}

export interface ActivityResult {
  score: number;
  maxScore: number;
  /** 0–100, rounded to one decimal; null when nothing is auto-scorable. */
  percent: number | null;
  counts: Record<ItemStatus, number>;
  items: ItemResult[];
}

export interface ValidationIssue {
  itemId?: string;
  path: string;
  message: string;
}

/** Round to 2 decimals to keep partial-credit sums stable across devices. */
export function roundScore(n: number): number {
  return Math.round(n * 100) / 100;
}
