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

import { pickQuotes, storeIdFor, fitsQuery, directUrl, linkHost } from './storeMatch.js';
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
      { source: 'Kroger', extracted_price: 19.99 },
      { source: 'Meijer', extracted_price: 25 },
      { source: 'Bad', extracted_price: 0 },
      { source: 'Evil', extracted_price: 5, product_link: 'javascript:alert(1)' },
    ]);
    const by = Object.fromEntries(q.map((x) => [x.storeId, x]));
    expect(by.walmart.price).toBe(21.5);
    expect(by.samsclub.price).toBe(22.98);
    expect(by.any.storeName).toBe('Evil');
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
