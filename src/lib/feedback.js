// Sends feedback to the app's private inbox (netlify/functions/feedback.mjs) and reads it back
// for the inbox owner. The demo keeps everything on this device.
import backend from '../data/backend.js';
import { DEMO_MODE } from './config.js';

const URL_ = '/.netlify/functions/feedback';
const demo = [];

async function call(method, body) {
  const token = await backend.idToken?.();
  const r = await fetch(method === 'GET' ? `${URL_}${body || ''}` : URL_, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

export async function sendFeedback(entry) {
  if (DEMO_MODE) {
    demo.unshift({ id: `d${Date.now()}`, ...entry, email: 'demo@example.com', name: 'Demo user', signedIn: true, at: Date.now(), handledAt: null });
    return;
  }
  const { r, data } = await call('POST', { ...entry, page: 'app' });
  if (!r.ok || data.error) throw new Error(data.error || `It didn't send (${r.status}). Try again.`);
}

// { admin, open } for the signed-in person. Anyone who isn't the inbox owner gets admin: false.
export async function inboxStatus() {
  if (DEMO_MODE) return { admin: true, open: demo.filter((m) => !m.handledAt).length };
  try {
    const { r, data } = await call('GET', '?check=1');
    return r.ok ? data : { admin: false };
  } catch { return { admin: false }; }
}

export async function readInbox() {
  if (DEMO_MODE) return demo.map((m) => ({ ...m }));
  const { r, data } = await call('GET', '');
  if (!r.ok) throw new Error(data.error || `Couldn't open the inbox (${r.status}).`);
  return data.items || [];
}

export async function markHandled(id, undo = false) {
  if (DEMO_MODE) { const m = demo.find((x) => x.id === id); if (m) m.handledAt = undo ? null : Date.now(); return; }
  const { r, data } = await call('POST', { action: 'handled', id, undo });
  if (!r.ok) throw new Error(data.error || 'Could not update it.');
}
