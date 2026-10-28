import type { ItemType } from '@ilp/core';
import { contentPlugin } from './content';
import { fillBlanksPlugin } from './fillBlanks';
import { multipleChoicePlugin } from './multipleChoice';
import { trueFalsePlugin } from './trueFalse';
import type { ItemPlugin } from './types';

/** UI plugins keyed by item type. Adding a question type = core definition + one entry here. */
const plugins: Record<ItemType, ItemPlugin<any, any>> = {
  content: contentPlugin,
  'multiple-choice': multipleChoicePlugin,
  'true-false': trueFalsePlugin,
  'fill-blanks': fillBlanksPlugin,
};

export function getPlugin(type: ItemType): ItemPlugin<any, any> {
  return plugins[type];
}

/** Order shown in the "Add" menu. */
export const ADDABLE_TYPES: ItemType[] = ['multiple-choice', 'true-false', 'fill-blanks', 'content'];
