import type { Activity } from '../schema/activity';
import type { Attempt } from '../schema/attempt';
import { getItemDefinition, type ItemResponse } from '../items/registry';
import { gradeActivity } from '../grading/engine';
import { MISMATCH_MESSAGES } from '../grading/normalize';
import type { ItemStatus } from '../grading/types';
import { randomId } from '../ids';
import { presentedItems } from '../selection';

export interface ReportItem {
  index: number;
  itemId: string;
  itemType: string;
  prompt: string;
  status: ItemStatus;
  score: number;
  maxScore: number;
  response: string;
  /** Present only when the activity's answer-reveal setting allows it. */
  correctAnswers?: string[];
  checksUsed: number;
  hintsUsed: number;
  skills: string[];
  mistakes: string[];
}

export interface SkillSummary {
  skill: string;
  earned: number;
  possible: number;
  percent: number;
}

/**
 * Report schema v1. Produced on the student's device, so it is *advisory*:
 * `integrity.verified` is false until a submission broker re-grades the raw
 * responses and countersigns (Phase 5).
 */
export interface Report {
  kind: 'ilp.report';
  schemaVersion: 1;
  reportId: string;
  assignmentId: string | null;
  classId: string | null;
  studentNumber: string | null;
  activityId: string;
  activityTitle: string;
  activityVersion: number;
  contentHash: string;
  attemptId: string;
  attemptNumber: number;
  submittedAt: string | null;
  generatedAt: string;
  completion: 'complete' | 'incomplete';
  totals: {
    questions: number;
    answered: number;
    correct: number;
    partial: number;
    incorrect: number;
    unanswered: number;
    needsReview: number;
    score: number;
    maxScore: number;
    percent: number | null;
    met: boolean | null;
  };
  items: ReportItem[];
  skills: SkillSummary[];
  proficient: string[];
  needsPractice: string[];
  nextSteps: string[];
  integrity: { generatedBy: 'client'; verified: false; note: string };
}

export interface ReportOptions {
  revealAnswers: boolean;
  studentNumber?: string | null;
  classId?: string | null;
  now?: Date;
}

const PROFICIENT_AT = 80;
const PRACTICE_BELOW = 60;

function promptOf(item: Activity['items'][number]): string {
  switch (item.type) {
    case 'content':
      return item.title || item.body.slice(0, 80);
    case 'fill-blanks':
    case 'drag-words':
    case 'dropdown-cloze':
      return item.prompt || item.segments.map((s) => (s.kind === 'text' ? s.text : '____')).join('');
    case 'mark-words':
      return item.prompt || 'Mark the words';
    case 'audio':
      return item.title || 'Audio';
    case 'sentence-response':
      return [item.prompt, item.source].filter(Boolean).join(' — ');
    case 'sentence-builder':
      return item.prompt || 'Build the sentence';
    case 'dictation':
      return item.prompt;
    case 'speaking':
      return item.prompt;
    default:
      return item.prompt;
  }
}

