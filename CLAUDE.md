# Journal Junkie — notes for Claude

Shareable version of J's nightly log app (J's personal app is the separate `nightly-log` repo).
Live at https://juddmcn.github.io/journal-junkie/ (GitHub Pages from `main`). Friends add it to their iPhone home screen from Safari.

## Stack
- Plain HTML/CSS/JS, no build step. `index.html` (markup), `style.css` (iOS look: system font, grouped inset lists, indigo tint, follows light/dark mode; colors are tokens on `:root`), `app.js` (UI), `store.js` (data layer), `sw.js` (network-first service worker; bump `CACHE` when adding shell files), `config.js` (Supabase URL + anon key — public by design).
- Supabase: Google sign-in (OAuth, PKCE) + one table `docs(user_id, coll, id, data jsonb)` with row-level security so each user sees only their own rows. Schema: `supabase/schema.sql`.
- Edge Function `fetch-ics` (`supabase/functions/fetch-ics/index.ts`) fetches Canvas / Google Calendar .ics feeds server-side (browsers can't, CORS). The app parses ICS client-side in `app.js` (`parseIcs`, `syncFeeds`).
- Everything personal (name, areas + hour goals, workout tracking, habits, classes + grade weights, countdowns, calendar feeds) lives in the doc `settings/main`. Onboarding and the Me tab both use the `ED` editor sections in `app.js`.

## Testing without Supabase
Set `window.JJ_CONFIG = {url: "mock", anonKey: "x"}` (e.g. by routing config.js in Playwright) and `window.JJ_MOCK_ICS = {url: icsText}`. Data then lives in localStorage.

## Making changes
1. `node --check app.js store.js sw.js`, test in mock mode with Playwright (Chromium is at /opt/pw-browsers/chromium).
2. Commit and push to `main`; Pages redeploys in ~1 minute and phones pick it up on next open.
