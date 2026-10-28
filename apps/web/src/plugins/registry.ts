import type { ItemType } from '@ilp/core';
import { contentPlugin } from './content';
import { fillBlanksPlugin } from './fillBlanks';
import { multipleChoicePlugin } from './multipleChoice';
import { trueFalsePlugin } from './trueFalse';
import { dragWordsPlugin } from './dragWords';
import { dropdownClozePlugin } from './dropdownCloze';
import { matchingPlugin } from './matching';
import { sequencingPlugin } from './sequencing';
import { markWordsPlugin } from './markWords';
import { dragDropPlugin } from './dragDrop';
import { hotspotPlugin } from './hotspot';
import { audioPlugin } from './audio';
import { dictationPlugin } from './dictation';
import { sentenceResponsePlugin } from './sentenceResponse';
import { sentenceBuilderPlugin } from './sentenceBuilder';
import { speakingPlugin } from './speaking';
import { observationNotesPlugin } from './observationNotes';
import { writingPlugin } from './writing';
import type { ItemPlugin } from './types';

/** UI plugins keyed by item type. Adding a question type = core definition + one entry here. */
const plugins: Record<ItemType, ItemPlugin<any, any>> = {
  content: contentPlugin,
  'multiple-choice': multipleChoicePlugin,
  'true-false': trueFalsePlugin,
  'fill-blanks': fillBlanksPlugin,
  'drag-words': dragWordsPlugin,
  'dropdown-cloze': dropdownClozePlugin,
  matching: matchingPlugin,
  sequencing: sequencingPlugin,
  'mark-words': markWordsPlugin,
  'drag-drop': dragDropPlugin,
  hotspot: hotspotPlugin,
  audio: audioPlugin,
  dictation: dictationPlugin,
  'sentence-response': sentenceResponsePlugin,
  'sentence-builder': sentenceBuilderPlugin,
  speaking: speakingPlugin,
  'observation-notes': observationNotesPlugin,
  writing: writingPlugin,
};

export function getPlugin(type: ItemType): ItemPlugin<any, any> {
  return plugins[type];
}

/** Grouped for the "Add" menu. */
export const ADD_GROUPS: Array<{ label: string; types: ItemType[] }> = [
  { label: 'Choose', types: ['multiple-choice', 'true-false', 'hotspot'] },
  { label: 'Complete the text', types: ['fill-blanks', 'drag-words', 'dropdown-cloze', 'mark-words'] },
  { label: 'Arrange and sort', types: ['matching', 'sequencing', 'drag-drop'] },
  { label: 'Grammar and writing', types: ['sentence-response', 'sentence-builder'] },
  { label: 'Listening and speaking', types: ['audio', 'dictation', 'speaking'] },
  { label: 'Reading and writing', types: ['observation-notes', 'writing'] },
  { label: 'Content', types: ['content'] },
];
export const ADDABLE_TYPES: ItemType[] = ADD_GROUPS.flatMap((g) => g.types);
