import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { CameraIcon, PlusIcon, DownloadIcon, TrashIcon } from './Icons.jsx';
import { compressImage, isImageFile, toReadableImage } from '../lib/receipts.js';
import {
  EXPENSE_CATEGORIES, categoryLabel, isMeal, tripDays, perDiemDays, businessAmount, expenseFlags, tripTotals,
  sortExpenses, dayKey, fromDayKey, extractExpense, extractExpenseText, emailTrip, notTravelIds, markNotTravel,
  GSA_MIE, hasReceipt, tripPhotos, autoCaption, expenseWorkbook, expensesCSV,
  PAID_WITH, paidWithId, paidWithLabel,
} from '../lib/expenses.js';
import { xlsxBytes } from '../lib/xlsx.js';
import { buildReportPdf } from '../lib/reportPdf.js';
import { fetchInbox, ackInbox } from '../lib/emailReceipts.js';
import {
  saveExpenseTrip, updateExpenseTrip, deleteExpenseTrips, saveExpense, deleteExpense, deleteExpenses, getExpenseImage, setPhotoCaption,
} from '../data/actions.js';
import { fmtMoney, fmtDate, toInputDate, fromInputDate } from '../lib/format.js';
import { aiErrorMessage, saveErrorMessage } from '../lib/errors.js';
import { useHold, usePick, PickHeader, PickBar, PickBox, ConfirmDelete, plural } from './Pick.jsx';
import { DEMO_MODE } from '../lib/config.js';
import FitText, { FitTable } from './FitText.jsx';

const OPEN_KEY = 'sla-open-trip';
// The longest trip name you can type. At this length a name still fits in two lines of its folder
// on a 360px phone with large text, without splitting a word. Older, longer names are kept as
// they are and shortened with "…" on screen; the limit applies when a name is edited.
export const TRIP_NAME_MAX = 40;
export const MERCHANT_MAX = 40;
const dayName = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function fmtRange(a, b) {
  if (!a || !b) return '';
  const A = new Date(a); const B = new Date(b);
  const mo = (d) => d.toLocaleDateString('en-US', { month: 'short' });
  if (A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth()) {
    return A.getDate() === B.getDate() ? fmtDate(a, { withYear: true }) : `${mo(A)} ${A.getDate()} to ${B.getDate()}, ${B.getFullYear()}`;
  }
  if (A.getFullYear() === B.getFullYear()) return `${mo(A)} ${A.getDate()} to ${mo(B)} ${B.getDate()}, ${B.getFullYear()}`;
  return `${fmtDate(a, { withYear: true })} to ${fmtDate(b, { withYear: true })}`;
}

export default function ExpenseView() {
  const { ctx, expenseTrips, expenses, expenseError, showToast } = useApp();
  const [openId, setOpenId] = useState(() => { try { return sessionStorage.getItem(OPEN_KEY); } catch { return null; } });
  const [tripForm, setTripForm] = useState(null);
  const open = expenseTrips.find((t) => t.id === openId);
  const go = (id) => {
    setOpenId(id);
    try { if (id) sessionStorage.setItem(OPEN_KEY, id); else sessionStorage.removeItem(OPEN_KEY); } catch { /* storage blocked */ }
    window.scrollTo(0, 0);
  };

  const sorted = useMemo(() => {
    const now = Date.now();
    const current = (t) => t.status !== 'submitted' && t.endDate >= now - 14 * 864e5;
    return [...expenseTrips].sort((a, b) => (current(b) - current(a)) || (current(a) ? a.startDate - b.startDate : b.startDate - a.startDate));
  }, [expenseTrips]);
  // Press and hold a folder to pick several, then delete them with every expense in them, with Undo.
  const tPick = usePick(open ? [] : sorted.map((t) => t.id));
  const [delAsk, setDelAsk] = useState(false);
  const [delTrip, setDelTrip] = useState(null);
  const pickedTrips = sorted.filter((t) => tPick.has(t.id));
  const pickedCount = expenses.filter((e) => tPick.has(e.tripId)).length;
  async function deletePicked() {
    const list = pickedTrips;
    setDelAsk(false);
    if (!list.length) return;
    try {
      const undo = await deleteExpenseTrips(ctx, list, expenses);
      tPick.stop();
      showToast(`Deleted ${plural(list.length, 'trip folder')}`, undo, 12000);
    } catch (e) {
      showToast(saveErrorMessage(e, 'delete those folders'));
    }
  }
  // The trash can on one folder asks first, since the folder's expenses and photos go with it.
  async function deleteOneTrip() {
    const trip = delTrip;
    setDelTrip(null);
    if (!trip) return;
    try {
      const undo = await deleteExpenseTrips(ctx, [trip], expenses);
      showToast(`Deleted ${trip.name}`, undo, 12000);
    } catch (e) {
      showToast(saveErrorMessage(e, 'delete that folder'));
    }
  }

  return (
    <>
      {expenseError && (
        <div className="card" role="alert" style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>
          <p className="small"><strong>{saveErrorMessage(expenseError, 'load your expense reports')}</strong></p>
          <p className="tiny muted" style={{ marginTop: 4 }}>Expense reports are saved privately under your own sign-in, which needs the newest Firestore rules.</p>
        </div>
      )}
      {open ? (
        <TripDetail trip={open} expenses={expenses.filter((e) => e.tripId === open.id)} onBack={() => go(null)} onEdit={() => setTripForm(open)} onDeleted={() => go(null)} />
      ) : (
        <>
          <div className="section-h" style={{ marginTop: 4 }}>
            <div>
              <h1>Expense Report</h1>
              <p className="small muted">One folder per trip. Only you can see these, even on a shared list.</p>
            </div>
          </div>
          <button type="button" className="btn primary block" onClick={() => setTripForm({})}><PlusIcon width="20" height="20" /> New trip folder</button>
          <TravelInbox />
          {sorted.length === 0 ? (
            <div className="card empty" style={{ marginTop: 14 }}>
              <h2>No trips yet</h2>
              <p>Start a folder for your next trip, like CES in Las Vegas. Then add receipts as you go: a photo, a saved picture, or a forwarded email.</p>
            </div>
          ) : (
            <>
              <div className="section-h" style={{ marginTop: 14, marginBottom: -6 }}>
                <span className="small muted">{tPick.on ? '' : sorted.length > 1 ? 'Press and hold a folder to select several' : ''}</span>
                {tPick.on && <PickHeader pick={tPick} />}
              </div>
              <div className="xfolders">
                {sorted.map((t) => (
                  <TripCard key={t.id} trip={t} expenses={expenses.filter((e) => e.tripId === t.id)} picking={tPick.on} picked={tPick.has(t.id)}
                    onHold={() => tPick.start(t.id)} onOpen={() => (tPick.on ? tPick.toggle(t.id) : go(t.id))} onDelete={() => setDelTrip(t)} />
                ))}
              </div>
              <PickBar pick={tPick} label="Selected trip folders" onDelete={() => setDelAsk(true)} />
            </>
          )}
          {delAsk && pickedTrips.length > 0 && (
            <ConfirmDelete title={`Delete ${plural(pickedTrips.length, 'trip folder')}?`} count={pickedTrips.length} onCancel={() => setDelAsk(false)} onConfirm={deletePicked}>
              <p>This deletes {pickedTrips.length === 1 ? pickedTrips[0].name : `these ${pickedTrips.length} folders`} and the {plural(pickedCount, 'expense')} and receipt photos in {pickedTrips.length === 1 ? 'it' : 'them'}.</p>
              <p className="small muted">You can tap Undo for a few seconds after.</p>
            </ConfirmDelete>
          )}
          {delTrip && (() => {
            const n = expenses.filter((e) => e.tripId === delTrip.id).length;
            return (
              <ConfirmDelete title="Delete this trip folder?" count="folder" onCancel={() => setDelTrip(null)} onConfirm={deleteOneTrip}>
                <p>This deletes <strong>{delTrip.name}</strong> and the {plural(n, 'expense')} and receipt photos in it.</p>
                <p className="small muted">You can tap Undo for a few seconds after.</p>
              </ConfirmDelete>
            );
          })()}
        </>
      )}
      {tripForm && <TripForm trip={tripForm} onClose={() => setTripForm(null)} onSaved={(id) => { setTripForm(null); go(id); }} />}
    </>
  );
}

