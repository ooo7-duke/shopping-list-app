// Demo backend: same interface as firebaseBackend, stored in this browser only.
import { HOUSEHOLD_CATEGORIES } from '../lib/categories.js';

const KEY = 'sla-demo-v3';
// Older demo data (with sample items and trips) is dropped, so the demo starts empty.
try { localStorage.removeItem('sla-demo-v2'); localStorage.removeItem('sla-demo-inbox-done'); } catch { /* storage blocked */ }
const listeners = new Set();
let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.accounts) return s;
  } catch { /* storage unavailable */ }
  return seed();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ }
  for (const l of listeners) l();
}
function uid() { return Math.random().toString(36).slice(2, 11); }

const DEMO_USER = { uid: 'demo-user', name: 'Demo user', email: 'demo@example.com', photo: '' };
state.invites ||= {};

// The demo starts with one empty list and nothing else, so changes can be tried without
// signing in to a real account. Nothing here is sample data.
function seed() {
  const accId = 'demo-household';
  return {
    signedIn: false,
    accounts: {
      [accId]: {
        id: accId, name: 'Our household', type: 'household', categories: HOUSEHOLD_CATEGORIES,
        members: { 'demo-user': { role: 'owner', name: 'Demo user', email: 'demo@example.com' } },
        memberUids: ['demo-user'], settings: { lookaheadDays: 10 }, createdAt: Date.now(),
      },
    },
    data: { [accId]: { items: {}, purchases: {}, receipts: {}, batches: {}, receiptImages: {} } },
    invites: {},
  };
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
// left, and the demo user is signed out. "Try the demo" then starts over with an empty list.
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
export function resetDemo() {
  state = seed(); state.signedIn = true; save();
}

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

// Private travel expense reports, kept per person (see firebaseBackend.subscribeMine).
const mine = (uid, coll) => ((state.mine ||= {})[uid] ||= {})[coll] ||= {};
export const subscribeMine = (uid, coll, cb) => watch(() => Object.values(mine(uid, coll)), cb);
export const newMineId = () => uid();
export async function commitMine(userId, ops) {
  for (const op of ops) {
    const c = mine(userId, op.coll);
    const id = op.id || uid();
    if (op.type === 'remove') delete c[id];
    else if (op.type === 'update') c[id] = { ...c[id], ...op.data };
    else c[id] = { ...op.data, id };
  }
  save();
}
export async function getMine(userId, coll, id) {
  return mine(userId, coll)[id] || null;
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
