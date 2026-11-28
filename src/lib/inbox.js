// Emailed receipts: rules shared by the server function (netlify/functions/receipts-inbox.mjs),
// the app and the tests.
//
// Receipts reach the app's own Gmail inbox (loye10shopping@gmail.com) two ways:
//  - forwarded by hand: the From line is the person who forwarded it.
//  - forwarded by a Gmail filter: the From line stays the store, and Gmail adds an
//    X-Forwarded-For header that starts with the forwarding person's address.
// Either way the forwarder's address decides whose list the receipt belongs to. Mail is only
// ever shown to a signed-in member whose Google address matches it.
import { bestMatch } from './match.js';
import { foldCategory, HOUSEHOLD_CATEGORIES } from './categories.js';

export const INBOX_ADDRESS = 'loye10shopping@gmail.com';

export function emailOf(s) {
  const m = String(s || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : '';
}

// Whose receipt this is. X-Forwarded-For reads "forwarder@x.com loye10shopping@gmail.com".
export function forwarderOf(from, forwardedFor) {
  const fwd = String(forwardedFor || '').split(/[\s,]+/).map(emailOf).find((e) => e && e !== INBOX_ADDRESS);
  return fwd || emailOf(from);
}

// Gmail's "confirm this forwarding address" mail must stay in the inbox for a person to read.
export const isForwardingConfirmation = (from) => /forwarding-noreply@google\.com/i.test(String(from || ''));

// A safe key part for an email address or message id.
export const keyPart = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9@._+-]/g, '').slice(0, 120);

// Whether an email could be a receipt, judged from its words alone, before any AI read. When
// a person forwards all their mail, most of it isn't receipts: mail that fails this is never
// stored by the server, never sent to the AI reader and never shown in the list. It leans
// toward yes, so a receipt is rarely set aside; the AI reader then makes the real call.
const RECEIPT_WORDS = /\b(receipts?|invoices?|orders?|ordered|purchases?|purchased|payments?|paid|charged?|transactions?|totals?|subtotal|amount due|bill|billed|billing|folio|itinerar(?:y|ies)|e-?tickets?|tickets?|boarding pass|flights?|hotels?|booking|booked|reservations?|confirmations?|confirmed|refund(?:ed)?|rentals?|subscriptions?|renewal|renewed|shipped|delivered|checkout)\b/i;
const MONEY = /(?:US\$|C\$|\$|USD|€|£|EUR|GBP|PLN|zł|CAD)\s?\d|\d[\d,]*\.\d{2}\s?(?:USD|EUR|GBP|PLN|zł|CAD)\b/i;
export function looksLikeReceipt(m) {
  if (Array.isArray(m?.pdfs) && m.pdfs.length) return true;
  if (RECEIPT_WORDS.test(String(m?.subject || ''))) return true;
  const text = String(m?.text || '').slice(0, 20000);
  return RECEIPT_WORDS.test(text) && MONEY.test(text);
}

// Splits a read receipt into lines that can be saved straight away and lines a person should
// check. A strong match (the AI named a list item exactly, or the names agree closely) is safe
// to check off; a weaker guess is held for the person to confirm. Lines that match nothing
// become new items in the household's inventory.
export const STRONG = 0.85;
export function planLines(res, items, cats = HOUSEHOLD_CATEGORIES) {
  const lines = (res?.items || []).map((ln) => {
    const m = bestMatch(ln, items);
    const category = foldCategory(ln.category, cats);
    const weak = !!m.item && m.score < STRONG;
    return { ...ln, category, itemId: m.item?.id || '', newName: ln.name, skip: false, weak, score: m.score };
  });
  return { lines, weak: lines.filter((l) => l.weak).length, matched: lines.filter((l) => l.itemId && !l.weak).length };
}

// Whether a read email is already saved: same email, or the same store order number.
export function alreadySaved(receipts, { emailId, orderId, store }) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (receipts || []).some((r) =>
    (emailId && r.emailId === emailId) ||
    (orderId && r.orderId && norm(r.orderId) === norm(orderId) && norm(r.store) === norm(store)));
}
