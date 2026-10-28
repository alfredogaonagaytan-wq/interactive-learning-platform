import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createActivity, gradeActivity, ReceiptFields, selectItemIds, type Activity, type Item } from '@ilp/core';
import { brokerBuildScript, createBroker } from './fakeAppsScript';

const CLIENT = 'test-client.apps.googleusercontent.com';
const TEACHER = 'teacher@example.com';

beforeAll(() => {
  execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore' });
});

function activity(): Activity {
  const a = createActivity('Fictional quiz');
  const mc = (id: string, correct: string): Item => ({
    type: 'multiple-choice', id, audioCue: null, prompt: `Q ${id}`, mode: 'single', choices: [{ id: `${id}a`, text: 'A', correct: correct === 'a', feedback: 'fb' }, { id: `${id}b`, text: 'B', correct: correct === 'b' }],
    shuffleChoices: false, points: 1, scoring: 'all-or-nothing', feedback: { explanation: 'secret' }, skills: [],
  });
  a.items = [mc('itm_q1', 'a'), mc('itm_q2', 'b'), { type: 'fill-blanks', id: 'itm_fb', audioCue: null, prompt: '', segments: [{ kind: 'text', text: 'I ' }, { kind: 'blank', id: 'blk_1', answers: ['went'] }], match: { caseSensitive: false, punctuationSensitive: false, accentSensitive: true, equivalences: [] }, points: 1, scoring: 'per-blank', feedback: {}, skills: [] }];
  return a;
}

let b: ReturnType<typeof createBroker>;
let teacher: string;
let classId: string;

async function setupClass() {
  b = createBroker({ teacher: TEACHER, clientId: CLIENT, brokerId: 'AKfycbTEST_broker_0123456789' });
  teacher = b.signIn(TEACHER, 'sub-teacher');
  expect(b.connect(teacher).ok).toBe(true); // "Connect" with the code from setup(): records this service's id
  classId = b.call('classes.create', teacher, { name: 'Grade 7 Science', section: 'A' }).result.classId;
  const r = b.call('roster.put', teacher, { classId, rows: [
    { studentNumber: 'S01', name: 'Test Student One', email: 'student1@example.com' },
    { studentNumber: 'S02', email: 'student2@example.com' },
    { studentNumber: 'S03', email: 'gone@example.com', status: 'withdrawn' },
  ] });
  expect(r.ok).toBe(true);
}

const assign = (extra: Record<string, unknown> = {}) => b.call('assignments.create', teacher, { classId, activity: activity(), version: 1, contentHash: 'sha256:x', ...extra });

describe('identity', () => {
  beforeEach(setupClass);
  it('recognises the teacher (script owner) and students', () => {
    expect(b.call('whoami', teacher).result.role).toBe('teacher');
    expect(b.call('whoami', b.signIn('student1@example.com', 'sub-1')).result.role).toBe('student');
  });
  it('rejects missing, unknown, wrong-audience, expired and unverified tokens', () => {
    expect(b.call('whoami', '').error).toBe('unauthenticated');
    expect(b.call('whoami', 'forged').error).toBe('unauthenticated');
    expect(b.call('whoami', b.signIn('x@example.com', 's', { aud: 'other-app' })).error).toBe('unauthenticated');
    expect(b.call('whoami', b.signIn('x@example.com', 's', { exp: 1 })).error).toBe('unauthenticated');
    expect(b.call('whoami', b.signIn('x@example.com', 's', { email_verified: 'false' })).error).toBe('unauthenticated');
  });
  it('can restrict to a school domain', () => {
    b.props.set('ALLOWED_DOMAIN', 'school.example');
    expect(b.call('whoami', b.signIn('student1@example.com', 'sub-1')).error).toBe('forbidden');
    expect(b.call('whoami', b.signIn('s@school.example', 'sub-9', { hd: 'school.example' })).ok).toBe(true);
  });
  it('students cannot use teacher actions', () => {
    const st = b.signIn('student1@example.com', 'sub-1');
    for (const action of ['classes.list', 'roster.get', 'assignments.create', 'submissions.list']) expect(b.call(action, st, { classId }).error).toBe('forbidden');
  });
  it('caches token verification', () => {
    const before = b.tokenFetches();
    b.call('whoami', teacher);
    b.call('whoami', teacher);
    expect(b.tokenFetches() - before).toBe(0); // verified once during setup calls
  });
});

