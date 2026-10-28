import { useEffect, useState } from 'react';
import { clearAllData, deleteAllRecordings, listRecordings } from '../storage/db';
import { DEFAULT_RETENTION, getRetention, setRetention, type RetentionPrefs } from '../storage/retention';
import { recordingSupported } from '../ui/recorder';
import { onDeviceRecognition, speechRecognitionCtor, ttsSupported } from '../ui/speech';
import { useConfirm } from '../ui/dialog';

export function SettingsPage() {
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [recs, setRecs] = useState<{ count: number; bytes: number } | null>(null);
  const [retention, setRet] = useState<RetentionPrefs>(DEFAULT_RETENTION);
  const [speech, setSpeech] = useState<{ record: boolean; asr: boolean; asrLocal: boolean; tts: boolean } | null>(null);
  const refreshRecs = async () => {
    const all = await listRecordings();
    setRecs({ count: all.length, bytes: all.reduce((n, r) => n + r.bytes.byteLength, 0) });
  };
  const confirm = useConfirm();

  useEffect(() => {
    void navigator.storage?.estimate?.().then(setEstimate);
    void navigator.storage?.persisted?.().then(setPersisted);
    void refreshRecs();
    void getRetention().then(setRet);
    void onDeviceRecognition(navigator.language || 'en-US').then((asrLocal) => setSpeech({ record: recordingSupported(), asr: !!speechRecognitionCtor(), asrLocal, tts: ttsSupported() }));
  }, []);
  const saveRet = async (p: RetentionPrefs) => {
    setRet(p);
    await setRetention(p);
  };

  const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`);

  return (
    <section aria-labelledby="set-h" className="narrow">
      <h1 id="set-h">Settings &amp; privacy</h1>
      <div className="card">
        <h2>Where your data is</h2>
        <p>This version runs entirely on this device. Activities and answers are stored in this browser’s storage (IndexedDB). Nothing is uploaded, there is no sign-in, no advertising and no tracking.</p>
        <p className="meta">Storage used: {mb(estimate?.usage)} of about {mb(estimate?.quota)} available.</p>
        <p>
          Protected from automatic clean-up: <strong>{persisted === null ? 'unknown' : persisted ? 'yes' : 'no'}</strong>{' '}
          {persisted === false && (
            <button type="button" className="secondary" onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}>Ask the browser to keep my data</button>
          )}
        </p>
        <p className="field-hint">Browsers may delete stored data when the device is low on space, or after a long time without use (Safari on iPhone/iPad especially). Export important activities as files.</p>
      </div>
      <div className="card">
        <h2>Voice recordings</h2>
        <p>{recs === null ? 'Checking…' : `${recs.count} recording${recs.count === 1 ? '' : 's'} on this device (${mb(recs.bytes)}).`} Recordings never leave this device in this version.</p>
        <label className="check">
          <input type="checkbox" checked={retention.deleteUnselectedOnSubmit} onChange={(e) => saveRet({ ...retention, deleteUnselectedOnSubmit: e.target.checked })} /> When work is submitted, delete practice recordings that were not chosen for submission
        </label>
        <div className="field field-inline">
          <label htmlFor="ret-days">Delete recordings older than (days)</label>
          <input id="ret-days" type="number" min={1} max={365} value={retention.maxAgeDays} onChange={(e) => { const n = e.target.valueAsNumber; if (n >= 1 && n <= 365) void saveRet({ ...retention, maxAgeDays: n }); }} />
        </div>
        <button type="button" className="secondary" disabled={!recs?.count} onClick={async () => {
          if (!(await confirm({ title: 'Delete all recordings on this device?', body: 'Every voice recording made in this browser will be erased.', confirmLabel: 'Delete recordings', danger: true }))) return;
          await deleteAllRecordings();
          await refreshRecs();
          setDone('All recordings were deleted.');
        }}>Delete all recordings</button>
      </div>
      <div className="card">
        <h2>Speech features in this browser</h2>
        {speech && (
          <ul className="capabilities">
            <li><strong>Recording and playback:</strong> {speech.record ? 'available' : 'not available — students can upload recordings instead'}</li>
            <li><strong>Speech-to-text:</strong> {!speech.asr ? 'not available' : speech.asrLocal ? 'available, runs on this device' : 'available, but may send audio to the browser maker’s servers'} (used only when a teacher enables it and the student agrees)</li>
            <li><strong>Device voice (text-to-speech):</strong> {speech.tts ? 'available' : 'not available'}</li>
            <li><strong>Pronunciation scoring:</strong> not provided. No validated on-device model is included, so the app never gives an automatic pronunciation score.</li>
          </ul>
        )}
      </div>
      <div className="card danger-zone">
        <h2>Delete local data</h2>
        <p>Erase every activity, published version, student answer and preference this app stored in this browser. This cannot be undone.</p>
        <button type="button" className="danger-btn" onClick={async () => {
          const ok = await confirm({ title: 'Delete all data on this device?', body: 'All activities, versions and student work in this browser will be permanently erased. Export anything you want to keep first.', confirmLabel: 'Delete everything', danger: true });
          if (!ok) return;
          await clearAllData();
          setDone('All local data was deleted.');
        }}>Delete all local data</button>
        {done && <p className="notice ok" role="status">{done}</p>}
      </div>
      <div className="card">
        <h2>About</h2>
        <p>Interactive Learning Platform · version 0.4.0 (Phase 4, local mode). Open source under the MIT licence.</p>
      </div>
    </section>
  );
}
