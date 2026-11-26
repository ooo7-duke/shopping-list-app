// Price checks by store.
//
// Retailers don't let a browser app read their prices directly: their sites block
// automated reads, Amazon's and Walmart's price feeds need approved developer accounts,
// and Sam's Club has no public feed. So the default provider builds a search link per
// store, and the person records the price they see. A paid lookup service can be added
// later by registering a provider with a quote() function (see registerPriceProvider).

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
    store: s.name, storeId: s.id, price: Number(seen[s.id].price), at: seen[s.id].at,
    stale: now - (seen[s.id].at || 0) > maxAgeDays * 86400e3,
  }));
  const fresh = rows.filter((r) => !r.stale);
  const best = (fresh.length ? fresh : rows).reduce((m, r) => (m == null || r.price < m.price ? r : m), null);
  return { rows, best };
}

// Provider registry. A provider is { id, quote(item) => Promise<[{ storeId, price, url }]> }.
// The link provider returns no prices, only links, so the app never shows a guessed price.
const providers = [];
export function registerPriceProvider(p) { providers.push(p); }
export async function fetchQuotes(item) {
  const out = [];
  for (const p of providers) {
    try { out.push(...((await p.quote(item)) || [])); } catch { /* a provider failing never breaks the list */ }
  }
  return out;
}
