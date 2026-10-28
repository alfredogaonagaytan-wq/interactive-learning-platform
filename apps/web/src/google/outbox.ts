import type { Report, SubmissionPayload } from '@ilp/core';
import { getOutbox, listOutbox, putOutbox, type OutboxEntry } from '../storage/db';
import { broker, BrokerError } from './broker';
import { AuthError } from './gis';
import { DriveError, studentSubmissionsFolder, uploadFile } from './drive';
import { reportToHtml } from './reportHtml';
import { safeFilename } from '../app/util';

/**
 * Delivery queue for submissions. Each submission has two independent parts:
 *  1. teacher — sent to the teacher's broker (idempotent by attempt id)
 *  2. drive   — the student's own copy saved to their Google Drive
 * Both are retried with backoff; nothing is ever dropped. Status is shown to
 * the student so they know exactly what has succeeded.
 */
const listeners = new Set<() => void>();
export const onOutboxChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const changed = () => listeners.forEach((f) => f());

const backoff = (tries: number) => Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, tries - 1));

export async function enqueueSubmission(o: { brokerId: string; assignmentId: string; title: string; payload: SubmissionPayload; report: Report }): Promise<OutboxEntry> {
  const existing = await getOutbox(o.payload.attemptId);
  if (existing) return existing; // the same attempt is never queued twice
  const now = new Date().toISOString();
  const e: OutboxEntry = {
    attemptId: o.payload.attemptId, brokerId: o.brokerId, assignmentId: o.assignmentId, title: o.title, payload: o.payload, report: o.report,
    teacher: { state: 'pending', tries: 0, error: '', nextAt: 0, receipt: null },
    drive: { state: 'pending', tries: 0, error: '', nextAt: 0, fileIds: [], link: '' },
    createdAt: now, updatedAt: now,
  };
  await putOutbox(e);
  changed();
  return e;
}

let current: Promise<void> | null = null;
let again: { interactive: boolean; force: boolean } | null = null;

/**
 * Try to deliver everything that is due. `interactive` allows a Drive consent popup (must come from a click).
 * If a run is already in progress, another pass is scheduled right after it (a "Retry" press is never ignored).
 */
export function processOutbox(opts: { interactive?: boolean; force?: boolean } = {}): Promise<void> {
  const o = { interactive: opts.interactive ?? false, force: opts.force ?? false };
  if (current) {
    again = { interactive: (again?.interactive ?? false) || o.interactive, force: (again?.force ?? false) || o.force };
    return current;
  }
  current = (async () => {
    let next: typeof o | null = o;
    while (next) {
      for (const e of await listOutbox()) {
        await deliverTeacher(e, next.force);
        await deliverDrive(e, next.interactive, next.force);
      }
      next = again;
      again = null;
    }
  })().finally(() => {
    current = null;
  });
  return current;
}

async function save(e: OutboxEntry) {
  e.updatedAt = new Date().toISOString();
  await putOutbox(e);
  changed();
}

async function deliverTeacher(e: OutboxEntry, force: boolean) {
  const t = e.teacher;
  if (t.state === 'done' || (t.state === 'failed' && !force) || (!force && Date.now() < t.nextAt)) return;
  t.state = 'sending';
  await save(e);
  try {
    t.receipt = await broker.submit(e.brokerId, e.payload);
    t.state = 'done';
    t.error = '';
  } catch (err) {
    t.tries++;
    t.error = (err as Error).message;
    if (err instanceof AuthError) t.state = 'needs-sign-in';
    else if (err instanceof BrokerError && (err.transient || err.code === 'unauthenticated')) {
      t.state = err.code === 'unauthenticated' ? 'needs-sign-in' : 'pending';
      t.nextAt = Date.now() + backoff(t.tries);
    } else t.state = 'failed'; // refused by the teacher's rules (closed, limit, not enrolled): retrying would not help
  }
  await save(e);
}

async function deliverDrive(e: OutboxEntry, interactive: boolean, force: boolean) {
  const d = e.drive;
  if (d.state === 'done' || (!force && Date.now() < d.nextAt)) return;
  if (d.state === 'needs-permission' && !interactive) return;
  d.state = 'sending';
  await save(e);
  try {
    const folder = await studentSubmissionsFolder();
    const base = `${safeFilename(e.title)} – attempt ${e.report.attemptNumber}`;
    const props = { ilpAttempt: e.attemptId, ilpAssignment: e.assignmentId };
    if (!d.fileIds[0]) {
      const json = await uploadFile({ name: `${base}.json`, parentId: folder, mime: 'application/json', body: JSON.stringify({ report: e.report, receipt: e.teacher.receipt }, null, 2), appProperties: props });
      d.fileIds[0] = json.id;
      await save(e);
    }
    if (!d.fileIds[1]) {
      const doc = await uploadFile({ name: base, parentId: folder, mime: 'text/html', body: reportToHtml(e.report, e.teacher.receipt), convertTo: 'application/vnd.google-apps.document', appProperties: props });
      d.fileIds[1] = doc.id;
      d.link = doc.webViewLink ?? '';
    }
    d.state = 'done';
    d.error = '';
  } catch (err) {
    d.tries++;
    d.error = (err as Error).message;
    if (err instanceof AuthError) d.state = 'needs-permission';
    else if (err instanceof DriveError && err.status === 401) d.state = 'needs-permission';
    else {
      d.state = 'pending';
      d.nextAt = Date.now() + backoff(d.tries);
    }
  }
  await save(e);
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Background retries: when the device comes online, and every 30 s while anything is pending. */
export function startOutboxWorker(): () => void {
  const kick = () => void processOutbox();
  window.addEventListener('online', kick);
  timer ??= setInterval(kick, 30_000);
  kick();
  return () => {
    window.removeEventListener('online', kick);
    if (timer) clearInterval(timer);
    timer = null;
  };
}
