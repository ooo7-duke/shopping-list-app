import { useMemo, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import SwipeRow from './SwipeRow.jsx';
import ItemRow from './ItemRow.jsx';
import { isOnList, markBought, markOrdered, markArrived, putOnList, estimate } from '../data/actions.js';
import { describePrediction } from '../lib/predict.js';
import { fmtMoney, fmtDate, fmtQty, firstName } from '../lib/format.js';
import { can } from '../lib/config.js';
import { CartIcon, TruckIcon } from './Icons.jsx';

export default function TripsView() {
  const { ctx, items, batches, predictions, account, role, showToast } = useApp();
  const [shopStore, setShopStore] = useState(null);
  const editor = can(role, 'edit');
  const now = Date.now();
  const lookahead = account?.settings?.lookaheadDays ?? 10;

  const groups = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!isOnList(it, now) || it.status === 'requested' || it.status === 'ordered') continue;
      const k = it.store || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return [...m.entries()]
      .map(([store, list]) => {
        const pullForward = store
          ? items
            .filter((it) => it.store === store && !isOnList(it, now) && it.status !== 'snoozed')
            .map((it) => ({ it, p: predictions[it.id] }))
            .filter(({ p }) => p && p.daysLeft != null && p.daysLeft <= lookahead * 1.5)
            .sort((a, b) => a.p.daysLeft - b.p.daysLeft)
          : [];
        return { store, list, urgent: list.filter((i) => i.urgent).length, est: estimate(list), pullForward };
      })
      .sort((a, b) => b.urgent - a.urgent || b.list.length - a.list.length);
  }, [items, predictions, lookahead, now]);

  const openOrders = batches.filter((b) => b.status === 'ordered').sort((a, b) => b.orderedAt - a.orderedAt);
  const done = batches.filter((b) => b.status === 'done').sort((a, b) => (b.arrivedAt || 0) - (a.arrivedAt || 0)).slice(0, 5);
  const smallRuns = groups.filter((g) => g.store && !g.urgent && g.list.length < 3);

  async function order(g) {
    await markOrdered(ctx, g.store, g.list);
    showToast(`Marked ${g.list.length} item${g.list.length === 1 ? '' : 's'} as ordered from ${g.store || 'online'}`);
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
          <article key={g.store || 'any'} className="card trip">
            <div className="head">
              <div className="grow">
                <h2>{g.store || 'Any store'}</h2>
                <p className="small muted">{g.list.length} item{g.list.length === 1 ? '' : 's'}{g.est ? ` · about ${fmtMoney(g.est)}` : ''}</p>
              </div>
              {g.urgent > 0 && <span className="chip warn">{g.urgent} needed now</span>}
            </div>
            {!g.store && <p className="small muted" style={{ marginTop: 6 }}>Add @store when you type an item, or set a store on the item, to fold these into a run.</p>}
            {g.store && !g.urgent && g.list.length < 3 && <p className="hint" style={{ marginTop: 10 }}>Small run, nothing urgent. This can wait for more items.</p>}
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
                      + {it.name} · {describePrediction(p).replace('Due ', '')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="row">
              <button type="button" className="btn primary grow" onClick={() => setShopStore(g.store)}><CartIcon width="20" height="20" /> Shop now</button>
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
                <button type="button" className="btn gold block" onClick={() => arrived(b)}>It arrived</button>
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

      {shopStore !== null && <ShopMode store={shopStore} onClose={() => setShopStore(null)} />}
    </>
  );
}

function ShopMode({ store, onClose }) {
  const { ctx, items, predictions, showToast } = useApp();
  const [got, setGot] = useState([]);
  const now = Date.now();
  const list = items.filter((it) => (it.store || '') === store && isOnList(it, now) && it.status !== 'requested' && it.status !== 'ordered');
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
