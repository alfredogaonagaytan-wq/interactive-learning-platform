/**
 * Tests for the per-file (drive.file) storage design of service 0.6.0. They run
 * the real generated service against the LABELLED Google EMULATOR, which
 * enforces drive.file per app and per file and treats folder grants as
 * non-recursive. Whether real Google behaves the same is checked live with
 * checkPermissions() and docs/12 (section "Narrow permissions").
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createActivity, type Item } from '@ilp/core';
import { brokerBuildScript, brokerDist, createBroker, manifest } from './fakeAppsScript';
import { FOLDER, SCRIPT_APP, SCRIPT_TOKEN, WEB_APP } from '../emulator/googleEmulator';

const CLIENT = 'test-client.apps.googleusercontent.com';
const TEACHER = 'teacher@example.com';
const BROKER = 'AKfycbDRIVEFILE_teacher_service_0001';

beforeAll(() => {
  execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore' });
});

let b: ReturnType<typeof createBroker>;
let teacher: string;
let classId: string;
let asgId: string;
const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40, 2)]).toString('base64');

function activity() {
  const a = createActivity('Fictional listening quiz');
  a.items = [
    { type: 'multiple-choice', id: 'itm_q1', audioCue: null, prompt: 'Q1', mode: 'single', choices: [{ id: 'itm_q1a', text: 'A', correct: true }, { id: 'itm_q1b', text: 'B', correct: false }], shuffleChoices: false, points: 1, scoring: 'all-or-nothing', feedback: {}, skills: [] } as Item,
    { type: 'speaking', id: 'itm_sp', audioCue: null, targets: [{ id: 't1', text: 'Hello' }], submission: 'optional', skills: [] } as unknown as Item,
  ];
  return a;
}
const payload = (attemptId: string, extra: Record<string, unknown> = {}) => ({
  payload: { assignmentId: asgId, attemptId, attemptNumber: 1, startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), presentedItemIds: null, responses: { itm_q1: { choiceIds: ['itm_q1a'] } }, clientScore: null, ...extra },
});

/** A full workflow: class, roster, assignment with media, submission with a recording. */
function workflow() {
  b = createBroker({ teacher: TEACHER, clientId: CLIENT, brokerId: BROKER });
  teacher = b.signIn(TEACHER, 'sub-teacher');
  expect(b.connect(teacher).ok).toBe(true);
  classId = b.call('classes.create', teacher, { name: 'Test 7A' }).result.classId;
  b.call('roster.put', teacher, { classId, rows: [{ studentNumber: 'S01', name: 'Fictional Ada', email: 'student1@example.com' }] });
  asgId = b.call('assignments.create', teacher, { classId, activity: activity(), version: 1, contentHash: 'x', assets: [{ id: 'ast_' + 'b'.repeat(40), mime: 'audio/webm', base64: webm() }] }).result.id;
  const s1 = b.signIn('student1@example.com', 'sub-1');
  expect(b.call('student.submit', s1, payload('att_wf', { recordings: [{ id: 'rec_1', itemId: 'itm_sp', targetId: 't1', mime: 'audio/webm', base64: webm() }] })).ok).toBe(true);
  return s1;
}

