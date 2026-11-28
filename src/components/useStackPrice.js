// A list row keeps its amount on the right while the name still has room. When the amount, photo,
// check and trash can would squeeze the name to under about 8 letters' width, the amount moves to its
// own line under the trash can instead. Nothing shrinks to fit and nothing scrolls sideways.
import { useLayoutEffect, useRef } from 'react';

const MIN_EM = 8;
const rows = new Set();
let ro = null;
const px = (v) => parseFloat(v) || 0;

function check(row) {
  if (!row.isConnected) return;
  const grow = row.querySelector(':scope > .grow');
  const price = row.querySelector(':scope > .price');
  if (!grow || !price) { row.classList.remove('stack'); return; }
  const cs = getComputedStyle(row);
  const gap = px(cs.columnGap);
  const inner = row.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  if (inner <= 0) return;
  let fixed = 0;
  let n = 0;
  for (const k of row.children) {
    if (k === grow || k === price) continue;
    const kcs = getComputedStyle(k);
    if (kcs.display === 'none' || kcs.position === 'absolute' || kcs.position === 'fixed') continue;
    fixed += k.getBoundingClientRect().width + px(kcs.marginLeft) + px(kcs.marginRight);
    n += 1;
  }
  const pcs = getComputedStyle(price);
  const pw = price.getBoundingClientRect().width + px(pcs.marginRight);
  const em = px(getComputedStyle(grow).fontSize) || 16;
  const left = inner - fixed - pw - gap * (n + 1);
  row.style.setProperty('--row-fixed', `${Math.ceil(fixed + gap * n) + 1}px`);
  row.classList.toggle('stack', left < MIN_EM * em);
}

function checkAll() { rows.forEach(check); }
if (typeof window !== 'undefined') {
  document.fonts?.ready?.then(checkAll);
  window.addEventListener('resize', checkAll);
}

export default function useStackPrice() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return undefined;
    if (!ro && typeof ResizeObserver !== 'undefined') {
      const widths = new WeakMap();
      ro = new ResizeObserver((entries) => entries.forEach((e) => {
        const w = Math.round(e.contentRect.width);
        if (widths.get(e.target) !== w) { widths.set(e.target, w); check(e.target); }
      }));
    }
    rows.add(row);
    ro?.observe(row);
    return () => { rows.delete(row); ro?.unobserve(row); };
  }, []);
  useLayoutEffect(() => { if (ref.current) check(ref.current); });
  return ref;
}
