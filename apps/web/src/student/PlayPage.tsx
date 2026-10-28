import { useEffect, useState } from 'react';
import type { PublishedVersion } from '@ilp/core';
import { getVersion } from '../storage/db';
import { ActivityPlayer } from './ActivityPlayer';
import { navigate } from '../app/router';

export function PlayPage({ activityId, version }: { activityId: string; version: number }) {
  const [v, setV] = useState<PublishedVersion | null | undefined>(undefined);
  useEffect(() => {
    void getVersion(activityId, version).then((x) => setV(x ?? null));
  }, [activityId, version]);
  if (v === undefined) return <p role="status">Loading…</p>;
  if (v === null)
    return (
      <div className="card">
        <h1>Activity not available</h1>
        <p>This activity is not on this device. Ask your teacher for the activity file or link.</p>
        <a className="button" href="#/student">My activities</a>
      </div>
    );
  return <ActivityPlayer version={v} mode="student" onExit={() => navigate('/student')} />;
}
