// Three made-up business trips for demo mode, so the Expense Report page can be tried with
// real-looking folders. Merchants are real US chains; prices are typical; every confirmation
// number is fictional (they all start with SAMPLE or 000). Nothing here is anyone's real data.
//
// Built in on purpose, to show what the page flags:
// - a duplicate charge (Starbucks at CES, entered twice)
// - an expense dated outside the trip (the CES hotel folio, dated the morning after the show)
// - a missing receipt over $75 (a dinner in Long Beach)
// - personal card and cash payments (no company card)
// - a hotel with one personal night (CES: 5 nights, 4 claimed)
// - an emailed hotel folio still waiting to be checked (the site visit)

const DAY = 864e5;
const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const noonOf = (t) => { const d = new Date(t); d.setHours(12, 0, 0, 0); return d.getTime(); };
const iso = (t) => { const d = new Date(t); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A plain receipt drawn as an SVG, with "SAMPLE" across it so nobody mistakes it for a real one.
export function mockReceipt({ merchant, address = '', date, lines = [], total, footer = 'THANK YOU', ref = '' }) {
  const W = 320; let y = 46;
  const out = [];
  const t = (x, text, size = 13, anchor = 'start', weight = 'normal') => {
    out.push(`<text x='${x}' y='${y}' font-family='Courier New,monospace' font-size='${size}' text-anchor='${anchor}' font-weight='${weight}'>${escXml(text)}</text>`);
  };
  t(W / 2, merchant.toUpperCase(), 17, 'middle', 'bold'); y += 20;
  if (address) { t(W / 2, address, 11, 'middle'); y += 18; }
  t(W / 2, date, 12, 'middle'); y += 14;
  out.push(`<line x1='20' y1='${y}' x2='${W - 20}' y2='${y}' stroke='#999' stroke-dasharray='4 3'/>`); y += 24;
  for (const [label, amt] of lines) {
    t(24, String(label).slice(0, 28), 12); if (amt != null) t(W - 24, Number(amt).toFixed(2), 12, 'end'); y += 19;
  }
  y += 4; out.push(`<line x1='20' y1='${y}' x2='${W - 20}' y2='${y}' stroke='#999' stroke-dasharray='4 3'/>`); y += 24;
  t(24, 'TOTAL', 15, 'start', 'bold'); t(W - 24, `$${Number(total).toFixed(2)}`, 15, 'end', 'bold'); y += 30;
  if (ref) { t(W / 2, ref, 11, 'middle'); y += 18; }
  t(W / 2, footer, 12, 'middle'); y += 30;
  const H = Math.max(y, 420);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><rect width='${W}' height='${H}' fill='#fffdf7'/>`
    + `<text x='${W / 2}' y='${H / 2}' font-family='Arial' font-size='64' font-weight='bold' fill='#d33' fill-opacity='0.12' text-anchor='middle' transform='rotate(-30 ${W / 2} ${H / 2})'>SAMPLE</text>`
    + `${out.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const fmtD = (t) => new Date(t).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

export function buildSampleTrips(nowMs = Date.now()) {
  const trips = {}; const expenses = {}; const images = {};
  let n = 0;
  const add = (tripId, x, receipt) => {
    n += 1;
    const id = `sample-x${n}`;
    const imageIds = [];
    if (receipt) {
      const imgId = `sample-img${n}`;
      images[imgId] = { id: imgId, expenseId: id, createdAt: nowMs, sample: true, dataUrl: mockReceipt({ merchant: x.merchant, date: `${fmtD(x.date)} ${x.time || ''}`.trim(), total: x.amount, ...receipt }) };
      imageIds.push(imgId);
    }
    expenses[id] = { id, tripId, currency: 'USD', paidWith: 'personal', nights: [], notes: '', source: receipt ? 'photo' : 'manual', createdAt: nowMs, sample: true, ...x, imageIds };
  };

  // ---- 1. CES, Las Vegas, Jan 5 to 9, 2027 ----
  const ces = 'sample-trip-ces';
  trips[ces] = {
    id: ces, name: 'CES 2027', location: 'Las Vegas, NV', startDate: at(2027, 1, 5), endDate: at(2027, 1, 9),
    purpose: 'Staff the booth, meet partners and run product demos at CES', project: 'CES 2027 booth', chargeCode: 'SAMPLE-1001',
    mealsMode: 'actual', status: 'open', createdAt: nowMs - 20 * DAY, sample: true,
  };
  add(ces, { category: 'airfare', merchant: 'Southwest Airlines', date: at(2026, 11, 30, 21, 14), time: '21:14', amount: 486.2, summary: 'BWI to LAS round trip',
    notes: 'Round trip BWI to LAS, out Jan 5, back Jan 10. Booked five weeks ahead.' },
  { lines: [['BWI-LAS  Jan 05  WN 1342', 231.6], ['LAS-BWI  Jan 10  WN 2087', 197.4], ['Taxes and fees', 57.2]], ref: 'Confirmation SAMPLE7Q', footer: 'PAID VISA ****0000' });
  add(ces, { category: 'registration', merchant: 'CES Registration', date: at(2026, 11, 16, 10, 2), time: '10:02', amount: 300, summary: 'Industry pass' },
    { lines: [['CES 2027 Industry Pass', 300]], ref: 'Badge 000-SAMPLE-4471', footer: 'CONSUMER TECHNOLOGY ASSOCIATION' });
  add(ces, {
    category: 'lodging', merchant: 'Westgate Las Vegas Resort', date: at(2027, 1, 10, 9, 41), time: '09:41', amount: 1071.85, summary: 'Hotel folio, 5 nights',
    notes: 'Stayed one extra night (Jan 9) for personal business, so 4 of 5 nights are claimed. Folio is dated at checkout on Jan 10.',
    nights: [5, 6, 7, 8, 9].map((d) => ({ date: at(2027, 1, d), amount: 214.37, personal: d === 9 })),
  }, { lines: [['Room 5 nights x 175.00', 875], ['Resort fee 5 x 25.00', 125], ['Room tax 7.185%', 71.85]], ref: 'Folio 000SAMPLE312', footer: 'GUEST FOLIO, CHECKOUT 01/10/2027' });
  add(ces, { category: 'car_rental', merchant: 'Hertz', date: at(2027, 1, 9, 19, 55), time: '19:55', amount: 261.48, summary: 'Midsize, 5 days',
    notes: 'Picked up at LAS Jan 5, returned Jan 9. Took the hotel shuttle to the airport on Jan 10.' },
  { lines: [['Midsize 5 days x 39.99', 199.95], ['Airport concession fee', 22.4], ['Taxes', 39.13]], ref: 'Agreement 000SAMPLE88', footer: 'HERTZ LAS VEGAS AIRPORT' });
  add(ces, { category: 'fuel', merchant: 'Shell', date: at(2027, 1, 9, 18, 20), time: '18:20', amount: 38.62, summary: 'Refuel before return' },
    { lines: [['Unleaded 9.12 gal @ 4.235', 38.62]], footer: 'SHELL, PARADISE RD' });
  add(ces, { category: 'ground', merchant: 'Uber', date: at(2027, 1, 7, 18, 45), time: '18:45', amount: 24.8, summary: 'Ride to the partner dinner',
    notes: 'Left the rental at the hotel; the restaurant had no parking.' },
  { lines: [['Trip fare', 18.3], ['Booking fee', 2.5], ['Tip', 4]], footer: 'UBER TRIP RECEIPT' });
  add(ces, { category: 'dinner', merchant: 'Hash House A Go Go', date: at(2027, 1, 5, 19, 30), time: '19:30', amount: 41.27, summary: 'Dinner after setup' },
    { lines: [['Chicken and waffles', 23.95], ['Iced tea', 4.5], ['Tax', 2.82], ['Tip', 10]] });
  add(ces, { category: 'breakfast', merchant: 'Starbucks', date: at(2027, 1, 6, 7, 18), time: '07:18', amount: 12.45, summary: 'Coffee and sandwich' },
    { lines: [['Grande latte', 5.95], ['Egg bites', 5.65], ['Tax', 0.85]] });
  add(ces, { category: 'breakfast', merchant: 'Starbucks', date: at(2027, 1, 6, 7, 18), time: '07:18', amount: 12.45, notes: 'Typed in from the card alert.' });
  add(ces, { category: 'lunch', merchant: 'LVCC Food Court', date: at(2027, 1, 6, 12, 40), time: '12:40', amount: 23.9, summary: 'Lunch at the show' },
    { lines: [['Chicken bowl', 17.5], ['Water', 4.75], ['Tax', 1.65]] });
  add(ces, { category: 'dinner', merchant: 'Lotus of Siam', date: at(2027, 1, 6, 19, 50), time: '19:50', amount: 186.4, summary: 'Partner dinner for 3',
    notes: 'Dinner with two partner engineers to plan the spring pilot.' },
  { lines: [['Food', 128], ['Drinks (non-alcoholic)', 18], ['Tax', 12.4], ['Tip', 28]], footer: 'PARTY OF 3' });
  add(ces, { category: 'breakfast', merchant: 'Egg Works', date: at(2027, 1, 7, 7, 40), time: '07:40', amount: 19.85, summary: 'Breakfast' },
    { lines: [['Veggie omelet', 13.99], ['Coffee', 2.49], ['Tax', 1.37], ['Tip', 2]] });
  add(ces, { category: 'lunch', merchant: 'Earl of Sandwich', date: at(2027, 1, 7, 12, 15), time: '12:15', amount: 16.72, summary: 'Lunch' },
    { lines: [['Full Montagu', 12.99], ['Chips', 2.49], ['Tax', 1.24]] });
  add(ces, { category: 'breakfast', merchant: 'Starbucks', date: at(2027, 1, 8, 7, 25), time: '07:25', amount: 11.95, summary: 'Coffee and oatmeal' },
    { lines: [['Grande latte', 5.95], ['Oatmeal', 5.15], ['Tax', 0.85]] });
  add(ces, { category: 'dinner', merchant: 'In-N-Out Burger', date: at(2027, 1, 8, 20, 5), time: '20:05', amount: 13.48, summary: 'Dinner' },
    { lines: [['Double-Double combo', 12.45], ['Tax', 1.03]] });

  // ---- 2. EWNA Show, Long Beach, Sep 14 to 17, 2027 ----
  const lb = 'sample-trip-ewna';
  trips[lb] = {
    id: lb, name: 'EWNA Show, September 2027', location: 'Long Beach, CA', startDate: at(2027, 9, 14), endDate: at(2027, 9, 17),
    purpose: 'Staff the booth and give the edge computing talk', project: 'EWNA 2027', chargeCode: 'SAMPLE-2040',
    mealsMode: 'actual', status: 'open', createdAt: nowMs - 2 * DAY, sample: true,
  };
  add(lb, { category: 'airfare', merchant: 'Southwest Airlines', date: at(2027, 7, 20, 13, 5), time: '13:05', amount: 528.4, summary: 'BWI to LGB round trip' },
    { lines: [['BWI-LGB  Sep 14 via DEN', 248.2], ['LGB-BWI  Sep 17 via DEN', 219.6], ['Taxes and fees', 60.6]], ref: 'Confirmation SAMPLE3K', footer: 'PAID VISA ****0000' });
  add(lb, { category: 'supplies', merchant: 'Staples', date: at(2027, 9, 8, 16, 40), time: '16:40', amount: 146.18, summary: 'Brochures and sell sheets',
    notes: '250 tri-fold brochures and 100 sell sheets for the booth.' },
  { lines: [['Tri-fold brochure x250', 98.75], ['Sell sheet x100', 38.5], ['Tax', 8.93]], ref: 'Order 000-SAMPLE-55', footer: 'STAPLES PRINT & MARKETING' });
  add(lb, { category: 'ground', merchant: 'Lyft', date: at(2027, 9, 14, 15, 10), time: '15:10', amount: 18.4, summary: 'Airport to hotel' },
    { lines: [['Ride LGB to hotel', 14.4], ['Tip', 4]] });
  add(lb, { category: 'lodging', merchant: 'Hyatt Regency Long Beach', date: at(2027, 9, 17, 10, 2), time: '10:02', amount: 849.27, summary: 'Hotel folio, 3 nights',
    nights: [14, 15, 16].map((d) => ({ date: at(2027, 9, d), amount: 283.09, personal: false })) },
  { lines: [['Room 3 nights x 249.00', 747], ['Occupancy tax', 89.64], ['Tourism fee', 12.63]], ref: 'Folio 000SAMPLE904', footer: 'GUEST FOLIO, CHECKOUT 09/17/2027' });
  add(lb, { category: 'dinner', merchant: "L'Opera Ristorante", date: at(2027, 9, 14, 19, 45), time: '19:45', amount: 58.3, summary: 'Dinner' },
    { lines: [['Pasta', 32], ['Sparkling water', 6], ['Tax', 3.8], ['Tip', 16.5]] });
  add(lb, { category: 'breakfast', merchant: 'Starbucks', date: at(2027, 9, 15, 7, 10), time: '07:10', amount: 9.85, summary: 'Coffee' },
    { lines: [['Grande latte', 5.95], ['Croissant', 3.25], ['Tax', 0.65]] });
  add(lb, { category: 'lunch', merchant: 'Long Beach Convention Center', date: at(2027, 9, 15, 12, 30), time: '12:30', amount: 17.5, summary: 'Lunch at the show' },
    { lines: [['Turkey wrap', 13.5], ['Iced tea', 4]] });
  add(lb, { category: 'dinner', merchant: "Parker's Lighthouse", date: at(2027, 9, 15, 19, 20), time: '19:20', amount: 81.6,
    notes: 'Lost the receipt. Amount is from the card statement.' });
  add(lb, { category: 'breakfast', merchant: 'Coffee Cup Cafe', date: at(2027, 9, 16, 7, 35), time: '07:35', amount: 16.4, paidWith: 'cash', summary: 'Breakfast' },
    { lines: [['Breakfast burrito', 11.5], ['Coffee', 2.95], ['Tax', 1.95]], footer: 'PAID CASH' });
  add(lb, { category: 'lunch', merchant: 'Chipotle', date: at(2027, 9, 16, 12, 5), time: '12:05', amount: 14.2, summary: 'Lunch' },
    { lines: [['Chicken bowl', 11.25], ['Water', 1.95], ['Tax', 1]] });
  add(lb, { category: 'dinner', merchant: 'Rock Bottom Brewery', date: at(2027, 9, 16, 19, 0), time: '19:00', amount: 44.75, summary: 'Dinner' },
    { lines: [['Burger', 18.5], ['Soda', 3.75], ['Tax', 2.5], ['Tip', 20]] });
  add(lb, { category: 'ground', merchant: 'Lyft', date: at(2027, 9, 17, 11, 30), time: '11:30', amount: 17.95, summary: 'Hotel to airport' },
    { lines: [['Ride hotel to LGB', 13.95], ['Tip', 4]] });
  add(lb, { category: 'parking', merchant: 'BWI Airport Parking', date: at(2027, 9, 17, 22, 40), time: '22:40', amount: 96, summary: 'Daily garage, 4 days' },
    { lines: [['Daily garage 4 x 24.00', 96]], ref: 'Ticket 000SAMPLE19', footer: 'BWI MARSHALL AIRPORT' });

  // ---- 3. Customer site visit, Pittsburgh, driven, ending nine days ago ----
  const end = noonOf(nowMs) - 9 * DAY;
  const day = (i) => end - (2 - i) * DAY; // 0, 1, 2
  const atDay = (i, h, m) => { const d = new Date(day(i)); d.setHours(h, m, 0, 0); return d.getTime(); };
  const pgh = 'sample-trip-pgh';
  trips[pgh] = {
    id: pgh, name: 'Customer site visit, Pittsburgh', location: 'Pittsburgh, PA', startDate: day(0), endDate: day(2),
    purpose: 'Site survey and install planning with a manufacturing customer', project: 'Pittsburgh install', chargeCode: 'SAMPLE-3105',
    mealsMode: 'actual', status: 'open', createdAt: nowMs - 14 * DAY, sample: true,
  };
  add(pgh, { category: 'car_rental', merchant: 'Enterprise', date: atDay(2, 18, 10), time: '18:10', amount: 198.64, summary: 'Rental car, 3 days',
    notes: 'Drove from Baltimore. A rental was cheaper than mileage on my own car for 500 miles.' },
  { lines: [['Standard SUV 3 days x 54.99', 164.97], ['Taxes and fees', 33.67]], ref: 'Agreement 000SAMPLE61', footer: 'ENTERPRISE RENT-A-CAR' });
  add(pgh, { category: 'fuel', merchant: 'Sheetz', date: atDay(0, 10, 25), time: '10:25', amount: 41.28, summary: 'Fuel on the way out' },
    { lines: [['Unleaded 12.4 gal @ 3.329', 41.28]] });
  add(pgh, { category: 'lunch', merchant: 'Sheetz', date: atDay(0, 10, 31), time: '10:31', amount: 9.47, summary: 'Lunch on the road' },
    { lines: [['Turkey sub', 7.49], ['Water', 1.39], ['Tax', 0.59]] });
  add(pgh, { category: 'dinner', merchant: 'Primanti Bros.', date: atDay(0, 19, 10), time: '19:10', amount: 24.35, summary: 'Dinner' },
    { lines: [['Capicola sandwich', 13.99], ['Soda', 2.99], ['Tax', 1.37], ['Tip', 6]] });
  add(pgh, { category: 'parking', merchant: 'Pittsburgh Parking Authority', date: atDay(1, 17, 45), time: '17:45', amount: 28, summary: 'Downtown garage' },
    { lines: [['Garage, 8 hrs', 28]], ref: 'Ticket 000SAMPLE33' });
  add(pgh, { category: 'lunch', merchant: 'Panera Bread', date: atDay(1, 12, 0), time: '12:00', amount: 132.6, summary: 'Working lunch for 8',
    notes: 'Catered lunch for the customer team during the site survey (8 people).' },
  { lines: [['Sandwich catering box x8', 111.92], ['Tax', 7.84], ['Delivery fee', 12.84]], ref: 'Order 000-SAMPLE-207', footer: 'PANERA CATERING' });
  add(pgh, { category: 'dinner', merchant: "Eat'n Park", date: atDay(1, 19, 30), time: '19:30', amount: 27.9, summary: 'Dinner' },
    { lines: [['Club sandwich', 14.99], ['Smiley cookie', 1.99], ['Tax', 1.02], ['Tip', 9.9]] });
  add(pgh, { category: 'breakfast', merchant: "Dunkin'", date: atDay(2, 7, 15), time: '07:15', amount: 8.62, paidWith: 'cash', summary: 'Coffee and bagel' },
    { lines: [['Medium coffee', 3.29], ['Bagel', 4.79], ['Tax', 0.54]], footer: 'PAID CASH' });
  add(pgh, { category: 'parking', merchant: 'PA Turnpike', date: atDay(2, 18, 0), time: '18:00', amount: 34.8, summary: 'Tolls, both ways' },
    { lines: [['Breezewood to Monroeville', 17.4], ['Monroeville to Breezewood', 17.4]], footer: 'TOLL BY PLATE INVOICE' });

  return { trips, expenses, images };
}

// The hotel folio for the site visit arrives by email, to show the inbox step.
export function sampleSiteVisitFolio(nowMs = Date.now()) {
  const end = noonOf(nowMs) - 9 * DAY;
  return {
    email: { id: 'demo-hampton', from: 'Hampton Inn Pittsburgh <folio@example-hotel.com>', subject: 'Your folio from Hampton Inn Pittsburgh Downtown', date: end - 2 * 3600e3, text: '(sample hotel folio)', pdfs: [] },
    read: {
      isReceipt: true, merchant: 'Hampton Inn Pittsburgh Downtown', category: 'lodging', date: iso(end), time: hhmm(10, 5), total: 338.72, currency: 'USD', summary: 'Hotel folio, 2 nights',
      nights: [2, 1].map((k) => ({ date: iso(end - k * DAY), amount: 169.36 })),
    },
  };
}
