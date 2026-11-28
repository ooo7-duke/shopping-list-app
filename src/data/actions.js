// Domain actions shared by every screen. Each takes a context
// { backend, accountId, user, role, items, account } so screens stay thin.
import { normalizeName } from '../lib/parse.js';
import { guessCategory, HOUSEHOLD_CATEGORIES } from '../lib/categories.js';
import { DAY } from '../lib/predict.js';
import { fetchQuotes, hasPriceProvider, mergeQuotes } from '../lib/prices.js';
import { paidWithId } from '../lib/expenses.js';

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function findItem(items, name) {
  const key = normalizeName(name);
  return items.find((it) => normalizeName(it.name) === key);
}

export function isOnList(it, now = Date.now()) {
  // 'requested' is a status from before the approval step was removed; treat it as needed.
  if (it.status === 'needed' || it.status === 'requested' || it.status === 'ordered') return true;
  return it.status === 'snoozed' && (it.snoozeUntil || 0) <= now;
}

export async function addEntries(ctx, entries) {
  const { backend, accountId, user, items, account } = ctx;
  const cats = account?.categories || HOUSEHOLD_CATEGORIES;
  // Everyone with access to the list is trusted to add to it directly.
  const status = 'needed';
  const ops = [];
  const undoOps = [];
  const added = [];
  for (const e of entries) {
    const existing = findItem(items, e.name);
    if (existing) undoOps.push({ type: 'update', coll: 'items', id: existing.id, data: clean({ status: existing.status, qty: existing.qty ?? 1, store: existing.store ?? '', urgent: !!existing.urgent, needBy: existing.needBy ?? null, ...(e.photo ? { photo: existing.photo ?? null } : {}) }) });
    const category = e.category ? matchCategory(e.category, cats) : undefined;
    if (existing) {
      ops.push({
        type: 'update', coll: 'items', id: existing.id,
        data: clean({
          status, qty: e.qty || existing.qty || 1, unit: e.unit || existing.unit || '',
          store: e.store || existing.store || '', category: category || existing.category,
          urgent: !!e.urgent, needBy: e.urgent ? Date.now() : null, addedAt: Date.now(), addedBy: user.uid, addedByName: user.name,
          ...(e.price != null ? { lastPrice: e.price } : {}),
          ...(e.photo ? { photo: e.photo, photoAt: Date.now() } : {}),
        }),
      });
      added.push({ ...existing, status });
    } else {
      const id = backend.newId(accountId, 'items');
      const data = {
        name: e.name, qty: e.qty || 1, unit: e.unit || '', store: e.store || '',
        category: category || guessCategory(e.name, cats), status, urgent: !!e.urgent,
        needBy: e.urgent ? Date.now() : null, lastPrice: e.price ?? null, cadence: { mode: 'auto' },
        addedAt: Date.now(), addedBy: user.uid, addedByName: user.name,
        ...(e.photo ? { photo: e.photo, photoAt: Date.now() } : {}),
      };
      ops.push({ type: 'set', coll: 'items', id, data });
      undoOps.push({ type: 'remove', coll: 'items', id });
      added.push({ id, ...data });
    }
  }
  await backend.commit(accountId, ops);
  return { added, undo: () => backend.commit(accountId, undoOps) };
}

function matchCategory(text, cats) {
  const t = text.toLowerCase();
  return cats.find((c) => c.toLowerCase() === t) || cats.find((c) => c.toLowerCase().includes(t)) || guessCategory(text, cats);
}

