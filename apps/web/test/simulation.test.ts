/**
 * Simulation mode. The flag is set BEFORE the app modules load, as after the
 * reload that turning it on performs. Runs the generated service module
 * (same code as Code.gs) against the labelled Google emulator in this test
 * browser (jsdom + fake IndexedDB). No network access is allowed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createActivity, type Item } from '@ilp/core';
import { brokerBuildScript, createBroker } from '../../../services/submission-broker/test/fakeAppsScript';

localStorage.setItem('ilp.mode', 'simulation');
beforeAll(() => {
  execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore' });
});
afterEach(() => vi.restoreAllMocks());

const activity = () => {
  const a = createActivity('Fictional grammar check');
  a.items = [{ type: 'multiple-choice', id: 'itm_q1', audioCue: null, prompt: 'She ___ to school.', mode: 'single', choices: [{ id: 'itm_q1a', text: 'goes', correct: true }, { id: 'itm_q1b', text: 'go', correct: false }], shuffleChoices: false, points: 1, scoring: 'all-or-nothing', feedback: {}, skills: [] } as Item];
  return a;
};

describe('Simulation mode', () => {
  it('runs the whole teacher → student → teacher flow with fictional people, offline', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { createSimTeacher, addSimStudents } = await import('../src/sim/simService');
    const { actAs } = await import('../src/sim/acting');
    const { broker } = await import('../src/google/broker');
    const t = await createSimTeacher('Ms Example');
    expect(t.brokerId).toMatch(/^SIMULATED/);
    const [ada] = await addSimStudents(2);
    await actAs(t);
    const cls = await broker.createClass(t.brokerId!, 'Sample class', '');
    await broker.putRoster(t.brokerId!, cls.classId, [{ studentNumber: 'S01', name: ada!.name, email: ada!.email, status: 'active' }]);
    const asg = await broker.createAssignment(t.brokerId!, { classId: cls.classId, activity: activity(), version: 1, contentHash: 'x' });
    await actAs(ada!);
    const view = await broker.studentAssignment(t.brokerId!, asg.id);
    expect(view.studentNumber).toBe('S01');
    const receipt = await broker.submit(t.brokerId!, { assignmentId: asg.id, attemptId: 'att_sim1', attemptNumber: 1, startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), presentedItemIds: null, responses: { itm_q1: { choiceIds: ['itm_q1a'] } }, checks: {}, hintsUsed: {}, clientScore: 1, recordings: [] });
    expect(receipt).toMatchObject({ studentNumber: 'S01', score: 1, maxScore: 1 });
    await actAs(t);
    expect(await broker.listSubmissions(t.brokerId!, asg.id)).toHaveLength(1);
    expect((await broker.storageInfo(t.brokerId!)).permission).toBe('drive.file');
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing left this browser
  });

  it('keeps its data in separate databases', async () => {
    const { dbName, db } = await import('../src/storage/db');
    expect(dbName()).toBe('ilp-simulation');
    expect((await db()).name).toBe('ilp-simulation');
  });

  it('never contacts a real submission service, and loads no Google scripts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { broker } = await import('../src/google/broker');
    await expect(broker.whoami('AKfycbREAL_service_id_0123456789')).rejects.toThrow(/never contacts real submission services/);
    const { loadGis, driveAccessToken } = await import('../src/google/gis');
    await expect(loadGis()).rejects.toThrow(/not used in Simulation mode/);
    await expect(driveAccessToken()).rejects.toThrow(/not used in Simulation mode/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
  });

  it('a simulated sign-in is rejected by a real service before it even asks Google', async () => {
    const { createSimTeacher, simToken } = await import('../src/sim/simService');
    const t = await createSimTeacher('Mr Example');
    const token = await simToken(t, t.brokerId!);
    const { GOOGLE_CLIENT_ID } = await import('../src/config');
    const real = createBroker({ teacher: 'teacher@example.com', clientId: GOOGLE_CLIENT_ID, brokerId: 'AKfycbREAL_service_id_0123456789' });
    const before = real.tokenFetches();
    expect(real.call('whoami', token, { connectCode: real.connectCode }).error).toBe('unauthenticated');
    expect(real.tokenFetches()).toBe(before);
  });
});
