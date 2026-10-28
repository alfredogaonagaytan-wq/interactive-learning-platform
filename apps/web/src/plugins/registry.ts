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
};

export function getPlugin(type: ItemType): ItemPlugin<any, any> {
  return plugins[type];
}

/** Grouped for the "Add" menu. */
export const ADD_GROUPS: Array<{ label: string; types: ItemType[] }> = [
  { label: 'Choose', types: ['multiple-choice', 'true-false', 'hotspot'] },
  { label: 'Complete the text', types: ['fill-blanks', 'drag-words', 'dropdown-cloze', 'mark-words'] },
  { label: 'Arrange and sort', types: ['matching', 'sequencing', 'drag-drop'] },
  { label: 'Content', types: ['content'] },
];
export const ADDABLE_TYPES: ItemType[] = ADD_GROUPS.flatMap((g) => g.types);
