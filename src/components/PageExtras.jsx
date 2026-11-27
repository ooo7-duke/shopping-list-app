import { useEffect, useState } from 'react';
import { currentQuota, onQuota, hasPriceProvider } from '../lib/prices.js';
import { DEMO_MODE } from '../lib/config.js';

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

// A round button that floats in once a long page has been scrolled, and returns to the top.
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
    </button>
  );
}
