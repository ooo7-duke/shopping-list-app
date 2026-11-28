import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import QuickAdd from './QuickAdd.jsx';
import SwipeRow from './SwipeRow.jsx';
import ItemRow from './ItemRow.jsx';
import ItemSheet from './ItemSheet.jsx';
import { isOnList, isRecentlyBought, markBought, snoozeUntil, takeOffList, putOnList, estimate } from '../data/actions.js';
import Sheet from './Sheet.jsx';
import SnoozePicker from './SnoozePicker.jsx';
import { lastPurchaseMap, lastBuy } from '../lib/history.js';
import { describePrediction, DAY } from '../lib/predict.js';
import { can, DEMO_MODE } from '../lib/config.js';
import { classifyNames } from '../lib/classify.js';
import { fmtMoney } from '../lib/format.js';
import { saveErrorMessage } from '../lib/errors.js';
import { TrashIcon } from './Icons.jsx';
import { sharedThemes } from '../lib/themes.js';
import { guessCategory, HOUSEHOLD_CATEGORIES } from '../lib/categories.js';

const GROUP_KEY = 'sla-group-by';
const FILTER_KEY = 'sla-type-filter';
const FOLD_KEY = 'sla-folded-groups'; // sessionStorage: groups open again when the app is reopened
const LOW_LIMIT = 6; // chips shown before "Show all"
const SORT_PASS = 2; // 2: Electronics became its own type, and Other became a last resort

