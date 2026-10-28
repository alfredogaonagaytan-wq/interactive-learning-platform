import { useEffect, useRef, useState } from 'react';
import { activityAssets, assignmentLink, canHideAnswerKeys, type PublishedVersion } from '@ilp/core';
import { broker, type ClassInfo } from '../google/broker';
import { getBrokerId } from '../google/brokerSetting';
import { useAuth } from '../google/useAuth';
import { getAsset } from '../storage/db';
import { appUrl } from './Classes';

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Assign the latest published version of an activity to a class (via the teacher's service). */
export function AssignDialog({ version, onClose }: { version: PublishedVersion | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { profile } = useAuth();
  const [brokerId, setBroker] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classId, setClassId] = useState('');
  const [due, setDue] = useState('');
  const [attempts, setAttempts] = useState('');
  const [grading, setGrading] = useState<'client' | 'hidden'>('client');
  const [allowLate, setAllowLate] = useState(true);
  const [showScore, setShowScore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const hide = version ? canHideAnswerKeys(version.activity) : { ok: false, blocking: [] };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (version) {
      setLink(null);
      setMsg(null);
      if (!d.open) (typeof d.showModal === 'function' ? d.showModal() : d.setAttribute('open', ''));
      void getBrokerId().then(async (id) => {
        setBroker(id ?? null);
        if (id && profile) {
          try {
            const c = await broker.listClasses(id);
            setClasses(c);
            setClassId(c[0]?.classId ?? '');
          } catch (e) {
            setMsg({ kind: 'error', text: (e as Error).message });
          }
        }
      });
    } else if (d.open) (typeof d.close === 'function' ? d.close() : d.removeAttribute('open'));
  }, [version, profile]);

  const submit = async () => {
    if (!version || !brokerId || !classId) return;
    setBusy(true);
    setMsg(null);
    try {
      const assets = [];
      for (const id of activityAssets(version.activity)) {
        const a = await getAsset(id);
        if (!a) throw new Error('An image or audio file used by this activity is missing on this device.');
        assets.push({ id, mime: a.mime, base64: b64(a.bytes) });
      }
      const asg = await broker.createAssignment(brokerId, {
        classId, activity: version.activity, version: version.version, contentHash: version.contentHash, title: version.activity.title, assets, grading,
        dueAt: due ? new Date(due).toISOString() : null, allowLate, maxAttempts: attempts ? Number(attempts) : null, showScore,
      });
      setLink(assignmentLink(appUrl(), asg.id, brokerId));
      setMsg({ kind: 'ok', text: 'Assigned. Share this link with the class.' });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog wide" aria-labelledby="assign-h" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="assign-h">Assign “{version?.activity.title}” (version {version?.version})</h2>
      {!profile ? <p>Sign in with Google first (Settings or Classes).</p> : !brokerId ? <p>Set up your submission service first: <a href="#/setup-service" onClick={onClose}>Submission service</a>.</p> : classes.length === 0 && !msg ? <p>Create a class first in <a href="#/classes" onClick={onClose}>Classes</a>.</p> : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="field"><label htmlFor="as-class">Class</label><select id="as-class" value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={c.classId} value={c.classId}>{c.name}{c.section ? ` · ${c.section}` : ''}</option>)}</select></div>
          <div className="grid-2">
            <div className="field"><label htmlFor="as-due">Due (optional)</label><input id="as-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
            <div className="field"><label htmlFor="as-att">Submissions allowed</label><input id="as-att" type="number" min={1} max={100} placeholder="Unlimited" value={attempts} onChange={(e) => setAttempts(e.target.value)} /></div>
          </div>
          <label className="check"><input type="checkbox" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} /> Accept late work (marked late)</label>
          <label className="check"><input type="checkbox" checked={showScore} onChange={(e) => setShowScore(e.target.checked)} /> Show students their verified score on the receipt</label>
          <fieldset>
            <legend>Grading</legend>
            <label className="check"><input type="radio" name="as-grading" checked={grading === 'client'} onChange={() => setGrading('client')} /> Instant feedback on the device, verified by your service (answer keys are on student devices)</label>
            <label className="check"><input type="radio" name="as-grading" disabled={!hide.ok} checked={grading === 'hidden'} onChange={() => setGrading('hidden')} /> Hide answer keys: only your service grades (no instant feedback)</label>
            {!hide.ok && <p className="field-hint">Not available for: {hide.blocking.join(', ')}.</p>}
          </fieldset>
          <div className="actions end">
            <button type="button" className="ghost" onClick={onClose}>Close</button>
            <button type="submit" className="primary" disabled={busy || !classId}>{busy ? 'Assigning…' : 'Assign'}</button>
          </div>
        </form>
      )}
      {msg && <p className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
      {link && (
        <div className="row wrap">
          <input type="text" readOnly aria-label="Assignment link" value={link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(link).catch(() => {})}>Copy link</button>
        </div>
      )}
      {(!profile || !brokerId) && <div className="actions end"><button type="button" className="ghost" onClick={onClose}>Close</button></div>}
    </dialog>
  );
}
