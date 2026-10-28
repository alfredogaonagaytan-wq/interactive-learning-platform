/**
 * EMULATOR of the Google services the submission service uses — NOT Google.
 *
 * Used by (1) the automated tests, which run the real generated service files
 * against it, and (2) the app's Simulation mode, which runs the same service
 * code in the browser with fictional people. Pure TypeScript (no Node APIs),
 * so both can share it.
 *
 * It models, pessimistically, the behaviour the service depends on:
 *  - Drive API v3 and Sheets API v4 REST calls authorised by the script's
 *    OAuth token, with `drive.file` enforced PER APP AND PER FILE: an app sees
 *    a file only if that app created it or the user picked it for that app.
 *    Picking a folder grants that folder only — NOT the files inside it.
 *    Inaccessible files answer 404 "File not found", as Google does.
 *  - Sheets values written with valueInputOption=USER_ENTERED are parsed like
 *    typed input (formulas, numbers, dates); RAW is stored exactly.
 *  - Google's ID-token check (tokeninfo): only tokens registered here verify,
 *    standing in for Google's signature check.
 *  - The Apps Script services the code calls (UrlFetchApp, Utilities, …).
 * What only real Google can show is listed in docs/12 and docs/15.
 */

export const SCRIPT_APP = 'teacher-apps-script-project';
export const WEB_APP = 'interactive-learning-platform-web-client';
export const SCRIPT_TOKEN = 'emulated-apps-script-oauth-token';
export const FOLDER = 'application/vnd.google-apps.folder';
export const SPREADSHEET = 'application/vnd.google-apps.spreadsheet';
const DRIVE_FULL = 'https://www.googleapis.com/auth/drive';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const SHEETS_FULL = 'https://www.googleapis.com/auth/spreadsheets';
const EXTERNAL = 'https://www.googleapis.com/auth/script.external_request';

export interface TokenInfo { aud: string; iss: string; exp: number; email: string; email_verified: string; sub: string; hd?: string; nonce?: string }
export interface EmuSheet { sheetId: number; title: string; rows: unknown[][] }
export interface EmuFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  /** base64 */
  content: string;
  createdBy: string;
  trashed: boolean;
  createdTime: string;
  modifiedTime: string;
  sheets?: EmuSheet[];
}
export interface EmuState {
  kind: 'ilp.googleEmulator';
  nextId: number;
  files: Record<string, EmuFile>;
  /** appId → file ids that app may use under drive.file */
  grants: Record<string, string[]>;
  props: Record<string, string>;
  tokens: Record<string, TokenInfo>;
}

/* ------------------------------------------------------------- bytes helpers */
const enc = new TextEncoder();
const dec = new TextDecoder();
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64encode(b: Uint8Array, webSafe = false): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=');
  }
  return webSafe ? s.replace(/\+/g, '-').replace(/\//g, '_') : s;
}
export function b64decode(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]!) : -1));
    const n = (c[0]! << 18) | (c[1]! << 12) | (Math.max(c[2]!, 0) << 6) | Math.max(c[3]!, 0);
    out.push((n >> 16) & 255);
    if (c[2]! >= 0) out.push((n >> 8) & 255);
    if (c[3]! >= 0) out.push(n & 255);
  }
  return Uint8Array.from(out);
}
const signed = (b: Uint8Array) => Array.from(b, (x) => (x > 127 ? x - 256 : x));
const unsigned = (a: ArrayLike<number>) => Uint8Array.from(Array.from(a, (x) => x & 255));
const bytesOf = (v: unknown): Uint8Array => {
  if (typeof v === 'string') return enc.encode(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array((v as ArrayBufferView).buffer, (v as ArrayBufferView).byteOffset, (v as ArrayBufferView).byteLength);
  if (v && typeof (v as { getBytes?: unknown }).getBytes === 'function') return unsigned((v as { getBytes(): number[] }).getBytes());
  if (Array.isArray(v)) return unsigned(v);
  return new Uint8Array(0);
};

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
/** SHA-256 (FIPS 180-4). */
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15]!, 7) ^ rotr(W[t - 15]!, 18) ^ (W[t - 15]! >>> 3);
      const s1 = rotr(W[t - 2]!, 17) ^ rotr(W[t - 2]!, 19) ^ (W[t - 2]! >>> 10);
      W[t] = (W[t - 16]! + s0 + W[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as [number, number, number, number, number, number, number, number];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t]! + W[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => (H[i] = (H[i]! + v) >>> 0));
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  H.forEach((v, i) => odv.setUint32(i * 4, v));
  return out;
}
export function hmacSha256(message: Uint8Array, key: Uint8Array): Uint8Array {
  let k = key.length > 64 ? sha256(key) : key;
  const block = new Uint8Array(64);
  block.set(k);
  k = block;
  const ipad = k.map((x) => x ^ 0x36);
  const opad = k.map((x) => x ^ 0x5c);
  const inner = new Uint8Array(64 + message.length);
  inner.set(ipad);
  inner.set(message, 64);
  const ih = sha256(inner);
  const outer = new Uint8Array(96);
  outer.set(opad);
  outer.set(ih, 64);
  return sha256(outer);
}

