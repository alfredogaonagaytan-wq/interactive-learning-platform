import { useEffect, useRef, useState } from 'react';
import { renderSignInButton, signOut } from './gis';
import { useAuth } from './useAuth';

/** Google's own sign-in button (rendered by Google Identity Services). */
export function SignInButton() {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (ref.current) renderSignInButton(ref.current).catch((e: Error) => setError(e.message));
  }, []);
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
