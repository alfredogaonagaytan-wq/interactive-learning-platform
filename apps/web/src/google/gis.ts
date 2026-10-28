import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from '../config';

/**
 * Google Identity Services (sign-in + Drive access tokens).
 * - Sign-in yields an ID token (identity) used only with the teacher's broker.
 * - Drive access uses a separate, short-lived access token for the limited
 *   `drive.file` scope (only files this app creates or the user picks).
 * - Tokens live in memory only; nothing is written to localStorage.
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
  idToken: string | null;
  idTokenExp: number;
}

let state: AuthState = { profile: null, idToken: null, idTokenExp: 0 };
let access: { token: string; exp: number } | null = null;
const listeners = new Set<(s: AuthState) => void>();
let scriptPromise: Promise<void> | null = null;
let initialized = false;

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
export function decodeIdToken(token: string): Profile & { exp: number } {
  const part = token.split('.')[1] ?? '';
  const json = decodeURIComponent(Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
  const p = JSON.parse(json) as Record<string, unknown>;
  return { sub: String(p.sub), email: String(p.email ?? '').toLowerCase(), name: String(p.name ?? ''), hd: String(p.hd ?? ''), exp: Number(p.exp ?? 0) };
}

export function acceptCredential(credential: string): void {
  const p = decodeIdToken(credential);
  if (state.profile && state.profile.sub !== p.sub) access = null; // different account: drop Drive access
  state = { profile: { sub: p.sub, email: p.email, name: p.name, hd: p.hd }, idToken: credential, idTokenExp: p.exp * 1000 };
  emit();
}

export async function initSignIn(): Promise<void> {
  await loadGis();
  if (initialized) return;
  window.google!.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r: { credential: string }) => acceptCredential(r.credential),
    auto_select: true,
    use_fedcm_for_prompt: true,
    itp_support: true,
  });
  initialized = true;
}

export async function renderSignInButton(el: HTMLElement): Promise<void> {
  await initSignIn();
  window.google!.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
}

/** Silent re-sign-in after a reload (One Tap / FedCM, if the user signed in before). */
export async function trySilentSignIn(): Promise<void> {
  try {
    await initSignIn();
    window.google!.accounts.id.prompt();
  } catch {
    /* offline or blocked: the user can press the button */
  }
}

export function signOut(): void {
  if (access) window.google?.accounts.oauth2.revoke(access.token);
  window.google?.accounts.id.disableAutoSelect();
  access = null;
  state = { profile: null, idToken: null, idTokenExp: 0 };
  emit();
}

/** A valid ID token, or an error asking the user to sign in again. */
export function currentIdToken(): string {
  if (!state.idToken) throw new AuthError('Sign in with Google first.');
  if (Date.now() > state.idTokenExp - 60_000) throw new AuthError('Your Google sign-in has expired. Sign in again.');
  return state.idToken;
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

/** Test hook: reset module state. */
export function __resetAuthForTests(): void {
  state = { profile: null, idToken: null, idTokenExp: 0 };
  access = null;
  initialized = false;
  scriptPromise = null;
  emit();
}
