import { describe, it, expect } from 'vitest';
import { parseQuickAdd, parseEntry } from './parse.js';
import { predictItem, DAY } from './predict.js';
import { bestMatch, expandLine } from './match.js';
import { guessCategory, ORG_CATEGORIES } from './categories.js';

describe('quick add parser', () => {
  it('reads quantity, unit, store, category and price', () => {
    const e = parseEntry('2 gal milk @costco #dairy $3.49');
    expect(e).toMatchObject({ qty: 2, unit: 'gal', name: 'Milk', store: 'Costco', category: 'Dairy', price: 3.49 });
  });
  it('splits comma lists and keeps plain names', () => {
    const r = parseQuickAdd('eggs, bread, 3 paper towels');
    expect(r.map((x) => x.name)).toEqual(['Eggs', 'Bread', 'Paper towels']);
    expect(r[2].qty).toBe(3);
  });
  it('handles dozen, x2 and urgent', () => {
    expect(parseEntry('a dozen eggs')).toMatchObject({ qty: 12, name: 'Eggs' });
    expect(parseEntry('toner x2!')).toMatchObject({ qty: 2, name: 'Toner', urgent: true });
  });
  it('splits voice input on "and" but not typed input', () => {
    expect(parseQuickAdd('eggs and bread and milk', { voice: true })).toHaveLength(3);
    expect(parseQuickAdd('mac and cheese')).toHaveLength(1);
  });
  it('supports multi-word store names', () => {
    expect(parseEntry('bananas @"whole foods"').store).toBe('Whole foods');
    expect(parseEntry('bananas @trader_joes').store).toBe('Trader joes');
  });
  it('does not treat an article as a quantity', () => {
    expect(parseEntry('apple').name).toBe('Apple');
  });
});

describe('predictions', () => {
  const now = Date.UTC(2026, 10, 26);
  const item = { id: 'milk' };
  const mk = (daysAgo, qty = 1) => ({ itemId: 'milk', purchasedAt: now - daysAgo * DAY, qty });

  it('stays in learning mode with fewer than two purchases', () => {
    expect(predictItem(item, [mk(3)], now).basis).toBe('learning');
  });
  it('predicts the next purchase from regular weekly buys', () => {
    const p = predictItem(item, [mk(28), mk(21), mk(14), mk(7)], now);
    expect(p.basis).toBe('history');
    expect(Math.round(p.intervalDays)).toBe(7);
    expect(Math.round(p.daysLeft)).toBe(0);
    expect(p.confidence).toBe('medium');
  });
  it('scales with quantity bought', () => {
    const p = predictItem(item, [mk(28, 1), mk(21, 1), mk(14, 1), mk(7, 2)], now);
    expect(Math.round(p.intervalDays)).toBe(14);
  });
  it('honors manual and off overrides', () => {
    const manual = predictItem({ ...item, cadence: { mode: 'manual', days: 10 } }, [mk(7)], now);
    expect(manual.basis).toBe('manual');
    expect(Math.round(manual.daysLeft)).toBe(3);
    expect(predictItem({ ...item, cadence: { mode: 'off' } }, [mk(7), mk(1)], now).basis).toBe('off');
  });
});

describe('receipt matching', () => {
  const items = [{ id: '1', name: 'Milk' }, { id: '2', name: 'Paper towels' }, { id: '3', name: 'Chicken breast' }, { id: '4', name: 'Eggs' }];
  it('expands store abbreviations', () => {
    expect(expandLine('GV 2% MLK GAL')).toBe('milk');
  });
  it('matches abbreviated lines', () => {
    expect(bestMatch({ rawText: 'GV 2% MLK GAL' }, items).item?.id).toBe('1');
    expect(bestMatch({ rawText: 'BNLS CHKN BRST' }, items).item?.id).toBe('3');
    expect(bestMatch({ rawText: 'BOUNTY PPR TWLS 6PK' }, items).item?.id).toBe('2');
    expect(bestMatch({ rawText: 'LG EGGS 18CT' }, items).item?.id).toBe('4');
  });
  it('returns no match for unrelated lines', () => {
    expect(bestMatch({ rawText: 'BIRTHDAY CARD' }, items).item).toBeNull();
  });
  it('trusts the AI suggested name when it is exact', () => {
    expect(bestMatch({ rawText: 'XYZ', matchName: 'Eggs' }, items).item?.id).toBe('4');
  });
});

