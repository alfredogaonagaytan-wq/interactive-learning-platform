/**
 * TEST DOUBLES for Google Apps Script services (SpreadsheetApp, DriveApp,
 * UrlFetchApp, …). They model only the behaviour the broker relies on, in
 * memory, so the real broker code (dist/Code.gs + dist/GradingCore.gs) can be
 * exercised in Node. They are NOT a substitute for testing a deployed script
 * with real Google accounts (see docs/12-phase5-live-test.md).
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const signed = (buf: Buffer) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (arr: number[] | Uint8Array) => Buffer.from(Array.from(arr, (b) => b & 0xff));

export class FakeBlob {
  constructor(public bytes: Buffer, public type: string, public name: string) {}
  getBytes() { return signed(this.bytes); }
  getDataAsString() { return this.bytes.toString('utf8'); }
  getContentType() { return this.type; }
  getName() { return this.name; }
}

let nextId = 1;
const iter = <T>(xs: T[]) => { let i = 0; return { hasNext: () => i < xs.length, next: () => xs[i++]! }; };

export class FakeFile {
  id = `file_${nextId++}`;
  parent: FakeFolder | null = null;
  constructor(public blob: FakeBlob, public drive: FakeDrive) { drive.files.set(this.id, this); }
  getId() { return this.id; }
  getName() { return this.blob.name; }
  getBlob() { return this.blob; }
  getParents() { return iter(this.parent ? [this.parent] : []); }
  moveTo(f: FakeFolder) { this.parent?.files.splice(this.parent.files.indexOf(this), 1); this.parent = f; f.files.push(this); }
}

export class FakeFolder {
  id = `folder_${nextId++}`;
  folders: FakeFolder[] = [];
  files: FakeFile[] = [];
  constructor(public name: string, public drive: FakeDrive, public parent: FakeFolder | null = null) { drive.folders.set(this.id, this); }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  createFolder(name: string) { const f = new FakeFolder(name, this.drive, this); this.folders.push(f); return f; }
  getFoldersByName(n: string) { return iter(this.folders.filter((f) => f.name === n)); }
  getFilesByName(n: string) { return iter(this.files.filter((f) => f.getName() === n)); }
  createFile(blob: FakeBlob) { const f = new FakeFile(blob, this.drive); f.moveTo(this); return f; }
  path(): string { return this.parent ? `${this.parent.path()}/${this.name}` : this.name; }
}

export class FakeDrive {
  folders = new Map<string, FakeFolder>();
  files = new Map<string, FakeFile>();
  roots: FakeFolder[] = [];
  createFolder(name: string) { const f = new FakeFolder(name, this); this.roots.push(f); return f; }
  getFolderById(id: string) { const f = this.folders.get(id); if (!f) throw new Error('No folder ' + id); return f; }
  getFileById(id: string) { const f = this.files.get(id); if (!f) throw new Error('No file ' + id); return f; }
  allFiles() { return [...this.files.values()]; }
}

/**
 * Models how Google Sheets stores values written by appendRow / setValues, the
 * way a typed entry would be: "=…" becomes a formula (recorded in `formulas`,
 * read back as its unknown result), number-like text becomes a number,
 * date-like text MAY become a Date, and a leading apostrophe forces plain text
 * (the apostrophe is not part of the value read back). This is an approximation
 * of Sheets' parser, kept deliberately pessimistic.
 */
export function sheetsStore(v: unknown, formulas: string[]): unknown {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (/^[=+@-]/.test(v) && v.length > 1 && !/^-?\d+(\.\d+)?$/.test(v)) {
    formulas.push(v);
    return '#FORMULA-RESULT';
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)) return new Date(v);
  if (v === 'TRUE' || v === 'true') return true;
  if (v === 'FALSE' || v === 'false') return false;
  return v;
}

class FakeSheet {
  rows: unknown[][] = [];
  constructor(public name: string, public formulas: string[]) {}
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  appendRow(r: unknown[]) { this.rows.push(r.map((v) => sheetsStore(v, this.formulas))); }
  clearContents() { this.rows = []; }
  getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
  getRange(row: number, col: number, nr: number, nc: number) {
    return {
      setValues: (vals: unknown[][]) => {
        for (let i = 0; i < nr; i++) {
          while (this.rows.length < row + i) this.rows.push([]);
          const target = this.rows[row - 1 + i]!;
          for (let j = 0; j < nc; j++) target[col - 1 + j] = sheetsStore(vals[i]![j], this.formulas);
        }
      },
    };
  }
}

