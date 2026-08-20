/* OnCall Locksmith — service worker
 *
 * Scope is deliberately narrow. This app is about live technician positions and
 * live customer addresses: serving a stale board out of a cache would be worse
 * than showing nothing at all. So:
 *
 *   - the app shell (index.html) uses network-first, cache only as a fallback
 *   - fonts and the Leaflet library use cache-first, because they never change
 *     within a version and they are what make a cold start slow
 *   - every Supabase call, map tile and audio blob is passed straight through
 *     and never cached
 *
 * Bump SHELL_VERSION whenever you deploy a new index.html, or returning users
 * will be served the previous one until their next visit.
 */

const SHELL_VERSION = "oncall-shell-v1";
const ASSET_VERSION = "oncall-assets-v1";

const SHELL = ["./", "./index.html", "./manifest.webmanifest"];

/* Anything matching these is safe to keep for a long time. */
const CACHEABLE_ASSET = [
  /^https:\/\/fonts\.googleapis\.com\//,
  /^https:\/\/fonts\.gstatic\.com\//,
  /^https:\/\/unpkg\.com\/leaflet@/,
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\//
];

/* Anything matching these must always hit the network. */
const NEVER_CACHE = [
  /\/functions\/v1\//,          // edge functions: claude, tts, stt, geo, track
  /\/rest\/v1\//,               // database reads and writes
  /\/auth\/v1\//,               // sessions
  /\/storage\/v1\//,            // call recordings
  /\/realtime\/v1\//,           // the live board socket
  /tile\.openstreetmap/,        // map tiles
  /\.tile\./,
  /basemaps\.cartocdn/,
  /server\.arcgisonline/
];

const matches = (url, list) => list.some(re => re.test(url));

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL_VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // a failed precache must not block install
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_VERSION && k !== ASSET_VERSION)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = req.url;
  if (!url.startsWith("http")) return;
  if (matches(url, NEVER_CACHE)) return;          // straight to the network

  // Long-lived third-party assets: serve from cache, fill it on first miss.
  if (matches(url, CACHEABLE_ASSET)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(ASSET_VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // The app shell and anything else same-origin: network first, cache as fallback.
  if (new URL(url).origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_VERSION).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
  }
});
