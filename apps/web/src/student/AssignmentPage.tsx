import { useEffect, useState } from 'react';
import { contentHash, type PublishedVersion } from '@ilp/core';
import { broker } from '../google/broker';
import { AccountPanel } from '../google/SignIn';
import { useAuth } from '../google/useAuth';
import { getAsset, getLocalAssignment, getVersion, listVersions, putAsset, putLocalAssignment, putVersion, type LocalAssignment } from '../storage/db';
import { ActivityPlayer } from './ActivityPlayer';
import { navigate } from '../app/router';

/**
 * Opens an assignment from a teacher's link (#/a/<assignmentId>?b=<service>).
 * The activity is downloaded once (after the teacher's service checks the
 * roster) and stored on the device, so it can be completed offline. The local
 * copy is keyed by the assignment id so it never mixes with a teacher's drafts.
 */
export function AssignmentPage({ assignmentId, brokerId }: { assignmentId: string; brokerId: string | null }) {
  const { profile } = useAuth();
  const [state, setState] = useState<{ version: PublishedVersion; meta: LocalAssignment } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      const meta = await getLocalAssignment(assignmentId);
      const local = meta ? (await listVersions(assignmentId)).at(-1) : undefined;
      const sameAccount = !meta || !profile || meta.account === profile.sub;
      if (meta && local && sameAccount) {
        if (!cancelled) setState({ version: local, meta });
        setLoading(false);
        return;
      }
      if (!profile) {
        setLoading(false);
        return;
      }
      const bid = brokerId ?? meta?.brokerId;
      if (!bid) {
        setError('This link is incomplete. Ask your teacher for the assignment link again.');
        setLoading(false);
        return;
      }
      try {
        const r = await broker.studentAssignment(bid, assignmentId);
        for (const id of r.assetIds) {
          if (await getAsset(id)) continue;
          const a = await broker.studentAsset(bid, assignmentId, id);
          const bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
          await putAsset({ id, mime: a.mime as never, bytes, name: id, addedAt: new Date().toISOString() });
        }
        const activity = { ...r.activity, id: assignmentId, title: r.assignment.title, settings: { ...r.activity.settings, maxAttempts: r.assignment.maxAttempts ?? r.activity.settings.maxAttempts } };
        const hash = await contentHash(activity);
        const existing = (await listVersions(assignmentId)).find((v) => v.contentHash === hash);
        const version: PublishedVersion = existing ?? { kind: 'ilp.publishedVersion', activityId: assignmentId, version: ((await listVersions(assignmentId)).at(-1)?.version ?? 0) + 1, publishedAt: r.assignment.createdAt, contentHash: hash, activity };
        if (!existing) await putVersion(version);
        const m: LocalAssignment = { assignmentId, brokerId: bid, assignment: r.assignment, studentNumber: r.studentNumber, account: profile.sub, fetchedAt: new Date().toISOString() };
        await putLocalAssignment(m);
        if (!cancelled) setState({ version: (await getVersion(assignmentId, version.version))!, meta: m });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, brokerId, profile]);

  if (state) {
    const a = state.meta.assignment;
    return (
      <>
        <p className="assignment-meta meta">
          Assignment for student number <strong>{state.meta.studentNumber}</strong>
          {a.dueAt ? <> · due {new Date(a.dueAt).toLocaleString()}</> : null}
          {a.grading === 'hidden' ? ' · your teacher grades this' : ''}
        </p>
        <ActivityPlayer version={state.version} mode="student" onExit={() => navigate('/student')} assignment={{ brokerId: state.meta.brokerId, assignment: a, studentNumber: state.meta.studentNumber }} />
      </>
    );
  }
  return (
    <section className="narrow">
      <h1>Assignment</h1>
      {loading && <p role="status">Loading…</p>}
      {!loading && !profile && <AccountPanel purpose="Sign in with your school Google account to open this assignment. Your teacher’s service checks that you are on the class list." />}
      {error && <p className="notice error" role="alert">{error}</p>}
    </section>
  );
}
