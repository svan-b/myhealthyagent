/** @jest-environment node */
// Runs the real public/sw.js in a sandbox with an in-memory Cache Storage and a fake network.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ORIGIN = 'https://app.test';
const SOURCE = readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const CACHE_NAME = `mha-${SOURCE.match(/const VERSION = '([^']+)'/)![1]}`;
const SHELL_FILES = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
const abs = (u: string) => new URL(u, ORIGIN).href;

interface FakeInit {
  status?: number;
  type?: string;
  headers?: Record<string, string>;
}

class FakeResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly type: string;
  readonly headers: Headers;
  constructor(
    private readonly body: string | null = '',
    init: FakeInit = {},
  ) {
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.type = init.type ?? 'default';
    this.headers = new Headers(init.headers);
  }
  clone() {
    return new FakeResponse(this.body, {
      status: this.status,
      type: this.type,
      headers: Object.fromEntries(this.headers.entries()),
    });
  }
  async text() {
    return this.body ?? '';
  }
  async json(): Promise<unknown> {
    return JSON.parse(this.body ?? '');
  }
}

class FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly cache: string;
  constructor(input: string | FakeRequest, init: { method?: string; mode?: string; cache?: string } = {}) {
    this.url = typeof input === 'string' ? abs(input) : input.url;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? (typeof input === 'string' ? 'cors' : input.mode);
    this.cache = init.cache ?? 'default';
  }
}

type RequestLike = string | FakeRequest;
const keyOf = (r: RequestLike) => (typeof r === 'string' ? abs(r) : r.url);

type Served = { body: string; status?: number; type?: string; contentType?: string } | 'network error';

/** The host. It holds what each path answers right now. Anything not listed is a 404. */
class Network {
  online = true;
  served = new Map<string, Served>();
  requests: string[] = [];
  async fetch(input: RequestLike): Promise<FakeResponse> {
    const url = new URL(keyOf(input));
    this.requests.push(url.pathname + url.search);
    if (!this.online) throw new TypeError('Failed to fetch');
    const s = this.served.get(url.pathname + url.search) ?? this.served.get(url.pathname);
    if (s === 'network error') throw new TypeError('Failed to fetch');
    if (!s)
      return new FakeResponse('Not found', { status: 404, type: 'basic', headers: { 'Content-Type': 'text/html' } });
    return new FakeResponse(s.body, {
      status: s.status ?? 200,
      type: s.type ?? 'basic',
      headers: { 'Content-Type': s.contentType ?? 'application/javascript' },
    });
  }
}

/** Keeps the order the spec gives. put() removes an existing entry and appends, and keys() keeps insertion order. */
class FakeCache {
  entries = new Map<string, FakeResponse>();
  constructor(private readonly net: Network) {}
  async match(r: RequestLike) {
    return this.entries.get(keyOf(r))?.clone();
  }
  async put(r: RequestLike, res: FakeResponse) {
    this.entries.delete(keyOf(r));
    this.entries.set(keyOf(r), res.clone());
  }
  async add(r: RequestLike) {
    const res = await this.net.fetch(r);
    if (!res.ok) throw new TypeError('Bad status');
    await this.put(r, res);
  }
  async keys() {
    return [...this.entries.keys()].map(u => new FakeRequest(u));
  }
  async delete(r: RequestLike) {
    return this.entries.delete(keyOf(r));
  }
  urls() {
    return [...this.entries.keys()].map(u => new URL(u).pathname + new URL(u).search);
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  constructor(private readonly net: Network) {}
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.net));
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  async match(r: RequestLike) {
    for (const c of this.stores.values()) {
      const hit = await c.match(r);
      if (hit) return hit;
    }
    return undefined;
  }
}

type Listener = (event: Record<string, unknown>) => void;

function world() {
  const net = new Network();
  const caches = new FakeCacheStorage(net);
  const registration: { active: object | null } = { active: null };
  return { net, caches, registration };
}
type World = ReturnType<typeof world>;

function startWorker(w: World) {
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    registration: w.registration,
    skipWaiting: jest.fn(async () => {}),
    clients: { claim: jest.fn(async () => {}) },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
  };
  vm.runInContext(
    SOURCE,
    vm.createContext({
      self,
      caches: w.caches,
      fetch: (r: RequestLike) => w.net.fetch(r),
      Request: FakeRequest,
      Response: FakeResponse,
      Headers,
      URL,
      console,
      setTimeout,
    }),
  );
  return { self, listeners };
}
type SW = ReturnType<typeof startWorker>;