describe('category guess', () => {
  it('guesses common categories', () => {
    expect(guessCategory('2% milk')).toBe('Dairy & eggs');
    expect(guessCategory('Paper towels')).toBe('Paper goods');
    expect(guessCategory('HP toner', ORG_CATEGORIES)).toBe('Printing');
    expect(guessCategory('mystery thing')).toBe('Other');
  });
});

import { lastPurchaseMap, lastBuy } from './history.js';
import { storeLinks, seenPrices, PRICE_STORES } from './prices.js';

describe('purchase history', () => {
  const purchases = [
    { itemId: 'a', purchasedAt: 100, qty: 2, unitPrice: 3.5, store: 'Giant' },
    { itemId: 'a', purchasedAt: 300, qty: 1, total: 4.2, store: "Sam's Club" },
    { itemId: 'b', purchasedAt: 200, qty: 6, unitPrice: 0.69 },
  ];
  it('picks the latest purchase per item', () => {
    const m = lastPurchaseMap(purchases);
    expect(m.a.purchasedAt).toBe(300);
    expect(lastBuy({ id: 'a' }, m.a)).toMatchObject({ at: 300, qty: 1, unitPrice: 4.2, store: "Sam's Club" });
  });
  it('falls back to item fields, and to nothing for new items', () => {
    expect(lastBuy({ lastPurchasedAt: 50, lastQty: 3, lastPrice: 2 }, undefined)).toMatchObject({ at: 50, qty: 3, unitPrice: 2 });
    expect(lastBuy({ name: 'New thing' }, undefined)).toBeNull();
  });
});

describe('price checks', () => {
  it("lists Sam's Club, Amazon, Walmart first and encodes the search", () => {
    const links = storeLinks({ name: 'Paper towels', note: 'Bounty' });
    expect(links.slice(0, 3).map((l) => l.name)).toEqual(["Sam's Club", 'Amazon', 'Walmart']);
    expect(links[1].href).toBe('https://www.amazon.com/s?k=Paper+towels+Bounty');
    expect(links.length).toBe(PRICE_STORES.length);
  });
  it('flags the cheapest recent price and ignores stale ones when fresh exist', () => {
    const now = 100 * 86400e3;
    const item = { seenPrices: { walmart: { price: 20, at: now }, samsclub: { price: 18, at: now - 60 * 86400e3 }, amazon: { price: 22, at: now } } };
    const { rows, best } = seenPrices(item, now);
    expect(rows.map((r) => r.storeId)).toEqual(['samsclub', 'amazon', 'walmart']);
    expect(best.storeId).toBe('walmart');
  });
});

import { pickQuotes, storeIdFor, fitsQuery, directUrl, linkHost, isBlockedSeller } from './storeMatch.js';
import { mergeQuotes } from './prices.js';
import { describePrediction as describe2 } from './predict.js';

