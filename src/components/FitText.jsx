// One line of text at the largest size that fits. A line that is too long shrinks a little (down
// to `min` of its normal size, 80% unless set), and only past that ends in "…". It never wraps and
// never pushes the page sideways.
import { useEffect, useLayoutEffect, useRef } from 'react';

const queued = new Set();
const mounted = new Set();
let frame = 0;
let ro = null;

// Read every queued line first, then write, so a long list costs one layout pass.
function flush() {
  frame = 0;
  const els = [...queued];
  queued.clear();
  const reads = els.map((el) => {
    const inner = el.firstElementChild;
    if (!inner || !el.isConnected) return null;
    const cur = Number(inner.dataset.fit) || 1;
    return { el, inner, cur, room: el.clientWidth, width: inner.getBoundingClientRect().width, min: Number(el.dataset.min) || 0.8 };
  });
  for (const r of reads) {
    if (!r || !r.room) continue;
    const natural = r.width / r.cur;
    const s = natural <= r.room ? 1 : Math.max(r.min, Math.floor(((r.room - 1) / natural) * 100) / 100);
    if (s !== r.cur) {
      r.inner.dataset.fit = String(s);
      r.inner.style.fontSize = s === 1 ? '' : `${s}em`;
      queue(r.el); // check once more: text does not always scale exactly with its size
    }
  }
}

function queue(el) {
  queued.add(el);
  if (!frame) frame = requestAnimationFrame(flush);
}

function refitAll() { mounted.forEach(queue); }

if (typeof window !== 'undefined') {
  document.fonts?.ready?.then(refitAll);
  window.addEventListener('resize', refitAll);
}

export default function FitText({ as: Tag = 'div', className = '', min, children, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!ro && typeof ResizeObserver !== 'undefined') ro = new ResizeObserver((entries) => entries.forEach((e) => queue(e.target)));
    mounted.add(el);
    ro?.observe(el);
    return () => { mounted.delete(el); ro?.unobserve(el); queued.delete(el); };
  }, []);
  useLayoutEffect(() => { if (ref.current) queue(ref.current); });
  return (
    <Tag ref={ref} className={`fit ${className}`} data-min={min} {...rest}>
      <span className="fit-in">{children}</span>
    </Tag>
  );
}

// A table at the largest text size that fits the card. When even the smallest size is too wide,
// the first column may wrap, so the table still never scrolls sideways.
export function FitTable({ min = 0.7, className = '', children }) {
  const ref = useRef(null);
  const fit = useRef(null);
  fit.current = () => {
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
  useLayoutEffect(() => { fit.current(); });
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    let w = box.clientWidth;
    const obs = new ResizeObserver(() => { if (box.clientWidth !== w) { w = box.clientWidth; fit.current(); } });
    obs.observe(box);
    const again = () => fit.current();
    document.fonts?.ready?.then(again);
    window.addEventListener('resize', again);
    return () => { obs.disconnect(); window.removeEventListener('resize', again); };
  }, []);
  return <div ref={ref} className={`card fit-table ${className}`}>{children}</div>;
}
