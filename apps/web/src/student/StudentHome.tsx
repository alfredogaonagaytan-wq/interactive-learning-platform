import { useEffect, useRef, useState } from 'react';
import { gradeActivity, type Attempt, type PublishedVersion } from '@ilp/core';
import { listAttempts, listLatestVersions } from '../storage/db';
import { importForStudent } from '../storage/library';
import { formatTime } from '../app/util';

interface Row {
  version: PublishedVersion;
  attempts: Attempt[];
}

export function StudentHome() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const versions = await listLatestVersions();
    setRows(await Promise.all(versions.map(async (version) => ({ version, attempts: await listAttempts(version.activityId, version.version, 'student') }))));
  };
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section aria-labelledby="sh-h">
      <div className="page-head">
        <h1 id="sh-h">My activities</h1>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>Open activity file…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="Open activity file" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const v = await importForStudent(await f.text());
              setMessage({ kind: 'ok', text: `Added ${v.length} activit${v.length === 1 ? 'y' : 'ies'}.` });
              await refresh();
            } catch (err) {
              setMessage({ kind: 'error', text: (err as Error).message });
            }
          }} />
        </div>
      </div>
      <p className="meta">Your answers are saved on this device as you work. Signing in and sending work to your teacher’s Google Drive come in a later version.</p>
      {message && <p className={`notice ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      {rows === null ? <p role="status">Loading…</p> : rows.length === 0 ? (
        <div className="empty card">
          <h2>No activities yet</h2>
          <p>Open an activity file your teacher gave you, or publish one from the Teacher view.</p>
        </div>
      ) : (
        <ul className="activity-list">
          {rows.map(({ version, attempts }) => {
            const inProgress = attempts.find((a) => a.status === 'in-progress');
            const last = attempts.filter((a) => a.status === 'submitted').at(-1);
            const res = last ? gradeActivity(version.activity, last.responses as never) : null;
            const showScore = last && version.activity.settings.feedbackTiming !== 'after-release';
            return (
              <li key={version.activityId} className="card activity-row">
                <div>
                  <h2><a href={`#/play/${version.activityId}/${version.version}`}>{version.activity.title}</a></h2>
                  <p className="meta">
                    {inProgress ? <span className="badge warn">In progress</span> : last ? <span className="badge ok">Submitted</span> : <span className="badge">Not started</span>}
                    {last && <> · {formatTime(last.submittedAt!)}</>}
                    {showScore && res && res.percent !== null && <> · {res.percent}%</>}
                  </p>
                </div>
                <a className="button primary" href={`#/play/${version.activityId}/${version.version}`}>{inProgress ? 'Continue' : last ? 'View' : 'Start'}</a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
