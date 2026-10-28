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

/** Second fictional sample showing the Phase 2 activity types (no images needed). */
export function sampleSortingActivity(): Activity {
  const a = createActivity('Ecosystems: sort, match and order');
  a.description = 'Science vocabulary practice with drag-and-drop, matching and sequencing.';
  a.subject = 'Science';
  a.gradeBand = 'Grade 7';
  const id = (p: Parameters<typeof randomId>[0]) => randomId(p);
  const prod = id('zon');
  const cons = id('zon');
  const decomp = id('zon');
  a.items = [
    {
      type: 'drag-words', id: id('itm'), prompt: 'Drag the words into the gaps.',
      segments: [
        { kind: 'text', text: 'Plants are ' }, { kind: 'blank', id: id('blk'), answers: ['producers'] },
        { kind: 'text', text: ' because they use energy from ' }, { kind: 'blank', id: id('blk'), answers: ['sunlight'] },
        { kind: 'text', text: ' to make food. Animals that eat plants are ' }, { kind: 'blank', id: id('blk'), answers: ['herbivores'] }, { kind: 'text', text: '.' },
      ],
      distractors: ['carnivores', 'soil'], points: 3, scoring: 'per-blank', feedback: {}, skills: ['food chains vocabulary'],
    },
    {
      type: 'dropdown-cloze', id: id('itm'), prompt: 'Choose the correct form.',
      segments: [
        { kind: 'text', text: 'A fungus ' }, { kind: 'blank', id: id('blk'), answers: ['breaks', 'break', 'breaking'] },
        { kind: 'text', text: ' down dead leaves. Bacteria ' }, { kind: 'blank', id: id('blk'), answers: ['are', 'is', 'be'] }, { kind: 'text', text: ' decomposers too.' },
      ],
      points: 2, scoring: 'per-blank', feedback: {}, skills: ['subject-verb agreement'],
    },
    {
      type: 'matching', id: id('itm'), prompt: 'Match each word with its definition.',
      pairs: [
        { id: id('par'), left: 'producer', leftImage: null, right: 'makes its own food' },
        { id: id('par'), left: 'consumer', leftImage: null, right: 'eats other living things' },
        { id: id('par'), left: 'decomposer', leftImage: null, right: 'breaks down dead matter' },
      ],
      distractors: ['lives only in water'], points: 3, scoring: 'per-pair', feedback: {}, skills: ['food chains vocabulary'],
    },
    {
      type: 'sequencing', id: id('itm'), prompt: 'Put the food chain in order, starting with the energy source.', display: 'list',
      steps: ['Sun', 'Grass', 'Grasshopper', 'Frog', 'Hawk'].map((t) => ({ id: id('seq'), text: t, image: null })),
      points: 2, scoring: 'per-position', feedback: { explanation: 'Energy flows from the sun to producers, then to consumers.' }, skills: ['food chains'],
    },
    {
      type: 'mark-words', id: id('itm'), prompt: 'Click all the living things.',
      text: 'In the pond, a *frog* sat on a rock while *algae* floated in the warm water and a *heron* waited nearby.',
      points: 3, feedback: {}, skills: ['living vs non-living'],
    },
    {
      type: 'drag-drop', id: id('itm'), prompt: 'Sort each organism into its role.', background: null,
      zones: [
        { id: prod, label: 'Producers', showLabel: true, x: 0, y: 0, w: 30, h: 30, capacity: null },
        { id: cons, label: 'Consumers', showLabel: true, x: 0, y: 0, w: 30, h: 30, capacity: null },
        { id: decomp, label: 'Decomposers', showLabel: true, x: 0, y: 0, w: 30, h: 30, capacity: null },
      ],
      draggables: [
        { id: id('drg'), text: 'oak tree', image: null, correctZoneIds: [prod] },
        { id: id('drg'), text: 'seaweed', image: null, correctZoneIds: [prod] },
        { id: id('drg'), text: 'rabbit', image: null, correctZoneIds: [cons] },
        { id: id('drg'), text: 'owl', image: null, correctZoneIds: [cons] },
        { id: id('drg'), text: 'mushroom', image: null, correctZoneIds: [decomp] },
        { id: id('drg'), text: 'rock', image: null, correctZoneIds: [] },
      ],
      points: 5, scoring: 'per-item', feedback: { hint: 'One card is not a living thing — leave it in the bank.' }, skills: ['food chains'],
    },
  ];
  return a;
}
