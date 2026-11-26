import { useEffect, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import { CreateAccount } from './AccountSheet.jsx';
import { LogoMark } from './Icons.jsx';
import { APP_NAME, DEMO_MODE, ROLES } from '../lib/config.js';

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function SignIn() {
  const { backend } = useApp();
  const [err, setErr] = useState('');
  return (
    <div className="signin">
      <div className="card stack">
        <LogoMark width="64" height="64" style={{ margin: '0 auto' }} />
        <h1>{APP_NAME}</h1>
        <p>Jot things down the moment you notice they're running low. Your household or team sees the same list, and trips get combined so you make fewer store runs.</p>
        <button type="button" className="gbtn" style={{ margin: '8px auto 0' }} onClick={() => backend.signIn().catch((e) => setErr(e?.message || 'Sign-in failed. Try again.'))}>
          <GoogleG /> {DEMO_MODE ? 'Try the demo' : 'Continue with Google'}
        </button>
        {DEMO_MODE && <p className="small muted">Demo mode: sample data stays on this device. Connect Firebase to sign in with Google and share lists.</p>}
        {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
      </div>
    </div>
  );
}

export function Onboarding() {
  const { backend, user, switchAccount, showToast } = useApp();
  const [invites, setInvites] = useState([]);
  useEffect(() => backend.subscribeMyInvites(user, setInvites), [user.uid]);

  async function accept(iv) {
    try {
      await backend.acceptInvite(iv, user);
      switchAccount(iv.accountId);
    } catch (e) {
      showToast(`Couldn't join: ${e?.message || e}`);
    }
  }

  return (
    <div className="signin">
      <div className="stack" style={{ maxWidth: 480, width: '100%' }}>
        <div className="card stack" style={{ textAlign: 'left' }}>
          <h1>Welcome, {user.name.split(' ')[0]}</h1>
          {invites.length > 0 ? (
            <>
              <p>You've been invited to join:</p>
              {invites.map((iv) => (
                <div key={iv.id} className="row">
                  <div className="grow"><strong>{iv.accountName}</strong><div className="small muted">as {ROLES[iv.role]?.label}, from {iv.invitedBy}</div></div>
                  <button type="button" className="btn primary" onClick={() => accept(iv)}>Join</button>
                </div>
              ))}
              <p className="small muted">Or start your own list below.</p>
            </>
          ) : (
            <p>Start a list for your home or your organization. If someone invited you, ask them to use <strong>{user.email}</strong>, and the invite will appear here.</p>
          )}
        </div>
        <CreateAccount onDone={(id) => switchAccount(id)} />
        <button type="button" className="btn ghost" onClick={() => backend.signOut()}>Use a different Google account</button>
      </div>
    </div>
  );
}
