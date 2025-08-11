// app/components/ServiceWorkerProvider.tsx
'use client';
import { useEffect } from 'react';
import { toast } from 'sonner';

export default function ServiceWorkerProvider() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker.register('/sw.js').then((registration) => {
      const notifyWaiting = (reg: ServiceWorkerRegistration) => {
        if (!reg.waiting) return;
        toast('Update available', {
          description: 'Reload to apply the latest version.',
          action: {
            label: 'Update',
            onClick: () => {
              reg.waiting?.postMessage('SKIP_WAITING');
              window.location.reload();
            }
          }
        });
      };

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => notifyWaiting(registration));
      });

      // Handle already-waiting SW (e.g., on first load after deploy)
      notifyWaiting(registration);
    }).catch(() => {});
  }, []);
  return null;
}
