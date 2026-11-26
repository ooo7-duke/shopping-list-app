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
