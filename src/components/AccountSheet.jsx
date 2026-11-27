import { useEffect, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { ROLES, can, DEMO_MODE, APP_NAME } from '../lib/config.js';
import { initials } from '../lib/format.js';
import { HOUSEHOLD_CATEGORIES, ORG_CATEGORIES } from '../lib/categories.js';

export default function AccountSheet({ onClose }) {
  const { backend, user, accounts, account, role, switchAccount, showToast } = useApp();
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [creating, setCreating] = useState(false);
  const owner = can(role, 'members');

  useEffect(() => (account && owner ? backend.subscribeAccountInvites(account.id, setInvites) : undefined), [account?.id, owner]);

  async function invite(e) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { showToast('Enter a full email address.'); return; }
    await backend.createInvite(account, em, inviteRole, user);
    setEmail('');
    const link = location.origin;
    const msg = `I added you to "${account.name}" on our shopping list. Open ${link} and sign in with Google as ${em}.`;
    try {
      if (navigator.share) await navigator.share({ title: APP_NAME, text: msg });
      else { await navigator.clipboard.writeText(msg); showToast('Invite saved. A message with the link is copied, ready to text them.'); }
    } catch { showToast('Invite saved. They join by signing in with that Google account.'); }
  }

  const members = Object.entries(account?.members || {});
  const lookahead = account?.settings?.lookaheadDays ?? 10;

  return (
    <Sheet title="Accounts and people" onClose={onClose}>
      <div className="stack">
        <div className="row">
          <div className="avatar" style={{ width: 44, height: 44 }}>{user.photo ? <img src={user.photo} alt="" referrerPolicy="no-referrer" /> : initials(user.name)}</div>
          <div className="grow"><strong>{user.name}</strong><div className="small muted ellipsis">{user.email}</div></div>
          <button type="button" className="btn" onClick={() => { backend.signOut(); onClose(); }}>Sign out</button>
        </div>

        {accounts.length > 1 && (
          <label className="field"><span>Switch list</span>
            <select className="input" value={account.id} onChange={(e) => { switchAccount(e.target.value); onClose(); }}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === 'household' ? 'household' : 'organization'})</option>)}
            </select>
          </label>
        )}

        <div className="card" style={{ background: '#fff' }}>
          <h3 style={{ marginBottom: 8 }}>{account.name} · people</h3>
          {members.map(([uid, m]) => (
            <div key={uid} className="row" style={{ minHeight: 48 }}>
              <div className="avatar">{initials(m.name)}</div>
              <div className="grow"><div className="ellipsis">{m.name}{uid === user.uid ? ' (you)' : ''}</div><div className="small muted ellipsis">{m.email}</div></div>
              {owner && uid !== user.uid ? (
                <>
                  <select className="input" style={{ width: 'auto' }} value={m.role} onChange={(e) => backend.updateAccount(account.id, { [`members.${uid}`]: { ...m, role: e.target.value } })} aria-label={`Role for ${m.name}`}>
                    {Object.entries(ROLES).filter(([k, r]) => !r.legacy || k === m.role).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                  </select>
                  <button type="button" className="chip" onClick={() => backend.removeMember(account, uid)}>Remove</button>
                </>
              ) : <span className="chip">{ROLES[m.role]?.label}</span>}
            </div>
          ))}
          {invites.map((iv) => (
            <div key={iv.id} className="row small" style={{ minHeight: 40 }}>
              <span className="grow ellipsis muted">Invited: {iv.email} as {ROLES[iv.role]?.label}</span>
              <button type="button" className="chip" onClick={() => backend.cancelInvite(iv.id)}>Cancel</button>
            </div>
          ))}
          {owner && (
            <form onSubmit={invite} className="stack" style={{ marginTop: 10 }}>
              <div className="grid2">
                <label className="field"><span>Invite by Google email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" /></label>
                <label className="field"><span>Role</span>
                  <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    <option value="editor">Editor: edits the list and sees spending</option>
                    <option value="owner">Owner: also manages people</option>
                  </select>
                </label>
              </div>
              <button type="submit" className="btn primary">Send invite</button>
            </form>
          )}
        </div>

        {can(role, 'edit') && (
          <label className="field"><span>Suggest items due within</span>
            <select className="input" value={lookahead} onChange={(e) => backend.updateAccount(account.id, { 'settings.lookaheadDays': Number(e.target.value) })}>
              {[3, 5, 7, 10, 14, 21, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
        )}

        {creating ? <CreateAccount onDone={(id) => { switchAccount(id); setCreating(false); onClose(); }} /> : (
          <button type="button" className="btn block" onClick={() => setCreating(true)}>Start another list (household or organization)</button>
        )}
        {DEMO_MODE && backend.resetDemo && <button type="button" className="btn ghost block" onClick={() => { backend.resetDemo(); onClose(); }}>Reset demo data</button>}

        <DeleteAccount onClose={onClose} />
      </div>
    </Sheet>
  );
}

export function CreateAccount({ onDone }) {
  const { backend, user } = useApp();
  const [type, setType] = useState('household');
  const [name, setName] = useState('');
  async function create(e) {
    e.preventDefault();
    const id = await backend.createAccount({
      name: name.trim() || (type === 'household' ? `${user.name.split(' ').slice(-1)[0]} household` : 'Office supplies'),
      type, categories: type === 'household' ? HOUSEHOLD_CATEGORIES : ORG_CATEGORIES,
    }, user);
    onDone?.(id);
  }
  return (
    <form className="card stack" style={{ background: '#fff' }} onSubmit={create}>
      <h3>New list</h3>
      <div className="seg" role="group" aria-label="List type">
        <button type="button" aria-pressed={type === 'household'} onClick={() => setType('household')}>Household</button>
        <button type="button" aria-pressed={type === 'organization'} onClick={() => setType('organization')}>Organization</button>
      </div>
      <p className="small muted">{type === 'household' ? 'Everyone you invite can edit the list and see spending.' : 'Everyone you invite can add to the list directly, mark items bought and see spending. Only owners manage people.'}</p>
      <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'household' ? 'Our household' : 'Main office'} /></label>
      <button type="submit" className="btn primary">Create list</button>
    </form>
  );
}

