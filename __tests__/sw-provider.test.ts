import { preloadForOffline, reloadOnUpdate, warmCache } from '@/app/components/ServiceWorkerProvider';

/** Stands in for navigator.serviceWorker, with a controller and the controllerchange event. */
class FakeContainer extends EventTarget {
  controller: object | null;
  constructor(controller: object | null) {
    super();
    this.controller = controller;
  }
  takeOver(worker: object | null) {
    this.controller = worker;
    this.dispatchEvent(new Event('controllerchange'));
  }
}

function setup(controller: object | null, activeAtLoad: object | null) {
  const sw = new FakeContainer(controller);
  const reload = jest.fn();
  const updates = reloadOnUpdate(sw as unknown as ServiceWorkerContainer, reload);
  updates.registered({ active: activeAtLoad as ServiceWorker | null });
  return { sw, reload, updates };
}

const v1 = { name: 'v1' };
const v2 = { name: 'v2' };
const v3 = { name: 'v3' };

describe('reloading into a new version', () => {
  test('a first visit does not reload when the first worker takes over, and reloads once for a later update', () => {
    const { sw, reload, updates } = setup(null, null);
    expect(updates.hadWorker()).toBe(false);
    sw.takeOver(v1);
    expect(reload).not.toHaveBeenCalled();
    // From now on a waiting worker is an update, so the prompt may show.
    expect(updates.hadWorker()).toBe(true);
    sw.takeOver(v2);
    expect(reload).toHaveBeenCalledTimes(1);
    sw.takeOver(v3);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a page that started under a worker reloads once when a new version takes over', () => {
    const { sw, reload, updates } = setup(v1, v1);
    expect(updates.hadWorker()).toBe(true);
    sw.takeOver(v2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a hard reloaded page (no controller, but a worker was active) also reloads for an update', () => {
    const { sw, reload, updates } = setup(null, v1);
    expect(updates.hadWorker()).toBe(true);
    sw.takeOver(v2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('losing the worker is not an update', () => {
    const { sw, reload } = setup(v1, v1);
    sw.takeOver(null);
    expect(reload).not.toHaveBeenCalled();
  });

  test('stop() removes the listener', () => {
    const { sw, reload, updates } = setup(v1, v1);
    updates.stop();
    sw.takeOver(v2);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('telling the worker what the page loaded', () => {
  const origin = window.location.origin;
  let posted: unknown[];

  beforeEach(() => {
    posted = [];
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ active: { postMessage: (m: unknown) => posted.push(m) } }) },
    });
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ name: `${origin}/_next/static/chunks/page.js` }, { name: 'https://elsewhere.test/x.js' }],
    });
  });

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (performance as { getEntriesByType?: unknown }).getEntriesByType;
  });

  test('the list sent when the app starts does not replace the one the worker remembers', async () => {
    await warmCache();
    expect(posted).toEqual([
      { type: 'CACHE_URLS', urls: [`${origin}/`, `${origin}/_next/static/chunks/page.js`], remember: false },
    ]);
  });

  test('the list sent once the report code has loaded is the one the worker remembers', async () => {
    const env = process.env as Record<string, string | undefined>;
    const mode = env.NODE_ENV;
    env.NODE_ENV = 'production';
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (run: () => void) => {
        run();
        return 1;
      },
    });
    const load = jest.fn(async () => {});
    try {
      await preloadForOffline(load);
    } finally {
      env.NODE_ENV = mode;
      delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([expect.objectContaining({ type: 'CACHE_URLS', remember: true })]);
  });
});
