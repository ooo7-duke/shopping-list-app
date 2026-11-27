// Holds receipts forwarded to the app's Gmail inbox until the right person's app picks them up.
//
// POST (from the Google Apps Script in docs/apps-script/receipts-forwarder.gs, which runs in
//   loye10shopping@gmail.com): { messages: [{ id, from, forwardedFor, subject, date, text, pdfs }] }
//   with the header x-inbox-secret. The secret lives only in the script's properties and in the
//   Netlify setting RECEIPTS_INBOX_SECRET. Each message is filed under its forwarder's address.
// GET (from the app, signed in): the waiting receipts for the signed-in Google address only.
// DELETE ?id= (from the app, signed in): the app saved or dismissed that receipt. A marker is
//   kept so the same email is never handed over twice.
//
// Mail from an address that never signs in is never shown to anyone and is removed after
// KEEP_DAYS. The server can't write to the household's list; the app does that itself.
import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';
import { signedIn } from '../lib/auth.mjs';
import { forwarderOf, isForwardingConfirmation, keyPart } from '../../src/lib/inbox.js';

const KEEP_DAYS = 30;
const MAX_TEXT = 60_000;
const MAX_PDF = 2_000_000; // base64 characters
const MAX_PER_PERSON = 100;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function secretOk(req) {
  const want = process.env.RECEIPTS_INBOX_SECRET || '';
  const got = req.headers.get('x-inbox-secret') || '';
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function prune(store) {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const { blobs } = await store.list({ prefix: 'pending/' });
  for (const b of blobs) {
    const m = await store.get(b.key, { type: 'json' }).catch(() => null);
    if (!m || (m.receivedAt || 0) < cutoff) await store.delete(b.key);
  }
}

export default async (req) => {
  const store = getStore({ name: 'receipts-inbox', consistency: 'strong' });

  if (req.method === 'POST') {
    if (!secretOk(req)) return json({ error: 'Not allowed' }, 403);
    const body = await req.json().catch(() => ({}));
    const msgs = Array.isArray(body.messages) ? body.messages.slice(0, 50) : [];
    let filed = 0;
    let skipped = 0;
    for (const m of msgs) {
      const id = keyPart(m.id);
      const who = forwarderOf(m.from, m.forwardedFor);
      if (!id || !who || isForwardingConfirmation(m.from)) { skipped++; continue; }
      if (await store.get(`done/${id}`)) { skipped++; continue; }
      const { blobs } = await store.list({ prefix: `pending/${keyPart(who)}/` });
      if (blobs.length >= MAX_PER_PERSON) { skipped++; continue; }
      const pdfs = (Array.isArray(m.pdfs) ? m.pdfs : []).filter((p) => p && typeof p.data === 'string' && p.data.length <= MAX_PDF).slice(0, 2)
        .map((p) => ({ name: String(p.name || 'receipt.pdf').slice(0, 120), data: p.data }));
      await store.setJSON(`pending/${keyPart(who)}/${id}`, {
        id, forwarder: who, from: String(m.from || '').slice(0, 200), subject: String(m.subject || '').slice(0, 300),
        date: Number(m.date) || null, text: String(m.text || '').slice(0, MAX_TEXT), pdfs, receivedAt: Date.now(),
      });
      filed++;
    }
    await prune(store).catch(() => {});
    return json({ ok: true, filed, skipped });
  }

  const user = await signedIn(req).catch(() => null);
  if (!user?.email) return json({ error: 'Sign in first' }, 401);
  const mine = `pending/${keyPart(user.email)}/`;

  if (req.method === 'GET') {
    const { blobs } = await store.list({ prefix: mine });
    const items = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' }).catch(() => null)))).filter(Boolean)
      .sort((a, b) => (a.date || a.receivedAt) - (b.date || b.receivedAt));
    return json({ configured: !!process.env.RECEIPTS_INBOX_SECRET, email: user.email, items });
  }

  if (req.method === 'DELETE') {
    const id = keyPart(new URL(req.url).searchParams.get('id'));
    if (!id) return json({ error: 'Which receipt?' }, 400);
    // Only this person's own waiting receipts can be marked done.
    if (!(await store.get(`${mine}${id}`))) return json({ ok: true });
    await store.setJSON(`done/${id}`, { at: Date.now() });
    await store.delete(`${mine}${id}`);
    return json({ ok: true });
  }

  return json({ error: 'Not allowed' }, 405);
};
