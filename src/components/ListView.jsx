import { useMemo, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import QuickAdd from './QuickAdd.jsx';
import SwipeRow from './SwipeRow.jsx';
import ItemRow from './ItemRow.jsx';
import ItemSheet from './ItemSheet.jsx';
import { isOnList, markBought, snooze, takeOffList, putOnList, approve, decline, estimate } from '../data/actions.js';
import { describePrediction, DAY } from '../lib/predict.js';
import { can } from '../lib/config.js';
import { fmtMoney } from '../lib/format.js';

const GROUP_KEY = 'sla-group-by';

export default function ListView() {
  const { ctx, items, purchases, predictions, role, account, showToast, backend } = useApp();
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem(GROUP_KEY) || 'category');
  const [openId, setOpenId] = useState(null);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const editor = can(role, 'edit');
  const now = Date.now();
  const lookahead = account?.settings?.lookaheadDays ?? 10;

  const onList = items.filter((it) => isOnList(it, now) && it.status !== 'requested' && it.status !== 'ordered');
  const requested = items.filter((it) => it.status === 'requested');
  const ordered = items.filter((it) => it.status === 'ordered');
  const snoozed = items.filter((it) => it.status === 'snoozed' && (it.snoozeUntil || 0) > now);
  const recent = items.filter((it) => it.status === 'stocked' && it.lastPurchasedAt && now - it.lastPurchasedAt < DAY).sort((a, b) => b.lastPurchasedAt - a.lastPurchasedAt);

  const suggestions = useMemo(() => items
    .filter((it) => !isOnList(it, now) && it.status !== 'snoozed')
    .map((it) => ({ it, p: predictions[it.id] }))
    .filter(({ p }) => p && (p.basis === 'history' || p.basis === 'manual') && p.daysLeft <= lookahead)
    .sort((a, b) => a.p.daysLeft - b.p.daysLeft), [items, predictions, lookahead, now]);

  const groups = useMemo(() => {
    const m = new Map();
    const key = (it) => (groupBy === 'store' ? it.store || 'Any store' : it.category || 'Other');
    for (const it of onList) {
      const k = key(it);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    for (const list of m.values()) list.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.name.localeCompare(b.name));
    return [...m.entries()].sort((a, b) => (a[0] === 'Any store' ? 1 : b[0] === 'Any store' ? -1 : a[0].localeCompare(b[0])));
  }, [onList, groupBy]);

  const setGroup = (g) => { setGroupBy(g); localStorage.setItem(GROUP_KEY, g); };

  async function bought(it) {
    const { undo } = await markBought(ctx, it);
    showToast(`Got ${it.name}`, undo);
  }
  async function unbuy(it) {
    // Undo a check-off from the last day: remove that purchase and put the item back.
    const hist = purchases.filter((x) => x.itemId === it.id).sort((a, b) => b.purchasedAt - a.purchasedAt);
    const p = hist[0] && now - hist[0].purchasedAt < DAY ? hist[0] : null;
    const ops = [{ type: 'update', coll: 'items', id: it.id, data: { status: 'needed', lastPurchasedAt: (p ? hist[1] : hist[0])?.purchasedAt ?? null } }];
    if (p) ops.push({ type: 'remove', coll: 'purchases', id: p.id });
    await backend.commit(ctx.accountId, ops);
    showToast(`${it.name} is back on the list`);
  }
  const act = (fn, msg) => async (it) => { const undo = await fn(ctx, it); showToast(msg(it), undo); };
  const doSnooze = act(snooze, (it) => `Snoozed ${it.name} for a week`);
  const doRemove = act(takeOffList, (it) => `Took ${it.name} off the list`);
  const doAdd = act(putOnList, (it) => `Added ${it.name}`);

  const total = estimate(onList);
  const openItem = items.find((i) => i.id === openId);

  return (
    <>
      <QuickAdd />

      {editor && requested.length > 0 && (
        <section aria-labelledby="req-h">
          <div className="section-h"><h2 id="req-h">Requests to approve</h2><span className="small muted">{requested.length}</span></div>
          <div className="list">
            {requested.map((it) => (
              <SwipeRow key={it.id} onRight={() => act(approve, (x) => `Approved ${x.name}`)(it)} rightLabel="Approve" onLeft={() => act(decline, (x) => `Declined ${x.name}`)(it)} leftLabel="Decline">
                <ItemRow item={it} readOnly onOpen={() => setOpenId(it.id)} extra={
                  <span className="row" style={{ gap: 6 }}>
                    <button type="button" className="chip blue" onClick={(e) => { e.stopPropagation(); act(approve, (x) => `Approved ${x.name}`)(it); }}>Approve</button>
                    <button type="button" className="chip" onClick={(e) => { e.stopPropagation(); act(decline, (x) => `Declined ${x.name}`)(it); }}>Decline</button>
                  </span>
                } />
              </SwipeRow>
            ))}
          </div>
        </section>
      )}

      {editor && suggestions.length > 0 && (
        <section aria-labelledby="sug-h">
          <div className="section-h"><h2 id="sug-h">Running low soon</h2><span className="small muted">tap to add</span></div>
          <div className="suggest-strip">
            {suggestions.map(({ it, p }) => (
              <button key={it.id} type="button" className={`chip${p.daysLeft < 1 ? ' gold' : ''}`} onClick={() => doAdd(it)} title={`Usually every ${Math.round(p.intervalDays)} days`}>
                + {it.name} · {describePrediction(p).replace('Due ', '')}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="section-h" style={{ marginTop: 14 }}>
        <div>
          <h2>{onList.length ? `${onList.length} item${onList.length === 1 ? '' : 's'} to get` : 'Your list'}</h2>
          {total > 0 && editor && <div className="small muted">About {fmtMoney(total)} at last prices</div>}
        </div>
        <div className="seg" role="group" aria-label="Group list by">
          <button type="button" aria-pressed={groupBy === 'category'} onClick={() => setGroup('category')}>Aisle</button>
          <button type="button" aria-pressed={groupBy === 'store'} onClick={() => setGroup('store')}>Store</button>
        </div>
      </div>

      {onList.length === 0 && ordered.length === 0 && (
        <div className="card empty">
          <h2>Nothing to buy right now</h2>
          <p>When you notice something running low, type it above or tap the mic and say it. Separate several items with commas.</p>
        </div>
      )}

      {groups.map(([name, list]) => (
        <section key={name} aria-label={name}>
          <div className="section-h"><h3>{name}</h3><span className="small muted">{list.length}</span></div>
          <div className="list">
            {list.map((it) => (
              <SwipeRow key={it.id} disabled={!editor} onRight={() => bought(it)} onLeft={() => doSnooze(it)} onFarLeft={() => doRemove(it)}>
                <ItemRow item={it} pred={predictions[it.id]} showStore={groupBy !== 'store'} showCategory={groupBy === 'store'} readOnly={!editor}
                  onToggle={() => bought(it)} onOpen={() => setOpenId(it.id)} onSnooze={editor ? () => doSnooze(it) : null} onRemove={editor ? () => doRemove(it) : null} />
              </SwipeRow>
            ))}
          </div>
        </section>
      ))}

      {ordered.length > 0 && (
        <section aria-labelledby="ord-h">
          <div className="section-h"><h2 id="ord-h">On order</h2><span className="small muted">mark arrived in Trips</span></div>
          <div className="list">
            {ordered.map((it) => <ItemRow key={it.id} item={it} readOnly onOpen={() => setOpenId(it.id)} />)}
          </div>
        </section>
      )}

      {recent.length > 0 && editor && (
        <section aria-labelledby="got-h">
          <div className="section-h"><h2 id="got-h">Got it today</h2><span className="small muted">tap a check to undo</span></div>
          <div className="list">
            {recent.map((it) => <ItemRow key={it.id} item={it} done onToggle={() => unbuy(it)} onOpen={() => setOpenId(it.id)} />)}
          </div>
        </section>
      )}

      {snoozed.length > 0 && editor && (
        <section>
          <div className="section-h">
            <button type="button" className="btn ghost" style={{ padding: 0 }} onClick={() => setShowSnoozed((s) => !s)} aria-expanded={showSnoozed}>
              Snoozed ({snoozed.length}) {showSnoozed ? '▴' : '▾'}
            </button>
          </div>
          {showSnoozed && (
            <div className="list">
              {snoozed.map((it) => (
                <SwipeRow key={it.id} onRight={() => doAdd(it)} rightLabel="Back on list">
                  <ItemRow item={it} onToggle={() => doAdd(it)} onOpen={() => setOpenId(it.id)} extra={<span>until {new Date(it.snoozeUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>} />
                </SwipeRow>
              ))}
            </div>
          )}
        </section>
      )}

      {editor && onList.length > 0 && (
        <p className="tiny muted" style={{ textAlign: 'center', marginTop: 18 }}>
          Swipe right when you've got it · swipe left to snooze · long swipe left to take it off
        </p>
      )}

      {openItem && <ItemSheet item={openItem} onClose={() => setOpenId(null)} />}
    </>
  );
}
