import type { Activity, Item, ItemType } from '../schema/activity';
import { MISMATCH_MESSAGES, matchAnswer } from '../grading/normalize';
import { roundScore, type ItemResult, type PartResult, type ValidationIssue } from '../grading/types';
import { blanksOf, type FillBlanksItem, type FillBlanksResponse } from './fillBlanks';
import type { MultipleChoiceItem, MultipleChoiceResponse } from './multipleChoice';
import type { TrueFalseItem, TrueFalseResponse } from './trueFalse';
import type { ContentItem } from './content';

export type ItemResponse = MultipleChoiceResponse | TrueFalseResponse | FillBlanksResponse | Record<string, never>;

export interface GradeContext {
  language: string;
}

/**
 * The framework-independent half of a question-type plugin. The UI half
 * (editor + player) lives in apps/web/src/plugins and is keyed by the same type.
 */
export interface ItemDefinition<I extends Item = Item, R = ItemResponse> {
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
}

function outcome(score: number, max: number, answered: boolean): ItemResult['status'] {
  if (!answered) return 'unanswered';
  if (score >= max) return 'correct';
  if (score > 0) return 'partial';
  return 'incorrect';
}

const content: ItemDefinition<ContentItem, Record<string, never>> = {
  type: 'content',
  label: 'Text / instructions',
  scorable: false,
  emptyResponse: () => ({}),
  isAnswered: () => true,
  grade: (item) => ({ itemId: item.id, itemType: item.type, status: 'ungraded', score: 0, maxScore: 0, parts: [], skills: [] }),
  validate: (item) => (item.title.trim() || item.body.trim() ? [] : [{ itemId: item.id, path: 'body', message: 'Text block is empty.' }]),
  correctAnswers: () => [],
  describeResponse: () => '',
  maxScore: () => 0,
};

const multipleChoice: ItemDefinition<MultipleChoiceItem, MultipleChoiceResponse> = {
  type: 'multiple-choice',
  label: 'Multiple choice',
  scorable: true,
  emptyResponse: () => ({ choiceIds: [] }),
  isAnswered: (_i, r) => !!r && r.choiceIds.length > 0,
  maxScore: (i) => i.points,
  grade(item, response) {
    const selected = new Set(response?.choiceIds ?? []);
    const parts: PartResult[] = item.choices.map((c) => {
      const isSel = selected.has(c.id);
      return {
        partId: c.id,
        correct: isSel === c.correct,
        ...(isSel ? { given: c.text } : {}),
        ...(isSel && !c.correct ? { reason: 'wrong-choice' as const } : {}),
        ...(!isSel && c.correct ? { reason: 'missed-choice' as const } : {}),
      };
    });
    const totalCorrect = item.choices.filter((c) => c.correct).length;
    const correctSel = item.choices.filter((c) => c.correct && selected.has(c.id)).length;
    const wrongSel = item.choices.filter((c) => !c.correct && selected.has(c.id)).length;
    let score: number;
    if (item.mode === 'single') {
      score = selected.size === 1 && correctSel === 1 ? item.points : 0;
    } else if (item.scoring === 'partial' && totalCorrect > 0) {
      score = item.points * Math.max(0, (correctSel - wrongSel) / totalCorrect);
    } else {
      score = correctSel === totalCorrect && wrongSel === 0 ? item.points : 0;
    }
    score = roundScore(score);
    const status = outcome(score, item.points, selected.size > 0);
    const chosenFeedback = item.choices.filter((c) => selected.has(c.id) && c.feedback).map((c) => c.feedback);
    const general = status === 'correct' ? item.feedback.correct : item.feedback.incorrect;
    const feedback = [...chosenFeedback, general].filter(Boolean).join(' ');
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const at = (path: string, message: string) => issues.push({ itemId: item.id, path, message });
    if (!item.prompt.trim()) at('prompt', 'Question text is empty.');
    if (item.choices.length < 2) at('choices', 'Add at least two choices.');
    if (item.choices.some((c) => !c.text.trim())) at('choices', 'A choice is empty.');
    const n = item.choices.filter((c) => c.correct).length;
    if (n === 0) at('choices', 'Mark at least one choice as correct.');
    if (item.mode === 'single' && n > 1) at('choices', 'Single-answer questions need exactly one correct choice. Switch to "multiple answers" or unmark extras.');
    const texts = item.choices.map((c) => c.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) at('choices', 'Two choices have the same text.');
    return issues;
  },
  correctAnswers: (i) => i.choices.filter((c) => c.correct).map((c) => c.text),
  describeResponse: (i, r) => i.choices.filter((c) => r?.choiceIds.includes(c.id)).map((c) => c.text).join('; '),
};

