import { driveAccessToken } from './gis';

/**
 * Minimal Google Drive v3 client for the `drive.file` scope: it can only see
 * files and folders this app created (or the user picked). Folders are found by
 * an app property, not by name, so renaming them in Drive does not break anything.
 */
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await driveAccessToken();
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError(0, 'Could not reach Google Drive.');
  }
  if (!res.ok) {
    let msg = `Google Drive error ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch { /* ignore */ }
    throw new DriveError(res.status, msg);
  }
  return res;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function findByAppProperty(key: string, value: string, parentId?: string): Promise<string | null> {
  const query = [`appProperties has { key='${q(key)}' and value='${q(value)}' }`, 'trashed=false', ...(parentId ? [`'${q(parentId)}' in parents`] : [])].join(' and ');
  const r = await driveFetch(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&spaces=drive`);
  const j = (await r.json()) as { files: Array<{ id: string }> };
  return j.files[0]?.id ?? null;
}

export async function ensureFolder(name: string, key: string, parentId?: string): Promise<string> {
  const found = await findByAppProperty('ilp', key, parentId);
  if (found) return found;
  const r = await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', appProperties: { ilp: key }, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return ((await r.json()) as { id: string }).id;
}

/** Multipart upload. `convertTo` lets Drive convert (e.g. HTML → Google Doc). */
export async function uploadFile(opts: { name: string; parentId: string; mime: string; body: Blob | string; appProperties?: Record<string, string>; convertTo?: string }): Promise<{ id: string; webViewLink?: string }> {
  const meta = { name: opts.name, parents: [opts.parentId], ...(opts.convertTo ? { mimeType: opts.convertTo } : {}), ...(opts.appProperties ? { appProperties: opts.appProperties } : {}) };
  const boundary = `ilp${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${opts.mime}\r\n\r\n`,
    opts.body,
    `\r\n--${boundary}--`,
  ]);
  const r = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return (await r.json()) as { id: string; webViewLink?: string };
}

export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const meta = (await (await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?fields=name,mimeType`)).json()) as { name: string; mimeType: string };
  const r = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: meta.mimeType, name: meta.name };
}

/** The student's own folder tree: Interactive Learning Platform / My Submissions. */
export async function studentSubmissionsFolder(): Promise<string> {
  const root = await ensureFolder('Interactive Learning Platform', 'root');
  return ensureFolder('My Submissions', 'my-submissions', root);
}
