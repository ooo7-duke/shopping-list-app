import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { markBought, putOnList, takeOffList, isOnList, setSeenPrice, refreshPrices, canLookUpAgain, snoozeUntil } from '../data/actions.js';
import SnoozePicker from './SnoozePicker.jsx';
import { storeLinks, seenPrices, refurbPrice, hasPriceProvider, currentQuota, onQuota, refreshQuota } from '../lib/prices.js';
import { deptOf } from '../lib/tripPlan.js';
import { linkHost, isBlockedSeller, isKnownRetailer } from '../lib/storeMatch.js';
import { lastPurchaseMap, lastBuy } from '../lib/history.js';
import { fmtMoney, fmtDate, toInputDate, fromInputDate, fmtQty } from '../lib/format.js';
import { HOUSEHOLD_CATEGORIES } from '../lib/categories.js';
import { can, DEMO_MODE } from '../lib/config.js';

// Every field saves as soon as it changes, so there is no Save button to forget.
export default function ItemSheet({ item, focus, onClose }) {
  const { ctx, backend, account, purchases, predictions, role, items, showToast } = useApp();
  const editor = can(role, 'edit');
  const [logDate, setLogDate] = useState(toInputDate());
  const [logPrice, setLogPrice] = useState(item.lastPrice ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pred = predictions[item.id];
  const cats = account?.categories || HOUSEHOLD_CATEGORIES;
  const stores = useMemo(() => [...new Set(items.map((i) => i.store).filter(Boolean))].sort(), [items]);
  const history = purchases.filter((p) => p.itemId === item.id).sort((a, b) => b.purchasedAt - a.purchasedAt);
  const cadence = item.cadence || { mode: 'auto' };
  const [days, setDays] = useState(cadence.days || Math.round(pred?.intervalDays || 14));
  const [qty, setQty] = useState(item.qty ?? 1);
  const pricesRef = useRef(null);
  const [quota, setQuota] = useState(currentQuota());
  useEffect(() => {
    if (!hasPriceProvider()) return undefined;
    const off = onQuota(setQuota);
    refreshQuota();
    return off;
  }, []);
  useEffect(() => { if (focus === 'prices') pricesRef.current?.scrollIntoView({ block: 'start' }); }, [focus]);
  const last = lastBuy(item, lastPurchaseMap(history)[item.id]);
  const links = storeLinks(item);
  const { best } = seenPrices(item);
  // Electronics: a certified refurbished price, when a lookup found one, comes first.
  const isTech = deptOf(item) === 'electronics';
  const refurb = isTech ? refurbPrice(item) : null;
  const [looking, setLooking] = useState(false);
  const real = (seen) => (seen && seen.by !== 'sample' ? seen : null);
  const elsewhereRaw = real(item.seenPrices?.any);
  const elsewhere = elsewhereRaw && !isBlockedSeller(elsewhereRaw.storeName, elsewhereRaw.url) && isKnownRetailer(elsewhereRaw.storeName) ? elsewhereRaw : null;
  const seenLabel = (seen) => {
    if (!seen?.at) return '';
    if (seen.by === 'auto') return `found ${fmtDate(seen.at)}`;
    return `you saw ${fmtDate(seen.at)}`;
  };
  async function lookUp() {
    setLooking(true);
    try {
      const { found, recent } = await refreshPrices(ctx, item);
      const q = currentQuota();
      const left = q ? ` ${q.left} lookups left for your household this month.` : '';
      showToast(recent ? 'Already checked today. Change the name or note to check again.' : (found ? 'Prices updated.' : 'No prices found. Try a more specific name, like "Bounty paper towels 12 rolls".') + left);
    } catch (e) {
      showToast(e?.message || 'Price lookup failed. Please try again.');
    } finally { setLooking(false); }
  }

  const save = (patch) => backend.update(ctx.accountId, 'items', item.id, patch);
  const num = (v) => (v === '' || v == null ? null : Number(v));

  async function logPurchase() {
    const { undo } = await markBought(ctx, item, { date: fromInputDate(logDate), price: num(logPrice) });
    showToast(`Logged ${item.name} on ${fmtDate(fromInputDate(logDate), { withYear: true })}`, undo);
    onClose();
  }
  async function remove() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    // Keep a copy so a delete tapped by mistake can be undone from the message.
    const copy = Object.fromEntries(Object.entries(item).filter(([k, v]) => k !== 'id' && v !== undefined));
    await backend.remove(ctx.accountId, 'items', item.id);
    showToast(`Deleted ${item.name}. Past purchases stay in your history.`, () => backend.commit(ctx.accountId, [{ type: 'set', coll: 'items', id: item.id, data: copy }]));
    onClose();
  }
  // Off the list with nothing logged: no purchase, no change to the history or the price.
  async function removeFromList() {
    const undo = await takeOffList(ctx, item);
    showToast(`Removed ${item.name} from the list. Nothing was logged as bought.`, undo);
    onClose();
  }

  let predLine = 'Not enough history yet. Two purchases are needed before the app can estimate how often you buy this.';
  if (pred?.basis === 'history') predLine = `From ${pred.samples} purchases, this lasts about ${Math.round(pred.intervalDays)} days (${pred.confidence} confidence). Next need: ${fmtDate(pred.nextDate, { withYear: true })}.`;
  if (pred?.basis === 'manual') predLine = `You set this to every ${cadence.days} days. Next need: ${fmtDate(pred.nextDate, { withYear: true })}.`;
  if (pred?.basis === 'off') predLine = 'Predictions are off for this item.';
  if (pred?.basis === 'learning' && history.length === 1) predLine = 'One purchase logged. One more and the app can estimate when you will need it again. You can also set a schedule below.';

  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="stack">
        {editor ? (
          <>
            {isOnList(item) && (
              <div>
                <button type="button" className="btn block" onClick={removeFromList}>Remove from list</button>
                <p className="tiny muted" style={{ marginTop: 6 }}>Changed your mind? This takes it off the list without logging a purchase.</p>
              </div>
            )}
            <label className="field"><span>Name</span>
              <input className="input" defaultValue={item.name} onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && save({ name: e.target.value.trim(), pricesCheckedAt: null })} />
            </label>
            <div className="grid2">
              <div className="field">
                <span className="small muted" style={{ display: 'block', marginBottom: 4 }}>Quantity</span>
                <div className="stepper">
                  <button type="button" aria-label="Less" onClick={() => { const v = Math.max(1, (Number(qty) || 1) - 1); setQty(v); save({ qty: v }); }}>−</button>
                  <input aria-label="Quantity" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onBlur={() => save({ qty: num(qty) || 1 })} />
                  <button type="button" aria-label="More" onClick={() => { const v = (Number(qty) || 1) + 1; setQty(v); save({ qty: v }); }}>+</button>
                </div>
              </div>
              <label className="field"><span>Unit</span>
                <input className="input" defaultValue={item.unit || ''} placeholder="gal, pack, box" onBlur={(e) => save({ unit: e.target.value.trim() })} />
              </label>
            </div>
            <div className="grid2">
              <label className="field"><span>Where to buy</span>
                <input className="input" list="stores" defaultValue={item.store || ''} placeholder="Costco" onBlur={(e) => save({ store: e.target.value.trim() })} />
                <datalist id="stores">{stores.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
              <label className="field"><span>Type</span>
                <select className="input" value={item.category || 'Other'} onChange={(e) => save({ category: e.target.value, categoryByHand: true })}>
                  {[...new Set([...cats, item.category || 'Other'])].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="grid2">
              <label className="field"><span>Last price paid (each)</span>
                <input className="input" inputMode="decimal" defaultValue={item.lastPrice ?? ''} placeholder="0.00" onBlur={(e) => save({ lastPrice: num(e.target.value) })} />
              </label>
              <label className="field"><span>Note</span>
                <input className="input" defaultValue={item.note || ''} placeholder="Brand, size, aisle" onBlur={(e) => e.target.value.trim() !== (item.note || '') && save({ note: e.target.value.trim(), pricesCheckedAt: null })} />
              </label>
            </div>
            <label className="row small" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={!!item.urgent} onChange={(e) => save({ urgent: e.target.checked, needBy: e.target.checked ? Date.now() : null })} style={{ width: 22, height: 22 }} />
              Needed now (can't wait for the next combined trip)
            </label>

            {(['needed', 'requested', 'snoozed'].includes(item.status)) && (
              <details className="card snooze-card" style={{ background: '#fff' }} open={item.status === 'snoozed' && (item.snoozeUntil || 0) > Date.now()}>
                <summary><h3 style={{ display: 'inline' }}>Snooze</h3> <span className="small muted">take it off the list for a while</span></summary>
                <div style={{ marginTop: 10 }}>
                  <SnoozePicker current={item.status === 'snoozed' && (item.snoozeUntil || 0) > Date.now() ? item.snoozeUntil : null}
                    onPick={async (until) => {
                      const undo = await snoozeUntil(ctx, item, until);
                      showToast(`Snoozed ${item.name} until ${new Date(until).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`, undo);
                      onClose();
                    }} />
                </div>
              </details>
            )}

            <div className="card" style={{ background: '#fff' }}>
              <h3 style={{ marginBottom: 6 }}>Last time</h3>
              {last ? (
                <div className="grid3 small">
                  <div><span className="muted tiny">Date</span><div><strong>{fmtDate(last.at, { withYear: true })}</strong></div></div>
                  <div><span className="muted tiny">Quantity</span><div><strong>{last.qty != null ? fmtQty(last.qty, last.unit) || '1' : 'Not recorded'}</strong></div></div>
                  <div><span className="muted tiny">Price each</span><div><strong>{last.unitPrice != null ? fmtMoney(last.unitPrice) : 'Not recorded'}</strong></div></div>
                </div>
              ) : <p className="small muted">Not bought yet. Check it off or log a receipt and the date, quantity and price show here.</p>}
              {last?.store && <p className="tiny muted" style={{ marginTop: 6 }}>Bought at {last.store}</p>}
            </div>

            <div className="card" style={{ background: '#fff', scrollMarginTop: 12 }} ref={pricesRef}>
              <h3 style={{ marginBottom: 4 }}>Today's prices</h3>
              <p className="small muted" style={{ marginBottom: 8 }}>
                {hasPriceProvider() ? 'Tap Look up prices to check stores. ' : ''}Tap a store to open it, or type a price you see.
                {refurb ? ` Certified refurbished: ${fmtMoney(refurb.price)} at ${refurb.storeName}.` : ''}
                {best ? ` Cheapest new: ${best.store} at ${fmtMoney(best.price)}.` : ''}
              </p>
              {DEMO_MODE && <p className="small" style={{ marginBottom: 8 }}>This demo can't look up live prices. On your site they fill in from Google Shopping once the price key is set up.</p>}
              {looking && <p className="small" role="status" style={{ marginBottom: 8 }}>Looking up prices…</p>}
              {isTech && (refurb ? (
                <div className="refurb-line">
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="chip gold">Certified refurbished</span>
                    <strong className="grow" style={{ textAlign: 'right', fontSize: '1.1rem' }}>{fmtMoney(refurb.price)}</strong>
                  </div>
                  <p className="tiny muted" style={{ margin: '4px 0 0' }}>
                    {refurb.storeName}{refurb.title ? ` · ${refurb.title}` : ''} · {seenLabel(refurb)}
                    {refurb.url && <> · <a href={refurb.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', minHeight: 44, lineHeight: '44px' }}>{linkHost(refurb.url)} ↗</a></>}
                  </p>
                </div>
              ) : item.pricesCheckedAt ? (
                <p className="tiny muted" style={{ marginBottom: 8 }}>No certified refurbished listing from a maker or major retailer turned up in the last lookup.</p>
              ) : null)}
              {isTech && <h4 className="tiny muted" style={{ margin: '8px 0 4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>New</h4>}
              <div className="price-list">
                {links.filter((l) => l.id !== 'any').map((l) => {
                  const seen = real(item.seenPrices?.[l.id]);
                  return (
                    <div key={l.id} className="price-line">
                      <a className="chip blue" href={l.href} target="_blank" rel="noopener noreferrer">{l.name} ↗</a>
                      <span className="grow tiny muted">{seenLabel(seen)}{seen?.url && <> on <a href={seen.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', minHeight: 44, lineHeight: '44px' }}>{linkHost(seen.url)} ↗</a></>}</span>
                      <input key={seen?.at || 'none'} className="input price-input" inputMode="decimal" aria-label={`Price at ${l.name}`} placeholder="$" defaultValue={seen?.price ?? ''}
                        onBlur={async (e) => {
                          const v = e.target.value.replace(/[$,\s]/g, '');
                          if (String(seen?.price ?? '') === v) return;
                          const undo = await setSeenPrice(ctx, item, l.id, v === '' ? null : v);
                          showToast(v === '' ? `Cleared the ${l.name} price` : `Saved ${l.name}: ${fmtMoney(v)}`, undo);
                        }} />
                    </div>
                  );
                })}
                {elsewhere?.price != null && (
                  <div className="price-line">
                    {elsewhere.url
                      ? <a className="chip blue" href={elsewhere.url} target="_blank" rel="noopener noreferrer">{elsewhere.storeName || 'Elsewhere'} ↗</a>
                      : <span className="chip">{elsewhere.storeName || 'Elsewhere'}</span>}
                    <span className="grow tiny muted">cheapest elsewhere{elsewhere.url && <> on <a href={elsewhere.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', minHeight: 44, lineHeight: '44px' }}>{linkHost(elsewhere.url)} ↗</a></>}</span>
                    <strong className="price-input" style={{ display: 'inline-block' }}>{fmtMoney(elsewhere.price)}</strong>
                  </div>
                )}
              </div>
              {hasPriceProvider() && (
                <>
                  <button type="button" className="btn" style={{ marginTop: 10 }} onClick={lookUp} disabled={looking || !canLookUpAgain(item) || quota?.left === 0}>
                    {looking ? 'Looking…' : quota?.left === 0 ? (quota.paused ? 'Lookups paused' : 'No lookups left') : !canLookUpAgain(item) ? 'Checked today' : item.pricesCheckedAt ? 'Look up prices again' : 'Look up prices'}
                  </button>
                  <p className="tiny muted" role="status" style={{ marginTop: 6 }}>
                    {quota?.paused ? 'Price lookups are paused for everyone this month.' : quota ? `Lookups left for your household this month: ${quota.left}. Each lookup uses one.` : 'Each lookup uses one of your household\'s monthly price lookups.'}
                    {quota?.left === 0 && quota.renews ? ` They reset ${fmtDate(Date.parse(quota.renews), { withYear: true })}.` : ''}
                  </p>
                </>
              )}
              <a className="small" href={links.find((l) => l.id === 'any').href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8, minHeight: 44, lineHeight: '44px' }}>Compare more stores on Google Shopping ↗</a>
            </div>

            <div className="card" style={{ background: '#fff' }}>
              <h3 style={{ marginBottom: 6 }}>When will we need it?</h3>
              <p className="small" style={{ marginBottom: 10 }}>{predLine}</p>
              <div className="seg" role="group" aria-label="Prediction mode">
                <button type="button" aria-pressed={cadence.mode === 'auto'} onClick={() => save({ cadence: { mode: 'auto' } })}>Learn it</button>
                <button type="button" aria-pressed={cadence.mode === 'manual'} onClick={() => save({ cadence: { mode: 'manual', days } })}>Set schedule</button>
                <button type="button" aria-pressed={cadence.mode === 'off'} onClick={() => save({ cadence: { mode: 'off' } })}>Off</button>
              </div>
              {cadence.mode === 'manual' && (
                <label className="row small" style={{ marginTop: 10 }}>
                  Every
                  <input type="range" min="1" max="120" step="1" value={days} onChange={(e) => setDays(Number(e.target.value))}
                    onPointerUp={() => save({ cadence: { mode: 'manual', days } })} onKeyUp={() => save({ cadence: { mode: 'manual', days } })} onBlur={() => save({ cadence: { mode: 'manual', days } })}
                    className="grow" aria-label="Days between purchases" />
                  <strong style={{ minWidth: 64 }}>{days} days</strong>
                </label>
              )}
            </div>

            <div className="card" style={{ background: '#fff' }}>
              <h3 style={{ marginBottom: 8 }}>Log a purchase</h3>
              <div className="grid2">
                <label className="field"><span>Date bought</span><input type="date" className="input" value={logDate} max={toInputDate()} onChange={(e) => setLogDate(e.target.value)} /></label>
                <label className="field"><span>Price each</span><input className="input" inputMode="decimal" value={logPrice} onChange={(e) => setLogPrice(e.target.value)} placeholder="0.00" /></label>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn primary grow" onClick={logPurchase}>Mark bought</button>
                {!isOnList(item) && <button type="button" className="btn" onClick={async () => { const u = await putOnList(ctx, item); showToast(`Added ${item.name}`, u); onClose(); }}>Add to list</button>}
              </div>
            </div>
          </>
        ) : (
          <p className="muted">{[fmtQty(item.qty, item.unit), item.store, item.category].filter(Boolean).join(' · ')}</p>
        )}

        {history.length > 0 && (
          <div>
            <h3 style={{ marginBottom: 4 }}>Purchase history</h3>
            <table className="data">
              <tbody>
                {history.slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.purchasedAt, { withYear: true })}</td>
                    <td>{p.store}</td>
                    <td className="num">{fmtQty(p.qty, p.unit) || '1'}</td>
                    <td className="num">{fmtMoney(p.total ?? p.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editor && (
          <button type="button" className="btn danger block" onClick={remove}>{confirmDelete ? 'Tap again to delete this item' : 'Delete item'}</button>
        )}
      </div>
    </Sheet>
  );
}
