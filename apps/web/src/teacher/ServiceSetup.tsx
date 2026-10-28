import { useEffect, useState } from 'react';
import { parseBrokerId } from '@ilp/core';
import { broker } from '../google/broker';
import { getBrokerId, setBrokerId } from '../google/brokerSetting';
import { setDefaultService } from '../google/gis';
import { BROKER_VERSION } from '../config';
import { AccountPanel } from '../google/SignIn';
import { useAuth } from '../google/useAuth';
import { GOOGLE_CLIENT_ID } from '../config';

async function copyFile(name: string): Promise<string> {
  const r = await fetch(`${import.meta.env.BASE_URL}broker/${name}`);
  if (!r.ok) throw new Error('File not found');
  const text = await r.text();
  await navigator.clipboard.writeText(text);
  return `Copied ${name} (${Math.round(text.length / 1024)} KB).`;
}

/** Guided setup of the teacher's own submission service (Google Apps Script). */
export function ServiceSetup() {
  const { profile } = useAuth();
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
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
      const who = await broker.whoami(id);
      if (who.role !== 'teacher') return setMsg({ kind: 'error', text: `That service belongs to another teacher (you are signed in as ${who.email}).` });
      await setBrokerId(id);
      setDefaultService(id);
      if (who.version !== BROKER_VERSION || who.coreOk === false) {
        setSaved(id);
        return setMsg({ kind: 'error', text: who.version !== BROKER_VERSION ? `Connected, but your service runs version ${who.version} and this app expects ${BROKER_VERSION}. Copy all three files again, save, and deploy a new version (Deploy → Manage deployments → Edit → New version).` : `Connected, but Code.gs and GradingCore were copied from different versions. Copy all three files again, save, and deploy a new version (Deploy → Manage deployments → Edit → New version).` });
      }
      setSaved(id);
      setMsg({ kind: 'ok', text: `Connected. Your private folder and roster sheet are ready in your Google Drive (service version ${who.version}).` });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setMsg({ kind: 'error', text: code === 'not-connected' ? 'This service was deployed from a different Google account than the one you are signed in with. Sign in with the account that owns the script.' : (e as Error).message });
    }
  };

  return (
    <section className="narrow" aria-labelledby="svc-h">
      <h1 id="svc-h">Your submission service</h1>
      <p>Student work is delivered to a small Google Apps Script that runs <strong>in your own Google account</strong>. It checks each student’s Google sign-in against your private roster, re-grades the work, and saves your copy into your Google Drive. There is no other server and no shared database.</p>
      <AccountPanel purpose="Sign in with the Google account you will use as the teacher." />
      {saved && <p className="notice ok">Connected to a submission service. <button type="button" className="link" onClick={async () => { await setBrokerId(null); setSaved(null); }}>Disconnect</button></p>}
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
        <li>Choose the function <code>setup</code> in the toolbar and press <strong>Run</strong>. Allow the permissions. Google shows “This app isn’t verified” because it is your own script: choose <strong>Advanced → Go to ILP submission service</strong>.</li>
        <li><strong>Deploy → New deployment → Web app</strong>. Execute as: <strong>Me</strong>. Who has access: <strong>Anyone</strong>. Deploy and copy the <strong>Web app URL</strong>. (“Anyone” is safe here: every request must carry a Google sign-in for this app, checked by the script.)</li>
        <li>
          Paste the URL and connect:
          <div className="row wrap">
            <input type="text" aria-label="Web app URL" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="button" className="primary" disabled={!profile} onClick={connect}>Connect</button>
          </div>
        </li>
      </ol>
      {msg && <p className={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
      <details className="subpanel">
        <summary>Technical details for IT</summary>
        <ul>
          <li>App OAuth client: <code>{GOOGLE_CLIENT_ID}</code>. The script accepts only ID tokens issued to this client (audience check via Google’s tokeninfo endpoint).</li>
          <li>Optional: set <code>ALLOWED_DOMAIN</code> in <code>setup()</code> to accept only school accounts.</li>
          <li>The script stores data only in your Drive: a folder “Interactive Learning Platform” and a private sheet with the roster and submissions log.</li>
          <li>When you update the code later, use <strong>Deploy → Manage deployments → Edit → New version</strong> so the URL stays the same.</li>
        </ul>
      </details>
    </section>
  );
}
