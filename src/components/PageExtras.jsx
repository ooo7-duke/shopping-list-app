import { useEffect, useState } from 'react';
import { currentQuota, onQuota, hasPriceProvider } from '../lib/prices.js';
import { DEMO_MODE } from '../lib/config.js';
import { useApp } from '../AppContext.jsx';
import { LOOKS } from '../lib/looks.js';

const HOUSEHOLD_LIMIT = 150;

// The household's price lookups this month, small and faint at the very bottom of the page.
export function LookupMeter() {
  const [quota, setQuota] = useState(currentQuota());
  useEffect(() => onQuota(setQuota), []);
  if (DEMO_MODE) return <p className="lookup-meter">0 of {HOUSEHOLD_LIMIT} lookups this month</p>;
  if (!hasPriceProvider() || !quota || quota.used == null) return null;
  return (
    <p className="lookup-meter">
      {quota.used} of {quota.total} lookups this month{quota.paused ? ' · paused for everyone' : ''}
    </p>
  );
}

// A see-through caret at the bottom center that floats in once a long page has been scrolled, and returns to the top.
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > Math.max(600, window.innerHeight * 1.2));
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!show) return null;
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <button type="button" className="to-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 15l7-7 7 7" /></svg>
    </button>
  );
}

// Five color looks at the bottom of every page. The pick is saved for this person only.
export function LookPicker() {
  const { look, setLook, showToast } = useApp();
  return (
    <section className="look-picker" aria-labelledby="look-h">
      <h2 id="look-h">Customize your Shopping List App look</h2>
      <div className="looks" role="radiogroup" aria-labelledby="look-h">
        {LOOKS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={look === l.id} className="look" onClick={() => { setLook(l.id); showToast(`Look changed to ${l.name}`); }}
            style={{ background: l.vars.cream, borderColor: look === l.id ? l.vars.bb : l.vars.line, color: l.vars['bb-ink'] }}>
            <span className="look-dots" aria-hidden="true">
              <i style={{ background: l.vars.bb }} /><i style={{ background: l.vars.gold }} /><i style={{ background: l.vars.card, borderColor: l.vars.line }} />
            </span>
            <span className="look-name">{l.name}</span>
            {look === l.id && <span className="look-on" style={{ color: l.vars.bb }}>In use</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
