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

// "Cheapest elsewhere" only comes from large US retailers, so small or overseas shops
// (a print shop in Ottawa, say) don't show up as the best price.
const KNOWN_RETAILER = /best\s*buy|staples|office\s*depot|officemax|home\s*depot|lowe'?s|kroger|cvs|walgreens|bj'?s|dollar\s*general|kohl'?s|macy'?s|newegg|b\s*&\s*h|wayfair|chewy|ulta|whole\s*foods|safeway|giant|aldi|publix|meijer|h-?e-?b\b|rite\s*aid|dick'?s|petco|petsmart|bed\s*bath|ikea|canon\s*(usa|store)|hp\s*store|dell\b|apple\b|samsung/i;
export const isKnownRetailer = (name = '') => KNOWN_RETAILER.test(String(name || ''));

// Sellers whose prices are never shown (Sola's rule: no eBay).
const BLOCKED_SELLER = /\bebay\b/i;
export function isBlockedSeller(name = '', url = '') {
  if (BLOCKED_SELLER.test(String(name || ''))) return true;
  try { return /(^|\.)ebay\./i.test(new URL(url).hostname); } catch { return false; }
}

const isGoogle = (u) => { try { return /(^|\.)google\./i.test(new URL(u).hostname); } catch { return true; } };

// The store's own product page when Google Shopping gives one, otherwise Google's page
// for the product (which lists the sellers).
export function directUrl(r = {}) {
  const store = safeUrl(r.link);
  if (store && !isGoogle(store)) return store;
  return safeUrl(r.product_link) || store;
}

// The site a link points to, for showing next to a price: "walmart.com".
export function linkHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Knock-offs undercut the real thing, so they'd always win "cheapest". Skip them unless
// the item's own name asks for one.
const KNOCKOFF = /\b(compatible|remanufactured|refurbished|renewed|restored|open[\s-]?box|pre-?owned|replacement for|refill|generic|for use with|used)\b/i;

// Words with a digit in them, like "240XL" or "12oz", identify the exact product.
// A result has to contain every one of them.
function modelTokens(query = '') {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => /\d/.test(t) && t.length >= 2);
}

function hasModel(title = '', query = '') {
  const t = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return modelTokens(query).every((tok) => t.includes(tok) || t.replace(/ /g, '').includes(tok));
}

export function fitsQuery(title = '', query = '') {
  if (KNOCKOFF.test(title) && !KNOCKOFF.test(query)) return false;
  return hasModel(title, query);
}

// Certified refurbished: a maker's or a big retailer's own refurbished program (Amazon Renewed,
// Walmart Restored, Best Buy, Apple, Dell and the like). Open-box, used or pre-owned listings,
// and refurbished items from other sellers, don't count.
const REFURB = /\b(certified\s+refurbished|refurbished|renewed(\s+premium)?|restored|re-?newed)\b/i;
const NOT_REFURB = /\b(open[\s-]?box|pre-?owned|used|for\s+parts|as[\s-]is|remanufactured|compatible)\b/i;
const REFURB_SELLER = /amazon|walmart|best\s*buy|target|costco|sam'?s\s*club|apple|dell\b|\bhp\b|lenovo|samsung|microsoft|bose|sony|logitech/i;

export function isCertifiedRefurb(r = {}) {
  const text = [r.second_hand_condition, r.title, ...(Array.isArray(r.extensions) ? r.extensions : [])].filter(Boolean).join(' ');
  return REFURB.test(text) && !NOT_REFURB.test(text) && REFURB_SELLER.test(String(r.source || ''));
}

// The cheapest certified refurbished listing that is the same product, as storeId 'refurb'.
export function refurbQuote(results = [], query = '') {
  let best = null;
  for (const r of results) {
    if (!isCertifiedRefurb(r) || !hasModel(String(r.title || ''), query)) continue;
    const price = priceOf(r);
    if (price == null || !(price > 0)) continue;
    const storeName = String(r.source || '').slice(0, 60);
    if (isBlockedSeller(storeName, r.link)) continue;
    const q = { storeId: 'refurb', storeName, price: Math.round(price * 100) / 100, title: String(r.title || '').slice(0, 140), url: directUrl(r), condition: 'Certified refurbished' };
    if (!best || q.price < best.price) best = q;
  }
  return best;
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
    if (isBlockedSeller(storeName, r.link)) continue;
    const storeId = storeIdFor(storeName) || 'any';
    if (storeId === 'any' && !isKnownRetailer(storeName)) continue;
    const q = { storeId, storeName, price: Math.round(price * 100) / 100, title: String(r.title || '').slice(0, 140), url: directUrl(r) };
    if (!best[storeId] || q.price < best[storeId].price) best[storeId] = q;
  }
  const refurb = refurbQuote(results, query);
  return refurb ? [...Object.values(best), refurb] : Object.values(best);
}
