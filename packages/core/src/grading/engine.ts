import type { Activity } from '../schema/activity';
import { getItemDefinition, type ItemResponse } from '../items/registry';
import { roundScore, type ActivityResult, type ItemStatus } from './types';

/**
 * Deterministic grading of a whole activity. Same input -> same output on any
 * device, which lets a submission broker re-grade raw responses to verify a
 * client-computed score.
 */
export function gradeActivity(activity: Activity, responses: Record<string, ItemResponse | undefined>): ActivityResult {
  const counts: Record<ItemStatus, number> = { correct: 0, partial: 0, incorrect: 0, unanswered: 0, 'needs-review': 0, ungraded: 0 };
  const items = activity.items.map((item) => {
    const def = getItemDefinition(item.type);
    const r = def.grade(item as never, responses[item.id] as never, { language: activity.language });
    counts[r.status]++;
    return r;
  });
  const scored = items.filter((r) => r.status !== 'ungraded' && r.status !== 'needs-review');
  const score = roundScore(scored.reduce((s, r) => s + r.score, 0));
  const maxScore = roundScore(scored.reduce((s, r) => s + r.maxScore, 0));
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : null;
  return { score, maxScore, percent, counts, items };
}
