import { useCallback, useEffect, useState } from 'react';
import { parseBrokerId } from '@ilp/core';
import { broker, type StorageInfo } from '../google/broker';
import { getBrokerId, setBrokerId } from '../google/brokerSetting';
import { setDefaultService } from '../google/gis';
import { BROKER_VERSION, GOOGLE_CLIENT_ID } from '../config';
import { AccountPanel } from '../google/SignIn';
import { useAuth } from '../google/useAuth';
import { downloadText } from '../app/util';
import { isSimulation } from '../sim/mode';

async function copyFile(name: string): Promise<string> {
  const r = await fetch(`${import.meta.env.BASE_URL}broker/${name}`);
  if (!r.ok) throw new Error('File not found');
  const text = await r.text();
  await navigator.clipboard.writeText(text);
  return `Copied ${name} (${Math.round(text.length / 1024)} KB).`;
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

/** What Google shows a teacher when they run setup (service 0.6.0, appsscript.json). */
export const SERVICE_PERMISSIONS = [
  { scope: 'https://www.googleapis.com/auth/drive.file', text: 'See, edit, create, and delete only the specific Google Drive files you use with this app', why: 'Only the folder and files the service creates itself. Google does not let it see any other file in your Drive.' },
  { scope: 'https://www.googleapis.com/auth/script.external_request', text: 'Connect to an external service', why: 'To call Google’s own sign-in check and the Drive and Sheets APIs. It contacts no other site.' },
];

/** Guided setup of the teacher's own submission service (Google Apps Script), and its storage folder. */
export function ServiceSetup() {
  const { profile } = useAuth();
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  useEffect(() => void getBrokerId().then((id) => setSaved(id ?? null)), []);

  const copy = async (name: string) => {
    try {
      setMsg({ kind: 'ok', text: await copyFile(name) });
    } catch {
      setMsg({ kind: 'error', text: `Could not copy ${name}. Open ${import.meta.env.BASE_URL}broker/${name} and copy it manually.` });
    }
  };
  const connect = async () => {
    const id = parseBrokerId(url);
    if (!id) return setMsg({ kind: 'error', text: 'Paste the web app URL that ends in /exec.' });
    setMsg({ kind: 'info', text: 'Checking…' });
    try {
      const who = await broker.whoami(id, code.trim() || undefined);
      if (who.role !== 'teacher') return setMsg({ kind: 'error', text: `That service belongs to another teacher (you are signed in as ${who.email}).` });
      await setBrokerId(id);
      setDefaultService(id);
      setSaved(id);
      if (who.version !== BROKER_VERSION || who.coreOk === false) {
        return setMsg({ kind: 'error', text: who.version !== BROKER_VERSION ? `Connected, but your service runs version ${who.version} and this app expects ${BROKER_VERSION}. Copy all three files again, save, and deploy a new version (Deploy → Manage deployments → Edit → New version).` : `Connected, but Code.gs and GradingCore were copied from different versions. Copy all three files again, save, and deploy a new version (Deploy → Manage deployments → Edit → New version).` });
      }
      setMsg({ kind: 'ok', text: `Connected (service version ${who.version}). Your storage folder is shown below.` });
    } catch (e) {
      const c = (e as { code?: string }).code;
      setMsg({ kind: 'error', text: c === 'not-connected' ? 'Enter the connection code shown in the execution log after you ran setup.' : (e as Error).message });
    }
  };

  if (isSimulation())
    return (
      <section className="narrow" aria-labelledby="svc-h">
        <h1 id="svc-h">Submission service (simulated)</h1>
        <p>In Simulation mode each fictional teacher has a simulated service that runs in this browser. Nothing is sent to Google.</p>
        {saved ? <StoragePanel brokerId={saved} onDisconnect={() => setSaved(null)} /> : <p>Choose a fictional teacher on the <a href="#/simulation">Simulation</a> page first.</p>}
      </section>
    );

  return (
    <section className="narrow" aria-labelledby="svc-h">
      <h1 id="svc-h">Your submission service</h1>
      <p>Student work is delivered to a small Google Apps Script that runs <strong>in your own Google account</strong>. It checks each student’s Google sign-in against your private roster, re-grades the work, and saves your copy into one folder in your Google Drive. There is no other server and no shared database.</p>
      <AccountPanel purpose="Sign in with the Google account you will use as the teacher." />
      {saved ? (
        <StoragePanel brokerId={saved} onDisconnect={() => setSaved(null)} />
      ) : (
        <>
          <PermissionsCard />
          <ol className="setup-steps">
            <li>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com → New project</a> (signed in as yourself). Name it “ILP submission service”.</li>
            <li>
              In the editor, open <strong>Project Settings</strong> (gear) and tick <strong>Show “appsscript.json” manifest file</strong>. Back in the editor, replace the contents of each file:
              <div className="row wrap copy-row">
                <button type="button" className="secondary" onClick={() => copy('appsscript.json')}>Copy appsscript.json</button>
                <button type="button" className="secondary" onClick={() => copy('Code.gs')}>Copy Code.gs</button>
              </div>
              Then add a file named <code>GradingCore</code> (the + next to Files → Script) and paste:
              <div className="row wrap copy-row"><button type="button" className="secondary" onClick={() => copy('GradingCore.gs')}>Copy GradingCore.gs</button></div>
            </li>
            <li>Choose the function <code>setup</code> in the toolbar and press <strong>Run</strong>. Google asks for the two permissions above (and says “This app isn’t verified” because it is your own script: <strong>Advanced → Go to ILP submission service</strong>). Setup creates a folder <strong>Interactive Learning Platform</strong> at the top of your Drive and prints a <strong>connection code</strong> in the execution log.</li>
            <li><strong>Deploy → New deployment → Web app</strong>. Execute as: <strong>Me</strong>. Who has access: <strong>Anyone</strong>. Deploy and copy the <strong>Web app URL</strong>. (“Anyone” is safe here: every request must carry a Google sign-in for this app, checked by the script, and the folder is never shared.)</li>
            <li>
              Paste the URL and the connection code, and connect:
              <div className="row wrap">
                <input type="text" aria-label="Web app URL" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => setUrl(e.target.value)} />
                <input type="text" aria-label="Connection code" placeholder="XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
                <button type="button" className="primary" disabled={!profile} onClick={connect}>Connect</button>
              </div>
            </li>
          </ol>
        </>
      )}
      {msg && <p className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
      <details className="subpanel">
        <summary>Technical details for IT</summary>
        <ul>
          <li>App OAuth client: <code>{GOOGLE_CLIENT_ID}</code>. The script accepts only ID tokens issued to this client (audience check via Google’s tokeninfo endpoint), minted for this service (nonce).</li>
          <li>Script scopes: {SERVICE_PERMISSIONS.map((p) => <code key={p.scope}>{p.scope} </code>)}. It uses the Drive API v3 and Sheets API v4 (REST), never DriveApp or SpreadsheetApp.</li>
          <li>Optional: set <code>ALLOWED_DOMAIN</code> in <code>setup()</code> to accept only school accounts.</li>
          <li>Run <code>checkPermissions</code> in the editor to confirm what the script can and cannot see in your Drive.</li>
          <li>When you update the code later, use <strong>Deploy → Manage deployments → Edit → New version</strong> so the URL stays the same.</li>
        </ul>
      </details>
    </section>
  );
}

function PermissionsCard() {
  return (
    <div className="card permissions">
      <h2>What the service will be allowed to do</h2>
      <p>When you run setup, Google lists these permissions:</p>
      <ul>
        {SERVICE_PERMISSIONS.map((p) => (
          <li key={p.scope}><strong>{p.text}.</strong> {p.why}</li>
        ))}
      </ul>
      <p className="field-hint">It cannot read your email, your other Drive files or your other spreadsheets. Your folder is never shared: students reach your service, not your Drive.</p>
    </div>
  );
}

/** The teacher's storage folder: where it is, how much it holds, backup, move and disconnect. */
export function StoragePanel({ brokerId, onDisconnect }: { brokerId: string; onDisconnect: () => void }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setInfo(await broker.storageInfo(brokerId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brokerId]);
  useEffect(() => void load(), [load]);
  const backup = async () => {
    try {
      const data = await broker.storageExport(brokerId);
      downloadText(`ilp-service-backup-${new Date().toISOString().slice(0, 10)}${isSimulation() ? '-SIMULATION' : ''}.json`, JSON.stringify(data, null, 2));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const kinds: Array<[string, string]> = [['submission', 'Student submissions'], ['recording', 'Recordings'], ['media', 'Activity media'], ['assignment-file', 'Assignments']];
  return (
    <div className="card storage-panel" aria-labelledby="storage-h">
      <h2 id="storage-h">Storage{isSimulation() ? ' (simulated)' : ''}</h2>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!info && !error && <p role="status">Loading storage…</p>}
      {info && (
        <>
          <p>
            Folder <strong>{info.folder.name}</strong>{' '}
            {isSimulation() ? <span className="meta">(simulated Drive)</span> : <a href={info.folder.url} target="_blank" rel="noopener noreferrer">Open in Google Drive</a>}
            {!isSimulation() && <> · <a href={info.sheetUrl} target="_blank" rel="noopener noreferrer">Open the private roster sheet</a></>}
          </p>
          <p>{info.files} files, {formatBytes(info.bytes)} in total. Access: only files the service created (<code>{info.permission}</code>).</p>
          <ul className="storage-kinds">
            {kinds.map(([k, label]) => (
              <li key={k}>{label}: {info.byKind[k]?.files ?? 0} ({formatBytes(info.byKind[k]?.bytes ?? 0)})</li>
            ))}
          </ul>
        </>
      )}
      <div className="row wrap">
        <button type="button" className="secondary" onClick={load}>Refresh</button>
        <button type="button" className="secondary" onClick={backup}>Download backup (roster, assignments, submissions)</button>
        <button type="button" className="ghost" onClick={async () => { await setBrokerId(null); onDisconnect(); }}>Disconnect this app</button>
      </div>
      <details className="subpanel">
        <summary>Move, back up or stop the service</summary>
        <ul>
          <li><strong>Change the location:</strong> in Google Drive, move the folder “{info?.folder.name ?? 'Interactive Learning Platform'}” into any folder you like. The service keeps working: it finds its folder by id, not by place.</li>
          <li><strong>Everything, including recordings:</strong> in Google Drive, right-click the folder → Download.</li>
          <li><strong>Disconnect this app</strong> only forgets the service on this device. Your folder, sheet and student work stay in your Drive.</li>
          <li><strong>Stop the service completely:</strong> in Apps Script, Deploy → Manage deployments → Archive; then remove its access at <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">myaccount.google.com/connections</a>. Your files stay where they are.</li>
          <li><strong>Existing materials:</strong> use “From Google Drive…” in the activity editor. Picking a file lets this app copy it into the activity; when you assign it, the copy is stored in your folder. The original is not changed and no other file becomes visible.</li>
        </ul>
      </details>
    </div>
  );
}
