// Fetches receipts forwarded to the app's inbox (netlify/functions/receipts-inbox.mjs) for the
// signed-in person, and tells the server once each one is saved or dismissed.
// The demo has no inbox, so it shows no emails.
import backend from '../data/backend.js';
import { DEMO_MODE } from './config.js';

const URL_ = '/.netlify/functions/receipts-inbox';
export async function fetchInbox() {
  // The demo has no real inbox. The layout check page may leave sample emails on this device.
  if (DEMO_MODE) return { configured: true, email: 'demo@example.com', items: demoInbox() };
  const token = await backend.idToken?.();
  if (!token) return { configured: false, items: [] };
  const r = await fetch(URL_, { headers: { authorization: `Bearer ${token}` } });
  if (r.status === 404) return { configured: false, missing: true, items: [] }; // function not deployed here yet
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Couldn't check for emailed receipts (${r.status}).`);
  return data;
}

const DEMO_INBOX = 'sla-demo-inbox';
function demoInbox() {
  try { return JSON.parse(localStorage.getItem(DEMO_INBOX) || '[]'); } catch { return []; }
}

export async function ackInbox(id) {
  if (DEMO_MODE) {
    try { localStorage.setItem(DEMO_INBOX, JSON.stringify(demoInbox().filter((m) => m.id !== id))); } catch { /* blocked */ }
    return;
  }
  const token = await backend.idToken?.();
  await fetch(`${URL_}?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
}

// What each email was read as, kept on this device so an email waiting for a check isn't
// sent to the AI again every time the page opens.
const CACHE = 'sla-email-reads';
export function cachedRead(id) {
  try { return JSON.parse(localStorage.getItem(CACHE) || '{}')[id] || null; } catch { return null; }
}
export function cacheRead(id, res) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || '{}');
    all[id] = res;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete all[k];
    localStorage.setItem(CACHE, JSON.stringify(all));
  } catch { /* storage full or blocked */ }
}
export function dropRead(id) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || '{}');
    delete all[id];
    localStorage.setItem(CACHE, JSON.stringify(all));
  } catch { /* storage blocked */ }
}
