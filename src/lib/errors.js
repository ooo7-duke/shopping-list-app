// Plain-words message for a failed read or write, so problems never fail silently.
export function saveErrorMessage(e, action = 'save that') {
  const code = String(e?.code || '').replace(/^firestore\//, '');
  if (code === 'permission-denied') return `Couldn't ${action}: the database refused it. Check that the Firestore rules are published.`;
  if (code === 'unavailable') return `Couldn't ${action}: can't reach the database right now. It will retry when you're back online.`;
  if (code === 'not-found') return `Couldn't ${action}: the Firestore database wasn't found. Check that it was created.`;
  return `Couldn't ${action}${code ? ` (${code})` : ''}. Please try again.`;
}

// Plain-words message for a failed photo read by Gemini (receipts and product photos).
// `what` names the feature, like "Receipt reading" or "Photo reading".
export function aiErrorMessage(e, what = 'Receipt reading') {
  const text = `${e?.code || ''} ${e?.message || ''}`.toLowerCase();
  if (text.includes('api-not-enabled') || text.includes('firebasevertexai') || text.includes('ailogic')) {
    return `${what} isn't turned on yet. In the Firebase console, open AI Services > AI Logic, tap Get started and pick Gemini Developer API. Then try again in a few minutes.`;
  }
  if (text.includes('app check') || text.includes('app-check') || text.includes('appcheck')) {
    return `${what} is blocked by App Check. Add the reCAPTCHA site key in Netlify (see the setup guide), then try again.`;
  }
  if (text.includes('quota') || text.includes('429') || text.includes('resource-exhausted') || text.includes('rate limit')) {
    return `${what} is busy right now. Try again in a minute.`;
  }
  if (text.includes('network') || text.includes('failed to fetch') || text.includes('offline')) {
    return `${what} needs an internet connection. Try again when you're back online.`;
  }
  return `${what} didn't work for that photo. Try a clearer, flatter photo.`;
}
