import { publishActivity, type Activity, type PublishedVersion } from '@ilp/core';
import { sampleActivity } from '../src/teacher/sample';
import { putActivity, putVersion } from '../src/storage/db';

/** Fictional activity with fixed, readable ids for UI tests. */
export function testActivity(overrides: Partial<Activity['settings']> = {}): Activity {
  const a = sampleActivity();
  a.title = 'Test: past simple';
  a.settings = { ...a.settings, ...overrides };
  // Turn off shuffling so the order is predictable in tests.
  a.items = a.items.map((i) => (i.type === 'multiple-choice' ? { ...i, shuffleChoices: false } : i));
  return a;
}

export async function published(a: Activity = testActivity()): Promise<PublishedVersion> {
  const { version, draft } = await publishActivity(a);
  await putActivity(draft);
  await putVersion(version);
  return version;
}

/** A real 1×1 PNG for media tests. */
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