describe('roster', () => {
  beforeEach(setupClass);
  it('rejects duplicate numbers and invalid emails, keeps names teacher-only', () => {
    expect(b.call('roster.put', teacher, { classId, rows: [{ studentNumber: 'S1', email: 'a@x.com' }, { studentNumber: 's1', email: 'b@x.com' }] }).error).toBe('bad-request');
    expect(b.call('roster.put', teacher, { classId, rows: [{ studentNumber: 'S1', email: 'not-an-email' }] }).error).toBe('bad-request');
    expect(b.call('roster.get', teacher, { classId }).result.map((r: { studentNumber: string }) => r.studentNumber)).toEqual(['S01', 'S02', 'S03']);
  });
  it('a client cannot set the Google account binding', () => {
    b.call('roster.put', teacher, { classId, rows: [{ studentNumber: 'S01', email: 'student1@example.com', googleSub: 'attacker' }] });
    const rows = b.emu.files().find((f) => f.sheets)!.sheets!.find((s) => s.title === 'Roster')!.rows;
    expect(rows.flat()).not.toContain('attacker');
  });
});

describe('assignments and student access', () => {
  beforeEach(setupClass);
  it('enrolled students get the activity; first sign-in binds their Google account', () => {
    const asg = assign().result;
    const r = b.call('student.assignment', b.signIn('student1@example.com', 'sub-1'), { assignmentId: asg.id });
    expect(r.ok).toBe(true);
    expect(r.result.studentNumber).toBe('S01');
    expect(r.result.activity.items).toHaveLength(3);
  });
  it('refuses non-enrolled and withdrawn students, and a second account claiming a bound number', () => {
    const asg = assign().result;
    expect(b.call('student.assignment', b.signIn('stranger@example.com', 'sub-x'), { assignmentId: asg.id }).message).toMatch(/not on this class roster/);
    expect(b.call('student.assignment', b.signIn('gone@example.com', 'sub-g'), { assignmentId: asg.id }).message).toMatch(/no longer enrolled/);
    b.call('student.assignment', b.signIn('student1@example.com', 'sub-1'), { assignmentId: asg.id });
    // Same email, different Google account (e.g. recreated account) cannot take over S01
    expect(b.call('student.assignment', b.signIn('student1@example.com', 'sub-evil'), { assignmentId: asg.id }).message).toMatch(/different Google account/);
  });
  it('students in one class cannot open another class’s assignment', () => {
    const asgA = assign().result;
    const other = b.call('classes.create', teacher, { name: 'Grade 8' }).result.classId;
    b.call('roster.put', teacher, { classId: other, rows: [{ studentNumber: 'T01', email: 'eighth@example.com' }] });
    expect(b.call('student.assignment', b.signIn('eighth@example.com', 'sub-8'), { assignmentId: asgA.id }).error).toBe('forbidden');
  });
  it('hidden grading removes answer keys and feedback from the student copy', () => {
    const asg = assign({ grading: 'hidden' }).result;
    const act = b.call('student.assignment', b.signIn('student1@example.com', 'sub-1'), { assignmentId: asg.id }).result.activity as Activity;
    const json = JSON.stringify(act);
    expect(json).not.toMatch(/"correct":true/);
    expect(json).not.toMatch(/secret|"went"/);
    expect(act.settings.feedbackTiming).toBe('after-release');
  });
  it('serves media only to enrolled students', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
    const id = 'ast_' + 'a'.repeat(40);
    const asg = assign({ assets: [{ id, mime: 'image/png', base64: png.toString('base64') }] }).result;
    expect(b.call('student.asset', b.signIn('stranger@example.com', 'sub-x'), { assignmentId: asg.id, assetId: id }).error).toBe('forbidden');
    const r = b.call('student.asset', b.signIn('student1@example.com', 'sub-1'), { assignmentId: asg.id, assetId: id });
    expect(Buffer.from(r.result.base64, 'base64').equals(png)).toBe(true);
  });
});

