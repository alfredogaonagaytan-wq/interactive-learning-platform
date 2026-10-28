import { contentHash, createZipPackage, publishActivity, readAnyPackage, type Activity, type PublishedVersion } from '@ilp/core';
import { getActivity, getAsset, listVersions, putActivity, putAsset, putVersion } from './db';

/** Save a draft edit: bumps revision so "unpublished changes" can be detected. */
export async function saveDraft(a: Activity): Promise<Activity> {
  const next = { ...a, revision: a.revision + 1, updatedAt: new Date().toISOString() };
  await putActivity(next);
  return next;
}

export async function publish(a: Activity): Promise<{ draft: Activity; version: PublishedVersion }> {
  const { draft, version } = await publishActivity(a);
  await putVersion(version);
  await putActivity(draft);
  return { draft, version };
}

/** Export as a zip package (activities + their images). */
export async function exportPackage(activities: Activity[]): Promise<Uint8Array> {
  return createZipPackage(activities, async (id) => {
    const a = await getAsset(id);
    return a && { mime: a.mime, bytes: a.bytes };
  });
}

async function readAndStoreMedia(bytes: Uint8Array): Promise<Activity[]> {
  const { activities, assets } = await readAnyPackage(bytes);
  for (const a of assets) await putAsset({ id: a.id, mime: a.mime, bytes: a.bytes, name: a.id, addedAt: new Date().toISOString() });
  return activities;
}

/**
 * Teacher import: adds activities as editable drafts. If an activity with the
 * same id already exists locally, the import becomes a separate copy (new id)
 * rather than overwriting the teacher's work.
 */
export async function importAsDrafts(bytes: Uint8Array, newId: () => string): Promise<Activity[]> {
  const activities = await readAndStoreMedia(bytes);
  const out: Activity[] = [];
  for (const incoming of activities) {
    const exists = await getActivity(incoming.id);
    const a: Activity = { ...incoming, id: exists ? newId() : incoming.id, title: exists ? `${incoming.title} (imported)` : incoming.title, updatedAt: new Date().toISOString() };
    await putActivity(a);
    out.push(a);
  }
  return out;
}

/**
 * Student import: makes activities playable (as published versions) without
 * adding them to the teacher library. Re-importing identical content is a
 * no-op; changed content becomes the next version.
 */
export async function importForStudent(bytes: Uint8Array): Promise<PublishedVersion[]> {
  const activities = await readAndStoreMedia(bytes);
  const out: PublishedVersion[] = [];
  for (const a of activities) {
    const existing = await listVersions(a.id);
    const { version } = await publishActivity({ ...a, publishedVersion: existing.at(-1)?.version ?? null });
    const same = existing.find((v) => v.contentHash === version.contentHash);
    if (same) {
      out.push(same);
      continue;
    }
    await putVersion(version);
    out.push(version);
  }
  return out;
}

/** A transient snapshot of the current draft, used by preview modes. */
export async function draftSnapshot(a: Activity): Promise<PublishedVersion> {
  const snapshot = structuredClone(a);
  return {
    kind: 'ilp.publishedVersion',
    activityId: a.id,
    version: (a.publishedVersion ?? 0) + 1,
    publishedAt: new Date().toISOString(),
    contentHash: await contentHash({ ...snapshot, updatedAt: undefined, publishedVersion: undefined, publishedRevision: undefined, revision: undefined }),
    activity: snapshot,
  };
}