/**
 * How Sheets stores a value entered with USER_ENTERED (as if typed): "=…" is a
 * formula, number-like text a number, date-like text a date, TRUE/FALSE a
 * boolean. RAW stores values exactly. Deliberately pessimistic.
 */
export function userEntered(v: unknown, formulas: string[]): unknown {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (/^[=+@-]/.test(v) && v.length > 1 && !/^-?\d+(\.\d+)?$/.test(v)) {
    formulas.push(v);
    return '#FORMULA-RESULT';
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)) return { __date: v };
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return v;
}

/* --------------------------------------------------------------- the emulator */
interface Res { code: number; body: Uint8Array; type: string }
const json = (code: number, o: unknown): Res => ({ code, body: enc.encode(JSON.stringify(o)), type: 'application/json' });
const notFound = (id: string) => json(404, { error: { code: 404, message: `File not found: ${id}.`, errors: [{ reason: 'notFound' }] } });

export class GoogleEmulator {
  state: EmuState;
  /** OAuth scopes the script was authorised with (from its appsscript.json). */
  scopes: string[];
  lockBusy = false;
  logs: string[] = [];
  /** Every URL fetched by the script. */
  fetched: string[] = [];
  /** Every Drive/Sheets request refused for lack of access (id or parent). */
  denied: string[] = [];
  /** Formulas created in any sheet (should stay empty). */
  formulas: string[] = [];
  tokenFetches = 0;
  private cache = new Map<string, string>();

  constructor(opts: { scopes: string[]; state?: EmuState }) {
    this.scopes = opts.scopes;
    this.state = opts.state ?? { kind: 'ilp.googleEmulator', nextId: 1, files: {}, grants: {}, props: {}, tokens: {} };
  }

  /* ---- users, apps and access ---- */
  private newId(): string {
    const n = this.state.nextId++;
    return `1Emu${n.toString(36).padStart(5, '0')}${b64encode(sha256(enc.encode(`${n}:${Math.random()}`)), true).replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`;
  }
  private grant(app: string, id: string) {
    (this.state.grants[app] ??= []).includes(id) || this.state.grants[app]!.push(id);
  }
  private driveOk(app: string, id: string): boolean {
    if (id === 'root') return true;
    const f = this.state.files[id];
    if (!f) return false;
    if (app === SCRIPT_APP && this.scopes.includes(DRIVE_FULL)) return true;
    if (app === SCRIPT_APP && !this.scopes.includes(DRIVE_FILE)) return false;
    return (this.state.grants[app] ?? []).includes(id);
  }
  private sheetsOk(app: string, id: string): boolean {
    if (app === SCRIPT_APP && this.scopes.includes(SHEETS_FULL)) return !!this.state.files[id];
    return this.driveOk(app, id);
  }
  /** A file the user made themselves, outside this app (no app may see it under drive.file). */
  userCreate(name: string, opts: { mimeType?: string; parents?: string[]; content?: string } = {}): string {
    const id = this.newId();
    const now = new Date().toISOString();
    this.state.files[id] = { id, name, mimeType: opts.mimeType ?? 'text/plain', parents: opts.parents ?? ['root'], appProperties: {}, content: b64encode(enc.encode(opts.content ?? '')), createdBy: 'user', trashed: false, createdTime: now, modifiedTime: now };
    return id;
  }
  /** The user picks a file or folder for an app (Google Picker with that app's project). Grants that item only. */
  pick(app: string, id: string) {
    this.grant(app, id);
  }
  /** The user moves an item in the Drive web UI (as the owner, no app involved). */
  userMove(id: string, newParent: string) {
    this.state.files[id]!.parents = [newParent];
  }
  file(id: string): EmuFile | undefined {
    return this.state.files[id];
  }
  text(id: string): string {
    return dec.decode(b64decode(this.state.files[id]!.content));
  }
  bytes(id: string): Uint8Array {
    return b64decode(this.state.files[id]!.content);
  }
  path(id: string): string {
    const f = this.state.files[id];
    if (!f) return id === 'root' ? 'My Drive' : '?';
    return `${this.path(f.parents[0] ?? 'root')}/${f.name}`;
  }
  files(): EmuFile[] {
    return Object.values(this.state.files);
  }
  registerToken(token: string, info: TokenInfo) {
    this.state.tokens[token] = info;
  }

