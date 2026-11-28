import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { useApp } from '../AppContext.jsx';
import { fmtMoney, fmtMoney0, fmtDate, toInputDate, fromInputDate } from '../lib/format.js';
import { DAY } from '../lib/predict.js';
import { can } from '../lib/config.js';
import { DownloadIcon } from './Icons.jsx';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);
Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
Chart.defaults.font.size = 13;
// Chart colors follow the person's chosen look.
const cssVar = (name, fallback) => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const BB = 'var(--bb)';
const GOLD = 'var(--gold)';
const resolve = (c) => (c.startsWith('var(') ? cssVar(c.slice(4, -1), '#243b8f') : c);

function BarChart({ labels, data, color = BB, horizontal, label }) {
  const ref = useRef();
  const { look } = useApp();
  useEffect(() => {
    Chart.defaults.color = cssVar('--muted', '#4d5c96');
    const fill = resolve(color);
    const chart = new Chart(ref.current, {
      type: 'bar',
      data: { labels, datasets: [{ label, data, backgroundColor: fill, borderRadius: 6, maxBarThickness: 38 }] },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${fmtMoney(c.parsed[horizontal ? 'x' : 'y'])}` } } },
        scales: {
          [horizontal ? 'x' : 'y']: { beginAtZero: true, grid: { color: cssVar('--line-soft', '#efe3b4') }, ticks: { callback: (v) => fmtMoney0(v), maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
          [horizontal ? 'y' : 'x']: { grid: { display: false }, ticks: { autoSkip: !horizontal, maxRotation: 0 } },
        },
      },
    });
    return () => chart.destroy();
  }, [JSON.stringify(labels), JSON.stringify(data), color, horizontal, look]);
  return <canvas ref={ref} role="img" aria-label={label} />;
}

const RANGES = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['182', 'Last 6 months'], ['365', 'Last 12 months'], ['ytd', 'This year'], ['all', 'All time'], ['custom', 'Custom']];

const sumBy = (list, key) => {
  const m = new Map();
  for (const p of list) m.set(key(p), (m.get(key(p)) || 0) + (Number(p.total) || 0));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export default function InsightsView() {
  const { purchases, items, predictions, role } = useApp();
  const [range, setRange] = useState('90');
  const [from, setFrom] = useState(toInputDate(Date.now() - 90 * DAY));
  const [to, setTo] = useState(toInputDate());
  const [cat, setCat] = useState('');
  const [store, setStore] = useState('');
  const [minCost, setMinCost] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [minQty, setMinQty] = useState('');
  const [maxQty, setMaxQty] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'purchasedAt', dir: -1 });

  const categories = useMemo(() => [...new Set(purchases.map((p) => p.category).filter(Boolean))].sort(), [purchases]);
  const stores = useMemo(() => [...new Set(purchases.map((p) => p.store).filter(Boolean))].sort(), [purchases]);

  const [start, end] = useMemo(() => {
    const now = Date.now();
    if (range === 'custom') return [fromInputDate(from) - DAY / 2, fromInputDate(to) + DAY / 2];
    if (range === 'all') return [0, now + DAY];
    if (range === 'ytd') return [new Date(new Date().getFullYear(), 0, 1).getTime(), now + DAY];
    return [now - Number(range) * DAY, now + DAY];
  }, [range, from, to]);

  const filtered = useMemo(() => purchases.filter((p) => {
    if (p.purchasedAt < start || p.purchasedAt > end) return false;
    if (cat && p.category !== cat) return false;
    if (store && p.store !== store) return false;
    const t = Number(p.total) || 0;
    if (minCost !== '' && t < Number(minCost)) return false;
    if (maxCost !== '' && t > Number(maxCost)) return false;
    const qty = Number(p.qty) || 1;
    if (minQty !== '' && qty < Number(minQty)) return false;
    if (maxQty !== '' && qty > Number(maxQty)) return false;
    if (q && !`${p.name} ${p.store} ${p.category}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [purchases, start, end, cat, store, minCost, maxCost, minQty, maxQty, q]);

  const total = filtered.reduce((s, p) => s + (Number(p.total) || 0), 0);
  const trips = new Set(filtered.map((p) => `${new Date(p.purchasedAt).toDateString()}|${p.store}`)).size;
  const spanDays = Math.max(1, (Math.min(end, Date.now()) - Math.max(start, filtered.length ? Math.min(...filtered.map((p) => p.purchasedAt)) : start)) / DAY);

  // Next 30 days: every predicted purchase in the window, priced at the last price paid.
  const forecast = useMemo(() => {
    const now = Date.now();
    const horizon = now + 30 * DAY;
    let sum = 0;
    for (const it of items) {
      const p = predictions[it.id];
      if (!p || !p.nextDate || !p.intervalDays || it.lastPrice == null) continue;
      let t = Math.max(p.nextDate, now);
      while (t <= horizon) {
        sum += Number(it.lastPrice) * (Number(it.qty) || 1);
        t += p.intervalDays * DAY;
      }
    }
    return sum;
  }, [items, predictions]);

  const overTime = useMemo(() => {
    const weekly = (end - start) / DAY <= 100;
    const m = new Map();
    const keyOf = (ms) => {
      const d = new Date(ms);
      if (weekly) {
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
        return s.getTime();
      }
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    };
    for (const p of filtered) m.set(keyOf(p.purchasedAt), (m.get(keyOf(p.purchasedAt)) || 0) + (Number(p.total) || 0));
    // Newest first, so the latest week or month is the left-most bar.
    const keys = [...m.keys()].sort((a, b) => b - a);
    const current = keyOf(Date.now());
    return {
      labels: keys.map((k) => (k === current ? (weekly ? 'This week' : 'This month') : weekly ? fmtDate(k) : new Date(k).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }))),
      data: keys.map((k) => Math.round(m.get(k) * 100) / 100),
      title: weekly ? 'Spending by week' : 'Spending by month',
      note: weekly ? 'Newest week on the left. Each bar starts on a Sunday.' : 'Newest month on the left.',
    };
  }, [filtered, start, end]);

  const byCat = sumBy(filtered, (p) => p.category || 'Other').slice(0, 10);
  const byItem = sumBy(filtered, (p) => p.name).slice(0, 8);
  const byStore = sumBy(filtered, (p) => p.store || 'Unknown').slice(0, 8);

  const rows = useMemo(() => [...filtered].sort((a, b) => {
    const va = a[sort.key] ?? '';
    const vb = b[sort.key] ?? '';
    return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
  }), [filtered, sort]);

  function exportCsv() {
    const head = ['Date', 'Item', 'Category', 'Store', 'Quantity', 'Unit', 'Unit price', 'Total', 'Source', 'By'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head, ...rows.map((p) => [toInputDate(p.purchasedAt), p.name, p.category, p.store, p.qty, p.unit, p.unitPrice, p.total, p.source, p.purchasedByName])].map((r) => r.map(esc).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `purchases-${toInputDate()}.csv`;
    a.click();
  }

  const clear = () => { setCat(''); setStore(''); setMinCost(''); setMaxCost(''); setMinQty(''); setMaxQty(''); setQ(''); };
  const filtersOn = cat || store || minCost || maxCost || minQty || maxQty || q;
  const th = (key, label, num) => (
    <th className={num ? 'num' : ''} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))} aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key ? (sort.dir > 0 ? ' ▴' : ' ▾') : ''}
    </th>
  );

  if (!can(role, 'spend')) return <div className="card empty"><h2>Spending is visible to owners and editors</h2></div>;

  return (
    <>
      <div className="section-h" style={{ marginTop: 4 }}>
        <div><h1>Insights</h1><p className="small muted">Spending and buying patterns. Every chart follows the filters.</p></div>
        <button type="button" className="btn" onClick={exportCsv}><DownloadIcon width="20" height="20" /> CSV</button>
      </div>

      <div className="card">
        <div className="filters">
          <label className="field"><span>Dates</span>
            <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          {range === 'custom' && <>
            <label className="field"><span>From</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span>To</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </>}
          <label className="field"><span>Category</span>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="field"><span>Store</span>
            <select className="input" value={store} onChange={(e) => setStore(e.target.value)}><option value="">All stores</option>{stores.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="field"><span>Item search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Milk" /></label>
          <div className="field"><span className="small muted" style={{ display: 'block', marginBottom: 4 }}>Cost per purchase ($)</span>
            <div className="row" style={{ gap: 6 }}><input className="input" inputMode="decimal" aria-label="Minimum cost" placeholder="Min" value={minCost} onChange={(e) => setMinCost(e.target.value)} /><input className="input" inputMode="decimal" aria-label="Maximum cost" placeholder="Max" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} /></div>
          </div>
          <div className="field"><span className="small muted" style={{ display: 'block', marginBottom: 4 }}>Quantity</span>
            <div className="row" style={{ gap: 6 }}><input className="input" inputMode="decimal" aria-label="Minimum quantity" placeholder="Min" value={minQty} onChange={(e) => setMinQty(e.target.value)} /><input className="input" inputMode="decimal" aria-label="Maximum quantity" placeholder="Max" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} /></div>
          </div>
        </div>
        {filtersOn && <button type="button" className="btn ghost" style={{ marginTop: 8, paddingLeft: 0 }} onClick={clear}>Clear filters</button>}
      </div>

      <div className="kpis">
        <div className="kpi"><div className="v">{fmtMoney0(total)}</div><div className="l">Spent</div></div>
        <div className="kpi"><div className="v">{filtered.length}</div><div className="l">Purchases</div></div>
        <div className="kpi"><div className="v">{trips}</div><div className="l">Trips · {fmtMoney0(trips ? total / trips : 0)} each</div></div>
        <div className="kpi"><div className="v">{fmtMoney0((total / spanDays) * 30)}</div><div className="l">Per month, on average</div></div>
        <div className="kpi" style={{ borderColor: GOLD, background: 'var(--gold-soft)' }}><div className="v">{fmtMoney0(forecast)}</div><div className="l">Predicted, next 30 days</div></div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><h2>No purchases match</h2><p>Check items off your list or add a receipt, and the charts fill in.</p></div>
      ) : (
        <>
          <div className="charts">
            <div className="card"><h2 style={{ marginBottom: 2 }}>{overTime.title}</h2><p className="tiny muted" style={{ marginBottom: 8 }}>{overTime.note}</p><div className="chart-box"><BarChart labels={overTime.labels} data={overTime.data} label={overTime.title} /></div></div>
            <div className="card"><h2 style={{ marginBottom: 8 }}>By category</h2><div className="chart-box"><BarChart horizontal labels={byCat.map((x) => x[0])} data={byCat.map((x) => Math.round(x[1] * 100) / 100)} label="Spending by category" /></div></div>
            <div className="card"><h2 style={{ marginBottom: 8 }}>Top items</h2><div className="chart-box"><BarChart horizontal color={GOLD} labels={byItem.map((x) => x[0])} data={byItem.map((x) => Math.round(x[1] * 100) / 100)} label="Top items by spending" /></div></div>
            <div className="card"><h2 style={{ marginBottom: 8 }}>By store</h2><div className="chart-box"><BarChart labels={byStore.map((x) => x[0])} data={byStore.map((x) => Math.round(x[1] * 100) / 100)} label="Spending by store" /></div></div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2 style={{ marginBottom: 8 }}>Purchases <span className="small muted">({rows.length})</span></h2>
            <div className="table-wrap" style={{ maxHeight: 480 }}>
              <table className="data purchases-table">
                <thead><tr>{th('purchasedAt', 'Date')}{th('name', 'Item')}{th('category', 'Category')}{th('store', 'Store')}{th('qty', 'Qty', true)}{th('total', 'Cost', true)}</tr></thead>
                <tbody>
                  {rows.slice(0, 300).map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.purchasedAt, { withYear: true })}</td><td>{p.name}</td><td>{p.category}</td><td>{p.store}</td>
                      <td className="num">{p.qty}{p.unit ? ` ${p.unit}` : ''}</td><td className="num">{fmtMoney(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 300 && <p className="tiny muted" style={{ marginTop: 6 }}>Showing 300 of {rows.length}. Export CSV for the full list.</p>}
          </div>
        </>
      )}
    </>
  );
}
