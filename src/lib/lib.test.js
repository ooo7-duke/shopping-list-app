import { describe, it, expect } from 'vitest';
import { parseQuickAdd, parseEntry } from './parse.js';
import { predictItem, DAY } from './predict.js';
import { bestMatch, expandLine } from './match.js';
import { guessCategory, ORG_CATEGORIES, foldCategory, householdCategories } from './categories.js';

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
    expect(guessCategory('2% milk')).toBe('Meat, dairy & eggs');
    expect(guessCategory('Paper towels')).toBe('Household');
    expect(guessCategory('Tissue paper')).toBe('Household');
    expect(guessCategory('Bread')).toBe('Pantry');
    expect(guessCategory('Shampoo')).toBe('Health & personal care');
    expect(foldCategory('Snacks')).toBe('Pantry');
    expect(foldCategory('Snacks', ORG_CATEGORIES)).toBe('Snacks');
    expect(householdCategories(['Produce', 'Dairy & eggs', 'Paper goods', 'Garden', 'Other'])).toEqual(['Produce', 'Meat, dairy & eggs', 'Frozen', 'Pantry', 'Household', 'Health & personal care', 'Pets', 'Electronics', 'Garden', 'Other']);
    expect(guessCategory('Paper towels', ORG_CATEGORIES)).toBe('Paper goods');
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

import { planTrips, deptOf, storeLabel } from './tripPlan.js';
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
  it('lets you name your own store and move items to it', () => {
    const mine = [...stores, { id: 'h', type: 'other', name: 'H-Mart', place: 'Frederick', miles: 12 }];
    expect(storeLabel(mine[3])).toBe('H-Mart · Frederick');
    const { stops } = planTrips([...items, { id: 6, name: 'Tilapia', store: 'H-Mart · Frederick' }], mine);
    expect(stops.find((s) => s.store.id === 'h').items.map((i) => i.name)).toEqual(['Tilapia']);
    // A store with no kind gets nothing on its own.
    expect(planTrips(items, [mine[3]]).stops.length).toBe(0);
  });
  it('keeps a named grocery store apart from another grocery store', () => {
    const two = [{ id: 'g', type: 'grocery', name: 'Giant', miles: 2 }, { id: 'h', type: 'grocery', name: 'H-Mart', miles: 12 }];
    const { stops } = planTrips([{ id: 1, name: 'Milk', store: 'Giant' }, { id: 2, name: 'Tilapia', store: 'H-Mart' }], two);
    expect(stops.map((s) => [s.store.id, s.items.length]).sort()).toEqual([['g', 1], ['h', 1]]);
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
    expect(guessCategory('Deli sandwich meat')).toBe('Meat, dairy & eggs');
  });
});

import { matchKind, findDuplicates, listMatches } from './dupes.js';

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
    expect(matchKind('coffee', 'toffee')).toBe(null);
    expect(matchKind('pasta', 'paste')).toBe(null);
    expect(matchKind('butter', 'batter')).toBe(null);
  });
  it('checks the list and the entries themselves', () => {
    const list = [{ id: '1', name: 'Milk' }];
    const d = findDuplicates([{ name: 'milk' }, { name: 'bread' }, { name: 'Bread' }], list);
    expect(d.map((x) => [x.entry.name, x.kind, x.onList])).toEqual([['milk', 'same', true], ['Bread', 'same', false]]);
  });
  it('finds list items while the name is still being typed', () => {
    const list = [{ name: 'Salsa' }, { name: 'Salt' }, { name: 'Sea salt' }, { name: 'Paper towels' }, { name: 'Toilet paper' }];
    expect(listMatches('sal', list).map((x) => x.name)).toEqual(['Salsa', 'Salt', 'Sea salt']);
    expect(listMatches('salt', list).map((x) => x.name)).toEqual(['Salt', 'Sea salt']);
    expect(listMatches('paper', list).map((x) => x.name)).toEqual(['Paper towels', 'Toilet paper']);
    expect(listMatches('toilet pa', list).map((x) => x.name)).toEqual(['Toilet paper']);
    expect(listMatches('s', list)).toEqual([]);
    expect(listMatches('milk', list)).toEqual([]);
  });
});

import { pickCategories } from './classify.js';

