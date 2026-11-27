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
import { pickQuotes } from '../../src/lib/storeMatch.js';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

async function signedIn(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!token || !apiKey) return false;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }),
  });
  return r.ok;
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
  if (!(await signedIn(req))) return json({ error: 'Sign in first' }, 401);

  const before = await quota(key);
  if (wantsQuota) return json({ configured: true, quota: before });
  // Never search once the free searches are used up, so the plan can't run over.
  if (!before) return json({ configured: true, quotes: [], error: "Couldn't check how many free price checks are left, so no search was made. Try again later." }, 503);
  if (before.left <= 0) return json({ configured: true, quotes: [], quota: before, error: 'No free price checks left this month.' }, 429);

  const url = `https://serpapi.com/search.json?engine=google_shopping&gl=us&hl=en&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    // SerpApi explains problems such as a wrong key or a used-up plan in data.error.
    if (!r.ok || (data.error && !/hasn't returned any results/i.test(data.error))) {
      return json({ configured: true, quotes: [], quota: before, error: `Price search failed: ${String(data.error || r.status).slice(0, 160)}` }, 502);
    }
    const results = [...(data.shopping_results || []), ...(data.inline_shopping_results || [])];
    const after = (await quota(key)) || { ...before, left: Math.max(0, before.left - 1) };
    return json({ configured: true, quotes: pickQuotes(results, q), quota: after });
  } catch {
    return json({ configured: true, quotes: [], error: 'Price search failed' }, 502);
  }
};
