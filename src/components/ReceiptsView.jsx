import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { compressImage, extractReceipt, isImageFile, toReadableImage } from '../lib/receipts.js';
import { decodeQr, parseQr, qrHost } from '../lib/qr.js';
import { bestMatch } from '../lib/match.js';
import { saveReceipt, deleteReceipt, deleteReceipts, isOnList } from '../data/actions.js';
import { useHold, usePick, PickHeader, PickBar, PickBox, ConfirmDelete, plural } from './Pick.jsx';
import { fmtMoney, fmtDate, toInputDate, fromInputDate } from '../lib/format.js';
import { DEMO_MODE } from '../lib/config.js';
import { aiErrorMessage } from '../lib/errors.js';
import { CameraIcon } from './Icons.jsx';
import { extractReceiptText } from '../lib/receipts.js';
import { fetchInbox, ackInbox, cachedRead, cacheRead, dropRead, keptIds, keepId, dropKept } from '../lib/emailReceipts.js';
import { planLines, alreadySaved, looksLikeReceipt, INBOX_ADDRESS } from '../lib/inbox.js';
import { HOUSEHOLD_CATEGORIES, householdCategories, isHouseholdList, foldCategory } from '../lib/categories.js';
import { emailTrip, notTravelIds } from '../lib/expenses.js';
import FitText from './FitText.jsx';
import useStackPrice from './useStackPrice.js';

