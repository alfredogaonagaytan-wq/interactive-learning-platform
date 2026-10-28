/**
 * Phase 5 integration test. Real: the app's UI, outbox, Drive client, broker
 * client and the broker's own code (built Code.gs + GradingCore.gs).
 * TEST DOUBLES (labelled): Google Identity Services, the Drive REST API and the
 * Apps Script runtime services. Live testing with real Google accounts is
 * described in docs/12-phase5-live-test.md.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { execFileSync } from 'node:child_process';
import { brokerBuildScript, createBroker } from '../../../services/submission-broker/test/fakeAppsScript';
import { __resetAuthForTests, __setSilentWaitForTests, acceptCredential } from '../src/google/gis';
import { ServiceSignIn } from '../src/google/SignIn';
import { getAsset } from '../src/storage/db';
import { AssignmentPage } from '../src/student/AssignmentPage';
import { ConfirmProvider } from '../src/ui/dialog';
import { listOutbox } from '../src/storage/db';
import { processOutbox } from '../src/google/outbox';
import { testActivity } from './helpers';
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from '../src/config';

const BROKER_ID = 'AKfycbTEST_broker_deployment_id_0123456789';
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (p: Record<string, unknown>) => `${b64url({ alg: 'RS256' })}.${b64url(p)}.sig`;

let broker: ReturnType<typeof createBroker>;
let broker2: ReturnType<typeof createBroker>;
const BROKER2_ID = 'AKfycbTEST_second_teacher_service_42';
const EVIL_ID = 'AKfycbEVIL_service_named_in_a_link_666';
/** Every ID token the app POSTed, by the service URL it was sent to. */
const sentTokens: Array<{ url: string; token: string }> = [];
let evilReply: unknown = null;
/** TEST DOUBLE state for Google Identity Services: the account that is "signed in to Google" in this browser. */
const gis = { nonce: '', callback: null as null | ((r: { credential: string }) => void), account: null as null | { email: string; sub: string }, silentOk: true };
const payloadOf = (t: string) => JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
function mint(nonce: string) {
  const { email, sub } = gis.account!;
  const token = jwt({ sub, email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600, aud: GOOGLE_CLIENT_ID, ...(nonce ? { nonce } : {}) });
  // Google would accept this token at any service; register it with both fake services' tokeninfo doubles.
  for (const b of [broker, broker2]) b.signIn(email, sub, { nonce: nonce || undefined }, token);
  return token;
}
let net = { offline: false, driveDenied: false };
const driveFiles: Array<{ id: string; name: string; mimeType?: string; parents?: string[]; appProperties?: Record<string, string>; body: string }> = [];

const readBlob = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(b); });

beforeAll(() => {
  execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore' });
});

