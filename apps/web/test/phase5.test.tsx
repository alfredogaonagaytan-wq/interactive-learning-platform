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
import { __resetAuthForTests, acceptCredential } from '../src/google/gis';
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
let net = { offline: false, driveDenied: false };
const driveFiles: Array<{ id: string; name: string; mimeType?: string; parents?: string[]; appProperties?: Record<string, string>; body: string }> = [];

const readBlob = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(b); });

beforeAll(() => {
  execFileSync(process.execPath, [brokerBuildScript()], { stdio: 'ignore' });
});

beforeEach(() => {
  net = { offline: false, driveDenied: false };
  driveFiles.length = 0;
  broker = createBroker({ teacher: 'teacher@example.com', clientId: GOOGLE_CLIENT_ID });
  // ---- TEST DOUBLE: Google Identity Services ----
  (window as unknown as { google: unknown }).google = {
    accounts: {
      id: { initialize: () => {}, renderButton: () => {}, prompt: () => {}, disableAutoSelect: () => {} },
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
    if (url === `https://script.google.com/macros/s/${BROKER_ID}/exec`) {
      const out = (broker.ctx.doPost as (e: unknown) => { getContent(): string })({ postData: { contents: String(init!.body) } });
      return new Response(out.getContent(), { status: 200 });
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
  const classId = broker.call('classes.create', t, { name: 'Grade 7 ELA' }).result.classId;
  broker.call('roster.put', t, { classId, rows: [{ studentNumber: 'S07', email: 'student7@example.com' }] });
  const a = testActivity();
  if (opts.grading === 'hidden') a.items = a.items.filter((i) => ['content', 'multiple-choice', 'true-false', 'fill-blanks'].includes(i.type));
  const asg = broker.call('assignments.create', t, { classId, activity: a, version: 1, contentHash: 'sha256:t', grading: opts.grading ?? 'client' }).result;
  return { teacherToken: t, assignmentId: asg.id as string };
}

function signInStudent(email = 'student7@example.com', sub = 'sub-s7') {
  const token = jwt({ sub, email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600, aud: GOOGLE_CLIENT_ID });
  broker.signIn(email, sub, {}, token);
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
