'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { db } from '@/lib/db/client';
import { downloadFile, exportBackup } from '@/lib/db/backup';
import { errorMessage } from '@/lib/utils';
import { preloadForOffline } from './ServiceWorkerProvider';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'mha_install_dismissed';

/**
 * 'iPhone' or 'iPad' in Safari on one of them, otherwise null. iPadOS Safari reports a Mac, so a Mac with a
 * touch screen counts as an iPad. Other browsers on iOS are left out because the steps shown name Safari.
 */
export function iosSafariDevice(): 'iPhone' | 'iPad' | null {
  const ua = navigator.userAgent;
  if (/crios|fxios|edgios/i.test(ua)) return null;
  if (/ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iphone|ipod/i.test(ua)) return 'iPhone';
  return null;
}

/** True in an app opened from the home screen on iPhone or iPad. It keeps its own storage, separate from Safari. */
export function isIosHomeScreenApp() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let reportPreloaded = false;

/**
 * Loads the doctor report code in idle time so the service worker caches it. Reports then work offline without
 * having made one online first.
 */
function preloadReport() {
  if (reportPreloaded) return;
  reportPreloaded = true;
  // Keep this import in the app page's own code, like the import in the Reports sheet. Webpack then builds one
  // report chunk for both, so the file this caches is the file the sheet loads.
  preloadForOffline(() => import('@/lib/report/pdf').then(m => m.preloadReportLibs())).catch(() => {
    // Offline at start with nothing cached yet. Try again when the connection is back.
    reportPreloaded = false;
    window.addEventListener('online', preloadReport, { once: true });
  });
}

/**
 * Suggests installing once the person has logged a few things. On iPhone and iPad the home screen app has its own
 * storage and starts empty, so there the card first has them download a backup to restore inside the app.
 */
export function InstallPrompt() {
  const { symptoms, factors, schedules, doses } = useHealthData();
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [device, setDevice] = React.useState<'iPhone' | 'iPad' | null>(null);
  const [hidden, setHidden] = React.useState(true);
  const [backup, setBackup] = React.useState<'idle' | 'busy' | 'done'>('idle');
  const saved = React.useRef<HTMLParagraphElement>(null);

  // The app mounts this component on every start, even while the card stays hidden, so the preload lives here.
  React.useEffect(() => preloadReport(), []);

  // The button goes away once the backup is saved. Move focus to the message so the next steps are read out.
  React.useEffect(() => {
    if (backup === 'done') saved.current?.focus();
  }, [backup]);

  React.useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || isIosHomeScreenApp();
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {}
    if (standalone || dismissed) return;
    setHidden(false);
    setDevice(iosSafariDevice());
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // A backup holds medications and doses too, so count everything.
  const items = symptoms.length + factors.length + schedules.length + doses.length;
  if (hidden || items < 3 || (!device && !deferred)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {}
    setHidden(true);
  };

  const downloadBackup = async () => {
    setBackup('busy');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadFile(await exportBackup(), `myhealthyagent-backup-${stamp}.json`, 'application/json');
      await db.updatePreferences({ lastBackupAt: new Date().toISOString() });
      setBackup('done');
    } catch (e) {
      toast.error(errorMessage(e, 'Backup failed'));
      setBackup('idle');
    }
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
      {device && backup === 'done' ? (
        <>
          <p ref={saved} tabIndex={-1} className="text-sm text-ok font-medium mt-1 flex items-center gap-1.5">
            <Check className="size-4" aria-hidden /> Backup saved
          </p>
          <ol className="text-sm text-muted mt-2 space-y-1 list-decimal pl-5">
            <li>Tap the Share button in Safari, then Add to Home Screen.</li>
            <li>Open the new icon and tap “I have a backup file”.</li>
            <li>Choose the backup you just saved.</li>
          </ol>
          <p className="text-sm text-muted mt-2">
            After that, use the home screen app. Entries you add in Safari stay in Safari.
          </p>
        </>
      ) : device ? (
        <>
          <p className="text-sm text-muted mt-1">
            It opens like an app and works offline. On {device}, the home screen app keeps its data separate from Safari
            and starts empty, so download a backup first and restore it there.
          </p>
          <Button className="mt-3" size="sm" onClick={downloadBackup} disabled={backup === 'busy'}>
            <Download /> {backup === 'busy' ? 'Preparing…' : 'Download backup'}
          </Button>
        </>
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
