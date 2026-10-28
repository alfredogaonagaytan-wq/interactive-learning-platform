import { blocksFromPlainText, createActivity, FRAMEWORK_PRESETS, randomId, readingHash, SYMBOL_PRESETS, type Activity } from '@ilp/core';

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
      type: 'fill-blanks', id: randomId('itm'), audioCue: null, prompt: 'Write the past simple form of the verb in brackets.',
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
      type: 'multiple-choice', id: randomId('itm'), audioCue: null, prompt: 'Which sentence is correct?', mode: 'single',
      choices: [
        { id: randomId('chc'), text: 'They didn’t visited the planetarium.', correct: false, feedback: 'After “didn’t”, use the base form of the verb.' },
        { id: randomId('chc'), text: 'They didn’t visit the planetarium.', correct: true },
        { id: randomId('chc'), text: 'They not visited the planetarium.', correct: false },
      ],
      shuffleChoices: true, points: 1, scoring: 'all-or-nothing', feedback: { hint: 'Negative past simple: did not + base verb.' }, skills: ['past simple', 'negatives'],
    },
    {
      type: 'multiple-choice', id: randomId('itm'), audioCue: null, prompt: 'Select all the irregular past simple verbs.', mode: 'multiple',
      choices: [
        { id: randomId('chc'), text: 'bought', correct: true },
        { id: randomId('chc'), text: 'played', correct: false },
        { id: randomId('chc'), text: 'took', correct: true },
        { id: randomId('chc'), text: 'studied', correct: false },
      ],
      shuffleChoices: false, points: 2, scoring: 'partial', feedback: {}, skills: ['irregular verbs'],
    },
    { type: 'true-false', id: randomId('itm'), audioCue: null, prompt: '“Mina buyed a poster” is correct.', correct: false, trueLabel: 'Correct', falseLabel: 'Incorrect', points: 1, feedback: { incorrect: 'buy → bought (irregular).' }, skills: ['irregular verbs'] },
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
      type: 'drag-words', id: id('itm'), audioCue: null, prompt: 'Drag the words into the gaps.',
      segments: [
        { kind: 'text', text: 'Plants are ' }, { kind: 'blank', id: id('blk'), answers: ['producers'] },
        { kind: 'text', text: ' because they use energy from ' }, { kind: 'blank', id: id('blk'), answers: ['sunlight'] },
        { kind: 'text', text: ' to make food. Animals that eat plants are ' }, { kind: 'blank', id: id('blk'), answers: ['herbivores'] }, { kind: 'text', text: '.' },
      ],
      distractors: ['carnivores', 'soil'], points: 3, scoring: 'per-blank', feedback: {}, skills: ['food chains vocabulary'],
    },
    {
      type: 'dropdown-cloze', id: id('itm'), audioCue: null, prompt: 'Choose the correct form.',
      segments: [
        { kind: 'text', text: 'A fungus ' }, { kind: 'blank', id: id('blk'), answers: ['breaks', 'break', 'breaking'] },
        { kind: 'text', text: ' down dead leaves. Bacteria ' }, { kind: 'blank', id: id('blk'), answers: ['are', 'is', 'be'] }, { kind: 'text', text: ' decomposers too.' },
      ],
      points: 2, scoring: 'per-blank', feedback: {}, skills: ['subject-verb agreement'],
    },
    {
      type: 'matching', id: id('itm'), audioCue: null, prompt: 'Match each word with its definition.',
      pairs: [
        { id: id('par'), left: 'producer', leftImage: null, right: 'makes its own food' },
        { id: id('par'), left: 'consumer', leftImage: null, right: 'eats other living things' },
        { id: id('par'), left: 'decomposer', leftImage: null, right: 'breaks down dead matter' },
      ],
      distractors: ['lives only in water'], points: 3, scoring: 'per-pair', feedback: {}, skills: ['food chains vocabulary'],
    },
    {
      type: 'sequencing', id: id('itm'), audioCue: null, prompt: 'Put the food chain in order, starting with the energy source.', display: 'list',
      steps: ['Sun', 'Grass', 'Grasshopper', 'Frog', 'Hawk'].map((t) => ({ id: id('seq'), text: t, image: null })),
      points: 2, scoring: 'per-position', feedback: { explanation: 'Energy flows from the sun to producers, then to consumers.' }, skills: ['food chains'],
    },
    {
      type: 'mark-words', id: id('itm'), audioCue: null, prompt: 'Click all the living things.',
      text: 'In the pond, a *frog* sat on a rock while *algae* floated in the warm water and a *heron* waited nearby.',
      points: 3, feedback: {}, skills: ['living vs non-living'],
    },
    {
      type: 'drag-drop', id: id('itm'), audioCue: null, prompt: 'Sort each organism into its role.', background: null,
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

/** Third fictional sample: grammar engine, sentence building and speaking (device voice, no audio files needed). */
export function sampleLanguageActivity(): Activity {
  const a = createActivity('Grammar lab: passive voice and word order');
  a.description = 'Rewrite, correct and build sentences, then practise saying them.';
  a.subject = 'English Language Acquisition';
  a.gradeBand = 'Grade 8';
  const id = (p: Parameters<typeof randomId>[0]) => randomId(p);
  a.items = [
    {
      type: 'sentence-response', id: id('itm'), audioCue: null, task: 'transform', prompt: 'Rewrite the sentence in the passive voice.', source: 'Scientists discovered a new species of frog.', starter: '',
      accepted: ['A new species of frog was discovered{| by scientists}.'],
      errorRules: [
        { id: id('chc'), pattern: 'A new species of frog {was discover|was discovering|is discovered|discovered}{| by scientists}.', errorType: 'verb form', feedback: 'The passive uses was/were + past participle (discovered).' },
        { id: id('chc'), pattern: 'A new species of frog were discovered{| by scientists}.', errorType: 'subject-verb agreement', feedback: '“A new species” is singular, so use “was”.' },
      ],
      keywords: [{ id: id('chc'), forms: ['species'] }, { id: id('chc'), forms: ['frog'] }], meaningWeight: 0.5,
      match: { caseSensitive: true, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, unmatched: 'review', points: 2, feedback: {}, skills: ['passive voice'],
    },
    {
      type: 'sentence-response', id: id('itm'), audioCue: null, task: 'correct', prompt: 'Find the mistake and write the sentence correctly.', source: 'The results of the experiment was surprising.', starter: '',
      accepted: ['The results of the experiment were surprising.'],
      errorRules: [{ id: id('chc'), pattern: 'The results of the experiment {was|is} surprising.', errorType: 'subject-verb agreement', feedback: 'The subject is “results” (plural), not “experiment”.' }],
      keywords: [], meaningWeight: 0.5, match: { caseSensitive: true, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, unmatched: 'review', points: 1, feedback: {}, skills: ['subject-verb agreement'],
    },
    {
      type: 'sentence-builder', id: id('itm'), audioCue: null, prompt: 'Put the words in the correct order.', sentence: 'The samples / were collected / near / the river / last week.',
      alternatives: ['Last week the samples were collected near the river.'], distractors: ['was'], lowercaseCards: true,
      match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, points: 1, scoring: 'all-or-nothing', feedback: {}, skills: ['word order', 'passive voice'],
    },
    {
      type: 'speaking', id: id('itm'), prompt: 'Listen to each sentence, then record yourself. Compare your recording with the model.', language: 'en-US',
      targets: [
        { id: id('seq'), text: 'The results were surprising.', focus: 'Stress: reSULTS, surPRISing', modelAudio: null },
        { id: id('seq'), text: 'A new species was discovered.', focus: 'Final /d/ in “discovered”', modelAudio: null },
      ],
      ttsFallback: true, modelBeforeRecording: true, maxRecordings: null, maxSeconds: 20, submission: 'optional', selfAssessment: true, speechToText: false, scoring: 'completion', points: 1, feedback: {}, skills: ['pronunciation'],
    },
  ];
  return a;
}

const READING = `Ocean Acidification

The ocean absorbs about a quarter of the carbon dioxide (CO₂) that people release by burning fossil fuels. This helps slow climate change, but it also changes the chemistry of seawater.

When CO₂ dissolves in seawater, it forms carbonic acid. Since the start of the Industrial Revolution, the average pH of surface seawater has fallen from about 8.2 to about 8.1. Because the pH scale is logarithmic, this small change means the water is roughly 30% more acidic.

Many sea creatures build shells and skeletons from calcium carbonate. In more acidic water, there are fewer carbonate ions available, so oysters, clams, corals and some plankton must use more energy to build their shells. In very acidic conditions, shells can even begin to dissolve.

These changes affect whole food webs. Tiny shelled plankton called pteropods are food for fish such as salmon. If pteropods struggle to survive, the animals that eat them may struggle too.`;

/** Fourth fictional sample: Observation Notes with a CER writing task (science). Reading text is written for this sample. */
export function sampleObservationActivity(): Activity {
  const a = createActivity('Observation notes: ocean acidification');
  a.description = 'Read closely, mark what you notice, answer the paragraph questions, then write a CER explanation.';
  a.subject = 'Science';
  a.gradeBand = 'Grade 7';
  const blocks = blocksFromPlainText(READING, () => randomId('blk'));
  const first = blocks[0]!;
  if (first.kind === 'paragraph') blocks[0] = { kind: 'heading', id: first.id, level: 1, runs: first.runs };
  const reading = { title: '', attribution: 'Fictional sample text written for this demo.', original: null, blocks, numbering: true, approval: null as null | { hash: string; approvedAt: string } };
  reading.approval = { hash: readingHash(reading), approvedAt: new Date().toISOString() };
  const symbols = SYMBOL_PRESETS.science.symbols();
  const ev = symbols.find((s) => s.code === 'EV')!;
  const voc = symbols.find((s) => s.code === 'VOC')!;
  const sections = FRAMEWORK_PRESETS.cer.sections();
  a.items = [{
    type: 'observation-notes', id: randomId('itm'), title: 'Ocean acidification', instructions: 'Read the text. Mark at least 3 pieces of evidence and 2 vocabulary words. Answer the questions, then write your CER.',
    reading, symbols, minAnnotations: { [ev.id]: 3, [voc.id]: 2 },
    prompts: [
      { id: randomId('prm'), unitId: blocks[2]!.id, question: 'What happens to seawater when it absorbs CO₂?' },
      { id: randomId('prm'), unitId: blocks[3]!.id, question: 'Why is it harder for oysters and corals to build shells?' },
    ],
    cornell: { enabled: true, summaryMinWords: 20 }, answerAllPrompts: true,
    writing: {
      framework: 'cer', prompt: 'How does ocean acidification affect sea creatures? Use evidence from the text.', sections, minCitations: 2, requiredTerms: ['carbonate'],
      rubric: [
        { id: randomId('rub'), label: 'Claim', levels: [{ id: randomId('rub'), label: 'Beginning', points: 1, descriptor: 'Claim is missing or unclear' }, { id: randomId('rub'), label: 'Secure', points: 2, descriptor: 'Clear claim that answers the question' }] },
        { id: randomId('rub'), label: 'Evidence', levels: [{ id: randomId('rub'), label: 'Beginning', points: 1, descriptor: 'One piece of evidence, not cited' }, { id: randomId('rub'), label: 'Secure', points: 3, descriptor: 'Two or more cited pieces of evidence' }] },
        { id: randomId('rub'), label: 'Reasoning', levels: [{ id: randomId('rub'), label: 'Beginning', points: 1, descriptor: 'Restates evidence' }, { id: randomId('rub'), label: 'Secure', points: 3, descriptor: 'Explains the science (carbonate ions, shells)' }] },
      ],
      successCriteria: [{ id: randomId('sec'), text: 'I can make a claim that answers the question.' }, { id: randomId('sec'), text: 'I can cite evidence with paragraph numbers.' }],
      rubricSelfAssessment: true,
    },
    scoring: 'teacher-review', points: 8, skills: ['close reading', 'CER writing'],
  }];
  return a;
}
