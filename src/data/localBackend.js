// Demo backend: same interface as firebaseBackend, stored in this browser only.
import { HOUSEHOLD_CATEGORIES } from '../lib/categories.js';
import { DAY } from '../lib/predict.js';

const KEY = 'sla-demo-v1';
const listeners = new Set();
let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.accounts) return s;
  } catch { /* storage unavailable */ }
  return seed();
}
// Demo only: adding ?invite to the address puts a waiting invite to another list on this
// device, so the join banner can be tried without a second Google account.
function addSampleInvite() {
  try {
    if (!new URLSearchParams(location.search).has('invite')) return;
  } catch { return; }
  const id = 'demo-relatives';
  if (state.accounts[id]?.memberUids.includes(DEMO_USER.uid) || state.invites['demo-invite']) return;
  state.accounts[id] = {
    id, name: "Grandma's house", type: 'household', categories: HOUSEHOLD_CATEGORIES,
    members: { 'demo-grandma': { role: 'owner', name: 'Grandma', email: 'grandma@example.com' } },
    memberUids: ['demo-grandma'], settings: { lookaheadDays: 10 }, createdAt: Date.now(),
  };
  state.data[id] = { items: {}, purchases: {}, receipts: {}, batches: {}, receiptImages: {} };
  state.invites['demo-invite'] = {
    id: 'demo-invite', email: DEMO_USER.email, role: 'editor', accountId: id,
    accountName: "Grandma's house", invitedBy: 'Grandma', createdAt: Date.now(),
  };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ }
  for (const l of listeners) l();
}
function uid() { return Math.random().toString(36).slice(2, 11); }

const DEMO_USER = { uid: 'demo-user', name: 'Demo user', email: 'demo@example.com', photo: '' };
state.invites ||= {};
addSampleInvite();

