import type { Activity, Item } from './schema/activity';
import { getItemDefinition } from './items/registry';
import { seededShuffle } from './random';

/**
 * Decide which items an attempt shows, and in what order. Deterministic for a
 * given seed (the attempt id), so the student, the report and a re-grading
 * broker all agree. Non-question blocks always keep their authored position.
 */
export function selectItemIds(activity: Activity, seed: string): string[] {
  const exclude = new Set<string>();
  for (const pool of activity.pools) {
    const members = pool.itemIds.filter((id) => activity.items.some((i) => i.id === id));
    const keep = new Set(seededShuffle(members, `${seed}:${pool.id}`).slice(0, pool.draw));
    for (const id of members) if (!keep.has(id)) exclude.add(id);
  }
  const chosen = activity.items.filter((i) => !exclude.has(i.id));
  if (!activity.settings.shuffleItems) return chosen.map((i) => i.id);
  const isQ = (i: Item) => getItemDefinition(i.type).scorable;
  const shuffled = seededShuffle(chosen.filter(isQ), `${seed}:order`);
  let k = 0;
  return chosen.map((i) => (isQ(i) ? shuffled[k++]! : i).id);
}

/** Items presented in an attempt; null means every item in authored order (pre-pool attempts). */
export function presentedItems(activity: Activity, presentedItemIds: string[] | null): Item[] {
  if (!presentedItemIds) return activity.items;
  const byId = new Map(activity.items.map((i) => [i.id, i]));
  return presentedItemIds.map((id) => byId.get(id)).filter((i): i is Item => i !== undefined);
}
