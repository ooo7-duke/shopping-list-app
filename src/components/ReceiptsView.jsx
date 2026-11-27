import { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { compressImage, extractReceipt } from '../lib/receipts.js';
import { bestMatch } from '../lib/match.js';
import { saveReceipt, deleteReceipt } from '../data/actions.js';
import { fmtMoney, fmtDate, toInputDate, fromInputDate } from '../lib/format.js';
import { DEMO_MODE } from '../lib/config.js';
import { CameraIcon } from './Icons.jsx';

export default function ReceiptsView() {
  const { ctx, items, receipts, purchases, backend, showToast } = useApp();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [viewing, setViewing] = useState(null);
  const fileRef = useRef();

  // Paste a screenshot of an emailed or online receipt straight onto the page.
  useEffect(() => {
    const onPaste = (e) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); handle(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  async function handle(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Use a photo or screenshot of the receipt (JPG, PNG or HEIC).');
      return;
    }
    try {
      setBusy('Shrinking the photo…');
      const image = await compressImage(file);
      setBusy('Reading the receipt…');
      const res = await extractReceipt(image, items.map((i) => i.name), backend.getApp());
      const lines = res.items.map((ln) => {
        const m = bestMatch(ln, items);
        return { ...ln, itemId: m.item?.id || '', newName: ln.name, skip: false };
      });
      setReview({ store: res.store, date: res.date || Date.now(), total: res.total, tax: res.tax, image, lines });
    } catch (e) {
      console.error(e);
      showToast(e?.message?.includes('App Check') ? 'Receipt reading is blocked by App Check. See the setup guide.' : `Couldn't read that receipt. ${e?.message || 'Try a clearer photo.'}`);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <div className="section-h" style={{ marginTop: 4 }}>
        <div>
          <h1>Receipts</h1>
          <p className="small muted">Prices from receipts show next to items on your list and feed the spending charts.</p>
        </div>
      </div>

      <label
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]); }}
        aria-busy={!!busy}
      >
        <CameraIcon />
        <strong style={{ color: 'var(--bb)', fontSize: '1.1rem' }}>{busy || 'Snap or upload a receipt'}</strong>
        <span className="small muted">{busy ? 'This takes a few seconds.' : 'Take a photo, pick one from your library, drop a file here, or paste a screenshot.'}</span>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} disabled={!!busy} />
      </label>
      {DEMO_MODE && <p className="tiny muted" style={{ marginTop: 6 }}>Demo mode returns a sample Giant receipt so you can try the review step.</p>}

      <div className="section-h"><h2>Past receipts</h2><span className="small muted">{receipts.length}</span></div>
      {receipts.length === 0 ? (
        <div className="card empty"><p>No receipts yet. Older receipts work too: the purchase date comes from the receipt.</p></div>
      ) : (
        <div className="list">
          {receipts.map((r) => (
            <div key={r.id} className="item" onClick={() => setViewing(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setViewing(r)}>
              <div className="grow">
                <div className="name">{r.store || 'Receipt'}</div>
                <div className="meta">{fmtDate(r.date, { withYear: true })} · {r.lineCount} items · {r.matched} matched to your list · {r.uploadedByName}</div>
              </div>
              <div className="price">{fmtMoney(r.total)}</div>
            </div>
          ))}
        </div>
      )}

      {review && <ReceiptReview data={review} onClose={() => setReview(null)} onSaved={(n) => { setReview(null); showToast(`Saved ${n} purchase${n === 1 ? '' : 's'} from the receipt`); }} />}
      {viewing && <ReceiptDetail receipt={viewing} onClose={() => setViewing(null)} onDelete={async () => { await deleteReceipt(ctx, viewing, purchases); setViewing(null); showToast('Receipt and its purchases deleted'); }} />}
    </>
  );
}

