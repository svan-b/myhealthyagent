'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

type Container = Pick<ServiceWorkerContainer, 'controller' | 'addEventListener' | 'removeEventListener'>;

/**
 * Reloads the page once when a new version of the service worker takes over, so the page never keeps running
 * the old build under the new worker. The very first install also takes control of a page that started
 * without a worker. That is not an update and needs no reload.
 */
export function reloadOnUpdate(sw: Container, reload: () => void) {
  // True once a worker controlled this page or was already active when it loaded. From then on, any takeover
  // is a new version, even on a page that started without a worker after a hard reload.
  let hadWorker = Boolean(sw.controller);
  let reloading = false;
  const onChange = () => {
    const update = hadWorker;
    hadWorker = true;
    if (!update || !sw.controller || reloading) return;
    reloading = true;
    reload();
  };
  sw.addEventListener('controllerchange', onChange);
  return {
    /** Call with the registration. A worker that is already active means later takeovers are updates. */
    registered(reg: Pick<ServiceWorkerRegistration, 'active'>) {
      if (reg.active) hadWorker = true;
    },
    /** Whether a worker ran before, so a waiting one is an update the person can accept. */
    hadWorker: () => hadWorker,
    stop: () => sw.removeEventListener('controllerchange', onChange),
  };
}

/**
 * Asks the service worker to cache every build file this page has loaded, so the app also starts offline. With
 * remember, the worker also keeps these files when it cleans up, until the next list sent with remember. Only send
 * it once the code that loads on demand is in, or a short visit would leave that code open to cleanup.
 */
export async function warmCache(remember = false) {
  const urls = performance
    .getEntriesByType('resource')
    .map(e => e.name)
    .filter(u => u.startsWith(location.origin) && u.includes('/_next/static/'));
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: 'CACHE_URLS', urls: [location.origin + '/', ...urls], remember });
}

/**
 * Loads code that otherwise only loads when a feature is used, once the service worker runs and the app is
 * idle, then has the worker cache it. Without this, such a feature fails offline until it was used online.
 */
export async function preloadForOffline(load: () => Promise<unknown>) {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
  await navigator.serviceWorker.ready;
  await new Promise<void>(resolve => {
    // Not every browser has requestIdleCallback.
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 10_000 });
    else setTimeout(resolve, 3000);
  });
  await load();
  // The page may not be controlled yet on a first visit, so its own requests may not have reached the worker.
  await warmCache(true);
}

export default function ServiceWorkerProvider() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;

    const updates = reloadOnUpdate(navigator.serviceWorker, () => window.location.reload());
    let reg: ServiceWorkerRegistration | null = null;
    const promptUpdate = () => {
      if (!reg?.waiting || !updates.hadWorker()) return;
      toast('A new version is ready', {
        id: 'sw-update',
        duration: Infinity,
        action: { label: 'Update', onClick: () => reg?.waiting?.postMessage('SKIP_WAITING') },
      });
    };
    // Check for updates when the app comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState === 'visible') reg?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);

    navigator.serviceWorker
      .register('/sw.js')
      .then(r => {
        reg = r;
        updates.registered(r);
        promptUpdate();
        r.addEventListener('updatefound', () => {
          const sw = r.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed') promptUpdate();
          });
        });
        // Cache what this page already loaded, so the app works offline after the first visit.
        return warmCache();
      })
      .catch(() => {});

    return () => {
      updates.stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return null;
}
