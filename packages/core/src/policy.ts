import type { ActivitySettings } from './schema/activity';

/**
 * Feedback/answer-visibility rules in one place so the player, the reports and
 * (later) the broker apply the same teacher settings.
 *
 * NOTE: in client-only mode these rules prevent *accidental* exposure. Answer
 * keys are present on the device and a technically skilled student can read
 * them. Server-graded assignments (Phase 5) keep keys off the device.
 */
export interface VisibilityState {
  submitted: boolean;
  /** Submissions made so far, including this one if submitted. */
  attemptsUsed: number;
  /** Teacher has released results (Phase 5 broker; always false locally). */
  released: boolean;
}

export function canCheckItem(s: ActivitySettings, checksUsed: number): boolean {
  if (s.feedbackTiming !== 'immediate') return false;
  return s.checksPerItem === null || checksUsed < s.checksPerItem;
}

export function canShowResults(s: ActivitySettings, v: VisibilityState): boolean {
  if (!v.submitted) return false;
  return s.feedbackTiming === 'after-release' ? v.released : true;
}

export function attemptsRemaining(s: ActivitySettings, attemptsUsed: number): number | null {
  return s.maxAttempts === null ? null : Math.max(0, s.maxAttempts - attemptsUsed);
}

export function canRevealAnswers(s: ActivitySettings, v: VisibilityState): boolean {
  if (!canShowResults(s, v)) return false;
  switch (s.answerReveal) {
    case 'never':
      return false;
    case 'after-submit':
      return true;
    case 'after-final-attempt':
      return attemptsRemaining(s, v.attemptsUsed) === 0;
    case 'after-release':
      return v.released;
  }
}
