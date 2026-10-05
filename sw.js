const PREFIX = 'earnings-tracker-';
const CACHE_VERSION = 'v1.0.3';
const CACHE_NAME = `${PREFIX}${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];
// How long to wait for the network before answering from the cache. On a ship
// the connection is often "up" but dead, and a plain fetch() then hangs.
const NET_TIMEOUT = 3000;

self.addEventListener('install', (event) => {
  // Per-asset, so one failed file can't leave the cache empty.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (event) => {
  // Only our own old caches: dines09.github.io is shared with the other apps
  // (Month End, PMS, ...) and CacheStorage is per origin, so deleting every
  // other cache name wiped their offline copies too.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  // Live data (exchange rates) is handled by the page with its own timeout/fallback.
  if (!sameOrigin && !isFont) return;

  // Fonts: cache first; offline and uncached → empty response, never a hang.
  if (isFont) {
    event.respondWith(
      caches.match(req).then((hit) => hit || Promise.race([fetch(req), timeout(NET_TIMEOUT)]).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => new Response('', { status: 200, headers: { 'Content-Type': url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2' } })))
    );
    return;
  }

  // App files: network first (so updates arrive), but give up after a few
  // seconds and use the saved copy.
  const net = fetch(req).then((response) => {
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
    }
    return response;
  });
  event.waitUntil(net.catch(() => {}));
  const cached = () => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
  event.respondWith(
    Promise.race([net, timeout(NET_TIMEOUT)])
      .catch(() => cached().then((hit) => hit || net))
  );
});
