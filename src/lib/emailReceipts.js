// Fetches receipts forwarded to the app's inbox (netlify/functions/receipts-inbox.mjs) for the
// signed-in person, and tells the server once each one is saved or dismissed.
// The demo keeps three sample emails on this device.
import backend from '../data/backend.js';
import { DEMO_MODE } from './config.js';

const URL_ = '/.netlify/functions/receipts-inbox';
const DEMO_DONE = 'sla-demo-inbox-done';
const day = 864e5;

function demoDone() {
  try { return JSON.parse(localStorage.getItem(DEMO_DONE) || '[]'); } catch { return []; }
}

function demoInbox() {
  const done = demoDone();
  const now = Date.now();
  return [
    { id: 'demo-target', from: 'Demo user <demo@example.com>', subject: 'Fwd: Your Target order #102-4471', date: now - day, text: '(sample order email)', pdfs: [] },
    { id: 'demo-amazon', from: 'Amazon.com <auto-confirm@amazon.com>', subject: 'Your Amazon.com order of "Post-it Super Sticky Notes..."', date: now - 2 * day, text: '(sample order email)', pdfs: [] },
    { id: 'demo-delivered', from: 'Amazon.com <shipment-tracking@amazon.com>', subject: 'Delivered: Your Amazon.com order', date: now - 3600e3, text: '(sample delivery notice)', pdfs: [] },
  ].filter((m) => !done.includes(m.id));
}

export async function fetchInbox() {
  if (DEMO_MODE) return { configured: true, email: 'demo@example.com', items: demoInbox() };
  const token = await backend.idToken?.();
  if (!token) return { configured: false, items: [] };
  const r = await fetch(URL_, { headers: { authorization: `Bearer ${token}` } });
  if (r.status === 404) return { configured: false, missing: true, items: [] }; // function not deployed here yet
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Couldn't check for emailed receipts (${r.status}).`);
  return data;
}

export async function ackInbox(id) {
  if (DEMO_MODE) {
    try { localStorage.setItem(DEMO_DONE, JSON.stringify([...new Set([...demoDone(), id])])); } catch { /* private window */ }
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
