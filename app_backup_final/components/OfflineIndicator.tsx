// app/components/OfflineIndicator.tsx
'use client';
import { useEffect, useState } from 'react';

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (online) return null;
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-amber-100 text-amber-900 px-3 py-1 text-sm shadow">
      Offline mode — data saves to your device
    </div>
  );
}