  /* ---- HTTP ---- */
  fetch(url: string, params: { method?: string; headers?: Record<string, string>; payload?: unknown; contentType?: string; muteHttpExceptions?: boolean } = {}) {
    this.fetched.push(url);
    const res = this.route(url, (params.method ?? 'get').toUpperCase(), params);
    if (res.code >= 400 && !params.muteHttpExceptions) throw new Error(`Request failed for ${url.split('?')[0]} returned code ${res.code}. Truncated server response: ${dec.decode(res.body).slice(0, 200)}`);
    return {
      getResponseCode: () => res.code,
      getContentText: () => dec.decode(res.body),
      getContent: () => signed(res.body),
      getBlob: () => blob(res.body, res.type, ''),
      getHeaders: () => ({ 'Content-Type': res.type }),
    };
  }

  private route(url: string, method: string, params: { headers?: Record<string, string>; payload?: unknown; contentType?: string }): Res {
    const u = new URL(url);
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/tokeninfo') {
      this.tokenFetches++;
      const info = this.state.tokens[u.searchParams.get('id_token') ?? ''];
      return info ? json(200, info) : json(400, { error: 'invalid_token', error_description: 'Invalid Value' });
    }
    if (!['www.googleapis.com', 'sheets.googleapis.com'].includes(u.host)) return json(404, { error: 'not emulated' });
    const auth = Object.entries(params.headers ?? {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
    if (auth !== `Bearer ${SCRIPT_TOKEN}`) return json(401, { error: { code: 401, message: 'Request is missing required authentication credential.' } });
    if (!this.scopes.includes(EXTERNAL)) return json(403, { error: { code: 403, message: 'UrlFetchApp needs script.external_request' } });
    const body = () => (params.payload === undefined ? {} : JSON.parse(typeof params.payload === 'string' ? params.payload : dec.decode(bytesOf(params.payload))));
    const app = SCRIPT_APP;
    if (u.host === 'sheets.googleapis.com') return this.sheets(u, method, body, app);

    // ---- Drive v3
    const upload = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (upload && method === 'PATCH' && u.searchParams.get('uploadType') === 'media') {
      const f = this.state.files[upload[1]!];
      if (!f || !this.driveOk(app, f.id)) return this.deny(upload[1]!);
      f.content = b64encode(bytesOf(params.payload));
      f.modifiedTime = new Date().toISOString();
      return json(200, this.meta(f));
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const b = body() as { name?: string; mimeType?: string; parents?: string[]; appProperties?: Record<string, string> };
      const parents = b.parents?.length ? b.parents : ['root'];
      for (const p of parents) {
        const pf = this.state.files[p];
        if (p !== 'root' && (!pf || pf.mimeType !== FOLDER || !this.driveOk(app, p))) return this.deny(p);
      }
      const now = new Date().toISOString();
      const f: EmuFile = { id: this.newId(), name: String(b.name ?? 'Untitled'), mimeType: b.mimeType ?? 'application/octet-stream', parents, appProperties: b.appProperties ?? {}, content: '', createdBy: app, trashed: false, createdTime: now, modifiedTime: now };
      if (f.mimeType === SPREADSHEET) f.sheets = [{ sheetId: 0, title: 'Sheet1', rows: [] }];
      this.state.files[f.id] = f;
      this.grant(app, f.id); // drive.file: files an app creates are available to that app
      return json(200, this.meta(f));
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      let match: (f: EmuFile) => boolean;
      try {
        match = parseQuery(u.searchParams.get('q') ?? '');
      } catch (e) {
        return json(400, { error: { code: 400, message: (e as Error).message } });
      }
      const files = this.files().filter((f) => this.driveOk(app, f.id) && match(f)).map((f) => this.meta(f));
      return json(200, { files });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (one) {
      const f = this.state.files[one[1]!];
      if (!f || !this.driveOk(app, f.id)) return this.deny(one[1]!);
      if (method === 'GET') return u.searchParams.get('alt') === 'media' ? { code: 200, body: b64decode(f.content), type: f.mimeType } : json(200, this.meta(f));
      if (method === 'PATCH') {
        const b = body() as { name?: string; trashed?: boolean; appProperties?: Record<string, string> };
        const add = u.searchParams.get('addParents');
        if (add) for (const p of add.split(',')) if (!this.driveOk(app, p) || this.state.files[p]?.mimeType !== FOLDER) return this.deny(p);
        const remove = (u.searchParams.get('removeParents') ?? '').split(',').filter(Boolean);
        if (add) f.parents = [...f.parents.filter((p) => !remove.includes(p)), ...add.split(',')];
        if (b.name !== undefined) f.name = b.name;
        if (b.trashed !== undefined) f.trashed = b.trashed;
        if (b.appProperties) f.appProperties = { ...f.appProperties, ...b.appProperties };
        f.modifiedTime = new Date().toISOString();
        return json(200, this.meta(f));
      }
      if (method === 'DELETE') {
        delete this.state.files[f.id];
        return { code: 204, body: new Uint8Array(0), type: 'text/plain' };
      }
    }
    return json(404, { error: { code: 404, message: `Not emulated: ${method} ${u.pathname}` } });
  }

  private deny(id: string): Res {
    this.denied.push(id);
    return notFound(id);
  }

  private meta(f: EmuFile) {
    const link = f.mimeType === FOLDER ? `https://drive.google.com/drive/folders/${f.id}` : f.mimeType === SPREADSHEET ? `https://docs.google.com/spreadsheets/d/${f.id}/edit` : `https://drive.google.com/file/d/${f.id}/view`;
    return { kind: 'drive#file', id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties, trashed: f.trashed, createdTime: f.createdTime, modifiedTime: f.modifiedTime, webViewLink: link, ...(f.mimeType.startsWith('application/vnd.google-apps') ? {} : { size: String(b64decode(f.content).length) }) };
  }

  private sheets(u: URL, method: string, body: () => unknown, app: string): Res {
    const m = /^\/v4\/spreadsheets\/([^/:]+)(?::batchUpdate|\/values\/([^:]+)(?::(append|clear))?)?$/.exec(u.pathname);
    if (!m) return json(404, { error: { code: 404, message: 'Not emulated' } });
    const f = this.state.files[m[1]!];
    if (!f || f.mimeType !== SPREADSHEET || !this.sheetsOk(app, f.id)) return json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    const sheets = f.sheets!;
    if (u.pathname.endsWith(':batchUpdate')) {
      const replies: unknown[] = [];
      for (const r of (body() as { requests: Array<Record<string, any>> }).requests) {
        if (r.addSheet) {
          const title = String(r.addSheet.properties.title);
          if (sheets.some((s) => s.title === title)) return json(400, { error: { code: 400, message: `A sheet with the name "${title}" already exists.` } });
          const s = { sheetId: Math.max(0, ...sheets.map((x) => x.sheetId)) + 1, title, rows: [] };
          sheets.push(s);
          replies.push({ addSheet: { properties: { sheetId: s.sheetId, title } } });
        } else if (r.deleteSheet) {
          f.sheets = sheets.filter((s) => s.sheetId !== r.deleteSheet.sheetId);
          replies.push({});
        } else return json(400, { error: { code: 400, message: 'Unsupported request' } });
      }
      return json(200, { spreadsheetId: f.id, replies });
    }
    if (!m[2]) return method === 'GET' ? json(200, { spreadsheetId: f.id, properties: { title: f.name }, sheets: sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })) }) : json(400, {});
    const r = parseRange(decodeURIComponent(m[2]));
    const sheet = sheets.find((s) => s.title === r.title);
    if (!sheet) return json(400, { error: { code: 400, message: `Unable to parse range: ${r.title}` } });
    const input = u.searchParams.get('valueInputOption');
    const store = (v: unknown) => (input === 'RAW' ? (v === null || v === undefined ? '' : v) : userEntered(v, this.formulas));
    if (m[3] === 'clear') {
      for (let i = r.r1; i < Math.min(sheet.rows.length, r.r2 + 1); i++) sheet.rows[i] = (sheet.rows[i] ?? []).map((v, c) => (c >= r.c1 && c <= r.c2 ? '' : v));
      return json(200, { clearedRange: m[2] });
    }
    if (method === 'GET') {
      const rows = sheet.rows.slice(r.r1, r.r2 + 1).map((row) => trimRow(row.slice(r.c1, r.c2 + 1).map(render)));
      while (rows.length && rows[rows.length - 1]!.length === 0) rows.pop();
      return json(200, { range: m[2], majorDimension: 'ROWS', ...(rows.length ? { values: rows } : {}) });
    }
    if (!input) return json(400, { error: { code: 400, message: "'valueInputOption' is required but not specified" } });
    const values = (body() as { values?: unknown[][] }).values ?? [];
    let start = r.r1;
    if (m[3] === 'append') {
      start = sheet.rows.length;
      while (start > 0 && trimRow(sheet.rows[start - 1]!.map(render)).length === 0) start--;
    } else if (method !== 'PUT') return json(400, {});
    values.forEach((row, i) => {
      const target = (sheet.rows[start + i] ??= []);
      row.forEach((v, j) => (target[r.c1 + j] = store(v)));
    });
    return json(200, { updatedRange: `${r.title}!A${start + 1}`, updatedRows: values.length });
  }

  /* ---- Apps Script runtime services ---- */
  services() {
    const emu = this;
    const props = emu.state.props;
    return {
      UrlFetchApp: { fetch: (url: string, p?: Parameters<GoogleEmulator['fetch']>[1]) => emu.fetch(url, p) },
      ScriptApp: { getOAuthToken: () => SCRIPT_TOKEN },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k: string) => (k in props ? props[k]! : null),
          setProperty: (k: string, v: string) => void (props[k] = String(v)),
          deleteProperty: (k: string) => void delete props[k],
        }),
      },
      CacheService: { getScriptCache: () => ({ get: (k: string) => emu.cache.get(k) ?? null, put: (k: string, v: string) => void emu.cache.set(k, v), remove: (k: string) => void emu.cache.delete(k) }) },
      LockService: { getScriptLock: () => ({ waitLock: () => { if (emu.lockBusy) throw new Error('Lock timeout: another process was holding the lock for too long.'); }, releaseLock: () => {} }) },
      ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (s: string) => ({ s, setMimeType() { return this; }, getContent() { return s; } }) },
      Logger: { log: (...a: unknown[]) => void emu.logs.push(a.join(' ')) },
      console: { log: (...a: unknown[]) => void emu.logs.push(a.join(' ')), error: (...a: unknown[]) => void emu.logs.push(a.join(' ')), warn: (...a: unknown[]) => void emu.logs.push(a.join(' ')) },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        getUuid: () => globalThis.crypto.randomUUID(),
        computeDigest: (_alg: string, v: unknown) => signed(sha256(bytesOf(v))),
        computeHmacSha256Signature: (v: unknown, k: unknown) => signed(hmacSha256(bytesOf(v), bytesOf(k))),
        base64Encode: (v: unknown) => b64encode(bytesOf(v)),
        base64EncodeWebSafe: (v: unknown) => b64encode(bytesOf(v), true),
        base64Decode: (s: string) => signed(b64decode(s)),
        base64DecodeWebSafe: (s: string) => signed(b64decode(s)),
        newBlob: (data: unknown, type?: string, name?: string) => blob(bytesOf(data), type ?? 'application/octet-stream', name ?? ''),
      },
    };
  }
}

