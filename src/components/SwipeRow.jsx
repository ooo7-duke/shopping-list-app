import { useRef, useState } from 'react';

// Swipe right = primary action (bought). Swipe left = snooze; a long swipe left = take off list.
// Vertical scrolling is never hijacked: the swipe only starts once the drag is clearly sideways.
export default function SwipeRow({ children, onRight, onLeft, onFarLeft, rightLabel = 'Got it', leftLabel = 'Snooze…', farLeftLabel = 'Take off list', disabled }) {
  const [dx, setDx] = useState(0);
  const [mode, setMode] = useState('idle'); // idle | maybe | drag | settle
  const start = useRef(null);
  const width = useRef(320);
  const moved = useRef(false);

  const onPointerDown = (e) => {
    if (disabled || e.button > 0 || e.target.closest('button, input, select, a')) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    width.current = e.currentTarget.offsetWidth || 320;
    moved.current = false;
    setMode('maybe');
  };
  const onPointerMove = (e) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const x = e.clientX - start.current.x;
    const y = e.clientY - start.current.y;
    if (mode === 'maybe') {
      if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) { start.current = null; setMode('idle'); return; }
      if (Math.abs(x) > 10) {
        setMode('drag');
        moved.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (mode === 'drag') {
      let v = x;
      if (!onLeft && v < 0) v = 0;
      if (!onRight && v > 0) v = 0;
      setDx(v);
    }
  };
  const finish = () => {
    if (mode !== 'drag') { start.current = null; setMode('idle'); return; }
    const w = width.current;
    const v = dx;
    start.current = null;
    setMode('settle');
    if (v > Math.min(110, w * 0.3) && onRight) {
      setDx(w);
      setTimeout(() => { onRight(); setDx(0); setMode('idle'); }, 180);
    } else if (v < -Math.max(w * 0.6, 200) && onFarLeft) {
      setDx(-w);
      setTimeout(() => { onFarLeft(); setDx(0); setMode('idle'); }, 180);
    } else if (v < -Math.min(110, w * 0.3) && onLeft) {
      setDx(-w);
      setTimeout(() => { onLeft(); setDx(0); setMode('idle'); }, 180);
    } else {
      setDx(0);
      setTimeout(() => setMode('idle'), 220);
    }
  };
  // Swallow the click that follows a swipe so it doesn't open the item.
  const onClickCapture = (e) => {
    if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; }
  };

  const far = onFarLeft && dx < -Math.max(width.current * 0.6, 200);
  return (
    <div className="swipe" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish} onClickCapture={onClickCapture}>
      {dx > 0 && <div className="under right" aria-hidden="true"><span>✓ {rightLabel}</span></div>}
      {dx < 0 && <div className={`under left${far ? ' far' : ''}`} aria-hidden="true"><span>{far ? farLeftLabel : leftLabel}</span></div>}
      <div className={`item-wrap ${mode === 'settle' ? 'settle' : ''}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: mode === 'settle' ? 'transform .2s ease' : 'none', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}
