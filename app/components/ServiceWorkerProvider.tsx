'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

export default function ServiceWorkerProvider() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;

    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Only reload for updates, not for the very first install.
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    const promptUpdate = (reg: ServiceWorkerRegistration) => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      toast('A new version is ready', {
        duration: Infinity,
        action: { label: 'Update', onClick: () => reg.waiting?.postMessage('SKIP_WAITING') },
      });
    };

    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        promptUpdate(reg);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed') promptUpdate(reg);
          });
        });
        // Warm the cache with what this page already loaded, so the app works offline after the first visit.
        const warm = () => {
          const urls = performance
            .getEntriesByType('resource')
            .map(e => e.name)
            .filter(u => u.startsWith(location.origin) && u.includes('/_next/static/'));
          (reg.active ?? navigator.serviceWorker.controller)?.postMessage({
            type: 'CACHE_URLS',
            urls: [location.origin + '/', ...urls],
          });
        };
        if (reg.active) warm();
        else navigator.serviceWorker.ready.then(warm);
        // Check for updates when the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  }, []);
  return null;
}