function TripCard({ trip, expenses, onOpen, onHold, onDelete, picking, picked }) {
  const t = tripTotals(trip, expenses);
  const warn = expenses.reduce((n, e) => n + expenseFlags(e, expenses, trip).filter((f) => f.level === 'warn').length, 0);
  const hold = useHold(onHold);
  return (
    <div className={`card xfolder holdable${picked ? ' selected' : ''}`} role="group" tabIndex={0} onClick={onOpen} {...hold}
      onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onOpen(); } }}
      aria-label={`${trip.name}${picking && picked ? ', selected' : ''}`}>
      {picking && <span className={`check pick${picked ? ' on' : ''}`} aria-hidden="true"><span /></span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row-top">
          <FitText className="xfolder-name" lines={2} fitLines min={0.7} spill={3} title={trip.name}>{trip.name}</FitText>
          {!picking && onDelete && <RowTrash label={`Delete ${trip.name}`} onDelete={onDelete} />}
        </div>
        <FitText className="small muted">{trip.location} · {fmtRange(trip.startDate, trip.endDate)}</FitText>
        <div className="xfolder-owed"><span className="price">{fmtMoney(t.owedToYou)}</span><FitText as="span" className="small muted">owed to you</FitText></div>
        <div className="xchips">
          <span className="chip blue">{expenses.length} expense{expenses.length === 1 ? '' : 's'}</span>
          {warn > 0 && <span className="chip warn">{warn} to check</span>}
          {trip.status === 'submitted' && <span className="chip">Submitted</span>}
        </div>
      </div>
    </div>
  );
}

// The trash can on a row. Pressing it never opens the row or starts picking.
function RowTrash({ label, onDelete }) {
  const stop = (e) => e.stopPropagation();
  return (
    <button type="button" className="icon-btn row-del" title="Delete" aria-label={label}
      onPointerDown={stop} onContextMenu={stop} onKeyDown={stop} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
      <TrashIcon />
    </button>
  );
}

function TripForm({ trip, onClose, onSaved }) {
  const { ctx, showToast } = useApp();
  const [f, setF] = useState(() => ({ mealsMode: 'actual', ...trip }));
  const [saving, setSaving] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const nameLen = (f.name || '').trim().length;
  const nameTooLong = nameLen > TRIP_NAME_MAX && (f.name || '') !== (trip.name || '');
  const ok = f.name?.trim() && !nameTooLong && f.location?.trim() && f.startDate && f.endDate && f.endDate >= f.startDate;

  async function save() {
    setSaving(true);
    try {
      const id = await saveExpenseTrip(ctx, { ...f, name: f.name.trim(), location: f.location.trim() });
      showToast(trip.id ? 'Trip details saved' : `Folder made for ${f.name.trim()}`);
      onSaved(id);
    } catch (e) {
      console.error(e);
      showToast(saveErrorMessage(e, 'save the trip'));
    } finally { setSaving(false); }
  }

  return (
    <Sheet title={trip.id ? 'Trip details' : 'New trip folder'} onClose={onClose} wide>
      <div className="stack">
        <label className="field">
          <span>Event or trip name</span>
          <input className="input" value={f.name || ''} onChange={(e) => set({ name: e.target.value })} autoFocus
            maxLength={Math.max(TRIP_NAME_MAX, (trip.name || '').length)} aria-describedby="trip-name-count" />
          <span id="trip-name-count" className={`count-note${nameTooLong ? ' over' : ''}`} aria-live="polite">
            {nameTooLong ? `${nameLen} of ${TRIP_NAME_MAX} letters. Shorten the name to save.` : `${nameLen} of ${TRIP_NAME_MAX} letters`}
          </span>
        </label>
        <label className="field"><span>Location</span><input className="input" value={f.location || ''} onChange={(e) => set({ location: e.target.value })} /></label>
        <div className="grid2">
          <label className="field"><span>First day of travel</span><input type="date" className="input" value={f.startDate ? toInputDate(f.startDate) : ''} onChange={(e) => { const s = fromInputDate(e.target.value); set({ startDate: s, endDate: f.endDate && f.endDate >= s ? f.endDate : s }); }} /></label>
          <label className="field"><span>Last day of travel</span><input type="date" className="input" value={f.endDate ? toInputDate(f.endDate) : ''} min={f.startDate ? toInputDate(f.startDate) : undefined} onChange={(e) => set({ endDate: fromInputDate(e.target.value) })} /></label>
        </div>
        <label className="field"><span>Business purpose</span><textarea className="input" rows={2} value={f.purpose || ''} onChange={(e) => set({ purpose: e.target.value })} /></label>
        <div className="grid2">
          <label className="field"><span>Employer or client (optional)</span><input className="input" value={f.employer || ''} onChange={(e) => set({ employer: e.target.value })} /></label>
          <label className="field"><span>Project (optional)</span><input className="input" value={f.project || ''} onChange={(e) => set({ project: e.target.value })} /></label>
          <label className="field"><span>Charge or cost code (optional)</span><input className="input" value={f.chargeCode || ''} onChange={(e) => set({ chargeCode: e.target.value })} /></label>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>Meals</div>
          <div className="seg" role="group" aria-label="How meals are claimed">
            <button type="button" aria-pressed={f.mealsMode !== 'perDiem'} onClick={() => set({ mealsMode: 'actual' })}>Actual cost, with receipts</button>
            <button type="button" aria-pressed={f.mealsMode === 'perDiem'} onClick={() => set({ mealsMode: 'perDiem' })}>Per diem</button>
          </div>
          {f.mealsMode === 'perDiem' && (
            <div className="grid2" style={{ marginTop: 10 }}>
              <label className="field"><span>Daily meals and incidentals rate ($)</span><input className="input" inputMode="decimal" value={f.mieRate ?? ''} onChange={(e) => set({ mieRate: e.target.value })} /></label>
              <p className="tiny muted" style={{ alignSelf: 'end' }}>Look up the rate for the city on <a href="https://www.gsa.gov/travel/plan-book/per-diem-rates" target="_blank" rel="noopener noreferrer">GSA's per diem page ↗</a>, or use your employer's. The first and last day get 75%.</p>
            </div>
          )}
        </div>
        <button type="button" className="btn primary block" onClick={save} disabled={!ok || saving}>{saving ? 'Saving…' : trip.id ? 'Save trip details' : 'Make the folder'}</button>
        {!ok && <p className="tiny muted">A name, a location and both dates are needed.</p>}
      </div>
    </Sheet>
  );
}

