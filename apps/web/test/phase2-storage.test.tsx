import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openDB } from 'idb';
import { checkMedia, createActivity, CURRENT_SCHEMA_VERSION, readAnyPackage, type Activity } from '@ilp/core';
import { closeDb, dbName, getActivity, getAsset, listBank, putActivity, putAsset } from '../src/storage/db';
import { exportPackage, importAsDrafts, importForStudent } from '../src/storage/library';
import { Editor } from '../src/teacher/Editor';
import { ConfirmProvider } from '../src/ui/dialog';
import { sampleActivity } from '../src/teacher/sample';
import { PNG } from './helpers';

async function activityWithImage(): Promise<{ a: Activity; assetId: string }> {
  const { id, mime } = await checkMedia(PNG);
  await putAsset({ id, mime, bytes: PNG, name: 'x.png', addedAt: new Date().toISOString() });
  const a = createActivity('With image');
  a.items = [{ type: 'matching', id: 'itm_m', audioCue: null, prompt: '', distractors: [], points: 1, scoring: 'per-pair', feedback: {}, skills: [], pairs: [
    { id: 'p1', left: '', leftImage: { assetId: id, alt: 'a red apple', decorative: false }, right: 'apple' },
    { id: 'p2', left: 'banana', leftImage: null, right: 'yellow fruit' },
  ] }];
  return { a, assetId: id };
}

describe('zip export / import with media', () => {
  it('round-trips images into another device (simulated by clearing storage)', async () => {
    const { a, assetId } = await activityWithImage();
    await putActivity(a);
    const zip = await exportPackage([a]);
    const { indexedDB } = globalThis;
    await closeDb();
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(dbName()); r.onsuccess = () => res(); });
    expect(await getAsset(assetId)).toBeUndefined();
    const [imported] = await importAsDrafts(zip, () => 'act_copy');
    expect(imported?.items[0]?.type).toBe('matching');
    expect(Array.from((await getAsset(assetId))!.bytes)).toEqual(Array.from(PNG));
    const [v] = await importForStudent(zip);
    expect(v?.version).toBe(1);
  });
  it('export fails clearly when an image is missing on this device', async () => {
    const { a } = await activityWithImage();
    const broken = { ...a, items: a.items.map((i) => (i.type === 'matching' ? { ...i, pairs: i.pairs.map((p) => (p.leftImage ? { ...p, leftImage: { ...p.leftImage, assetId: 'ast_0000000000000000000000000000000000000000' } } : p)) } : i)) };
    await expect(exportPackage([broken])).rejects.toThrow(/missing/);
  });
  it('exported zip is readable by the core package reader', async () => {
    const zip = await exportPackage([sampleActivity()]);
    expect((await readAnyPackage(zip)).activities[0]?.title).toMatch(/Past simple/);
  });
});

describe('IndexedDB upgrade from the Phase 1 database', () => {
  it('adds new stores and upgrades stored activities to the current schema', async () => {
    await closeDb();
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(dbName()); r.onsuccess = () => res(); });
    const v1 = { ...sampleActivity(), schemaVersion: 1 } as Record<string, unknown>;
    delete v1.pools;
    const old = await openDB(dbName(), 1, {
      upgrade(d) {
        d.createObjectStore('activities', { keyPath: 'id' });
        d.createObjectStore('versions', { keyPath: ['activityId', 'version'] }).createIndex('byActivity', 'activityId');
        const at = d.createObjectStore('attempts', { keyPath: 'id' });
        at.createIndex('byActivity', 'activityId');
        at.createIndex('byActivityVersion', ['activityId', 'version']);
        d.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    await old.put('activities', v1);
    old.close();
    const upgraded = await getActivity(v1.id as string);
    expect(upgraded?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(upgraded?.pools).toEqual([]);
    expect(await listBank()).toEqual([]); // new store exists
  });
});

describe('question bank', () => {
  it('saves a question from one activity and inserts a copy into another', async () => {
    const source = sampleActivity();
    const target = createActivity('Target');
    await putActivity(source);
    await putActivity(target);
    const user = userEvent.setup();
    const first = render(<ConfirmProvider><Editor id={source.id} /></ConfirmProvider>);
    await user.click(await screen.findByRole('button', { name: /Q2 · Multiple choice/ }));
    await user.click(screen.getByRole('button', { name: 'Save to question bank' }));
    expect(await screen.findByText(/Saved a copy/)).toBeInTheDocument();
    first.unmount();
    render(<ConfirmProvider><Editor id={target.id} /></ConfirmProvider>);
    await screen.findByRole('heading', { name: 'Details' });
    await user.click(screen.getByRole('button', { name: /From question bank/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: /Insert 1 question/ }));
    await screen.findByText(/Inserted 1 question/);
    await new Promise((r) => setTimeout(r, 700)); // autosave
    const saved = await getActivity(target.id);
    expect(saved?.items).toHaveLength(1);
    expect(saved?.items[0]?.id).not.toBe(source.items[2]?.id);
  });
});