export function buildReport(activity: Activity, attempt: Attempt, options: ReportOptions): Report {
  const responses = attempt.responses as Record<string, ItemResponse>;
  const shown = presentedItems(activity, attempt.presentedItemIds ?? null);
  const result = gradeActivity(activity, responses, attempt.presentedItemIds ?? null);
  const items: ReportItem[] = [];
  shown.forEach((item, index) => {
    const def = getItemDefinition(item.type);
    if (!def.scorable) return;
    const r = result.items[index]!;
    const reasonText: Record<string, string> = {
      'wrong-choice': 'Selected an incorrect choice',
      'missed-choice': 'Missed a correct choice',
      typo: 'Spelling slip (one letter)',
      missing: 'Missing word or idea',
      extra: 'Extra word',
      'wrong-word': 'Wrong word',
      'error-rule': 'Matched a common mistake',
      ...MISMATCH_MESSAGES,
    };
    const mistakes = [...new Set([...(r.errorTags ?? []).map((t) => `Error type: ${t}`), ...r.parts.filter((p) => !p.correct && p.reason).map((p) => reasonText[p.reason!] ?? p.reason!)])];
    items.push({
      index: items.length + 1,
      itemId: item.id,
      itemType: item.type,
      prompt: promptOf(item),
      status: r.status,
      score: r.score,
      maxScore: r.maxScore,
      response: def.describeResponse(item as never, responses[item.id] as never),
      ...(options.revealAnswers ? { correctAnswers: def.correctAnswers(item as never) } : {}),
      checksUsed: attempt.checks[item.id] ?? 0,
      hintsUsed: attempt.hintsUsed[item.id] ?? 0,
      skills: r.skills,
      mistakes,
    });
  });

  const bySkill = new Map<string, { earned: number; possible: number }>();
  for (const it of items) {
    for (const skill of it.skills) {
      const s = bySkill.get(skill) ?? { earned: 0, possible: 0 };
      s.earned += it.score;
      s.possible += it.maxScore;
      bySkill.set(skill, s);
    }
  }
  const skills: SkillSummary[] = [...bySkill.entries()]
    .map(([skill, s]) => ({ skill, ...s, percent: s.possible > 0 ? Math.round((s.earned / s.possible) * 1000) / 10 : 0 }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
  const proficient = skills.filter((s) => s.percent >= PROFICIENT_AT).map((s) => s.skill);
  const needsPractice = skills.filter((s) => s.percent < PRACTICE_BELOW).map((s) => s.skill);

  const c = result.counts;
  const questions = items.length;
  const answered = questions - c.unanswered;
  const nextSteps: string[] = [];
  if (c.unanswered > 0) nextSteps.push(`Complete the ${c.unanswered} unanswered question${c.unanswered === 1 ? '' : 's'}.`);
  for (const s of needsPractice) nextSteps.push(`Review and practise: ${s}.`);
  if (items.some((i) => i.mistakes.some((m) => m.includes('capitalization')))) nextSteps.push('Check capitalization before submitting.');
  if (nextSteps.length === 0 && result.percent !== null && result.percent >= PROFICIENT_AT) nextSteps.push('Great work — try a more challenging activity.');

  const passing = activity.settings.passingPercent;
  return {
    kind: 'ilp.report',
    schemaVersion: 1,
    reportId: randomId('rpt'),
    assignmentId: attempt.assignmentId,
    classId: options.classId ?? null,
    studentNumber: options.studentNumber ?? null,
    activityId: activity.id,
    activityTitle: activity.title,
    activityVersion: attempt.version,
    contentHash: attempt.contentHash,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    submittedAt: attempt.submittedAt,
    generatedAt: (options.now ?? new Date()).toISOString(),
    completion: c.unanswered === 0 ? 'complete' : 'incomplete',
    totals: {
      questions,
      answered,
      correct: c.correct,
      partial: c.partial,
      incorrect: c.incorrect,
      unanswered: c.unanswered,
      needsReview: c['needs-review'],
      score: result.score,
      maxScore: result.maxScore,
      percent: result.percent,
      met: passing === null || result.percent === null ? null : result.percent >= passing,
    },
    items,
    skills,
    proficient,
    needsPractice,
    nextSteps,
    integrity: {
      generatedBy: 'client',
      verified: false,
      note: 'Generated on the student device. Not tamper-resistant until verified by a submission broker.',
    },
  };
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection from student-typed text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(report: Report): string {
  const header = ['assignment_id', 'student_number', 'activity_id', 'activity_version', 'attempt', 'item', 'item_type', 'status', 'score', 'max_score', 'response', 'correct_answers', 'checks_used', 'hints_used', 'skills', 'mistakes'];
  const rows = report.items.map((i) => [
    report.assignmentId,
    report.studentNumber,
    report.activityId,
    report.activityVersion,
    report.attemptNumber,
    i.index,
    i.itemType,
    i.status,
    i.score,
    i.maxScore,
    i.response,
    i.correctAnswers?.join(' | ') ?? '',
    i.checksUsed,
    i.hintsUsed,
    i.skills.join(' | '),
    i.mistakes.join(' | '),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
