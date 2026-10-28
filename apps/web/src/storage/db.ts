import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CURRENT_SCHEMA_VERSION, parseActivity, upgradePublishedVersion, type Activity, type Attempt, type Item, type MediaType, type PublishedVersion } from '@ilp/core';
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
  /** Content-addressed media (images now, audio in Phase 3). Immutable. */
  assets: { key: string; value: StoredAsset };
  /** Teacher's reusable question bank. */
  bank: { key: string; value: BankEntry };
  /** Student voice recordings. Kept on this device only, subject to retention settings. */
  recordings: { key: string; value: StoredRecording; indexes: { byAttempt: string } };
}

export interface StoredRecording {
  id: string;
  attemptId: string;
  activityId: string;
  itemId: string;
  targetId: string;
  mime: string;
  bytes: Uint8Array;
  durationMs: number;
  createdAt: string;
}

export interface StoredAsset {
  id: string;
  mime: MediaType;
  bytes: Uint8Array;
  name: string;
  addedAt: string;
}

export interface BankEntry {
  id: string;
  item: Item;
  /** Free-text tags, e.g. topic or unit. */
  tags: string[];
  sourceActivityTitle: string;
  savedAt: string;
}

export const DB_NAME = 'ilp';
const DB_VERSION = 3;
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
      if (oldVersion < 2) {
        database.createObjectStore('assets', { keyPath: 'id' });
        database.createObjectStore('bank', { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        database.createObjectStore('recordings', { keyPath: 'id' }).createIndex('byAttempt', 'attemptId');
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
  const all = (await (await db()).getAll('activities')).map(upgrade);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getActivity(id: string): Promise<Activity | undefined> {
  const a = await (await db()).get('activities', id);
  return a && upgrade(a);
}

/** Stored documents may predate the current schema; upgrade them in memory on read. */
function upgrade(a: Activity): Activity {
  return a.schemaVersion === CURRENT_SCHEMA_VERSION ? a : parseActivity(a);
}
function upgradeVersion(v: PublishedVersion): PublishedVersion {
  return v.activity.schemaVersion === CURRENT_SCHEMA_VERSION ? v : upgradePublishedVersion(v);
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
  const v = await (await db()).get('versions', [activityId, version]);
  return v && upgradeVersion(v);
}
export async function listVersions(activityId: string): Promise<PublishedVersion[]> {
  const all = (await (await db()).getAllFromIndex('versions', 'byActivity', activityId)).map(upgradeVersion);
  return all.sort((a, b) => a.version - b.version);
}
/** Latest published version of every activity available on this device. */
export async function listLatestVersions(): Promise<PublishedVersion[]> {
  const latest = new Map<string, PublishedVersion>();
  for (const v of (await (await db()).getAll('versions')).map(upgradeVersion)) {
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
  const removed: string[] = [];
  for (const a of await tx.store.index('byActivity').getAll(activityId)) {
    if (a.mode === mode) {
      await tx.store.delete(a.id);
      removed.push(a.id);
      n++;
    }
  }
  await tx.done;
  journalClearFor(activityId, mode);
  for (const id of removed) await deleteRecordingsExcept(id, new Set());
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
  const stores = ['activities', 'versions', 'attempts', 'meta', 'assets', 'bank', 'recordings'] as const;
  const tx = d.transaction([...stores], 'readwrite');
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  journalClearAll();
}

export async function countStudentAttempts(activityId: string): Promise<number> {
  return (await listAttempts(activityId)).filter((a) => a.mode === 'student').length;
}

// ---- Assets ----
export async function putAsset(a: StoredAsset): Promise<void> {
  const d = await db();
  // Content-addressed: an existing asset with the same id is identical.
  if (!(await d.getKey('assets', a.id))) await d.put('assets', a);
}
export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  return (await db()).get('assets', id);
}

// ---- Question bank ----
export async function putBankEntry(e: BankEntry): Promise<void> {
  await (await db()).put('bank', e);
}
export async function listBank(): Promise<BankEntry[]> {
  return (await (await db()).getAll('bank')).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function deleteBankEntry(id: string): Promise<void> {
  await (await db()).delete('bank', id);
}

// ---- Recordings (student audio; device-only) ----
export async function putRecording(r: StoredRecording): Promise<void> {
  await (await db()).put('recordings', r);
}
export async function getRecording(id: string): Promise<StoredRecording | undefined> {
  return (await db()).get('recordings', id);
}
export async function listRecordings(attemptId?: string): Promise<StoredRecording[]> {
  const d = await db();
  const rows = attemptId ? await d.getAllFromIndex('recordings', 'byAttempt', attemptId) : await d.getAll('recordings');
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function deleteRecording(id: string): Promise<void> {
  await (await db()).delete('recordings', id);
}
/** Delete an attempt's recordings except the ones listed (e.g. the selected submissions). */
export async function deleteRecordingsExcept(attemptId: string, keep: ReadonlySet<string>): Promise<number> {
  let n = 0;
  for (const r of await listRecordings(attemptId)) {
    if (!keep.has(r.id)) {
      await deleteRecording(r.id);
      n++;
    }
  }
  return n;
}
export async function deleteAllRecordings(): Promise<void> {
  await (await db()).clear('recordings');
}
/** Retention: remove recordings older than `days`. Returns how many were removed. */
export async function purgeRecordingsOlderThan(days: number, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  let n = 0;
  for (const r of await listRecordings()) {
    if (r.createdAt < cutoff) {
      await deleteRecording(r.id);
      n++;
    }
  }
  return n;
}