class FakeSpreadsheet {
  id = `sheet_${nextId++}`;
  formulas: string[] = [];
  sheets: FakeSheet[] = [new FakeSheet('Sheet1', this.formulas)];
  getId() { return this.id; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}`; }
  getSheetByName(n: string) { return this.sheets.find((s) => s.name === n) ?? null; }
  insertSheet(n: string) { const s = new FakeSheet(n, this.formulas); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s: FakeSheet) { this.sheets.splice(this.sheets.indexOf(s), 1); }
}

export interface TokenInfo { aud: string; iss: string; exp: number; email: string; email_verified: string; sub: string; hd?: string; nonce?: string }

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** JWT-shaped token. Its signature is NOT real: validity is decided by the tokeninfo double, standing in for Google's signature check. */
export const fakeJwt = (payload: Record<string, unknown>) => `${b64url({ alg: 'RS256', kid: 'test' })}.${b64url(payload)}.${randomUUID().replace(/-/g, '')}`;

export function createBroker(opts: { teacher: string; clientId: string; brokerId?: string }) {
  const drive = new FakeDrive();
  const sheets = new Map<string, FakeSpreadsheet>();
  const props = new Map<string, string>();
  const cache = new Map<string, string>();
  const tokens = new Map<string, TokenInfo>();
  let tokenFetches = 0;
  const fetchedUrls: string[] = [];
  const lock = { busy: false };
  const logs: string[] = [];
  const ctx: Record<string, unknown> = {
    console: { log: (...a: unknown[]) => logs.push(a.join(' ')), error: (...a: unknown[]) => logs.push(a.join(' ')), warn: (...a: unknown[]) => logs.push(a.join(' ')) },
    Logger: { log: (...a: unknown[]) => logs.push(a.join(' ')) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (s: string) => ({ s, setMimeType() { return this; }, getContent() { return s; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v), deleteProperty: (k: string) => props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (lock.busy) throw new Error('Lock timeout: another process was holding the lock for too long.'); }, releaseLock: () => {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => opts.teacher }) },
    UrlFetchApp: {
      fetch: (url: string) => {
        tokenFetches++;
        fetchedUrls.push(url);
        const t = decodeURIComponent(url.split('id_token=')[1] ?? '');
        const info = tokens.get(t);
        return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info ?? { error: 'invalid_token' }) };
      },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      base64Encode: (b: number[] | string) => (typeof b === 'string' ? Buffer.from(b) : unsigned(b)).toString('base64'),
      base64EncodeWebSafe: (b: number[]) => unsigned(b).toString('base64url'),
      base64Decode: (s: string) => signed(Buffer.from(s, 'base64')),
      base64DecodeWebSafe: (s: string) => signed(Buffer.from(s, 'base64url')),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_a: string, s: string) => signed(createHash('sha256').update(s).digest()),
      computeHmacSha256Signature: (v: string, k: string) => signed(createHmac('sha256', k).update(v).digest()),
      newBlob: (data: number[] | string, type: string, name: string) => new FakeBlob(typeof data === 'string' ? Buffer.from(data) : unsigned(data), type, name),
    },
    DriveApp: drive,
    SpreadsheetApp: {
      create: (name: string) => {
        const s = new FakeSpreadsheet();
        sheets.set(s.id, s);
        const f = new FakeFile(new FakeBlob(Buffer.alloc(0), 'application/vnd.google-apps.spreadsheet', name), drive);
        drive.files.delete(f.id);
        f.id = s.id;
        drive.files.set(s.id, f);
        return s;
      },
      openById: (id: string) => sheets.get(id) ?? null,
    },
  };
  vm.createContext(ctx);
  const dist = brokerDist();
  vm.runInContext(readFileSync(resolve(dist, 'GradingCore.gs'), 'utf8'), ctx, { filename: 'GradingCore.gs' });
  vm.runInContext(readFileSync(resolve(dist, 'Code.gs'), 'utf8').replace(/var CLIENT_ID = "[^"]*"/, `var CLIENT_ID = ${JSON.stringify(opts.clientId)}`), ctx, { filename: 'Code.gs' });
  (ctx.setup as () => void)();

  const call = (action: string, idToken: string, body: Record<string, unknown> = {}) => {
    const out = (ctx.doPost as (e: unknown) => { getContent(): string })({ postData: { contents: JSON.stringify({ action, idToken, ...body }) } });
    return JSON.parse(out.getContent()) as { ok: boolean; result?: any; error?: string; message?: string };
  };
  /** Default nonce: tokens minted for this broker (as the app requests them). */
  const ownNonce = opts.brokerId ? `ilp-b.${opts.brokerId}` : undefined;
  const signIn = (email: string, sub: string, extra: Partial<TokenInfo> = {}, token?: string) => {
    const info: TokenInfo = { aud: opts.clientId, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, email, email_verified: 'true', sub, ...(ownNonce ? { nonce: ownNonce } : {}), ...extra };
    const t = token ?? fakeJwt({ ...info, email_verified: info.email_verified === 'true' });
    tokens.set(t, info);
    return t;
  };
  return { ctx, drive, sheets, props, call, signIn, lock, logs, fetchedUrls, tokenFetches: () => tokenFetches };
}

/** Location of the built broker files (works from any vitest project root). */
export function brokerDist(): string {
  for (const base of [process.cwd(), resolve(process.cwd(), '../..')]) {
    const p = resolve(base, 'services/submission-broker/dist');
    if (existsSync(resolve(base, 'services/submission-broker/build.mjs'))) return p;
  }
  throw new Error('submission-broker not found');
}
export const brokerBuildScript = () => resolve(brokerDist(), '../build.mjs');
