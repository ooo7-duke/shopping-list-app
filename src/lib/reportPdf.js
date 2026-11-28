// Builds the trip's expense report as a real PDF file (not a print dialog), so it can be
// shared from the phone's share sheet, emailed or saved. jsPDF is loaded only when a report
// is made, so it doesn't slow down the rest of the app.
import {
  tripTotals, sortExpenses, categoryLabel, paidWithLabel, isMeal, businessAmount, expenseFlags, hasReceipt, tripPhotos,
} from './expenses.js';
import { fmtMoney, fmtDate } from './format.js';

const PAGE = { w: 612, h: 792, m: 40 }; // US Letter, in points
const INK = [31, 31, 31];
const MUTED = [96, 96, 96];
const RULE = [200, 200, 200];

const fmtTime = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const range = (a, b) => (a && b ? `${fmtDate(a, { withYear: true })} to ${fmtDate(b, { withYear: true })}` : '');

// Any picture the browser can show (JPEG, PNG, HEIC already converted, SVG) becomes a JPEG
// the PDF can hold, at most 1600 px on its long side.
export function toJpeg(src, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth || 800; const h0 = img.naturalHeight || 1000;
      const k = Math.min(1, max / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      try { resolve({ data: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height }); } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Could not open a receipt photo'));
    img.src = src;
  });
}

