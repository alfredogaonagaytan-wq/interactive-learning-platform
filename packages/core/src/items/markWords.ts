import { z } from 'zod';
import { FeedbackSchema, IdSchema, PointsSchema, SkillTagsSchema, TextSchema } from '../schema/common';
import { roundScore, type PartResult } from '../grading/types';
import { outcome, outcomeFeedback, penalisedFraction, type ItemDefinition } from './definition';

/**
 * Mark the words: students click words in a passage (e.g. "all the verbs").
 * Teachers write the passage with target words wrapped in *asterisks*.
 * Scoring: points × max(0, (right − wrong) / targets).
 */
export const MarkWordsItemSchema = z.object({
  type: z.literal('mark-words'),
  id: IdSchema,
  prompt: TextSchema.default(''),
  text: TextSchema,
  points: PointsSchema.default(1),
  feedback: FeedbackSchema.default({}),
  skills: SkillTagsSchema,
});
export type MarkWordsItem = z.infer<typeof MarkWordsItemSchema>;
export interface MarkWordsResponse {
  /** Indexes of selected word tokens. */
  selected: number[];
}

export type MarkToken =
  | { kind: 'word'; index: number; text: string; correct: boolean }
  | { kind: 'text'; text: string };

const EDGE = /^([\p{P}\p{S}\u0000]*)([\s\S]*?)([\p{P}\p{S}\u0000]*)$/u;

/**
 * Deterministic tokenizer shared by editor, player and grader. Leading and
 * trailing punctuation is kept outside the clickable word. Use \* for a literal asterisk.
 */
export function tokenizeMarkWords(markup: string): MarkToken[] {
  const out: MarkToken[] = [];
  let index = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === 'text') last.text += t;
    else out.push({ kind: 'text', text: t });
  };
  const pushWord = (raw: string, correct: boolean) => {
    const m = EDGE.exec(raw)!;
    const [, before = '', core = '', after = ''] = m;
    pushText(before);
    if (core) out.push({ kind: 'word', index: index++, text: core, correct });
    pushText(after);
  };
  const plain = (chunk: string) => {
    for (const piece of chunk.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) pushText(piece);
      else pushWord(piece, false);
    }
  };
  const literal = markup.replace(/\\\*/g, '\u0000');
  const re = /\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(literal))) {
    plain(literal.slice(last, m.index));
    const inner = m[1]!.trim();
    if (inner) pushWord(inner, true);
    last = m.index + m[0].length;
  }
  plain(literal.slice(last));
  for (const t of out) t.text = t.text.replace(/\u0000/g, '*');
  return out;
}

const words = (item: MarkWordsItem) => tokenizeMarkWords(item.text).filter((t): t is Extract<MarkToken, { kind: 'word' }> => t.kind === 'word');

export const markWordsDefinition: ItemDefinition<MarkWordsItem, MarkWordsResponse> = {
  type: 'mark-words',
  label: 'Mark the words',
  scorable: true,
  emptyResponse: () => ({ selected: [] }),
  isAnswered: (_i, r) => !!r && r.selected.length > 0,
  maxScore: (i) => i.points,
  grade(item, response) {
    const ws = words(item);
    const selected = new Set(response?.selected ?? []);
    const parts: PartResult[] = [];
    let right = 0;
    let wrong = 0;
    for (const w of ws) {
      const isSel = selected.has(w.index);
      if (isSel && w.correct) right++;
      if (isSel && !w.correct) wrong++;
      if (isSel || w.correct) {
        parts.push({ partId: String(w.index), correct: isSel === w.correct, ...(isSel ? { given: w.text } : {}), ...(isSel && !w.correct ? { reason: 'wrong-choice' as const } : {}), ...(!isSel && w.correct ? { reason: 'missed-choice' as const } : {}) });
      }
    }
    const targets = ws.filter((w) => w.correct).length;
    const score = roundScore(item.points * penalisedFraction(right, wrong, targets));
    const status = outcome(score, item.points, selected.size > 0);
    const feedback = outcomeFeedback(item.feedback, status);
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate: (item) => (words(item).some((w) => w.correct) ? [] : [{ itemId: item.id, path: 'text', message: 'Mark at least one correct word with *asterisks*.' }]),
  correctAnswers: (i) => words(i).filter((w) => w.correct).map((w) => w.text),
  describeResponse(i, r) {
    const sel = new Set(r?.selected ?? []);
    return words(i).filter((w) => sel.has(w.index)).map((w) => w.text).join(', ');
  },
};
