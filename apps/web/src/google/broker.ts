import { brokerUrl, type Assignment, type Receipt, type RosterRow, type SubmissionPayload, type Activity } from '@ilp/core';
import { idTokenFor } from './gis';
import { isSimulatedBroker, isSimulation } from '../sim/mode';

/**
 * Client for a teacher's submission broker (Apps Script web app).
 * Requests are "simple" POSTs (text/plain) so browsers need no CORS preflight;
 * Apps Script answers through a googleusercontent redirect that allows any origin.
 */
export class BrokerError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
  /** Worth retrying later (network trouble, Google busy). */
  get transient(): boolean {
    return this.code === 'network' || this.code === 'busy';
  }
}

export interface ClassInfo { classId: string; name: string; section: string; createdAt: string }
export interface AssignmentInfo { assignmentId: string; classId: string; title: string; grading: 'client' | 'hidden'; dueAt: string | null; allowLate: boolean; maxAttempts: number | null; showScore: boolean; closed: boolean; createdAt: string }
export interface SubmissionRow { receivedAt: string; assignmentId: string; classId: string; studentNumber: string; attemptId: string; attemptNumber: number; score: number; maxScore: number; needsReview: number; late: boolean | string; scoreMismatch: boolean | string; receiptId: string }
export interface StorageInfo {
  version: string;
  folder: { id: string; name: string; url: string; trashed: boolean };
  sheetUrl: string;
  files: number;
  bytes: number;
  byKind: Record<string, { files: number; bytes: number }>;
  permission: string;
}
export interface StudentAssignment { assignment: Assignment; activity: Activity; assetIds: string[]; studentNumber: string; submissions: number }

export async function brokerCall<T>(brokerId: string, action: string, body: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
  const simulated = isSimulatedBroker(brokerId);
  if (simulated !== isSimulation())
    throw new BrokerError('forbidden', simulated ? 'This link belongs to Simulation mode (fictional data). Turn on Simulation mode in Settings to open it.' : 'Simulation mode never contacts real submission services. Leave Simulation mode (Settings) to use this link.');
  let data: { ok: boolean; result?: T; error?: string; message?: string };
  if (simulated) {
    // The simulated service runs in this browser; nothing leaves the device.
    const idToken = await idTokenFor(brokerId);
    const { simCall } = await import('../sim/simService');
    data = (await simCall(brokerId, { action, idToken, ...body })) as typeof data;
  } else {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new BrokerError('network', 'You are offline. It will be sent when you are back online.');
    const idToken = await idTokenFor(brokerId); // minted for this service only
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(brokerUrl(brokerId), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, idToken, ...body }), redirect: 'follow', signal: ctrl.signal, credentials: 'omit' });
    } catch {
      throw new BrokerError('network', navigator.onLine ? 'Could not reach the submission service. It will be retried.' : 'You are offline. It will be sent when you are back online.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 || res.status >= 500) throw new BrokerError('busy', 'Google is busy. It will be retried shortly.');
    try {
      data = await res.json();
    } catch {
      throw new BrokerError('bad-response', 'The submission service sent an unexpected reply. Check that the teacher’s link is correct and the service is deployed for “Anyone”.');
    }
  }
  if (!data.ok) throw new BrokerError(data.error ?? 'error', data.message ?? 'The submission service refused the request.');
  return data.result as T;
}

export const broker = {
  whoami: (id: string, connectCode?: string) => brokerCall<{ role: 'teacher' | 'student'; email: string; version: string; coreOk?: boolean }>(id, 'whoami', connectCode ? { connectCode } : {}),
  storageInfo: (id: string) => brokerCall<StorageInfo>(id, 'storage.info'),
  storageExport: (id: string) => brokerCall<Record<string, unknown>>(id, 'storage.export'),
  listClasses: (id: string) => brokerCall<ClassInfo[]>(id, 'classes.list'),
  createClass: (id: string, name: string, section: string) => brokerCall<ClassInfo>(id, 'classes.create', { name, section }),
  getRoster: (id: string, classId: string) => brokerCall<RosterRow[]>(id, 'roster.get', { classId }),
  putRoster: (id: string, classId: string, rows: Array<Pick<RosterRow, 'studentNumber' | 'name' | 'email' | 'status'>>) => brokerCall<RosterRow[]>(id, 'roster.put', { classId, rows }),
  createAssignment: (id: string, body: Record<string, unknown>) => brokerCall<Assignment>(id, 'assignments.create', body, 180_000),
  listAssignments: (id: string, classId?: string) => brokerCall<AssignmentInfo[]>(id, 'assignments.list', { classId }),
  updateAssignment: (id: string, assignmentId: string, patch: Record<string, unknown>) => brokerCall<AssignmentInfo>(id, 'assignments.update', { assignmentId, ...patch }),
  listSubmissions: (id: string, assignmentId: string) => brokerCall<SubmissionRow[]>(id, 'submissions.list', { assignmentId }),
  studentAssignment: (id: string, assignmentId: string) => brokerCall<StudentAssignment>(id, 'student.assignment', { assignmentId }),
  studentAsset: (id: string, assignmentId: string, assetId: string) => brokerCall<{ id: string; mime: string; base64: string }>(id, 'student.asset', { assignmentId, assetId }),
  submit: (id: string, payload: SubmissionPayload) => brokerCall<Receipt>(id, 'student.submit', { payload }, 180_000),
};
