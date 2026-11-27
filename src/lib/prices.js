// Price checks by store.
//
// Retailers don't let a browser app read their prices directly, and Sam's Club has no
// public price feed. So prices come from two places:
// 1. Automatic: when an item is added, a provider looks it up. With Firebase, that's the
//    server function netlify/functions/prices.mjs (Google Shopping through SerpApi).
//    In the demo, a sample provider makes up clearly labeled prices.
// 2. By hand: a search link per store, and the person types the price they see.

// Preferred order. Stores after the first three are extras, not a limit.
export const PRICE_STORES = [
  { id: 'samsclub', name: "Sam's Club", url: (q) => `https://www.samsclub.com/search?q=${q}` },
  { id: 'amazon', name: 'Amazon', url: (q) => `https://www.amazon.com/s?k=${q}` },
  { id: 'walmart', name: 'Walmart', url: (q) => `https://www.walmart.com/search?q=${q}` },
  { id: 'target', name: 'Target', url: (q) => `https://www.target.com/s?searchTerm=${q}` },
  { id: 'costco', name: 'Costco', url: (q) => `https://www.costco.com/CatalogSearch?keyword=${q}` },
  { id: 'any', name: 'All stores', url: (q) => `https://www.google.com/search?udm=28&q=${q}` },
];

export function searchQuery(item) {
  const parts = [item.name, item.note].filter(Boolean).join(' ').trim();
  return encodeURIComponent(parts).replace(/%20/g, '+');
}

export function storeLinks(item) {
  const q = searchQuery(item);
  return PRICE_STORES.map((s) => ({ ...s, href: s.url(q) }));
}

// Seen prices live on the item as seenPrices: { [storeId]: { price, at, by } }.
// Returns them in preferred-store order, cheapest flagged.
export function seenPrices(item, now = Date.now(), maxAgeDays = 30) {
  const seen = item.seenPrices || {};
  const rows = PRICE_STORES.filter((s) => seen[s.id]?.price != null).map((s) => ({
    store: seen[s.id].storeName || s.name, storeId: s.id, price: Number(seen[s.id].price), at: seen[s.id].at,
    by: seen[s.id].by || '', url: seen[s.id].url || null,
    stale: now - (seen[s.id].at || 0) > maxAgeDays * 86400e3,
  }));
  const fresh = rows.filter((r) => !r.stale);
  const best = (fresh.length ? fresh : rows).reduce((m, r) => (m == null || r.price < m.price ? r : m), null);
  return { rows, best };
}

// Provider registry. A provider is { id, by, quote(item) => Promise<[{ storeId, storeName, price, title, url }]> }.
// by is how the price is labeled: 'auto' for a real lookup, 'sample' for the demo's made-up ones.
const providers = [];
export function registerPriceProvider(p) { providers.push(p); }
export const hasPriceProvider = () => providers.length > 0;
export async function fetchQuotes(item) {
  const out = [];
  for (const p of providers) {
    try {
      for (const q of (await p.quote(item)) || []) out.push({ ...q, by: p.by || 'auto' });
    } catch { /* a provider failing never breaks the list */ }
  }
  return out;
}

// Merges looked-up quotes into an item's seenPrices. A price a person typed in the last
// day wins over a lookup, because they saw it themselves.
export function mergeQuotes(seen = {}, quotes = [], now = Date.now()) {
  const out = { ...seen };
  for (const q of quotes) {
    if (!PRICE_STORES.some((s) => s.id === q.storeId)) continue;
    const cur = out[q.storeId];
    const typedRecently = cur && cur.by && cur.by !== 'auto' && cur.by !== 'sample' && now - (cur.at || 0) < 86400e3;
    if (typedRecently) continue;
    out[q.storeId] = { price: q.price, at: now, by: q.by || 'auto', ...(q.storeName ? { storeName: q.storeName } : {}), ...(q.title ? { title: q.title } : {}), ...(q.url ? { url: q.url } : {}) };
  }
  return out;
}

// The demo's provider: steady made-up prices per item, always labeled as samples.
export const samplePriceProvider = {
  id: 'sample', by: 'sample',
  async quote(item) {
    const seed = [...(item.name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const base = Number(item.lastPrice) > 0 ? Number(item.lastPrice) : 3 + (seed % 1700) / 100;
    const jig = (k) => Math.round(base * (0.88 + ((seed >> k) % 25) / 100) * 100) / 100;
    await new Promise((r) => setTimeout(r, 600));
    return [
      { storeId: 'samsclub', storeName: "Sam's Club", price: jig(1) },
      { storeId: 'amazon', storeName: 'Amazon', price: jig(4) },
      { storeId: 'walmart', storeName: 'Walmart', price: jig(7) },
      { storeId: 'any', storeName: 'Kroger', price: jig(10) },
    ];
  },
};

// The live provider: asks the app's own server function, which holds the search key.
export function serverPriceProvider(getToken) {
  return {
    id: 'server', by: 'auto',
    async quote(item) {
      const token = await getToken();
      if (!token) return [];
      const q = [item.name, item.note].filter(Boolean).join(' ').trim();
      const r = await fetch(`/.netlify/functions/prices?q=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) return [];
      const data = await r.json();
      return data.configured ? data.quotes || [] : [];
    },
  };
}
