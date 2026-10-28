import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Activity, Attempt, PublishedVersion } from '@ilp/core';
import { journalClearAll, journalClearFor } from './journal';

/**
 * Local-first storage (IndexedDB). Everything a teacher or student creates is
 * written here first; Drive sync (Phase 5) reads from these stores.
 * Nothing in this database is sent anywhere in Phase 1.
 */
interface IlpDB extends DBSchema {
  activities: { key: string; value: Activity };
  versions: { key: [string, number]; value: PublishedVersion; indexes: { byActivity: string } };
  attempts: { key: string; value: Attempt; indexes: { byActivity: string; byActivityVersion: [string, number] } };
  meta: { key: string; value: { key: string; value: unknown } };
}

export const DB_NAME = 'ilp';
const DB_VERSION = 1;
let dbPromise: Promise<IDBPDatabase<IlpDB>> | null = null;

export function db(): Promise<IDBPDatabase<IlpDB>> {
  dbPromise ??= openDB<IlpDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('activities', { keyPath: 'id' });
        const versions = database.createObjectStore('versions', { keyPath: ['activityId', 'version'] });
        versions.createIndex('byActivity', 'activityId');
        const attempts = database.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('byActivity', 'activityId');
        attempts.createIndex('byActivityVersion', ['activityId', 'version']);
        database.createObjectStore('meta', { keyPath: 'key' });
      }
    },
    blocking() {
      // Another tab is upgrading the schema; release our connection.
      void dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}

/** For tests: drop the cached connection. */
export async function closeDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

// ---- Activities (teacher drafts) ----
export async function listActivities(): Promise<Activity[]> {
  const all = await (await db()).getAll('activities');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getActivity(id: string): Promise<Activity | undefined> {
  return (await db()).get('activities', id);
}
export async function putActivity(a: Activity): Promise<void> {
  await (await db()).put('activities', a);
}

// ---- Published versions (immutable) ----
export async function putVersion(v: PublishedVersion): Promise<void> {
  const d = await db();
  const tx = d.transaction('versions', 'readwrite');
  const existing = await tx.store.get([v.activityId, v.version]);
  if (existing && existing.contentHash !== v.contentHash) {
    throw new Error(`Version ${v.version} of this activity already exists and cannot be overwritten.`);
  }
  if (!existing) await tx.store.add(v);
  await tx.done;
}
export async function getVersion(activityId: string, version: number): Promise<PublishedVersion | undefined> {
  return (await db()).get('versions', [activityId, version]);
}
export async function listVersions(activityId: string): Promise<PublishedVersion[]> {
  const all = await (await db()).getAllFromIndex('versions', 'byActivity', activityId);
  return all.sort((a, b) => a.version - b.version);
}
/** Latest published version of every activity available on this device. */
export async function listLatestVersions(): Promise<PublishedVersion[]> {
  const latest = new Map<string, PublishedVersion>();
  for (const v of await (await db()).getAll('versions')) {
    const cur = latest.get(v.activityId);
    if (!cur || v.version > cur.version) latest.set(v.activityId, v);
  }
  return [...latest.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// ---- Attempts (student work, autosaved) ----
export async function putAttempt(a: Attempt): Promise<void> {
  await (await db()).put('attempts', a);
}
export async function getAttempt(id: string): Promise<Attempt | undefined> {
  return (await db()).get('attempts', id);
}
export async function listAttempts(activityId: string, version?: number, mode?: Attempt['mode']): Promise<Attempt[]> {
  const d = await db();
  const rows = version === undefined ? await d.getAllFromIndex('attempts', 'byActivity', activityId) : await d.getAllFromIndex('attempts', 'byActivityVersion', [activityId, version]);
  return rows.filter((r) => mode === undefined || r.mode === mode).sort((a, b) => a.attemptNumber - b.attemptNumber || a.startedAt.localeCompare(b.startedAt));
}
export async function deleteAttempts(activityId: string, mode: Attempt['mode']): Promise<number> {
  const d = await db();
  const tx = d.transaction('attempts', 'readwrite');
  let n = 0;
  for (const a of await tx.store.index('byActivity').getAll(activityId)) {
    if (a.mode === mode) {
      await tx.store.delete(a.id);
      n++;
    }
  }
  await tx.done;
  journalClearFor(activityId, mode);
  return n;
}

/**
 * Delete an activity draft and its published versions. Student attempts are
 * kept unless `includeStudentWork` is true, so work is never silently lost.
 */
export async function deleteActivity(id: string, includeStudentWork = false): Promise<void> {
  const d = await db();
  const tx = d.transaction(['activities', 'versions', 'attempts'], 'readwrite');
  await tx.objectStore('activities').delete(id);
  const versions = tx.objectStore('versions');
  for (const key of await versions.index('byActivity').getAllKeys(id)) await versions.delete(key);
  const attempts = tx.objectStore('attempts');
  for (const a of await attempts.index('byActivity').getAll(id)) {
    if (a.mode === 'preview' || includeStudentWork) await attempts.delete(a.id);
  }
  await tx.done;
  journalClearFor(id, includeStudentWork ? undefined : 'preview');
}

// ---- Meta / preferences ----
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', { key, value });
}

/** Erase everything this app stored on this device (activities, versions, work, preferences). */
export async function clearAllData(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['activities', 'versions', 'attempts', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('activities').clear(), tx.objectStore('versions').clear(), tx.objectStore('attempts').clear(), tx.objectStore('meta').clear(), tx.done]);
  journalClearAll();
}

export async function countStudentAttempts(activityId: string): Promise<number> {
  return (await listAttempts(activityId)).filter((a) => a.mode === 'student').length;
}
