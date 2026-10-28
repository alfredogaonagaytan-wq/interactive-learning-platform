import { useEffect, useState } from 'react';
import { clearAllData } from '../storage/db';
import { useConfirm } from '../ui/dialog';

export function SettingsPage() {
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    void navigator.storage?.estimate?.().then(setEstimate);
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);

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
        <p>Interactive Learning Platform · version 0.2.0 (Phase 2, local mode). Open source under the MIT licence.</p>
      </div>
    </section>
  );
}