export async function markBought(ctx, item, opts = {}) {
  const { backend, accountId, user } = ctx;
  const at = opts.date || Date.now();
  const qty = Number(opts.qty ?? item.qty) || 1;
  const unitPrice = opts.price ?? item.lastPrice ?? null;
  const pid = backend.newId(accountId, 'purchases');
  const purchase = clean({
    itemId: item.id, name: item.name, category: item.category || 'Other', store: opts.store || item.store || '',
    qty, unit: item.unit || '', unitPrice, total: unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : null,
    purchasedAt: at, purchasedBy: user.uid, purchasedByName: user.name, source: opts.source || 'check',
    batchId: item.batchId || null, receiptId: opts.receiptId || null,
  });
  const ops = [
    { type: 'set', coll: 'purchases', id: pid, data: purchase },
    {
      type: 'update', coll: 'items', id: item.id,
      data: clean({ status: 'stocked', lastPurchasedAt: at, lastQty: qty, lastStore: purchase.store, urgent: false, needBy: null, batchId: null, snoozeUntil: null, ...(unitPrice != null ? { lastPrice: unitPrice } : {}) }),
    },
  ];
  await backend.commit(accountId, ops);
  return { purchaseId: pid, undo: () => backend.commit(accountId, [
    { type: 'remove', coll: 'purchases', id: pid },
    { type: 'update', coll: 'items', id: item.id, data: clean({ status: item.status, lastPurchasedAt: item.lastPurchasedAt ?? null, lastPrice: item.lastPrice ?? null, lastQty: item.lastQty ?? null, lastStore: item.lastStore ?? null, batchId: item.batchId ?? null }) },
  ]) };
}

export async function setStatus(ctx, item, status, extra = {}) {
  const prev = { status: item.status, snoozeUntil: item.snoozeUntil ?? null };
  await ctx.backend.update(ctx.accountId, 'items', item.id, { status, ...extra });
  return () => ctx.backend.update(ctx.accountId, 'items', item.id, prev);
}

export const snooze = (ctx, item, days = 7) => setStatus(ctx, item, 'snoozed', { snoozeUntil: Date.now() + days * DAY });
// How long an item can be snoozed for. A month is a calendar month, so Nov 27 comes back Dec 27.
export const SNOOZE_CHOICES = [
  { label: '1 day', days: 1 }, { label: '3 days', days: 3 }, { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 }, { label: '1 month', months: 1 },
];
export function snoozeEnd(choice, now = Date.now()) {
  if (!choice.months) return now + choice.days * DAY;
  const d = new Date(now);
  const want = d.getMonth() + choice.months;
  d.setMonth(want);
  if (d.getMonth() !== ((want % 12) + 12) % 12) d.setDate(0); // Jan 31 + 1 month is Feb 28, not Mar 3
  return d.getTime();
}
export const snoozeUntil = (ctx, item, until) => setStatus(ctx, item, 'snoozed', { snoozeUntil: until });
export const takeOffList = (ctx, item) => setStatus(ctx, item, 'stocked');
export const putOnList = (ctx, item) => setStatus(ctx, item, 'needed', { addedAt: Date.now(), addedBy: ctx.user.uid, addedByName: ctx.user.name });

// Record a price someone saw at a store (after tapping Check price). Undo restores the old one.
// Looks up today's prices for an item and saves them. Skips items looked up in the last
// day unless force is set, so each add spends at most one search.
// Each lookup spends one of the free plan's monthly searches, so lookups only run when
// someone taps Look up prices, and at most once a day per item. Changing an item's name or
// note clears that, so a better name can be looked up right away.
export const MANUAL_LOOKUP_HOURS = 24;
export const canLookUpAgain = (item, now = Date.now()) => !item.pricesCheckedAt || now - item.pricesCheckedAt >= MANUAL_LOOKUP_HOURS * 3600e3;

export async function refreshPrices(ctx, item) {
  if (!hasPriceProvider()) return { found: 0 };
  if (!canLookUpAgain(item)) return { found: 0, skipped: true, recent: true };
  const quotes = await fetchQuotes(item);
  const latest = (ctx.items || []).find((i) => i.id === item.id) || item;
  await ctx.backend.update(ctx.accountId, 'items', item.id, { seenPrices: mergeQuotes(latest.seenPrices, quotes), pricesCheckedAt: Date.now() });
  return { found: quotes.length };
}

export async function setSeenPrice(ctx, item, storeId, price) {
  const prev = item.seenPrices?.[storeId] ?? null;
  const next = price == null || price === '' || Number.isNaN(Number(price)) ? null
    : { price: Math.round(Number(price) * 100) / 100, at: Date.now(), by: ctx.user.name || '' };
  const write = (val) => {
    const all = { ...(item.seenPrices || {}) };
    if (val) all[storeId] = val; else delete all[storeId];
    return ctx.backend.update(ctx.accountId, 'items', item.id, { seenPrices: all });
  };
  await write(next);
  return () => write(prev);
}

