// Looks up today's prices for one item across stores, using SerpApi's Google Shopping search.
//
// Setup: create a free SerpApi account (250 searches a month) and add its key in Netlify as
// SERPAPI_KEY under Site configuration > Environment variables. Without the key this
// function answers { configured: false } and the app keeps its manual price checks.
// Searches run only when someone taps Look up prices, and stop when the free plan's
// searches for the month are used up. ?quota=1 returns how many are left.
//
// Only signed-in members of the app can call it: the request must carry a Firebase ID token,
// which is checked against Firebase before any search is spent.
//
// Limits: each household gets HOUSEHOLD_LIMIT lookups per plan month, counted here on the
// server (Netlify Blobs), not in the browser. The last RESERVE searches of the SerpApi plan
// are kept back for emergencies: once the plan is down to them, lookups stop for everyone
// except the Google accounts listed in the LOOKUP_RESERVE_EMAILS setting (comma-separated).
// Those accounts also skip the household limit. With that setting empty, nobody uses the reserve.
import { getStore } from '@netlify/blobs';
import { pickQuotes } from '../../src/lib/storeMatch.js';

const HOUSEHOLD_LIMIT = Number(process.env.LOOKUP_HOUSEHOLD_LIMIT) || 150;
const RESERVE = Number(process.env.LOOKUP_RESERVE) || 100;
const reserveEmails = () => (process.env.LOOKUP_RESERVE_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

// Returns { uid, email } for a valid Firebase sign-in, or null.
async function signedIn(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!token || !apiKey) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }),
  });
  if (!r.ok) return null;
  const u = (await r.json().catch(() => ({})))?.users?.[0];
  return u ? { uid: u.localId, email: (u.email || '').toLowerCase() } : null;
}

// One counter per household per plan month. The plan's renewal date names the month, so
// household counts reset when the SerpApi searches do.
const cycleOf = (quota) => (quota?.renews ? String(quota.renews).slice(0, 10) : new Date().toISOString().slice(0, 7));
const counterKey = (quota, accountId) => `${cycleOf(quota)}/${accountId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)}`;
async function readUsed(store, key) {
  try { return Number((await store.get(key, { type: 'json' }))?.used) || 0; } catch { return 0; }
}

// What this household (or a reserve holder) can still use, in the shape the app shows.
export function usage(quota, used, reserve) {
  const poolLeft = reserve ? quota.left : Math.max(0, quota.left - RESERVE);
  const left = reserve ? poolLeft : Math.min(Math.max(0, HOUSEHOLD_LIMIT - used), poolLeft);
  const paused = !reserve && poolLeft <= 0;
  return { left, used, total: HOUSEHOLD_LIMIT, renews: quota.renews, paused, reserve: reserve || undefined };
}

// How many searches the SerpApi plan has left. SerpApi's Account API is free and doesn't
// count toward the monthly searches.
async function quota(key) {
  for (const path of ['account.json', 'account']) {
    try {
      const r = await fetch(`https://serpapi.com/${path}?api_key=${encodeURIComponent(key)}`);
      if (!r.ok) continue;
      const a = await r.json();
      const left = Number(a.plan_searches_left ?? a.total_searches_left);
      const total = Number(a.searches_per_month);
      if (Number.isFinite(left)) return { left: Math.max(0, left), total: Number.isFinite(total) ? total : null, renews: a.plan_renewal_date || null };
    } catch { /* try the next path */ }
  }
  return null;
}

export default async (req) => {
  const key = process.env.SERPAPI_KEY;
  if (!key) return json({ configured: false, quotes: [] });
  const params = new URL(req.url).searchParams;
  const q = (params.get('q') || '').trim().slice(0, 120);
  const wantsQuota = params.get('quota') === '1';
  if (!q && !wantsQuota) return json({ error: 'Missing item name' }, 400);
  const user = await signedIn(req);
  if (!user) return json({ error: 'Sign in first' }, 401);
  const accountId = (params.get('account') || '').trim();
  if (!accountId) return json({ error: 'Missing household' }, 400);
  const reserve = reserveEmails().includes(user.email);

  const before = await quota(key);
  // Never search when the count can't be read, so the plan can't run over.
  if (!before) return json({ configured: true, quotes: [], error: "Couldn't check how many price lookups are left, so no search was made. Try again later." }, 503);
  const store = getStore({ name: 'price-lookups', consistency: 'strong' });
  const ckey = counterKey(before, accountId);
  const used = await readUsed(store, ckey);
  const now = usage(before, used, reserve);
  if (wantsQuota) return json({ configured: true, quota: now });
  if (before.left <= 0) return json({ configured: true, quotes: [], quota: now, error: 'No price lookups left this month.' }, 429);
  if (now.paused) return json({ configured: true, quotes: [], quota: now, error: 'Price lookups are paused for everyone until the monthly searches reset.' }, 429);
  if (now.left <= 0) return json({ configured: true, quotes: [], quota: now, error: `Your household has used its ${HOUSEHOLD_LIMIT} price lookups this month.` }, 429);

  const url = `https://serpapi.com/search.json?engine=google_shopping&gl=us&hl=en&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    // SerpApi explains problems such as a wrong key or a used-up plan in data.error.
    if (!r.ok || (data.error && !/hasn't returned any results/i.test(data.error))) {
      return json({ configured: true, quotes: [], quota: before, error: `Price search failed: ${String(data.error || r.status).slice(0, 160)}` }, 502);
    }
    const results = [...(data.shopping_results || []), ...(data.inline_shopping_results || [])];
    // Count the search against the household. Two lookups in the same instant could both
    // read the old count; at worst a household gets one extra, and the plan's own count
    // (checked above) still stops everyone at the reserve.
    await store.setJSON(ckey, { used: used + 1, at: Date.now() }).catch(() => {});
    const after = (await quota(key)) || { ...before, left: Math.max(0, before.left - 1) };
    return json({ configured: true, quotes: pickQuotes(results, q), quota: usage(after, used + 1, reserve) });
  } catch {
    return json({ configured: true, quotes: [], error: 'Price search failed' }, 502);
  }
};
