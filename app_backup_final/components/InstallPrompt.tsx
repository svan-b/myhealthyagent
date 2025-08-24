// app/components/InstallPrompt.tsx
'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setStandalone(window.matchMedia('(display-mode: standalone)').matches);
    const handler = (e: Event) => { 
      e.preventDefault(); 
      setDeferred(e as BeforeInstallPromptEvent); 
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (standalone) return null;

  if (isIOS) {
    return (
      <div className="mt-3 text-xs text-gray-600">
        On iOS: Share ▸ &quot;Add to Home Screen&quot; to install.
      </div>
    );
  }

  if (!deferred) return null;

  return (
    <Button className="w-full mt-3" onClick={async () => {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === 'accepted') setDeferred(null);
    }}>
      Install app
    </Button>
  );
}
