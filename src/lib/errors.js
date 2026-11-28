// Plain-words message for a failed read or write, so problems never fail silently.
export function saveErrorMessage(e, action = 'save that') {
  const code = String(e?.code || '').replace(/^firestore\//, '');
  if (code === 'permission-denied') return `Couldn't ${action}: the database refused it. Check that the Firestore rules are published.`;
  if (code === 'unavailable') return `Couldn't ${action}: can't reach the database right now. It will retry when you're back online.`;
  if (code === 'not-found') return `Couldn't ${action}: the Firestore database wasn't found. Check that it was created.`;
  return `Couldn't ${action}${code ? ` (${code})` : ''}. Please try again.`;
}

// The server's own reason for a failed AI call, in a few words: the HTTP status and the
// message, without the long request address. Shown under the plain message so the real
// cause is visible on the phone instead of a guess.
export function aiErrorDetail(e) {
  const status = e?.customErrorData?.status;
  let msg = String(e?.message || '')
    .replace(/^AI:\s*/i, '')
    .replace(/\s*\((ai|vertexAI)\/[\w-]+\)\s*$/i, '')
    .replace(/Error fetching from \S+:\s+/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[(\d{3})[^\]]*\]\s*/, '')
    .replace(/\s*\[\{.*$/, '') // drop the raw JSON details
    .replace(/\s+/g, ' ')
    .trim();
  if (msg.length > 140) msg = `${msg.slice(0, 137)}...`;
  const code = e?.code && !['fetch-error', 'error'].includes(e.code) ? e.code : '';
  return [status, code, msg].filter(Boolean).join(': ');
}

// Plain-words message for a failed photo read by Gemini (receipts and product photos).
// `what` names the feature, like "Receipt reading" or "Photo reading". It goes by the error
// code and the HTTP status, not by the request address, which every AI error contains.
export function aiErrorMessage(e, what = 'Receipt reading') {
  const code = String(e?.code || '').replace(/^(ai|vertexAI)\//, '');
  const status = Number(e?.customErrorData?.status) || Number((String(e?.message || '').match(/\[(\d{3})\b/) || [])[1]) || 0;
  const text = String(e?.message || '').toLowerCase();
  const detail = aiErrorDetail(e);
  const why = detail ? ` (Details: ${detail})` : '';

  if (code === 'api-not-enabled' || (status === 403 && text.includes('service_disabled'))) {
    return `${what} isn't turned on yet. In the Firebase console, open AI Services > AI Logic, tap Get started and pick Gemini Developer API. Then try again in a few minutes.${why}`;
  }
  if (text.includes('app check') || text.includes('app-check') || text.includes('appcheck') || status === 401) {
    return `${what} was refused by App Check, so Firebase didn't trust this copy of the app. Check that the Fraud Defense key allows this site's address and matches the key in Netlify.${why}`;
  }
  if (status === 429 || code === 'resource-exhausted' || text.includes('quota') || text.includes('rate limit')) {
    return `${what} is busy right now or hit today's free limit. Try again in a minute.${why}`;
  }
  if (status === 403) {
    return `${what} was refused by Google (permission denied).${why}`;
  }
  if (status === 404) {
    return `${what} couldn't find the AI model it uses.${why}`;
  }
  if (status >= 500) {
    return `${what} hit a problem on Google's side. Try again in a minute.${why}`;
  }
  if (!status && (text.includes('failed to fetch') || text.includes('network') || text.includes('offline') || code === 'fetch-error')) {
    return `${what} needs an internet connection. Try again when you're back online.${why}`;
  }
  if (status === 400) {
    return `${what} couldn't use that photo. Try a clearer, flatter photo.${why}`;
  }
  return `${what} didn't work for that photo. Try a clearer, flatter photo.${why}`;
}