beforeEach(() => {
  net = { offline: false, driveDenied: false };
  driveFiles.length = 0;
  broker = createBroker({ teacher: 'teacher@example.com', clientId: GOOGLE_CLIENT_ID, brokerId: BROKER_ID });
  broker2 = createBroker({ teacher: 'teacher2@example.com', clientId: GOOGLE_CLIENT_ID, brokerId: BROKER2_ID });
  sentTokens.length = 0;
  evilReply = null;
  Object.assign(gis, { nonce: '', callback: null, account: null, silentOk: true });
  __setSilentWaitForTests(200);
  // ---- TEST DOUBLE: Google Identity Services ----
  (window as unknown as { google: unknown }).google = {
    accounts: {
      id: {
        initialize: (o: { nonce?: string; callback: (r: { credential: string }) => void }) => { gis.nonce = o.nonce ?? ''; gis.callback = o.callback; },
        renderButton: () => {},
        // Silent sign-in (FedCM auto re-authentication) for the account already signed in to Google.
        prompt: () => { if (gis.silentOk && gis.account) setTimeout(() => gis.callback?.({ credential: mint(gis.nonce) }), 0); },
        disableAutoSelect: () => {},
      },
      oauth2: {
        initTokenClient: (o: { callback: (r: unknown) => void; error_callback: (e: unknown) => void }) => ({
          requestAccessToken: () => setTimeout(() => (net.driveDenied ? o.callback({ error: 'access_denied' }) : o.callback({ access_token: 'drive-token', expires_in: 3600, scope: `openid ${DRIVE_SCOPE}` })), 0),
        }),
        revoke: () => {},
      },
    },
  };
  // ---- TEST DOUBLE: network (Apps Script web app + Drive REST API) ----
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (net.offline) throw new TypeError('Failed to fetch');
    const url = String(input);
    const service = { [BROKER_ID]: broker, [BROKER2_ID]: broker2 }[/macros\/s\/([^/]+)\/exec/.exec(url)?.[1] ?? ''];
    if (url.startsWith('https://script.google.com/')) sentTokens.push({ url, token: JSON.parse(String(init!.body)).idToken });
    if (service) {
      const out = (service.ctx.doPost as (e: unknown) => { getContent(): string })({ postData: { contents: String(init!.body) } });
      return new Response(out.getContent(), { status: 200 });
    }
    if (url === `https://script.google.com/macros/s/${EVIL_ID}/exec`) {
      const req = JSON.parse(String(init!.body));
      return new Response(JSON.stringify(typeof evilReply === 'function' ? (evilReply as (r: unknown) => unknown)(req) : evilReply));
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      const q = decodeURIComponent(url.split('q=')[1]!.split('&')[0]!);
      const value = /value='([^']+)'/.exec(q)![1]!;
      const f = driveFiles.find((x) => x.appProperties?.ilp === value);
      return new Response(JSON.stringify({ files: f ? [{ id: f.id, name: f.name }] : [] }));
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?fields=id')) {
      const meta = JSON.parse(String(init!.body));
      const id = `drv_${driveFiles.length + 1}`;
      driveFiles.push({ id, ...meta, body: '' });
      return new Response(JSON.stringify({ id }));
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const text = await readBlob(init!.body as Blob);
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(text)![1]!);
      const id = `drv_${driveFiles.length + 1}`;
      driveFiles.push({ id, ...meta, body: text });
      return new Response(JSON.stringify({ id, webViewLink: `https://docs.google.com/document/d/${id}` }));
    }
    return new Response('not found', { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetAuthForTests();
  delete (window as unknown as { google?: unknown }).google;
});

function teacherSetup(opts: { grading?: 'client' | 'hidden' } = {}) {
  const t = broker.signIn('teacher@example.com', 'sub-teacher');
  broker.call('whoami', t); // the teacher's "Connect"
  const classId = broker.call('classes.create', t, { name: 'Grade 7 ELA' }).result.classId;
  broker.call('roster.put', t, { classId, rows: [{ studentNumber: 'S07', email: 'student7@example.com' }] });
  const a = testActivity();
  if (opts.grading === 'hidden') a.items = a.items.filter((i) => ['content', 'multiple-choice', 'true-false', 'fill-blanks'].includes(i.type));
  const asg = broker.call('assignments.create', t, { classId, activity: a, version: 1, contentHash: 'sha256:t', grading: opts.grading ?? 'client' }).result;
  return { teacherToken: t, assignmentId: asg.id as string };
}

/** The student signs in (e.g. on the Settings page, no service yet); service sign-ins then follow silently. */
function signInStudent(email = 'student7@example.com', sub = 'sub-s7') {
  gis.account = { email, sub };
  const token = mint('');
  act(() => acceptCredential(token));
}

async function openAndSubmit(assignmentId: string) {
  render(<ConfirmProvider><AssignmentPage assignmentId={assignmentId} brokerId={BROKER_ID} /></ConfirmProvider>);
  const user = userEvent.setup();
  expect(await screen.findByText(/student number/)).toHaveTextContent('S07');
  await user.type(await screen.findByRole('textbox', { name: /Blank 1 of 3/ }), 'went');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));
  return user;
}