describe('submissions', () => {
  beforeEach(setupClass);
  const payload = (assignmentId: string, attemptId: string, responses: Record<string, unknown>, clientScore: number | null = null, extra = {}) => ({
    payload: { assignmentId, attemptId, attemptNumber: 1, startedAt: new Date().toISOString(), submittedAt: new Date().toISOString(), presentedItemIds: null, responses, clientScore, ...extra },
  });
  const right = { itm_q1: { choiceIds: ['itm_q1a'] }, itm_q2: { choiceIds: ['itm_q2a'] }, itm_fb: { values: { blk_1: 'went' } } };

  it('re-grades on the server, stores a teacher-owned report, signs the receipt, and flags a tampered client score', () => {
    const asg = assign().result;
    const st = b.signIn('student1@example.com', 'sub-1');
    const r = b.call('student.submit', st, payload(asg.id, 'att_one', right, 3));
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ studentNumber: 'S01', score: 2, maxScore: 3, duplicate: false, late: false });
    const fields = ReceiptFields.map((k) => `${k}=${r.result[k] ?? ''}`).join('&');
    expect(r.result.signature).toBe(createHmac('sha256', b.props.get('HMAC_SECRET')!).update(fields).digest('hex'));
    const report = b.files().find((f) => f.name === 'S01__att_one.json')!;
    expect(report.path).toMatch(/^My Drive\/Interactive Learning Platform\/Classes\/Grade 7 Science A \(cls_[a-z0-9]+\)\/Student submissions\/Fictional quiz \(asg_[a-z0-9]+\)\/S01__att_one\.json$/);
    const doc = JSON.parse(report.text());
    expect(doc.report.integrity.verified).toBe(true);
    expect(doc.report.studentNumber).toBe('S01');
    expect(JSON.stringify(doc)).not.toMatch(/Test Student One|student1@example\.com/); // no names or emails in reports
    const row = b.call('submissions.list', teacher, { assignmentId: asg.id }).result[0];
    expect(row.scoreMismatch).toBe(true);
  });

  it('is idempotent: resubmitting the same attempt returns the original receipt', () => {
    const asg = assign().result;
    const st = b.signIn('student1@example.com', 'sub-1');
    const first = b.call('student.submit', st, payload(asg.id, 'att_one', right)).result;
    const again = b.call('student.submit', st, payload(asg.id, 'att_one', {})).result;
    expect(again).toMatchObject({ receiptId: first.receiptId, duplicate: true, score: first.score });
    expect(b.call('submissions.list', teacher, { assignmentId: asg.id }).result).toHaveLength(1);
  });

  it('enforces attempt limits, closing and due dates', () => {
    const asg = assign({ maxAttempts: 1, dueAt: new Date(Date.now() - 60_000).toISOString(), allowLate: true }).result;
    const st = b.signIn('student1@example.com', 'sub-1');
    expect(b.call('student.submit', st, payload(asg.id, 'att_one', right)).result.late).toBe(true);
    expect(b.call('student.submit', st, payload(asg.id, 'att_two', right)).error).toBe('attempt-limit');
    const strict = assign({ dueAt: new Date(Date.now() - 60_000).toISOString(), allowLate: false }).result;
    expect(b.call('student.submit', st, payload(strict.id, 'att_x', right)).error).toBe('past-due');
    const open = assign().result;
    b.call('assignments.update', teacher, { assignmentId: open.id, closed: true });
    expect(b.call('student.submit', st, payload(open.id, 'att_y', right)).error).toBe('closed');
  });

  it('students cannot submit as someone else, and teachers cannot submit as students', () => {
    const asg = assign().result;
    expect(b.call('student.submit', b.signIn('stranger@example.com', 'sub-x'), payload(asg.id, 'att_s', right)).error).toBe('forbidden');
    expect(b.call('student.submit', teacher, payload(asg.id, 'att_t', right)).error).toBe('forbidden');
  });

  it('ignores a client-chosen question selection and re-derives it', () => {
    const a = activity();
    a.pools = [{ id: 'pol_1', name: 'P', draw: 1, itemIds: ['itm_q1', 'itm_q2'] }];
    const asg = b.call('assignments.create', teacher, { classId, activity: a, version: 1, contentHash: 'x' }).result;
    const st = b.signIn('student1@example.com', 'sub-1');
    b.call('student.submit', st, payload(asg.id, 'att_pool', right, null, { presentedItemIds: ['itm_q1', 'itm_q2', 'itm_fb'] }));
    const file = b.files().find((f) => f.name === 'S01__att_pool.json')!;
    const doc = JSON.parse(file.text());
    expect(doc.payload.presentedItemIds).toEqual(selectItemIds(a, 'att_pool'));
    expect(doc.report.totals.maxScore).toBe(gradeActivity(a, right, selectItemIds(a, 'att_pool')).maxScore);
  });

  it('stores submitted recordings in the class Recordings folder', () => {
    const a = activity();
    a.items.push({ type: 'speaking', id: 'itm_sp', audioCue: null, targets: [{ id: 't1', text: 'Hello' }], submission: 'optional', skills: [] } as unknown as Item);
    const asg = b.call('assignments.create', teacher, { classId, activity: a, version: 1, contentHash: 'x' }).result;
    const st = b.signIn('student1@example.com', 'sub-1');
    b.call('student.submit', st, payload(asg.id, 'att_rec', right, null, { recordings: [{ id: 'rec_1', itemId: 'itm_sp', targetId: 't1', mime: 'audio/webm', base64: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]).toString('base64') }] }));
    const rec = b.files().find((f) => f.name.startsWith('S01__att_rec__itm_sp__t1'))!;
    expect(rec.path).toMatch(/\/Recordings\/Fictional quiz/);
  });

  it('hides scores in receipts when the teacher chooses', () => {
    const asg = assign({ showScore: false }).result;
    const r = b.call('student.submit', b.signIn('student2@example.com', 'sub-2'), payload(asg.id, 'att_h', right)).result;
    expect(r.score).toBeNull();
    expect(b.call('submissions.list', teacher, { assignmentId: asg.id }).result[0].score).toBe(2);
  });
});
