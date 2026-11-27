// Checks a Firebase sign-in sent as "Authorization: Bearer <ID token>".
// Returns { uid, email } for a valid sign-in, or null. Shared by the server functions.
export async function signedIn(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!token || !apiKey) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }),
  });
  if (!r.ok) return null;
  const u = (await r.json().catch(() => ({})))?.users?.[0];
  return u ? { uid: u.localId, email: (u.email || '').toLowerCase(), name: u.displayName || '' } : null;
}
