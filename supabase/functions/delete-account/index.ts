// Journal Junkie: permanently delete the signed-in user's account and all their data.
// Apple requires in-app account deletion (App Store Review Guideline 5.1.1(v)).
// Deploy as "delete-account" with "Verify JWT with legacy secret" OFF (the token is checked below).
// Uses the SUPABASE_SERVICE_ROLE_KEY that Supabase provides to every Edge Function automatically.
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
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const base = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const who = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: auth, apikey: anon } });
  if (!who.ok) return json({ error: "Sign in first" }, 401);
  const { id } = await who.json();
  if (!id) return json({ error: "Sign in first" }, 401);
  const admin = { Authorization: `Bearer ${service}`, apikey: service, "Content-Type": "application/json" };
  // Rows in public.docs are removed by ON DELETE CASCADE; delete them explicitly too in case the FK changes.
  await fetch(`${base}/rest/v1/docs?user_id=eq.${id}`, { method: "DELETE", headers: admin });
  const del = await fetch(`${base}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
  if (!del.ok) return json({ error: `Couldn't delete the account (${del.status})` }, 500);
  return json({ ok: true });
});