describe('narrow permissions: what the service is allowed to ask for', () => {
  it('the manifest requests only per-file Drive access and outbound requests', () => {
    expect(manifest().oauthScopes.sort()).toEqual(['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/script.external_request']);
  });

  it('the generated code uses no Apps Script service that needs full Drive, Sheets or email access', () => {
    const code = readFileSync(resolve(brokerDist(), 'Code.gs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // code, not comments
    expect(code).not.toMatch(/\b(DriveApp|SpreadsheetApp|DocumentApp|Session\.get|GmailApp|MailApp)\b/);
    expect(readFileSync(resolve(brokerDist(), 'GradingCore.gs'), 'utf8')).not.toMatch(/\b(DriveApp|SpreadsheetApp|UrlFetchApp)\b/);
  });

  it('never calls the sharing (permissions) API: nothing is ever shared or made public', () => {
    workflow();
    b.call('storage.info', teacher);
    expect(b.fetchedUrls.some((u) => /\/permissions|\/copy|\/export/.test(u))).toBe(false);
  });
});

describe('the service works using only files it created', () => {
  beforeEach(() => void workflow());

  it('every file it uses was created by it, inside its own folder, and no request was refused', () => {
    const root = b.props.get('ROOT_FOLDER_ID')!;
    const mine = b.files().filter((f) => f.createdBy === SCRIPT_APP);
    expect(mine.length).toBeGreaterThan(10);
    expect(mine.every((f) => f.id === root || f.path.startsWith('My Drive/Interactive Learning Platform/'))).toBe(true);
    expect(b.emu.denied).toEqual([]);
    expect(mine.map((f) => f.appProperties.ilp)).toEqual(expect.arrayContaining(['root', 'sheet', 'class', 'media', 'assignment-file', 'submission', 'recording']));
  });

  it('can create, read, update, list and delete its own files (checkPermissions)', () => {
    (b.ctx.checkPermissions as () => void)();
    const report = b.logs.filter((l) => /^(OK|FAIL)/.test(l));
    expect(report.filter((l) => l.startsWith('OK'))).toHaveLength(5);
    expect(report.some((l) => l.startsWith('FAIL'))).toBe(false);
    expect(b.files().some((f) => f.name === 'permission-check.txt')).toBe(false); // cleaned up
  });

  it('cannot see files it did not create — by id, by listing, even inside its own folder', () => {
    const personal = b.emu.userCreate('My tax return.pdf', { content: 'PRIVATE' });
    // The teacher drops a personal file INTO the app's folder by hand: still invisible to the service.
    const dropped = b.emu.userCreate('Personal notes.txt', { parents: [b.props.get('ROOT_FOLDER_ID')!], content: 'PRIVATE' });
    for (const id of [personal, dropped]) {
      expect(b.emu.fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${SCRIPT_TOKEN}` }, muteHttpExceptions: true }).getResponseCode()).toBe(404);
    }
    const info = b.call('storage.info', teacher).result;
    expect(info.byKind.other).toBeUndefined();
    expect(JSON.stringify([info, b.call('storage.export', teacher).result])).not.toMatch(/tax return|Personal notes|PRIVATE/);
  });

  it('control: with the broad drive scope the same unrelated file WOULD be readable (the emulator enforces the difference)', () => {
    const personal = b.emu.userCreate('My tax return.pdf', { content: 'PRIVATE' });
    b.emu.scopes = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/script.external_request'];
    expect(b.emu.fetch(`https://www.googleapis.com/drive/v3/files/${personal}?alt=media`, { headers: { Authorization: `Bearer ${SCRIPT_TOKEN}` } }).getContentText()).toBe('PRIVATE');
  });

  it('keeps working after the teacher moves the storage folder elsewhere in their Drive', () => {
    const school = b.emu.userCreate('School 2026', { mimeType: FOLDER });
    b.emu.userMove(b.props.get('ROOT_FOLDER_ID')!, school);
    expect(b.call('classes.create', teacher, { name: 'Test 7B' }).ok).toBe(true);
    const s1 = b.signIn('student1@example.com', 'sub-1');
    expect(b.call('student.submit', s1, payload('att_moved')).ok).toBe(true);
    expect(b.files().find((f) => f.name === 'S01__att_moved.json')!.path).toMatch(/^My Drive\/School 2026\/Interactive Learning Platform\/Classes\//);
    expect(b.call('storage.info', teacher).result.folder.name).toBe('Interactive Learning Platform');
    expect(b.emu.denied).toEqual([]);
  });

  it('if the teacher trashes the storage folder, setup creates a new one (the old one stays in the trash, untouched)', () => {
    const oldRoot = b.props.get('ROOT_FOLDER_ID')!;
    b.emu.file(oldRoot)!.trashed = true;
    (b.ctx.setup as () => void)();
    expect(b.props.get('ROOT_FOLDER_ID')).not.toBe(oldRoot);
    expect(b.emu.file(oldRoot)).toBeDefined();
  });

  it('a deleted report is reported as missing, not as an error with internal details', () => {
    const row = b.call('submissions.list', teacher, { assignmentId: asgId }).result[0];
    b.emu.file(row.reportFileId)!.trashed = false;
    delete b.emu.state.files[row.reportFileId];
    expect(b.call('submissions.report', teacher, { assignmentId: asgId, attemptId: 'att_wf' })).toMatchObject({ ok: false, error: 'not-found' });
  });
});

describe('Google Picker grants are per app and not recursive (emulator model; verify live)', () => {
  beforeEach(() => void workflow());

  it('a folder picked in the WEB APP gives the teacher’s service no access at all (different Cloud project)', () => {
    const existing = b.emu.userCreate('Existing class folder', { mimeType: FOLDER });
    b.emu.pick(WEB_APP, existing);
    const r = b.emu.fetch('https://www.googleapis.com/drive/v3/files', { method: 'post', headers: { Authorization: `Bearer ${SCRIPT_TOKEN}` }, payload: JSON.stringify({ name: 'x', parents: [existing] }), muteHttpExceptions: true });
    expect(r.getResponseCode()).toBe(404);
  });

  it('picking a folder FOR the service grants that folder, not the files already inside it', () => {
    const existing = b.emu.userCreate('Existing materials', { mimeType: FOLDER });
    const inside = b.emu.userCreate('worksheet.pdf', { parents: [existing], content: 'old file' });
    b.emu.pick(SCRIPT_APP, existing);
    const auth = { headers: { Authorization: `Bearer ${SCRIPT_TOKEN}` }, muteHttpExceptions: true };
    expect(b.emu.fetch(`https://www.googleapis.com/drive/v3/files/${existing}`, auth).getResponseCode()).toBe(200);
    expect(b.emu.fetch(`https://www.googleapis.com/drive/v3/files/${inside}?alt=media`, auth).getResponseCode()).toBe(404);
    const listed = JSON.parse(b.emu.fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${existing}' in parents`)}`, auth).getContentText()).files;
    expect(listed).toEqual([]);
  });
});

describe('private roster and assessment data', () => {
  beforeEach(() => void workflow());

  it('students cannot use the storage actions and never receive Drive links or file ids', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    expect(b.call('storage.info', s1).error).toBe('forbidden');
    expect(b.call('storage.export', s1).error).toBe('forbidden');
    const seen = JSON.stringify([b.call('student.assignment', s1, { assignmentId: asgId }), b.call('student.receipts', s1, { assignmentId: asgId }), b.call('student.submit', s1, payload('att_wf')), b.call('student.asset', s1, { assignmentId: asgId, assetId: 'ast_' + 'b'.repeat(40) })]);
    expect(seen).not.toMatch(/drive\.google\.com|docs\.google\.com|1Emu|Fictional Ada|googleSub|sub-1/);
  });

  it('serves the assignment’s media to enrolled students from the file it stored', () => {
    const r = b.call('student.asset', b.signIn('student1@example.com', 'sub-1'), { assignmentId: asgId, assetId: 'ast_' + 'b'.repeat(40) });
    expect(r.result).toMatchObject({ mime: 'audio/webm', base64: webm() });
  });

  it('the teacher’s backup contains the sheet data; the storage summary counts only the service’s files', () => {
    const backup = b.call('storage.export', teacher).result;
    expect(backup).toMatchObject({ kind: 'ilp.serviceBackup', version: '0.6.0' });
    expect(backup.Roster[0]).toMatchObject({ studentNumber: 'S01', name: 'Fictional Ada' });
    expect(backup.Submissions).toHaveLength(1);
    const info = b.call('storage.info', teacher).result;
    expect(info).toMatchObject({ permission: 'drive.file', folder: { name: 'Interactive Learning Platform' } });
    expect(info.files).toBe(b.files().filter((f) => f.createdBy === SCRIPT_APP).length);
    expect(info.byKind.recording.files).toBe(1);
  });
});

describe('sheet writes (RAW)', () => {
  beforeEach(() => void workflow());

  it('control: if the service wrote USER_ENTERED, the emulator would record a formula (so the RAW test can fail)', () => {
    const sheet = b.props.get('SHEET_ID')!;
    b.emu.fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/Classes!A9?valueInputOption=USER_ENTERED`, { method: 'put', headers: { Authorization: `Bearer ${SCRIPT_TOKEN}` }, payload: JSON.stringify({ values: [['=IMPORTXML("https://evil.example","//a")']] }) });
    expect(b.emu.formulas).toHaveLength(1);
  });

  it('a due date typed into the sheet by hand (a real date value) is still enforced', () => {
    const strict = b.call('assignments.create', teacher, { classId, activity: activity(), version: 1, contentHash: 'x', allowLate: false }).result.id;
    const row = b.call('assignments.list', teacher, { classId }).result.findIndex((a: { assignmentId: string }) => a.assignmentId === strict);
    const sheet = b.props.get('SHEET_ID')!;
    // Column F (dueAt) of that row, typed as a date one day ago.
    b.emu.fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/Assignments!F${row + 2}?valueInputOption=USER_ENTERED`, { method: 'put', headers: { Authorization: `Bearer ${SCRIPT_TOKEN}` }, payload: JSON.stringify({ values: [[new Date(Date.now() - 864e5).toISOString().slice(0, 10)]] }) });
    expect(b.call('student.submit', b.signIn('student1@example.com', 'sub-1'), { payload: { ...payload('att_hand').payload, assignmentId: strict } }).error).toBe('past-due');
  });
});

describe('connection code (replaces the owner-email lookup and the userinfo.email scope)', () => {
  it('is printed once, stored only as a hash, and works only once', () => {
    const fresh = createBroker({ teacher: TEACHER, clientId: CLIENT, brokerId: BROKER });
    expect(fresh.connectCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(Object.values(fresh.emu.state.props).some((v) => v.includes(fresh.connectCode.replace(/-/g, '')) || v.includes(fresh.connectCode))).toBe(false);
    expect(fresh.connect(fresh.signIn(TEACHER, 'sub-teacher')).result.role).toBe('teacher');
    // A second account with the same code later gets nothing: the service is already connected.
    expect(fresh.connect(fresh.signIn('student1@example.com', 'sub-1')).result.role).toBe('student');
    expect(fresh.props.get('CONNECT_HASH')).toBeUndefined();
  });

  it('locks after 10 wrong codes', () => {
    const fresh = createBroker({ teacher: TEACHER, clientId: CLIENT, brokerId: BROKER });
    const t = fresh.signIn(TEACHER, 'sub-teacher');
    for (let i = 0; i < 10; i++) expect(fresh.connect(t, `WRNG-CODE-${String(i).padStart(4, 'X')}-AAAA`).error).toBe('forbidden');
    expect(fresh.connect(t).message).toMatch(/Too many wrong connection codes/);
  });

  it('resetConnection removes the teacher role until the new code is used', () => {
    workflow();
    (b.ctx.resetConnection as () => void)();
    const newCode = /New connection code: ([A-Z0-9-]{19})/.exec(b.logs.join('\n'))![1]!;
    expect(b.call('roster.get', teacher, { classId }).error).toBe('not-connected');
    expect(b.connect(teacher, newCode).result.role).toBe('teacher');
    expect(b.call('roster.get', teacher, { classId }).result).toHaveLength(1); // data kept
  });
});
