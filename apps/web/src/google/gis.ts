import { brokerIdFromNonce, brokerNonce } from '@ilp/core';
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from '../config';

/**
 * Google Identity Services (sign-in + Drive access tokens).
 * - Sign-in yields an ID token (identity) used only with the teacher's broker.
 * - Drive access uses a separate, short-lived access token for the limited
 *   `drive.file` scope (only files this app creates or the user picks).
 * - Tokens live in memory only; nothing is written to localStorage.
 * - Each ID token is requested for ONE teacher's submission service (its id is
 *   the token's nonce), and is only ever sent to that service. A token that a
 *   malicious service captures is therefore refused by every other service.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: Record<string, unknown>): void;
          renderButton(el: HTMLElement, o: Record<string, unknown>): void;
          prompt(cb?: (n: unknown) => void): void;
          disableAutoSelect(): void;
          revoke?(hint: string, cb: () => void): void;
        };
        oauth2: {
          initTokenClient(o: Record<string, unknown>): { requestAccessToken(o?: Record<string, unknown>): void };
          revoke(token: string, cb?: () => void): void;
        };
      };
    };
  }
}

export interface Profile {
  sub: string;
  email: string;
  name: string;
  hd: string;
}

export interface AuthState {
  profile: Profile | null;
  /** Services (broker ids) this session holds a valid sign-in for. */
  services: string[];
  /** A service that needs the user to press "Sign in" again (silent sign-in was not possible). */
  needsSignInFor: string | null;
}

const empty = (): AuthState => ({ profile: null, services: [], needsSignInFor: null });
let state: AuthState = empty();
const serviceTokens = new Map<string, { token: string; exp: number }>();
const waiters = new Map<string, Array<() => void>>();
let defaultService: string | null = null;
let initializedFor: string | null | undefined;
let access: { token: string; exp: number } | null = null;
const listeners = new Set<(s: AuthState) => void>();
let scriptPromise: Promise<void> | null = null;

export function onAuthChange(fn: (s: AuthState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
export const authState = () => state;
const emit = () => listeners.forEach((l) => l(state));

export function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Google sign-in could not load. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Decode (not verify) the ID token payload. Verification happens in the broker. */
export function decodeIdToken(token: string): Profile & { exp: number; nonce: string } {
  const part = token.split('.')[1] ?? '';
  const json = decodeURIComponent(Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
  const p = JSON.parse(json) as Record<string, unknown>;
  return { sub: String(p.sub), email: String(p.email ?? '').toLowerCase(), name: String(p.name ?? ''), hd: String(p.hd ?? ''), exp: Number(p.exp ?? 0), nonce: String(p.nonce ?? '') };
}

/** The service a plain sign-in (Settings, header) is made for: the teacher's own, when connected. */
export function setDefaultService(brokerId: string | null): void {
  defaultService = brokerId;
}

const validServices = () => [...serviceTokens].filter(([, t]) => Date.now() < t.exp - 60_000).map(([id]) => id);

export function acceptCredential(credential: string): void {
  const p = decodeIdToken(credential);
  if (state.profile && state.profile.sub !== p.sub) {
    access = null; // different account: drop Drive access and every service sign-in
    serviceTokens.clear();
  }
  const service = brokerIdFromNonce(p.nonce);
  if (service) serviceTokens.set(service, { token: credential, exp: p.exp * 1000 });
  // Same account: keep the same profile object, so pages that depend on it do not restart work.
  const same = state.profile && state.profile.sub === p.sub && state.profile.email === p.email && state.profile.name === p.name && state.profile.hd === p.hd;
  state = { profile: same ? state.profile : { sub: p.sub, email: p.email, name: p.name, hd: p.hd }, services: validServices(), needsSignInFor: state.needsSignInFor === service ? null : state.needsSignInFor };
  emit();
  if (service) {
    waiters.get(service)?.forEach((w) => w());
    waiters.delete(service);
  }
}

/** (Re)initialises Google sign-in so the next credential is minted for `brokerId` (or the default service). */
export async function initSignIn(brokerId: string | null = defaultService): Promise<void> {
  await loadGis();
  if (initializedFor === brokerId) return;
  window.google!.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r: { credential: string }) => acceptCredential(r.credential),
    ...(brokerId ? { nonce: brokerNonce(brokerId) } : {}),
    auto_select: true,
    use_fedcm_for_prompt: true,
    itp_support: true,
  });
  initializedFor = brokerId;
}

