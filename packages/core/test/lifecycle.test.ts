import { describe, expect, it } from 'vitest';
import {
  ActivitySchema, PackageError, PublishError, SchemaVersionError, buildReport, canRevealAnswers, canShowResults, canCheckItem,
  createActivity, createPackage, duplicateActivity, hasUnpublishedChanges, migrateActivityJson, publishActivity, readPackage, reportToCsv,
  DEFAULT_SETTINGS, type Attempt,
} from '../src';
import { sampleActivity } from './fixtures';

describe('publishing and versions', () => {
  it('refuses to publish an incomplete activity', async () => {
    await expect(publishActivity(createActivity(''))).rejects.toBeInstanceOf(PublishError);
  });
  it('creates immutable, numbered versions; later edits do not alter earlier snapshots', async () => {
    const a = sampleActivity();
    const { version: v1, draft } = await publishActivity(a);
    expect(v1.version).toBe(1);
    expect(hasUnpublishedChanges(draft)).toBe(false);
    const edited = { ...draft, title: 'Changed', revision: draft.revision + 1 };
    expect(hasUnpublishedChanges(edited)).toBe(true);
    const { version: v2 } = await publishActivity(edited);
    expect(v2.version).toBe(2);
    expect(v1.activity.title).toBe('Fictional Grade 7 check-in');
    expect(v2.contentHash).not.toBe(v1.contentHash);
  });
  it('content hash ignores timestamps (same content => same hash)', async () => {
    const a = sampleActivity();
    const { version: x } = await publishActivity(a);
    const { version: y } = await publishActivity({ ...a, updatedAt: '2030-01-01T00:00:00.000Z' });
    expect(x.contentHash).toBe(y.contentHash);
  });
});

describe('duplicate', () => {
  it('assigns new ids everywhere', () => {
    const a = sampleActivity();
    const d = duplicateActivity(a);
    expect(d.id).not.toBe(a.id);
    expect(d.items.map((i) => i.id)).not.toEqual(a.items.map((i) => i.id));
    expect(ActivitySchema.parse(d).title).toMatch(/copy/);
  });
});

describe('migrations', () => {
  it('rejects documents from a newer schema', () => {
    expect(() => migrateActivityJson({ schemaVersion: 99 })).toThrow(SchemaVersionError);
  });
  it('applies registered steps in order', () => {
    const steps = { 1: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 2, a: 1 }), 2: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 3, b: (r.a as number) + 1 }) };
    expect(migrateActivityJson({ schemaVersion: 1 }, steps, 3)).toEqual({ schemaVersion: 3, a: 1, b: 2 });
  });
});

describe('packages', () => {
  it('round-trips activities', async () => {
    const pkg = await createPackage([sampleActivity()]);
    const { activities } = await readPackage(JSON.stringify(pkg));
    expect(activities[0]?.items).toHaveLength(4);
  });
  it('detects tampering or corruption', async () => {
    const pkg = await createPackage([sampleActivity()]);
    const text = JSON.stringify(pkg).replace('Whale', 'Tuna');
    await expect(readPackage(text)).rejects.toThrow(/integrity/);
  });
  it('rejects non-packages with a friendly message', async () => {
    await expect(readPackage('not json')).rejects.toBeInstanceOf(PackageError);
    await expect(readPackage('{"hello":1}')).rejects.toThrow(/not an activity package/);
  });
  it('rejects invalid activity content even with a valid digest', async () => {
    const bad = { ...sampleActivity(), items: [{ type: 'nope', id: 'x' }] } as never;
    const pkg = await createPackage([bad]);
    await expect(readPackage(JSON.stringify(pkg))).rejects.toThrow(/Activity 1 is invalid/);
  });
});

describe('visibility policy', () => {
  const s = DEFAULT_SETTINGS;
  it('immediate checks respect limit', () => {
    expect(canCheckItem({ ...s, checksPerItem: 2 }, 1)).toBe(true);
    expect(canCheckItem({ ...s, checksPerItem: 2 }, 2)).toBe(false);
    expect(canCheckItem({ ...s, feedbackTiming: 'on-submit' }, 0)).toBe(false);
  });
  it('after-release hides results until release', () => {
    const st = { ...s, feedbackTiming: 'after-release' as const };
    expect(canShowResults(st, { submitted: true, attemptsUsed: 1, released: false })).toBe(false);
    expect(canShowResults(st, { submitted: true, attemptsUsed: 1, released: true })).toBe(true);
  });
  it('after-final-attempt reveals only when attempts are exhausted', () => {
    const st = { ...s, maxAttempts: 2, answerReveal: 'after-final-attempt' as const };
    expect(canRevealAnswers(st, { submitted: true, attemptsUsed: 1, released: false })).toBe(false);
    expect(canRevealAnswers(st, { submitted: true, attemptsUsed: 2, released: false })).toBe(true);
  });
});

describe('reports', () => {
  const a = sampleActivity();
  const attempt: Attempt = {
    kind: 'ilp.attempt', schemaVersion: 1, id: 'att_1', activityId: a.id, version: 1, contentHash: 'sha256:x', mode: 'student', assignmentId: null,
    attemptNumber: 1, status: 'submitted', presentedItemIds: null, responses: { itm_mc: { choiceIds: ['c1'] }, itm_tf: { value: true }, itm_fb: { values: { blk_0: '=HYPERLINK("x")', blk_1: 'ate' } } },
    checks: { itm_mc: 2 }, hintsUsed: {}, startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:10:00.000Z', sync: 'local-only',
  };
  it('summarises totals, skills and next steps', () => {
    const r = buildReport(a, attempt, { revealAnswers: false, studentNumber: 'S-07' });
    expect(r.totals).toMatchObject({ questions: 3, correct: 1, partial: 1, incorrect: 1, score: 2, maxScore: 5 });
    expect(r.items[0]?.correctAnswers).toBeUndefined();
    expect(r.items[0]?.checksUsed).toBe(2);
    expect(r.needsPractice).toContain('classification');
    expect(r.proficient).toContain('states of matter');
    expect(r.integrity.verified).toBe(false);
  });
  it('discloses answers only when permitted', () => {
    expect(buildReport(a, attempt, { revealAnswers: true }).items[0]?.correctAnswers).toEqual(['Whale', 'Bat']);
  });
  it('CSV export neutralises spreadsheet formulas', () => {
    const csv = reportToCsv(buildReport(a, attempt, { revealAnswers: false }));
    expect(csv).toContain(`"'=HYPERLINK(""x""); ate"`);
  });
});
