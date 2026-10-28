import { useEffect, useRef, useState } from 'react';
import { renderSignInButton, signOut } from './gis';
import { useAuth } from './useAuth';

/** Google's own sign-in button (rendered by Google Identity Services). */
/** `brokerId`: the submission service this sign-in is for (default: the teacher's own). */
export function SignInButton({ brokerId }: { brokerId?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (ref.current) renderSignInButton(ref.current, ...(brokerId === undefined ? [] : [brokerId])).catch((e: Error) => setError(e.message));
  }, [brokerId]);
  return (
    <div className="signin">
      <div ref={ref} className="gsi-button" />
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}

export function AccountPanel({ purpose }: { purpose: string }) {
  const { profile } = useAuth();
  if (!profile)
    return (
      <div className="card account-panel">
        <h2>Sign in with Google</h2>
        <p>{purpose}</p>
        <SignInButton />
        <p className="field-hint">The app receives your Google account id and email address. It asks separately before using Google Drive, and then only for files it creates or that you choose.</p>
      </div>
    );
  return (
    <div className="card account-panel signed-in">
      <p>Signed in as <strong>{profile.email}</strong>{profile.hd ? ` (${profile.hd})` : ''}.</p>
      <button type="button" className="ghost" onClick={signOut}>Sign out</button>
    </div>
  );
}

/**
 * Shown when a teacher's service needs a fresh sign-in that Google could not
 * give silently (each service gets its own sign-in; see gis.ts).
 */
export function ServiceSignIn() {
  const { profile, needsSignInFor } = useAuth();
  if (!profile || !needsSignInFor) return null;
  return (
    <div className="card service-signin" role="region" aria-label="Confirm Google sign-in">
      <p>To send or load work, confirm your Google sign-in for this teacher’s submission service.</p>
      <SignInButton brokerId={needsSignInFor} />
    </div>
  );
}
