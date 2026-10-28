import { useEffect, useRef, useState } from 'react';
import { duplicateActivity, hasUnpublishedChanges, randomId, type Activity } from '@ilp/core';
import { countStudentAttempts, deleteActivity, listActivities, putActivity } from '../storage/db';
import { exportPackage, importAsDrafts } from '../storage/library';
import { navigate } from '../app/router';
import { downloadBytes, formatTime, safeFilename } from '../app/util';
import { useConfirm } from '../ui/dialog';
import { createActivity, ZIP_PACKAGE_EXTENSION } from '@ilp/core';
import { sampleActivity, sampleLanguageActivity, sampleSortingActivity } from './sample';

export function Library() {
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  const refresh = async () => setActivities(await listActivities());
  useEffect(() => {
    void refresh();
  }, []);

  const create = async (a: Activity) => {
    await putActivity(a);
    navigate(`/teacher/edit/${a.id}`);
  };

  const remove = async (a: Activity) => {
    const studentWork = await countStudentAttempts(a.id);
    const ok = await confirm({
      title: `Delete “${a.title}”?`,
      body: (
        <>
          <p>This removes the activity and all its published versions from this device. It cannot be undone. Export it first if you may need it.</p>
          {studentWork > 0 && <p><strong>{studentWork} student attempt{studentWork === 1 ? '' : 's'} on this device will be kept.</strong> Delete them from Settings → Delete local data.</p>}
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteActivity(a.id);
    setMessage({ kind: 'ok', text: `Deleted “${a.title}”.` });
    await refresh();
  };

  const safeExport = async (list: Activity[], filename: string) => {
    try {
      downloadBytes(filename, await exportPackage(list));
    } catch (e) {
      setMessage({ kind: 'error', text: `Could not export: ${(e as Error).message}` });
    }
  };

  const onImport = async (file: File) => {
    try {
      const imported = await importAsDrafts(new Uint8Array(await file.arrayBuffer()), () => randomId('act'));
      setMessage({ kind: 'ok', text: `Imported ${imported.length} activit${imported.length === 1 ? 'y' : 'ies'} as drafts.` });
      await refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <section aria-labelledby="lib-h">
      <div className="page-head">
        <h1 id="lib-h">Activity library</h1>
        <div className="actions">
          <button type="button" className="primary" onClick={() => create(createActivity())}>+ New activity</button>
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>Import…</button>
          {activities && activities.length > 0 && (
            <button type="button" className="secondary" onClick={() => safeExport(activities, `activity-library${ZIP_PACKAGE_EXTENSION}`)}>Export all</button>
          )}
          <input ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json" hidden aria-label="Import activity file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }} />
        </div>
      </div>
      {message && <p className={`notice ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      {activities === null ? (
        <p role="status">Loading…</p>
      ) : activities.length === 0 ? (
        <div className="empty card">
          <h2>No activities yet</h2>
          <p>Create an activity, import a package from a colleague, or start from a sample.</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => create(createActivity())}>Create an activity</button>
            <button type="button" className="secondary" onClick={() => create(sampleActivity())}>Open a sample activity</button>
            <button type="button" className="secondary" onClick={() => create(sampleSortingActivity())}>Open a drag-and-drop sample</button>
            <button type="button" className="secondary" onClick={() => create(sampleLanguageActivity())}>Open a grammar and speaking sample</button>
          </div>
        </div>
      ) : (
        <ul className="activity-list">
          {activities.map((a) => {
            const q = a.items.filter((i) => i.type !== 'content').length;
            const status = a.publishedVersion === null ? 'Draft' : hasUnpublishedChanges(a) ? `Published v${a.publishedVersion} · unpublished changes` : `Published v${a.publishedVersion}`;
            return (
              <li key={a.id} className="card activity-row">
                <div>
                  <h2><a href={`#/teacher/edit/${a.id}`}>{a.title || 'Untitled activity'}</a></h2>
                  <p className="meta">
                    <span className={`badge ${a.publishedVersion === null ? '' : hasUnpublishedChanges(a) ? 'warn' : 'ok'}`}>{status}</span> {q} question{q === 1 ? '' : 's'}
                    {a.subject && <> · {a.subject}</>} · edited {formatTime(a.updatedAt)}
                  </p>
                </div>
                <div className="actions">
                  <a className="button secondary" href={`#/teacher/edit/${a.id}`}>Edit</a>
                  <button type="button" className="ghost" onClick={async () => { await putActivity(duplicateActivity(a)); setMessage({ kind: 'ok', text: `Duplicated “${a.title}”.` }); await refresh(); }}>Duplicate</button>
                  <button type="button" className="ghost" onClick={() => safeExport([a], `${safeFilename(a.title)}${ZIP_PACKAGE_EXTENSION}`)}>Export</button>
                  <button type="button" className="ghost danger" onClick={() => remove(a)}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