function ReceiptReview({ data, onClose, onSaved }) {
  const { ctx, items } = useApp();
  const [head, setHead] = useState({ store: data.store, date: data.date, total: data.total });
  const [lines, setLines] = useState(data.lines);
  const [saving, setSaving] = useState(false);
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const set = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const kept = lines.filter((l) => !l.skip);
  const sum = kept.reduce((s, l) => s + (Number(l.lineTotal) || (Number(l.unitPrice) || 0) * (Number(l.quantity) || 1)), 0);

  async function save() {
    setSaving(true);
    try {
      await saveReceipt(ctx, { ...head, image: data.image }, lines);
      onSaved(kept.length);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Check the receipt" onClose={onClose} wide>
      <p className="small muted" style={{ marginBottom: 12 }}>Each line is matched to an item on your list. Fix any wrong matches, skip lines you don't want tracked, then save.</p>
      <div className="grid2">
        <label className="field"><span>Store</span><input className="input" value={head.store} onChange={(e) => setHead({ ...head, store: e.target.value })} /></label>
        <label className="field"><span>Date on receipt</span><input type="date" className="input" value={toInputDate(head.date)} max={toInputDate()} onChange={(e) => setHead({ ...head, date: fromInputDate(e.target.value) })} /></label>
        <label className="field"><span>Receipt total</span><input className="input" inputMode="decimal" value={head.total ?? ''} onChange={(e) => setHead({ ...head, total: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      </div>

      <div className="rhead" aria-hidden="true"><span>Matches list item</span><span>Qty</span><span>Line total $</span></div>
      <div>
        {lines.map((ln, i) => (
          <div key={i} className={`rline${ln.skip ? ' skip' : ''}`}>
            <div className="grow">
              <div className="raw">{ln.rawText}</div>
              <div style={{ fontWeight: 600 }}>{ln.itemId ? items.find((x) => x.id === ln.itemId)?.name : ln.newName}</div>
            </div>
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={!ln.skip} onChange={(e) => set(i, { skip: !e.target.checked })} style={{ width: 22, height: 22 }} />
              Track
            </label>
            {!ln.skip && (
              <div className="controls">
                <select className="input" value={ln.itemId} onChange={(e) => set(i, { itemId: e.target.value })} aria-label={`Match for ${ln.rawText}`}>
                  <option value="">New item: {ln.newName}</option>
                  {sorted.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
                <input className="input" inputMode="decimal" aria-label="Quantity" value={ln.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
                <input className="input" inputMode="decimal" aria-label="Line total" value={ln.lineTotal ?? ''} onChange={(e) => set(i, { lineTotal: e.target.value === '' ? null : Number(e.target.value), unitPrice: null })} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
        <span className="small">Tracked lines: <strong>{fmtMoney(sum)}</strong>{head.total != null && Math.abs(sum - head.total) > 0.05 ? <span className="muted"> (receipt says {fmtMoney(head.total)}, tax and skipped lines account for the gap)</span> : null}</span>
      </div>
      <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={save} disabled={saving || !kept.length}>{saving ? 'Saving…' : `Save ${kept.length} purchase${kept.length === 1 ? '' : 's'}`}</button>
    </Sheet>
  );
}

function ReceiptDetail({ receipt, onClose, onDelete }) {
  const { backend, ctx, purchases } = useApp();
  const [img, setImg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const lines = purchases.filter((p) => p.receiptId === receipt.id);
  useEffect(() => {
    if (receipt.hasImage) backend.getDocData(ctx.accountId, 'receiptImages', receipt.id).then((d) => setImg(d?.dataUrl || null));
  }, [receipt.id]);
  return (
    <Sheet title={`${receipt.store || 'Receipt'} · ${fmtDate(receipt.date, { withYear: true })}`} onClose={onClose} wide>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <table className="data">
          <tbody>
            {lines.map((p) => <tr key={p.id}><td className="ellipsis" style={{ maxWidth: 220 }}>{p.name}</td><td className="num">{p.qty}</td><td className="num">{fmtMoney(p.total)}</td></tr>)}
            <tr><td><strong>Total</strong></td><td /><td className="num"><strong>{fmtMoney(receipt.total)}</strong></td></tr>
          </tbody>
        </table>
        {img && <img src={img} alt={`Receipt from ${receipt.store}`} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />}
      </div>
      <button type="button" className="btn danger block" style={{ marginTop: 14 }} onClick={() => (confirm ? onDelete() : setConfirm(true))}>{confirm ? 'Tap again to delete the receipt and its purchases' : 'Delete receipt'}</button>
    </Sheet>
  );
}
