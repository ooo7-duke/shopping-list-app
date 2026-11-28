// Travel expense reports: one folder per trip, private to the person who made it.
// Pure rules here (categories, per diem, flags, totals, CSV, matching emails to a trip),
// so the page stays thin and the tests can check the arithmetic.
import { DEMO_MODE } from './config.js';
import { generateJSON } from './ai.js';
import { fmtMoney } from './format.js';

export const EXPENSE_CATEGORIES = [
  { id: 'airfare', label: 'Airfare', group: 'Travel' },
  { id: 'lodging', label: 'Lodging', group: 'Lodging' },
  { id: 'car_rental', label: 'Car rental', group: 'Travel' },
  { id: 'ground', label: 'Taxi or rideshare', group: 'Travel' },
  { id: 'fuel', label: 'Fuel', group: 'Travel' },
  { id: 'parking', label: 'Parking and tolls', group: 'Travel' },
  { id: 'breakfast', label: 'Breakfast', group: 'Meals', meal: true },
  { id: 'lunch', label: 'Lunch', group: 'Meals', meal: true },
  { id: 'dinner', label: 'Dinner', group: 'Meals', meal: true },
  { id: 'supplies', label: 'Supplies and printing', group: 'Supplies' },
  { id: 'registration', label: 'Registration and fees', group: 'Fees' },
  { id: 'other', label: 'Other', group: 'Other' },
];
const BY_ID = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.id, c]));
export const categoryLabel = (id) => BY_ID[id]?.label || 'Other';
export const isMeal = (id) => !!BY_ID[id]?.meal;

// Bought ahead of the trip as a matter of course, so a date before the trip is no surprise.
const BOOKED_AHEAD = new Set(['airfare', 'registration', 'supplies']);