function blob(bytes: Uint8Array, type: string, name: string) {
  return {
    getBytes: () => signed(bytes),
    getDataAsString: () => dec.decode(bytes),
    getContentType: () => type,
    getName: () => name,
    setContentType(t: string) { type = t; return this; },
  };
}

function render(v: unknown): unknown {
  // UNFORMATTED_VALUE returns dates as serial numbers (days since 1899-12-30).
  if (v && typeof v === 'object' && '__date' in (v as object)) return Date.parse((v as { __date: string }).__date) / 864e5 + 25569;
  return v;
}
function trimRow(row: unknown[]): unknown[] {
  const r = [...row];
  while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === undefined || r[r.length - 1] === null)) r.pop();
  return r.map((v) => (v === undefined || v === null ? '' : v));
}

const colIndex = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export function parseRange(a1: string): { title: string; r1: number; r2: number; c1: number; c2: number } {
  const [rawTitle, cells] = a1.includes('!') ? [a1.slice(0, a1.lastIndexOf('!')), a1.slice(a1.lastIndexOf('!') + 1)] : [a1, ''];
  const title = rawTitle.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  if (!cells) return { title, r1: 0, r2: Infinity, c1: 0, c2: Infinity };
  const [from, to] = cells.split(':');
  const p = (x: string | undefined) => /^([A-Z]*)(\d*)$/i.exec(x ?? '') ?? ['', '', ''];
  const f = p(from);
  const t = to === undefined ? f : p(to);
  return { title, c1: f[1] ? colIndex(f[1]) : 0, r1: f[2] ? Number(f[2]) - 1 : 0, c2: t[1] ? colIndex(t[1]) : Infinity, r2: t[2] ? Number(t[2]) - 1 : Infinity };
}

