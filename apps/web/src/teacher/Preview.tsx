import { useEffect, useState } from 'react';
import type { PublishedVersion } from '@ilp/core';
import { deleteAttempts, getActivity } from '../storage/db';
import { draftSnapshot } from '../storage/library';
import { ActivityPlayer } from '../student/ActivityPlayer';
import { navigate } from '../app/router';

/** Preview the current *draft* as a teacher (answer key, nothing saved) or exactly as a student sees it. */
export function Preview({ id, as }: { id: string; as: 'teacher' | 'student' }) {
  const [snap, setSnap] = useState<PublishedVersion | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    void getActivity(id).then(async (a) => setSnap(a ? await draftSnapshot(a) : null));
  }, [id]);
  if (snap === undefined) return <p role="status">Loading…</p>;
  if (snap === null) return <p>Activity not found.</p>;
  return (
    <>
      <div className="preview-bar" role="region" aria-label="Preview controls">
        <a href={`#/teacher/edit/${id}`} className="button ghost">← Back to editor</a>
        <div className="segmented" role="group" aria-label="Preview as">
          <button type="button" aria-pressed={as === 'teacher'} onClick={() => navigate(`/teacher/preview/${id}?as=teacher`)}>Teacher view</button>
          <button type="button" aria-pressed={as === 'student'} onClick={() => navigate(`/teacher/preview/${id}?as=student`)}>Student view</button>
        </div>
        {as === 'student' && (
          <button type="button" className="ghost" onClick={async () => { await deleteAttempts(id, 'preview'); setNonce((n) => n + 1); }}>Reset preview</button>
        )}
      </div>
      <ActivityPlayer key={`${as}-${nonce}`} version={snap} mode={as === 'teacher' ? 'teacher-preview' : 'preview'} />
    </>
  );
}