// IRS rules (Treas. Reg. 1.274-5) want a receipt for every lodging charge and for any other
// expense of $75 or more. Many employers want one for everything.
export const RECEIPT_THRESHOLD = 75;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fromDayKey(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

// Every calendar day of the trip, first to last.
export function tripDays(trip) {
  if (!trip?.startDate || !trip?.endDate) return [];
  const out = [];
  let t = fromDayKey(dayKey(trip.startDate));
  const end = fromDayKey(dayKey(trip.endDate));
  for (let i = 0; t <= end && i < 120; i++) {
    out.push(dayKey(t));
    t = fromDayKey(dayKey(t + 864e5 + 3600e3)); // safe across daylight saving changes
  }
  return out;
}

// GSA's breakdown of each daily M&IE rate into meals and incidentals (gsa.gov/mie), used to
// take off a meal the event provided. Other rates get no meal deduction.
export const GSA_MIE = {
  68: { breakfast: 16, lunch: 19, dinner: 28, incidentals: 5 },
  74: { breakfast: 18, lunch: 20, dinner: 31, incidentals: 5 },
  80: { breakfast: 20, lunch: 22, dinner: 33, incidentals: 5 },
  86: { breakfast: 22, lunch: 23, dinner: 36, incidentals: 5 },
  92: { breakfast: 23, lunch: 26, dinner: 38, incidentals: 5 },
};

// Per diem for meals and incidentals: the daily rate, 75% on the first and last day of
// travel (federal travel rules), less any meal the event or hotel provided.
export function perDiemDays(trip) {
  const rate = Number(trip?.mieRate) || 0;
  const days = tripDays(trip);
  if (!rate || !days.length) return [];
  const parts = GSA_MIE[rate];
  return days.map((day, i) => {
    const edge = i === 0 || i === days.length - 1;
    const base = edge ? rate * 0.75 : rate;
    const provided = (trip.mealsProvided?.[day] || []).filter((m) => parts?.[m]);
    const deduction = provided.reduce((s, m) => s + parts[m], 0);
    return { day, edge, base: round2(base), provided, deduction, amount: round2(Math.max(0, base - deduction)) };
  });
}

// The part of an expense claimed for the business. Lodging split by night counts the nights
// not marked personal; otherwise it's the amount entered, or the whole charge.
export function businessAmount(e) {
  if (Array.isArray(e?.nights) && e.nights.length) {
    return round2(e.nights.filter((n) => !n.personal).reduce((s, n) => s + (Number(n.amount) || 0), 0));
  }
  if (e?.business != null && e.business !== '') return round2(Math.min(Number(e.business), Number(e.amount) || 0));
  return round2(e?.amount);
}

export const hasReceipt = (e) => (e?.imageIds?.length || 0) > 0 || !!e?.emailId;

export function expenseFlags(e, all = [], trip = null) {
  const flags = [];
  const perDiemMeal = trip?.mealsMode === 'perDiem' && isMeal(e.category);
  if (!hasReceipt(e) && !perDiemMeal) {
    const required = e.category === 'lodging' || (Number(e.amount) || 0) >= RECEIPT_THRESHOLD;
    flags.push(required
      ? { code: 'receipt', level: 'warn', label: 'Needs a receipt' }
      : { code: 'receipt', level: 'info', label: 'No receipt' });
  }
  if (e.amount != null && all.some((o) => o.id !== e.id && o.date && e.date && dayKey(o.date) === dayKey(e.date)
    && Math.abs((Number(o.amount) || 0) - (Number(e.amount) || 0)) < 0.01 && norm(o.merchant) && norm(o.merchant) === norm(e.merchant))) {
    flags.push({ code: 'duplicate', level: 'warn', label: 'Possible duplicate' });
  }
  if (trip?.startDate && trip?.endDate && e.date) {
    const d = dayKey(e.date);
    const before = d < dayKey(trip.startDate);
    const after = d > dayKey(trip.endDate);
    if ((before && !BOOKED_AHEAD.has(e.category)) || after) {
      flags.push({ code: 'dates', level: 'warn', label: before ? 'Before the trip' : 'After the trip' });
    }
  }
  if (perDiemMeal) flags.push({ code: 'perdiem', level: 'info', label: 'Covered by per diem' });
  if (e.amount == null || e.amount === '') flags.push({ code: 'amount', level: 'warn', label: 'No amount' });
  return flags;
}

// How an expense was paid. There is no company card, so everything claimed is owed to you;
// this only helps match a receipt to a card statement. Older entries saved as 'corporate'
// read as Other.
export const PAID_WITH = [
  { id: 'personal', label: 'Personal card' },
  { id: 'cash', label: 'Cash' },
  { id: 'other', label: 'Other' },
];
export const paidWithId = (v) => (PAID_WITH.some((p) => p.id === v) ? v : v ? 'other' : 'personal');
export const paidWithLabel = (v) => PAID_WITH.find((p) => p.id === paidWithId(v)).label;

// Totals for the report. "Owed to you" is the business part of every expense, plus any per diem.
export function tripTotals(trip, expenses) {
  const perDiem = trip?.mealsMode === 'perDiem' ? perDiemDays(trip) : [];
  const perDiemTotal = round2(perDiem.reduce((s, d) => s + d.amount, 0));
  const cats = {};
  let spent = 0; let business = 0;
  for (const e of expenses) {
    const amt = round2(e.amount);
    const biz = trip?.mealsMode === 'perDiem' && isMeal(e.category) ? 0 : businessAmount(e);
    spent += amt;
    business += biz;
    const c = (cats[e.category || 'other'] ||= { id: e.category || 'other', label: categoryLabel(e.category), spent: 0, business: 0, count: 0 });
    c.spent += amt; c.business += biz; c.count++;
  }
  const byCategory = EXPENSE_CATEGORIES.filter((c) => cats[c.id]).map((c) => ({ ...cats[c.id], spent: round2(cats[c.id].spent), business: round2(cats[c.id].business) }));
  return {
    spent: round2(spent), business: round2(business), personal: round2(spent - business),
    perDiem: perDiemTotal, perDiemDays: perDiem,
    owedToYou: round2(business + perDiemTotal), byCategory,
  };
}

export function sortExpenses(list) {
  return [...list].sort((a, b) => (a.date || 0) - (b.date || 0) || String(a.time || '').localeCompare(String(b.time || '')) || (a.createdAt || 0) - (b.createdAt || 0));
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // A leading = + - @ makes a spreadsheet run the cell as a formula, so quote it as text.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const usDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '');

export function expensesCSV(trip, expenses) {
  const rows = [
    ['Trip', trip.name], ['Location', trip.location], ['Dates', `${usDate(trip.startDate)} to ${usDate(trip.endDate)}`],
    ['Purpose', trip.purpose || ''], ['Employer', trip.employer || ''], ['Project', trip.project || ''], ['Charge code', trip.chargeCode || ''],
    ['Meals', trip.mealsMode === 'perDiem' ? `Per diem, $${trip.mieRate || 0} a day` : 'Actual cost'],
    [],
    ['Date', 'Time', 'Category', 'Merchant', 'Amount (USD)', 'Original amount', 'Paid with', 'Business (claimed)', 'Personal', 'Receipt', 'Flags', 'Notes'],
  ];
  for (const e of sortExpenses(expenses)) {
    const biz = trip.mealsMode === 'perDiem' && isMeal(e.category) ? 0 : businessAmount(e);
    rows.push([
      usDate(e.date), e.time || '', categoryLabel(e.category), e.merchant || '', round2(e.amount).toFixed(2),
      e.originalCurrency && e.originalCurrency !== 'USD' ? `${e.originalAmount ?? ''} ${e.originalCurrency}` : '',
      paidWithLabel(e.paidWith), biz.toFixed(2), round2((Number(e.amount) || 0) - biz).toFixed(2),
      hasReceipt(e) ? 'Yes' : 'No', expenseFlags(e, expenses, trip).filter((f) => f.code !== 'perdiem').map((f) => f.label).join('; '), e.notes || '',
    ]);
  }
  const t = tripTotals(trip, expenses);
  if (t.perDiemDays.length) {
    rows.push([], ['Per diem day', 'Rate', 'Meals provided', 'Amount']);
    for (const d of t.perDiemDays) rows.push([usDate(fromDayKey(d.day)), d.base.toFixed(2), d.provided.join(' ') || '', d.amount.toFixed(2)]);
  }
  rows.push([], ['Total spent', t.spent.toFixed(2)], ['Business (claimed)', t.business.toFixed(2)], ['Personal', t.personal.toFixed(2)],
    ['Per diem', t.perDiem.toFixed(2)], ['Owed to you', t.owedToYou.toFixed(2)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Which trip an emailed receipt most likely belongs to, weighing the trip's dates, its place
// and what was bought together. It only suggests: the person still includes or excludes each one.
//   Same merchant as an expense already on the trip: from 60 days before to 3 days after.
//   During the trip (a day either side): travel, meals and rides, or anything naming the trip's city.
//   Before the trip: travel naming the trip's city or show up to 90 days ahead; other travel up to
//     3 weeks ahead; show or work gear (networking, cables, displays, printing) up to 2 weeks ahead.
//   After the trip: only a final hotel or travel bill naming the city or show, within a week.
//     Anything bought more than a week after the trip ended is left alone.
const TRAVEL = /\b(flights?|airlines?|airways|airfare|itinerary|boarding pass|e-?ticket|folio|hotels?|resort|suites|inn|lodging|marriott|hilton|hyatt|ihg|holiday inn|hampton|courtyard|westin|sheraton|wyndham|best western|caesars|mgm|airbnb|vrbo|expedia|booking\.com|hotels\.com|delta|united|american airlines|southwest|alaska airlines|jetblue|spirit|frontier|hertz|avis|enterprise rent|national car|alamo|sixt|uber|lyft|taxi|parking|toll|amtrak|rental car|car rental|registration|badge|exhibitor|conference|expo|summit)\b/i;
const ON_TRIP = /\b(receipt|restaurant|grill|cafe|coffee|bistro|kitchen|bar|starbucks|toast|square|doordash|grubhub|gratuity|tip|meal|dinner|lunch|breakfast)\b/i;
const GEAR = /\b(network(ing)?|router|switch(es)?|ethernet|cat ?6a?|cables?|adapters?|chargers?|power strip|extension cord|surge|monitors?|displays?|tv|projector|hdmi|usb-?c|wi-?fi|hotspot|e?sim|banners?|booth|backdrop|tablecloth|signage|brochures?|flyers?|business cards|printing|prints|lanyards?|badge holders?|shipping|freight|crates?|staples|fedex office|ups store|vistaprint|micro ?center|best buy|b&h|newegg|cdw)\b/i;
const DAY = 864e5;
const days = (n) => Math.max(1, Math.round(n / DAY));
const ago = (n) => (n >= 14 ? `${Math.round(n / 7)} weeks` : `${n} day${n === 1 ? '' : 's'}`);

// The trip's city (the first part of its location) and a short show name like "CES".
function tripPlaces(t) {
  const city = String(t.location || '').split(',')[0].trim();
  const show = (String(t.name || '').match(/\b[A-Z][A-Z0-9&]{1,7}\b/) || [])[0] || '';
  const first = city.split(/\s+/)[0]; // "Frankfurt" for "Frankfurt am Main"
  return [city.length >= 3 ? city : '', first !== city && first.length >= 5 ? first : '', show].filter(Boolean);
}
const names = (text, place) => new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i').test(text);

export function matchTrip(m, trips = [], expenses = []) {
  const at = m?.date || m?.receivedAt;
  if (!at) return null;
  const hay = `${m?.from || ''} ${m?.subject || ''} ${String(m?.text || '').slice(0, 4000)}`;
  const head = `${m?.from || ''} ${m?.subject || ''}`;
  let best = null;
  for (const t of trips) {
    if (!t.startDate || !t.endDate || t.status === 'submitted') continue;
    const before = t.startDate - at; // > 0: sent before the trip began
    const after = at - t.endDate; // > 0: sent after it ended
    if (after > 7 * DAY || before > 90 * DAY) continue;
    const place = tripPlaces(t).find((p) => names(hay, p));
    const travel = TRAVEL.test(hay);
    const known = expenses.some((e) => e.tripId === t.id && norm(e.merchant).length > 3 && norm(head).includes(norm(e.merchant)));
    let score = 0;
    let why = '';
    if (known && before <= 60 * DAY && after <= 3 * DAY) { score = 5; why = 'Same merchant as an expense already on this trip'; }
    else if (before <= DAY && after <= DAY) {
      if (place || travel || ON_TRIP.test(head)) { score = 4; why = place ? `Names ${place}, dated during the trip` : 'Dated during the trip'; }
    } else if (before > DAY) {
      const lead = ago(days(before));
      if (place && travel) { score = 4; why = `Travel naming ${place}, ${lead} before the trip`; }
      else if (place && before <= 60 * DAY) { score = 3; why = `Names ${place}, ${lead} before the trip`; }
      else if (GEAR.test(hay) && before <= 14 * DAY) { score = 3; why = `Work or show gear, ${lead} before the trip`; }
      else if (travel && before <= 21 * DAY) { score = 2; why = `Travel booked ${lead} before the trip`; }
    } else if (travel && (place || /\bfolio\b/i.test(hay))) {
      score = 3; why = `Sent ${ago(days(after))} after the trip, likely a final bill`;
    }
    if (!score) continue;
    const gap = Math.max(0, before, after);
    if (!best || score > best.score || (score === best.score && gap < best.gap)) best = { trip: t, why, score, gap };
  }
  return best && { trip: best.trip, why: best.why };
}

export function emailTrip(m, trips = [], expenses = []) {
  return matchTrip(m, trips, expenses)?.trip || null;
}

// Emails someone said aren't travel, kept on this device so they go back to the Receipts page.
const NOT_TRAVEL = 'sla-not-travel';
export function notTravelIds() {
  try { return JSON.parse(localStorage.getItem(NOT_TRAVEL) || '[]'); } catch { return []; }
}
export function markNotTravel(id) {
  try { localStorage.setItem(NOT_TRAVEL, JSON.stringify([...new Set([...notTravelIds(), id])].slice(-200))); } catch { /* storage blocked */ }
}

// Reading a receipt photo or email with Gemini. It only fills the form; nothing is saved
// until the person checks it and taps Save.
const PROMPT = `You read receipts for a business travel expense report.
Return:
- isReceipt: true if this shows a purchase or charge, false otherwise
- merchant: the business that was paid (airline, hotel, restaurant, store)
- category: exactly one of ${EXPENSE_CATEGORIES.map((c) => c.id).join(', ')}. For a meal pick breakfast, lunch or dinner from the time (before 10:30 am breakfast, before 4 pm lunch, else dinner).
- date: the date of the charge (YYYY-MM-DD). For a hotel folio use the check-out date.
- time: the time of the charge in 24-hour HH:MM, or empty
- total: the total charged, including tax and tip
- currency: ISO code such as USD
- tip: the tip, if shown
- last4: the last 4 digits of the card, if shown
- nights: for a hotel folio only, one entry per night with date (YYYY-MM-DD) and amount (room rate plus that night's taxes and fees)
- summary: a few words on what was bought`;

async function schema() {
  const { Schema } = await import('firebase/ai');
  return Schema.object({
    properties: {
      isReceipt: Schema.boolean(), merchant: Schema.string(), category: Schema.string(), date: Schema.string(), time: Schema.string(),
      total: Schema.number(), currency: Schema.string(), tip: Schema.number(), last4: Schema.string(), summary: Schema.string(),
      nights: Schema.array({ items: Schema.object({ properties: { date: Schema.string(), amount: Schema.number() } }) }),
    },
    optionalProperties: ['merchant', 'category', 'date', 'time', 'total', 'currency', 'tip', 'last4', 'summary', 'nights'],
  });
}

export async function extractExpense(dataUrl, app) {
  if (DEMO_MODE) return demoRead('photo');
  const parsed = await generateJSON(app, { schema: await schema(), temperature: 0.1 }, [PROMPT, { inlineData: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] } }]);
  return normalizeRead(parsed);
}

export async function extractExpenseText({ subject = '', text = '', pdfs = [], id = '' }, app) {
  if (DEMO_MODE) return demoRead(id);
  const parts = [PROMPT, `EMAIL SUBJECT: ${subject}\n\nEMAIL TEXT:\n${String(text).slice(0, 40000)}`];
  for (const p of pdfs.slice(0, 2)) parts.push({ inlineData: { mimeType: 'application/pdf', data: p.data } });
  return normalizeRead(await generateJSON(app, { schema: await schema(), temperature: 0.1 }, parts));
}

const isoDay = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? fromDayKey(String(s).slice(0, 10)) : null);

// Turns the AI's answer into form values. A charge in another currency leaves the dollar
// amount blank, because only the card statement knows the rate that was used.
export function normalizeRead(r = {}) {
  const currency = String(r.currency || 'USD').toUpperCase().slice(0, 3);
  const foreign = currency !== 'USD';
  const time = /^\d{1,2}:\d{2}/.test(String(r.time || '')) ? String(r.time).slice(0, 5).padStart(5, '0') : '';
  const nights = (r.nights || []).map((n) => ({ date: isoDay(n.date), amount: round2(n.amount), personal: false })).filter((n) => n.date && n.amount > 0);
  return {
    isReceipt: r.isReceipt !== false,
    merchant: String(r.merchant || '').slice(0, 120),
    category: BY_ID[r.category] ? r.category : 'other',
    date: isoDay(r.date),
    time,
    amount: foreign || r.total == null ? null : round2(r.total),
    originalAmount: foreign && r.total != null ? round2(r.total) : null,
    originalCurrency: foreign ? currency : '',
    nights: r.category === 'lodging' ? nights : [],
    summary: String(r.summary || '').trim().slice(0, 80),
    notes: [r.summary, r.tip ? `Tip ${round2(r.tip).toFixed(2)}` : '', r.last4 ? `Card ending ${String(r.last4).slice(-4)}` : ''].filter(Boolean).join('. '),
  };
}

function demoRead(kind) {
  const now = Date.now();
  const samples = {
    photo: { isReceipt: true, merchant: 'Lotus of Siam', category: 'dinner', date: dayKey(now), time: '19:42', total: 64.18, currency: 'USD', tip: 10.7, summary: 'Dinner with the booth team' },
  };
  return new Promise((res) => setTimeout(() => res(normalizeRead(samples[kind] || samples.photo)), 700));
}

// A caption for a receipt photo, built from what was read off it: who, what, how much.
// "Wynn Las Vegas, 5 nights (4 claimed), $1,146.40". A caption the person typed wins.
export function autoCaption(e, index = 0, count = 1) {
  const who = e.merchant || categoryLabel(e.category);
  let what = '';
  const nights = (e.nights || []).length;
  if (nights) {
    const claimed = e.nights.filter((n) => !n.personal).length;
    what = `${nights} night${nights === 1 ? '' : 's'}${claimed < nights ? ` (${claimed} claimed)` : ''}`;
  } else {
    const firstNote = String(e.notes || '').split(/[.;]\s/)[0].trim();
    what = e.summary || (firstNote && firstNote.length <= 48 ? firstNote : '') || categoryLabel(e.category);
  }
  if (what.toLowerCase() === who.toLowerCase()) what = '';
  const parts = [who, what, e.amount != null && e.amount !== '' ? fmtMoney(e.amount) : ''];
  if (count > 1) parts.push(`page ${index + 1} of ${count}`);
  return parts.filter(Boolean).join(', ');
}

export const captionFor = (e, id) => {
  const ids = e.imageIds || [];
  return (e.captions && e.captions[id]) || autoCaption(e, Math.max(0, ids.indexOf(id)), ids.length);
};

// Every receipt photo in a trip, oldest first, for the gallery and the PDF.
export function tripPhotos(expenses) {
  return sortExpenses(expenses).flatMap((e) => (e.imageIds || []).map((id) => ({ id, e, caption: captionFor(e, id) })));
}

// The sheets of the Excel workbook: a summary, the expenses with live totals, and the per diem.
export function expenseWorkbook(trip, expenses) {
  const t = tripTotals(trip, expenses);
  const list = sortExpenses(expenses);
  const S = (v) => ({ v: v ?? '' });
  const B = (v) => ({ v, s: 'bold' });
  const M = (v, s = 'money') => ({ v: round2(v), s });
  const D = (ms) => (ms ? { v: new Date(ms), s: 'date' } : S(''));
  const rows = [];
  const first = 2; const last = list.length + 1;
  rows.push(['Date', 'Time', 'Category', 'Merchant', 'Receipt caption', 'Amount (USD)', 'Claimed', 'Personal', 'Paid with', 'Receipt', 'Flags', 'Notes'].map(B));
  for (const e of list) {
    const biz = trip.mealsMode === 'perDiem' && isMeal(e.category) ? 0 : businessAmount(e);
    const amt = round2(e.amount);
    const photos = (e.imageIds || []).length;
    rows.push([
      D(e.date), S(e.time || ''), S(categoryLabel(e.category)), S(e.merchant || ''),
      S(photos ? captionFor(e, e.imageIds[0]) : ''), M(amt), M(biz), M(amt - biz),
      S(paidWithLabel(e.paidWith)), S(photos ? 'Photo' : e.emailId ? 'Emailed' : 'Missing'),
      S(expenseFlags(e, expenses, trip).filter((f) => f.code !== 'perdiem').map((f) => f.label).join('; ')), S(e.notes || ''),
    ]);
  }
  const sum = (col, v) => ({ f: list.length ? `SUM(${col}${first}:${col}${last})` : '0', v: round2(v), s: 'moneyBold' });
  rows.push([B('Total'), S(''), S(''), S(''), S(''), sum('F', t.spent), sum('G', t.business), sum('H', t.personal)]);

  const summary = [
    [{ v: `Expense report: ${trip.name}`, s: 'title' }], [],
    [B('Location'), S(trip.location)], [B('Start'), D(trip.startDate)], [B('End'), D(trip.endDate)],
    [B('Purpose'), S(trip.purpose)], [B('Employer'), S(trip.employer)], [B('Project'), S(trip.project)], [B('Charge code'), S(trip.chargeCode)],
    [B('Meals'), S(trip.mealsMode === 'perDiem' ? `Per diem, $${trip.mieRate || 0} a day` : 'Actual cost, with receipts')], [],
    ['Category', 'Spent', 'Claimed'].map(B),
    ...t.byCategory.map((c) => [S(c.label), M(c.spent), M(c.business)]),
  ];
  if (t.perDiem > 0) summary.push([S('Meals per diem'), S(''), M(t.perDiem)]);
  summary.push([B('Total'), M(t.spent, 'moneyBold'), M(t.business + t.perDiem, 'moneyBold')], [],
    [S('Personal, not claimed'), S(''), M(t.personal)],
    [B('Owed to you'), S(''), M(t.owedToYou, 'moneyBold')]);

  const sheets = [
    { name: 'Summary', rows: summary, widths: [26, 16, 16] },
    { name: 'Expenses', rows, widths: [12, 9, 20, 24, 40, 14, 12, 12, 14, 10, 30, 50], filter: true, freeze: true },
  ];
  if (t.perDiemDays.length) {
    sheets.push({ name: 'Per diem', widths: [14, 12, 24, 12], rows: [
      ['Day', 'Rate', 'Meals provided', 'Amount'].map(B),
      ...t.perDiemDays.map((d) => [D(fromDayKey(d.day)), M(d.base), S(d.provided.join(', ')), M(d.amount)]),
    ] });
  }
  return sheets;
}