/** The subset of the Drive query language the service uses. Anything else is a 400, as an unsupported query would be. */
export function parseQuery(q: string): (f: EmuFile) => boolean {
  const str = String.raw`'((?:[^'\\]|\\.)*)'`;
  const un = (s: string) => s.replace(/\\(.)/g, '$1');
  const clauses: Array<(f: EmuFile) => boolean> = [];
  let rest = q.trim();
  while (rest) {
    let m: RegExpExecArray | null;
    if ((m = new RegExp(`^${str} in parents`).exec(rest))) { const v = un(m[1]!); clauses.push((f) => f.parents.includes(v)); }
    else if ((m = new RegExp(`^name = ${str}`).exec(rest))) { const v = un(m[1]!); clauses.push((f) => f.name === v); }
    else if ((m = new RegExp(`^mimeType (=|!=) ${str}`).exec(rest))) { const eq = m[1] === '='; const v = un(m[2]!); clauses.push((f) => (f.mimeType === v) === eq); }
    else if ((m = /^trashed = (true|false)/.exec(rest))) { const v = m[1] === 'true'; clauses.push((f) => f.trashed === v); }
    else if ((m = new RegExp(`^appProperties has \\{ key=${str} and value=${str} \\}`).exec(rest))) { const k = un(m[1]!); const v = un(m[2]!); clauses.push((f) => f.appProperties[k] === v); }
    else throw new Error(`Invalid Value: unsupported query near "${rest.slice(0, 40)}"`);
    rest = rest.slice(m[0].length).trim();
    if (rest.startsWith('and ')) rest = rest.slice(4).trim();
    else if (rest) throw new Error(`Invalid Value near "${rest.slice(0, 40)}"`);
  }
  return (f) => clauses.every((c) => c(f));
}