export async function markOrdered(ctx, store, items) {
  const { backend, accountId, user } = ctx;
  const bid = backend.newId(accountId, 'batches');
  const ops = [{
    type: 'set', coll: 'batches', id: bid,
    data: { name: `${store || 'Order'} order`, store: store || '', status: 'ordered', orderedAt: Date.now(), orderedBy: user.uid, orderedByName: user.name, itemIds: items.map((i) => i.id), estTotal: estimate(items) },
  }];
  for (const it of items) ops.push({ type: 'update', coll: 'items', id: it.id, data: { status: 'ordered', batchId: bid } });
  await backend.commit(accountId, ops);
  return () => cancelOrder(ctx, { id: bid }, items);
}

// Takes back an order marked by mistake: the items go back on the list and the order is removed.
export async function cancelOrder(ctx, batch, items) {
  const { backend, accountId } = ctx;
  const ops = [{ type: 'remove', coll: 'batches', id: batch.id }];
  for (const it of items) {
    const back = it.status && it.status !== 'ordered' ? it.status : 'needed';
    ops.push({ type: 'update', coll: 'items', id: it.id, data: { status: back, batchId: null } });
  }
  await backend.commit(accountId, ops);
}

export async function markArrived(ctx, batch, items, date = Date.now()) {
  const { backend, accountId, user } = ctx;
  const ops = [{ type: 'update', coll: 'batches', id: batch.id, data: { status: 'done', arrivedAt: date } }];
  for (const it of items) {
    const qty = Number(it.qty) || 1;
    const unitPrice = it.lastPrice ?? null;
    ops.push({
      type: 'set', coll: 'purchases', id: backend.newId(accountId, 'purchases'),
      data: clean({ itemId: it.id, name: it.name, category: it.category || 'Other', store: batch.store || it.store || '', qty, unit: it.unit || '', unitPrice, total: unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : null, purchasedAt: date, purchasedBy: user.uid, purchasedByName: user.name, source: 'order', batchId: batch.id }),
    });
    ops.push({ type: 'update', coll: 'items', id: it.id, data: { status: 'stocked', lastPurchasedAt: date, lastQty: qty, lastStore: batch.store || it.store || '', batchId: null, urgent: false, needBy: null } });
  }
  await backend.commit(accountId, ops);
}

export function estimate(items) {
  return Math.round(items.reduce((s, it) => s + (Number(it.lastPrice) || 0) * (Number(it.qty) || 1), 0) * 100) / 100;
}

