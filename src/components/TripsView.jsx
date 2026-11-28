import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import SwipeRow from './SwipeRow.jsx';
import ItemRow from './ItemRow.jsx';
import { isOnList, markBought, markOrdered, markArrived, putOnList, estimate, cancelOrder } from '../data/actions.js';
import { describePrediction } from '../lib/predict.js';
import { fmtMoney, fmtDate, fmtQty, firstName } from '../lib/format.js';
import { can } from '../lib/config.js';
import { CartIcon, TruckIcon } from './Icons.jsx';
import { planTrips, carries, storeLabel, storeType, rememberStoreKinds, guessStoreType, COMMON_STORES } from '../lib/tripPlan.js';

export default function TripsView() {
  const { ctx, items, batches, predictions, account, role, showToast } = useApp();
  const [shopStore, setShopStore] = useState(null);
  const [editStores, setEditStores] = useState(false);
  const [storesFor, setStoresFor] = useState(null); // item waiting for a store being added now
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
        key: st.store.id, store: st.label, drop: st.label, list: st.items, urgent: st.urgent, est: estimate(st.items),
        miles: st.miles, canWait: st.canWait, planned: true,
        pullForward: dueSoon((it) => carries(st.store, it)).slice(0, 8),
      }));
      if (unplaced.length) out.push({ key: 'unplaced', store: '', drop: '', list: unplaced, urgent: unplaced.filter((i) => i.urgent).length, est: estimate(unplaced), pullForward: [], unplaced: true });
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
        key: store || 'any', store, drop: store, list, urgent: list.filter((i) => i.urgent).length, est: estimate(list),
        pullForward: store ? dueSoon((it) => it.store === store) : [],
        canWait: !!store && !list.some((i) => i.urgent) && list.length < 3,
      }))
      .sort((a, b) => b.urgent - a.urgent || b.list.length - a.list.length);
  }, [items, predictions, lookahead, now, savedStores]);

  // Stores you can move an item to that have no run right now: saved stores, or stores used on other items.
  const otherStores = useMemo(() => {
    const shown = new Set(groups.map((g) => g.drop));
    const names = savedStores.length
      ? savedStores.map(storeLabel)
      : [...new Set(items.map((i) => (i.store || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return names.filter((n) => !shown.has(n));
  }, [groups, items, savedStores]);
  const allStores = [...groups.filter((g) => g.drop).map((g) => g.drop), ...otherStores];

  const [moving, setMoving] = useState(null); // item whose Move to sheet is open
  const drag = useDrag((it, store) => moveTo(it, store));

  async function moveTo(it, store) {
    const to = String(store || '').trim();
    if ((it.store || '') === to) return;
    const prev = it.store || '';
    await ctx.backend.update(ctx.accountId, 'items', it.id, { store: to });
    showToast(to ? `Moved ${it.name} to ${to}` : `${it.name} can come from any store`, () => ctx.backend.update(ctx.accountId, 'items', it.id, { store: prev }));
  }

  const openOrders = batches.filter((b) => b.status === 'ordered').sort((a, b) => b.orderedAt - a.orderedAt);
  const done = batches.filter((b) => b.status === 'done').sort((a, b) => (b.arrivedAt || 0) - (a.arrivedAt || 0)).slice(0, 5);

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

  // With stores saved, this sits below the store runs; until then it leads the page so the first step is easy to find.
  const storesCard = (
    <div className="card" style={{ marginBottom: 14, marginTop: savedStores.length ? 14 : 0 }}>
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
  );

  return (
    <>
      <div className="section-h" style={{ marginTop: 4 }}>
        <div>
          <h1>Trips and orders</h1>
          <p className="small muted">Your list grouped into store runs, with items due soon that you can pick up on the same trip.</p>
        </div>
      </div>

      {!savedStores.length && storesCard}

      {groups.length === 0 && openOrders.length === 0 && (
        <div className="card empty"><h2>No trips needed</h2><p>Items you add to the list show up here grouped by store.</p></div>
      )}

      <div className="trip-grid">
        {groups.map((g) => (
          <article key={g.key} className={`card trip${drag.over === g.key ? ' drop-over' : ''}`} data-drop={g.key} data-store={g.drop}>
            <div className="head">
              <div className="grow">
                <h2>{g.unplaced ? 'Not sure where to buy' : g.store || 'Any store'}</h2>
                <p className="small muted">{g.list.length} item{g.list.length === 1 ? '' : 's'}{g.miles != null ? ` · ${g.miles} mi from home` : ''}{g.est ? ` · about ${fmtMoney(g.est)}` : ''}</p>
              </div>
              {g.urgent > 0 && <span className="chip warn">{g.urgent} needed now</span>}
            </div>
            {g.unplaced && <p className="small muted" style={{ marginTop: 6 }}>None of your saved stores is a sure match for these. Add a store that sells them, or put @store on the item.</p>}
            {!g.store && !g.unplaced && <p className="small muted" style={{ marginTop: 6 }}>Add @store when you type an item, or set a store on the item, to fold these into a run.</p>}
            <ul>
              {g.list.map((it) => (
                <li key={it.id} className={drag.item?.id === it.id ? 'dragging' : ''}>
                  <button type="button" className="grip" aria-label={`Drag ${it.name} to another store`} title="Drag to another store" onPointerDown={(e) => drag.start(e, it, g.key)} onContextMenu={(e) => e.preventDefault()}><GripIcon /></button>
                  <button type="button" className="trip-name grow" onClick={() => { if (!drag.tookClick()) setMoving(it); }} onPointerDown={(e) => { if (e.pointerType === 'touch') drag.start(e, it, g.key); }} onContextMenu={(e) => e.preventDefault()} title="Move to another store"><span className="clamp2">{it.name}{fmtQty(it.qty, it.unit) ? <span className="muted"> · {fmtQty(it.qty, it.unit)}</span> : null}</span></button>
                  <span>{it.lastPrice != null ? fmtMoney(it.lastPrice * (Number(it.qty) || 1)) : ''}</span>
                </li>
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

      {groups.length > 0 && (
        <p className="tiny muted" style={{ marginTop: 10 }}>On a phone, press and hold an item, then drag it to another store. Or tap its name to pick one.</p>
      )}

      {savedStores.length > 0 && storesCard}

      {drag.item && (
        <>
          <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">{drag.item.name}</div>
          {otherStores.length > 0 && (
            <div className="drop-strip" aria-hidden="true">
              <span className="tiny">Drop on a store:</span>
              {otherStores.map((n) => (
                <span key={n} className={`chip${drag.over === `other:${n}` ? ' drop-over' : ''}`} data-drop={`other:${n}`} data-store={n}>{n}</span>
              ))}
            </div>
          )}
        </>
      )}

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
      {editStores && <StoresSheet forItem={storesFor} onAdded={(st) => moveTo(storesFor, storeLabel(st))} onClose={() => { setEditStores(false); setStoresFor(null); }} />}
      {moving && <MoveSheet item={moving} stores={allStores} saved={savedStores.length > 0} onPick={(st) => { setMoving(null); moveTo(moving, st); }} onAddStore={() => { setStoresFor(moving); setMoving(null); setEditStores(true); }} onClose={() => setMoving(null)} />}
    </>
  );
}

const HOLD_MS = 350; // how long a finger holds the handle before a drag starts
const HOLD_SLOP = 10; // pixels a finger may wander during the hold; more than that is a scroll

// Drag with a finger or a mouse. Native drag and drop doesn't work on phones, so this follows the pointer
// and asks the page which store card is under it when you let go.
function useDrag(onDrop) {
  const [state, setState] = useState(null); // { item, from, x, y, over, store }
  const ref = useRef(null);
  ref.current = state;
  const held = useRef(false); // a finger has held a handle long enough to drag
  const dragged = useRef(0); // when the last finger drag ended, so the tap that follows it isn't read as a tap
  // Once a finger drag has started, keep the page from scrolling under it. This listener is always
  // there, so it is in place before the finger moves, even in the moment before the drag shows.
  useEffect(() => {
    const noScroll = (e) => { if ((held.current || ref.current?.item) && e.cancelable) e.preventDefault(); };
    const release = () => { if (held.current) dragged.current = Date.now(); held.current = false; };
    window.addEventListener('touchmove', noScroll, { passive: false });
    window.addEventListener('touchend', release);
    window.addEventListener('touchcancel', release);
    return () => {
      window.removeEventListener('touchmove', noScroll);
      window.removeEventListener('touchend', release);
      window.removeEventListener('touchcancel', release);
    };
  }, []);
  useEffect(() => {
    if (!state?.item) return undefined;
    const at = (x, y) => {
      const el = document.elementFromPoint(x, y)?.closest('[data-drop]');
      return el ? { over: el.dataset.drop, store: el.dataset.store ?? '' } : { over: null, store: null };
    };
    const move = (e) => {
      e.preventDefault();
      const edge = 70;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
      setState((s) => s && { ...s, x: e.clientX, y: e.clientY, ...at(e.clientX, e.clientY) });
    };
    const up = (e) => {
      const s = ref.current;
      const hit = at(e.clientX, e.clientY);
      setState(null);
      if (s && hit.over && hit.over !== s.from) onDrop(s.item, hit.store);
    };
    const cancel = () => setState(null);
    const key = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [!!state?.item]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    item: state?.item || null, x: state?.x, y: state?.y, over: state?.over,
    // True right after a press-and-hold drag, so lifting the finger doesn't also open the item.
    tookClick: () => Date.now() - dragged.current < 600,
    start(e, item, from) {
      if (e.button != null && e.button !== 0) return;
      const begin = (x, y) => setState({ item, from, x, y, over: from, store: null });
      if (e.pointerType !== 'touch') {
        e.preventDefault();
        begin(e.clientX, e.clientY);
        return;
      }
      // On a phone a swipe that lands on the handle should still scroll the page, so a finger
      // drag starts only after the handle is pressed and held without moving.
      const x0 = e.clientX;
      const y0 = e.clientY;
      let x = x0;
      let y = y0;
      const stop = () => {
        clearTimeout(timer);
        window.removeEventListener('pointermove', track);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      const track = (ev) => {
        x = ev.clientX;
        y = ev.clientY;
        if (Math.hypot(x - x0, y - y0) > HOLD_SLOP) stop();
      };
      const timer = setTimeout(() => {
        stop();
        held.current = true;
        navigator.vibrate?.(15);
        begin(x, y);
      }, HOLD_MS);
      window.addEventListener('pointermove', track);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    },
  };
}

function GripIcon() {
  return (
    <svg width="14" height="20" viewBox="0 0 14 20" aria-hidden="true" fill="currentColor">
      {[3, 10, 17].map((y) => [4, 10].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.8" />))}
    </svg>
  );
}

// Tap an item's name to pick where to buy it, or type a store that isn't on the list yet.
function MoveSheet({ item, stores, saved, onPick, onAddStore, onClose }) {
  const [typed, setTyped] = useState('');
  const current = item.store || '';
  return (
    <Sheet title={`Where to buy ${item.name}`} onClose={onClose}>
      <div className="stack">
        {!saved && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onPick(typed.trim()); }}>
            <input className="input grow" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="A new store, like H-Mart" aria-label="A new store" />
            <button type="submit" className="btn primary" disabled={!typed.trim()}>Add and move</button>
          </form>
        )}
        {saved && (
          <>
            <button type="button" className="btn block" onClick={onAddStore}>+ Add a store</button>
            <p className="small muted">A store that isn't here? Add it, and {item.name} moves to it when you save.</p>
          </>
        )}
        {stores.map((st) => (
          <button key={st} type="button" className={`btn block${st === current ? ' primary' : ''}`} onClick={() => onPick(st)} aria-pressed={st === current}>
            {st}{st === current ? ' (now)' : ''}
          </button>
        ))}
        <button type="button" className={`btn block${!current ? ' primary' : ''}`} onClick={() => onPick('')}>Any store{saved ? ', let the app pick' : ''}</button>
      </div>
    </Sheet>
  );
}

function ShopMode({ store, ids, onClose }) {
  const { ctx, items, predictions, showToast } = useApp();
  const [got, setGot] = useState([]);
  const undos = useRef({}); // item id -> undo for its check-off on this trip
  const now = Date.now();
  const list = items.filter((it) => (ids ? ids.includes(it.id) : (it.store || '') === store) && isOnList(it, now) && it.status !== 'ordered');
  const gotItems = items.filter((it) => got.includes(it.id));

  async function buy(it) {
    if (got.includes(it.id) || undos.current[it.id]) return;
    undos.current[it.id] = 'pending';
    const { undo } = await markBought(ctx, it, { store });
    undos.current[it.id] = undo;
    setGot((g) => [...g, it.id]);
  }
  // A second tap on a crossed-off item puts it back on the list and drops the purchase.
  async function unbuy(it) {
    const undo = undos.current[it.id];
    if (typeof undo !== 'function') return;
    delete undos.current[it.id];
    setGot((g) => g.filter((id) => id !== it.id));
    await undo();
    showToast(`${it.name} is back on the list`);
  }
  const total = got.length + list.length;
  return (
    <Sheet title={`Shopping at ${store || 'any store'}`} onClose={() => { if (got.length) showToast(`Logged ${got.length} item${got.length === 1 ? '' : 's'} from ${store || 'this trip'}`); onClose(); }}>
      <p className="small muted" style={{ marginBottom: 10 }}>{got.length} of {total} in the cart. Tap or swipe right as you go. Tapped one by mistake? Tap it again to put it back.</p>
      <div className="list shopmode">
        {list.map((it) => (
          <SwipeRow key={it.id} onRight={() => buy(it)} rightLabel="In the cart">
            <ItemRow item={it} pred={predictions[it.id]} showStore={false} onToggle={() => buy(it)} onOpen={() => buy(it)} />
          </SwipeRow>
        ))}
        {gotItems.map((it) => <ItemRow key={it.id} item={it} done showStore={false} onToggle={() => unbuy(it)} onOpen={() => unbuy(it)} />)}
      </div>
      {list.length === 0 && <p className="empty">All done. Nice run.</p>}
      <button type="button" className="btn primary block" style={{ marginTop: 14 }} onClick={() => { if (got.length) showToast(`Logged ${got.length} item${got.length === 1 ? '' : 's'}`); onClose(); }}>Finish trip</button>
    </Sheet>
  );
}

// The household's nearby stores, saved once on the account so everyone shares them.
// New stores go on top. Each store needs only its name: pick one from the list or type a
// new one, and the app works out what it sells from the name.
const NEW_STORE = '__new__';
const typeName = (t) => storeType(t)?.name.replace(/\s*\(.*\)$/, '') || '';
function StoresSheet({ forItem, onAdded, onClose }) {
  const { backend, account, showToast } = useApp();
  const original = account?.settings?.stores || [];
  // A store saved before with no name of its own shows its kind as the name, like "Grocery store".
  const [rows, setRows] = useState(() => [
    ...(forItem ? [{ id: `s${Date.now().toString(36)}n`, type: '', name: '', place: '', miles: '', typing: true }] : []),
    ...original.map((r) => ({ ...r, name: String(r.name || '').trim() || typeName(r.type) })),
  ]);
  // The saved names: the list kept on the account, or, before there is one, the names of the saved stores.
  const [kinds, setKinds] = useState(() => (Array.isArray(account?.settings?.storeKinds) ? rememberStoreKinds(account.settings.storeKinds, []) : rememberStoreKinds([], original)));
  async function forget(j) {
    const gone = kinds[j];
    const next = kinds.filter((_, x) => x !== j);
    setKinds(next);
    await backend.updateAccount(account.id, { 'settings.storeKinds': next });
    showToast(`Removed ${gone.name} from your saved stores`);
  }
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addRow = () => setRows((r) => [{ id: `s${Date.now().toString(36)}${r.length}`, type: '', name: '', place: '', miles: '', typing: false }, ...r]);
  const lower = (x) => String(x || '').trim().toLowerCase();
  const yours = kinds.map((k) => k.name);
  const common = COMMON_STORES.filter((n) => !yours.some((y) => lower(y) === lower(n)));
  const listed = (name) => [...yours, ...common].find((n) => lower(n) === lower(name)) || null;
  // What the Store name list shows for a row: a listed store, the new-store box, or the prompt.
  const pickOf = (r) => (r.typing ? NEW_STORE : listed(r.name) || (String(r.name || '').trim() ? NEW_STORE : ''));
  const pick = (i, value) => {
    if (value === NEW_STORE) { set(i, { typing: true, name: listed(rows[i].name) ? '' : rows[i].name }); return; }
    set(i, { typing: false, name: value });
  };
  // What a store sells: unchanged for a store kept under its old name, the remembered kind for a
  // saved name, otherwise read from the name.
  const typeFor = (r, name) => {
    const o = original.find((x) => x.id === r.id);
    if (o && lower(String(o.name || '').trim() || typeName(o.type)) === lower(name) && storeType(o.type)) return o.type;
    const k = kinds.find((x) => lower(x.name) === lower(name));
    return k ? k.type : guessStoreType(name);
  };
  async function save() {
    if (rows.some((r) => !String(r.name || '').trim())) { showToast('Pick or type a name for each store, or remove the empty one.'); return; }
    const clean = rows.map((r) => {
      const name = String(r.name || '').trim().slice(0, 30);
      return { id: r.id, type: typeFor(r, name), name, place: String(r.place || '').trim().slice(0, 40), miles: r.miles === '' || r.miles == null ? null : Math.max(0, Math.round(Number(r.miles) * 10) / 10) };
    });
    // Only stores added or renamed now join the saved names, so a name you removed stays removed.
    const changed = clean.filter((r) => { const o = original.find((x) => x.id === r.id); return !o || o.name !== r.name || o.type !== r.type; });
    await backend.updateAccount(account.id, { 'settings.stores': clean, 'settings.storeKinds': rememberStoreKinds(kinds, changed) });
    // The item that opened this goes to the store just added (the top one, if several).
    const added = forItem ? clean.find((r) => !original.some((o) => o.id === r.id)) : null;
    if (added) await onAdded?.(added);
    else showToast(clean.length ? `Saved ${clean.length} store${clean.length === 1 ? '' : 's'}` : 'Stores cleared');
    onClose();
  }
  return (
    <Sheet title="Your nearby stores" onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn grow" onClick={addRow}>+ Add a store</button>
          <button type="button" className="btn primary grow" onClick={save}>Save stores</button>
        </div>
        {forItem && <p className="small"><strong>Add the store for {forItem.name}.</strong> When you save, {forItem.name} moves to it.</p>}
        <p className="small muted">Pick a store from the list, or pick + A new store and type its name. Add the town or street and roughly how many miles it is from home. The app knows what stores like Costco, Giant or Home Depot sell. A store it doesn't know gets only what you move there yourself. Stores you name are remembered for next time.</p>
        {kinds.length > 0 && (
          <div className="saved-stores">
            <p className="small"><strong>Saved store names.</strong> Tap ✕ to remove one you no longer want in the list.</p>
            <div className="chips">
              {kinds.map((k, j) => (
                <button key={`${k.name}${j}`} type="button" className="chip" onClick={() => forget(j)} aria-label={`Remove ${k.name} from saved stores`}>
                  {k.name} <span aria-hidden="true">✕</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {rows.map((r, i) => (
          <div key={r.id} className="card" style={{ background: 'var(--card)' }}>
            <label className="field"><span>Store name</span>
              <select className="input" value={pickOf(r)} onChange={(e) => pick(i, e.target.value)}>
                <option value="" disabled>Pick your store or add a new one</option>
                <option value={NEW_STORE}>+ A new store (type its name)</option>
                {yours.length > 0 && (
                  <optgroup label="Your stores">
                    {yours.map((n, j) => <option key={`${n}${j}`} value={n}>{n}</option>)}
                  </optgroup>
                )}
                <optgroup label="Other stores">
                  {common.map((n) => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              </select>
            </label>
            {pickOf(r) === NEW_STORE && (
              <input className="input" style={{ marginTop: 8 }} value={r.name || ''} maxLength={30} placeholder="Type the store's name, like H-Mart" aria-label="New store name" autoFocus={!r.name} onChange={(e) => set(i, { name: e.target.value })} />
            )}
            {pickOf(r) && (
              <div className="grid2" style={{ marginTop: 8 }}>
                <label className="field"><span>Where</span><input className="input" value={r.place || ''} placeholder="Town or street" onChange={(e) => set(i, { place: e.target.value })} /></label>
                <label className="field"><span>Miles from home</span><input className="input" inputMode="decimal" value={r.miles ?? ''} placeholder="5" onChange={(e) => set(i, { miles: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
              </div>
            )}
            <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        {/* A long list keeps a second Save at the bottom, so it isn't a scroll back up. */}
        {rows.length > 2 && <button type="button" className="btn primary block" onClick={save}>Save stores</button>}
      </div>
    </Sheet>
  );
}