const trueFalse: ItemDefinition<TrueFalseItem, TrueFalseResponse> = {
  type: 'true-false',
  label: 'True / false',
  scorable: true,
  emptyResponse: () => ({ value: null }),
  isAnswered: (_i, r) => !!r && r.value !== null,
  maxScore: (i) => i.points,
  grade(item, response) {
    const v = response?.value ?? null;
    const correct = v === item.correct;
    const score = v !== null && correct ? item.points : 0;
    const status = outcome(score, item.points, v !== null);
    const feedback = status === 'correct' ? item.feedback.correct : status === 'incorrect' ? item.feedback.incorrect : undefined;
    return {
      itemId: item.id,
      itemType: item.type,
      status,
      score,
      maxScore: item.points,
      parts: [{ partId: 'value', correct, ...(v !== null ? { given: v ? item.trueLabel : item.falseLabel } : {}) }],
      skills: item.skills,
      ...(feedback ? { feedback } : {}),
    };
  },
  validate: (item) => (item.prompt.trim() ? [] : [{ itemId: item.id, path: 'prompt', message: 'Statement is empty.' }]),
  correctAnswers: (i) => [i.correct ? i.trueLabel : i.falseLabel],
  describeResponse: (i, r) => (r?.value === null || r === undefined ? '' : r.value ? i.trueLabel : i.falseLabel),
};

const fillBlanks: ItemDefinition<FillBlanksItem, FillBlanksResponse> = {
  type: 'fill-blanks',
  label: 'Fill in the blanks',
  scorable: true,
  emptyResponse: (item) => ({ values: Object.fromEntries(blanksOf(item).map((b) => [b.id, ''])) }),
  isAnswered: (item, r) => !!r && blanksOf(item).some((b) => (r.values[b.id] ?? '').trim() !== ''),
  maxScore: (i) => i.points,
  grade(item, response, ctx) {
    const blanks = blanksOf(item);
    const parts: PartResult[] = blanks.map((b) => {
      const given = response?.values[b.id] ?? '';
      const m = matchAnswer(given, b.answers, item.match, ctx.language);
      return { partId: b.id, correct: m.matched, given, ...(m.reason ? { reason: m.reason } : {}) };
    });
    const nCorrect = parts.filter((p) => p.correct).length;
    let score = 0;
    if (blanks.length > 0) {
      score = item.scoring === 'all-or-nothing' ? (nCorrect === blanks.length ? item.points : 0) : (item.points * nCorrect) / blanks.length;
    }
    score = roundScore(score);
    const answered = parts.some((p) => (p.given ?? '').trim() !== '');
    const status = outcome(score, item.points, answered);
    const reasonHints = [...new Set(parts.filter((p) => !p.correct && p.reason && p.reason !== 'blank' && p.reason !== 'no-match').map((p) => MISMATCH_MESSAGES[p.reason as keyof typeof MISMATCH_MESSAGES]))];
    const general = status === 'correct' ? item.feedback.correct : item.feedback.incorrect;
    const feedback = [general, ...reasonHints].filter(Boolean).join(' ');
    return { itemId: item.id, itemType: item.type, status, score, maxScore: item.points, parts, skills: item.skills, ...(feedback ? { feedback } : {}) };
  },
  validate(item) {
    const issues: ValidationIssue[] = [];
    const blanks = blanksOf(item);
    if (blanks.length === 0) issues.push({ itemId: item.id, path: 'segments', message: 'Add at least one blank using [square brackets].' });
    if (blanks.some((b) => b.answers.every((a) => !a.trim()))) issues.push({ itemId: item.id, path: 'segments', message: 'A blank has no accepted answer.' });
    return issues;
  },
  correctAnswers: (i) => blanksOf(i).map((b) => b.answers.join(' / ')),
  describeResponse: (i, r) => blanksOf(i).map((b) => r?.values[b.id] ?? '').join('; '),
};

const registry: { [K in ItemType]: ItemDefinition<Extract<Item, { type: K }>, any> } = {
  content,
  'multiple-choice': multipleChoice,
  'true-false': trueFalse,
  'fill-blanks': fillBlanks,
};

export function getItemDefinition<T extends ItemType>(type: T): ItemDefinition<Extract<Item, { type: T }>, any> {
  const def = registry[type];
  if (!def) throw new Error(`Unknown item type: ${type}`);
  return def as unknown as ItemDefinition<Extract<Item, { type: T }>, any>;
}

export const ITEM_TYPES = Object.keys(registry) as ItemType[];

export function validateActivity(activity: Activity): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!activity.title.trim()) issues.push({ path: 'title', message: 'Give the activity a title.' });
  if (!activity.items.some((i) => getItemDefinition(i.type).scorable)) {
    issues.push({ path: 'items', message: 'Add at least one question.' });
  }
  const ids = new Set<string>();
  for (const item of activity.items) {
    if (ids.has(item.id)) issues.push({ itemId: item.id, path: 'id', message: 'Duplicate item id.' });
    ids.add(item.id);
    issues.push(...getItemDefinition(item.type).validate(item as never));
  }
  return issues;
}