export default function ReceiptsView() {
  const { ctx, items, receipts, purchases, backend, showToast } = useApp();
  // Press and hold a receipt to pick several, then delete them together, with Undo.
  const rPick = usePick(receipts.map((r) => r.id));
  const [delAsk, setDelAsk] = useState(false);
  async function deletePicked() {
    const list = receipts.filter((r) => rPick.has(r.id));
    setDelAsk(false);
    if (!list.length) return;
    try {
      const undo = await deleteReceipts(ctx, list, purchases);
      rPick.stop();
      showToast(`Deleted ${plural(list.length, 'receipt')} and ${list.length === 1 ? 'its' : 'their'} purchases`, undo, 12000);
    } catch (e) {
      showToast("Couldn't delete those receipts. Check your connection and try again.");
    }
  }
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [viewing, setViewing] = useState(null);
  const cameraRef = useRef();
  const pickRef = useRef();

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
    if (!isImageFile(file)) {
      showToast('Use a photo or screenshot of the receipt (JPG, PNG or HEIC).');
      return;
    }
    try {
      setBusy('Opening the photo…');
      file = await toReadableImage(file);
    } catch (e) {
      console.error(e);
      showToast(e?.message || "Couldn't open that photo. Try a JPG or PNG.");
      setBusy('');
      clearInputs();
      return;
    }
    setBusy('Looking for a QR code…');
    const qr = parseQr(await decodeQr(file));
    try {
      setBusy('Shrinking the photo…');
      const image = await compressImage(file);
      setBusy('Reading the receipt…');
      let res = null;
      let readError = null;
      try {
        res = await extractReceipt(image, items.map((i) => i.name), backend.getApp());
      } catch (e) {
        if (!qr) throw e;
        readError = e; // the QR code still gives us something to save
      }
      const lines = (res?.items || []).map((ln) => {
        const m = bestMatch(ln, items);
        return { ...ln, itemId: m.item?.id || '', newName: ln.name, skip: false };
      });
      setReview({
        store: res?.store || qr?.store || '',
        date: res?.date || qr?.date || Date.now(),
        total: res?.total ?? qr?.total ?? null,
        tax: res?.tax ?? null,
        image, lines, qr,
      });
      if (readError) showToast("Couldn't read the printed lines, but the QR code was read.");
    } catch (e) {
      console.error(e);
      showToast(aiErrorMessage(e, 'Receipt reading'));
    } finally {
      setBusy('');
      clearInputs();
    }
  }

  function clearInputs() {
    if (cameraRef.current) cameraRef.current.value = '';
    if (pickRef.current) pickRef.current.value = '';
  }

  return (
    <>
      <div className="section-h" style={{ marginTop: 4 }}>
        <div>
          <h1>Receipts</h1>
          <p className="small muted">Prices from receipts show next to items on your list and feed the spending charts.</p>
        </div>
      </div>

      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]); }}
        aria-busy={!!busy}
      >
        <CameraIcon />
        <strong style={{ color: 'var(--bb)', fontSize: '1.1rem' }}>{busy || 'Add a receipt'}</strong>
        <span className="small muted">{busy ? 'This takes a few seconds.' : 'Take a photo, choose one you already have, drop a file here, or paste a screenshot. A QR code on the receipt is read too.'}</span>
        <div className="drop-actions">
          {/* Two inputs: "capture" opens the camera straight away on phones but hides the photo library, so choosing a saved photo needs its own input without it. */}
          <label className={`btn primary${busy ? ' is-disabled' : ''}`}>
            Take photo
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} disabled={!!busy} />
          </label>
          <label className={`btn${busy ? ' is-disabled' : ''}`}>
            Choose photo
            <input ref={pickRef} type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} disabled={!!busy} />
          </label>
        </div>
      </div>
      {DEMO_MODE && <p className="tiny muted" style={{ marginTop: 6 }}>Demo mode returns a sample Giant receipt so you can try the review step.</p>}

      <EmailedReceipts />

      <div className="section-h">
        <h2>Past receipts</h2>
        {rPick.on ? <PickHeader pick={rPick} /> : <span className="small muted">{receipts.length}{receipts.length > 1 ? ' · press and hold to select' : ''}</span>}
      </div>
      {receipts.length === 0 ? (
        <div className="card empty"><p>No receipts yet. Older receipts work too: the purchase date comes from the receipt.</p></div>
      ) : (
        <div className="list">
          {receipts.map((r) => (
            <ReceiptRow key={r.id} r={r} picking={rPick.on} picked={rPick.has(r.id)}
              onHold={() => rPick.start(r.id)} onOpen={() => (rPick.on ? rPick.toggle(r.id) : setViewing(r))} onToggle={() => rPick.toggle(r.id)} />
          ))}
        </div>
      )}
      <PickBar pick={rPick} label="Selected receipts" onDelete={() => setDelAsk(true)} />
      {delAsk && rPick.count > 0 && (
        <ConfirmDelete title={`Delete ${plural(rPick.count, 'receipt')}?`} count={rPick.count} onCancel={() => setDelAsk(false)} onConfirm={deletePicked}>
          <p>This deletes {rPick.count === 1 ? 'the receipt' : `these ${rPick.count} receipts`}, {rPick.count === 1 ? 'its photo and the purchases it logged' : 'their photos and the purchases they logged'}, for everyone who shares the list.</p>
          <p className="small muted">Items stay on or off your list as they are now. You can tap Undo for a few seconds after.</p>
        </ConfirmDelete>
      )}

      <Inventory purchases={purchases} />

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
      await saveReceipt(ctx, { ...head, tax: data.tax ?? null, image: data.image, qrText: data.qr?.raw || '', qrUrl: data.qr?.url || '', source: data.source, emailId: data.emailId, orderId: data.orderId }, lines);
      onSaved(kept.length);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Check the receipt" onClose={onClose} wide>
      <p className="small muted" style={{ marginBottom: 12 }}>{data.source === 'email'
        ? 'From an emailed receipt. Lines marked "Best guess" need your OK before they count as bought. Fix any wrong matches, skip lines you don\'t want tracked, then save.'
        : "Each line is matched to an item on your list. Fix any wrong matches, skip lines you don't want tracked, then save."}</p>
      <div className="grid2">
        <label className="field"><span>Store</span><input className="input" value={head.store} onChange={(e) => setHead({ ...head, store: e.target.value })} /></label>
        <label className="field"><span>Date on receipt</span><input type="date" className="input" value={toInputDate(head.date)} max={toInputDate()} onChange={(e) => setHead({ ...head, date: fromInputDate(e.target.value) })} /></label>
        <label className="field"><span>Receipt total</span><input className="input" inputMode="decimal" value={head.total ?? ''} onChange={(e) => setHead({ ...head, total: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      </div>

      {data.qr && <QrNote qr={data.qr} />}

      <div className="rhead" aria-hidden="true"><span>Matches list item</span><span>Qty</span><span>Line total $</span></div>
      <div>
        {lines.map((ln, i) => (
          <div key={i} className={`rline${ln.skip ? ' skip' : ''}`}>
            <div className="grow">
              <div className="raw">{ln.rawText}</div>
              <div style={{ fontWeight: 600 }}>{ln.itemId ? items.find((x) => x.id === ln.itemId)?.name : ln.newName}</div>
              {ln.weak && <div className="guess-note">Best guess. Is this {items.find((x) => x.id === ln.itemId)?.name || 'the right item'}?</div>}
            </div>
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={!ln.skip} onChange={(e) => set(i, { skip: !e.target.checked })} style={{ width: 22, height: 22 }} />
              Track
            </label>
            {!ln.skip && (
              <div className="controls">
                <select className="input" value={ln.itemId} onChange={(e) => set(i, { itemId: e.target.value })} aria-label={`Match for ${ln.rawText}`}>
                  <option value="">Add as a new item</option>
                  {sorted.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
                <label className="ctl"><span className="ctl-label">Qty</span><input className="input" inputMode="decimal" aria-label="Quantity" value={ln.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></label>
                <label className="ctl"><span className="ctl-label">Line total $</span><input className="input" inputMode="decimal" aria-label="Line total" value={ln.lineTotal ?? ''} onChange={(e) => set(i, { lineTotal: e.target.value === '' ? null : Number(e.target.value), unitPrice: null })} /></label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
        <span className="small">Tracked lines: <strong>{fmtMoney(sum)}</strong>{head.total != null && Math.abs(sum - head.total) > 0.05 ? <span className="muted"> (receipt says {fmtMoney(head.total)}, tax and skipped lines account for the gap)</span> : null}</span>
      </div>
      <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={save} disabled={saving || (!kept.length && !data.qr && !(data.source === 'email' && head.total != null))}>{saving ? 'Saving…' : kept.length ? `Save ${kept.length} purchase${kept.length === 1 ? '' : 's'}` : 'Save receipt'}</button>
    </Sheet>
  );
}

function ReceiptDetail({ receipt, onClose, onDelete }) {
  const { backend, ctx, purchases } = useApp();
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const lines = purchases.filter((p) => p.receiptId === receipt.id);
  useEffect(() => {
    if (receipt.hasImage) backend.getDocData(ctx.accountId, 'receiptImages', receipt.id).then((d) => setImg(d?.dataUrl || null));
  }, [receipt.id]);
  // The lines come first and use the full width, so names and prices are never covered.
  // The photo sits below as a small picture that opens full screen.
  return (
    <Sheet title={`${receipt.store || 'Receipt'} · ${fmtDate(receipt.date, { withYear: true })}`} onClose={onClose} wide>
      <table className="data receipt-lines">
        <tbody>
          {lines.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{p.qty}</td><td className="num">{fmtMoney(p.total)}</td></tr>)}
          <tr><td><strong>Total</strong></td><td /><td className="num"><strong>{fmtMoney(receipt.total)}</strong></td></tr>
        </tbody>
      </table>
      {receipt.qrUrl && <p className="small" style={{ marginTop: 10 }}>QR code on the receipt: <a href={receipt.qrUrl} target="_blank" rel="noopener noreferrer">open on {qrHost(receipt.qrUrl)} ↗</a></p>}
      {img && (
        <button type="button" className="receipt-thumb" onClick={() => setZoom(true)} aria-label={`See the full photo of the receipt from ${receipt.store || 'the store'}`}>
          <img src={img} alt="" />
          <span className="small">Tap to see the full receipt</span>
        </button>
      )}
      {zoom && img && createPortal(
        <div className="photo-view" role="dialog" aria-label={`Receipt from ${receipt.store || 'the store'}`} onClick={() => setZoom(false)}>
          <img src={img} alt={`Receipt from ${receipt.store || 'the store'}`} />
          <div className="photo-cap"><span className="small">Tap anywhere to close</span></div>
        </div>,
        document.body,
      )}
      <button type="button" className="btn danger block" style={{ marginTop: 14 }} onClick={() => (confirm ? onDelete() : setConfirm(true))}>{confirm ? 'Tap again to delete the receipt and its purchases' : 'Delete receipt'}</button>
    </Sheet>
  );
}

function QrNote({ qr }) {
  const found = [qr.store && 'store', qr.date && 'date', qr.total != null && 'total'].filter(Boolean);
  return (
    <div className="card" style={{ margin: '10px 0', padding: 10 }}>
      <div className="small"><strong>QR code found.</strong>{' '}
        {found.length ? `It gave the ${found.join(', ')} above.` : 'It holds no store, date or total, so those come from the printed receipt.'}
      </div>
      {qr.url ? (
        <div className="small" style={{ marginTop: 4 }}>It links to <a href={qr.url} target="_blank" rel="noopener noreferrer">{qrHost(qr.url)} ↗</a>. The link is saved with the receipt.</div>
      ) : (
        <div className="tiny muted ellipsis" style={{ marginTop: 4 }}>{qr.raw}</div>
      )}
    </div>
  );
}

// Receipts forwarded to the app's Gmail inbox. Strong matches are saved and checked off on
// their own; an email with a weaker guess waits here for a person to confirm it.
function EmailedReceipts() {
  const { ctx, items, receipts, backend, showToast, expenseTrips, expenses, expenseReady } = useApp();
  const latest = useRef({});
  latest.current = { ctx, items, receipts, expenseTrips, expenses };
  const [inbox, setInbox] = useState({ loading: true, items: [] });
  const [state, setState] = useState({});
  const [done, setDone] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [review, setReview] = useState(null);
  const ran = useRef(false);
  const account = ctx?.account;
  const cats = isHouseholdList(account) ? householdCategories(account?.categories) : account?.categories || HOUSEHOLD_CATEGORIES;
  const setOne = (id, v) => setState((s) => ({ ...s, [id]: v }));

  useEffect(() => {
    // Waits for the trip folders, so a hotel or flight receipt goes to the Expense Report page.
    if (ran.current || !ctx?.accountId || !expenseReady) return;
    ran.current = true;
    run();
  }, [ctx?.accountId, expenseReady]);

  async function run() {
    let data;
    try { data = await fetchInbox(); } catch (e) { setInbox({ loading: false, error: e.message, items: [] }); return; }
    setInbox({ loading: false, ...data });
    const out = { found: 0, travel: 0 };
    const notTravel = notTravelIds();
    const kept = keptIds();
    const aside = [];
    for (const m of data.items || []) {
      const keep = kept.includes(m.id);
      // Mail that isn't a receipt waits in a skipped list, out of the way, where the person can
      // pull one back. Words alone rule most of it out without an AI read.
      if (!keep && !looksLikeReceipt(m)) { aside.push({ m, by: 'words' }); continue; }
      if (!keep && !notTravel.includes(m.id) && emailTrip(m, latest.current.expenseTrips, latest.current.expenses)) { out.travel++; continue; }
      const r = await readOne(m, keep);
      if (r === 'other') aside.push({ m, by: 'ai' });
      else if (r === 'found') out.found++;
    }
    setSkipped(aside);
    if (out.found || out.travel || aside.length) setDone(out);
  }

  // Reads one email and puts it in the list to include or exclude. A pulled-back email stays in
  // the list even when the AI reader says it isn't a receipt.
  async function readOne(m, keep) {
    setOne(m.id, { status: 'reading', m });
    try {
      let res = cachedRead(m.id);
      if (!res) {
        res = await extractReceiptText(m, latest.current.items.map((i) => i.name), backend.getApp(), cats);
        cacheRead(m.id, res);
      }
      if (!keep && !res.isReceipt) { setOne(m.id, { status: 'skipped', m }); return 'other'; }
      const plan = planLines(res, latest.current.items, cats);
      // Nothing from email is saved on its own. Every receipt waits here for the person to
      // include or exclude it, with a note when it looks already saved.
      const dup = res.isReceipt && alreadySaved(latest.current.receipts, { emailId: m.id, orderId: res.orderId, store: res.store });
      setOne(m.id, { status: 'review', why: dup ? 'dup' : '', pulled: keep, m, res, plan });
      return 'found';
    } catch (e) {
      console.error(e);
      setOne(m.id, { status: 'error', m, error: aiErrorMessage(e, 'Receipt reading') });
      return 'error';
    }
  }

  async function pullBack(m) {
    keepId(m.id);
    setSkipped((list) => list.filter((x) => x.m.id !== m.id));
    await readOne(m, true);
  }
  async function clearSkipped() {
    const list = skipped;
    setSkipped([]);
    for (const { m } of list) { dropRead(m.id); await ackInbox(m.id).catch(() => {}); }
  }

  function openReview(id) {
    const { m, res, plan } = state[id];
    setReview({ id, data: { ...receiptOf(res, m), image: null, qr: null, lines: plan.lines } });
  }
  async function finish(id, saved) {
    await ackInbox(id);
    dropRead(id);
    dropKept(id);
    setOne(id, { status: saved ? 'saved' : 'dismissed', m: state[id]?.m });
    setReview(null);
  }

  const waiting = Object.entries(state).filter(([, v]) => ['review', 'reading', 'error'].includes(v.status));
  const nothingYet = !inbox.loading && !waiting.length && !done?.found && !done?.travel;
  const sender = (from) => String(from || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim() || String(from || '');

  return (
    <>
      <div className="section-h"><h2>Emailed receipts</h2>{waiting.length > 0 && <span className="small muted">{waiting.length} waiting</span>}</div>
      <div className="card email-card">
        {inbox.loading && <p className="small">Checking for emailed receipts…</p>}
        {inbox.error && <p className="small">{inbox.error}</p>}
        {done && (done.found || done.travel) ? (
          <p className="small" style={{ marginBottom: waiting.length ? 10 : 0 }}>
            {[
              done.found ? `Found ${plural(done.found, 'email')}. Include the ones you want on the record and exclude the rest.` : '',
              done.travel ? `${done.travel} look${done.travel === 1 ? 's' : ''} like travel and ${done.travel === 1 ? 'is' : 'are'} waiting on the Expense Report page.` : '',
            ].filter(Boolean).join(' ')}
          </p>
        ) : null}
        {waiting.map(([id, v]) => (
          <div key={id} className="email-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <FitText className="name" lines={2}>{v.res?.store || storeFromSubject(v.m?.subject) || v.m?.subject || 'Emailed receipt'}</FitText>
              <div className="meta">
                {v.status === 'reading' ? 'Reading…'
                  : v.status === 'error' ? `Couldn't read it. ${v.error}`
                  : v.why === 'dup' ? 'Looks already saved'
                  : v.pulled && !v.res?.isReceipt ? `Pulled back${v.plan.lines.length ? ` · ${plural(v.plan.lines.length, 'item')}` : ' · no items found'}`
                  : `${plural(v.plan.lines.length, 'item')}${v.plan.weak ? ` · ${v.plan.weak} best guess${v.plan.weak === 1 ? '' : 'es'} to check` : ''}`}
                {v.m?.date ? ` · emailed\u00a0${fmtDate(v.m.date).replace(/ /g, '\u00a0')}` : ''}
              </div>
            </div>
            {['review', 'error'].includes(v.status) && (
              <div className="email-acts">
                {v.status === 'review' && <button type="button" className={`btn${v.why ? '' : ' primary'}`} onClick={() => openReview(id)}>Include</button>}
                <button type="button" className="btn" onClick={() => finish(id, false)}>Exclude</button>
              </div>
            )}
          </div>
        ))}
        {nothingYet && <p className="small">No emailed receipts waiting.</p>}
        {skipped.length > 0 && (
          <details className="email-how email-skipped">
            <summary>Skipped {plural(skipped.length, 'email')} that {skipped.length === 1 ? "isn't a receipt" : "aren't receipts"}</summary>
            <p className="tiny muted">Tap Pull back on any that is a receipt.</p>
            {skipped.map(({ m, by }) => (
              <div key={m.id} className="email-row">
                <div className="grow" style={{ minWidth: 0 }}>
                  <FitText className="name" lines={2}>{m.subject || 'No subject'}</FitText>
                  <div className="meta">{sender(m.from)}{m.date ? ` · emailed\u00a0${fmtDate(m.date).replace(/ /g, '\u00a0')}` : ''}{by === 'ai' ? ' · read, no receipt found' : ''}</div>
                </div>
                <div className="email-acts">
                  <button type="button" className="btn" onClick={() => pullBack(m)}>Pull back</button>
                </div>
              </div>
            ))}
            <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={clearSkipped}>Clear skipped emails</button>
          </details>
        )}
        <details className="email-how">
          <summary>How to send receipts here</summary>
          <ol className="small">
            <li>Forward a receipt or order email to <strong>{INBOX_ADDRESS}</strong>{inbox.email ? <> from <strong>{inbox.email}</strong>, the address you sign in with</> : ' from the address you sign in with'}.</li>
            <li>To skip forwarding by hand, set up a Gmail filter that forwards order emails there.</li>
            <li>Within about 15 minutes, open this tab. Each email it finds waits here: tap Include to check it and add it to the record, or Exclude to drop it. Nothing is added without you.</li>
          </ol>
          <p className="tiny muted">Paper receipts from the store don't come by email, so snap those above.</p>
          {!inbox.loading && inbox.configured === false && <p className="tiny muted">The inbox isn't switched on yet.</p>}
        </details>
      </div>
      {review && (
        <ReceiptReview
          data={review.data}
          onClose={() => setReview(null)}
          onSaved={(n) => { finish(review.id, true); showToast(`Saved ${n} purchase${n === 1 ? '' : 's'} from the email`); }}
        />
      )}
    </>
  );
}

function receiptOf(res, m) {
  return { store: res.store || storeFromSubject(m.subject), date: res.date || m.date || Date.now(), total: res.total ?? null, tax: res.tax ?? null, source: 'email', emailId: m.id, orderId: res.orderId || '' };
}
function storeFromSubject(subject) {
  const m = String(subject || '').match(/\b(amazon|target|walmart|costco|giant|instacart|kroger|safeway|aldi|best buy|home depot|lowe'?s|cvs|walgreens)\b/i);
  return m ? m[1].replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}
function listNames(names) {
  const u = [...new Set(names)];
  return u.length <= 2 ? u.join(' and ') : `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}

// What the household has bought in the last 90 days, by category, newest first in each.
function Inventory({ purchases }) {
  const since = Date.now() - 90 * 864e5;
  const latest = new Map();
  for (const p of purchases) {
    if ((p.purchasedAt || 0) < since) continue;
    const key = p.itemId || p.name;
    const prev = latest.get(key);
    if (!prev || p.purchasedAt > prev.purchasedAt) latest.set(key, p);
  }
  const groups = {};
  for (const p of latest.values()) (groups[foldCategory(p.category || 'Other')] ||= []).push(p);
  const order = [...HOUSEHOLD_CATEGORIES, ...Object.keys(groups).filter((c) => !HOUSEHOLD_CATEGORIES.includes(c))].filter((c) => groups[c]);
  if (!order.length) return null;
  return (
    <>
      <div className="section-h"><h2>What you've bought</h2><span className="small muted">last 90 days</span></div>
      <div className="list">
        {order.map((c) => (
          <details key={c} className="inv-group">
            <summary><span className="name">{c}</span><span className="small muted">{groups[c].length} item{groups[c].length === 1 ? '' : 's'}</span></summary>
            <ul>
              {groups[c].sort((a, b) => b.purchasedAt - a.purchasedAt).map((p) => (
                <li key={p.id}><span>{p.name}</span><span className="small muted">{fmtDate(p.purchasedAt)}{p.store ? ` · ${p.store}` : ''}</span></li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </>
  );
}

function ReceiptRow({ r, picking, picked, onHold, onOpen, onToggle }) {
  const hold = useHold(onHold);
  const rowRef = useStackPrice();
  return (
    <div ref={rowRef} className={`item holdable${picked ? ' selected' : ''}`} onClick={onOpen} {...hold} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); else if (e.key === ' ' && picking) { e.preventDefault(); onToggle(); } }}
      aria-label={`${r.store || 'Receipt'}${picked ? ', selected' : ''}`}>
      {picking && <PickBox on={picked} name={r.store || 'this receipt'} onToggle={onToggle} />}
      <div className="grow" style={{ minWidth: 0 }}>
        <FitText className="name" lines={2}>{r.store || 'Receipt'}</FitText>
        <FitText className="meta-line">{fmtDate(r.date, { withYear: true })} · {plural(r.lineCount, 'item')} · {r.matched} matched to your list · {r.source === 'email' ? 'emailed' : r.uploadedByName}</FitText>
      </div>
      <div className="price">{fmtMoney(r.total)}</div>
    </div>
  );
}