export async function buildReportPdf({ trip, expenses, userName = '', loadPhoto, onProgress = () => {} }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const list = sortExpenses(expenses);
  const t = tripTotals(trip, list);
  const W = PAGE.w - 2 * PAGE.m;
  let y = PAGE.m;

  const font = (size, bold = false, color = INK) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); };
  const rule = (yy, color = RULE) => { doc.setDrawColor(...color); doc.setLineWidth(0.6); doc.line(PAGE.m, yy, PAGE.m + W, yy); };
  const room = (need) => { if (y + need > PAGE.h - PAGE.m) { doc.addPage(); y = PAGE.m; return true; } return false; };
  const footer = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); font(8, false, MUTED);
      doc.text(`${trip.name} expense report`, PAGE.m, PAGE.h - 22);
      doc.text(`Page ${i} of ${n}`, PAGE.m + W, PAGE.h - 22, { align: 'right' });
    }
  };

  // Title and header
  font(18, true); doc.text(`Expense report: ${trip.name}`, PAGE.m, y + 6, { maxWidth: W }); y += 26;
  font(9, false, MUTED); doc.text(`Prepared ${fmtDate(Date.now(), { withYear: true })}`, PAGE.m, y); y += 14;
  rule(y); y += 14;
  const head = [
    ['Employee', userName], ['Dates', range(trip.startDate, trip.endDate)],
    ['Location', trip.location || ''], ['Charge code', trip.chargeCode || ''],
    ['Employer', trip.employer || ''], ['Project', trip.project || ''],
  ];
  for (let i = 0; i < head.length; i += 2) {
    for (let j = 0; j < 2; j++) {
      const [k, v] = head[i + j]; const x = PAGE.m + j * (W / 2);
      font(9, true); doc.text(k, x, y);
      font(9); doc.text(String(v || ''), x + 70, y, { maxWidth: W / 2 - 76 });
    }
    y += 14;
  }
  if (trip.purpose) {
    font(9, true); doc.text('Purpose', PAGE.m, y);
    font(9); const lines = doc.splitTextToSize(trip.purpose, W - 70); doc.text(lines, PAGE.m + 70, y); y += 12 * lines.length + 2;
  }
  font(9, true); doc.text('Meals', PAGE.m, y);
  font(9); doc.text(trip.mealsMode === 'perDiem' ? `Per diem, $${trip.mieRate || 0} a day (75% on the first and last day)` : 'Actual cost, with receipts', PAGE.m + 70, y);
  y += 20;

  // Summary
  font(12, true); doc.text('Summary', PAGE.m, y); y += 8; rule(y); y += 14;
  const cols = [PAGE.m, PAGE.m + W - 150, PAGE.m + W];
  const sumRow = (label, spent, claimed, bold = false) => {
    font(9.5, bold); doc.text(label, cols[0], y);
    if (spent != null) doc.text(fmtMoney(spent), cols[1], y, { align: 'right' });
    if (claimed != null) doc.text(fmtMoney(claimed), cols[2], y, { align: 'right' });
    y += 14;
  };
  font(8.5, true, MUTED); doc.text('Category', cols[0], y); doc.text('Spent', cols[1], y, { align: 'right' }); doc.text('Claimed', cols[2], y, { align: 'right' }); y += 13;
  for (const c of t.byCategory) sumRow(c.label, c.spent, c.business);
  if (t.perDiem > 0) sumRow('Meals per diem', null, t.perDiem);
  rule(y - 9); sumRow('Total', t.spent, t.business + t.perDiem, true);
  y += 4;
  sumRow('Personal, not claimed', null, t.personal);
  sumRow('Owed to the employee', null, t.owedToYou, true);
  y += 10;

  // Expenses table
  const C = [
    { k: 'date', label: 'Date', w: 58 }, { k: 'cat', label: 'Category', w: 66 }, { k: 'merchant', label: 'Merchant', w: 104 },
    { k: 'paid', label: 'Paid with', w: 50 }, { k: 'amount', label: 'Amount', w: 56, right: true }, { k: 'claimed', label: 'Claimed', w: 56, right: true },
    { k: 'notes', label: 'Notes', w: 0 },
  ];
  C[C.length - 1].w = W - C.slice(0, -1).reduce((s, c) => s + c.w, 0) - 6 * 6;
  const tableHead = () => {
    font(12, true); doc.text('Expenses', PAGE.m, y); y += 8; rule(y); y += 13;
    font(8, true, MUTED);
    let x = PAGE.m;
    for (const c of C) { doc.text(c.label, c.right ? x + c.w : x, y, c.right ? { align: 'right' } : undefined); x += c.w + 6; }
    y += 6; rule(y); y += 11;
  };
  room(80); tableHead();
  for (const e of list) {
    const biz = trip.mealsMode === 'perDiem' && isMeal(e.category) ? 0 : businessAmount(e);
    const flags = expenseFlags(e, list, trip).filter((f) => f.level === 'warn').map((f) => f.label);
    const personalNights = (e.nights || []).filter((n) => n.personal).map((n) => fmtDate(n.date));
    const cells = {
      date: `${e.date ? fmtDate(e.date, { withYear: true }) : ''}${e.time ? `\n${fmtTime(e.time)}` : ''}`,
      cat: categoryLabel(e.category),
      merchant: `${e.merchant || ''}${hasReceipt(e) ? '' : '\n(no receipt)'}`,
      paid: paidWithLabel(e.paidWith),
      amount: fmtMoney(e.amount), claimed: fmtMoney(biz),
      notes: [e.notes, personalNights.length ? `Personal nights, not claimed: ${personalNights.join(', ')}` : '', ...flags]
        .map((s) => String(s || '').trim().replace(/[.\s]+$/, '')).filter(Boolean).map((s) => `${s}.`).join(' '),
    };
    font(8.5);
    const wrapped = C.map((c) => (c.right ? [cells[c.k]] : doc.splitTextToSize(String(cells[c.k] || ''), c.w)));
    const h = Math.max(...wrapped.map((l) => l.length)) * 10.5 + 6;
    if (room(h + 4)) tableHead();
    let x = PAGE.m;
    C.forEach((c, i) => {
      font(8.5, false, c.k === 'notes' ? MUTED : INK);
      doc.text(wrapped[i], c.right ? x + c.w : x, y, c.right ? { align: 'right' } : undefined);
      x += c.w + 6;
    });
    y += h; doc.setDrawColor(235, 235, 235); doc.line(PAGE.m, y - 9, PAGE.m + W, y - 9);
  }

  // Signatures
  room(70); y += 26;
  font(8.5, false, MUTED);
  const sw = (W - 3 * 16) / 4;
  ['Employee signature', 'Date', 'Approver', 'Date'].forEach((label, i) => {
    const x = PAGE.m + i * (sw + 16);
    doc.setDrawColor(...MUTED); doc.line(x, y, x + sw, y); doc.text(label, x, y + 11);
  });

  // One receipt per page, with its caption
  const photos = tripPhotos(list);
  let done = 0;
  for (const p of photos) {
    onProgress(`Adding receipt ${done + 1} of ${photos.length}…`);
    let img = null;
    try { const src = await loadPhoto(p.id); if (src) img = await toJpeg(src); } catch (err) { console.warn(err); }
    doc.addPage(); y = PAGE.m;
    font(12, true); const cap = doc.splitTextToSize(`Receipt ${done + 1} of ${photos.length}: ${p.caption}`, W); doc.text(cap, PAGE.m, y + 4); y += 15 * cap.length + 2;
    font(9, false, MUTED); doc.text([p.e.date ? fmtDate(p.e.date, { withYear: true }) : '', p.e.time ? fmtTime(p.e.time) : '', categoryLabel(p.e.category), fmtMoney(p.e.amount)].filter(Boolean).join(' · '), PAGE.m, y + 4); y += 18;
    if (img) {
      const maxH = PAGE.h - PAGE.m - 30 - y;
      const k = Math.min(W / img.w, maxH / img.h);
      const w = img.w * k; const h = img.h * k;
      doc.addImage(img.data, 'JPEG', PAGE.m + (W - w) / 2, y, w, h, undefined, 'FAST');
    } else {
      font(10, false, MUTED); doc.text("This photo couldn't be added. It's still saved in the app.", PAGE.m, y + 20);
    }
    done += 1;
  }

  footer();
  doc.setProperties({ title: `${trip.name} expense report`, subject: 'Travel expense report', creator: 'Shopping List App' });
  return doc.output('blob');
}