/** Dispatches an event and waits for respondWith and every waitUntil, including ones added along the way. */
async function fire(sw: SW, type: string, props: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = [];
  let responded: Promise<unknown> | null = null;
  sw.listeners[type]({
    ...props,
    waitUntil: (p: Promise<unknown>) => void pending.push(Promise.resolve(p)),
    respondWith: (p: Promise<unknown>) => {
      responded = Promise.resolve(p);
    },
  });
  let response: FakeResponse | undefined;
  let networkError = false;
  if (responded) {
    try {
      response = (await responded) as FakeResponse;
    } catch {
      networkError = true;
    }
  }
  const errors: unknown[] = [];
  for (let i = 0; i < pending.length; i++) {
    try {
      await pending[i];
    } catch (e) {
      errors.push(e);
    }
  }
  return { response, networkError, errors };
}

const navigate = (sw: SW, p: string) => fire(sw, 'fetch', { request: new FakeRequest(p, { mode: 'navigate' }) });
const load = (sw: SW, p: string) => fire(sw, 'fetch', { request: new FakeRequest(p, { mode: 'no-cors' }) });
const warm = (sw: SW, page: string, files: string[]) =>
  fire(sw, 'message', {
    data: { type: 'CACHE_URLS', urls: [abs('/'), ...files.map(abs)] },
    source: { url: abs(page) },
  });

/** The app page of a build. Its HTML references these files the way Next.js writes them. */
function pageHtml(files: string[]) {
  const tags = files
    .map(f =>
      f.endsWith('.css')
        ? `<link rel="stylesheet" href="${f}" data-precedence="next"/>`
        : `<script src="${f}" async=""></script>`,
    )
    .join('');
  const flight = files.map(f => `\\"${f.replace('/_next/', '')}\\"`).join(',');
  return `<!DOCTYPE html><html><head>${tags}</head><body><h1>Log</h1><script>self.__next_f.push([1,"[${flight}]"])</script><script>var u="/_next/static/chunks/"+id+".js"</script></body></html>`;
}

/** Deploys a build. The host then serves its page and files, and no longer serves files of earlier builds. */
function deploy(w: World, files: string[], extra: string[] = []) {
  w.net.served.clear();
  for (const f of SHELL_FILES) w.net.served.set(f, { body: f, contentType: 'text/plain' });
  for (const f of [...files, ...extra]) w.net.served.set(f, { body: `code of ${f}` });
  const html = pageHtml(files);
  w.net.served.set('/', { body: html, contentType: 'text/html; charset=utf-8' });
  return html;
}

const FRAMEWORK = '/_next/static/chunks/framework-1a2b.js';
const FONT = '/_next/static/media/inter-3c4d.p.woff2';
const build = (id: string) => [
  FRAMEWORK,
  FONT,
  `/_next/static/chunks/app/page-${id}.js`,
  `/_next/static/css/${id}.css`,
];
const REPORT = '/_next/static/chunks/504.report.js';

async function currentCache(w: World) {
  const names = await w.caches.keys();
  expect(names).toHaveLength(1);
  return w.caches.open(names[0]);
}

/** The cache the live version (v5) leaves behind, with the app, its files and the report code. */
async function cacheLeftByV5(w: World, files: string[], html: string) {
  const old = await w.caches.open('mha-v5');
  await old.put('/', new FakeResponse(html, { type: 'basic', headers: { 'Content-Type': 'text/html' } }));
  for (const f of [...files, REPORT, ...SHELL_FILES])
    await old.put(f, new FakeResponse(`code of ${f}`, { type: 'basic' }));
  w.registration.active = {};
  return old;
}