describe('sorting items into types', () => {
  it('knows common groceries by keyword', () => {
    expect(guessCategory('French Fries')).toBe('Frozen');
    expect(guessCategory('Cheerios')).toBe('Pantry');
    expect(guessCategory('Eggplant')).toBe('Produce');
    expect(guessCategory('Sports drink')).toBe('Pantry');
    expect(guessCategory('Aluminum foil')).toBe('Household');
    expect(guessCategory('Canon PG-240XL ink')).toBe('Household');
  });
  it('keeps only AI answers for items asked about and types on the list', () => {
    const m = pickCategories({ items: [
      { name: 'french fries', category: 'frozen' },
      { name: 'Cheerios', category: 'Breakfast' },
      { name: 'Something else', category: 'Pantry' },
    ] }, ['French fries', 'Cheerios'], ['Frozen', 'Pantry', 'Other']);
    expect([...m]).toEqual([['French fries', 'Frozen']]);
  });
});

import { checkSubmission } from './feedbackCheck.js';
describe('feedback spam checks', () => {
  const now = 1_800_000_000_000;
  const base = { kind: 'feedback', message: 'Love the app, please add H-Mart', email: 'a@b.com', startedAt: now - 20000 };
  it('keeps a real message', () => {
    expect(checkSubmission(base, { now }).ok).toBe(true);
  });
  it('drops the honeypot, a form filled too fast, and link spam', () => {
    expect(checkSubmission({ ...base, website: 'http://spam' }, { now }).drop).toBe(true);
    expect(checkSubmission({ ...base, startedAt: now - 1000 }, { now }).drop).toBe(true);
    expect(checkSubmission({ ...base, message: 'buy http://a http://b http://c' }, { now }).drop).toBe(true);
  });
  it('asks for an email from people who are not signed in', () => {
    expect(checkSubmission({ ...base, email: '' }, { now }).error).toBeTruthy();
    expect(checkSubmission({ ...base, email: '', startedAt: now }, { now, signedIn: true }).ok).toBe(true);
  });
  it('lets a deletion request have no message', () => {
    expect(checkSubmission({ ...base, kind: 'delete', message: '' }, { now }).ok).toBe(true);
  });
});

import { LOOKS, contrast } from './looks.js';
import { rememberStoreKinds } from './tripPlan.js';