describe('automatic price lookup', () => {
  it('matches store names from shopping results', () => {
    expect(storeIdFor("Sam's Club")).toBe('samsclub');
    expect(storeIdFor('Amazon.com - Seller')).toBe('amazon');
    expect(storeIdFor('Walmart - Seller')).toBe('walmart');
    expect(storeIdFor('Kroger')).toBe(null);
  });
  it('keeps the cheapest result per store and the cheapest elsewhere', () => {
    const q = pickQuotes([
      { source: 'Walmart', extracted_price: 24.97, title: 'A', product_link: 'https://x/1' },
      { source: 'Walmart', extracted_price: 21.5, title: 'B' },
      { source: "Sam's Club", price: '$22.98' },
      { source: 'Kroger', extracted_price: 19.99, product_link: 'javascript:alert(1)' },
      { source: 'Meijer', extracted_price: 25 },
      { source: 'Bad', extracted_price: 0 },
      { source: 'Evil', extracted_price: 5, product_link: 'javascript:alert(1)' },
    ]);
    const by = Object.fromEntries(q.map((x) => [x.storeId, x]));
    expect(by.walmart.price).toBe(21.5);
    expect(by.samsclub.price).toBe(22.98);
    expect(by.any.storeName).toBe('Kroger');
    expect(by.any.url).toBe(null);
  });
  it('skips knock-offs and other models', () => {
    const q = pickQuotes([
      { source: 'Amazon.com', title: 'Compatible PG-240XL ink cartridge for Canon', extracted_price: 12.99 },
      { source: 'Walmart', title: 'Canon PG-243 Black Ink', extracted_price: 15.99 },
      { source: 'Walmart', title: 'Canon PG-240XL Black Ink Cartridge', extracted_price: 34.99 },
      { source: 'Amazon.com', title: 'Canon PG 240 XL Black', extracted_price: 36.49 },
    ], 'Canon cartridge 240XL');
    const by = Object.fromEntries(q.map((x) => [x.storeId, x]));
    expect(by.walmart.price).toBe(34.99);
    expect(by.amazon.price).toBe(36.49);
    expect(fitsQuery('Compatible ink', 'compatible ink')).toBe(true);
  });
  it('links to the store page when there is one', () => {
    expect(directUrl({ link: 'https://www.walmart.com/ip/123', product_link: 'https://www.google.com/shopping/product/9' })).toBe('https://www.walmart.com/ip/123');
    expect(directUrl({ link: 'https://www.google.com/aclk?x', product_link: 'https://www.google.com/shopping/product/9' })).toBe('https://www.google.com/shopping/product/9');
    expect(directUrl({ link: 'javascript:alert(1)' })).toBe(null);
    expect(linkHost('https://www.walmart.com/ip/123')).toBe('walmart.com');
  });
  it('never shows eBay prices', () => {
    const q = pickQuotes([
      { source: 'eBay - go-ink', extracted_price: 14.45, title: 'Canon PG-240XL' },
      { source: 'Some shop', extracted_price: 13, title: 'Canon PG-240XL', link: 'https://www.ebay.com/itm/1' },
      { source: 'Walmart', extracted_price: 32.99, title: 'Canon PG-240XL' },
    ], 'Canon PG-240XL');
    expect(q.map((x) => x.storeId)).toEqual(['walmart']);
    expect(isBlockedSeller('eBay - go-ink')).toBe(true);
    const { best, rows } = seenPrices({ seenPrices: { any: { price: 14.45, at: Date.now(), by: 'auto', storeName: 'eBay - go-ink' }, walmart: { price: 32.99, at: Date.now(), by: 'auto' } } });
    expect(rows.length).toBe(1);
    expect(best.price).toBe(32.99);
  });
  it('only takes cheapest elsewhere from large US retailers', () => {
    const q = pickQuotes([
      { source: 'Printwell Custom Printing Ottawa', extracted_price: 27.29, title: 'Canon PG-240XL' },
      { source: 'Staples', extracted_price: 30.49, title: 'Canon PG-240XL' },
    ], 'Canon PG-240XL');
    expect(q.map((x) => x.storeName)).toEqual(['Staples']);
  });
  it('ignores prices the old demo made up', () => {
    const { rows } = seenPrices({ seenPrices: { amazon: { price: 9, at: Date.now(), by: 'sample' } } });
    expect(rows.length).toBe(0);
  });
  it('does not overwrite a price someone typed today', () => {
    const now = 10 * 86400e3;
    const seen = { walmart: { price: 20, at: now - 3600e3, by: 'Sola' }, amazon: { price: 30, at: now - 3 * 86400e3, by: 'Sola' } };
    const out = mergeQuotes(seen, [{ storeId: 'walmart', price: 25, by: 'auto' }, { storeId: 'amazon', price: 28, by: 'auto' }, { storeId: 'nope', price: 1 }], now);
    expect(out.walmart.price).toBe(20);
    expect(out.amazon.price).toBe(28);
    expect(out.nope).toBeUndefined();
  });
  it('says when something runs out in plain words', () => {
    expect(describe2({ basis: 'history', daysLeft: 3 })).toBe('Runs out in 3 days');
    expect(describe2({ basis: 'history', daysLeft: 0.2 })).toBe('Runs out today');
    expect(describe2({ basis: 'history', daysLeft: -2 })).toBe('Ran out 2 days ago');
  });
});