describe('assignment submission (student → teacher’s Drive and student’s Drive)', () => {
  it('delivers to the teacher’s service with a verified receipt, and saves the student’s own copy to their Drive', async () => {
    const { teacherToken, assignmentId } = teacherSetup();
    signInStudent();
    await openAndSubmit(assignmentId);
    const status = await screen.findByRole('status', { name: '' }).catch(() => null);
    void status;
    await waitFor(() => expect(screen.getByText(/Your teacher:/).closest('li')).toHaveTextContent(/Done — received .* Receipt rct_/), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText(/Your Google Drive:/).closest('li')).toHaveTextContent(/Done — saved in Interactive Learning Platform › My Submissions/));
    // Teacher has it, with the student number only
    const subs = broker.call('submissions.list', teacherToken, { assignmentId }).result;
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ studentNumber: 'S07' });
    // Student Drive: folder tree + JSON report + converted Google Doc, all created with drive.file
    expect(driveFiles.map((f) => f.name)).toEqual(expect.arrayContaining(['Interactive Learning Platform', 'My Submissions']));
    const doc = driveFiles.find((f) => f.mimeType === 'application/vnd.google-apps.document')!;
    expect(doc.body).toContain('S07');
    expect(doc.body).not.toContain('student7@example.com');
  });

  it('keeps work safe offline and delivers exactly once when back online', async () => {
    const { teacherToken, assignmentId } = teacherSetup();
    signInStudent();
    net.offline = false;
    render(<ConfirmProvider><AssignmentPage assignmentId={assignmentId} brokerId={BROKER_ID} /></ConfirmProvider>);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: /Blank 1 of 3/ }), 'went');
    net.offline = true; // connection drops before submitting
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByText(/Your teacher:/).closest('li')).toHaveTextContent(/Waiting to send/));
    expect(screen.getByText(/safe on this device/)).toBeInTheDocument();
    net.offline = false;
    await act(async () => { await processOutbox({ force: true }); });
    await act(async () => { await processOutbox({ force: true }); }); // a second run must not resubmit
    await waitFor(() => expect(screen.getByText(/Your teacher:/).closest('li')).toHaveTextContent(/Done/));
    expect(broker.call('submissions.list', teacherToken, { assignmentId }).result).toHaveLength(1);
    expect((await listOutbox())).toHaveLength(1);
  });

  it('refuses a Google account that is not on the roster', async () => {
    const { assignmentId } = teacherSetup();
    signInStudent('intruder@example.com', 'sub-x');
    render(<ConfirmProvider><AssignmentPage assignmentId={assignmentId} brokerId={BROKER_ID} /></ConfirmProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/not on this class roster/);
  });

  it('if Drive access is refused, the teacher still receives the work and the student can allow Drive later', async () => {
    const { assignmentId } = teacherSetup();
    signInStudent();
    net.driveDenied = true;
    const user = await openAndSubmit(assignmentId);
    await waitFor(() => expect(screen.getByText(/Your teacher:/).closest('li')).toHaveTextContent(/Done/));
    await waitFor(() => expect(screen.getByText(/Your Google Drive:/).closest('li')).toHaveTextContent(/Needs your permission/));
    net.driveDenied = false;
    await user.click(screen.getByRole('button', { name: 'Allow Google Drive and retry' }));
    await waitFor(() => expect(screen.getByText(/Your Google Drive:/).closest('li')).toHaveTextContent(/Done/));
  });

  it('hidden answer keys: no checking on the device; the score comes from the teacher’s service', async () => {
    const { assignmentId } = teacherSetup({ grading: 'hidden' });
    signInStudent();
    render(<ConfirmProvider><AssignmentPage assignmentId={assignmentId} brokerId={BROKER_ID} /></ConfirmProvider>);
    await screen.findByRole('textbox', { name: /Blank 1 of 3/ });
    expect(screen.queryByRole('button', { name: /^Check/ })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Blank 1 of 3/ }), 'went');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('heading', { name: 'Submitted' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Your teacher:/).closest('li')).toHaveTextContent(/Verified score 1 \/ 7/));
  });
});

