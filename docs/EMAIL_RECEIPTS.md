# Emailed receipts

Receipts forwarded to **loye10shopping@gmail.com** show up on the Receipts tab. The app reads
each one, sorts every item into the list's categories, checks off items that clearly match the
list, and asks before it counts a weaker guess as bought.

## How it works

1. A Google Apps Script inside loye10shopping@gmail.com (`docs/apps-script/receipts-forwarder.gs`)
   runs every 15 minutes. It sends each new inbox message to the app and labels it
   `sent-to-app`. It never deletes mail and never changes read or unread.
2. The Netlify function `receipts-inbox` keeps each message under the address of the person who
   forwarded it. Only a signed-in member with that Google address can see it. Mail from anyone
   else is never shown and is removed after 30 days.
3. When that person opens the Receipts tab, the app reads the email with Gemini, saves the
   purchases, and tells the server it's done, so the same email is never used twice. An order
   number already saved (for example a second email about the same order) is skipped.

Matching uses item names only. No product codes are stored.

## Setup (done by the owner of loye10shopping@gmail.com)

1. Sign in to Google as loye10shopping@gmail.com and open https://script.google.com.
2. New project. Replace the sample code with `receipts-forwarder.gs` and save.
3. Pick `setUp` in the toolbar and press Run. Approve the access it asks for. Google shows
   "Google hasn't verified this app" because the script is your own: choose Advanced, then
   go to the project. The log then shows a secret.
4. In Netlify (Site configuration > Environment variables), add `RECEIPTS_INBOX_SECRET` with
   that secret, scoped to Functions. Then redeploy the site.
5. In your own Gmail, forward receipts to loye10shopping@gmail.com by hand, or add it as a
   forwarding address (Settings > Forwarding and POP/IMAP). Gmail emails a confirmation code to
   loye10shopping@gmail.com; read it there and enter it. Then add a filter that forwards order
   emails, for example `from:(amazon.com OR target.com OR walmart.com OR costco.com) subject:(order OR receipt)`.

Forward from the same Google address you sign in to the app with.

## Limits

- Paper receipts from a store don't arrive by email. Snap those on the Receipts tab.
- Store shorthand and brand names can make a match uncertain; those wait for your OK.
