import { createActivity, type Activity, type FillBlanksItem, type MultipleChoiceItem, type TrueFalseItem } from '../src';

/** Fictional classroom content only. No real student data in tests. */
export function blanks(answers: string[][], overrides: Partial<FillBlanksItem> = {}): FillBlanksItem {
  const segments: FillBlanksItem['segments'] = [];
  answers.forEach((a, i) => {
    segments.push({ kind: 'text', text: `Part ${i + 1}: ` });
    segments.push({ kind: 'blank', id: `blk_${i}`, answers: a });
  });
  return {
    type: 'fill-blanks',
    id: 'itm_fb',
    prompt: 'Fill in the blanks.',
    segments,
    match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] },
    points: 2,
    scoring: 'per-blank',
    feedback: {},
    skills: ['verb tense'],
    ...overrides,
  };
}

export function mc(overrides: Partial<MultipleChoiceItem> = {}): MultipleChoiceItem {
  return {
    type: 'multiple-choice',
    id: 'itm_mc',
    prompt: 'Which are mammals?',
    mode: 'multiple',
    choices: [
      { id: 'c1', text: 'Whale', correct: true },
      { id: 'c2', text: 'Bat', correct: true },
      { id: 'c3', text: 'Shark', correct: false },
      { id: 'c4', text: 'Frog', correct: false },
    ],
    shuffleChoices: false,
    points: 2,
    scoring: 'all-or-nothing',
    feedback: { correct: 'Yes!', incorrect: 'Mammals breathe air and nurse their young.' },
    skills: ['classification'],
    ...overrides,
  };
}

export function tf(overrides: Partial<TrueFalseItem> = {}): TrueFalseItem {
  return { type: 'true-false', id: 'itm_tf', prompt: 'Water boils at 100 °C at sea level.', correct: true, trueLabel: 'True', falseLabel: 'False', points: 1, feedback: {}, skills: ['states of matter'], ...overrides };
}

export function sampleActivity(): Activity {
  const a = createActivity('Fictional Grade 7 check-in', new Date('2026-01-01T00:00:00Z'));
  a.items = [{ type: 'content', id: 'itm_intro', title: 'Read first', body: 'Answer every question.' }, mc(), tf(), blanks([['went'], ['ate', 'had eaten']])];
  return a;
}
