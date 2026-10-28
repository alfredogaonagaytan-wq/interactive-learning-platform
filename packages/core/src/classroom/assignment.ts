import { z } from 'zod';
import { IdSchema, ShortTextSchema } from '../schema/common';
import type { Activity, Item } from '../schema/activity';
import { AUDIO_TYPES, MAX_AUDIO_BYTES, sniffMediaType } from '../package/media';

/**
 * Classroom documents exchanged between the app and the teacher's submission
 * broker. They never contain student names: students are identified by the
 * teacher-assigned student number, resolved by the broker from the verified
 * Google account.
 */
export const AssignmentSchema = z.object({
  kind: z.literal('ilp.assignment'),
  id: IdSchema,
  classId: IdSchema,
  title: ShortTextSchema,
  activityId: IdSchema,
  version: z.number().int().min(1),
  contentHash: z.string(),
  /**
   * client  – the student's device grades (fast feedback); the broker re-grades to verify.
   * hidden  – answer keys never leave the teacher's Drive; only the broker grades.
   */
  grading: z.enum(['client', 'hidden']).default('client'),
  dueAt: z.iso.datetime().nullable().default(null),
  allowLate: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(100).nullable().default(null),
  /** Whether students see their verified score in the receipt. */
  showScore: z.boolean().default(true),
  createdAt: z.iso.datetime(),
  closed: z.boolean().default(false),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const RecordingUploadSchema = z.object({
  id: IdSchema,
  itemId: IdSchema,
  targetId: z.string().max(80),
  mime: z.string().max(80),
  base64: z.string().max(30_000_000),
});

export const SubmissionPayloadSchema = z.object({
  assignmentId: IdSchema,
  attemptId: IdSchema,
  attemptNumber: z.number().int().min(1),
  startedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime(),
  presentedItemIds: z.array(IdSchema).nullable(),
  responses: z.record(z.string(), z.unknown()),
  checks: z.record(z.string(), z.number().int().min(0)).default({}),
  hintsUsed: z.record(z.string(), z.number().int().min(0)).default({}),
  /** Client-computed score, kept only for comparison with the broker's re-grade. */
  clientScore: z.number().nullable().default(null),
  recordings: z.array(RecordingUploadSchema).max(60).default([]),
});
export type SubmissionPayload = z.infer<typeof SubmissionPayloadSchema>;

export interface Receipt {
  receiptId: string;
  assignmentId: string;
  attemptId: string;
  studentNumber: string;
  receivedAt: string;
  late: boolean;
  /** True when this attempt had already been received (idempotent resubmission). */
  duplicate: boolean;
  /** Broker-verified score (null when hidden by the teacher's settings). */
  score: number | null;
  maxScore: number | null;
  needsReview: number;
  /** HMAC-SHA256 over the canonical receipt fields, by the teacher's broker. */
  signature: string;
}

export const ReceiptFields = ['receiptId', 'assignmentId', 'attemptId', 'studentNumber', 'receivedAt', 'late', 'duplicate', 'score', 'maxScore', 'needsReview'] as const;

/** Item types whose answer keys can be removed from the student copy without breaking the player. */
export const HIDEABLE_KEY_TYPES = new Set<Item['type']>(['content', 'audio', 'multiple-choice', 'true-false', 'fill-blanks', 'dropdown-cloze', 'sentence-response', 'dictation', 'speaking', 'writing', 'observation-notes']);

export function canHideAnswerKeys(activity: Activity): { ok: boolean; blocking: Item['type'][] } {
  const blocking = [...new Set(activity.items.filter((i) => !HIDEABLE_KEY_TYPES.has(i.type)).map((i) => i.type))];
  return { ok: blocking.length === 0, blocking };
}

/**
 * Student copy for "hidden" grading: answer keys, per-choice feedback and
 * explanations are removed; checking while working is disabled; results come
 * only from the broker. The broker keeps the full activity.
 */
export function redactAnswerKeys(activity: Activity): Activity {
  const items = activity.items.map((it): Item => {
    switch (it.type) {
      case 'multiple-choice':
        return { ...it, choices: it.choices.map(({ feedback: _f, ...c }) => ({ ...c, correct: false })), feedback: { ...(it.feedback.hint ? { hint: it.feedback.hint } : {}) } };
      case 'true-false':
        return { ...it, correct: true, feedback: { ...(it.feedback.hint ? { hint: it.feedback.hint } : {}) } };
      case 'fill-blanks':
        return { ...it, segments: it.segments.map((s) => (s.kind === 'blank' ? { ...s, answers: [''] } : s)), match: { ...it.match, equivalences: [] }, feedback: { ...(it.feedback.hint ? { hint: it.feedback.hint } : {}) } };
      case 'dropdown-cloze':
        // Options sorted alphabetically: the first option no longer identifies the answer.
        return { ...it, segments: it.segments.map((s) => (s.kind === 'blank' ? { ...s, answers: [...s.answers].sort((a, b) => a.localeCompare(b)) } : s)), feedback: { ...(it.feedback.hint ? { hint: it.feedback.hint } : {}) } };
      case 'sentence-response':
        return { ...it, accepted: [''], errorRules: [], keywords: [], feedback: { ...(it.feedback.hint ? { hint: it.feedback.hint } : {}) } };
      case 'dictation':
        return { ...it, text: '', alternatives: [], feedback: {} };
      default:
        // Any other feedback can still give the answer away ("Right: it was A"): keep only the hint.
        return 'feedback' in it && it.feedback ? ({ ...it, feedback: { ...((it.feedback as { hint?: string }).hint ? { hint: (it.feedback as { hint?: string }).hint } : {}) } } as Item) : it;
    }
  });
  return { ...activity, items, settings: { ...activity.settings, feedbackTiming: 'after-release', answerReveal: 'after-release', checksPerItem: null } };
}

/** Assignment links: #/a/<assignmentId>?b=<broker deployment id>. */
export function assignmentLink(appUrl: string, assignmentId: string, brokerId: string): string {
  return `${appUrl.replace(/#.*$/, '').replace(/\/?$/, '/')}#/a/${encodeURIComponent(assignmentId)}?b=${encodeURIComponent(brokerId)}`;
}
export const BROKER_ID_PATTERN = /^[A-Za-z0-9_-]{20,120}$/;
export function brokerUrl(brokerId: string): string {
  if (!BROKER_ID_PATTERN.test(brokerId)) throw new Error('Invalid submission service id');
  return `https://script.google.com/macros/s/${brokerId}/exec`;
}
/** Accepts a full Apps Script web-app URL or a bare deployment id. */
export function parseBrokerId(input: string): string | null {
  const m = /script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/.exec(input.trim());
  const id = m ? m[1]! : input.trim();
  return BROKER_ID_PATTERN.test(id) ? id : null;
}

/**
 * Every ID token the app sends to a teacher's service carries this nonce, so a
 * token captured by one service (for example a malicious one named in a link)
 * is refused by every other service. The service records its own id when the
 * teacher connects it.
 */
export const BROKER_NONCE_PREFIX = 'ilp-b.';
export function brokerNonce(brokerId: string): string {
  if (!BROKER_ID_PATTERN.test(brokerId)) throw new Error('Invalid submission service id');
  return BROKER_NONCE_PREFIX + brokerId;
}
export function brokerIdFromNonce(nonce: unknown): string | null {
  if (typeof nonce !== 'string' || !nonce.startsWith(BROKER_NONCE_PREFIX)) return null;
  const id = nonce.slice(BROKER_NONCE_PREFIX.length);
  return BROKER_ID_PATTERN.test(id) ? id : null;
}

/** Largest submission request a service accepts (Apps Script's own limit is about 50 MB). */
export const MAX_SUBMISSION_CHARS = 45_000_000;
/** Largest JSON of the responses alone (answers are text; recordings travel separately). */
export const MAX_RESPONSES_CHARS = 2_000_000;

export interface RecordingCheck {
  itemId: string;
  targetId: string;
  /** First bytes of the decoded file (16 are enough). */
  head: Uint8Array;
  size: number;
}

/**
 * Server-side check of submitted recordings: each must be real audio (by its
 * bytes, not the declared type), within the size limit, for a target of a
 * speaking item that was presented and allows submission, at most one per
 * target. Returns the stored media type per recording, or a problem.
 */
export function checkRecordings(activity: Activity, presentedItemIds: string[], recs: RecordingCheck[]): { ok: true; mimes: string[] } | { ok: false; problem: string } {
  const seen = new Set<string>();
  const mimes: string[] = [];
  for (const r of recs) {
    const item = activity.items.find((i) => i.id === r.itemId);
    if (!item || item.type !== 'speaking' || !presentedItemIds.includes(item.id)) return { ok: false, problem: 'A recording is not for a speaking question in this assignment.' };
    if (item.submission === 'none') return { ok: false, problem: 'This speaking question does not accept recordings.' };
    if (!item.targets.some((t) => t.id === r.targetId)) return { ok: false, problem: 'A recording is not for a phrase in this question.' };
    const key = `${r.itemId}|${r.targetId}`;
    if (seen.has(key)) return { ok: false, problem: 'Only one recording per phrase can be submitted.' };
    seen.add(key);
    if (r.size > MAX_AUDIO_BYTES) return { ok: false, problem: 'A recording is too large.' };
    const mime = sniffMediaType(r.head);
    if (!mime || !(AUDIO_TYPES as readonly string[]).includes(mime)) return { ok: false, problem: 'A recording is not an audio file.' };
    mimes.push(mime);
  }
  return { ok: true, mimes };
}
