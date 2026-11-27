// Looks up today's prices for one item across stores, using SerpApi's Google Shopping search.
//
// Setup: create a free SerpApi account (250 searches a month) and add its key in Netlify as
// SERPAPI_KEY under Site configuration > Environment variables. Without the key this
// function answers { configured: false } and the app keeps its manual price checks.
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

export default async (req) => {
  const key = process.env.SERPAPI_KEY;
  if (!key) return json({ configured: false, quotes: [] });
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 120);
  if (!q) return json({ error: 'Missing item name' }, 400);
  if (!(await signedIn(req))) return json({ error: 'Sign in first' }, 401);

  const url = `https://serpapi.com/search.json?engine=google_shopping&gl=us&hl=en&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return json({ configured: true, quotes: [], error: `Price search failed (${r.status})` }, 502);
    const data = await r.json();
    const results = [...(data.shopping_results || []), ...(data.inline_shopping_results || [])];
    return json({ configured: true, quotes: pickQuotes(results, q) });
  } catch {
    return json({ configured: true, quotes: [], error: 'Price search failed' }, 502);
  }
};