export default function ListView() {
  const { ctx, items, purchases, predictions, role, account, showToast, backend } = useApp();
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem(GROUP_KEY) || 'category');
  const [openId, setOpenId] = useState(null);
  const [openFocus, setOpenFocus] = useState(null);
  const latest = useMemo(() => lastPurchaseMap(purchases), [purchases]);
  const open = (id, focus = null) => { setOpenId(id); setOpenFocus(focus); };
  const [showSnoozed, setShowSnoozed] = useState(false);
  // Items stuck in "Other" get sorted: keywords first, then the AI for the rest. SORT_PASS goes up
  // when the types or the sorting get better, so items sorted before get one more try. Household
  // items that are really electronics move to Electronics. A type picked by hand is never changed.
  const sortedRef = useRef(new Set());
  useEffect(() => {
    if (!can(role, 'edit') || !backend?.commit) return undefined;
    const cats = account?.categories || HOUSEHOLD_CATEGORIES;
    const stale = (it) => !it.categoryByHand && (it.sortPass || 0) < SORT_PASS && !sortedRef.current.has(it.id);
    const misplaced = (it) => cats.includes('Electronics') && it.category === 'Household' && guessCategory(`${it.name} ${it.note || ''}`, cats) === 'Electronics';
    const todo = items.filter((it) => stale(it) && (!it.category || it.category === 'Other' || misplaced(it))).slice(0, 60);
    if (!todo.length) return undefined;
    const t = setTimeout(async () => {
      todo.forEach((it) => sortedRef.current.add(it.id));
      const ops = [];
      const ask = [];
      for (const it of todo) {
        const g = guessCategory(`${it.name} ${it.note || ''}`, cats);
        if (g !== 'Other') ops.push({ type: 'update', coll: 'items', id: it.id, data: { category: g, sortPass: SORT_PASS } });
        else ask.push(it);
      }
      if (ask.length && !DEMO_MODE && backend.getApp) {
        try {
          const found = await classifyNames(ask.map((it) => it.name), cats, backend.getApp());
          for (const it of ask) ops.push({ type: 'update', coll: 'items', id: it.id, data: { category: found.get(it.name) || 'Other', aiSortedAt: Date.now(), sortPass: SORT_PASS } });
        } catch (e) {
          console.warn('Sorting by AI failed; will try again next time', e);
        }
      }
      if (ops.length) await backend.commit(ctx.accountId, ops).catch((e) => console.warn('Saving sorted types failed', e));
    }, 1200);
    return () => clearTimeout(t);
  }, [items, role, backend, account, ctx.accountId]);
  const [showAllLow, setShowAllLow] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const editor = can(role, 'edit');
  const now = Date.now();
  const lookahead = account?.settings?.lookaheadDays ?? 10;

  const onList = items.filter((it) => isOnList(it, now) && it.status !== 'ordered');
  const ordered = items.filter((it) => it.status === 'ordered');
  const snoozed = items.filter((it) => it.status === 'snoozed' && (it.snoozeUntil || 0) > now);
  const recent = items.filter((it) => isRecentlyBought(it, now)).sort((a, b) => b.lastPurchasedAt - a.lastPurchasedAt);

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
  // Types follow the list's own order, which for households is the way you walk a store.
  const catOrder = account?.categories || HOUSEHOLD_CATEGORIES;
  const pos = (k) => { const i = catOrder.indexOf(k); return i < 0 ? 999 : i; };
  const byRank = (a, b) => rank(a) - rank(b) || pos(a) - pos(b) || a.localeCompare(b);

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
  const [folded, setFolded] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); }
  });
  const foldId = (name) => `${groupBy}:${name}`;
  const saveFolded = (next) => {
    setFolded(next);
    try { sessionStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
  };
  const toggleFold = (name) => {
    const next = new Set(folded);
    const id = foldId(name);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveFolded(next);
  };
  const shown = activeFilter.size ? onList.filter((it) => activeFilter.has(typeInfo.map.get(it.id))) : onList;

  const groupKey = (it) => (groupBy === 'store' ? it.store || 'Anywhere' : typeInfo.map.get(it.id) || 'Other');

  // Tapping "already on the list" under the add box brings that item into view: its type filter and
  // folded group are opened, then the row is scrolled to the middle of the screen and lit up briefly.
  const [jump, setJump] = useState(null);
  const jumpTo = (it) => {
    if (it.status !== 'ordered') {
      if (activeFilter.size && !activeFilter.has(typeInfo.map.get(it.id))) saveFilter(new Set());
      const id = foldId(groupKey(it));
      if (folded.has(id)) { const next = new Set(folded); next.delete(id); saveFolded(next); }
    }
    setJump({ id: it.id, at: Date.now() });
  };
  useEffect(() => {
    if (!jump) return undefined;
    let timer;
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector(`.item[data-item-id="${CSS.escape(jump.id)}"]`);
      if (!el) return;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      el.classList.remove('jump-hl');
      void el.offsetWidth; // restart the glow if the same row is tapped twice
      el.classList.add('jump-hl');
      timer = setTimeout(() => el.classList.remove('jump-hl'), 2400);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [jump]);

  const groups = useMemo(() => {
    const m = new Map();
    const key = groupKey;
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
  // Snoozing asks how long: the clock button, a swipe left and the S key all open the choices.
  const [snoozeFor, setSnoozeFor] = useState(null);
  const doSnooze = (it) => setSnoozeFor(it);
  async function pickSnooze(until, label) {
    const it = snoozeFor;
    setSnoozeFor(null);
    const undo = await snoozeUntil(ctx, it, until);
    const back = new Date(until).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    showToast(`Snoozed ${it.name} ${label.startsWith('until') ? '' : `for ${label} `}until ${back}`, undo);
  }
  const doRemove = act(takeOffList, (it) => `Deleted ${it.name} from the list`);
  // Clear all purges the list: every shown item comes off in one go, with Undo. Nothing is
  // logged as bought and nothing shows as crossed off; earlier purchases and prices stay.
  const [clearAsk, setClearAsk] = useState(false);
  async function clearAll() {
    const list = shown.filter((it) => it.status !== 'ordered');
    setClearAsk(false);
    if (!list.length) return;
    const at = Date.now();
    const ops = list.map((it) => ({ type: 'update', coll: 'items', id: it.id, data: { status: 'stocked', removedAt: at } }));
    const back = list.map((it) => ({ type: 'update', coll: 'items', id: it.id, data: { status: it.status, snoozeUntil: it.snoozeUntil ?? null, removedAt: it.removedAt ?? null } }));
    try {
      await backend.commit(ctx.accountId, ops);
      showToast(`Cleared ${list.length} item${list.length === 1 ? '' : 's'} from the list`, () => backend.commit(ctx.accountId, back), 12000);
    } catch (e) {
      showToast(saveErrorMessage(e, 'clear the list'));
    }
  }
  const doAdd = act(putOnList, (it) => `Added ${it.name}`);

  const total = estimate(shown);
  const openItem = items.find((i) => i.id === openId);

  return (
    <>
      <QuickAdd onJump={jumpTo} />

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
          <div className="seg" role="group" aria-label="Group by">
            <button type="button" aria-pressed={groupBy === 'category'} onClick={() => setGroup('category')}>By type</button>
            <button type="button" aria-pressed={groupBy === 'store'} onClick={() => setGroup('store')}>By store</button>
          </div>
        </div>
      )}

      {typeCounts.length > 1 && (
        <div className="type-pick">
          <button type="button" className="type-pick-btn" aria-expanded={filterOpen} aria-controls="type-pick-list" onClick={() => setFilterOpen((o) => !o)}>
            <span className="muted">Show:</span>
            <span className="ellipsis">{activeFilter.size ? [...activeFilter].join(', ') : 'All types'}</span>
            <span className={`chev${filterOpen ? ' open' : ''}`} aria-hidden="true">›</span>
          </button>
          {filterOpen && (
            <div id="type-pick-list" className="type-pick-list" role="group" aria-label="Show only these types">
              <label className="type-opt">
                <input type="checkbox" checked={!activeFilter.size} onChange={() => saveFilter(new Set())} />
                <span className="grow">All types</span>
                <span className="muted">{onList.length}</span>
              </label>
              {typeCounts.map(([t, n]) => (
                <label key={t} className="type-opt">
                  <input type="checkbox" checked={activeFilter.has(t)} onChange={() => toggleType(t)} />
                  <span className="grow">{t}</span>
                  <span className="muted">{n}</span>
                </label>
              ))}
              <button type="button" className="btn primary type-done" onClick={() => setFilterOpen(false)}>Done</button>
            </div>
          )}
        </div>
      )}

      {editor && shown.length > 0 && (
        <div className="clear-row">
          <button type="button" className="btn danger clear-btn" onClick={() => setClearAsk(true)}>
            <TrashIcon /> {activeFilter.size ? `Clear these ${shown.length}` : 'Clear all'}
          </button>
        </div>
      )}

      {clearAsk && (
        <Sheet title={activeFilter.size ? `Clear these ${shown.length} items?` : 'Clear the whole list?'} onClose={() => setClearAsk(false)}>
          <p>This takes {shown.length === 1 ? 'the 1 item' : `all ${shown.length} items`}{activeFilter.size ? ' you are showing' : ''} off the list for everyone who shares it.</p>
          <p className="small muted">Nothing is logged as bought. Purchases you logged before stay, so Running low and price checks still work. You can tap Undo for a few seconds after.</p>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button type="button" className="btn grow" onClick={() => setClearAsk(false)}>Cancel</button>
            <button type="button" className="btn danger grow" onClick={clearAll}>Clear {shown.length} item{shown.length === 1 ? '' : 's'}</button>
          </div>
        </Sheet>
      )}

      {groups.length > 2 && (
        <div className="fold-all">
          {groups.every(([n]) => folded.has(foldId(n)))
            ? <button type="button" className="linkish" onClick={() => saveFolded(new Set([...folded].filter((f) => !groups.some(([n]) => f === foldId(n)))))}>Open all groups</button>
            : <button type="button" className="linkish" onClick={() => saveFolded(new Set([...folded, ...groups.map(([n]) => foldId(n))]))}>Fold all groups</button>}
        </div>
      )}

      {onList.length === 0 && ordered.length === 0 && (
        <div className="card empty">
          <h2>Nothing to buy right now</h2>
          <p>When you notice something running low, type it above or tap the mic and say it. Separate several items with commas.</p>
        </div>
      )}


      {groups.map(([name, list]) => {
        const isFolded = folded.has(foldId(name));
        return (
        <section key={name} aria-label={name}>
          <button type="button" className="section-h fold-h" aria-expanded={!isFolded} onClick={() => toggleFold(name)}>
            <h3><span className={`chev${isFolded ? '' : ' open'}`} aria-hidden="true">›</span>{name}</h3>
            <span className="small muted">{list.length}</span>
          </button>
          {!isFolded && <div className="list">
            {list.map((it) => (
              <SwipeRow key={it.id} disabled={!editor} onRight={() => bought(it)} onLeft={() => doSnooze(it)} onFarLeft={() => doRemove(it)}>
                <ItemRow item={it} pred={predictions[it.id]} showStore={groupBy !== 'store'} showCategory={groupBy === 'store'} readOnly={!editor}
                  showHistory last={lastBuy(it, latest[it.id])} onPrices={() => open(it.id, 'prices')}
                  onToggle={() => bought(it)} onOpen={() => open(it.id)} onSnooze={editor ? () => doSnooze(it) : null} onDelete={editor ? () => doRemove(it) : null} />
              </SwipeRow>
            ))}
          </div>}
        </section>
        );
      })}

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
          Swipe right when you've got it · swipe left to snooze (you pick how long) · long swipe left to take it off
        </p>
      )}

      {snoozeFor && (
        <Sheet title={`Snooze ${snoozeFor.name}`} onClose={() => setSnoozeFor(null)}>
          <p className="small muted" style={{ marginBottom: 10 }}>It leaves the list and comes back on the day you pick.</p>
          <SnoozePicker onPick={pickSnooze} />
        </Sheet>
      )}
      {openItem && <ItemSheet item={openItem} focus={openFocus} onClose={() => setOpenId(null)} />}
    </>
  );
}
