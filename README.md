# Shopping List

A shared shopping list for households and organizations. You add items the moment you notice something is running low, the app groups them into store runs so you make fewer trips, and it learns how often you buy things so it can remind you before you run out.

## What it does

- Quick add: Type `2 gal milk @costco $3.49` and the app reads the quantity, unit, store and price. Separate items with commas, paste a whole list, or tap the mic and say "eggs and bread and milk." Put `!` at the end when something can't wait.
- Gestures in place of buttons: Swipe right when you've got an item. Swipe left to snooze it for a week, or swipe further to take it off the list. Every action shows an Undo. On a desktop you can tap the circle or use the icons that appear on hover.
- Shared accounts: Sign in with Google. Everyone you invite is trusted: they add items straight to the list, check things off and see spending, with no approval step. Owners also manage who has access.
- Trips and orders: Save your nearby stores once (kind of store, town and miles from home) and the app plans the fewest runs: the store that carries the most of your list goes first, the nearer one wins a tie, and leftovers go to a second stop with a note when it can wait. It knows what a store sells from its kind (a Walmart Supercenter has groceries and car items, a grocery store doesn't sell engine oil) plus any price already found there, so planning uses no price searches. Without saved stores, the list is grouped by the store typed on each item, with an estimated total. Each store card offers items that will be due soon at the same store, so one trip covers both. Online orders can be marked "Ordered" and then "It arrived," which logs the purchases.
- Predictions: After two or more purchases, the app estimates how long an item lasts, adjusted for how much you bought. Items due within your chosen window appear under "Running low soon." On any item you can switch to a fixed schedule ("every 14 days") or turn predictions off.
- Receipts: Snap a photo or paste a screenshot. Gemini reads each line, matches it to items on your list, and shows you the matches to confirm before anything is saved. Prices then appear next to items on the list. If the receipt has a QR code, the app reads it too: a link to the store's digital receipt is saved with the receipt, and any store, date or total in the code fills in the form. Most US receipts put a link or a return code in the QR, not the items, so the items still come from the photo.
- Last time and prices: Each item on the list shows when you last bought it, how many and what you paid. Tap Look up prices on an item and the app checks today's prices at Sam's Club, Amazon, Walmart, Target, Costco and the cheapest large US retailer (never eBay), and shows them on the item's price card. Lookups never run on their own: each one uses one of the free SerpApi plan's monthly searches, the price card shows how many are left, and lookups stop at zero so the plan can't run over. An item can be looked up once a day, or again right away after you change its name or note. Tap an item to see every price, open a store's search, or type a price you saw yourself. A price you type wins over a lookup for a day. Lookups need the free SerpApi key described under setup; without it, the store links and typed prices still work.
- Insights: Spending by week or month, by category, by store, and top items, plus a 30-day forecast. Filter by date, category, store, cost, quantity or item name, and export to CSV.

Without Firebase settings the app runs in demo mode with sample data stored on the device. Adding `?demo` to any URL forces demo mode, which is handy on deploy previews.

## Setup

You need a Google account for Firebase and the Netlify account you already have.

### 1. Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project. Google Analytics is optional.
2. In **Project settings > General > Your apps**, add a Web app. Copy the `firebaseConfig` values. You will paste them into Netlify in step 2.
3. **Authentication > Sign-in method:** enable **Google**.
4. **Authentication > Settings > Authorized domains:** add your Netlify addresses. Firebase does not accept wildcards, so add each one exactly:
   - `your-site.netlify.app` (production)
   - `preview--your-site.netlify.app` (the preview branch)
5. **Firestore Database:** create a database in production mode. Choose a US location such as `us-east1` (nam5 also works).
6. **Firestore Database > Rules:** replace the contents with the file `firestore.rules` from this repository and click **Publish**.
7. **AI Services > AI Logic:** click Get started and choose the **Gemini Developer API**. It works on the free Spark plan. The guided setup turns on App Check, which needs a reCAPTCHA v3 site key:
   - Create a v3 key at [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin) for both Netlify domains above.
   - In **App Check**, register the web app with the reCAPTCHA v3 provider and paste the secret key there.
   - Keep the site key for step 2.

Receipt images are compressed and stored in Firestore, so you do not need Cloud Storage. Cloud Storage would require the paid Blaze plan.

### 2. Netlify

1. In Netlify, **Add new project > Import an existing project**, and pick this GitHub repository. The build settings come from `netlify.toml`.
2. **Project configuration > Environment variables:** add every variable listed in `.env.example`, using the values from Firebase.
3. **Project configuration > Build & deploy > Continuous deployment > Branches and deploy contexts > Configure:**
   - Production branch: `main`
   - Branch deploys: **Let me add individual branches**, then add `preview`
   - Deploy Previews: on

The preview branch then lives at `preview--your-site.netlify.app`.

### 3. Store prices (optional, free)

1. Create a free account at [serpapi.com](https://serpapi.com). The free plan covers 250 lookups a month. Each tap of Look up prices uses one.
2. Copy your private API key from the SerpApi dashboard.
3. In Netlify, add an environment variable named `SERPAPI_KEY` with that key, with the Functions scope and a value for Production, Deploy Previews and Branch deploys. Keep it out of the code and out of any `VITE_` name, so it never reaches the browser.
4. Optional: add `LOOKUP_RESERVE_EMAILS` with your Google sign-in address (several can be separated by commas). Those accounts may use the reserve described below.
5. Redeploy. Tap Look up prices on an item to check stores.

Limits: each household gets 150 lookups per plan month, counted on the server. The last 100 searches of the plan are held in reserve: once the plan is down to them, lookups stop for everyone except the accounts in `LOOKUP_RESERVE_EMAILS`, which also skip the household limit. `LOOKUP_HOUSEHOLD_LIMIT` and `LOOKUP_RESERVE` change the two numbers. The household's count shows in small text at the bottom of each page.

## How changes reach production

Netlify charges 15 credits for each production deploy. Branch deploys and Deploy Previews are free. The workflow keeps unfinished work off production:

1. All work happens on the `preview` branch. Every push rebuilds `preview--your-site.netlify.app` at no cost.
2. When you like what you see, open a pull request from `preview` to `main` (the GitHub mobile app works) and merge it. That merge is the only thing that triggers a production deploy.
3. `scripts/netlify-ignore.sh` is a safety net. Netlify skips a production build when a commit lands on `main` without coming from a merged pull request (or a commit message starting with `release:`). It also skips any build where only documentation changed.

GitHub can enforce "no direct pushes to main" through branch protection, but on a free account that only works for public repositories. The ignore script covers the private case.

### Editing from your phone

Open the repository in Claude Code from the Claude app on your phone and describe the change. `CLAUDE.md` tells Claude to work only on `preview`, run the tests and the build before pushing, and never merge to `main` until you say "release."

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values, or leave empty for demo mode
npm run dev
npm test
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/lib/parse.js` | Quick-add parsing (quantity, unit, @store, #category, $price, !) |
| `src/lib/predict.js` | Purchase-interval predictions and overrides |
| `src/lib/match.js` | Matching receipt lines to list items |
| `src/lib/receipts.js` | Image compression and Gemini receipt reading |
| `src/lib/qr.js` | Reading the QR code on a receipt |
| `src/lib/dupes.js` | Spotting duplicates before an item is added (same name, plural, near match or typo) |
| `src/lib/classify.js` | Sorting items the keyword list misses into a type, with Gemini (names only); a type picked by hand is never changed |
| `src/data/actions.js` | Every write the app makes (add, buy, snooze, order, save receipt) |
| `src/data/firebaseBackend.js` | Firestore and Google sign-in |
| `src/data/localBackend.js` | Demo mode, stored in the browser |
| `firestore.rules` | Server-side permissions: members edit everything, owners also manage people |
| `src/lib/history.js` | Last date, quantity and price bought for each item |
| `src/lib/prices.js` | Store links (Sam's Club, Amazon, Walmart first), price providers, and merging looked-up prices |
| `src/lib/storeMatch.js` | Turns Google Shopping results into one price per store |
| `netlify/functions/prices.mjs` | Server lookup that holds the SerpApi key, for signed-in members only |
| `scripts/netlify-ignore.sh` | Production deploy guard |

## License

MIT. See the LICENSE file. Anyone may use, copy, change and share this code, including for business use, as long as the copyright notice stays with it.
