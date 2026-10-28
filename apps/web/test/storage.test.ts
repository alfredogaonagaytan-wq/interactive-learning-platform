import { describe, expect, it } from 'vitest';
import { createPackage, publishActivity, randomId, type Attempt } from '@ilp/core';
import {
  clearAllData, countStudentAttempts, deleteActivity, getActivity, getMeta, getVersion, listActivities, listAttempts, listLatestVersions, putActivity,
  putAttempt, putVersion, setMeta,
} from '../src/storage/db';
import { importAsDrafts, importForStudent, publish, saveDraft } from '../src/storage/library';
import { published, testActivity } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);

function attempt(activityId: string, mode: Attempt['mode'], version = 1): Attempt {
  const now = new Date().toISOString();
  return { kind: 'ilp.attempt', schemaVersion: 1, id: randomId('att'), activityId, version, contentHash: 'sha256:x', mode, assignmentId: null, attemptNumber: 1, status: 'in-progress', presentedItemIds: null, mediaPlays: {}, responses: {}, checks: {}, hintsUsed: {}, startedAt: now, updatedAt: now, submittedAt: null, sync: 'local-only' };
}

describe('local storage', () => {
  it('saves drafts and bumps the revision', async () => {
    const a = testActivity();
    const saved = await saveDraft(a);
    expect(saved.revision).toBe(a.revision + 1);
    expect((await getActivity(a.id))?.revision).toBe(saved.revision);
  });

  it('published versions are immutable', async () => {
    const v = await published();
    await expect(putVersion({ ...v, contentHash: 'sha256:different' })).rejects.toThrow(/cannot be overwritten/);
    await putVersion(v); // identical re-put is a harmless no-op
    expect((await getVersion(v.activityId, 1))?.contentHash).toBe(v.contentHash);
  });

  it('editing and republishing keeps version 1 intact for existing attempts', async () => {
    const v1 = await published();
    await putAttempt({ ...attempt(v1.activityId, 'student'), contentHash: v1.contentHash });
    const draft = (await getActivity(v1.activityId))!;
    const { version: v2 } = await publish({ ...draft, title: 'Edited title', revision: draft.revision + 1 });
    expect(v2.version).toBe(2);
    expect((await getVersion(v1.activityId, 1))?.activity.title).toBe('Test: past simple');
    expect((await listAttempts(v1.activityId, 1))[0]?.contentHash).toBe(v1.contentHash);
    expect((await listLatestVersions())[0]?.version).toBe(2);
  });

  it('deleting an activity keeps student work unless explicitly included', async () => {
    const v = await published();
    await putAttempt(attempt(v.activityId, 'student'));
    await putAttempt(attempt(v.activityId, 'preview'));
    await deleteActivity(v.activityId);
    expect(await getActivity(v.activityId)).toBeUndefined();
    expect(await getVersion(v.activityId, 1)).toBeUndefined();
    expect(await countStudentAttempts(v.activityId)).toBe(1);
    expect((await listAttempts(v.activityId)).some((a) => a.mode === 'preview')).toBe(false);
    await deleteActivity(v.activityId, true);
    expect(await listAttempts(v.activityId)).toEqual([]);
  });

  it('clearAllData erases every store (data deletion)', async () => {
    const v = await published();
    await putAttempt(attempt(v.activityId, 'student'));
    await setMeta('role', 'teacher');
    await clearAllData();
    expect(await listActivities()).toEqual([]);
    expect(await listLatestVersions()).toEqual([]);
    expect(await listAttempts(v.activityId)).toEqual([]);
    expect(await getMeta('role')).toBeUndefined();
  });
});

describe('import', () => {
  it('teacher import never overwrites an existing activity', async () => {
    const a = testActivity();
    await putActivity(a);
    const text = enc(JSON.stringify(await createPackage([a])));
    const [copy] = await importAsDrafts(text, () => 'act_newcopy');
    expect(copy?.id).toBe('act_newcopy');
    expect(copy?.title).toMatch(/imported/);
    expect(await listActivities()).toHaveLength(2);
  });

  it('student import is idempotent and versions changed content', async () => {
    const a = testActivity();
    const text = enc(JSON.stringify(await createPackage([a])));
    const [first] = await importForStudent(text);
    const [again] = await importForStudent(text);
    expect(again?.version).toBe(first?.version);
    const changed = enc(JSON.stringify(await createPackage([{ ...a, title: 'Revised' }])));
    const [second] = await importForStudent(changed);
    expect(second?.version).toBe(2);
    expect(await listActivities()).toEqual([]); // not added to the teacher library
  });

  it('student import rejects activities that are not ready', async () => {
    const a = { ...testActivity(), items: [] };
    await expect(importForStudent(enc(JSON.stringify(await createPackage([a]))))).rejects.toThrow();
  });

  it('publishActivity output matches what storage expects', async () => {
    const { version } = await publishActivity(testActivity());
    await putVersion(version);
    expect(await getVersion(version.activityId, 1)).toEqual(version);
  });
});
