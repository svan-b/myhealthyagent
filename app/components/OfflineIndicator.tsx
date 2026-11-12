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
    <div
      role="status"
      className="fixed top-[calc(3.75rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-40 rounded-full bg-warn-soft text-warn px-3 py-1 text-[13px] font-semibold shadow"
    >
      Offline. Everything still saves on this device.
    </div>
  );
}
