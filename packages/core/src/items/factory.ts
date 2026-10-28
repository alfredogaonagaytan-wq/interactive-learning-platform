import type { Item, ItemType } from '../schema/activity';
import type { Activity } from '../schema/activity';
import { DEFAULT_SETTINGS, CURRENT_SCHEMA_VERSION } from '../schema/activity';
import { randomId } from '../ids';

/** Default content for a newly added item of each type. */
export function createItem(type: ItemType): Item {
  const id = randomId('itm');
  switch (type) {
    case 'content':
      return { type, id, title: '', body: '' };
    case 'multiple-choice':
      return {
        type,
        id,
        audioCue: null,
        prompt: '',
        mode: 'single',
        choices: [
          { id: randomId('chc'), text: '', correct: true },
          { id: randomId('chc'), text: '', correct: false },
        ],
        shuffleChoices: false,
        points: 1,
        scoring: 'all-or-nothing',
        feedback: {},
        skills: [],
      };
    case 'true-false':
      return { type, id, audioCue: null, prompt: '', correct: true, trueLabel: 'True', falseLabel: 'False', points: 1, feedback: {}, skills: [] };
    case 'fill-blanks':
      return {
        type,
        id,
        audioCue: null,
        prompt: 'Complete the sentence.',
        segments: [],
        match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] },
        points: 1,
        scoring: 'per-blank',
        feedback: {},
        skills: [],
      };
    case 'drag-words':
      return { type, id, audioCue: null, prompt: 'Drag the words into the gaps.', segments: [], distractors: [], points: 1, scoring: 'per-blank', feedback: {}, skills: [] };
    case 'dropdown-cloze':
      return { type, id, audioCue: null, prompt: 'Choose the correct word in each gap.', segments: [], points: 1, scoring: 'per-blank', feedback: {}, skills: [] };
    case 'matching':
      return {
        type, id, audioCue: null, prompt: 'Match each item with its partner.',
        pairs: [
          { id: randomId('par'), left: '', leftImage: null, right: '' },
          { id: randomId('par'), left: '', leftImage: null, right: '' },
        ],
        distractors: [], points: 1, scoring: 'per-pair', feedback: {}, skills: [],
      };
    case 'sequencing':
      return {
        type, id, audioCue: null, prompt: 'Put these in the correct order.', display: 'list',
        steps: [
          { id: randomId('seq'), text: '', image: null },
          { id: randomId('seq'), text: '', image: null },
          { id: randomId('seq'), text: '', image: null },
        ],
        points: 1, scoring: 'per-position', feedback: {}, skills: [],
      };
    case 'mark-words':
      return { type, id, audioCue: null, prompt: 'Click all the verbs.', text: '', points: 1, feedback: {}, skills: [] };
    case 'drag-drop': {
      const a = randomId('zon');
      const b = randomId('zon');
      return {
        type, id, audioCue: null, prompt: 'Drag each card to the correct box.', background: null,
        zones: [
          { id: a, label: 'Group A', showLabel: true, x: 5, y: 10, w: 40, h: 30, capacity: null },
          { id: b, label: 'Group B', showLabel: true, x: 55, y: 10, w: 40, h: 30, capacity: null },
        ],
        draggables: [
          { id: randomId('drg'), text: '', image: null, correctZoneIds: [a] },
          { id: randomId('drg'), text: '', image: null, correctZoneIds: [b] },
        ],
        points: 1, scoring: 'per-item', feedback: {}, skills: [],
      };
    }
    case 'hotspot':
      return { type, id, audioCue: null, prompt: '', image: null, hotspots: [], allowListAlternative: true, points: 1, feedback: {}, skills: [] };
    case 'sentence-response':
      return {
        type, id, audioCue: null, task: 'transform', prompt: 'Rewrite the sentence in the past simple.', source: '', starter: '', accepted: [''], errorRules: [], keywords: [], meaningWeight: 0.5,
        match: { caseSensitive: true, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, unmatched: 'review', points: 1, feedback: {}, skills: [],
      };
    case 'sentence-builder':
      return { type, id, audioCue: null, prompt: 'Put the words in the correct order.', sentence: '', alternatives: [], distractors: [], lowercaseCards: false, match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, points: 1, scoring: 'all-or-nothing', feedback: {}, skills: ['word order'] };
    case 'audio':
      return { type, id, title: '', instructions: '', audio: null, maxPlays: null, speeds: [0.75, 1], transcript: 'after-submit' };
    case 'dictation':
      return { type, id, prompt: 'Listen and write what you hear.', audio: null, text: '', alternatives: [], maxPlays: 3, slowSpeed: true, typoHalf: true, match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, points: 1, feedback: {}, skills: ['listening', 'spelling'] };
    case 'speaking':
      return {
        type, id, prompt: 'Listen, then record yourself saying each phrase.', language: 'en-US', targets: [{ id: randomId('seq'), text: '', focus: '', modelAudio: null }],
        ttsFallback: true, modelBeforeRecording: true, maxRecordings: null, maxSeconds: 30, submission: 'none', selfAssessment: true, speechToText: false, scoring: 'completion', points: 1, feedback: {}, skills: ['pronunciation'],
      };
  }
}

export function createActivity(title = 'Untitled activity', now = new Date()): Activity {
  const ts = now.toISOString();
  return {
    kind: 'ilp.activity',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomId('act'),
    title,
    description: '',
    language: 'en',
    subject: '',
    gradeBand: '',
    items: [],
    pools: [],
    settings: { ...DEFAULT_SETTINGS },
    revision: 0,
    publishedVersion: null,
    publishedRevision: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Deep copy with fresh ids for the activity and every item/choice/blank. */
export function duplicateActivity(source: Activity, now = new Date()): Activity {
  const ts = now.toISOString();
  const idMap = new Map<string, string>();
  const items = source.items.map((it) => {
    const c = cloneItem(it);
    idMap.set(it.id, c.id);
    return c;
  });
  const pools = source.pools.map((p) => ({ ...p, itemIds: p.itemIds.map((i) => idMap.get(i) ?? i) }));
  return {
    ...structuredClone(source),
    id: randomId('act'),
    title: `${source.title} (copy)`,
    items,
    pools,
    revision: 0,
    publishedVersion: null,
    publishedRevision: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Copy of an item with fresh ids for the item and its choices/blanks. */
export function cloneItem(it: Item): Item {
  const id = randomId('itm');
  const copy = structuredClone(it);
  if (copy.type === 'multiple-choice') return { ...copy, id, choices: copy.choices.map((c) => ({ ...c, id: randomId('chc') })) };
  if (copy.type === 'fill-blanks') return { ...copy, id, segments: copy.segments.map((s) => (s.kind === 'blank' ? { ...s, id: randomId('blk') } : s)) };
  return { ...copy, id };
}
