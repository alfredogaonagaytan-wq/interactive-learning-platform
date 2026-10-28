import { useEffect, useState } from 'react';
import { getOutbox, type OutboxEntry } from '../storage/db';
import { onOutboxChange, processOutbox } from '../google/outbox';

const LABEL: Record<OutboxEntry['teacher']['state'], string> = {
  pending: 'Waiting to send', sending: 'Sending…', done: 'Done', failed: 'Not accepted', 'needs-sign-in': 'Sign in again to send', 'needs-permission': 'Needs your permission',
};

/** Shows both deliveries separately: to the teacher, and to the student's own Drive. */
export function SubmissionStatus({ attemptId }: { attemptId: string }) {
  const [e, setE] = useState<OutboxEntry | null>(null);
  useEffect(() => {
    const load = () => void getOutbox(attemptId).then((x) => setE(x ?? null));
    load();
    return onOutboxChange(load);
  }, [attemptId]);
  if (!e) return null;
  const t = e.teacher;
  const d = e.drive;
  return (
    <div className="delivery card" role="status" aria-live="polite">
      <h3>Delivery</h3>
      <ul>
        <li className={`dl-${t.state}`}>
          <strong>Your teacher:</strong> {LABEL[t.state]}
          {t.receipt && <> — received {new Date(t.receipt.receivedAt).toLocaleString()}{t.receipt.late ? ' (late)' : ''}. Receipt <code>{t.receipt.receiptId}</code>{t.receipt.score !== null ? `. Verified score ${t.receipt.score} / ${t.receipt.maxScore}` : ''}{t.receipt.needsReview ? `, ${t.receipt.needsReview} answer(s) for teacher review` : ''}.</>}
          {t.state !== 'done' && t.error && <span className="meta"> {t.error}</span>}
        </li>
        <li className={`dl-${d.state}`}>
          <strong>Your Google Drive:</strong> {LABEL[d.state]}
          {d.state === 'done' && <> — saved in Interactive Learning Platform › My Submissions{d.link ? <>. <a href={d.link} target="_blank" rel="noopener noreferrer">Open your report</a></> : ''}.</>}
          {d.state !== 'done' && d.error && <span className="meta"> {d.error}</span>}
        </li>
      </ul>
      {(t.state !== 'done' || d.state !== 'done') && (
        <button type="button" className="secondary" onClick={() => void processOutbox({ interactive: true, force: true })}>
          {d.state === 'needs-permission' ? 'Allow Google Drive and retry' : 'Retry now'}
        </button>
      )}
      <p className="field-hint">Your work is safe on this device until both are done. It will keep retrying automatically when you are online.</p>
    </div>
  );
}
