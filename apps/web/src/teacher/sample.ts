import { createActivity, randomId, type Activity } from '@ilp/core';

/** Fictional demo content for trying the app. Contains no student data. */
export function sampleActivity(): Activity {
  const a = createActivity('Past simple: a weekend at the science museum');
  a.description = 'Practise the past simple with regular and irregular verbs.';
  a.subject = 'English Language Acquisition';
  a.gradeBand = 'Grade 7';
  const blk = () => randomId('blk');
  a.items = [
    { type: 'content', id: randomId('itm'), title: 'Before you start', body: 'Read each sentence carefully. Some verbs are regular (walk → walked) and some are irregular (go → went).' },
    {
      type: 'fill-blanks', id: randomId('itm'), prompt: 'Write the past simple form of the verb in brackets.',
      segments: [
        { kind: 'text', text: 'Last Saturday, Mina (go) ' },
        { kind: 'blank', id: blk(), answers: ['went'], hint: 'go is irregular' },
        { kind: 'text', text: ' to the science museum. She (see) ' },
        { kind: 'blank', id: blk(), answers: ['saw'] },
        { kind: 'text', text: ' a model of a volcano and (watch) ' },
        { kind: 'blank', id: blk(), answers: ['watched'] },
        { kind: 'text', text: ' a short film about plate tectonics.' },
      ],
      match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] },
      points: 3, scoring: 'per-blank', feedback: { explanation: 'go → went and see → saw are irregular. watch → watched is regular (+ed).' }, skills: ['past simple', 'irregular verbs'],
    },
    {
      type: 'multiple-choice', id: randomId('itm'), prompt: 'Which sentence is correct?', mode: 'single',
      choices: [
        { id: randomId('chc'), text: 'They didn’t visited the planetarium.', correct: false, feedback: 'After “didn’t”, use the base form of the verb.' },
        { id: randomId('chc'), text: 'They didn’t visit the planetarium.', correct: true },
        { id: randomId('chc'), text: 'They not visited the planetarium.', correct: false },
      ],
      shuffleChoices: true, points: 1, scoring: 'all-or-nothing', feedback: { hint: 'Negative past simple: did not + base verb.' }, skills: ['past simple', 'negatives'],
    },
    {
      type: 'multiple-choice', id: randomId('itm'), prompt: 'Select all the irregular past simple verbs.', mode: 'multiple',
      choices: [
        { id: randomId('chc'), text: 'bought', correct: true },
        { id: randomId('chc'), text: 'played', correct: false },
        { id: randomId('chc'), text: 'took', correct: true },
        { id: randomId('chc'), text: 'studied', correct: false },
      ],
      shuffleChoices: false, points: 2, scoring: 'partial', feedback: {}, skills: ['irregular verbs'],
    },
    { type: 'true-false', id: randomId('itm'), prompt: '“Mina buyed a poster” is correct.', correct: false, trueLabel: 'Correct', falseLabel: 'Incorrect', points: 1, feedback: { incorrect: 'buy → bought (irregular).' }, skills: ['irregular verbs'] },
  ];
  return a;
}
