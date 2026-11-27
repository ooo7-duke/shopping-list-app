// Spam checks for the feedback and deletion forms. Shared by the server function and the tests.

export const KINDS = ['feedback', 'problem', 'idea', 'delete'];
export const MIN_SECONDS = 3; // people take longer than this to fill in a form; bots often don't
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Looks at one submission and says what to do with it.
 * Returns { ok: true, clean } to keep it, { drop: true } to pretend it worked and throw it away
 * (so a bot learns nothing), or { error } to tell a person what to fix.
 */
export function checkSubmission(body, { signedIn = false, now = Date.now() } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  // The hidden "website" box is invisible to people. Anything typed there came from a bot.
  if (String(b.website || '').trim()) return { drop: true };
  const started = Number(b.startedAt);
  if (!signedIn && (!Number.isFinite(started) || now - started < MIN_SECONDS * 1000 || now - started > 24 * 3600e3)) return { drop: true };
  const kind = KINDS.includes(b.kind) ? b.kind : 'feedback';
  const message = String(b.message || '').trim().slice(0, 2000);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  const name = String(b.name || '').trim().slice(0, 80);
  if (kind !== 'delete' && message.length < 5) return { error: 'Please write a little more.' };
  if (!signedIn && !EMAIL.test(email)) return { error: kind === 'delete' ? 'Enter the email of the Google account you sign in with.' : 'Enter an email so we can reply.' };
  // Spam is mostly links. A real note rarely needs more than two.
  if ((message.match(/https?:\/\/|www\./gi) || []).length > 2) return { drop: true };
  return { ok: true, clean: { kind, message, email, name } };
}
