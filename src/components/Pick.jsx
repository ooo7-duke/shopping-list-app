// Press and hold any row to start picking rows, then act on them together. The same parts are
// used on every list: the shopping list, Got it today, Snoozed, receipts, trip folders and expenses.
import { useEffect, useRef, useState } from 'react';
import Sheet from './Sheet.jsx';

const HOLD_MS = 500;
const SLOP = 10;

// Props for a row: a half-second hold (or a right-click) calls onLongPress. The tap that ends the
// hold is swallowed, so it doesn't also open the row.
export function useHold(onLongPress) {
  const p = useRef({ timer: null, fired: false, x: 0, y: 0 });
  const stop = () => { clearTimeout(p.current.timer); p.current.timer = null; };
  useEffect(() => stop, []);
  if (!onLongPress) return {};
  return {
    onPointerDown: (e) => {
      p.current.fired = false;
      if (e.button > 0) return;
      stop();
      p.current.x = e.clientX; p.current.y = e.clientY;
      p.current.timer = setTimeout(() => { p.current.fired = true; navigator.vibrate?.(15); onLongPress(); }, HOLD_MS);
    },
    onPointerMove: (e) => { if (Math.abs(e.clientX - p.current.x) + Math.abs(e.clientY - p.current.y) > SLOP) stop(); },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onContextMenu: (e) => { e.preventDefault(); stop(); if (!p.current.fired) { p.current.fired = true; onLongPress(); } },
    onClickCapture: (e) => { if (p.current.fired) { p.current.fired = false; e.stopPropagation(); e.preventDefault(); } },
  };
}

// Which rows are picked. null means not picking. Rows that leave the list drop out, and picking
// ends when the list is empty.
export function usePick(ids) {
  const [picked, setPicked] = useState(null);
  const key = ids.join('|');
  useEffect(() => {
    if (!picked) return;
    if (!ids.length) { setPicked(null); return; }
    const kept = [...picked].filter((id) => ids.includes(id));
    if (kept.length !== picked.size) setPicked(new Set(kept));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    on: !!picked,
    count: picked ? picked.size : 0,
    has: (id) => !!picked?.has(id),
    ids: picked ? ids.filter((id) => picked.has(id)) : [],
    start: (id) => setPicked((s) => s || new Set([id])),
    toggle: (id) => setPicked((s) => { const n = new Set(s || []); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    all: () => setPicked((s) => (s && s.size === ids.length ? new Set() : new Set(ids))),
    allOn: !!picked && picked.size === ids.length,
    stop: () => setPicked(null),
  };
}

// "2 selected · Select all · Cancel", shown in a section header while picking.
export function PickHeader({ pick }) {
  return (
    <div className="row pick-head" style={{ gap: 4 }}>
      <span className="small" aria-live="polite">{pick.count} selected</span>
      <button type="button" className="btn ghost" onClick={pick.all}>{pick.allOn ? 'Select none' : 'Select all'}</button>
      <button type="button" className="btn ghost" onClick={pick.stop}>Cancel</button>
    </div>
  );
}

// The bar that stays at the bottom of the section while picking.
export function PickBar({ pick, label = 'Selected rows', onDelete }) {
  if (!pick.on) return null;
  return (
    <div className="pick-bar" role="toolbar" aria-label={label}>
      <span>{pick.count} selected</span>
      <button type="button" className="btn danger" disabled={!pick.count} onClick={onDelete}>Delete{pick.count ? ` ${pick.count}` : ''}</button>
    </div>
  );
}

// The round check at the start of a row turns into a square box while picking.
export function PickBox({ on, name, onToggle }) {
  return (
    <button type="button" className={`check pick${on ? ' on' : ''}`} aria-pressed={on} aria-label={`${on ? 'Unselect' : 'Select'} ${name}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <span />
    </button>
  );
}

export function ConfirmDelete({ title, children, count, onCancel, onConfirm }) {
  return (
    <Sheet title={title} onClose={onCancel}>
      {children}
      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <button type="button" className="btn grow" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn danger grow" onClick={onConfirm}>Delete {count}</button>
      </div>
    </Sheet>
  );
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
