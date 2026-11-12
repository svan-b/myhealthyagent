'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useHealthData } from '@/lib/hooks/useHealthData';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'mha_install_dismissed';

/** Suggests installing once the person has logged a few things. Installed apps are far less likely to lose data. */
export function InstallPrompt() {
  const { symptoms, factors } = useHealthData();
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = React.useState(false);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {}
    if (standalone || dismissed) return;
    setHidden(false);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent));
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (hidden || symptoms.length + factors.length < 3 || (!ios && !deferred)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {}
    setHidden(true);
  };

  return (
    <Card className="p-4 mt-8 relative">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 size-9 grid place-items-center rounded-full text-subtle hover:bg-surface-2"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
      <p className="font-semibold text-fg pr-8">Add to your home screen</p>
      {ios ? (
        <p className="text-sm text-muted mt-1">
          Tap the Share button in Safari, then Add to Home Screen. It opens like an app, works offline, and Safari is
          less likely to clear your data.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted mt-1">Opens like an app, works offline, and keeps your data safer.</p>
          <Button
            className="mt-3"
            size="sm"
            onClick={async () => {
              await deferred?.prompt();
              const choice = await deferred?.userChoice;
              if (choice?.outcome === 'accepted') setHidden(true);
              setDeferred(null);
            }}
          >
            Install app
          </Button>
        </>
      )}
    </Card>
  );
}
