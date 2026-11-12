// myHealthyAgent service worker
// Pages are network first. When offline, or when the host answers with an error, the cached copy opens instead.
// Build files under /_next/static/ are hashed and never change, so they are cache first. Everything else is stale
// while revalidate. A page is only cached once every build file it references is cached, so it can always start offline.
// Any change to this file installs a new worker. A new VERSION also starts a new cache, which takes over what the
// old cache held when the new worker activates.
const VERSION = 'v6';
const CACHE = `mha-${VERSION}`;
const SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
// Not a real address. Holds the build files the app page had loaded, including the doctor report code, the last time
// it got that far, so trim() keeps them.
const LOADED = '/__mha/loaded';
const MAX_ENTRIES = 300;

const cacheable = res => Boolean(res && res.ok && res.type === 'basic');
const absolute = u => new URL(u, self.location.origin).href;
const isBuildFile = u => new URL(u, self.location.origin).pathname.startsWith('/_next/static/');

// Build files a page references, such as scripts, stylesheets and the preloaded font. Each ends in a file extension.
const buildFilesIn = html => [
  ...new Set(
    (html.match(/\/_next\/static\/[^"'\\\s<>?#]+\.\w+(?:\?[^"'\\\s<>#]*)?/g) || []).map(u =>
      absolute(u.replace(/&amp;/g, '&')),
    ),
  ),
];

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The app and every build file it needs to start are required. If any of them cannot be fetched, the
      // install fails, the version already installed keeps running and the browser tries again later.
      await savePage(cache, '/', await fetch(new Request('/', { cache: 'reload' })));
      await Promise.all(
        SHELL.filter(u => u !== '/').map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})),
      );
      // First install: take over immediately. Updates wait for the person to accept.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const name of await caches.keys()) {
        if (!name.startsWith('mha-') || name === CACHE) continue;
        // Bring over whatever this version does not have yet, then delete the old cache. Build files never
        // change, so this keeps code that only loads on demand, such as the doctor report, working offline.
        try {
          const old = await caches.open(name);
          for (const req of await old.keys()) {
            if (await cache.match(req)) continue;
            const res = await old.match(req);
            if (res) await cache.put(req, res);
          }
        } catch {}
        await caches.delete(name);
      }
      await trim().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

// Build files of pages that are being saved right now. trim() must not remove them.
const saving = new Map();

// Caches a page, but only after every build file it references is cached.
async function savePage(cache, key, res) {
  if (!cacheable(res)) throw new Error(`${key} answered ${res && res.status}`);
  const files = buildFilesIn(await res.clone().text());
  files.forEach(f => saving.set(f, (saving.get(f) || 0) + 1));
  try {
    await Promise.all(files.map(f => saveBuildFile(cache, f)));
    await cache.put(key, res);
  } finally {
    files.forEach(f => (saving.get(f) > 1 ? saving.set(f, saving.get(f) - 1) : saving.delete(f)));
  }
}

// Build files never change, so a copy in any cache (an older version keeps them too) saves a download.
async function saveBuildFile(cache, url) {
  if (await cache.match(url)) return;
  const res = (await caches.match(url)) || (await fetch(url));
  if (!cacheable(res)) throw new Error(`${url} answered ${res.status}`);
  await cache.put(url, res);
}

// Every deploy adds new build files, so drop the oldest entries to keep the cache from growing forever. Never
// drop the app shell, a build file a cached page references, or one in the list remember() saved.
async function trim() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  const keep = new Set([...SHELL, LOADED].map(absolute));
  saving.forEach((_, f) => keep.add(f));
  for (const req of keys) {
    if (isBuildFile(req.url)) continue;
    const res = await cache.match(req);
    if (res && (res.headers.get('Content-Type') || '').includes('text/html')) {
      buildFilesIn(await res.text()).forEach(f => keep.add(f));
    }
  }
  const loaded = await cache.match(LOADED);
  const list = loaded ? await loaded.json().catch(() => []) : [];
  if (Array.isArray(list)) list.forEach(f => typeof f === 'string' && keep.add(absolute(f)));
  const removable = keys.filter(k => !keep.has(k.url));
  await Promise.all(removable.slice(0, excess).map(k => cache.delete(k)));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(openPage(event, url));
    return;
  }

  if (isBuildFile(req.url)) {
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

async function openPage(event, url) {
  const cache = await caches.open(CACHE);
  const cached = async () => (await cache.match(url.pathname)) || (await cache.match('/'));
  let res;
  try {
    res = await fetch(event.request);
  } catch {
    return (
      (await cached()) ||
      (await cache.match('/offline.html')) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
  if (cacheable(res)) {
    event.waitUntil(savePage(cache, url.pathname, res.clone()).catch(() => {}));
    return res;
  }
  // The host answered with an error, for example during an outage or for a paused or removed deployment.
  // Everything in the app works on the device, so open the cached app instead of the host's error page.
  // Redirects (status 0) and a real 404 for a page that does not exist still pass through.
  if (res.status >= 500 || (res.status >= 400 && url.pathname === '/')) return (await cached()) || res;
  return res;
}

// Saves the build files the app page loaded, so trim() keeps them, including code that only loads on demand,
// such as the doctor report. Writes are queued in the order the lists arrive, so the latest list always wins.
let remembering = Promise.resolve();
function remember(files) {
  const body = JSON.stringify(files);
  remembering = remembering
    .then(async () => {
      const cache = await caches.open(CACHE);
      await cache.put(LOADED, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    })
    .catch(() => {});
}

// Caches what an open page loaded.
async function warm(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(
    urls.map(async u => {
      if (await cache.match(u)) return;
      try {
        const res = await fetch(u);
        if (!isBuildFile(u)) await savePage(cache, new URL(u).pathname, res);
        else if (cacheable(res)) await cache.put(u, res);
      } catch {}
    }),
  );
  await remembering;
  await trim();
}

self.addEventListener('message', event => {
  const data = event.data;
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data && data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    const urls = data.urls.filter(u => typeof u === 'string' && u.startsWith(self.location.origin + '/'));
    const source = event.source && event.source.url ? new URL(event.source.url) : null;
    // Only the app page's list from after the report code loaded replaces the saved one. The list it sends at start
    // lacks that code, and a visit that ends before it loads must not leave the cached copy open to trim().
    if (data.remember === true && source && source.pathname === '/') remember(urls.filter(isBuildFile));
    event.waitUntil(warm(urls));
  }
});
