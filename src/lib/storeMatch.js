// Turns Google Shopping results into one price per store.
// Shared by the server function (netlify/functions/prices.mjs) and the tests.

const STORE_PATTERNS = [
  ['samsclub', /sam'?s\s*club|samsclub/i],
  ['amazon', /amazon/i],
  ['walmart', /walmart/i],
  ['target', /^target\b|target\.com/i],
  ['costco', /costco/i],
];

export function storeIdFor(source = '') {
  const hit = STORE_PATTERNS.find(([, re]) => re.test(source));
  return hit ? hit[0] : null;
}

function priceOf(r) {
  if (typeof r.extracted_price === 'number') return r.extracted_price;
  const m = String(r.price || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

// Returns [{ storeId, storeName, price, title, url }]: the cheapest result at each
// preferred store, plus the cheapest result anywhere else as storeId 'any'.
export function pickQuotes(results = []) {
  const best = {};
  for (const r of results) {
    const price = priceOf(r);
    if (price == null || !(price > 0)) continue;
    const storeName = String(r.source || '').slice(0, 60);
    const storeId = storeIdFor(storeName) || 'any';
    const q = { storeId, storeName, price: Math.round(price * 100) / 100, title: String(r.title || '').slice(0, 140), url: safeUrl(r.product_link || r.link) };
    if (!best[storeId] || q.price < best[storeId].price) best[storeId] = q;
  }
  return Object.values(best);
}
