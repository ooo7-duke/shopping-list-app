// Last purchase per item: date, quantity, price paid and store.
// Purchase records win; the item's own last* fields cover items whose purchases
// were never loaded (older data or a trimmed history).
export function lastPurchaseMap(purchases) {
  const m = {};
  for (const p of purchases) {
    if (!p.itemId || !p.purchasedAt) continue;
    if (!m[p.itemId] || p.purchasedAt > m[p.itemId].purchasedAt) m[p.itemId] = p;
  }
  return m;
}

export function lastBuy(item, latest) {
  if (latest && (!item.lastPurchasedAt || latest.purchasedAt >= item.lastPurchasedAt - 1000)) {
    const unitPrice = latest.unitPrice ?? (latest.total != null && latest.qty ? latest.total / latest.qty : null);
    return { at: latest.purchasedAt, qty: Number(latest.qty) || 1, unit: latest.unit || item.unit || '', unitPrice, store: latest.store || '' };
  }
  if (item.lastPurchasedAt) {
    return { at: item.lastPurchasedAt, qty: item.lastQty != null ? Number(item.lastQty) : null, unit: item.unit || '', unitPrice: item.lastPrice ?? null, store: item.lastStore || '' };
  }
  return null;
}