// Store rules (Google Play and Apple) require a way to delete your account from inside the app.
function DeleteAccount({ onClose }) {
  const { backend, user, accounts, showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const plan = (accounts || []).map((a) => {
    const others = a.memberUids.filter((u) => u !== user.uid);
    if (!others.length) return { id: a.id, text: `${a.name}: deleted, with all its items, purchases, receipts and photos.` };
    const next = a.members?.[others[0]]?.name || 'another member';
    const passOn = a.members?.[user.uid]?.role === 'owner' && !others.some((u) => a.members?.[u]?.role === 'owner');
    return { id: a.id, text: `${a.name}: you leave it and the others keep it${passOn ? `. ${next} becomes its owner` : ''}.` };
  });

  async function confirm() {
    setBusy(true); setErr('');
    try {
      await backend.deleteMyAccount(user, accounts || []);
      onClose();
      showToast('Your account and data are deleted.');
    } catch (e) {
      setErr(`Couldn't finish: ${e?.message || e}. Nothing more was deleted. Try again, or use the request form on the privacy page.`);
      setBusy(false);
    }
  }

  return (
    <div className="card stack account-privacy" style={{ background: '#fff' }}>
      <h3>Privacy and your data</h3>
      <a className="link" href="/privacy/" target="_blank" rel="noopener">Privacy policy</a>
      {!open ? (
        <button type="button" className="btn danger block" onClick={() => setOpen(true)}>Delete my account</button>
      ) : (
        <div className="stack">
          <p className="small">This can't be undone. Here is what happens:</p>
          <ul className="small delete-plan">
            {plan.map((p) => <li key={p.id}>{p.text}</li>)}
            <li>Invites you sent or received are deleted.</li>
            <li>Your sign-in is removed. Google may ask you to confirm it's you.</li>
          </ul>
          {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
          <div className="grid2">
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>Keep my account</button>
            <button type="button" className="btn danger" onClick={confirm} disabled={busy}>{busy ? 'Deleting…' : 'Delete everything'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