function seed() {
  const now = Date.now();
  const accId = 'demo-household';
  const s = {
    signedIn: false,
    accounts: {
      [accId]: {
        id: accId, name: 'Our household', type: 'household', categories: HOUSEHOLD_CATEGORIES,
        members: {
          'demo-user': { role: 'owner', name: 'Demo user', email: 'demo@example.com' },
          'demo-spouse': { role: 'editor', name: 'Spouse', email: 'spouse@example.com' },
        },
        memberUids: ['demo-user', 'demo-spouse'],
        settings: { lookaheadDays: 10 }, createdAt: now - 130 * DAY,
      },
    },
    data: { [accId]: { items: {}, purchases: {}, receipts: {}, batches: {}, receiptImages: {} } },
    invites: {},
  };
  const d = s.data[accId];
  let r = 7;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  // name, category, store, price, every N days, qty, unit, on list now
  const catalog = [
    ['Milk', 'Meat, dairy & eggs', 'Giant', 3.69, 6, 1, 'gal', true],
    ['Eggs', 'Meat, dairy & eggs', 'Costco', 6.49, 12, 1, 'pack', false],
    ['Bread', 'Pantry', 'Giant', 3.29, 5, 1, 'loaf', true],
    ['Bananas', 'Produce', 'Giant', 1.89, 7, 1, 'bunch', false],
    ['Chicken breast', 'Meat, dairy & eggs', 'Costco', 21.99, 14, 1, 'pack', false],
    ['Rice', 'Pantry', 'Costco', 18.99, 40, 1, 'bag', false],
    ['Paper towels', 'Household', 'Costco', 24.99, 30, 1, 'case', true],
    ['Toilet paper', 'Household', 'Costco', 26.49, 35, 1, 'case', false],
    ['Laundry detergent', 'Household', 'Target', 13.99, 28, 1, 'bottle', false],
    ['Dish soap', 'Household', 'Walmart', 3.97, 21, 1, 'bottle', false],
    ['Orange juice', 'Pantry', 'Giant', 4.49, 8, 1, '', true],
    ['Coffee', 'Pantry', 'Costco', 17.99, 24, 1, 'bag', false],
    ['Yogurt', 'Meat, dairy & eggs', 'Giant', 5.99, 9, 1, 'tub', false],
    ['Tomatoes', 'Produce', 'Giant', 3.49, 7, 2, 'lb', false],
    ['Onions', 'Produce', 'Walmart', 2.98, 14, 1, 'bag', false],
    ['Trash bags', 'Household', 'Walmart', 11.48, 45, 1, 'box', false],
    ['Shampoo', 'Health & personal care', 'Target', 7.99, 50, 1, 'bottle', false],
    ['Toothpaste', 'Health & personal care', 'Amazon', 9.99, 40, 2, '', false],
    ['Printer paper', 'Household', 'Amazon', 8.99, 60, 1, 'ream', false],
    ['Plantains', 'Produce', 'Walmart', 0.69, 10, 6, '', true],
  ];
  const lastBought = {};
  for (const [name, category, store, price, every, qty, unit, onList] of catalog) {
    const id = uid();
    d.items[id] = {
      id, name, category, store, unit, qty, lastPrice: price, status: onList ? 'needed' : 'stocked',
      addedAt: now - 130 * DAY, addedBy: 'demo-user', addedByName: 'Demo user', cadence: { mode: 'auto' },
    };
    let t = now - 120 * DAY + rand() * every * DAY;
    while (t < now - (onList ? 1 : every * 0.3) * DAY) {
      const pid = uid();
      const p = Math.round(price * (0.92 + rand() * 0.16) * 100) / 100;
      d.purchases[pid] = {
        id: pid, itemId: id, name, category, store, qty, unit, unitPrice: p, total: Math.round(p * qty * 100) / 100,
        purchasedAt: t, purchasedBy: rand() > 0.5 ? 'demo-user' : 'demo-spouse', source: 'check',
      };
      lastBought[id] = t;
      t += every * (0.8 + rand() * 0.45) * DAY;
    }
    if (lastBought[id]) d.items[id].lastPurchasedAt = lastBought[id];
  }
  // An item the spouse added a moment ago, never bought, so the "not bought yet" state shows.
  const rq = uid();
  d.items[rq] = { id: rq, name: 'Sticky notes', category: 'Office & stationery', store: 'Amazon', qty: 1, unit: 'pack', status: 'needed', addedAt: now - 3600e3, addedBy: 'demo-spouse', addedByName: 'Spouse', cadence: { mode: 'auto' } };
  // A couple of prices someone checked, so the price comparison shows.
  const towels = Object.values(d.items).find((i) => i.name === 'Paper towels');
  const buds = uid();
  d.items[buds] = {
    id: buds, name: 'Apple AirPods Pro 2', category: 'Household', store: '', qty: 1, unit: '', status: 'needed', lastPrice: null,
    addedAt: now - 2 * DAY, addedBy: 'demo-user', addedByName: 'Demo user', cadence: { mode: 'off' }, pricesCheckedAt: now - 3600e3,
    seenPrices: {
      refurb: { price: 169.99, at: now - 3600e3, by: 'auto', storeName: 'Amazon', condition: 'Certified refurbished', title: 'Apple AirPods Pro 2 (Renewed Premium)' },
      amazon: { price: 199.0, at: now - 3600e3, by: 'auto', storeName: 'Amazon' },
      walmart: { price: 199.0, at: now - 3600e3, by: 'auto', storeName: 'Walmart' },
      target: { price: 199.99, at: now - 3600e3, by: 'auto', storeName: 'Target' },
    },
  };
  if (towels) towels.seenPrices = { samsclub: { price: 22.98, at: now - 2 * DAY, by: 'Demo user' }, amazon: { price: 27.49, at: now - 2 * DAY, by: 'Demo user' }, walmart: { price: 24.97, at: now - 2 * DAY, by: 'Demo user' } };
  return s;
}

export const getApp = () => null;

export function onAuth(cb) {
  const fire = () => cb(state.signedIn ? DEMO_USER : null);
  listeners.add(fire);
  setTimeout(fire, 0);
  return () => listeners.delete(fire);
}
export async function signIn() { state.signedIn = true; save(); }
export async function signOut() { state.signedIn = false; save(); }
// Demo version of account deletion: lists the demo user owns alone are deleted, others are
// left, and the demo user is signed out. "Try the demo" then starts over with fresh sample data.
export async function deleteMyAccount(user, accounts) {
  for (const a of accounts) {
    const acc = state.accounts[a.id];
    const others = acc.memberUids.filter((u) => u !== user.uid);
    if (!others.length) { delete state.accounts[a.id]; delete state.data[a.id]; continue; }
    if (acc.members[user.uid]?.role === 'owner' && !others.some((u) => acc.members[u]?.role === 'owner')) {
      acc.members[others[0]] = { ...acc.members[others[0]], role: 'owner' };
    }
    delete acc.members[user.uid];
    acc.memberUids = others;
  }
  for (const [id, iv] of Object.entries(state.invites)) if (iv.email === user.email) delete state.invites[id];
  state = seed();
  save();
}
export const idToken = async () => null;
export function resetDemo() { state = seed(); state.signedIn = true; save(); }

