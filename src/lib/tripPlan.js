// Plans the fewest store runs for what's on the list, using the stores the household saved
// (with how far each is from home). It needs no searches: what a store sells comes from a
// table of store types by department, plus any price the app already found at that store.

import { guessCategory, HOUSEHOLD_CATEGORIES, ORG_CATEGORIES } from './categories.js';

// Departments a store type carries.
const GROCERY = ['grocery'];
const ALL = ['grocery', 'household', 'personal', 'baby', 'pets', 'office', 'electronics', 'auto'];

export const STORE_TYPES = [
  { id: 'walmart', name: 'Walmart Supercenter', depts: ALL, priceStore: 'walmart' },
  { id: 'walmart_market', name: 'Walmart Neighborhood Market', depts: ['grocery', 'household', 'personal', 'baby', 'pets'], priceStore: 'walmart' },
  { id: 'target', name: 'Target', depts: ['grocery', 'household', 'personal', 'baby', 'pets', 'office', 'electronics'], priceStore: 'target' },
  { id: 'costco', name: 'Costco', depts: ALL, priceStore: 'costco' },
  { id: 'samsclub', name: "Sam's Club", depts: ALL, priceStore: 'samsclub' },
  { id: 'grocery', name: 'Grocery store (Giant, Safeway, Aldi, Weis...)', depts: ['grocery', 'household', 'personal', 'baby', 'pets'] },
  { id: 'pharmacy', name: 'Pharmacy (CVS, Walgreens)', depts: ['personal', 'baby'] },
  { id: 'autoparts', name: 'Auto parts (AutoZone, Advance, O’Reilly)', depts: ['auto'] },
  { id: 'office', name: 'Office store (Staples, Office Depot)', depts: ['office', 'electronics'] },
  { id: 'hardware', name: 'Home improvement (Home Depot, Lowe’s)', depts: ['household'] },
  { id: 'electronics', name: 'Electronics (Best Buy)', depts: ['electronics'] },
  // A store the list above doesn't cover, like H-Mart. It gets only what you move there yourself.
  { id: 'other', name: 'Other store (type its name)', depts: [] },
];
export const storeType = (id) => STORE_TYPES.find((t) => t.id === id) || null;

// Stores the household has named before, newest first, so they show in the Kind of store
// list next time. A name is kept once, whatever its case, and the list stays short.
export function rememberStoreKinds(prev, rows, max = 20) {
  const out = [];
  const seen = new Set();
  const push = (k) => {
    const name = String(k?.name || '').trim().slice(0, 30);
    const type = k?.type;
    if (!name || !type || !storeType(type)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, type });
  };
  (rows || []).forEach(push);
  (prev || []).forEach(push);
  return out.slice(0, max);
}

const CATEGORY_DEPT = {
  'Produce': 'grocery', 'Dairy & eggs': 'grocery', 'Meat & seafood': 'grocery', 'Bakery': 'grocery',
  'Pantry': 'grocery', 'Frozen': 'grocery', 'Beverages': 'grocery', 'Snacks': 'grocery',
  'Household': 'household', 'Cleaning': 'household', 'Paper goods': 'household', 'Kitchen & breakroom': 'household',
  'Personal care': 'personal', 'Health': 'personal', 'Safety & first aid': 'personal',
  'Baby': 'baby', 'Pets': 'pets',
  'Office & stationery': 'office', 'Printing': 'office', 'Mailing & shipping': 'office', 'Event supplies': 'office',
  'Tech & electronics': 'electronics', 'Automotive': 'auto',
};

const AUTO = /\b(motor|engine)\s*oil\b|\boil filter\b|\bwiper|antifreeze|coolant|windshield|washer fluid|brake fluid|transmission fluid|car wash|car battery|tire|spark plug|air freshener for car/i;

// Which department an item falls in. The name decides first, so "engine oil" isn't filed
// with cooking oil even if its category says Pantry.
export function deptOf(item) {
  const name = [item.name, item.note].filter(Boolean).join(' ');
  if (AUTO.test(name)) return 'auto';
  const guessed = guessCategory(name, [...new Set([...HOUSEHOLD_CATEGORIES, ...ORG_CATEGORIES])]);
  if (guessed && guessed !== 'Other') return CATEGORY_DEPT[guessed] || null;
  return CATEGORY_DEPT[item.category] || null;
}

