import { z } from 'zod';
import { AudioRefSchema, FeedbackSchema, IdSchema, LanguageTagSchema, PointsSchema, ShortTextSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import type { PartResult, ValidationIssue } from '../grading/types';
import { canonicalAnswer } from '../grading/normalize';
import type { ItemDefinition } from './definition';

/**
 * Pronunciation / speaking practice. Three distinct capabilities:
 *  A. recording and playback (always available where the browser can record)
 *  B. speech-to-text, opt-in per assignment and per use — reported as
 *     "what the recogniser heard", never as a pronunciation score
 *  C. phoneme-level scoring — not provided (no validated on-device model)
 * Scoring is therefore completion-based or teacher-reviewed, never automatic
 * pronunciation accuracy.
 */
export const SpeakingTargetSchema = z.object({
  id: IdSchema,
  text: ShortTextSchema,
  /** Optional teacher notes on what to focus on: sounds, word stress, sentence stress, intonation. */
  focus: ShortTextSchema.default(''),
  modelAudio: AudioRefSchema.nullable().default(null),
});
export const SpeakingItemSchema = z.object({
  type: z.literal('speaking'),
  id: IdSchema,
  prompt: TextSchema.default('Listen, then record yourself saying each phrase.'),
  /** Language and variety for the model voice and speech-to-text, e.g. en-US, en-GB, ko-KR. */
  language: LanguageTagSchema.default('en-US'),
  targets: z.array(SpeakingTargetSchema).min(1).max(30),
  /** Use the device's text-to-speech voice when a target has no recorded model. */
  ttsFallback: z.boolean().default(true),
  modelBeforeRecording: z.boolean().default(true),
  /** Recordings allowed per target; null = unlimited. */
  maxRecordings: z.number().int().min(1).max(20).nullable().default(null),
  maxSeconds: z.number().int().min(3).max(300).default(30),
  /** Whether a recording must be chosen and submitted for each target. Submission to the teacher arrives in Phase 5. */
  submission: z.enum(['none', 'optional', 'required']).default('none'),
  selfAssessment: z.boolean().default(true),
  /**
   * Browser speech-to-text. Off by default: on some browsers audio is sent to the
   * browser vendor's servers. Enable only where the school has approved it.
   */
  speechToText: z.boolean().default(false),
  scoring: z.enum(['completion', 'teacher-review', 'none']).default('completion'),
  points: PointsSchema.default(1),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type SpeakingItem = z.infer<typeof SpeakingItemSchema>;
export type SpeakingTarget = z.infer<typeof SpeakingTargetSchema>;

export interface SpeakingTargetResponse {
  recordings: number;
  /** Id of the recording (in device storage) the student chose to submit. */
  selectedRecordingId: string | null;
  /** 1 = needs more practice, 2 = nearly, 3 = confident. */
  selfRating: 1 | 2 | 3 | null;
  /** Last speech-to-text result, if the student used it. */
  heard: { transcript: string; matched: boolean; onDevice: boolean } | null;
}
export interface SpeakingResponse {
  targets: Record<string, SpeakingTargetResponse>;
}

export const SELF_RATINGS = { 1: 'I need more practice', 2: 'Nearly there', 3: 'I’m confident' } as const;

/** Compare a speech-to-text transcript with the target words (case, punctuation and accents ignored). */
export function transcriptMatches(target: string, transcript: string, language: string): boolean {
  const opts = { caseSensitive: false, punctuationSensitive: false, accentSensitive: false, equivalences: [] };
  return canonicalAnswer(target, opts, language) === canonicalAnswer(transcript, opts, language);
}

const done = (item: SpeakingItem, t: SpeakingTarget, r: SpeakingResponse | undefined) => {
  const tr = r?.targets[t.id];
  if (!tr || tr.recordings === 0) return false;
  return item.submission === 'required' ? tr.selectedRecordingId !== null : true;
};

export const speakingDefinition: ItemDefinition<SpeakingItem, SpeakingResponse> = {
  type: 'speaking',
  label: 'Speaking practice',
  scorable: true,
  emptyResponse: () => ({ targets: {} }),
  isAnswered: (item, r) => item.targets.some((t) => (r?.targets[t.id]?.recordings ?? 0) > 0),
  maxScore: (i) => (i.scoring === 'none' ? 0 : i.points),
  assets: (i) => i.targets.flatMap((t) => (t.modelAudio ? [t.modelAudio.assetId] : [])),
  grade(item, response) {
    const parts: PartResult[] = item.targets.map((t) => {
      const tr = response?.targets[t.id];
      return { partId: t.id, correct: done(item, t, response), given: tr ? `${tr.recordings} recording${tr.recordings === 1 ? '' : 's'}${tr.selfRating ? `, self-rating: ${SELF_RATINGS[tr.selfRating]}` : ''}` : 'not attempted', ...(done(item, t, response) ? {} : { reason: 'blank' as const }) };
    });
    const answered = item.targets.some((t) => (response?.targets[t.id]?.recordings ?? 0) > 0);
    const base = { itemId: item.id, itemType: item.type, parts, skills: item.skills };
    if (item.scoring === 'none') return { ...base, status: 'ungraded', score: 0, maxScore: 0 };
    if (!answered) return { ...base, status: 'unanswered', score: 0, maxScore: item.points };
    if (item.scoring === 'teacher-review') return { ...base, status: 'needs-review', score: 0, maxScore: item.points, feedback: 'Your teacher will listen and give feedback.' };
    const n = parts.filter((p) => p.correct).length;
    const score = Math.round(((item.points * n) / item.targets.length) * 100) / 100;
    return {
      ...base, maxScore: item.points, score, status: n === item.targets.length ? 'correct' : n > 0 ? 'partial' : 'incorrect',
      feedback: 'Points are for completing the practice, not for pronunciation accuracy.',
    };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    if (item.targets.some((t) => !t.text.trim())) issues.push({ itemId: item.id, path: 'targets', message: 'A phrase to say is empty.' });
    if (item.targets.length === 0) issues.push({ itemId: item.id, path: 'targets', message: 'Add at least one word or phrase.' });
    return issues;
  },
  correctAnswers: () => [],
  describeResponse(item, r) {
    return item.targets
      .map((t) => {
        const tr = r?.targets[t.id];
        if (!tr) return `${t.text}: not attempted`;
        const bits = [`${tr.recordings} recording${tr.recordings === 1 ? '' : 's'}`];
        if (tr.selfRating) bits.push(`self: ${SELF_RATINGS[tr.selfRating]}`);
        if (tr.heard) bits.push(`speech-to-text heard “${tr.heard.transcript}” (not a pronunciation score)`);
        return `${t.text}: ${bits.join(', ')}`;
      })
      .join('; ');
  },
};
