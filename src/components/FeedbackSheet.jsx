import { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { sendFeedback, readInbox, markHandled } from '../lib/feedback.js';
import { fmtDate } from '../lib/format.js';

const KIND_LABEL = { feedback: 'Feedback', idea: 'Idea', problem: 'Problem', delete: 'Deletion request' };

export function FeedbackSheet({ onClose }) {
  const { showToast } = useApp();
  const [kind, setKind] = useState('idea');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const started = useRef(Date.now());

  async function send(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await sendFeedback({ kind, message: message.trim(), startedAt: started.current });
      showToast('Thanks. Your message went through.');
      onClose();
    } catch (x) {
      setErr(x.message || String(x));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Send feedback" onClose={onClose}>
      <form className="stack" onSubmit={send}>
        <p className="small muted">It goes to the app's makers with your name and email from your sign-in, so we can reply.</p>
        <div className="seg" role="group" aria-label="What kind">
          {['idea', 'problem', 'feedback'].map((k) => (
            <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'feedback' ? 'Other' : KIND_LABEL[k]}</button>
          ))}
        </div>
        <label className="field"><span>Your message</span>
          <textarea className="input" rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={kind === 'problem' ? 'What happened, and what did you expect?' : 'Tell us what would make the app better'} />
        </label>
        {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
        <button type="submit" className="btn primary block" disabled={busy || message.trim().length < 5}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
    </Sheet>
  );
}

// Only the inbox owner sees this. Messages stay on the server until marked handled, and after.
export function InboxSheet({ onClose }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [showHandled, setShowHandled] = useState(false);
  const load = () => readInbox().then(setItems).catch((e) => setErr(e.message || String(e)));
  useEffect(() => { load(); }, []);

  async function toggle(m) {
    await markHandled(m.id, !!m.handledAt);
    load();
  }
  const list = (items || []).filter((m) => showHandled || !m.handledAt);
  const handledCount = (items || []).filter((m) => m.handledAt).length;

  return (
    <Sheet title="Feedback inbox" onClose={onClose}>
      {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
      {!items && !err && <p className="small muted">Loading…</p>}
      {items && list.length === 0 && <p className="empty">Nothing new.</p>}
      <div className="stack">
        {list.map((m) => (
          <article key={m.id} className={`card inbox-msg${m.handledAt ? ' handled' : ''}`}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className={`chip${m.kind === 'delete' ? ' warn' : ' blue'}`}>{KIND_LABEL[m.kind] || 'Feedback'}</span>
              <span className="small muted grow">{fmtDate(m.at, { withYear: true })}</span>
            </div>
            <p className="small" style={{ margin: '6px 0' }}><strong>{m.name || 'No name'}</strong> · {m.email || 'no email'}{m.signedIn ? '' : ' · not signed in'}</p>
            {m.message ? <p className="inbox-text">{m.message}</p> : <p className="small muted">No message.</p>}
            {m.kind === 'delete' && !m.handledAt && (
              <p className="small hint">Before deleting, reply to {m.email || 'them'} and wait for a yes from that address, since anyone can type an email here.</p>
            )}
            <button type="button" className="btn" onClick={() => toggle(m)}>{m.handledAt ? 'Mark not handled' : 'Mark handled'}</button>
          </article>
        ))}
      </div>
      {handledCount > 0 && (
        <button type="button" className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setShowHandled((s) => !s)}>
          {showHandled ? 'Hide handled' : `Show ${handledCount} handled`}
        </button>
      )}
    </Sheet>
  );
}