import { refreshPrices, canLookUpAgain } from '../data/actions.js';
import { registerPriceProvider } from './prices.js';
describe('saving searches', () => {
  it('looks up only when asked, at most once a day per item', async () => {
    let calls = 0;
    registerPriceProvider({ id: 't', by: 'auto', quote: async () => { calls += 1; return [{ storeId: 'walmart', storeName: 'Walmart', price: 10 }]; } });
    const backend = { update: async () => {} };
    const now = Date.now();
    const ctx = { backend, accountId: 'x', items: [] };
    expect((await refreshPrices(ctx, { id: 'a', name: 'Milk', pricesCheckedAt: now - 3600e3 })).recent).toBe(true);
    expect(calls).toBe(0);
    expect(canLookUpAgain({ pricesCheckedAt: now - 25 * 3600e3 })).toBe(true);
    await refreshPrices(ctx, { id: 'a', name: 'Milk', pricesCheckedAt: null });
    expect(calls).toBe(1);
  });
});

import { planTrips, deptOf } from './tripPlan.js';
describe('trip planner', () => {
  const stores = [
    { id: 'g', type: 'grocery', place: 'Monrovia', miles: 2 },
    { id: 'w', type: 'walmart', place: 'Frederick', miles: 9 },
    { id: 'a', type: 'autoparts', place: 'Frederick', miles: 8 },
  ];
  const items = [{ id: 1, name: 'Oranges' }, { id: 2, name: 'Bananas' }, { id: 3, name: 'Milk' }, { id: 4, name: 'Engine oil' }];
  it('files engine oil under car items, not cooking oil', () => {
    expect(deptOf({ name: 'Engine oil', category: 'Pantry' })).toBe('auto');
    expect(deptOf({ name: 'Olive oil' })).toBe('grocery');
  });
  it('makes one run at the store that has everything', () => {
    const { stops, unplaced } = planTrips(items, stores);
    expect(stops.length).toBe(1);
    expect(stops[0].store.id).toBe('w');
    expect(unplaced.length).toBe(0);
  });
  it('picks the nearer store on a tie', () => {
    const { stops } = planTrips(items.slice(0, 3), stores);
    expect(stops[0].store.id).toBe('g');
  });
  it('keeps an item pinned with @store at that store', () => {
    const { stops } = planTrips([...items, { id: 5, name: 'Wipers', store: 'Auto parts' }], stores);
    expect(stops.map((s) => s.store.id).sort()).toEqual(['a', 'w']);
  });
});

import { markOrdered } from '../data/actions.js';
describe('ordered by mistake', () => {
  it('undo puts items back on the list and removes the order', async () => {
    const commits = [];
    const backend = { newId: () => 'b1', commit: async (a, ops) => commits.push(ops) };
    const ctx = { backend, accountId: 'x', user: { uid: 'u', name: 'Sola' } };
    const undo = await markOrdered(ctx, 'Costco', [{ id: 'i1', name: 'Ink', status: 'needed' }]);
    await undo();
    const ops = commits[1];
    expect(ops[0]).toEqual({ type: 'remove', coll: 'batches', id: 'b1' });
    expect(ops[1].data).toEqual({ status: 'needed', batchId: null });
  });
});