function watch(get, cb) {
  const fire = () => cb(get());
  listeners.add(fire);
  setTimeout(fire, 0);
  return () => listeners.delete(fire);
}

export const subscribeAccounts = (user, cb) => watch(() => Object.values(state.accounts).filter((a) => a.memberUids.includes(user.uid)), cb);

export async function createAccount({ name, type, categories }, user) {
  const id = uid();
  state.accounts[id] = {
    id, name, type, categories, members: { [user.uid]: { role: 'owner', name: user.name, email: user.email } },
    memberUids: [user.uid], settings: { lookaheadDays: 10 }, createdAt: Date.now(),
  };
  state.data[id] = { items: {}, purchases: {}, receipts: {}, batches: {}, receiptImages: {} };
  save();
  return id;
}

export async function updateAccount(id, patch) {
  const a = state.accounts[id];
  for (const [k, v] of Object.entries(patch)) {
    if (k.includes('.')) {
      const path = k.split('.');
      let obj = a;
      for (const p of path.slice(0, -1)) { obj[p] = { ...(obj[p] || {}) }; obj = obj[p]; }
      obj[path[path.length - 1]] = v;
    } else a[k] = v;
  }
  save();
}

export async function removeMember(account, memberUid) {
  const a = state.accounts[account.id];
  delete a.members[memberUid];
  a.memberUids = a.memberUids.filter((u) => u !== memberUid);
  save();
}

const sortBy = { purchases: (a, b) => b.purchasedAt - a.purchasedAt, receipts: (a, b) => (b.date || 0) - (a.date || 0) };

export const subscribe = (accountId, coll, cb) =>
  watch(() => {
    const list = Object.values(state.data[accountId]?.[coll] || {});
    return sortBy[coll] ? list.sort(sortBy[coll]) : list;
  }, cb);

export const newId = () => uid();

export async function add(accountId, coll, data) {
  const id = uid();
  state.data[accountId][coll][id] = { ...data, id };
  save();
  return id;
}
export async function update(accountId, coll, id, patch) {
  const c = state.data[accountId][coll];
  if (c[id]) c[id] = { ...c[id], ...patch };
  save();
}
export async function remove(accountId, coll, id) {
  delete state.data[accountId][coll][id];
  save();
}
export async function commit(accountId, ops) {
  const d = state.data[accountId];
  for (const op of ops) {
    const id = op.id || uid();
    if (op.type === 'remove') delete d[op.coll][id];
    else if (op.type === 'update') d[op.coll][id] = { ...d[op.coll][id], ...op.data };
    else d[op.coll][id] = { ...op.data, id };
  }
  save();
}
export async function getDocData(accountId, coll, id) {
  return state.data[accountId]?.[coll]?.[id] || null;
}

export async function createInvite(account, email, role, user) {
  const id = uid();
  state.invites[id] = { id, email: email.toLowerCase().trim(), role, accountId: account.id, accountName: account.name, invitedBy: user.name, createdAt: Date.now() };
  save();
}
export const subscribeMyInvites = (user, cb) => watch(() => Object.values(state.invites).filter((i) => i.email === user.email), cb);
export const subscribeAccountInvites = (accountId, cb) => watch(() => Object.values(state.invites).filter((i) => i.accountId === accountId), cb);
export async function acceptInvite(invite, user) {
  const a = state.accounts[invite.accountId];
  a.members[user.uid] = { role: invite.role, name: user.name, email: user.email };
  a.memberUids = [...new Set([...a.memberUids, user.uid])];
  delete state.invites[invite.id];
  save();
}
export async function cancelInvite(id) { delete state.invites[id]; save(); }
