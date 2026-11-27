import { useMemo, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import QuickAdd from './QuickAdd.jsx';
import SwipeRow from './SwipeRow.jsx';
import ItemRow from './ItemRow.jsx';
import ItemSheet from './ItemSheet.jsx';
import { isOnList, markBought, snooze, takeOffList, putOnList, estimate } from '../data/actions.js';
import { lastPurchaseMap, lastBuy } from '../lib/history.js';
import { describePrediction, DAY } from '../lib/predict.js';
import { can } from '../lib/config.js';
import { fmtMoney } from '../lib/format.js';
import { sharedThemes } from '../lib/themes.js';
import { guessCategory, HOUSEHOLD_CATEGORIES } from '../lib/categories.js';

const GROUP_KEY = 'sla-group-by';
const FILTER_KEY = 'sla-type-filter';
const LOW_LIMIT = 6; // chips shown before "Show all"

export default function ListView() {
  const { ctx, items, purchases, predictions, role, account, showToast, backend } = useApp();
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem(GROUP_KEY) || 'category');
  const [openId, setOpenId] = useState(null);
  const [openFocus, setOpenFocus] = useState(null);
  const latest = useMemo(() => lastPurchaseMap(purchases), [purchases]);
  const open = (id, focus = null) => { setOpenId(id); setOpenFocus(focus); };
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showAllLow, setShowAllLow] = useState(false);
  const editor = can(role, 'edit');
  const now = Date.now();
  const lookahead = account?.settings?.lookaheadDays ?? 10;

  const onList = items.filter((it) => isOnList(it, now) && it.status !== 'ordered');
  const ordered = items.filter((it) => it.status === 'ordered');
  const snoozed = items.filter((it) => it.status === 'snoozed' && (it.snoozeUntil || 0) > now);
  const recent = items.filter((it) => it.status === 'stocked' && it.lastPurchasedAt && now - it.lastPurchasedAt < DAY).sort((a, b) => b.lastPurchasedAt - a.lastPurchasedAt);

  const suggestions = useMemo(() => items
    .filter((it) => !isOnList(it, now) && it.status !== 'snoozed')
    .map((it) => ({ it, p: predictions[it.id] }))
    .filter(({ p }) => p && (p.basis === 'history' || p.basis === 'manual') && p.daysLeft <= lookahead)
    .sort((a, b) => a.p.daysLeft - b.p.daysLeft), [items, predictions, lookahead, now]);

  // Each item's type: a shared occasion (two Christmas items, say) first, then its type.
  // Items still marked Other get a fresh guess from their name.
  const typeInfo = useMemo(() => {
    const themed = sharedThemes(onList);
    const cats = account?.categories || HOUSEHOLD_CATEGORIES;
    const map = new Map();
    for (const it of onList) {
      map.set(it.id, themed.get(it.id) || (it.category && it.category !== 'Other' ? it.category : guessCategory(it.name, cats) || 'Other'));
    }
    return { map, themes: new Set(themed.values()) };
  }, [onList, account]);
  const rank = (k) => (typeInfo.themes.has(k) ? 0 : k === 'Anywhere' || k === 'Other' ? 2 : 1);
  const byRank = (a, b) => rank(a) - rank(b) || a.localeCompare(b);

  // Type filter: tap one or more types to show only those. None picked shows everything.
  const [typeFilter, setTypeFilter] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FILTER_KEY) || '[]')); } catch { return new Set(); }
  });
  const typeCounts = useMemo(() => {
    const c = new Map();
    for (const t of typeInfo.map.values()) c.set(t, (c.get(t) || 0) + 1);
    return [...c.entries()].sort((a, b) => byRank(a[0], b[0]));
  }, [typeInfo]);
  const activeFilter = new Set([...typeFilter].filter((t) => typeInfo.map.size && typeCounts.some(([k]) => k === t)));
  const saveFilter = (next) => {
    setTypeFilter(next);
    try { localStorage.setItem(FILTER_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
  };
  const toggleType = (t) => {
    const next = new Set(activeFilter);
    if (next.has(t)) next.delete(t); else next.add(t);
    saveFilter(next);
  };
  const shown = activeFilter.size ? onList.filter((it) => activeFilter.has(typeInfo.map.get(it.id))) : onList;

  const groups = useMemo(() => {
    const m = new Map();
    const key = (it) => (groupBy === 'store' ? it.store || 'Anywhere' : typeInfo.map.get(it.id) || 'Other');
    for (const it of shown) {
      const k = key(it);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    for (const list of m.values()) list.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.name.localeCompare(b.name));
    return [...m.entries()].sort((a, b) => byRank(a[0], b[0]));
  }, [shown, groupBy, typeInfo]);

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

  const total = estimate(shown);
  const openItem = items.find((i) => i.id === openId);

  return (
    <>
      <QuickAdd />

      {editor && suggestions.length > 0 && (
        <section aria-labelledby="sug-h">
          <div className="section-h"><h2 id="sug-h">Running low soon</h2><span className="small muted">tap one to add it</span></div>
          <div className="suggest-strip">
            {(showAllLow ? suggestions : suggestions.slice(0, LOW_LIMIT)).map(({ it, p }) => (
              <button key={it.id} type="button" className={`chip${p.daysLeft < 1 ? ' gold' : ''}`} onClick={() => doAdd(it)} title={`Usually every ${Math.round(p.intervalDays)} days`}>
                + {it.name} · {describePrediction(p).toLowerCase()}
              </button>
            ))}
            {suggestions.length > LOW_LIMIT && (
              <button type="button" className="chip blue" onClick={() => setShowAllLow((v) => !v)} aria-expanded={showAllLow}>
                {showAllLow ? 'Show fewer' : `Show all ${suggestions.length}`}
              </button>
            )}
          </div>
        </section>
      )}

      {onList.length > 0 && (
        <div className="section-h" style={{ marginTop: 14 }}>
          <div>
            <h2>{activeFilter.size ? `${shown.length} of ${onList.length} items` : `${onList.length} item${onList.length === 1 ? '' : 's'} to get`}</h2>
            {total > 0 && editor && <div className="small muted">About {fmtMoney(total)} at last prices</div>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="small muted" id="groupby-l">Group by</span>
            <div className="seg" role="group" aria-labelledby="groupby-l">
              <button type="button" aria-pressed={groupBy === 'category'} onClick={() => setGroup('category')}>Type</button>
              <button type="button" aria-pressed={groupBy === 'store'} onClick={() => setGroup('store')}>Where to buy</button>
            </div>
          </div>
        </div>
      )}

      {typeCounts.length > 1 && (
        <div className="filter-row" role="group" aria-label="Show only these types">
          <button type="button" className={`chip${activeFilter.size ? '' : ' gold'}`} aria-pressed={!activeFilter.size} onClick={() => saveFilter(new Set())}>All</button>
          {typeCounts.map(([t, n]) => (
            <button key={t} type="button" className={`chip${activeFilter.has(t) ? ' gold' : ''}`} aria-pressed={activeFilter.has(t)} onClick={() => toggleType(t)}>
              {t} <span className="muted">{n}</span>
            </button>
          ))}
        </div>
      )}

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
                  showHistory last={lastBuy(it, latest[it.id])} onPrices={() => open(it.id, 'prices')}
                  onToggle={() => bought(it)} onOpen={() => open(it.id)} onSnooze={editor ? () => doSnooze(it) : null} onRemove={editor ? () => doRemove(it) : null} />
              </SwipeRow>
            ))}
          </div>
        </section>
      ))}

      {ordered.length > 0 && (
        <section aria-labelledby="ord-h">
          <div className="section-h"><h2 id="ord-h">On order</h2></div>
          <div className="list">
            {ordered.map((it) => <ItemRow key={it.id} item={it} readOnly showHistory last={lastBuy(it, latest[it.id])} onOpen={() => open(it.id)} />)}
          </div>
        </section>
      )}

      {recent.length > 0 && editor && (
        <section aria-labelledby="got-h">
          <div className="section-h"><h2 id="got-h">Got it today</h2><span className="small muted">tap a check to undo</span></div>
          <div className="list">
            {recent.map((it) => <ItemRow key={it.id} item={it} done onToggle={() => unbuy(it)} onOpen={() => open(it.id)} />)}
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
                  <ItemRow item={it} onToggle={() => doAdd(it)} onOpen={() => open(it.id)} extra={<span>until {new Date(it.snoozeUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>} />
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

      {openItem && <ItemSheet item={openItem} focus={openFocus} onClose={() => setOpenId(null)} />}
    </>
  );
}