export async function renderSignInButton(el: HTMLElement, brokerId: string | null = defaultService): Promise<void> {
  await initSignIn(brokerId);
  window.google!.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
}

/** Silent re-sign-in after a reload (One Tap / FedCM, if the user signed in before). */
export async function trySilentSignIn(brokerId: string | null = defaultService): Promise<void> {
  try {
    await initSignIn(brokerId);
    window.google!.accounts.id.prompt();
  } catch {
    /* offline or blocked: the user can press the button */
  }
}

export function signOut(): void {
  if (access) window.google?.accounts.oauth2.revoke(access.token);
  window.google?.accounts.id.disableAutoSelect();
  access = null;
  serviceTokens.clear();
  state = empty();
  emit();
}

/** A valid ID token for this service, if the session holds one. */
export function currentIdToken(brokerId: string): string {
  const t = serviceTokens.get(brokerId);
  if (!state.profile) throw new AuthError('Sign in with Google first.');
  if (!t || Date.now() > t.exp - 60_000) throw new AuthError('Confirm your Google sign-in to continue.');
  return t.token;
}

/**
 * An ID token for this service. When the session has none (first contact,
 * expired), asks Google silently; if that is not possible, flags the service so
 * the app shows a "Sign in" button for it, and throws AuthError.
 */
let silentWaitMs = 8000;
export async function idTokenFor(brokerId: string, waitMs = silentWaitMs): Promise<string> {
  try {
    return currentIdToken(brokerId);
  } catch (e) {
    if (!state.profile) throw e;
  }
  const got = new Promise<boolean>((resolve) => {
    const list = waiters.get(brokerId) ?? [];
    list.push(() => resolve(true));
    waiters.set(brokerId, list);
    setTimeout(() => resolve(false), waitMs);
  });
  await trySilentSignIn(brokerId);
  if (await got) return currentIdToken(brokerId);
  state = { ...state, services: validServices(), needsSignInFor: brokerId };
  emit();
  throw new AuthError('Confirm your Google sign-in to continue.');
}

export class AuthError extends Error {}

/** Short-lived Drive access token for drive.file. Prompts for consent the first time. */
export async function driveAccessToken(interactive = true): Promise<string> {
  if (access && Date.now() < access.exp - 60_000) return access.token;
  await loadGis();
  const hint = state.profile?.email;
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      ...(hint ? { login_hint: hint } : {}),
      callback: (r: { access_token?: string; expires_in?: number; error?: string; scope?: string }) => {
        if (!r.access_token) return reject(new AuthError(r.error === 'access_denied' ? 'Google Drive access was not allowed.' : 'Google Drive access failed.'));
        if (r.scope && !r.scope.split(' ').includes(DRIVE_SCOPE)) return reject(new AuthError('Google Drive access was not granted. Tick the Drive box when asked.'));
        access = { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e: { type?: string }) => reject(new AuthError(e.type === 'popup_closed' ? 'The Google window was closed.' : 'Google Drive access failed.')),
    });
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

/** Test hook: how long to wait for a silent sign-in. */
export function __setSilentWaitForTests(ms: number): void {
  silentWaitMs = ms;
}

/** Test hook: reset module state. */
export function __resetAuthForTests(): void {
  state = empty();
  access = null;
  serviceTokens.clear();
  waiters.clear();
  defaultService = null;
  initializedFor = undefined;
  scriptPromise = null;
  emit();
}
