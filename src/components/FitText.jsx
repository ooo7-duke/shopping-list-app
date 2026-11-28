// Text at the largest size that fits, without ever splitting a word across two lines.
//   lines={1}: one line. Too long, it shrinks a little (to `min` of its size, 80% unless set), then ends in "…".
//   lines={2} (or more): whole words wrap onto up to that many lines. A single word too wide for the
//   line shrinks the text a little; past `min` that word alone is shortened with "…". With
//   `fitLines`, the text also shrinks so the whole thing fits in those lines before "…" is used.
// The page never scrolls sideways because of it.
import { useEffect, useLayoutEffect, useRef } from 'react';

const queued = new Set();
const mounted = new Set();
let frame = 0;
let ro = null;
let ctx2d = null;

function measurer(cs, size) {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
  ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
  return (t) => ctx2d.measureText(t).width;
}

// Shortens any word wider than `room` to the most letters that fit with "…" after them.
function shortenWords(text, room, width) {
  return text.split(/(\s+)/).map((w) => {
    if (!w.trim() || width(w) <= room) return w;
    let n = w.length - 1;
    while (n > 1 && width(`${w.slice(0, n)}…`) > room) n -= 1;
    return `${w.slice(0, n)}…`;
  }).join('');
}

// How many lines the words take when wrapped whole into `room`.
function wrapCount(text, room, width) {
  const sp = width(' ');
  let n = 1;
  let cur = 0;
  for (const w of text.split(/\s+/)) {
    if (!w) continue;
    const ww = width(w);
    if (!cur) cur = ww;
    else if (cur + sp + ww <= room) cur += sp + ww;
    else { n += 1; cur = ww; }
  }
  return n;
}

function fit(el) {
  const inner = el.firstElementChild;
  if (!inner || !el.isConnected) return false;
  const room = el.clientWidth - 1;
  if (room <= 0) return false;
  const lines = Number(el.dataset.lines) || 1;
  const min = Number(el.dataset.min) || 0.8;
  const cur = Number(el.dataset.fit) || 1;
  const cs = getComputedStyle(el);
  const base = parseFloat(cs.fontSize) / cur;
  const full = el.dataset.full ?? null;
  const text = full ?? inner.textContent;
  const width = measurer(cs, base);
  // The widest thing that may not break: the whole line, or the longest word.
  const need = lines === 1 ? width(text) : Math.max(0, ...text.split(/\s+/).map(width));
  let s = need <= room ? 1 : Math.max(min, Math.floor((room / need) * 100) / 100);
  const apply = (v) => { el.dataset.fit = String(v); el.style.fontSize = v === 1 ? '' : `${(base * v).toFixed(2)}px`; };
  // With fitLines, step the size down until the whole text wraps into its lines (measured, not guessed).
  if (el.dataset.fitLines && lines > 1) {
    while (s > min && wrapCount(text, room - 1, measurer(cs, base * s)) > lines) s = Math.max(min, Math.round((s - 0.02) * 100) / 100);
  }
  if (s !== cur) apply(s);
  // The page's own wrapping is the final word: if the box still holds more lines than it shows, step down again.
  if (el.dataset.fitLines && lines > 1) {
    // Count the lines the words really take, with the line limit lifted for a moment.
    const used = () => {
      const was = el.style.display;
      el.style.display = 'block';
      const n = new Set([...inner.getClientRects()].map((r) => Math.round(r.top))).size;
      el.style.display = was;
      return n;
    };
    for (let i = 0; i < 12 && s > min && used() > lines; i += 1) {
      s = Math.max(min, Math.round((s - 0.02) * 100) / 100);
      apply(s);
    }
  }
  // Past the smallest size, a word that still can't fit is shortened, never split.
  if (lines > 1 && full != null) {
    // A box narrower than three letters is still being laid out; leave the words whole until it settles.
    const shown = need * s > room && room >= base * 3 ? shortenWords(full, room, measurer(cs, base * s)) : full;
    const node = inner.firstChild;
    if (node && node.nodeType === 3 && node.nodeValue !== shown) node.nodeValue = shown;
  }
  return s !== cur;
}