// Receipt save: one purchase per accepted line, items created or updated, list items checked off.
export async function saveReceipt(ctx, receipt, lines) {
  const { backend, accountId, user, items, account } = ctx;
  const cats = account?.categories || HOUSEHOLD_CATEGORIES;
  const date = receipt.date || Date.now();
  const rid = receipt.id || backend.newId(accountId, 'receipts');
  const ops = [];
  let matched = 0;
  for (const ln of lines) {
    if (ln.skip) continue;
    let item = ln.itemId ? items.find((i) => i.id === ln.itemId) : null;
    const qty = Number(ln.quantity) || 1;
    const unitPrice = ln.unitPrice != null ? Number(ln.unitPrice) : ln.lineTotal != null ? Math.round((Number(ln.lineTotal) / qty) * 100) / 100 : null;
    if (!item) {
      const id = backend.newId(accountId, 'items');
      const name = ln.newName || ln.name || ln.rawText;
      item = { id, name, category: ln.category && cats.includes(ln.category) ? ln.category : guessCategory(name, cats), store: receipt.store || '', qty: 1, unit: '', cadence: { mode: 'auto' } };
      ops.push({ type: 'set', coll: 'items', id, data: { ...item, id: undefined, status: 'stocked', addedAt: Date.now(), addedBy: user.uid, addedByName: user.name, lastPrice: unitPrice, lastPurchasedAt: date, lastQty: qty, lastStore: receipt.store || '' } });
    } else {
      matched++;
      const keep = item.status === 'ordered' && item.batchId; // an online order arriving via its receipt
      const newer = date >= (item.lastPurchasedAt || 0);
      ops.push({ type: 'update', coll: 'items', id: item.id, data: clean({ lastPrice: newer ? unitPrice ?? item.lastPrice ?? null : item.lastPrice ?? null, lastPurchasedAt: Math.max(item.lastPurchasedAt || 0, date), ...(newer ? { lastQty: qty, lastStore: receipt.store || item.store || '' } : {}), status: keep || isOnList(item) || item.status === 'snoozed' ? 'stocked' : item.status, batchId: null, urgent: false, needBy: null }) });
    }
    ops.push({
      type: 'set', coll: 'purchases', id: backend.newId(accountId, 'purchases'),
      data: clean({ itemId: item.id, name: item.name, category: item.category || 'Other', store: receipt.store || item.store || '', qty, unit: item.unit || '', unitPrice, total: ln.lineTotal != null ? Number(ln.lineTotal) : unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : null, purchasedAt: date, purchasedBy: user.uid, purchasedByName: user.name, source: 'receipt', receiptId: rid, rawText: ln.rawText || '' }),
    });
  }
  ops.push({
    type: 'set', coll: 'receipts', id: rid,
    data: clean({ store: receipt.store || '', date, total: receipt.total != null ? Number(receipt.total) : null, tax: receipt.tax ?? null, lineCount: lines.filter((l) => !l.skip).length, matched, uploadedBy: user.uid, uploadedByName: user.name, createdAt: Date.now(), hasImage: !!receipt.image, qrText: receipt.qrText || null, qrUrl: receipt.qrUrl || null, source: receipt.source || null, emailId: receipt.emailId || null, orderId: receipt.orderId || null }),
  });
  if (receipt.image) ops.push({ type: 'set', coll: 'receiptImages', id: rid, data: { dataUrl: receipt.image } });
  // Strip undefined ids from item docs.
  await backend.commit(accountId, ops.map((o) => (o.data ? { ...o, data: clean(o.data) } : o)));
  return rid;
}

export async function deleteReceipt(ctx, receipt, purchases) {
  const ops = [{ type: 'remove', coll: 'receipts', id: receipt.id }, { type: 'remove', coll: 'receiptImages', id: receipt.id }];
  for (const p of purchases.filter((x) => x.receiptId === receipt.id)) ops.push({ type: 'remove', coll: 'purchases', id: p.id });
  await ctx.backend.commit(ctx.accountId, ops);
}

// ---- Travel expense reports (private to the signed-in person, under users/{uid}) ----

const TRIP_FIELDS = ['name', 'location', 'startDate', 'endDate', 'purpose', 'employer', 'project', 'chargeCode', 'mealsMode', 'mieRate', 'mealsProvided', 'status', 'notes'];
const EXPENSE_FIELDS = ['tripId', 'category', 'merchant', 'date', 'time', 'amount', 'originalAmount', 'originalCurrency', 'paidWith', 'business', 'nights', 'notes', 'summary', 'captions', 'imageIds', 'source', 'emailId'];
const pick = (o, keys) => clean(Object.fromEntries(keys.map((k) => [k, o[k] === undefined ? undefined : o[k]])));
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

export async function saveExpenseTrip(ctx, trip) {
  const { backend, user } = ctx;
  const id = trip.id || backend.newMineId(user.uid, 'expenseTrips');
  const data = pick({ ...trip, mieRate: num(trip.mieRate), mealsMode: trip.mealsMode || 'actual', status: trip.status || 'open' }, TRIP_FIELDS);
  await backend.commitMine(user.uid, [trip.id
    ? { type: 'update', coll: 'expenseTrips', id, data: { ...data, updatedAt: Date.now() } }
    : { type: 'set', coll: 'expenseTrips', id, data: { ...data, createdAt: Date.now(), updatedAt: Date.now() } }]);
  return id;
}

