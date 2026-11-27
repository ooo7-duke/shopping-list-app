import { useMemo, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import SwipeRow from './SwipeRow.jsx';
import ItemRow from './ItemRow.jsx';
import { isOnList, markBought, markOrdered, markArrived, putOnList, estimate, cancelOrder } from '../data/actions.js';
import { describePrediction } from '../lib/predict.js';
import { fmtMoney, fmtDate, fmtQty, firstName } from '../lib/format.js';
import { can } from '../lib/config.js';
import { CartIcon, TruckIcon } from './Icons.jsx';
import { planTrips, carries, STORE_TYPES } from '../lib/tripPlan.js';

export default function TripsView() {
  const { ctx, items, batches, predictions, account, role, showToast } = useApp();
  const [shopStore, setShopStore] = useState(null);
  const [editStores, setEditStores] = useState(false);
  const savedStores = account?.settings?.stores || [];
  const editor = can(role, 'edit');
  const now = Date.now();
  const lookahead = account?.settings?.lookaheadDays ?? 10;

  const groups = useMemo(() => {
    const onList = items.filter((it) => isOnList(it, now) && it.status !== 'ordered');
    const dueSoon = (test) => items
      .filter((it) => test(it) && !isOnList(it, now) && it.status !== 'snoozed')
      .map((it) => ({ it, p: predictions[it.id] }))
      .filter(({ p }) => p && p.daysLeft != null && p.daysLeft <= lookahead * 1.5)
      .sort((a, b) => a.p.daysLeft - b.p.daysLeft);

    // With saved stores: the fewest runs, nearest store first on a tie.
    if (savedStores.length) {
      const { stops, unplaced } = planTrips(onList, savedStores);
      const out = stops.map((st) => ({
        key: st.store.id, store: st.label, list: st.items, urgent: st.urgent, est: estimate(st.items),
        miles: st.miles, canWait: st.canWait, planned: true,
        pullForward: dueSoon((it) => carries(st.store, it)).slice(0, 8),
      }));
      if (unplaced.length) out.push({ key: 'unplaced', store: '', list: unplaced, urgent: unplaced.filter((i) => i.urgent).length, est: estimate(unplaced), pullForward: [], unplaced: true });
      return out;
    }

    const m = new Map();
    for (const it of onList) {
      const k = it.store || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return [...m.entries()]
      .map(([store, list]) => ({
        key: store || 'any', store, list, urgent: list.filter((i) => i.urgent).length, est: estimate(list),
        pullForward: store ? dueSoon((it) => it.store === store) : [],
        canWait: !!store && !list.some((i) => i.urgent) && list.length < 3,
      }))
      .sort((a, b) => b.urgent - a.urgent || b.list.length - a.list.length);
  }, [items, predictions, lookahead, now, savedStores]);

  const openOrders = batches.filter((b) => b.status === 'ordered').sort((a, b) => b.orderedAt - a.orderedAt);
  const done = batches.filter((b) => b.status === 'done').sort((a, b) => (b.arrivedAt || 0) - (a.arrivedAt || 0)).slice(0, 5);
  const smallRuns = savedStores.length ? [] : groups.filter((g) => g.canWait);

  async function order(g) {
    const undo = await markOrdered(ctx, g.store, g.list);
    showToast(`Marked ${g.list.length} item${g.list.length === 1 ? '' : 's'} as ordered from ${g.store || 'online'}`, undo);
  }
  async function notOrdered(b) {
    const list = items.filter((i) => b.itemIds?.includes(i.id) && i.status === 'ordered');
    await cancelOrder(ctx, b, list);
    showToast(`Put ${list.length} item${list.length === 1 ? '' : 's'} back on the list`);
  }
  async function arrived(b) {
    const list = items.filter((i) => b.itemIds?.includes(i.id) && i.status === 'ordered');
    await markArrived(ctx, b, list);
    showToast(`${b.name} arrived. ${list.length} purchase${list.length === 1 ? '' : 's'} logged.`);
  }

  if (!editor) {
    return <div className="card empty"><h2>Trips are planned by your editors</h2><p>Add or request items on the List tab. An editor will fold them into the next trip or order.</p></div>;
  }

  return (
    <>
      <div className="section-h" style={{ marginTop: 4 }}>
        <div>
          <h1>Trips and orders</h1>
          <p className="small muted">Your list grouped into store runs, with items due soon that you can pick up on the same trip.</p>
        </div>
      </div>

      <div className="card" style={{ background: '#fff', marginBottom: 14 }}>
        {savedStores.length ? (
          <div className="row wrap">
            <p className="small grow">Planned as the fewest runs from your {savedStores.length} saved store{savedStores.length === 1 ? '' : 's'}. The store with the most of your list goes first, and the nearer one wins a tie.</p>
            <button type="button" className="btn" onClick={() => setEditStores(true)}>Edit stores</button>
          </div>
        ) : (
          <div className="row wrap">
            <p className="small grow">Save the stores near you once, with how far each is from home, and the app plans one run at the closest store that has most of your list.</p>
            <button type="button" className="btn primary" onClick={() => setEditStores(true)}>Add your stores</button>
          </div>
        )}
      </div>

      {smallRuns.length >= 2 && (
        <p className="hint" style={{ marginBottom: 14 }}>
          {smallRuns.length} stores have only one or two items and nothing urgent: {smallRuns.map((g) => g.store).join(', ')}. Holding them until the list grows saves {smallRuns.length - 1} or more trips.
        </p>
      )}

      {groups.length === 0 && openOrders.length === 0 && (
        <div className="card empty"><h2>No trips needed</h2><p>Items you add to the list show up here grouped by store.</p></div>
      )}

      <div className="trip-grid">
        {groups.map((g) => (
          <article key={g.key} className="card trip">
            <div className="head">
              <div className="grow">
                <h2>{g.unplaced ? 'Not sure where to buy' : g.store || 'Any store'}</h2>
                <p className="small muted">{g.list.length} item{g.list.length === 1 ? '' : 's'}{g.miles != null ? ` · ${g.miles} mi from home` : ''}{g.est ? ` · about ${fmtMoney(g.est)}` : ''}</p>
              </div>
              {g.urgent > 0 && <span className="chip warn">{g.urgent} needed now</span>}
            </div>
            {g.unplaced && <p className="small muted" style={{ marginTop: 6 }}>None of your saved stores is a sure match for these. Add the right kind of store, or put @store on the item.</p>}
            {!g.store && !g.unplaced && <p className="small muted" style={{ marginTop: 6 }}>Add @store when you type an item, or set a store on the item, to fold these into a run.</p>}
            {g.canWait && <p className="hint" style={{ marginTop: 10 }}>{g.planned ? 'Extra stop for one or two items, nothing urgent. This can wait for the next run.' : 'Small run, nothing urgent. This can wait for more items.'}</p>}
            <ul>
              {g.list.map((it) => (
                <li key={it.id}><span className="ellipsis">{it.name}{fmtQty(it.qty, it.unit) ? <span className="muted"> · {fmtQty(it.qty, it.unit)}</span> : null}</span><span>{it.lastPrice != null ? fmtMoney(it.lastPrice * (Number(it.qty) || 1)) : ''}</span></li>
              ))}
            </ul>
            {g.pullForward.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p className="small" style={{ marginBottom: 6 }}><strong>Due soon here.</strong> Get them on this trip:</p>
                <div className="row wrap" style={{ gap: 6 }}>
                  {g.pullForward.map(({ it, p }) => (
                    <button key={it.id} type="button" className="chip" onClick={async () => { const u = await putOnList(ctx, it); showToast(`Added ${it.name} to this trip`, u); }}>
                      + {it.name} · {describePrediction(p).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn primary grow" onClick={() => setShopStore({ store: g.store, ids: g.list.map((i) => i.id) })}><CartIcon width="20" height="20" /> Shop now</button>
              <button type="button" className="btn" onClick={() => order(g)} title="For online orders and deliveries"><TruckIcon width="20" height="20" /> Ordered</button>
            </div>
          </article>
        ))}
      </div>

      {openOrders.length > 0 && (
        <section>
          <div className="section-h"><h2>On the way</h2></div>
          <div className="trip-grid">
            {openOrders.map((b) => (
              <article key={b.id} className="card trip">
                <div className="head">
                  <div className="grow"><h2>{b.name}</h2><p className="small muted">Ordered {fmtDate(b.orderedAt, { withYear: true })} by {firstName(b.orderedByName)}{b.estTotal ? ` · about ${fmtMoney(b.estTotal)}` : ''}</p></div>
                </div>
                <ul>{items.filter((i) => b.itemIds?.includes(i.id) && i.status === 'ordered').map((i) => <li key={i.id}><span>{i.name}</span><span className="muted">{fmtQty(i.qty, i.unit)}</span></li>)}</ul>
                <div className="row">
                  <button type="button" className="btn gold grow" onClick={() => arrived(b)}>It arrived</button>
                  <button type="button" className="btn" onClick={() => notOrdered(b)}>Not ordered</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section>
          <div className="section-h"><h2>Recent orders</h2></div>
          <div className="list">
            {done.map((b) => (
              <div key={b.id} className="item" style={{ cursor: 'default' }}>
                <div className="grow"><div className="name">{b.name}</div><div className="meta">{b.itemIds?.length || 0} items · arrived {fmtDate(b.arrivedAt, { withYear: true })}</div></div>
                {b.estTotal ? <div className="price">{fmtMoney(b.estTotal)}</div> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {shopStore !== null && <ShopMode store={shopStore.store} ids={shopStore.ids} onClose={() => setShopStore(null)} />}
      {editStores && <StoresSheet onClose={() => setEditStores(false)} />}
    </>
  );
}

function ShopMode({ store, ids, onClose }) {
  const { ctx, items, predictions, showToast } = useApp();
  const [got, setGot] = useState([]);
  const now = Date.now();
  const list = items.filter((it) => (ids ? ids.includes(it.id) : (it.store || '') === store) && isOnList(it, now) && it.status !== 'ordered');
  const gotItems = items.filter((it) => got.includes(it.id));

  async function buy(it) {
    await markBought(ctx, it, { store });
    setGot((g) => [...g, it.id]);
  }
  const total = got.length + list.length;
  return (
    <Sheet title={`Shopping at ${store || 'any store'}`} onClose={() => { if (got.length) showToast(`Logged ${got.length} item${got.length === 1 ? '' : 's'} from ${store || 'this trip'}`); onClose(); }}>
      <p className="small muted" style={{ marginBottom: 10 }}>{got.length} of {total} in the cart. Tap or swipe right as you go. Each one is dated today.</p>
      <div className="list shopmode">
        {list.map((it) => (
          <SwipeRow key={it.id} onRight={() => buy(it)} rightLabel="In the cart">
            <ItemRow item={it} pred={predictions[it.id]} showStore={false} onToggle={() => buy(it)} onOpen={() => buy(it)} />
          </SwipeRow>
        ))}
        {gotItems.map((it) => <ItemRow key={it.id} item={it} done readOnly={false} onToggle={() => {}} showStore={false} />)}
      </div>
      {list.length === 0 && <p className="empty">All done. Nice run.</p>}
      <button type="button" className="btn primary block" style={{ marginTop: 14 }} onClick={() => { if (got.length) showToast(`Logged ${got.length} item${got.length === 1 ? '' : 's'}`); onClose(); }}>Finish trip</button>
    </Sheet>
  );
}

// The household's nearby stores, saved once on the account so everyone shares them.
function StoresSheet({ onClose }) {
  const { backend, account, showToast } = useApp();
  const [rows, setRows] = useState(() => (account?.settings?.stores || []).map((r) => ({ ...r })));
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addRow = () => setRows((r) => [...r, { id: `s${Date.now().toString(36)}${r.length}`, type: 'walmart', place: '', miles: '' }]);
  async function save() {
    const clean = rows.map((r) => ({ id: r.id, type: r.type, place: String(r.place || '').trim().slice(0, 40), miles: r.miles === '' || r.miles == null ? null : Math.max(0, Math.round(Number(r.miles) * 10) / 10) }));
    await backend.updateAccount(account.id, { 'settings.stores': clean });
    showToast(clean.length ? `Saved ${clean.length} store${clean.length === 1 ? '' : 's'}` : 'Stores cleared');
    onClose();
  }
  return (
    <Sheet title="Your nearby stores" onClose={onClose}>
      <p className="small muted" style={{ marginBottom: 10 }}>Add each store you'd shop at, the town or street so you can tell two apart, and roughly how many miles it is from home. Pick Walmart Neighborhood Market for the smaller Walmarts: they have no car aisle.</p>
      <div className="stack">
        {rows.map((r, i) => (
          <div key={r.id} className="card" style={{ background: '#fff' }}>
            <label className="field"><span>Kind of store</span>
              <select className="input" value={r.type} onChange={(e) => set(i, { type: e.target.value })}>
                {STORE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <div className="grid2">
              <label className="field"><span>Where</span><input className="input" value={r.place || ''} placeholder="Town or street" onChange={(e) => set(i, { place: e.target.value })} /></label>
              <label className="field"><span>Miles from home</span><input className="input" inputMode="decimal" value={r.miles ?? ''} placeholder="5" onChange={(e) => set(i, { miles: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
            </div>
            <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn block" onClick={addRow}>+ Add a store</button>
        <button type="button" className="btn primary block" onClick={save}>Save stores</button>
      </div>
    </Sheet>
  );
}