import { carries, isSpecific } from './tripPlan.js';
describe('specific products', () => {
  const costco = { id: 'c', type: 'costco', miles: 10 };
  const walmart = { id: 'w', type: 'walmart', miles: 12 };
  const staples = { id: 's', type: 'office', miles: 14 };
  const ink = { id: 1, name: 'Canon PG-240XL ink' };
  it('needs proof before sending a model number to a store', () => {
    expect(isSpecific(ink)).toBe(true);
    expect(isSpecific({ name: 'Milk', note: '2 gal' })).toBe(false);
    expect(isSpecific({ name: 'Bounty paper towels', note: '12 rolls' })).toBe(false);
    expect(carries(costco, ink)).toBe(false);
    expect(carries(staples, ink)).toBe(true);
    expect(carries(walmart, { ...ink, seenPrices: { walmart: { price: 32.99 } } })).toBe(true);
  });
  it('lists it as not sure when no saved store has proof', () => {
    const { stops, unplaced } = planTrips([ink], [costco, walmart]);
    expect(stops.length).toBe(0);
    expect(unplaced.length).toBe(1);
  });
});

import { parseQr } from './qr.js';
describe('receipt QR codes', () => {
  it('reads a store link and its date and total', () => {
    const q = parseQr('https://www.walmart.com/receipt-lookup?date=2026-11-20&total=42.17&tc=1234');
    expect(q.store).toBe('Walmart');
    expect(q.url).toContain('walmart.com');
    expect(q.total).toBe(42.17);
    expect(new Date(q.date).getDate()).toBe(20);
  });
  it('reads plain text codes', () => {
    const q = parseQr('STORE 1234|DATE:11/20/2026|TOTAL:19.99');
    expect(q.url).toBe('');
    expect(q.total).toBe(19.99);
    expect(new Date(q.date).getMonth()).toBe(10);
  });
  it('ignores links that are not web links, and future dates', () => {
    expect(parseQr('javascript:alert(1)').url).toBe('');
    expect(parseQr('date=2099-01-01').date).toBe(null);
    expect(parseQr('')).toBe(null);
  });
});

import { themeOf, sharedThemes } from './themes.js';
describe('theme groups', () => {
  it('groups two Christmas items but not a lone one', () => {
    const list = [
      { id: 1, name: 'Christmas lights for the house' },
      { id: 2, name: 'Christmas tree ornaments' },
      { id: 3, name: 'Cheerios' },
      { id: 4, name: 'Balloons' },
    ];
    const t = sharedThemes(list);
    expect(t.get(1)).toBe('Christmas');
    expect(t.get(2)).toBe('Christmas');
    expect(t.has(3)).toBe(false);
    expect(t.has(4)).toBe(false);
    expect(themeOf({ name: 'Balloons' })).toBe('Birthday party');
  });
  it('does not match part of a word', () => {
    expect(themeOf({ name: 'Tentacles' })).toBe(null);
    expect(themeOf({ name: 'Garden hose' })).toBe('Garden');
  });
  it('places cereal and deli meat', () => {
    expect(guessCategory('Cheerios')).toBe('Pantry');
    expect(guessCategory('Deli sandwich meat')).toBe('Meat & seafood');
  });
});

import { matchKind, findDuplicates } from './dupes.js';

describe('duplicate check', () => {
  it('sees the same item in another spelling or plural', () => {
    expect(matchKind('Paper towels', 'paper towel')).toBe('same');
    expect(matchKind('a bag of apples', 'Apples')).toBe('same');
  });
  it('flags near matches', () => {
    expect(matchKind('milk', '2% milk')).toBe('close');
    expect(matchKind('bananna', 'banana')).toBe('close');
    expect(matchKind('Christmas lights', 'Christmas lights outdoor')).toBe('close');
  });
  it('leaves different items alone', () => {
    expect(matchKind('milk', 'chocolate chips')).toBe(null);
    expect(matchKind('eggs', 'eggplant')).toBe(null);
    expect(matchKind('ink', 'pink')).toBe(null);
    expect(matchKind('Canon PG-240XL ink', 'Canon CL-241XL ink')).toBe(null);
  });
  it('checks the list and the entries themselves', () => {
    const list = [{ id: '1', name: 'Milk' }];
    const d = findDuplicates([{ name: 'milk' }, { name: 'bread' }, { name: 'Bread' }], list);
    expect(d.map((x) => [x.entry.name, x.kind, x.onList])).toEqual([['milk', 'same', true], ['Bread', 'same', false]]);
  });
});