// Stores that reliably stock a whole department, model numbers included.
const SPECIALISTS = { office: ['office'], auto: ['autoparts'], electronics: ['electronics', 'office'] };

// A product with a model number, like "Canon PG-240XL ink", is a specific product. Sizes
// such as "12oz" or "2 gal" don't count.
const UNITS = /^\d+(\.\d+)?(oz|lb|lbs|ct|pk|pack|gal|ml|l|g|kg|in|ft|qt|pt|count|rolls?)$/;
export function isSpecific(item) {
  const words = [item.name, item.note].filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9-]+/);
  return words.some((w) => /\d/.test(w) && /[a-z]/.test(w) && w.replace(/-/g, '').length >= 3 && !UNITS.test(w));
}

// Does this saved store carry the item?
// - A price already found at that chain counts as proof.
// - A specific product (with a model number) goes only to a store with that proof, or to a
//   store that specializes in its department, like an office store for printer ink. A
//   department guess is not enough: Costco sells office supplies but not every ink.
// - Everyday items go by department.
export function carries(store, item) {
  const type = storeType(store.type);
  if (!type) return false;
  if (type.priceStore && item.seenPrices?.[type.priceStore]?.price != null) return true;
  const d = deptOf(item);
  if (isSpecific(item)) return !!d && (SPECIALISTS[d] || []).includes(type.id);
  return d ? type.depts.includes(d) : ['walmart', 'costco', 'samsclub', 'target'].includes(type.id);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// A saved store's own name, like "Giant" or "H-Mart", wins over the kind of store.
export const storeLabel = (s) => [String(s.name || '').trim() || storeType(s.type)?.name.replace(/\s*\(.*\)$/, '') || 'Store', s.place].filter(Boolean).join(' · ');
const nameMatches = (s, want) => {
  const w = norm(want);
  return w && (norm(storeLabel(s)).includes(w) || norm(s.name) === w || norm(storeType(s.type)?.name).includes(w) || norm(s.place) === w);
};
// The saved store an item was put at: the exact store first, then the closest name.
export const pinnedStore = (saved, want) => {
  if (!want) return null;
  const w = norm(want);
  return saved.find((s) => norm(storeLabel(s)) === w) || saved.find((s) => s.name && norm(s.name) === w) || saved.find((s) => nameMatches(s, want)) || null;
};

// Returns { stops: [{ store, items, covered, miles, canWait }], unplaced: [items] }.
// Greedy: the store that covers the most remaining items goes first, the nearer one on a tie.
// An item someone pinned to a store with @store goes to that saved store if there is one.
export function planTrips(items, stores = []) {
  const saved = stores.filter((s) => storeType(s.type));
  const byStore = new Map();
  const add = (id, it) => { if (!byStore.has(id)) byStore.set(id, []); byStore.get(id).push(it); };
  let remaining = [];
  for (const it of items) {
    const pinned = pinnedStore(saved, it.store);
    if (pinned) add(pinned.id, it); else remaining.push(it);
  }
  const miles = (s) => (s.miles != null && s.miles !== '' && Number.isFinite(Number(s.miles)) ? Number(s.miles) : 999);
  const order = [];
  for (const id of byStore.keys()) order.push(id);
  while (remaining.length) {
    let best = null;
    for (const s of saved) {
      const got = remaining.filter((it) => carries(s, it));
      if (!got.length) continue;
      const score = got.length + (byStore.has(s.id) ? 0.5 : 0);
      if (!best || score > best.score || (score === best.score && miles(s) < miles(best.s))) best = { s, got, score };
    }
    if (!best) break;
    for (const it of best.got) add(best.s.id, it);
    if (!order.includes(best.s.id)) order.push(best.s.id);
    remaining = remaining.filter((it) => !best.got.includes(it));
  }
  const stops = order.map((id) => {
    const s = saved.find((x) => x.id === id);
    const list = byStore.get(id);
    return { store: s, label: storeLabel(s), items: list, miles: miles(s) === 999 ? null : miles(s), urgent: list.filter((i) => i.urgent).length };
  }).sort((a, b) => b.items.length - a.items.length || (a.miles ?? 999) - (b.miles ?? 999));
  // Extra stops with one or two items and nothing urgent can wait for the next run.
  stops.forEach((st, i) => { st.canWait = i > 0 && !st.urgent && st.items.length <= 2; });
  return { stops, unplaced: remaining };
}
