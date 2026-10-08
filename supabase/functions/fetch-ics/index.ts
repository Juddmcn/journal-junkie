// Journal Junkie: fetch a calendar feed (.ics) on behalf of a signed-in user.
// Browsers can't read Canvas / Google Calendar feeds directly (CORS), so the app asks this function.
// Deploy in Supabase → Edge Functions → "Deploy a new function" → name it fetch-ics → paste this file.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!req.headers.get("authorization")) return json({ error: "Sign in first" }, 401);
  let url = "";
  try { url = String((await req.json()).url || "").trim(); } catch { return json({ error: "Bad request" }, 400); }
  if (url.startsWith("webcal://")) url = "https://" + url.slice(9);
  let u: URL;
  try { u = new URL(url); } catch { return json({ error: "That isn't a valid link" }, 400); }
  if (u.protocol !== "https:") return json({ error: "Calendar links must start with https:// or webcal://" }, 400);
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || /^(\d+\.){3}\d+$/.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return json({ error: "That address isn't allowed" }, 400);
  }
  try {
    const r = await fetch(u.toString(), { headers: { "User-Agent": "JournalJunkie/1.0", Accept: "text/calendar, */*" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return json({ error: `The calendar site answered ${r.status}` }, 502);
    const text = await r.text();
    if (text.length > 3_000_000) return json({ error: "That calendar is too big" }, 413);
    if (!text.includes("BEGIN:VCALENDAR")) return json({ error: "That link isn't a calendar feed (.ics)" }, 422);
    return json({ text });
  } catch (e) {
    return json({ error: "Couldn't reach that calendar: " + (e instanceof Error ? e.message : String(e)) }, 502);
  }
});