export async function updateExpenseTrip(ctx, id, patch) {
  await ctx.backend.commitMine(ctx.user.uid, [{ type: 'update', coll: 'expenseTrips', id, data: { ...patch, updatedAt: Date.now() } }]);
}

// Deleting a trip folder deletes every expense and receipt photo in it.
export async function deleteExpenseTrip(ctx, trip, expenses) {
  const ops = [{ type: 'remove', coll: 'expenseTrips', id: trip.id }];
  for (const e of expenses.filter((x) => x.tripId === trip.id)) {
    ops.push({ type: 'remove', coll: 'expenses', id: e.id });
    for (const img of e.imageIds || []) ops.push({ type: 'remove', coll: 'expenseImages', id: img });
  }
  await ctx.backend.commitMine(ctx.user.uid, ops);
}

// Saves an expense the person has checked. New photos are written one at a time, since each
// can be close to Firestore's 1 MB limit for a single document.
export async function saveExpense(ctx, expense, { newImages = [], removedImageIds = [] } = {}) {
  const { backend, user } = ctx;
  const id = expense.id || backend.newMineId(user.uid, 'expenses');
  const kept = (expense.imageIds || []).filter((x) => !removedImageIds.includes(x));
  const added = [];
  for (const dataUrl of newImages) {
    const imgId = backend.newMineId(user.uid, 'expenseImages');
    await backend.commitMine(user.uid, [{ type: 'set', coll: 'expenseImages', id: imgId, data: { dataUrl, expenseId: id, createdAt: Date.now() } }]);
    added.push(imgId);
  }
  const nights = (expense.nights || []).map((n) => ({ date: n.date, amount: num(n.amount) ?? 0, personal: !!n.personal }));
  const data = pick({
    ...expense, amount: num(expense.amount), originalAmount: num(expense.originalAmount), business: expense.business === '' || expense.business == null ? null : num(expense.business),
    nights, paidWith: paidWithId(expense.paidWith), imageIds: [...kept, ...added], currency: 'USD',
    captions: Object.fromEntries(Object.entries(expense.captions || {}).filter(([k, v]) => kept.includes(k) && v)),
  }, EXPENSE_FIELDS);
  const ops = [expense.id
    ? { type: 'update', coll: 'expenses', id, data: { ...data, updatedAt: Date.now() } }
    : { type: 'set', coll: 'expenses', id, data: { ...data, createdAt: Date.now(), updatedAt: Date.now() } }];
  for (const r of removedImageIds) ops.push({ type: 'remove', coll: 'expenseImages', id: r });
  await backend.commitMine(user.uid, ops);
  return id;
}

// Sets or clears the caption the person typed for one receipt photo. A blank caption goes
// back to the automatic one.
export async function setPhotoCaption(ctx, expense, imageId, text) {
  const captions = { ...(expense.captions || {}) };
  const t = String(text || '').trim().slice(0, 140);
  if (t) captions[imageId] = t; else delete captions[imageId];
  await ctx.backend.commitMine(ctx.user.uid, [{ type: 'update', coll: 'expenses', id: expense.id, data: { captions, updatedAt: Date.now() } }]);
}

// Deletes an expense and its photos, and hands back an undo that puts them all back.
export async function deleteExpense(ctx, expense) {
  const { backend, user } = ctx;
  const images = [];
  for (const img of expense.imageIds || []) {
    const d = await backend.getMine(user.uid, 'expenseImages', img);
    if (d) images.push({ id: img, data: d });
  }
  const { id, ...rest } = expense;
  await backend.commitMine(user.uid, [{ type: 'remove', coll: 'expenses', id }, ...images.map((i) => ({ type: 'remove', coll: 'expenseImages', id: i.id }))]);
  return async () => {
    for (const i of images) await backend.commitMine(user.uid, [{ type: 'set', coll: 'expenseImages', id: i.id, data: i.data }]);
    await backend.commitMine(user.uid, [{ type: 'set', coll: 'expenses', id, data: clean(rest) }]);
  };
}

export const getExpenseImage = (ctx, id) => ctx.backend.getMine(ctx.user.uid, 'expenseImages', id);
