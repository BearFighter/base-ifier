/** Optional account sign-in (paid features). The app never requires it. */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuthStore } from '@/app/auth';
import { useAppStore } from '@/state/project';
import { DISCORD_URL } from '@/app/config';
import { openExternal } from '@/app/desktop';

export function SignInDialog() {
  const open = useAppStore((s) => s.view.showSignIn);
  const setView = useAppStore((s) => s.setView);
  const auth = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  if (!open) return null;
  const close = () => setView({ showSignIn: false });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await auth.signIn(email.trim(), password);
    if (ok) {
      setPassword('');
      close();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={(e) => e.stopPropagation()}>
        {auth.status === 'signed-in' ? (
          <>
            <h3 id="signin-title">Your account</h3>
            <p>
              Signed in as <strong>{auth.user?.email}</strong>
              {auth.user?.plan ? ` (${auth.user.plan})` : ''}.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={close} autoFocus>Close</button>
              <button type="button" className="danger" onClick={() => { auth.signOut(); close(); }}>Sign out</button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <h3 id="signin-title">Sign in</h3>
            <p className="muted">Only needed for paid features. Everything else works without an account.</p>
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {auth.error && <p className="error" role="alert">{auth.error}</p>}
            <p className="muted">
              No account yet? Ask on the{' '}
              <a href={DISCORD_URL} onClick={(e) => { e.preventDefault(); openExternal(DISCORD_URL); }}>Discord</a>.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={close}>Cancel</button>
              <button type="submit" className="primary" disabled={auth.status === 'signing-in'}>
                {auth.status === 'signing-in' ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
