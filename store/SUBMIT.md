# Getting Journal Junkie on the App Store

Everything in the code is ready. These are the steps only J can do (they need his Apple account, a Mac, and payment). Claude can help with any step — just ask.

## What's already done
- iPhone-style design, dark mode, nightly reminder notifications, haptics (so it doesn't get rejected as "just a website", Guideline 4.2)
- Delete account inside the app (required, Guideline 5.1.1(v))
- Sign in with Apple, coded and ready to switch on (required when an app offers Google sign-in, Guideline 4.8)
- Google sign-in that works inside the iPhone app (opens a Safari sheet, then returns to the app)
- Privacy policy, support page and terms (links Apple asks for)
- Supabase client bundled into the app, so it doesn't download code at runtime (Guideline 2.5.2)
- 1024px icon, screenshots for the 6.9" and 6.5" iPhone slots, listing text, keywords and privacy-label answers (`store/listing.md`)

## 1. Join the Apple Developer Program ($99/year)
1. Go to developer.apple.com/programs and tap **Enroll**. Sign in with your Apple ID.
2. Choose **Individual**. Apple requires the account holder to be at least 18; if that's an issue, a parent or guardian can enroll and the app is published under their name.
3. Approval usually takes from a few hours to 2 days.

## 2. Get a Mac with Xcode
- Install **Xcode** (free) from the Mac App Store. It's big, so leave time.
- No Mac? A friend's or school Mac works, or a cloud build service like Codemagic. Tell Claude which and it will adjust these steps.

## 3. Build the iPhone app (about 15 minutes, once)
Open the **Terminal** app on the Mac and run these one at a time:
```
git clone https://github.com/Juddmcn/journal-junkie.git
cd journal-junkie
npm install
npx cap add ios
npm run ios
```
(If `npm` isn't found, install Node.js from nodejs.org first.) The last command opens the project in Xcode.

## 4. Set up the project in Xcode
1. Click **App** in the left sidebar → **Signing & Capabilities** → choose your team under **Team**.
2. Click **+ Capability** → add **Sign in with Apple**.
3. Go to the **Info** tab → **URL Types** → **+** → set **URL Schemes** to `journaljunkie`. (This lets Google sign-in return to the app.)
4. In the sidebar open **App → App → Assets → AppIcon** and drag in `store/icon-1024.png`.
5. Plug in your iPhone, pick it at the top, and press **▶︎** to try the app on your phone.

## 5. Turn on Sign in with Apple
1. In Supabase → **Authentication → Sign In / Providers → Apple**: turn it on and put `com.journaljunkie.app` in **Client IDs**. Save.
2. Tell Claude "Apple is on". Claude will flip `apple: true` in `config.js` and push, and the Apple button appears.

## 6. Create the listing in App Store Connect
1. Go to appstoreconnect.apple.com → **Apps** → **+** → **New App**.
2. Platform iOS, name **Journal Junkie**, language English (U.S.), bundle ID **com.journaljunkie.app**, SKU `journaljunkie1`.
3. Copy the description, subtitle, keywords, URLs and category from `store/listing.md`.
4. Upload screenshots from `store/screenshots/` (6.9" set and 6.5" set).
5. **App Privacy**: answer using the list in `store/listing.md`.
6. **Age rating**: answer No to everything → 4+.
7. Paste the **Review notes** from `store/listing.md`.

## 7. Upload and test
1. In Xcode: **Product → Archive**. When it finishes, click **Distribute App → App Store Connect → Upload**.
2. In App Store Connect → **TestFlight**, install it on your phone with the TestFlight app and try everything once: sign in, log a day, add a calendar link, delete a test account.

## 8. Submit
On the app page, pick the build you uploaded and press **Add for Review → Submit**. Reviews usually take 1–3 days. If Apple sends a rejection message, paste it to Claude and it will fix what they flag.

## After it's live
Updates: ask Claude for the change. For web-only changes the website updates on its own; for the App Store version, re-run `npm run sync` on the Mac, bump the version in Xcode, archive and upload again.
