import { useMemo, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { markBought, putOnList, isOnList } from '../data/actions.js';
import { fmtMoney, fmtDate, toInputDate, fromInputDate, fmtQty } from '../lib/format.js';
import { HOUSEHOLD_CATEGORIES } from '../lib/categories.js';
import { can } from '../lib/config.js';

// Every field saves as soon as it changes, so there is no Save button to forget.
export default function ItemSheet({ item, onClose }) {
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

  const save = (patch) => backend.update(ctx.accountId, 'items', item.id, patch);
  const num = (v) => (v === '' || v == null ? null : Number(v));

  async function logPurchase() {
    const { undo } = await markBought(ctx, item, { date: fromInputDate(logDate), price: num(logPrice) });
    showToast(`Logged ${item.name} on ${fmtDate(fromInputDate(logDate), { withYear: true })}`, undo);
    onClose();
  }
  async function remove() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await backend.remove(ctx.accountId, 'items', item.id);
    showToast(`Deleted ${item.name}. Purchase history is kept for reports.`);
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
            <label className="field"><span>Name</span>
              <input className="input" defaultValue={item.name} onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && save({ name: e.target.value.trim() })} />
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
              <label className="field"><span>Store</span>
                <input className="input" list="stores" defaultValue={item.store || ''} placeholder="Costco" onBlur={(e) => save({ store: e.target.value.trim() })} />
                <datalist id="stores">{stores.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
              <label className="field"><span>Category</span>
                <select className="input" value={item.category || 'Other'} onChange={(e) => save({ category: e.target.value })}>
                  {[...new Set([...cats, item.category || 'Other'])].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="grid2">
              <label className="field"><span>Last price paid (each)</span>
                <input className="input" inputMode="decimal" defaultValue={item.lastPrice ?? ''} placeholder="0.00" onBlur={(e) => save({ lastPrice: num(e.target.value) })} />
              </label>
              <label className="field"><span>Note</span>
                <input className="input" defaultValue={item.note || ''} placeholder="Brand, size, aisle" onBlur={(e) => save({ note: e.target.value.trim() })} />
              </label>
            </div>
            <label className="row small" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={!!item.urgent} onChange={(e) => save({ urgent: e.target.checked, needBy: e.target.checked ? Date.now() : null })} style={{ width: 22, height: 22 }} />
              Needed now (can't wait for the next combined trip)
            </label>

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
