# Journal Junkie

Your nightly check-in: log your day, keep your to-dos, pull in Canvas or Google Calendar, and watch your streaks grow.

Open https://juddmcn.github.io/journal-junkie/ on your phone, then in Safari tap Share → Add to Home Screen.

## Running your own copy
1. Create a Supabase project. In the SQL Editor run `supabase/schema.sql`.
2. Authentication → Providers → Google: add a Google OAuth client ID/secret. Add your site URL under Authentication → URL Configuration.
3. Edge Functions → deploy `supabase/functions/fetch-ics/index.ts` as `fetch-ics`.
4. Put your project URL and anon key in `config.js` and host the folder (GitHub Pages works).