describe('sign-in tokens are bound to one submission service', { timeout: 15_000 }, () => {
  it('each service only ever receives tokens minted for itself', async () => {
    const { assignmentId } = teacherSetup();
    const t2 = broker2.signIn('teacher2@example.com', 'sub-t2');
    broker2.call('whoami', t2);
    const c2 = broker2.call('classes.create', t2, { name: 'Other class' }).result.classId;
    broker2.call('roster.put', t2, { classId: c2, rows: [{ studentNumber: 'B07', email: 'student7@example.com' }] });
    const a2 = broker2.call('assignments.create', t2, { classId: c2, activity: testActivity(), version: 1, contentHash: 'x' }).result.id;
    signInStudent();
    const first = render(<ConfirmProvider><AssignmentPage assignmentId={assignmentId} brokerId={BROKER_ID} /></ConfirmProvider>);
    expect(await screen.findByText(/student number/)).toHaveTextContent('S07');
    first.unmount();
    render(<ConfirmProvider><AssignmentPage assignmentId={a2} brokerId={BROKER2_ID} /></ConfirmProvider>);
    expect(await screen.findByText(/student number/)).toHaveTextContent('B07');
    expect(sentTokens.length).toBeGreaterThan(1);
    for (const { url, token } of sentTokens) expect(url).toContain(String(payloadOf(token).nonce).replace('ilp-b.', ''));
  });

  it('a token captured by a malicious service is refused by the real one', async () => {
    teacherSetup();
    signInStudent();
    evilReply = { ok: false, error: 'not-found', message: 'gone' };
    render(<ConfirmProvider><AssignmentPage assignmentId="asg_whatever" brokerId={EVIL_ID} /></ConfirmProvider>);
    await screen.findByRole('alert');
    const captured = sentTokens.find((x) => x.url.includes(EVIL_ID))!.token;
    expect(broker.call('whoami', captured).error).toBe('unauthenticated');
  });

  it('when Google cannot sign in silently, the app asks the user to confirm with a button', async () => {
    const { assignmentId } = teacherSetup();
    signInStudent();
    gis.silentOk = false;
    render(<ConfirmProvider><ServiceSignIn /><AssignmentPage assignmentId={assignmentId} brokerId={BROKER_ID} /></ConfirmProvider>);
    expect(await screen.findByRole('region', { name: 'Confirm Google sign-in' })).toBeInTheDocument();
    gis.silentOk = true;
    act(() => gis.callback!({ credential: mint(gis.nonce) })); // the user pressed Google's button
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Confirm Google sign-in' })).not.toBeInTheDocument());
  });
});

describe('data from a submission service is validated', { timeout: 15_000 }, () => {
  const evilActivity = () => ({ ...testActivity(), id: 'act_evil' });
  const reply = (r: { action: string }, asset: { mime: string; bytes: string }) =>
    r.action === 'student.asset'
      ? { ok: true, result: { id: 'ast_' + 'a'.repeat(40), mime: asset.mime, base64: btoa(asset.bytes) } }
      : { ok: true, result: { assignment: { kind: 'ilp.assignment', id: 'asg_evil', classId: 'cls_x', title: 'T', activityId: 'act_evil', version: 1, contentHash: '', grading: 'client', dueAt: null, allowLate: true, maxAttempts: null, showScore: true, createdAt: new Date().toISOString(), closed: false }, activity: evilActivity(), assetIds: ['ast_' + 'a'.repeat(40)], studentNumber: 'S1', submissions: 0 } };

  it('refuses HTML disguised as media', async () => {
    signInStudent();
    evilReply = (r: { action: string }) => reply(r, { mime: 'audio/mpeg', bytes: '<html><script>alert(1)</script></html>\u0000' });
    render(<ConfirmProvider><AssignmentPage assignmentId="asg_evil" brokerId={EVIL_ID} /></ConfirmProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot open safely/);
    expect(await getAsset('ast_' + 'a'.repeat(40))).toBeUndefined();
  });

  it('stores media under the type its bytes show, not the type claimed', async () => {
    signInStudent();
    evilReply = (r: { action: string }) => reply(r, { mime: 'text/html', bytes: 'ID3' + '\u0000'.repeat(20) });
    render(<ConfirmProvider><AssignmentPage assignmentId="asg_evil" brokerId={EVIL_ID} /></ConfirmProvider>);
    await screen.findByText(/student number/, undefined, { timeout: 5000 });
    expect((await getAsset('ast_' + 'a'.repeat(40)))!.mime).toBe('audio/mpeg');
  });

  it('refuses an activity that does not pass validation', async () => {
    signInStudent();
    evilReply = (r: { action: string }) => (r.action === 'student.assignment' ? { ok: true, result: { ...(reply(r, { mime: '', bytes: '' }) as { result: object }).result, activity: { kind: 'nope', items: 'x' }, assetIds: [] } } : null);
    render(<ConfirmProvider><AssignmentPage assignmentId="asg_evil" brokerId={EVIL_ID} /></ConfirmProvider>);
    await screen.findByRole('alert');
    expect(screen.queryByText(/student number/)).not.toBeInTheDocument();
  });
});

