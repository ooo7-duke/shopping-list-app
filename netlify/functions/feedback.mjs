// Feedback and account deletion requests, kept in Netlify Blobs so no email address has to be
// published. Spam checks: a hidden honeypot box, a minimum time to fill in the form, a cap on
// links, and rate limits per IP address (people not signed in) or per account (signed in).
// Signed-in members of the app skip the timing check, since their sign-in already proves them.
//
// Only the Google accounts in FEEDBACK_ADMIN_EMAILS (or, if that is empty, LOOKUP_RESERVE_EMAILS)
// can read the inbox: GET lists submissions, POST { action: 'handled', id } marks one handled.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { signedIn } from '../lib/auth.mjs';
import { checkSubmission } from '../../src/lib/feedbackCheck.js';

const PER_IP_PER_DAY = 5;
const PER_USER_PER_DAY = 20;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const admins = () => (process.env.FEEDBACK_ADMIN_EMAILS || process.env.LOOKUP_RESERVE_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const isAdmin = (user) => !!user?.email && admins().includes(user.email);
// IP addresses are kept only as a one-way hash, and only to count submissions per day.
const hashIp = (ip) => createHash('sha256').update(`${ip}|${process.env.VITE_FIREBASE_PROJECT_ID || 'sla'}`).digest('hex').slice(0, 24);

async function underLimit(store, key, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const k = `limits/${day}/${key}`;
  let n = 0;
  try { n = Number((await store.get(k, { type: 'json' }))?.n) || 0; } catch { n = 0; }
  if (n >= limit) return false;
  await store.setJSON(k, { n: n + 1 });
  return true;
}

export default async (req, context) => {
  const store = getStore({ name: 'feedback', consistency: 'strong' });
  const user = await signedIn(req).catch(() => null);

  if (req.method === 'GET') {
    if (!user) return json({ error: 'Sign in first' }, 401);
    if (!isAdmin(user)) return json({ admin: false }, 403);
    if (new URL(req.url).searchParams.get('check') === '1') {
      const { blobs } = await store.list({ prefix: 'msg/' });
      let open = 0;
      for (const b of blobs) { const m = await store.get(b.key, { type: 'json' }); if (m && !m.handledAt) open++; }
      return json({ admin: true, open });
    }
    const { blobs } = await store.list({ prefix: 'msg/' });
    const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 200);
    const items = (await Promise.all(keys.map((k) => store.get(k, { type: 'json' }).catch(() => null)))).filter(Boolean);
    return json({ admin: true, items });
  }

  if (req.method !== 'POST') return json({ error: 'Not allowed' }, 405);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'handled') {
    if (!isAdmin(user)) return json({ error: 'Not allowed' }, 403);
    const key = `msg/${String(body.id || '').replace(/[^A-Za-z0-9_-]/g, '')}`;
    const m = await store.get(key, { type: 'json' });
    if (!m) return json({ error: 'Not found' }, 404);
    await store.setJSON(key, { ...m, handledAt: body.undo ? null : Date.now() });
    return json({ ok: true });
  }

  const res = checkSubmission(body, { signedIn: !!user });
  if (res.drop) return json({ ok: true });
  if (res.error) return json({ error: res.error }, 400);
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || '';
  const allowed = user
    ? await underLimit(store, `u-${user.uid}`, PER_USER_PER_DAY)
    : await underLimit(store, `ip-${hashIp(ip)}`, PER_IP_PER_DAY);
  if (!allowed) return json({ error: 'Too many messages today. Please try again tomorrow.' }, 429);

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const c = res.clean;
  await store.setJSON(`msg/${id}`, {
    id, kind: c.kind, message: c.message,
    email: user?.email || c.email, name: user?.name || c.name, uid: user?.uid || null,
    signedIn: !!user, page: String(body.page || '').slice(0, 40), at: Date.now(), handledAt: null,
  });
  return json({ ok: true });
};
