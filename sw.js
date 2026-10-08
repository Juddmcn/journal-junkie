/* Network-first for the app's own files so updates show up on the next open;
   falls back to the cached copy when offline. GitHub API calls are never cached. */
const CACHE = "journal-junkie-v4";
const SHELL = ["./", "index.html", "style.css", "store.js", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png", "config.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
  } else if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com" || u.hostname === "cdn.jsdelivr.net") {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })));
  }
});
