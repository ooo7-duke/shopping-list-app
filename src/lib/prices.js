// Price checks by store.
//
// Retailers don't let a browser app read their prices directly, and Sam's Club has no
// public price feed. So prices come from two places:
// 1. Automatic: when an item is added, a provider looks it up. With Firebase, that's the
//    server function netlify/functions/prices.mjs (Google Shopping through SerpApi).
//    The demo has no provider: it never makes up a price.
// 2. By hand: a search link per store, and the person types the price they see.

import { isBlockedSeller, isKnownRetailer } from './storeMatch.js';

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
  // Prices the old demo made up (by 'sample') are ignored.
  const rows = PRICE_STORES.filter((s) => seen[s.id]?.price != null && seen[s.id].by !== 'sample' && !isBlockedSeller(seen[s.id].storeName, seen[s.id].url) && (s.id !== 'any' || isKnownRetailer(seen[s.id].storeName))).map((s) => ({
    store: seen[s.id].storeName || s.name, storeId: s.id, price: Number(seen[s.id].price), at: seen[s.id].at,
    by: seen[s.id].by || '', url: seen[s.id].url || null,
    stale: now - (seen[s.id].at || 0) > maxAgeDays * 86400e3,
  }));
  const fresh = rows.filter((r) => !r.stale);
  const best = (fresh.length ? fresh : rows).reduce((m, r) => (m == null || r.price < m.price ? r : m), null);
  return { rows, best };
}

// Provider registry. A provider is { id, by, quote(item) => Promise<[{ storeId, storeName, price, title, url }]> }.
// by is how the price is labeled: 'auto' for a looked-up price, a person's name for a typed one.
const providers = [];
export function registerPriceProvider(p) { providers.push(p); }
export const hasPriceProvider = () => providers.length > 0;
// Throws only when every provider failed, so the caller can say why instead of failing silently.
// The latest known count of free price checks left: { left, total, renews } or null.
let quotaNow = null;
const quotaListeners = new Set();
function setQuota(q) { if (q) { quotaNow = q; quotaListeners.forEach((f) => f(q)); } }
export const currentQuota = () => quotaNow;
export function onQuota(f) { quotaListeners.add(f); return () => quotaListeners.delete(f); }
export async function refreshQuota() {
  for (const p of providers) {
    if (!p.quota) continue;
    try { setQuota(await p.quota()); } catch { /* the counter just stays as it was */ }
  }
  return quotaNow;
}

export async function fetchQuotes(item) {
  const out = [];
  let lastError = null;
  for (const p of providers) {
    try {
      for (const q of (await p.quote(item)) || []) out.push({ ...q, by: p.by || 'auto' });
    } catch (e) { lastError = e; }
  }
  if (!out.length && lastError) throw lastError;
  return out;
}

// Merges looked-up quotes into an item's seenPrices. A price a person typed in the last
// day wins over a lookup, because they saw it themselves.
export function mergeQuotes(seen = {}, quotes = [], now = Date.now()) {
  const out = { ...seen };
  for (const q of quotes) {
    if (!PRICE_STORES.some((s) => s.id === q.storeId)) continue;
    if (isBlockedSeller(q.storeName, q.url)) continue;
    const cur = out[q.storeId];
    const typedRecently = cur && cur.by && cur.by !== 'auto' && now - (cur.at || 0) < 86400e3;
    if (typedRecently) continue;
    out[q.storeId] = { price: q.price, at: now, by: q.by || 'auto', ...(q.storeName ? { storeName: q.storeName } : {}), ...(q.title ? { title: q.title } : {}), ...(q.url ? { url: q.url } : {}) };
  }
  return out;
}

// The live provider: asks the app's own server function, which holds the search key.
// The household that lookups are counted against. AppContext sets it when the list changes.
let priceAccount = '';
export function setPriceAccount(id) {
  if (id === priceAccount) return;
  priceAccount = id || '';
  quotaNow = null;
  if (priceAccount) refreshQuota();
}

export function serverPriceProvider(getToken) {
  return {
    id: 'server', by: 'auto',
    async quote(item) {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to look up prices.');
      const q = [item.name, item.note].filter(Boolean).join(' ').trim();
      const r = await fetch(`/.netlify/functions/prices?q=${encodeURIComponent(q)}&account=${encodeURIComponent(priceAccount)}`, { headers: { authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => null);
      if (!data) throw new Error(`The price service didn't answer (${r.status}).`);
      setQuota(data.quota);
      if (data.configured === false) throw new Error('Price lookups aren\'t set up yet: the SERPAPI_KEY setting in Netlify is missing, not available to Functions, or has no value for this deploy context (Production, Deploy Previews or Branch deploys).');
      if (!r.ok || data.error) throw new Error(data.error || `Price search failed (${r.status}).`);
      return data.quotes || [];
    },
    async quota() {
      const token = await getToken();
      if (!token || !priceAccount) return null;
      const r = await fetch(`/.netlify/functions/prices?quota=1&account=${encodeURIComponent(priceAccount)}`, { headers: { authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => null);
      return data?.quota || null;
    },
  };
}
