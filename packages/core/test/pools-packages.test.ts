import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  activityAssets, assetIdFor, checkMedia, createActivity, createZipPackage, gradeActivity, MediaError, migrateActivityJson, parseActivity, readAnyPackage,
  selectItemIds, sniffMediaType, validateActivity, createPackage, type Activity,
} from '../src';
import { mc, sampleActivity, tf } from './fixtures';

// A real 1×1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function pooled(): Activity {
  const a = createActivity('Pools');
  a.items = [
    { type: 'content', id: 'itm_intro', title: 'Intro', body: 'x' },
    mc({ id: 'q1' }), mc({ id: 'q2' }), mc({ id: 'q3' }), mc({ id: 'q4' }),
    tf({ id: 'fixed' }),
  ];
  a.pools = [{ id: 'pol_1', name: 'Mammals', draw: 2, itemIds: ['q1', 'q2', 'q3', 'q4'] }];
  return a;
}

describe('question pools', () => {
  it('draws the configured number, deterministically per seed, keeping non-pool items', () => {
    const a = pooled();
    const s1 = selectItemIds(a, 'att_a');
    expect(s1).toEqual(selectItemIds(a, 'att_a'));
    expect(s1.filter((id) => id.startsWith('q'))).toHaveLength(2);
    expect(s1[0]).toBe('itm_intro');
    expect(s1).toContain('fixed');
    const variety = new Set(Array.from({ length: 30 }, (_, i) => selectItemIds(a, `att_${i}`).join()));
    expect(variety.size).toBeGreaterThan(1);
  });
  it('grades only presented items', () => {
    const a = pooled();
    const ids = selectItemIds(a, 'att_x');
    const r = gradeActivity(a, {}, ids);
    expect(r.maxScore).toBe(2 * 2 + 1);
    expect(r.items.map((i) => i.itemId)).toEqual(ids);
  });
  it('validates pools', () => {
    const a = pooled();
    a.pools[0]!.draw = 9;
    expect(validateActivity(a).map((i) => i.message).join()).toMatch(/draws 9 but has only 4/);
  });
  it('shuffles questions but never moves text blocks', () => {
    const a = pooled();
    a.pools = [];
    a.settings.shuffleItems = true;
    for (let i = 0; i < 10; i++) expect(selectItemIds(a, `s${i}`)[0]).toBe('itm_intro');
  });
});

describe('schema migration v1 -> v2', () => {
  it('upgrades a Phase 1 activity', () => {
    const v1 = { ...sampleActivity(), schemaVersion: 1 } as Record<string, unknown>;
    delete v1.pools;
    expect(migrateActivityJson(v1)).toMatchObject({ schemaVersion: 3, pools: [] });
    expect(parseActivity(v1).pools).toEqual([]);
  });
});

describe('media', () => {
  it('identifies files by signature, not name', async () => {
    expect(sniffMediaType(PNG)).toBe('image/png');
    const svg = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(checkMedia(svg)).rejects.toBeInstanceOf(MediaError);
    expect((await checkMedia(PNG)).id).toMatch(/^ast_[0-9a-f]{40}$/);
  });
});

describe('zip packages', () => {
  async function withImage() {
    const a = createActivity('Labelled cell');
    const id = await assetIdFor(PNG);
    a.items = [{
      type: 'hotspot', id: 'itm_h', audioCue: null, prompt: 'Click the nucleus', image: { assetId: id, alt: 'Cell', decorative: false }, allowListAlternative: true, points: 1, feedback: {}, skills: [],
      hotspots: [{ id: 'h1', label: 'Nucleus', shape: 'rect', x: 10, y: 10, w: 10, h: 10, correct: true }],
    }];
    return { a, id };
  }
  it('round-trips activities with media', async () => {
    const { a, id } = await withImage();
    expect(activityAssets(a)).toEqual([id]);
    const zip = await createZipPackage([a], async (x) => (x === id ? { mime: 'image/png', bytes: PNG } : undefined));
    const r = await readAnyPackage(zip);
    expect(r.activities[0]?.title).toBe('Labelled cell');
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0]?.bytes).toEqual(PNG);
  });
  it('refuses to export when an image is missing', async () => {
    const { a } = await withImage();
    await expect(createZipPackage([a], async () => undefined)).rejects.toThrow(/missing/);
  });
  it('detects a swapped media file', async () => {
    const { a, id } = await withImage();
    const zip = await createZipPackage([a], async () => ({ mime: 'image/png', bytes: PNG }));
    const { unzipSync } = await import('fflate');
    const files = unzipSync(zip);
    const path = Object.keys(files).find((k) => k.startsWith('media/'))!;
    const tampered = PNG.slice();
    tampered[tampered.length - 5] = tampered[tampered.length - 5]! ^ 0xff;
    files[path] = tampered;
    await expect(readAnyPackage(zipSync(files))).rejects.toThrow(/checksum/);
    expect(id).toBeTruthy();
  });
  it('rejects zips without a manifest and still reads legacy JSON packages', async () => {
    await expect(readAnyPackage(zipSync({ 'evil.html': strToU8('<script>') }))).rejects.toThrow(/package.json missing/);
    const json = strToU8(JSON.stringify(await createPackage([sampleActivity()])));
    expect((await readAnyPackage(json)).activities).toHaveLength(1);
  });
});
