import { getMeta, purgeRecordingsOlderThan, setMeta } from './db';

/** Device-level recording retention preferences (stored locally). */
export interface RetentionPrefs {
  /** Delete practice recordings that were not chosen for submission when an attempt is submitted. */
  deleteUnselectedOnSubmit: boolean;
  /** Delete any recording older than this many days. */
  maxAgeDays: number;
}
export const DEFAULT_RETENTION: RetentionPrefs = { deleteUnselectedOnSubmit: true, maxAgeDays: 14 };

export async function getRetention(): Promise<RetentionPrefs> {
  return { ...DEFAULT_RETENTION, ...((await getMeta<Partial<RetentionPrefs>>('retention')) ?? {}) };
}
export async function setRetention(p: RetentionPrefs): Promise<void> {
  await setMeta('retention', p);
}
/** Run at start-up. */
export async function applyRetention(): Promise<number> {
  return purgeRecordingsOlderThan((await getRetention()).maxAgeDays);
}