function flush() {
  frame = 0;
  const els = [...queued];
  queued.clear();
  for (const el of els) if (fit(el)) queued.add(el); // check once more after a change
  if (queued.size && !frame) frame = requestAnimationFrame(flush);
}

function queue(el) {
  queued.add(el);
  if (!frame) frame = requestAnimationFrame(flush);
}

function refitAll() { mounted.forEach(queue); }

// When the phone's text size changes while the app is open, every fitted box measures again.
const remListeners = new Set();
let sentinel = null;
function watchTextSize() {
  if (sentinel || typeof document === 'undefined' || typeof ResizeObserver === 'undefined' || !document.body) return;
  sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;left:0;top:0;width:1rem;height:1rem;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.appendChild(sentinel);
  let last = 0;
  new ResizeObserver(() => {
    const w = sentinel.offsetWidth;
    if (w && w !== last) { refitAll(); remListeners.forEach((fn) => fn()); last = w; }
  }).observe(sentinel);
}
export function onTextSizeChange(fn) { watchTextSize(); remListeners.add(fn); return () => remListeners.delete(fn); }

if (typeof window !== 'undefined') {
  document.fonts?.ready?.then(refitAll);
  window.addEventListener('resize', refitAll);
}

export default function FitText({ as: Tag = 'div', className = '', lines = 1, fitLines = false, min, children, style, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!ro && typeof ResizeObserver !== 'undefined') {
      let widths = new WeakMap();
      ro = new ResizeObserver((entries) => entries.forEach((e) => {
        const w = Math.round(e.contentRect.width);
        if (widths.get(e.target) !== w) { widths.set(e.target, w); queue(e.target); }
      }));
    }
    watchTextSize();
    mounted.add(el);
    ro?.observe(el);
    return () => { mounted.delete(el); ro?.unobserve(el); queued.delete(el); };
  }, []);
  useLayoutEffect(() => { if (ref.current) queue(ref.current); });
  const plain = typeof children === 'string';
  return (
    <Tag ref={ref} className={`fit${lines > 1 ? ' fit-lines' : ''} ${className}`} data-lines={lines} data-min={min} data-fit-lines={fitLines || undefined}
      data-full={plain && lines > 1 ? children : undefined} style={lines > 1 ? { ...style, WebkitLineClamp: lines } : style} {...rest}>
      <span className="fit-in">{children}</span>
    </Tag>
  );
}

// A table at the largest text size that fits the card, so it never scrolls sideways. When even the
// smallest size is too wide, the first column may move whole words to a second line.
export function FitTable({ min = 0.7, className = '', children }) {
  const ref = useRef(null);
  const run = useRef(null);
  run.current = () => {
    const box = ref.current;
    const t = box?.querySelector('table');
    if (!t) return;
    box.classList.remove('fit-wrap');
    t.style.fontSize = '';
    const room = box.clientWidth;
    if (!room || t.offsetWidth <= room) return;
    const base = parseFloat(getComputedStyle(t).fontSize) || 16;
    const at = (s) => { t.style.fontSize = `${(base * s).toFixed(2)}px`; return t.offsetWidth <= room; };
    if (!at(min)) { box.classList.add('fit-wrap'); return; }
    let lo = min; let hi = 1;
    for (let i = 0; i < 7; i += 1) { const mid = (lo + hi) / 2; if (at(mid)) lo = mid; else hi = mid; }
    at(lo);
  };
  useLayoutEffect(() => { run.current(); });
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    let w = box.clientWidth;
    const obs = new ResizeObserver(() => { if (box.clientWidth !== w) { w = box.clientWidth; run.current(); } });
    obs.observe(box);
    const again = () => run.current();
    document.fonts?.ready?.then(again);
    window.addEventListener('resize', again);
    const off = onTextSizeChange(again);
    return () => { obs.disconnect(); window.removeEventListener('resize', again); off(); };
  }, []);
  return <div ref={ref} className={`card fit-table ${className}`}>{children}</div>;
}
