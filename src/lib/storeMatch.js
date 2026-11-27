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

// Knock-offs undercut the real thing, so they'd always win "cheapest". Skip them unless
// the item's own name asks for one.
const KNOCKOFF = /\b(compatible|remanufactured|refurbished|replacement for|refill|generic|for use with|used)\b/i;

// Words with a digit in them, like "240XL" or "12oz", identify the exact product.
// A result has to contain every one of them.
function modelTokens(query = '') {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => /\d/.test(t) && t.length >= 2);
}

export function fitsQuery(title = '', query = '') {
  const t = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (KNOCKOFF.test(title) && !KNOCKOFF.test(query)) return false;
  return modelTokens(query).every((tok) => t.includes(tok) || t.replace(/ /g, '').includes(tok));
}

// Returns [{ storeId, storeName, price, title, url }]: the cheapest matching result at each
// preferred store, plus the cheapest matching result anywhere else as storeId 'any'.
export function pickQuotes(results = [], query = '') {
  const best = {};
  for (const r of results) {
    if (!fitsQuery(String(r.title || ''), query)) continue;
    const price = priceOf(r);
    if (price == null || !(price > 0)) continue;
    const storeName = String(r.source || '').slice(0, 60);
    const storeId = storeIdFor(storeName) || 'any';
    const q = { storeId, storeName, price: Math.round(price * 100) / 100, title: String(r.title || '').slice(0, 140), url: safeUrl(r.product_link || r.link) };
    if (!best[storeId] || q.price < best[storeId].price) best[storeId] = q;
  }
  return Object.values(best);
}