describe('color looks', () => {
  it('offers five looks whose text pairs all reach 4.5:1', () => {
    expect(LOOKS).toHaveLength(5);
    for (const l of LOOKS) {
      const v = l.vars;
      const pairs = [['bb-ink', 'cream'], ['bb-ink', 'card'], ['bb', 'cream'], ['bb', 'card'], ['muted', 'cream'], ['muted', 'card'], ['on-gold', 'gold'], ['gold-ink', 'gold-soft'], ['gold-ink', 'card'], ['cream', 'bb'], ['bb', 'bb-soft'], ['bb-ink', 'bb-soft'], ['bb-ink', 'gold-soft'], ['cream', 'bb-ink']];
      for (const [a, b] of pairs) expect(contrast(v[a], v[b]), `${l.id} ${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('remembered stores', () => {
  it('puts new names first, keeps each name once and skips blank names', () => {
    const prev = [{ name: 'H-Mart', type: 'other' }, { name: 'Giant', type: 'grocery' }];
    const rows = [{ name: 'Lidl', type: 'grocery' }, { name: 'giant', type: 'grocery' }, { name: '', type: 'walmart' }];
    expect(rememberStoreKinds(prev, rows).map((k) => k.name)).toEqual(['Lidl', 'giant', 'H-Mart']);
  });
});

import { refurbQuote, isCertifiedRefurb } from './storeMatch.js';
import { refurbPrice } from './prices.js';
describe('certified refurbished prices', () => {
  const results = [
    { title: 'Apple AirPods Pro 2 (Renewed Premium)', source: 'Amazon.com', extracted_price: 169.99, link: 'https://www.amazon.com/dp/x' },
    { title: 'Apple AirPods Pro 2 - Open Box', source: 'Best Buy', extracted_price: 150, link: 'https://www.bestbuy.com/x' },
    { title: 'Apple AirPods Pro 2 Refurbished', source: 'Gadget Bargains LLC', extracted_price: 120, link: 'https://gadgetbargains.example/x' },
    { title: 'Apple AirPods Pro 2 used good condition', source: 'Walmart', extracted_price: 110, link: 'https://www.walmart.com/x' },
    { title: 'Apple AirPods Pro 2', source: 'Target', extracted_price: 199.99, link: 'https://www.target.com/x' },
  ];
  it('counts only certified programs from makers or major retailers', () => {
    expect(isCertifiedRefurb(results[0])).toBe(true);
    expect(isCertifiedRefurb(results[1])).toBe(false); // open box
    expect(isCertifiedRefurb(results[2])).toBe(false); // unknown seller
    expect(isCertifiedRefurb(results[3])).toBe(false); // used
    expect(isCertifiedRefurb(results[4])).toBe(false); // new
  });
  it('picks the refurbished quote and keeps it out of the new prices', () => {
    const q = refurbQuote(results, 'AirPods Pro 2');
    expect(q).toMatchObject({ storeId: 'refurb', price: 169.99, condition: 'Certified refurbished' });
    const quotes = pickQuotes(results, 'AirPods Pro 2');
    expect(quotes.find((x) => x.storeId === 'refurb')?.price).toBe(169.99);
    expect(quotes.find((x) => x.storeId === 'target')?.price).toBe(199.99);
  });
  it('stores the refurbished price beside the new ones', () => {
    const now = Date.now();
    const item = { seenPrices: mergeQuotes({}, pickQuotes(results, 'AirPods Pro 2'), now) };
    expect(refurbPrice(item, now)).toMatchObject({ price: 169.99 });
    expect(seenPrices(item).best.price).toBe(199.99);
  });
});

import { forwarderOf, planLines, alreadySaved, isForwardingConfirmation, keyPart } from './inbox.js';

describe('emailed receipts', () => {
  it('files a receipt under the person who forwarded it', () => {
    expect(forwarderOf('Sola O <Sola@Example.com>', '')).toBe('sola@example.com');
    // A Gmail filter keeps the store as From and names the forwarder in X-Forwarded-For.
    expect(forwarderOf('Amazon <auto-confirm@amazon.com>', 'sola@example.com loye10shopping@gmail.com')).toBe('sola@example.com');
    expect(isForwardingConfirmation('Gmail Team <forwarding-noreply@google.com>')).toBe(true);
    expect(keyPart('A/B..c@x.com')).toBe('ab..c@x.com');
  });
  it('checks off strong matches and holds weak guesses', () => {
    const items = [{ id: 'a', name: 'Paper towels' }, { id: 'b', name: 'Sticky notes' }];
    const res = { items: [
      { rawText: 'Bounty 12 rolls', name: 'Paper towels', matchName: 'Paper towels', category: 'Cleaning' },
      { rawText: 'Post-it Super Sticky Notes, 3x3 in, 12 Pads', name: 'Post-it super sticky notes, 12 pads', matchName: '' },
      { rawText: 'Birthday card', name: 'Birthday card', matchName: '' },
    ] };
    const plan = planLines(res, items);
    expect(plan.lines[0]).toMatchObject({ itemId: 'a', weak: false, category: 'Household' });
    expect(plan.lines[1]).toMatchObject({ itemId: 'b', weak: true });
    expect(plan.lines[2]).toMatchObject({ itemId: '', weak: false });
    expect(plan.weak).toBe(1);
  });
  it('spots an order that is already saved', () => {
    const receipts = [{ store: 'Amazon', orderId: '113-55', emailId: 'x1' }];
    expect(alreadySaved(receipts, { emailId: 'x1' })).toBe(true);
    expect(alreadySaved(receipts, { emailId: 'x2', orderId: '113 55', store: 'amazon' })).toBe(true);
    expect(alreadySaved(receipts, { emailId: 'x2', orderId: '113-56', store: 'Amazon' })).toBe(false);
  });
});

describe('electronics and fewer items in Other', () => {
  it('sorts phones into Electronics and holiday lights into Household', async () => {
    const { guessCategory, foldCategory } = await import('./categories.js');
    expect(guessCategory('Samsung Galaxy S26')).toBe('Electronics');
    expect(guessCategory('Christmas lights for the house')).toBe('Household');
    expect(guessCategory('Christmas cookies')).toBe('Pantry');
    expect(guessCategory('potatoes')).toBe('Produce');
    expect(guessCategory('extension cord')).toBe('Household');
    expect(foldCategory('Tech & electronics')).toBe('Electronics');
  });
  it('sends Electronics items to an electronics store on a trip', async () => {
    const { deptOf } = await import('./tripPlan.js');
    expect(deptOf({ name: 'Mystery gadget', category: 'Electronics' })).toBe('electronics');
    expect(deptOf({ name: 'Samsung Galaxy S26', category: 'Other' })).toBe('electronics');
  });
});

describe('snooze lengths', () => {
  it('offers a day to a month, a month being a calendar month', async () => {
    const { SNOOZE_CHOICES, snoozeEnd } = await import('../data/actions.js');
    expect(SNOOZE_CHOICES.map((c) => c.label)).toEqual(['1 day', '3 days', '1 week', '2 weeks', '1 month']);
    const nov27 = new Date(2026, 10, 27, 9).getTime();
    expect(new Date(snoozeEnd({ days: 14 }, nov27)).getDate()).toBe(11);
    expect(new Date(snoozeEnd({ months: 1 }, nov27)).toDateString()).toBe(new Date(2026, 11, 27, 9).toDateString());
    const jan31 = new Date(2027, 0, 31, 9).getTime();
    expect(new Date(snoozeEnd({ months: 1 }, jan31)).toDateString()).toBe(new Date(2027, 1, 28).toDateString());
  });
});

import { guessStoreType } from './tripPlan.js';
describe('store name only', () => {
  it('reads what a store sells from its name', () => {
    expect(guessStoreType('Costco')).toBe('costco');
    expect(guessStoreType('Giant')).toBe('grocery');
    expect(guessStoreType('H-Mart')).toBe('grocery');
    expect(guessStoreType('Home Depot')).toBe('hardware');
    expect(guessStoreType('Office store')).toBe('office');
    expect(guessStoreType('Walmart Neighborhood Market')).toBe('walmart_market');
    expect(guessStoreType('Walmart')).toBe('walmart');
    expect(guessStoreType('CVS')).toBe('pharmacy');
    expect(guessStoreType("Sam's Club")).toBe('samsclub');
    expect(guessStoreType('Best Buy')).toBe('electronics');
  });
  it('treats a name it does not know as an Other store', () => {
    expect(guessStoreType("Bob's")).toBe('other');
    expect(guessStoreType('')).toBe('other');
  });
});

import { aiErrorMessage, aiErrorDetail } from './errors.js';
describe('AI error messages', () => {
  const url = 'https://firebasevertexai.googleapis.com/v1beta/projects/p/models/gemini-2.5-flash:generateContent';
  const fetchErr = (status, msg, extra = '') => Object.assign(new Error(`AI: Error fetching from ${url}: [${status} ] ${msg}${extra} (AI/fetch-error)`), { code: 'fetch-error', customErrorData: { status } });
  it('does not blame setup for every error just because of the address', () => {
    const m = aiErrorMessage(fetchErr(401, 'Firebase App Check token is invalid.'));
    expect(m).toMatch(/App Check/);
    expect(m).not.toMatch(/isn't turned on/);
    expect(m).toMatch(/Details: 401: Firebase App Check token is invalid\./);
    expect(m).not.toMatch(/googleapis/);
  });
  it('says turned off only for the real api-not-enabled error', () => {
    const e = Object.assign(new Error('AI: The Firebase AI SDK requires ... (AI/api-not-enabled)'), { code: 'api-not-enabled', customErrorData: { status: 403 } });
    expect(aiErrorMessage(e)).toMatch(/isn't turned on yet/);
  });
  it('names limits, permissions and bad photos', () => {
    expect(aiErrorMessage(fetchErr(429, 'Resource has been exhausted'))).toMatch(/busy/);
    expect(aiErrorMessage(fetchErr(403, 'Method doesn\'t allow unregistered callers', ' [{"@type":"x"}]'))).toMatch(/refused by Google/);
    expect(aiErrorMessage(fetchErr(400, 'Unable to process input image'))).toMatch(/couldn't use that photo/);
    expect(aiErrorDetail(fetchErr(403, 'Denied', ' [{"@type":"x"}]'))).toBe('403: Denied');
  });
  it('spots a dropped connection', () => {
    const e = Object.assign(new Error(`AI: Error fetching from ${url}: Failed to fetch (AI/error)`), { code: 'error' });
    expect(aiErrorMessage(e)).toMatch(/internet connection/);
  });
});

describe('AI retries', async () => {
  const { withRetry, isRetryable, isModelMissing } = await import('./ai.js');
  const busy = Object.assign(new Error('AI: Error fetching: [500 ] This model is currently experiencing high demand. (AI/fetch-error)'), { customErrorData: { status: 500 } });
  const sleep = () => Promise.resolve();

  it('retries a busy model and returns the answer', async () => {
    let n = 0;
    const out = await withRetry(async (m) => { n++; if (n < 3) throw busy; return m; }, { models: ['main', 'backup'], sleep });
    expect(out).toBe('main');
    expect(n).toBe(3);
  });

  it('moves to the backup model when the main one stays busy', async () => {
    const seen = [];
    const out = await withRetry(async (m) => { seen.push(m); if (m === 'main') throw busy; return 'ok'; }, { models: ['main', 'backup'], sleep });
    expect(out).toBe('ok');
    expect(seen).toEqual(['main', 'main', 'main', 'backup']);
  });

  it('goes straight to the backup model when the main one is retired', async () => {
    const gone = Object.assign(new Error('models/x is no longer available'), { customErrorData: { status: 404 } });
    const seen = [];
    await withRetry(async (m) => { seen.push(m); if (m === 'main') throw gone; return 'ok'; }, { models: ['main', 'backup'], sleep });
    expect(seen).toEqual(['main', 'backup']);
  });

  it('does not retry errors a retry cannot fix', async () => {
    const bad = Object.assign(new Error('bad photo'), { customErrorData: { status: 400 } });
    let n = 0;
    await expect(withRetry(async () => { n++; throw bad; }, { models: ['main', 'backup'], sleep })).rejects.toBe(bad);
    expect(n).toBe(1);
  });

  it('throws the last error after every try fails', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw busy; }, { models: ['main', 'backup'], sleep })).rejects.toBe(busy);
    expect(n).toBe(5);
  });

  it('sorts errors', () => {
    expect(isRetryable(busy)).toBe(true);
    expect(isRetryable({ customErrorData: { status: 429 } })).toBe(true);
    expect(isRetryable({ customErrorData: { status: 403 } })).toBe(false);
    expect(isModelMissing({ customErrorData: { status: 404 } })).toBe(true);
  });
});

import { tripDays, perDiemDays, businessAmount, expenseFlags, tripTotals, expensesCSV, emailTrip, matchTrip, normalizeRead, fromDayKey, autoCaption, captionFor, expenseWorkbook, paidWithLabel, paidWithId } from './expenses.js';
import { xlsxBytes, colName } from './xlsx.js';
describe('expense reports', () => {
  const d = (s) => fromDayKey(s);
  const trip = { id: 't1', name: 'CES 2027', location: 'Las Vegas, NV', startDate: d('2027-01-05'), endDate: d('2027-01-09'), mealsMode: 'actual' };

  it('lists every day of the trip, first to last', () => {
    expect(tripDays(trip)).toEqual(['2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09']);
  });

  it('gives 75% per diem on the first and last day and takes off provided meals', () => {
    const days = perDiemDays({ ...trip, mealsMode: 'perDiem', mieRate: 92, mealsProvided: { '2027-01-07': ['lunch'] } });
    expect(days.map((x) => x.amount)).toEqual([69, 92, 66, 92, 69]);
  });

  it('claims only the business nights of a hotel stay', () => {
    const nights = [1, 2, 3, 4, 5].map((i) => ({ date: d(`2027-01-0${i + 4}`), amount: 200, personal: i === 5 }));
    expect(businessAmount({ amount: 1000, nights })).toBe(800);
    expect(businessAmount({ amount: 50, business: 20 })).toBe(20);
    expect(businessAmount({ amount: 50 })).toBe(50);
  });

  it('flags a missing receipt, a duplicate and a date outside the trip', () => {
    const a = { id: 'a', tripId: 't1', category: 'dinner', merchant: 'Lotus of Siam', date: d('2027-01-06'), amount: 80, imageIds: ['x'] };
    const b = { ...a, id: 'b', imageIds: [] };
    const late = { id: 'c', tripId: 't1', category: 'ground', merchant: 'Uber', date: d('2027-01-12'), amount: 20, imageIds: ['y'] };
    const early = { id: 'e', tripId: 't1', category: 'airfare', merchant: 'Delta', date: d('2026-12-01'), amount: 400, imageIds: ['z'] };
    const codes = (e) => expenseFlags(e, [a, b, late, early], trip).map((f) => f.code);
    expect(codes(b)).toEqual(['receipt', 'duplicate']);
    expect(codes(late)).toEqual(['dates']);
    expect(codes(early)).toEqual([]); // airfare is booked ahead
    expect(expenseFlags({ ...b, amount: 12, merchant: 'Cafe' }, [], trip)[0]).toMatchObject({ code: 'receipt', level: 'info' });
  });

  it('works out what is owed: every business dollar, however it was paid', () => {
    const list = [
      { id: '1', category: 'lodging', amount: 1000, nights: [{ amount: 800 }, { amount: 200, personal: true }] },
      { id: '2', category: 'airfare', amount: 400, paidWith: 'cash' },
      { id: '3', category: 'dinner', amount: 50 },
    ];
    const t = tripTotals(trip, list);
    expect(t).toMatchObject({ spent: 1450, business: 1250, personal: 200, owedToYou: 1250 });
    expect(t).not.toHaveProperty('companyCard');
    const pd = tripTotals({ ...trip, mealsMode: 'perDiem', mieRate: 68 }, list);
    expect(pd.perDiem).toBe(51 + 68 * 3 + 51);
    expect(pd.owedToYou).toBe(800 + 400 + 306);
  });

  it('names how an expense was paid, reading old company card entries as Other', () => {
    expect(['personal', 'cash', 'other', 'corporate', undefined].map(paidWithLabel)).toEqual(['Personal card', 'Cash', 'Other', 'Other', 'Personal card']);
    expect(paidWithId('corporate')).toBe('other');
  });

  it('writes a CSV that a spreadsheet will not run as a formula', () => {
    const csv = expensesCSV(trip, [{ id: '1', category: 'supplies', merchant: '=HYPERLINK("x")', date: d('2027-01-04'), amount: 86.4, notes: 'Brochures, sell sheets' }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Brochures, sell sheets"');
    expect(csv).toContain('Owed to you,86.40');
  });

  it('routes a hotel email in the trip window to the trip, and leaves a grocery order alone', () => {
    const hotel = { id: 'h', from: 'Wynn <folio@wynnlasvegas.com>', subject: 'Your hotel folio', date: d('2027-01-09') };
    const grocery = { id: 'g', from: 'Target <orders@target.com>', subject: 'Your Target order', date: d('2026-12-10') };
    const flight = { id: 'f', from: 'Delta <delta@delta.com>', subject: 'Your eTicket itinerary: Washington to Las Vegas', date: d('2026-11-20') };
    expect(emailTrip(hotel, [trip], [])?.id).toBe('t1');
    expect(emailTrip(grocery, [trip], [])).toBeNull();
    expect(emailTrip(flight, [trip], [])?.id).toBe('t1');
    expect(emailTrip(hotel, [{ ...trip, status: 'submitted' }], [])).toBeNull();
  });

  it('weighs dates, place and what was bought, and says why', () => {
    const mail = (subject, day, from = 'Store <orders@example.com>') => ({ id: subject, from, subject, date: d(day) });
    // A flight naming the trip's city, booked six weeks ahead.
    expect(matchTrip(mail('Your flight to Las Vegas is confirmed', '2026-11-22'), [trip], [])?.why).toMatch(/Las Vegas, 6 weeks before/);
    // The same flight with no place named, six weeks ahead, could be any trip.
    expect(matchTrip(mail('Your flight is confirmed', '2026-11-22'), [trip], [])).toBeNull();
    // Networking gear the week before the show.
    expect(matchTrip(mail('Your order: 24-port network switch and Cat6 cables', '2027-01-01'), [trip], [])?.why).toMatch(/gear, 4 days before/);
    // The same gear a month before is too early to call.
    expect(matchTrip(mail('Your order: 24-port network switch and Cat6 cables', '2026-12-05'), [trip], [])).toBeNull();
    // A purchase a week or two after the show ended is not for the show.
    expect(matchTrip(mail('Your order: network switch', '2027-01-20'), [trip], [])).toBeNull();
    expect(matchTrip(mail('Your Uber receipt', '2027-01-17'), [trip], [])).toBeNull();
    // A hotel's final bill a couple of days after checkout still counts.
    expect(matchTrip(mail('Your folio', '2027-01-11', 'Wynn Las Vegas <folio@wynnlasvegas.com>'), [trip], [])?.why).toMatch(/2 days after/);
    // A show name in the subject counts like the city.
    expect(matchTrip(mail('CES 2027 badge pickup and registration receipt', '2026-10-20'), [trip], [])?.why).toMatch(/CES/);
    // Of two trips, the nearer one wins a tie.
    const later = { ...trip, id: 't2', name: 'Later trip', startDate: d('2027-01-25'), endDate: d('2027-01-27') };
    expect(emailTrip(mail('Your Uber receipt', '2027-01-08'), [later, trip], [])?.id).toBe('t1');
  });

  it('leaves the dollar amount blank for a receipt in another currency', () => {
    const r = normalizeRead({ merchant: 'Tim Hortons', category: 'breakfast', total: 12.5, currency: 'cad', date: '2027-01-06', time: '7:45' });
    expect(r).toMatchObject({ amount: null, originalAmount: 12.5, originalCurrency: 'CAD', time: '07:45', category: 'breakfast' });
    expect(normalizeRead({ category: 'nonsense' }).category).toBe('other');
  });
  it('captions a receipt photo from what was read off it, and keeps a typed caption', () => {
    const hotel = { merchant: 'Hilton Long Beach', category: 'lodging', amount: 812.4, imageIds: ['a'],
      nights: [1, 2, 3, 4].map((i) => ({ date: d(`2027-09-1${i}`), amount: 203.1, personal: i === 4 })) };
    expect(autoCaption(hotel)).toBe('Hilton Long Beach, 4 nights (3 claimed), $812.40');
    expect(autoCaption({ merchant: 'Staples', category: 'supplies', summary: 'brochures', amount: 46.18 })).toBe('Staples, brochures, $46.18');
    expect(autoCaption({ merchant: 'Egg Works', category: 'breakfast', amount: 21.37 }, 1, 2)).toBe('Egg Works, Breakfast, $21.37, page 2 of 2');
    expect(captionFor({ ...hotel, captions: { a: 'Folio, night 4 was personal' } }, 'a')).toBe('Folio, night 4 was personal');
  });

  it('builds an Excel workbook whose totals match the trip', () => {
    const list = [
      { id: '1', category: 'airfare', merchant: 'Delta', date: d('2026-12-01'), amount: 450, paidWith: 'personal', imageIds: ['x'] },
      { id: '2', category: 'dinner', merchant: 'Bacchanal', date: d('2027-01-06'), amount: 80.5, business: 60, paidWith: 'personal' },
    ];
    const [summary, sheet] = expenseWorkbook(trip, list);
    expect(sheet.rows[0][0].v).toBe('Date');
    expect(sheet.rows[1][4].v).toBe('Delta, Airfare, $450.00');
    const total = sheet.rows[sheet.rows.length - 1];
    expect(total[5]).toMatchObject({ f: 'SUM(F2:F3)', v: 530.5 });
    expect(total[6]).toMatchObject({ f: 'SUM(G2:G3)', v: 510 });
    expect(summary.rows.at(-1)[2].v).toBe(510);
    const bytes = xlsxBytes([summary, sheet]);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(colName(0)).toBe('A');
    expect(colName(27)).toBe('AB');
  });
});

import { isRecentlyBought, takeOffList, markBought } from '../data/actions.js';
describe('Clear all and Remove from list log nothing as bought', () => {
  const now = Date.UTC(2026, 10, 28, 7, 0);
  it('a real purchase in the last day shows crossed off', () => {
    expect(isRecentlyBought({ status: 'stocked', lastPurchasedAt: now - 3600e3 }, now)).toBe(true);
  });
  it('an item bought earlier, put back, then removed does not show as bought', () => {
    expect(isRecentlyBought({ status: 'stocked', lastPurchasedAt: now - 3600e3, removedAt: now - 60e3 }, now)).toBe(false);
  });
  it('a purchase after a removal shows again', () => {
    expect(isRecentlyBought({ status: 'stocked', lastPurchasedAt: now - 60e3, removedAt: now - 3600e3 }, now)).toBe(true);
  });
  it('takeOffList writes no purchase, markBought writes one', async () => {
    const writes = [];
    const backend = {
      update: async (a, coll, id, data) => writes.push({ coll, id, data }),
      commit: async (a, ops) => ops.forEach((o) => writes.push(o)),
      newId: () => 'p1',
    };
    const ctx = { backend, accountId: 'a', user: { uid: 'u', name: 'Sola' } };
    await takeOffList(ctx, { id: 'i1', status: 'needed', lastPurchasedAt: now - 3600e3 });
    expect(writes.some((w) => w.coll === 'purchases')).toBe(false);
    expect(writes[0].data.status).toBe('stocked');
    expect(typeof writes[0].data.removedAt).toBe('number');
    await markBought(ctx, { id: 'i1', name: 'Milk', status: 'needed' });
    expect(writes.some((w) => w.coll === 'purchases')).toBe(true);
  });
});

import { takeBackOps } from '../data/actions.js';
describe('Got it today: delete selected purchases', () => {
  const now = Date.UTC(2026, 10, 28, 12);
  const item = { id: 'm', name: 'Milk', status: 'stocked', lastPurchasedAt: now - 3600e3, lastPrice: 3.69, lastQty: 1, lastStore: 'Giant' };
  const purchases = [
    { id: 'p1', itemId: 'm', purchasedAt: now - 3600e3, unitPrice: 3.69, qty: 1, store: 'Giant' },
    { id: 'p0', itemId: 'm', purchasedAt: now - 7200e3, unitPrice: 3.5, qty: 2, store: 'Giant' },
    { id: 'old', itemId: 'm', purchasedAt: now - 3 * DAY, unitPrice: 3.8, qty: 1, store: 'Target' },
    { id: 'x', itemId: 'other', purchasedAt: now - 60e3 },
  ];
  it('erases every purchase from the last day and keeps the item off the list', () => {
    const { ops } = takeBackOps(item, purchases, 'gone', now);
    expect(ops.filter((o) => o.type === 'remove').map((o) => o.id).sort()).toEqual(['p0', 'p1']);
    const up = ops[0].data;
    expect(up.status).toBe('stocked');
    expect(up.lastPurchasedAt).toBe(now - 3 * DAY);
    expect(up.lastPrice).toBe(3.8);
    expect(up.lastStore).toBe('Target');
    expect(isRecentlyBought({ ...item, ...up }, now)).toBe(false);
  });
  it('Undo puts the purchases and the item back as they were', () => {
    const { back } = takeBackOps(item, purchases, 'gone', now);
    expect(back[0].data).toMatchObject({ status: 'stocked', lastPurchasedAt: now - 3600e3, lastPrice: 3.69, removedAt: null });
    expect(back.filter((o) => o.type === 'set').map((o) => o.id).sort()).toEqual(['p0', 'p1']);
    expect(back.find((o) => o.id === 'p1').data.id).toBeUndefined();
  });
  it('an item never bought before ends with no last purchase', () => {
    const { ops } = takeBackOps(item, purchases.slice(0, 1), 'gone', now);
    expect(ops[0].data.lastPurchasedAt).toBe(null);
    expect(ops[0].data.lastPrice).toBeUndefined();
  });
  it('putting one back on the list still removes only the newest purchase', () => {
    const { ops } = takeBackOps(item, purchases, 'list', now);
    expect(ops.filter((o) => o.type === 'remove').map((o) => o.id)).toEqual(['p1']);
    expect(ops[0].data).toEqual({ status: 'needed', lastPurchasedAt: now - 7200e3 });
  });
});

import { deleteReceipts, deleteExpenseTrips } from '../data/actions.js';
describe('Batch delete with Undo', () => {
  const store = () => {
    const db = {};
    const apply = (ops) => { for (const o of ops) { const c = (db[o.coll] ||= {}); if (o.type === 'remove') delete c[o.id]; else c[o.id] = { ...(o.type === 'update' ? c[o.id] : {}), ...o.data }; } };
    return { db, backend: { commit: async (_a, ops) => apply(ops), commitMine: async (_u, ops) => apply(ops), getDocData: async (_a, coll, id) => db[coll]?.[id] || null, getMine: async (_u, coll, id) => db[coll]?.[id] || null } };
  };
  it('deletes receipts with their photos and purchases, and Undo brings them back', async () => {
    const { db, backend } = store();
    db.receipts = { r1: { store: 'Giant' }, r2: { store: 'Target' }, r3: { store: 'Keep' } };
    db.receiptImages = { r1: { dataUrl: 'x' } };
    db.purchases = { p1: { receiptId: 'r1' }, p2: { receiptId: 'r2' }, p3: { receiptId: 'r3' } };
    const purchases = Object.entries(db.purchases).map(([id, v]) => ({ id, ...v }));
    const undo = await deleteReceipts({ backend, accountId: 'a' }, [{ id: 'r1', store: 'Giant' }, { id: 'r2', store: 'Target' }], purchases);
    expect(Object.keys(db.receipts)).toEqual(['r3']);
    expect(Object.keys(db.purchases)).toEqual(['p3']);
    expect(db.receiptImages.r1).toBeUndefined();
    await undo();
    expect(Object.keys(db.receipts).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(Object.keys(db.purchases).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(db.receiptImages.r1.dataUrl).toBe('x');
  });
  it('deletes trip folders with every expense and photo in them', async () => {
    const { db, backend } = store();
    db.expenseImages = { i1: { dataUrl: 'y' } };
    const trips = [{ id: 't1', name: 'CES' }];
    const expenses = [{ id: 'e1', tripId: 't1', imageIds: ['i1'] }, { id: 'e2', tripId: 't2' }];
    db.expenseTrips = { t1: { name: 'CES' }, t2: { name: 'Other' } };
    db.expenses = { e1: { tripId: 't1', imageIds: ['i1'] }, e2: { tripId: 't2' } };
    const undo = await deleteExpenseTrips({ backend, user: { uid: 'u' } }, trips, expenses);
    expect(Object.keys(db.expenseTrips)).toEqual(['t2']);
    expect(Object.keys(db.expenses)).toEqual(['e2']);
    expect(db.expenseImages.i1).toBeUndefined();
    await undo();
    expect(db.expenses.e1.imageIds).toEqual(['i1']);
    expect(db.expenseImages.i1.dataUrl).toBe('y');
    expect(db.expenseTrips.t1.name).toBe('CES');
  });
});
