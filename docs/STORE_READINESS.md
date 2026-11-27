# Getting the app into Google Play and the Apple App Store

Checked against the stores' own pages on November 27, 2026. Store rules change, so recheck anything marked "check" before you submit.

## What changed in the app for this

- **Privacy policy page** at `/privacy/`. It names Loye 10 Ventures, LLC and is linked from the sign-in screen and from Accounts and people. Both stores require a privacy policy inside the app and on the store listing.
- **Delete my account** in Accounts and people. Lists only you belong to are deleted with everything in them. Shared lists stay with the other members, and if you were their only owner, the next member becomes owner. Then your invites and your sign-in are deleted. Both stores require this.
- **Deletion request page** at `/delete-account/`. Google Play also requires a web page where people can ask for deletion without opening the app.
- **`firestore.rules`** gained a `leaving()` rule so a member can remove themselves from a list. **Paste the new file into Firebase (Firestore Database, Rules, Publish) before publishing the app**, or deleting an account that shares a list will fail.
- **`android/twa-manifest.json`**: the Bubblewrap settings for the Android package (package name `com.loye10ventures.shoppinglist`).
- **`public/.well-known/assetlinks.json`**: proves to Android that the app and the site belong together. It still holds a placeholder fingerprint (see step 6 below).

The privacy page and the deletion page show "[contact email]" until a real address is chosen.

## The account type decides a lot

| | Google Play | Apple App Store |
|---|---|---|
| Fee | $25, once | $99 a year |
| Account | Organization, for Loye 10 Ventures, LLC | Organization, for Loye 10 Ventures, LLC |
| Needs | A free D-U-N-S number in the LLC's exact legal name | The same D-U-N-S number |
| Testing rule | Personal accounts must run a closed test with 12 testers for 14 days in a row before going public. Organization accounts don't have this rule. | None like it |

An organization account skips the 12-tester rule and publishes under the business name. Getting a D-U-N-S number is free but can take up to 5 business days, and Apple needs up to 2 more days after that.

## Google Play: the steps

Steps marked **(Sola)** need your accounts, your money or your keys, so only you can do them.

1. **(Sola)** Request a D-U-N-S number for Loye 10 Ventures, LLC.
2. **(Sola)** Create a Google Play Console organization account and pay the $25 fee.
3. **(Sola)** Paste the new `firestore.rules` into Firebase and publish them.
4. **(Sola)** On a computer, install Node.js, then run these in the `android` folder:
   ```
   npm i -g @bubblewrap/cli
   bubblewrap build
   ```
   Bubblewrap offers to download the Java and Android tools it needs. On the first build it asks you to create the upload key. **Keep the `.keystore` file and its passwords in a password manager and a backup.** Without them you can't update the app. The `.gitignore` there stops the key from being committed.
5. **(Sola)** In Play Console, create the app, turn on Play App Signing and upload `app-release-bundle.aab` to an internal test.
6. Copy the **App signing key certificate SHA-256** from Play Console (Test and release, App integrity) and send it to me. I'll put it in `assetlinks.json`, and a publish puts it live. Until then the Android app shows a browser address bar at the top.
7. **(Sola)** Fill in the store listing: screenshots, a short and full description, the privacy policy link `https://loye10-shopping-list.netlify.app/privacy/`, the deletion link `https://loye10-shopping-list.netlify.app/delete-account/`, the content rating questionnaire and the data safety form (answers below).
8. **(Sola)** Send it for review.

Google sign-in works in the Android package because it runs in Chrome.

## Data safety form: draft answers

- **Does the app collect or share user data?** Yes, it collects. It doesn't share. Google's form doesn't count service providers processing data for you as sharing.
- **Encrypted in transit?** Yes.
- **Can users ask for their data to be deleted?** Yes, in the app and at the deletion link.
- **Data types collected**, all "collected, not shared", processing "not ephemeral", required for the app to work unless noted:
  - Personal info: **Name**, **Email address**, **User IDs**. Purpose: App functionality, Account management.
  - Financial info: **Purchase history** (purchases and prices you log). Purpose: App functionality. Optional.
  - Photos and videos: **Photos** (receipt photos you scan). Purpose: App functionality. Optional.
  - App activity: **Other user-generated content** (list items and notes). Purpose: App functionality.
- **Not collected:** location, contacts, messages, health, web browsing, device IDs, crash logs or analytics.
- **Ads:** the app has none.

Check before submitting: the form's categories, and whether receipt photos count as collected given they are stored.

## Apple App Store: the plan

Apple is harder than Google for this app, for three reasons.

1. **A plain website in a wrapper is likely to be rejected.** Guideline 4.2 says an app "should include features, content, and UI that elevate it beyond a repackaged website." The plan is to package the app with **Capacitor**, which bundles the app's own files rather than loading the website, and to add two or three things only a phone app can do:
   - local reminders when items are due,
   - taking receipt photos with the native camera,
   - a home screen widget or share sheet for adding items (later).
2. **Google sign-in breaks inside an iPhone app.** Google blocks its sign-in page inside embedded web views (the `disallowed_useragent` error). The Apple build needs a native sign-in plugin such as `@capacitor-firebase/authentication`. The website and the Android package keep the current sign-in.
3. **Sign in with Apple is required.** Guideline 4.8 requires an extra sign-in option that limits data to name and email and lets people hide their email, whenever an app offers a third-party sign-in like Google as its main sign-in. Sign in with Apple meets that, and Firebase supports it.

Apple also requires in-app account deletion (5.1.1(v)) and a privacy policy link in the app (5.1.1(i)). Both are now in place.

### Apple: the steps

1. **(Sola)** Enroll Loye 10 Ventures, LLC in the Apple Developer Program ($99 a year, needs the D-U-N-S number).
2. **(Sola)** In the Apple Developer account, create the Sign in with Apple service ID and key, and add Apple as a sign-in provider in Firebase.
3. I add Capacitor, native Google and Apple sign-in, reminders and the camera to the code on the preview branch.
4. **(Sola)** Build the iPhone package. That needs a Mac with Xcode, a rented cloud Mac, or a cloud build service such as Codemagic or Ionic Appflow. I can set up a cloud build so you don't need a Mac, but signing it in still needs your Apple account.
5. **(Sola)** In App Store Connect, fill in the listing, the App Privacy answers (the same data as above), and send it for review with a test account Apple's reviewers can sign in with.

## Paid plans later

Selling a subscription for digital features inside a store app has to go through Google Play Billing or Apple's in-app purchase. That's a separate pass.

## Sources

- Google Play testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Google Play account deletion requirements: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play account types and D-U-N-S: https://support.google.com/android-developer-console/answer/16641046
- Play Console registration fee: https://support.google.com/googleplay/android-developer/answer/6112435
- Trusted Web Activity and Digital Asset Links: https://developer.chrome.com/docs/android/trusted-web-activity/android-for-web-devs
- Apple App Review Guidelines (4.2, 4.8, 5.1.1): https://developer.apple.com/app-store/review/guidelines/
- Apple Developer Program fee: https://developer.apple.com/programs/
- Apple D-U-N-S requirement: https://developer.apple.com/help/account/membership/D-U-N-S
- Google's block on sign-in in embedded web views: https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html
