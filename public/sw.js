// myHealthyAgent service worker
// Navigation: network first, falling back to the cached app shell so the app opens offline.
// Hashed build assets: cache first (they never change). Everything else: stale while revalidate.
const VERSION = 'v5';
const CACHE = `mha-${VERSION}`;
const SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
      // First install: take over immediately. Updates wait for the person to accept.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('mha-') && k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const cacheable = res => res && res.ok && res.type === 'basic';
const MAX_ENTRIES = 300;

// Every deploy adds new hashed build files. Drop the oldest entries so the cache cannot grow forever.
async function trim() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  const removable = keys.filter(k => !SHELL.includes(new URL(k.url).pathname));
  await Promise.all(removable.slice(0, excess).map(k => cache.delete(k)));
}

async function put(req, res) {
  if (!cacheable(res)) return;
  const cache = await caches.open(CACHE);
  await cache.put(req, res);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (cacheable(res)) {
            const copy = res.clone();
            const key = url.pathname === '/' ? '/' : url.pathname;
            event.waitUntil(put(key, copy));
          }
          return res;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(url.pathname)) ||
            (await cache.match('/')) ||
            (await cache.match('/offline.html')) ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (cacheable(res)) event.waitUntil(cache.put(req, res.clone()).then(trim));
        return res;
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then(res => {
          if (cacheable(res)) event.waitUntil(cache.put(req, res.clone()));
          return res;
        })
        .catch(() => undefined);
      return hit || (await network) || new Response('Offline', { status: 503 });
    })(),
  );
});

self.addEventListener('message', event => {
  const data = event.data;
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data && data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        await Promise.all(
          data.urls
            .filter(u => typeof u === 'string' && u.startsWith(self.location.origin))
            .map(async u => {
              if (await cache.match(u)) return;
              try {
                const res = await fetch(u);
                if (cacheable(res)) await cache.put(u, res);
              } catch {}
            }),
        );
      })(),
    );
  }
});
