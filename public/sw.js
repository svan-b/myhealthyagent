// public/sw.js — myHealthyAgent SW (Day 3)
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `mha-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `mha-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll([
      '/', 
      OFFLINE_URL
    ]);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if ('navigationPreload' in self.registration) {
      await self.registration.navigationPreload.enable();
    }
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k))
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  
  // Cache all Next.js assets
  if (url.pathname.startsWith('/_next/')) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      
      // Try network first for freshness
      try {
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      } catch {
        // If offline, return cached version
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // For navigation requests
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        return cache.match(OFFLINE_URL) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const res = await fetch(req);
      cache.put(req, res.clone());
      return res;
    } catch {
      return cache.match(req) || new Response('Offline', { status: 503 });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