function TripDetail({ trip, expenses, onBack, onEdit, onDeleted }) {
  const { ctx, backend, showToast } = useApp();
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const cameraRef = useRef(); const pickRef = useRef();
  const list = sortExpenses(expenses);
  const totals = tripTotals(trip, expenses);
  const allFlags = list.flatMap((e) => expenseFlags(e, expenses, trip).filter((f) => f.level === 'warn'));
  // Press and hold an expense to pick several, then delete them together, with Undo.
  const ePick = usePick(list.map((e) => e.id));
  const [delAsk, setDelAsk] = useState(false);
  const pickedExp = list.filter((e) => ePick.has(e.id));
  async function deletePicked() {
    const picked = pickedExp;
    setDelAsk(false);
    if (!picked.length) return;
    try {
      const undo = await deleteExpenses(ctx, picked);
      ePick.stop();
      showToast(`Deleted ${plural(picked.length, 'expense')}`, undo, 12000);
    } catch (e) {
      showToast(saveErrorMessage(e, 'delete those expenses'));
    }
  }
  async function deleteOne(e) {
    try {
      const undo = await deleteExpenses(ctx, [e]);
      showToast(`Deleted ${e.merchant || categoryLabel(e.category)}`, undo, 12000);
    } catch (err) {
      showToast(saveErrorMessage(err, 'delete that expense'));
    }
  }

  useEffect(() => {
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (file) { e.preventDefault(); handle(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  async function handle(file) {
    if (!file) return;
    if (!isImageFile(file)) { showToast('Use a photo or screenshot of the receipt (JPG, PNG or HEIC).'); return; }
    let image;
    try {
      setBusy('Opening the photo…');
      image = await compressImage(await toReadableImage(file));
    } catch (e) {
      console.error(e);
      showToast(e?.message || "Couldn't open that photo. Try a JPG or PNG.");
      setBusy(''); clear(); return;
    }
    let read = {};
    try {
      setBusy('Reading the receipt…');
      read = await extractExpense(image, backend.getApp());
      if (!read.isReceipt) showToast("That doesn't look like a receipt. Fill in what you can, or close and try another photo.");
    } catch (e) {
      console.error(e);
      showToast(`${aiErrorMessage(e, 'Receipt reading')} The photo is kept, so you can fill in the rest.`, null, 9000);
    } finally { setBusy(''); clear(); }
    setEditing({ ...read, tripId: trip.id, paidWith: 'personal', source: 'photo', newImages: [image], date: read.date || Date.now() });
  }
  function clear() { if (cameraRef.current) cameraRef.current.value = ''; if (pickRef.current) pickRef.current.value = ''; }

  const byDay = [];
  for (const e of list) {
    const k = e.date ? dayKey(e.date) : 'none';
    const g = byDay[byDay.length - 1];
    if (g && g.k === k) g.items.push(e); else byDay.push({ k, items: [e] });
  }

  return (
    <>
      <button type="button" className="btn ghost" onClick={onBack} style={{ marginLeft: -10 }}>‹ All trips</button>
      <div className="card" style={{ marginTop: 4 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <FitText as="h1" lines={4}>{trip.name}</FitText>
            <p className="small muted">{trip.location} · {fmtRange(trip.startDate, trip.endDate)} · {tripDays(trip).length} days</p>
            {trip.purpose && <p className="small" style={{ marginTop: 4 }}>{trip.purpose}</p>}
            {(trip.employer || trip.project || trip.chargeCode) && <p className="tiny muted" style={{ marginTop: 4 }}>{[trip.employer, trip.project, trip.chargeCode && `Code ${trip.chargeCode}`].filter(Boolean).join(' · ')}</p>}
          </div>
          <button type="button" className="btn" onClick={onEdit}>Edit</button>
        </div>
      </div>

      <div className="kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="v">{fmtMoney(totals.owedToYou)}</div><div className="l">Owed to you</div></div>
        <div className="kpi"><div className="v">{fmtMoney(totals.personal)}</div><div className="l">Personal, not claimed</div></div>
      </div>

      <div
        className={`drop${over ? ' over' : ''}`} style={{ marginTop: 12 }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files?.[0]); }} aria-busy={!!busy}
      >
        <CameraIcon />
        <strong style={{ color: 'var(--bb)', fontSize: '1.1rem' }}>{busy || 'Add an expense'}</strong>
        <span className="small muted">{busy ? 'This takes a few seconds.' : "Snap the receipt and I'll fill in the details for you to check. Nothing is saved until you tap Save."}</span>
        <div className="drop-actions">
          <label className={`btn primary${busy ? ' is-disabled' : ''}`}>Take photo<input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} disabled={!!busy} /></label>
          <label className={`btn${busy ? ' is-disabled' : ''}`}>Choose photo<input ref={pickRef} type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} disabled={!!busy} /></label>
          <button type="button" className="btn ghost" disabled={!!busy} onClick={() => setEditing({ tripId: trip.id, paidWith: 'personal', source: 'manual', category: 'other', date: Math.min(Date.now(), trip.endDate) })}>Type it in</button>
        </div>
      </div>
      {DEMO_MODE && <p className="tiny muted" style={{ marginTop: 6 }}>Demo mode fills in a sample dinner receipt so you can try the check step.</p>}

      <TravelInbox tripId={trip.id} onReview={(x) => setEditing(x)} />

      {allFlags.length > 0 && (
        <p className="small" style={{ marginTop: 14, color: 'var(--gold-ink)', fontWeight: 600 }}>{allFlags.length} thing{allFlags.length === 1 ? '' : 's'} to check before you submit. They're marked below.</p>
      )}

      <div className="section-h">
        <h2>Expenses</h2>
        {ePick.on ? <PickHeader pick={ePick} /> : <span className="small muted">{list.length} · {fmtMoney(totals.spent)} spent</span>}
      </div>
      {!ePick.on && list.length > 1 && <p className="tiny muted" style={{ margin: '-4px 0 6px' }}>Press and hold an expense to select several.</p>}
      {list.length === 0 ? (
        <div className="card empty"><p>No expenses yet. Airfare, registration and supplies bought before the trip belong here too.</p></div>
      ) : byDay.map((g) => (
        <div key={g.k} className="xday">
          <div className="xday-h"><span>{g.k === 'none' ? 'No date' : dayName(fromDayKey(g.k))}</span><span>{fmtMoney(g.items.reduce((s, e) => s + (Number(e.amount) || 0), 0))}</span></div>
          <div className="list">
            {g.items.map((e) => (
              <ExpenseRow key={e.id} e={e} all={expenses} trip={trip} picking={ePick.on} picked={ePick.has(e.id)}
                onHold={() => ePick.start(e.id)} onToggle={() => ePick.toggle(e.id)} onOpen={() => (ePick.on ? ePick.toggle(e.id) : setEditing(e))} onDelete={() => deleteOne(e)} />
            ))}
          </div>
        </div>
      ))}
      <PickBar pick={ePick} label="Selected expenses" onDelete={() => setDelAsk(true)} />
      {delAsk && pickedExp.length > 0 && (
        <ConfirmDelete title={`Delete ${plural(pickedExp.length, 'expense')}?`} count={pickedExp.length} onCancel={() => setDelAsk(false)} onConfirm={deletePicked}>
          <p>This deletes {pickedExp.length === 1 ? (pickedExp[0].merchant || 'this expense') : `these ${pickedExp.length} expenses`} and {pickedExp.length === 1 ? 'its' : 'their'} receipt photos from {trip.name}.</p>
          <p className="small muted">You can tap Undo for a few seconds after.</p>
        </ConfirmDelete>
      )}

      {trip.mealsMode === 'perDiem' && <PerDiem trip={trip} days={totals.perDiemDays} />}

      {totals.byCategory.length > 0 && (
        <>
          <div className="section-h"><h2>By category</h2></div>
          <FitTable>
            <table className="data xtable">
              <thead><tr><th>Category</th><th className="num">Spent</th><th className="num">Claimed</th></tr></thead>
              <tbody>
                {totals.byCategory.map((c) => <tr key={c.id}><td>{c.label}</td><td className="num">{fmtMoney(c.spent)}</td><td className="num">{fmtMoney(c.business)}</td></tr>)}
                {totals.perDiem > 0 && <tr><td>Meals per diem</td><td className="num" /><td className="num">{fmtMoney(totals.perDiem)}</td></tr>}
                <tr><td><strong>Total</strong></td><td className="num"><strong>{fmtMoney(totals.spent)}</strong></td><td className="num"><strong>{fmtMoney(totals.business + totals.perDiem)}</strong></td></tr>
              </tbody>
            </table>
          </FitTable>
        </>
      )}

      <ReceiptGallery expenses={list} onOpenExpense={(e) => setEditing(e)} />

      <SendReport trip={trip} expenses={list} totals={totals} />

      <button type="button" className="btn danger block" style={{ marginTop: 20 }}
        onClick={async () => {
          if (!confirmDel) { setConfirmDel(true); return; }
          try {
            const undo = await deleteExpenseTrips(ctx, [trip], expenses);
            showToast(`Deleted ${trip.name} and its ${plural(expenses.length, 'expense')}`, undo, 12000);
            onDeleted();
          } catch (e) { showToast(saveErrorMessage(e, 'delete that folder')); }
        }}>
        <TrashIcon width="20" height="20" /> {confirmDel ? `Tap again to delete the folder and its ${expenses.length} expense${expenses.length === 1 ? '' : 's'}` : 'Delete this trip folder'}
      </button>

      {editing && <ExpenseSheet initial={editing} trip={trip} all={expenses} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    </>
  );
}

function ExpenseRow({ e, all, trip, onOpen, onHold, onToggle, onDelete, picking, picked }) {
  const flags = expenseFlags(e, all, trip);
  const biz = trip.mealsMode === 'perDiem' && isMeal(e.category) ? 0 : businessAmount(e);
  const partial = Math.abs(biz - (Number(e.amount) || 0)) > 0.004;
  const hold = useHold(onHold);
  const name = e.merchant || categoryLabel(e.category);
  const meta = [
    categoryLabel(e.category),
    e.time && fmtTime(e.time),
    paidWithId(e.paidWith) !== 'personal' && paidWithLabel(e.paidWith),
    hasReceipt(e) && (e.emailId ? 'Emailed receipt' : `${e.imageIds.length} photo${e.imageIds.length === 1 ? '' : 's'}`),
  ].filter(Boolean).join(' · ');
  return (
    <div className={`item xrow holdable${picked ? ' selected' : ''}`} role="group" tabIndex={0} onClick={onOpen} {...hold}
      aria-label={`${name}, ${fmtMoney(e.amount)}${picking && picked ? ', selected' : ''}`}
      onKeyDown={(ev) => { if (ev.target === ev.currentTarget && ev.key === 'Enter') onOpen(); }}>
      {picking && <PickBox on={picked} name={name} onToggle={onToggle} />}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row-top">
          <FitText className="name" lines={2} title={name}>{name}</FitText>
          {!picking && onDelete && <RowTrash label={`Delete ${name}, ${fmtMoney(e.amount)}`} onDelete={onDelete} />}
        </div>
        <div className="row-sub">
          <FitText className="meta-line">{meta}</FitText>
          <div className="price">
            {fmtMoney(e.amount)}
            {partial && <small>{fmtMoney(biz)} claimed</small>}
          </div>
        </div>
        {flags.length > 0 && <div className="meta">{flags.map((f) => <span key={f.code} className={`chip ${f.level === 'warn' ? 'warn' : ''}`}>{f.label}</span>)}</div>}
        {e.notes && <FitText className="tiny muted" lines={2} style={{ marginTop: 2 }}>{e.notes}</FitText>}
      </div>
    </div>
  );
}

const fmtTime = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

function PerDiem({ trip, days }) {
  const { ctx } = useApp();
  const parts = GSA_MIE[Number(trip.mieRate)];
  const toggle = (day, meal) => {
    const cur = trip.mealsProvided?.[day] || [];
    const next = cur.includes(meal) ? cur.filter((m) => m !== meal) : [...cur, meal];
    updateExpenseTrip(ctx, trip.id, { mealsProvided: { ...(trip.mealsProvided || {}), [day]: next } });
  };
  if (!Number(trip.mieRate)) return <div className="card small" style={{ marginTop: 14 }}>Add the daily meals rate under Edit to work out the per diem.</div>;
  return (
    <>
      <div className="section-h"><h2>Meals per diem</h2><span className="small muted">${Number(trip.mieRate)} a day</span></div>
      <FitTable>
        <table className="data xtable">
          <thead><tr><th>Day</th>{parts && <th>Meal provided</th>}<th className="num">Amount</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>{dayName(fromDayKey(d.day))}{d.edge && <div className="tiny muted">Travel day, 75%</div>}</td>
                {parts && (
                  <td><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {['breakfast', 'lunch', 'dinner'].map((m) => (
                      <button key={m} type="button" className={`chip${d.provided.includes(m) ? ' gold' : ''}`} aria-pressed={d.provided.includes(m)} onClick={() => toggle(d.day, m)}>{m[0].toUpperCase() + m.slice(1)}</button>
                    ))}
                  </div></td>
                )}
                <td className="num">{fmtMoney(d.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </FitTable>
      <p className="tiny muted" style={{ marginTop: 6 }}>{parts ? 'Tap a meal the event or hotel provided, and its GSA share comes off that day.' : 'Meals provided by the event come off only for the standard GSA rates ($68 to $92).'}</p>
    </>
  );
}

// The check-and-save form. Everything the AI read is only a suggestion until Save.
function ExpenseSheet({ initial, trip, all, onClose, onSaved }) {
  const { ctx, showToast } = useApp();
  const [f, setF] = useState(() => ({ currency: 'USD', paidWith: 'personal', nights: [], ...initial, newImages: undefined, _trip: undefined, isReceipt: undefined }));
  const [newImages, setNewImages] = useState(initial.newImages || []);
  const [removed, setRemoved] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [saving, setSaving] = useState(false);
  const [claim, setClaim] = useState(() => (initial.nights?.length ? 'nights' : initial.business == null || initial.business === '' || Number(initial.business) === Number(initial.amount) ? 'all' : Number(initial.business) === 0 ? 'none' : 'part'));
  const [confirmDel, setConfirmDel] = useState(false);
  const addRef = useRef();
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const perDiemMeal = trip.mealsMode === 'perDiem' && isMeal(f.category);

  useEffect(() => {
    for (const id of initial.imageIds || []) getExpenseImage(ctx, id).then((d) => d && setThumbs((t) => ({ ...t, [id]: d.dataUrl })));
  }, []);

  const business = claim === 'all' ? null : claim === 'none' ? 0 : claim === 'part' ? f.business : null;
  const draft = { ...f, business: claim === 'nights' ? null : business, nights: claim === 'nights' ? f.nights : [], imageIds: (f.imageIds || []).filter((x) => !removed.includes(x)), ...(newImages.length ? { imageIds: ['new'] } : {}) };
  const flags = expenseFlags({ ...draft, amount: f.amount === '' ? null : f.amount }, all, trip).filter((x) => x.code !== 'amount');
  const claimed = businessAmount({ ...draft, amount: Number(f.amount) || 0 });
  const ok = f.amount !== '' && f.amount != null && !Number.isNaN(Number(f.amount)) && f.date && f.category;

  function splitNights() {
    const n = Math.max(1, tripDays(trip).length - 1);
    const each = Math.round(((Number(f.amount) || 0) / n) * 100) / 100;
    const start = fromDayKey(dayKey(trip.startDate));
    set({ nights: Array.from({ length: n }, (_, i) => ({ date: fromDayKey(dayKey(start + i * 864e5 + 3600e3)), amount: i === n - 1 ? Math.round(((Number(f.amount) || 0) - each * (n - 1)) * 100) / 100 : each, personal: false })) });
    setClaim('nights');
  }
  const setNight = (i, patch) => set({ nights: f.nights.map((n, j) => (j === i ? { ...n, ...patch } : n)) });

  async function addPhoto(file) {
    if (!file || !isImageFile(file)) return;
    try { const img = await compressImage(await toReadableImage(file)); setNewImages((x) => [...x, img]); } catch (e) { showToast(e?.message || "Couldn't open that photo."); }
    if (addRef.current) addRef.current.value = '';
  }

  async function save() {
    setSaving(true);
    try {
      await saveExpense(ctx, { ...f, business: claim === 'nights' ? null : business, nights: claim === 'nights' ? f.nights : [] }, { newImages, removedImageIds: removed });
      // An emailed receipt now saved in a trip is done with, so the app's inbox can let it go.
      if (initial.emailId && !initial.id) ackInbox(initial.emailId).catch(() => {});
      showToast(initial.id ? 'Expense updated' : `Saved ${f.merchant || categoryLabel(f.category)}, ${fmtMoney(f.amount)}`);
      onSaved();
    } catch (e) {
      console.error(e);
      showToast(saveErrorMessage(e, 'save the expense'));
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!confirmDel) { setConfirmDel(true); return; }
    const undo = await deleteExpense(ctx, initial);
    showToast(`Deleted ${initial.merchant || 'the expense'}`, undo);
    onClose();
  }

  const images = [...(f.imageIds || []).filter((x) => !removed.includes(x)).map((id) => ({ id, src: thumbs[id] })), ...newImages.map((src, i) => ({ id: `new-${i}`, src, fresh: i }))];

  return (
    <Sheet title={initial.id ? 'Expense' : 'Check the expense'} onClose={onClose} wide>
      {!initial.id && initial.source !== 'manual' && <p className="small muted" style={{ marginBottom: 10 }}>I filled this in from the {initial.source === 'email' ? 'email' : 'receipt'}. Fix anything that's wrong, then save.</p>}
      <div className="stack">
        <div className="grid2">
          <label className="field"><span>Category</span>
            <select className="input" value={f.category || 'other'} onChange={(e) => set({ category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Merchant</span><input className="input" value={f.merchant || ''} onChange={(e) => set({ merchant: e.target.value })} maxLength={Math.max(MERCHANT_MAX, (initial.merchant || '').length)} /></label>
          <label className="field"><span>Date</span><input type="date" className="input" value={f.date ? toInputDate(f.date) : ''} onChange={(e) => set({ date: fromInputDate(e.target.value) })} /></label>
          <label className="field"><span>Time (optional)</span><input type="time" className="input" value={f.time || ''} onChange={(e) => set({ time: e.target.value })} /></label>
          <label className="field"><span>Amount in US dollars</span><input className="input" inputMode="decimal" value={f.amount ?? ''} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" /></label>
        </div>
        {f.originalCurrency && f.originalCurrency !== 'USD' && (
          <p className="small" style={{ color: 'var(--gold-ink)' }}>The receipt is in {f.originalCurrency} ({f.originalAmount}). Enter the dollar amount from your card statement, so the report matches what you paid.</p>
        )}

        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>Paid with</div>
          <div className="seg" role="group" aria-label="Paid with">
            {PAID_WITH.map((p) => (
              <button key={p.id} type="button" aria-pressed={paidWithId(f.paidWith) === p.id} onClick={() => set({ paidWith: p.id })}>{p.label}</button>
            ))}
          </div>
        </div>

        {perDiemMeal ? (
          <p className="small muted">This trip claims meals by per diem, so this receipt is kept for your records and isn't claimed.</p>
        ) : (
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>How much is for the business?</div>
            <div className="seg" role="group" aria-label="Business part" style={{ flexWrap: 'wrap' }}>
              <button type="button" aria-pressed={claim === 'all'} onClick={() => setClaim('all')}>All of it</button>
              <button type="button" aria-pressed={claim === 'part'} onClick={() => setClaim('part')}>Part</button>
              {f.category === 'lodging' && <button type="button" aria-pressed={claim === 'nights'} onClick={() => (f.nights?.length ? setClaim('nights') : splitNights())}>By night</button>}
              <button type="button" aria-pressed={claim === 'none'} onClick={() => setClaim('none')}>None, it's personal</button>
            </div>
            {claim === 'part' && (
              <label className="field" style={{ marginTop: 8 }}><span>Business amount ($)</span><input className="input" inputMode="decimal" value={f.business ?? ''} onChange={(e) => set({ business: e.target.value })} /></label>
            )}
            {claim === 'nights' && (
              <div className="card" style={{ marginTop: 8, padding: 10 }}>
                {f.nights.map((n, i) => (
                  <div key={i} className="row xnight">
                    <span className="grow small">{n.date ? dayName(n.date) : `Night ${i + 1}`}</span>
                    <input className="input" inputMode="decimal" aria-label={`Amount for night ${i + 1}`} value={n.amount ?? ''} onChange={(e) => setNight(i, { amount: e.target.value })} style={{ width: 100 }} />
                    <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!n.personal} onChange={(e) => setNight(i, { personal: e.target.checked })} style={{ width: 22, height: 22 }} />Personal</label>
                  </div>
                ))}
                <div className="row" style={{ marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="chip" onClick={() => set({ nights: [...f.nights, { date: null, amount: 0, personal: false }] })}>Add a night</button>
                  <button type="button" className="chip" onClick={splitNights}>Split evenly over the trip</button>
                  {(() => { const s = f.nights.reduce((a, n) => a + (Number(n.amount) || 0), 0); return Math.abs(s - (Number(f.amount) || 0)) > 0.05 ? <span className="tiny" style={{ color: 'var(--gold-ink)' }}>Nights add up to {fmtMoney(s)}, not {fmtMoney(f.amount)}</span> : null; })()}
                </div>
              </div>
            )}
            {claim !== 'all' && <p className="small" style={{ marginTop: 6 }}>Claimed: <strong>{fmtMoney(claimed)}</strong> · personal: {fmtMoney((Number(f.amount) || 0) - claimed)}</p>}
          </div>
        )}

        <label className="field"><span>Notes for the report</span>
          <textarea className="input" rows={3} value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
        </label>

        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Receipt</div>
          {f.emailId && <p className="small" style={{ marginBottom: 6 }}>From a forwarded email. The PDF report lists it; attach the email itself if your employer asks.</p>}
          <div className="xthumbs">
            {images.map((im) => (
              <div key={im.id} className="xthumb">
                {im.src ? <img src={im.src} alt="Receipt" /> : <span className="tiny muted">Loading…</span>}
                <button type="button" className="icon-btn" aria-label="Remove this photo" onClick={() => (im.fresh != null ? setNewImages((x) => x.filter((_, j) => j !== im.fresh)) : setRemoved((r) => [...r, im.id]))}>×</button>
              </div>
            ))}
            <label className="xthumb add"><PlusIcon width="22" height="22" /><span className="tiny">Add photo</span><input ref={addRef} type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={(e) => addPhoto(e.target.files?.[0])} /></label>
          </div>
        </div>

        {flags.length > 0 && <div className="xchips">{flags.map((x) => <span key={x.code} className={`chip ${x.level === 'warn' ? 'warn' : ''}`}>{x.label}</span>)}</div>}

        <button type="button" className="btn primary block" onClick={save} disabled={!ok || saving}>{saving ? 'Saving…' : initial.id ? 'Save changes' : 'Save expense'}</button>
        {!ok && <p className="tiny muted">A date and an amount are needed.</p>}
        {initial.id && <button type="button" className="btn danger block" onClick={remove}>{confirmDel ? 'Tap again to delete' : 'Delete expense'}</button>}
      </div>
    </Sheet>
  );
}

// Receipts forwarded to the app's inbox that look like a trip's (a hotel, airline or rideshare
// in the trip's window, a restaurant on a trip day, or a merchant already in the trip). Each
// waits here to be checked; nothing goes into a trip without a tap on Save.
function TravelInbox({ tripId, onReview }) {
  const { expenseTrips, expenses, backend, showToast } = useApp();
  const [mail, setMail] = useState(null);
  const [reading, setReading] = useState('');
  const [sheet, setSheet] = useState(null);
  const [hidden, setHidden] = useState(() => notTravelIds());

  useEffect(() => {
    let live = true;
    fetchInbox().then((d) => {
      if (!live) return;
      setMail(d.items || []);
    }).catch(() => live && setMail([]));
    return () => { live = false; };
  }, []);

  const matches = (mail || [])
    .filter((m) => !hidden.includes(m.id))
    .map((m) => ({ m, trip: emailTrip(m, expenseTrips, expenses) }))
    .filter((x) => x.trip && (!tripId || x.trip.id === tripId) && !expenses.some((e) => e.emailId === x.m.id));
  if (!matches.length) return null;

  async function review({ m, trip }) {
    setReading(m.id);
    try {
      const read = await extractExpenseText(m, backend.getApp());
      const draft = { ...read, tripId: trip.id, paidWith: 'personal', source: 'email', emailId: m.id, date: read.date || m.date || Date.now(), _trip: trip };
      if (onReview && trip.id === tripId) onReview({ ...draft, _trip: undefined }); else setSheet(draft);
    } catch (e) {
      console.error(e);
      showToast(aiErrorMessage(e, 'Email reading'));
    } finally { setReading(''); }
  }

  return (
    <>
      <div className="section-h"><h2>Emailed receipts for {tripId ? 'this trip' : 'your trips'}</h2><span className="small muted">{matches.length}</span></div>
      <div className="list">
        {matches.map(({ m, trip }) => (
          <div key={m.id} className="item">
            <div className="grow" style={{ minWidth: 0 }}>
              <FitText className="name" lines={2}>{m.subject || '(no subject)'}</FitText>
              <div className="meta"><span>{String(m.from || '').replace(/<.*>/, '').trim()}</span>{m.date && <span>{fmtDate(m.date, { withYear: true })}</span>}{!tripId && <span className="chip blue">{trip.name}</span>}</div>
            </div>
            <div className="row" style={{ gap: 6, flex: 'none' }}>
              <button type="button" className="btn primary" disabled={!!reading} onClick={() => review({ m, trip })}>{reading === m.id ? 'Reading…' : 'Check'}</button>
              <button type="button" className="btn ghost" onClick={() => { markNotTravel(m.id); setHidden(notTravelIds()); showToast('Moved back to Receipts', () => { try { localStorage.setItem('sla-not-travel', JSON.stringify(notTravelIds().filter((x) => x !== m.id))); } catch { /* storage blocked */ } setHidden(notTravelIds()); }); }}>Not travel</button>
            </div>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 6 }}>These are left out of the Receipts page. Tap Not travel to send one back there.</p>
      {sheet && <ExpenseSheet initial={sheet} trip={sheet._trip} all={expenses.filter((e) => e.tripId === sheet._trip.id)} onClose={() => setSheet(null)} onSaved={() => { setMail((x) => (x || []).filter((m) => m.id !== sheet.emailId)); setSheet(null); }} />}
    </>
  );
}

// Receipt photos load one by one and are kept for the session, so going back and forth
// between trips doesn't download them again.
const photoCache = new Map();
function usePhoto(id) {
  const { ctx } = useApp();
  const [src, setSrc] = useState(() => photoCache.get(id) || null);
  useEffect(() => {
    if (photoCache.has(id)) { setSrc(photoCache.get(id)); return undefined; }
    let live = true;
    getExpenseImage(ctx, id).then((d) => { if (d?.dataUrl) { photoCache.set(id, d.dataUrl); if (live) setSrc(d.dataUrl); } }).catch(() => {});
    return () => { live = false; };
  }, [id]);
  return src;
}

function ReceiptGallery({ expenses, onOpenExpense }) {
  const photos = tripPhotos(expenses);
  const emailed = expenses.filter((e) => e.emailId && !(e.imageIds || []).length).length;
  const [open, setOpen] = useState(null);
  if (!photos.length && !emailed) return null;
  const current = open && photos.find((p) => p.id === open);
  return (
    <>
      <div className="section-h"><h2>Receipt photos</h2><span className="small muted">{photos.length}</span></div>
      {photos.length > 0 && (
        <div className="xgallery">
          {photos.map((p) => <GalleryTile key={p.id} p={p} onOpen={() => setOpen(p.id)} />)}
        </div>
      )}
      {emailed > 0 && <p className="tiny muted" style={{ marginTop: 6 }}>{emailed} emailed receipt{emailed === 1 ? ' is' : 's are'} listed in the report without a photo.</p>}
      {current && <PhotoViewer p={current} onClose={() => setOpen(null)} onOpenExpense={() => { setOpen(null); onOpenExpense(current.e); }} />}
    </>
  );
}

function GalleryTile({ p, onOpen }) {
  const src = usePhoto(p.id);
  return (
    <button type="button" className="xtile" onClick={onOpen} aria-label={`Open receipt: ${p.caption}`}>
      <span className="xtile-img">{src ? <img src={src} alt="" loading="lazy" /> : <span className="tiny muted">Loading…</span>}</span>
      <span className="xtile-cap">{p.caption}</span>
      <span className="tiny muted">{p.e.date ? fmtDate(p.e.date) : ''}</span>
    </button>
  );
}

function PhotoViewer({ p, onClose, onOpenExpense }) {
  const { ctx, showToast } = useApp();
  const src = usePhoto(p.id);
  const typed = p.e.captions?.[p.id] || '';
  const auto = autoCaption(p.e, (p.e.imageIds || []).indexOf(p.id), (p.e.imageIds || []).length);
  const [text, setText] = useState(typed || auto);
  const [saving, setSaving] = useState(false);
  async function save(value) {
    setSaving(true);
    try {
      await setPhotoCaption(ctx, p.e, p.id, value === auto ? '' : value);
      showToast('Caption saved');
    } catch (e) { console.error(e); showToast(saveErrorMessage(e)); }
    setSaving(false);
  }
  return (
    <Sheet title="Receipt" onClose={onClose} wide>
      <div className="xviewer">{src ? <img src={src} alt={text} /> : <p className="muted">Loading the photo…</p>}</div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>Caption</span>
        <input className="input" value={text} maxLength={140} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save(text)} />
      </label>
      <p className="tiny muted" style={{ marginTop: 4 }}>{typed ? 'You wrote this caption.' : 'Written from what the receipt says. It changes if you edit the expense, until you type your own.'}</p>
      <div className="drop-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={saving || text.trim() === (typed || auto)} onClick={() => save(text)}>Save caption</button>
        {typed && <button type="button" className="btn ghost" disabled={saving} onClick={() => { setText(auto); save(''); }}>Use the automatic caption</button>}
        <button type="button" className="btn" onClick={onOpenExpense}>Open the expense</button>
        {src && <a className="btn ghost" href={src} download={`${text.replace(/[^\w ,.$-]+/g, '').slice(0, 60) || 'receipt'}.${(src.match(/^data:image\/(\w+)/) || [])[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'jpg'}`}>Save photo</a>}
      </div>
    </Sheet>
  );
}

const safeName = (n) => (String(n || '').replace(/[^\w ,.-]+/g, '').trim() || 'Trip');
const saveFile = (file) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

// Makes the PDF and Excel files, then hands them to the phone's share sheet (Mail, Gmail,
// Outlook, Messages, WhatsApp, Drive, AirDrop and the rest), or downloads them. The files are
// made first and shared on a second tap, because browsers only open the share sheet straight
// after a tap and a report with many receipts takes a few seconds to build.
function SendReport({ trip, expenses, totals }) {
  const { ctx, user, showToast } = useApp();
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState('');
  const [mailed, setMailed] = useState(false);
  const stamp = `${trip.updatedAt || 0}:${expenses.map((e) => `${e.id}.${e.updatedAt || 0}`).join(',')}`;
  const ready = files && files.stamp === stamp;
  const canShareFiles = (list) => { try { return !!navigator.canShare?.({ files: list }); } catch { return false; } };

  async function prepare() {
    setBusy('Making the PDF…'); setMailed(false);
    try {
      const base = `${safeName(trip.name)} expense report`;
      const pdfBlob = await buildReportPdf({
        trip, expenses, userName: user?.name || '', onProgress: setBusy,
        loadPhoto: async (id) => (await getExpenseImage(ctx, id))?.dataUrl,
      });
      const pdf = new File([pdfBlob], `${base}.pdf`, { type: 'application/pdf' });
      const xlsx = new File([xlsxBytes(expenseWorkbook(trip, expenses))], `${base}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      setFiles({ pdf, xlsx, stamp });
    } catch (e) {
      console.error(e);
      showToast("Couldn't make the report. Try again, and if it keeps failing, use the Excel file.", null, 8000);
    }
    setBusy('');
  }

  const subject = `Expense report: ${trip.name} (${fmtRange(trip.startDate, trip.endDate)})`;
  const body = `Attached is my expense report for ${trip.name}, ${trip.location}, ${fmtRange(trip.startDate, trip.endDate)}.\n\nTotal claimed: ${fmtMoney(totals.business + totals.perDiem)}\nOwed to me: ${fmtMoney(totals.owedToYou)}\n\nThe PDF has every expense and receipt; the Excel file has the same lines.`;

  async function share() {
    const both = [files.pdf, files.xlsx];
    const list = canShareFiles(both) ? both : [files.pdf];
    try {
      await navigator.share({ files: list, title: subject, text: body });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.error(e);
      showToast("Your phone didn't open the share menu. Use Download or Email instead.", null, 8000);
    }
  }

  function email() {
    saveFile(files.pdf);
    setTimeout(() => saveFile(files.xlsx), 400);
    setMailed(true);
    setTimeout(() => { window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; }, 900);
  }

  const shareable = ready && canShareFiles([files.pdf]);
  return (
    <>
      <div className="section-h"><h2>Send it in</h2></div>
      <div className="card stack">
        <p className="small">The PDF has the summary, every expense with your notes, and each receipt photo with its caption. The Excel file has the same lines with totals that add up as you edit.</p>
        {!ready ? (
          <button type="button" className="btn primary block" onClick={prepare} disabled={!expenses.length || !!busy}>
            {busy || 'Get the report ready'}
          </button>
        ) : (
          <>
            <p className="small" style={{ fontWeight: 600 }}>Ready: {files.pdf.name.replace(/\.pdf$/, '')}, PDF ({Math.max(1, Math.round(files.pdf.size / 1024))} KB) and Excel.</p>
            <div className="drop-actions" style={{ justifyContent: 'flex-start' }}>
              {shareable && <button type="button" className="btn primary" onClick={share}>Share or email</button>}
              {!shareable && <button type="button" className="btn primary" onClick={email}>Email</button>}
              <button type="button" className="btn" onClick={() => saveFile(files.pdf)}><DownloadIcon width="20" height="20" /> PDF</button>
              <button type="button" className="btn" onClick={() => saveFile(files.xlsx)}><DownloadIcon width="20" height="20" /> Excel</button>
              <button type="button" className="btn ghost" onClick={() => saveFile(new File([expensesCSV(trip, expenses)], files.pdf.name.replace(/\.pdf$/, '.csv'), { type: 'text/csv' }))}>CSV</button>
              {shareable && <button type="button" className="btn ghost" onClick={email}>Email draft</button>}
            </div>
            <p className="tiny muted">
              {shareable
                ? 'Share or email opens your phone’s share menu with both files attached: Mail, Gmail, Outlook, Messages, WhatsApp, Drive and the rest.'
                : 'This browser can’t attach files for you. Email saves both files and opens a draft in your mail app; attach the two files from your Downloads.'}
            </p>
            {mailed && <p className="small" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>Both files are in your Downloads. Attach them to the email draft before you send it.</p>}
          </>
        )}
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={trip.status === 'submitted'} style={{ width: 22, height: 22 }}
            onChange={async (ev) => { const status = ev.target.checked ? 'submitted' : 'open'; await updateExpenseTrip(ctx, trip.id, { status }); showToast(status === 'submitted' ? 'Marked as submitted' : 'Marked as not submitted yet', () => updateExpenseTrip(ctx, trip.id, { status: trip.status || 'open' })); }} />
          I've submitted this report
        </label>
      </div>
    </>
  );
}
