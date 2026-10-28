/**
 * Test harness: runs the REAL generated service files (dist/GradingCore.gs +
 * dist/Code.gs) in a Node sandbox against the LABELLED Google EMULATOR in
 * ../emulator/googleEmulator.ts (Drive v3 / Sheets v4 with drive.file enforced
 * per file, tokeninfo, Apps Script runtime services). The service gets exactly
 * the OAuth scopes listed in dist/appsscript.json. This is NOT a substitute for
 * testing a deployed script with real Google accounts (docs/12-phase5-live-test.md).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { GoogleEmulator, type TokenInfo } from '../emulator/googleEmulator';

export type { TokenInfo };
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** JWT-shaped token. Its signature is NOT real: validity is decided by the emulated tokeninfo, standing in for Google's signature check. */
export const fakeJwt = (payload: Record<string, unknown>) => `${b64url({ alg: 'RS256', kid: 'test' })}.${b64url(payload)}.${randomUUID().replace(/-/g, '')}`;

export function manifest(): { oauthScopes: string[]; webapp: unknown; dependencies?: unknown } {
  return JSON.parse(readFileSync(resolve(brokerDist(), 'appsscript.json'), 'utf8'));
}

export function createBroker(opts: { teacher: string; clientId: string; brokerId?: string; scopes?: string[] }) {
  const emu = new GoogleEmulator({ scopes: opts.scopes ?? manifest().oauthScopes });
  const ctx: Record<string, unknown> = { ...emu.services() };
  vm.createContext(ctx);
  const dist = brokerDist();
  vm.runInContext(readFileSync(resolve(dist, 'GradingCore.gs'), 'utf8'), ctx, { filename: 'GradingCore.gs' });
  vm.runInContext(readFileSync(resolve(dist, 'Code.gs'), 'utf8').replace(/var CLIENT_ID = "[^"]*"/, `var CLIENT_ID = ${JSON.stringify(opts.clientId)}`), ctx, { filename: 'Code.gs' });
  (ctx.setup as () => void)();
  /** The one-time code setup() printed to the execution log. */
  const connectCode = /Connection code[^:]*: ([A-Z0-9-]{19})/.exec(emu.logs.join('\n'))?.[1] ?? '';

  const call = (action: string, idToken: string, body: Record<string, unknown> = {}) => {
    const out = (ctx.doPost as (e: unknown) => { getContent(): string })({ postData: { contents: JSON.stringify({ action, idToken, ...body }) } });
    return JSON.parse(out.getContent()) as { ok: boolean; result?: any; error?: string; message?: string };
  };
  /** The teacher's first "Connect" in the app: whoami with the connection code. */
  const connect = (idToken: string, code = connectCode) => call('whoami', idToken, { connectCode: code });
  const ownNonce = opts.brokerId ? `ilp-b.${opts.brokerId}` : undefined;
  const signIn = (email: string, sub: string, extra: Partial<TokenInfo> = {}, token?: string) => {
    const info: TokenInfo = { aud: opts.clientId, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, email, email_verified: 'true', sub, ...(ownNonce ? { nonce: ownNonce } : {}), ...extra };
    const t = token ?? fakeJwt({ ...info, email_verified: info.email_verified === 'true' });
    emu.registerToken(t, info);
    return t;
  };
  const props = {
    get: (k: string) => emu.state.props[k],
    set: (k: string, v: string) => void (emu.state.props[k] = v),
    delete: (k: string) => void delete emu.state.props[k],
  };
  const lock = { set busy(v: boolean) { emu.lockBusy = v; }, get busy() { return emu.lockBusy; } };
  /** Files the service created, with their Drive path. */
  const files = () => emu.files().map((f) => ({ ...f, path: emu.path(f.id), text: () => emu.text(f.id) }));
  return { ctx, emu, props, call, connect, connectCode, signIn, lock, files, logs: emu.logs, fetchedUrls: emu.fetched, tokenFetches: () => emu.tokenFetches };
}

/** Location of the built service files (works from any vitest project root). */
export function brokerDist(): string {
  for (const base of [process.cwd(), resolve(process.cwd(), '../..')]) {
    const p = resolve(base, 'services/submission-broker/dist');
    if (existsSync(resolve(base, 'services/submission-broker/build.mjs'))) return p;
  }
  throw new Error('submission-broker not found');
}
export const brokerBuildScript = () => resolve(brokerDist(), '../build.mjs');
