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
      return { type, id, prompt: '', correct: true, trueLabel: 'True', falseLabel: 'False', points: 1, feedback: {}, skills: [] };
    case 'fill-blanks':
      return {
        type,
        id,
        prompt: 'Complete the sentence.',
        segments: [],
        match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] },
        points: 1,
        scoring: 'per-blank',
        feedback: {},
        skills: [],
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
  const items = source.items.map(cloneItem);
  return {
    ...structuredClone(source),
    id: randomId('act'),
    title: `${source.title} (copy)`,
    items,
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
