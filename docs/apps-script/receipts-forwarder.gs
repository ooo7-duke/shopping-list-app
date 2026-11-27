// Sends receipts that reach loye10shopping@gmail.com to the shopping list app.
//
// Runs inside the loye10shopping@gmail.com Google account, as a Google Apps Script that its
// owner creates and authorizes. Every 15 minutes it looks at new mail in that inbox, sends
// each message's text (and any PDF receipt) to the app, and adds the label "sent-to-app" so the
// same mail isn't sent again. It never deletes mail, never replies, and never changes whether
// a message is read or unread. Gmail's "confirm forwarding" mail is left alone so its owner
// can read the code.
//
// Setup, once (see docs/EMAIL_RECEIPTS.md for the full steps):
//   1. In script.google.com, signed in as loye10shopping@gmail.com, make a new project and
//      paste this file in.
//   2. Run setUp. Approve the access it asks for. It makes a secret, shows it in the log, and
//      starts the 15-minute timer.
//   3. Copy the secret from the log into Netlify as RECEIPTS_INBOX_SECRET, then redeploy.

const APP_URL = 'https://loye10-shopping-list.netlify.app/.netlify/functions/receipts-inbox';
const LABEL = 'sent-to-app';
const MAX_TEXT = 60000;
const MAX_PDF_BYTES = 1400000; // about 1.4 MB per PDF

function setUp() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('INBOX_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('INBOX_SECRET', secret);
  }
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendReceiptsToApp').timeBased().everyMinutes(15).create();
  if (!GmailApp.getUserLabelByName(LABEL)) GmailApp.createLabel(LABEL);
  Logger.log('Copy this into Netlify as RECEIPTS_INBOX_SECRET: ' + secret);
}

function sendReceiptsToApp() {
  const secret = PropertiesService.getScriptProperties().getProperty('INBOX_SECRET');
  if (!secret) throw new Error('Run setUp first.');
  const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  const threads = GmailApp.search('in:inbox -label:' + LABEL + ' newer_than:30d', 0, 20);
  threads.forEach((thread) => {
    const messages = thread.getMessages()
      .filter((m) => !/forwarding-noreply@google\.com/i.test(m.getFrom()))
      .map(toPayload);
    if (!messages.length) return; // only Gmail's forwarding code: leave it for a person
    const res = UrlFetchApp.fetch(APP_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-inbox-secret': secret },
      payload: JSON.stringify({ messages: messages }),
      muteHttpExceptions: true,
    });
    // Label only once the app has it. If the app can't be reached, the next run tries again.
    if (res.getResponseCode() === 200) thread.addLabel(label);
  });
}

function toPayload(m) {
  const pdfs = m.getAttachments({ includeInlineImages: false })
    .filter((a) => a.getContentType() === 'application/pdf' && a.getSize() <= MAX_PDF_BYTES)
    .slice(0, 2)
    .map((a) => ({ name: a.getName(), data: Utilities.base64Encode(a.getBytes()) }));
  return {
    id: m.getId(),
    from: m.getFrom(),
    forwardedFor: m.getHeader('X-Forwarded-For') || '',
    subject: m.getSubject(),
    date: m.getDate().getTime(),
    text: (m.getPlainBody() || '').slice(0, MAX_TEXT),
    pdfs: pdfs,
  };
}
