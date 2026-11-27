// Plain-words message for a failed read or write, so problems never fail silently.
export function saveErrorMessage(e, action = 'save that') {
  const code = String(e?.code || '').replace(/^firestore\//, '');
  if (code === 'permission-denied') return `Couldn't ${action}: the database refused it. Check that the Firestore rules are published.`;
  if (code === 'unavailable') return `Couldn't ${action}: can't reach the database right now. It will retry when you're back online.`;
  if (code === 'not-found') return `Couldn't ${action}: the Firestore database wasn't found. Check that it was created.`;
  return `Couldn't ${action}${code ? ` (${code})` : ''}. Please try again.`;
}