describe('install', () => {
  test('caches the app and every build file it references before taking over', async () => {
    const w = world();
    const files = build('a');
    deploy(w, files);
    const sw = startWorker(w);
    const { errors } = await fire(sw, 'install');
    expect(errors).toEqual([]);
    const cache = await currentCache(w);
    expect(cache.urls()).toEqual(expect.arrayContaining(['/', ...files, ...SHELL_FILES]));
    // The template string in the inline script is not a file.
    expect(cache.urls().some(u => u.endsWith('/chunks/'))).toBe(false);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  test('fails and leaves the running version alone when a build file cannot be fetched', async () => {
    const w = world();
    const oldHtml = deploy(w, build('a'));
    await cacheLeftByV5(w, build('a'), oldHtml);
    deploy(w, build('b'));
    w.net.served.set('/_next/static/css/b.css', 'network error');
    const sw = startWorker(w);
    const { errors } = await fire(sw, 'install');
    expect(errors).toHaveLength(1);
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    expect(await (await w.caches.open(CACHE_NAME)).match('/')).toBeUndefined();
    expect(await (await (await w.caches.open('mha-v5')).match('/'))!.text()).toBe(oldHtml);
  });

  test('fails when the connection drops before the app page arrives', async () => {
    const w = world();
    deploy(w, build('a'));
    w.net.online = false;
    const { errors } = await fire(startWorker(w), 'install');
    expect(errors).toHaveLength(1);
  });

  test('copies unchanged build files from the older cache instead of downloading them', async () => {
    const w = world();
    const oldHtml = deploy(w, build('a'));
    await cacheLeftByV5(w, build('a'), oldHtml);
    deploy(w, build('b'));
    w.net.requests = [];
    const { errors } = await fire(startWorker(w), 'install');
    expect(errors).toEqual([]);
    expect(w.net.requests).not.toContain(FRAMEWORK);
    expect(w.net.requests).toContain('/_next/static/chunks/app/page-b.js');
  });

  test('a changed worker with the same VERSION only replaces the cached app once its files are cached', async () => {
    const w = world();
    const files = build('a');
    const oldHtml = deploy(w, files);
    const live = await w.caches.open(CACHE_NAME);
    await live.put('/', new FakeResponse(oldHtml, { type: 'basic', headers: { 'Content-Type': 'text/html' } }));
    for (const f of files) await live.put(f, new FakeResponse(`code of ${f}`, { type: 'basic' }));
    w.registration.active = {};
    deploy(w, build('b'));
    w.net.served.set('/_next/static/chunks/app/page-b.js', 'network error');
    await fire(startWorker(w), 'install');
    expect(await (await live.match('/'))!.text()).toBe(oldHtml);
  });
});

describe('update', () => {
  test('after an update the app starts offline, and the doctor report code is still there', async () => {
    const w = world();
    const a = build('a');
    await cacheLeftByV5(w, a, deploy(w, a, [REPORT]));
    // The new deploy changes the page chunk and the stylesheet. The report code did not change.
    const b = build('b');
    const html = deploy(w, b, [REPORT]);
    const sw = startWorker(w);
    expect((await fire(sw, 'install')).errors).toEqual([]);
    expect((await fire(sw, 'activate')).errors).toEqual([]);
    expect(await w.caches.keys()).toEqual([CACHE_NAME]);
    expect(sw.self.clients.claim).toHaveBeenCalled();

    w.net.online = false;
    const page = await navigate(sw, '/');
    expect(await page.response!.text()).toBe(html);
    for (const f of [...b, REPORT]) {
      const res = await load(sw, f);
      expect({ f, failed: res.networkError }).toEqual({ f, failed: false });
    }
  });
});

describe('pages', () => {
  async function installed() {
    const w = world();
    const html = deploy(w, build('a'));
    const sw = startWorker(w);
    await fire(sw, 'install');
    return { w, sw, html };
  }

  test.each([500, 502, 503, 504])('opens the cached app when the host answers %i', async status => {
    const { w, sw, html } = await installed();
    w.net.served.set('/', { body: 'Bad gateway', status, contentType: 'text/html' });
    const { response } = await navigate(sw, '/');
    expect(await response!.text()).toBe(html);
  });

  test.each([404, 402, 403])('opens the cached app when the host answers %i for the app itself', async status => {
    const { w, sw, html } = await installed();
    w.net.served.set('/', { body: 'Deployment not found', status, contentType: 'text/html' });
    const { response } = await navigate(sw, '/');
    expect(await response!.text()).toBe(html);
  });

  test('passes a real 404 for a page that does not exist through', async () => {
    const { sw } = await installed();
    const { response } = await navigate(sw, '/no-such-page');
    expect(response!.status).toBe(404);
  });

  test('passes redirects through', async () => {
    const { w, sw } = await installed();
    w.net.served.set('/', { body: '', status: 0, type: 'opaqueredirect' });
    const { response } = await navigate(sw, '/');
    expect(response!.type).toBe('opaqueredirect');
  });

  test('shows the host error when nothing is cached', async () => {
    const w = world();
    deploy(w, build('a'));
    w.net.served.set('/', { body: 'Down for maintenance', status: 503, contentType: 'text/html' });
    const { response } = await navigate(startWorker(w), '/');
    expect(response!.status).toBe(503);
  });

  test('offline, opens the cached app, or the offline page when the app is not cached', async () => {
    const { w, sw, html } = await installed();
    w.net.online = false;
    expect(await (await navigate(sw, '/')).response!.text()).toBe(html);
    await (await currentCache(w)).delete('/');
    expect(await (await navigate(sw, '/')).response!.text()).toBe('/offline.html');
  });

  test('replaces the cached app only once every file of the new build is cached', async () => {
    const { w, sw, html } = await installed();
    const cache = await currentCache(w);
    const newHtml = deploy(w, build('b'));
    w.net.served.set('/_next/static/css/b.css', 'network error');
    const first = await navigate(sw, '/');
    expect(await first.response!.text()).toBe(newHtml);
    expect(await (await cache.match('/'))!.text()).toBe(html);

    deploy(w, build('b'));
    await navigate(sw, '/');
    expect(await (await cache.match('/'))!.text()).toBe(newHtml);
    expect(cache.urls()).toEqual(expect.arrayContaining(build('b')));
  });
});

describe('trim', () => {
  test('never removes a file the cached app or the last app start needs, and keeps the cache bounded', async () => {
    const w = world();
    let files = build('d0');
    deploy(w, files, ['/_next/static/chunks/504.d0.js']);
    const sw = startWorker(w);
    await fire(sw, 'install');
    await fire(sw, 'activate');
    const cache = await currentCache(w);

    for (let d = 1; d <= 150; d++) {
      // Each deploy changes the page chunk, the stylesheet and the report chunk. The framework and font never change.
      files = build(`d${d}`);
      const report = `/_next/static/chunks/504.d${d}.js`;
      deploy(w, files, [report, `/_next/static/chunks/worker.d${d}.js`]);
      await navigate(sw, '/');
      for (const f of files) await load(sw, f);
      await load(sw, report);
      await warm(sw, '/', [...files, report]);
      // Something loaded after the warm-up, like the analysis worker when Insights opens, also triggers a trim.
      await load(sw, `/_next/static/chunks/worker.d${d}.js`);

      const urls = cache.urls();
      expect(urls.length).toBeLessThanOrEqual(300);
      for (const f of ['/', ...files, report, ...SHELL_FILES])
        expect({ d, f, cached: urls.includes(f) }).toEqual({ d, f, cached: true });
    }
    // Old builds were dropped along the way.
    expect(cache.urls()).not.toContain('/_next/static/css/d1.css');
  });

  test('only the app page decides what the last start loaded', async () => {
    const w = world();
    deploy(w, build('a'), [REPORT]);
    const sw = startWorker(w);
    await fire(sw, 'install');
    await warm(sw, '/', [REPORT]);
    await warm(sw, '/privacy', ['/_next/static/chunks/app/privacy/page-a.js']);
    const saved = await (await currentCache(w)).match('/__mha/loaded');
    expect(await saved!.json()).toEqual([abs(REPORT)]);
  });

  test('when two lists from the app page arrive together, the later one wins', async () => {
    const w = world();
    deploy(w, build('a'), [REPORT]);
    const sw = startWorker(w);
    await fire(sw, 'install');
    await Promise.all([warm(sw, '/', build('a')), warm(sw, '/', [...build('a'), REPORT])]);
    const saved = await (await currentCache(w)).match('/__mha/loaded');
    expect(await saved!.json()).toEqual([...build('a'), REPORT].map(abs));
  });
});

describe('messages', () => {
  test('SKIP_WAITING lets a waiting update take over', async () => {
    const w = world();
    const sw = startWorker(w);
    await fire(sw, 'message', { data: 'SKIP_WAITING' });
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  test('CACHE_URLS caches the files a page loaded and ignores other origins', async () => {
    const w = world();
    deploy(w, build('a'), [REPORT]);
    const sw = startWorker(w);
    await fire(sw, 'install');
    await fire(sw, 'message', {
      data: { type: 'CACHE_URLS', urls: [abs(REPORT), 'https://elsewhere.test/x.js'] },
      source: { url: abs('/') },
    });
    expect((await currentCache(w)).urls()).toContain(REPORT);
    expect(w.net.requests).not.toContain('/x.js');
  });
});
