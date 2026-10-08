// Builds www/ for the iOS app (Capacitor). No bundler: copy the web files, and bundle the
// Supabase client locally so the app never downloads code at runtime (App Store guideline 2.5.2).
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
const files = ["index.html", "style.css", "app.js", "store.js", "config.js", "privacy.html", "support.html", "terms.html"];
rmSync("www", { recursive: true, force: true });
mkdirSync("www/vendor", { recursive: true });
for (const f of files) if (existsSync(f)) cpSync(f, "www/" + f);
cpSync("icons", "www/icons", { recursive: true });
const sb = "node_modules/@supabase/supabase-js/dist/umd/supabase.min.js";
if (!existsSync(sb)) { console.error("Run `npm install` first."); process.exit(1); }
cpSync(sb, "www/vendor/supabase.min.js");
let html = readFileSync("www/index.html", "utf8");
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"><\/script>/, '<script src="vendor/supabase.min.js"></script>');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, "");
writeFileSync("www/index.html", html);
console.log("www/ ready for iOS");
