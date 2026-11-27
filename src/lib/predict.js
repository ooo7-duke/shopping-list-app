// Need prediction from purchase history.
//
// For each item we look at the gaps between purchases and how much was bought
// each time. Buying 2 gallons that last 14 days means 7 days per gallon, so a
// 3-gallon purchase is expected to last about 21 days. Recent gaps count more
// (exponential weighting) so habits that change are picked up quickly.
//
// The user can always override: cadence.mode = 'manual' with cadence.days,
// or 'off' to stop predicting an item.

export const DAY = 24 * 60 * 60 * 1000;

export function predictItem(item, purchases, now = Date.now()) {
  const cadence = item.cadence || { mode: 'auto' };
  if (cadence.mode === 'off') return { basis: 'off' };

  const hist = purchases
    .filter((p) => p.itemId === item.id && p.purchasedAt)
    .sort((a, b) => a.purchasedAt - b.purchasedAt);
  const last = hist[hist.length - 1];

  if (cadence.mode === 'manual' && cadence.days > 0) {
    const from = last ? last.purchasedAt : item.addedAt || now;
    const next = from + cadence.days * DAY;
    return { basis: 'manual', intervalDays: cadence.days, nextDate: next, daysLeft: (next - now) / DAY, confidence: 'set', samples: hist.length };
  }

  if (hist.length < 2) {
    return { basis: 'learning', samples: hist.length, needed: 2 - hist.length + 1 };
  }

  // Merge purchases made on the same day (two receipts, same trip).
  const days = [];
  for (const p of hist) {
    const prev = days[days.length - 1];
    if (prev && p.purchasedAt - prev.at < 0.5 * DAY) prev.qty += Number(p.qty) || 1;
    else days.push({ at: p.purchasedAt, qty: Number(p.qty) || 1 });
  }
  if (days.length < 2) return { basis: 'learning', samples: hist.length, needed: 1 };

  const perUnit = [];
  for (let i = 1; i < days.length; i++) {
    const gap = Math.max(0.5, (days[i].at - days[i - 1].at) / DAY);
    perUnit.push(gap / Math.max(days[i - 1].qty, 0.25));
  }
  const alpha = 0.45;
  let ewma = perUnit[0];
  for (let i = 1; i < perUnit.length; i++) ewma = alpha * perUnit[i] + (1 - alpha) * ewma;

  const lastDay = days[days.length - 1];
  const intervalDays = Math.max(1, ewma * lastDay.qty);
  const nextDate = lastDay.at + intervalDays * DAY;

  const mean = perUnit.reduce((a, b) => a + b, 0) / perUnit.length;
  const sd = Math.sqrt(perUnit.reduce((a, b) => a + (b - mean) ** 2, 0) / perUnit.length);
  const cv = mean ? sd / mean : 1;
  const confidence = perUnit.length >= 4 && cv < 0.5 ? 'high' : perUnit.length >= 2 ? 'medium' : 'low';

  return {
    basis: 'history',
    intervalDays: Math.round(intervalDays * 10) / 10,
    nextDate,
    daysLeft: (nextDate - now) / DAY,
    confidence,
    samples: hist.length,
  };
}

export function predictAll(items, purchases, now = Date.now()) {
  const byItem = new Map();
  for (const p of purchases) {
    if (!p.itemId) continue;
    if (!byItem.has(p.itemId)) byItem.set(p.itemId, []);
    byItem.get(p.itemId).push(p);
  }
  const out = {};
  for (const it of items) out[it.id] = predictItem(it, byItem.get(it.id) || [], now);
  return out;
}

export function describePrediction(pred) {
  if (!pred) return '';
  if (pred.basis === 'off') return 'Not predicted';
  if (pred.basis === 'learning') return pred.samples === 0 ? 'Learning' : 'Learning (1 purchase)';
  const d = Math.round(pred.daysLeft);
  // Plain words, so nobody has to decode "3d".
  if (d < -1) return `Ran out ${-d} days ago`;
  if (d === -1) return 'Ran out yesterday';
  if (d === 0) return 'Runs out today';
  if (d === 1) return 'Runs out tomorrow';
  return `Runs out in ${d} days`;
}
