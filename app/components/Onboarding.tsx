'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { db } from '@/lib/db/client';
import { importBackup } from '@/lib/db/backup';
import { errorMessage } from '@/lib/utils';
import { iosSafariDevice, isIosHomeScreenApp } from './InstallPrompt';

const STEPS = [
  { title: 'Log how you feel', body: 'Pick a symptom and how bad it is. It takes a few seconds.' },
  {
    title: 'Log what you had or did',
    body: 'Foods, drinks, sleep, stress, exercise. Quick taps, no calorie counting.',
  },
  {
    title: 'See what lines up',
    body: 'After about two weeks, the app checks whether any of those are followed by more symptoms, even a day later.',
  },
];

export function Onboarding() {
  const fileRef = React.useRef<HTMLInputElement>(null);
  // On iPhone and iPad, Safari and the home screen app keep separate data.
  const [device, setDevice] = React.useState<'iPhone' | 'iPad' | null>(null);
  const [homeScreenApp, setHomeScreenApp] = React.useState(false);
  React.useEffect(() => {
    setDevice(iosSafariDevice());
    setHomeScreenApp(isIosHomeScreenApp());
  }, []);

  const start = async () => {
    await db.updatePreferences({ onboardedAt: new Date().toISOString() });
  };
  const chooseBackup = () => fileRef.current?.click();

  return (
    <div className="pt-4">
      <h1 className="text-3xl font-bold text-fg leading-tight">Find out what sets off your symptoms</h1>
      <p className="text-muted mt-3 text-[17px]">
        A private symptom diary that looks for delayed triggers you would never spot on your own.
      </p>

      {homeScreenApp ? (
        <Card className="p-4 mt-6 border-accent">
          <p className="font-semibold text-fg">Used this in Safari before?</p>
          <p className="text-sm text-muted mt-1">
            Your entries are still in Safari. This home screen app keeps its own data, so it starts empty. To bring them
            over, open this site in Safari, tap Reports and data, then Download backup. Then come back here and tap the
            button below.
          </p>
          <Button block className="mt-3" onClick={chooseBackup}>
            I have a backup file
          </Button>
        </Card>
      ) : (
        device && (
          <Card className="p-4 mt-6 border-accent">
            <p className="font-semibold text-fg">Add it to your home screen first</p>
            <p className="text-sm text-muted mt-1">
              Tap the Share button in Safari, then Add to Home Screen, and start from the new icon. It works offline. On{' '}
              {device}, the home screen app keeps its data separate from Safari, so entries made here would not show up
              there.
            </p>
          </Card>
        )
      )}

      <ol className="mt-8 space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="size-8 shrink-0 rounded-full bg-accent-soft text-accent-ink grid place-items-center font-bold">
              {i + 1}
            </span>
            <span>
              <span className="block font-semibold text-fg">{s.title}</span>
              <span className="block text-muted text-[15px]">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>

      <Card className="p-4 mt-8">
        <p className="font-semibold text-fg">Private by design</p>
        <p className="text-sm text-muted mt-1">
          No account. Your entries are stored only on this device and are never sent to a server. Back up from the menu
          so you never lose them.
        </p>
      </Card>

      <p className="text-[13px] text-subtle mt-6">
        This app is for personal tracking. It does not diagnose conditions or replace your doctor. By continuing you
        agree to the{' '}
        <Link href="/terms" className="underline">
          terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline">
          privacy notice
        </Link>
        .
      </p>

      <Button block size="lg" className="mt-4" onClick={start}>
        Get started
      </Button>
      {!homeScreenApp && (
        <Button block variant="quiet" className="mt-2" onClick={chooseBackup}>
          I have a backup file
        </Button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async e => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          try {
            const r = await importBackup(await file.text());
            toast.success('Backup restored', { description: `${r.symptoms} symptoms and ${r.factors} other entries.` });
            await start();
          } catch (err) {
            toast.error(errorMessage(err, 'Could not restore that file'));
          } finally {
            // Lets the person pick the same file again after a mistake.
            input.value = '';
          }
        }}
      />
    </div>
  );
}
