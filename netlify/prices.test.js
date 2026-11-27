import { describe, it, expect } from 'vitest';
import { usage } from './functions/prices.mjs';

describe('household lookup limits', () => {
  const plan = (left) => ({ left, total: 250, renews: '2026-12-15' });
  it('gives a household up to 150 a month', () => {
    expect(usage(plan(250), 0, false)).toMatchObject({ left: 150, used: 0, total: 150, paused: false });
    expect(usage(plan(250), 140, false).left).toBe(10);
    expect(usage(plan(250), 150, false).left).toBe(0);
  });
  it('keeps the last 100 searches in reserve for everyone else', () => {
    expect(usage(plan(130), 0, false).left).toBe(30);
    expect(usage(plan(100), 0, false)).toMatchObject({ left: 0, paused: true });
  });
  it('lets a reserve holder use the reserve and skip the household limit', () => {
    expect(usage(plan(100), 150, true)).toMatchObject({ left: 100, paused: false });
    expect(usage(plan(0), 0, true).left).toBe(0);
  });
});
