'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { config } from '@/lib/config';
import { usePro } from '@/lib/pro/client';
import { errorMessage } from '@/lib/utils';

export const PRO_FEATURES = [
  'Every possible trigger the app finds, not just the top one',
  'Doctor-ready PDF report with trends, triggers and medication adherence',
  'Supports an independent, ad free, tracker free app',
];

export function UpgradeCard({
  title = 'Unlock everything with Pro',
  compact = false,
}: {
  title?: string;
  compact?: boolean;
}) {
  const { startCheckout } = usePro();
  const [busy, setBusy] = React.useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await startCheckout();
    } catch (e) {
      toast.error(errorMessage(e, 'Checkout is unavailable right now. Please try again later.'));
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 border-accent/40 bg-accent-soft">
      <div className="flex items-center gap-2 text-accent-ink font-bold">
        <Sparkles className="size-5" aria-hidden />
        {title}
      </div>
      {!compact && (
        <ul className="mt-3 space-y-1.5 text-sm text-fg">
          {PRO_FEATURES.map(f => (
            <li key={f} className="flex gap-2">
              <span className="mt-2 size-1.5 rounded-full bg-accent shrink-0" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      )}
      <Button block className="mt-4" onClick={go} disabled={busy}>
        {busy ? 'Opening checkout…' : config.proPriceLabel ? `Get Pro, ${config.proPriceLabel}` : 'Get Pro'}
      </Button>
      <p className="text-[13px] text-muted mt-2 text-center">
        Secure checkout by Stripe. Your health data is never sent.
      </p>
    </Card>
  );
}

export function LicenseKeyForm() {
  const { activate } = usePro();
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="flex gap-2"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        try {
          await activate({ token: key.trim() });
          toast.success('Pro is active on this device');
          setKey('');
        } catch (err) {
          toast.error(errorMessage(err, 'Could not check that key. Are you online?'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="license-key" className="sr-only">
        License key
      </label>
      <Input
        id="license-key"
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="Paste license key"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" variant="secondary" className="h-12 shrink-0" disabled={!key.trim() || busy}>
        {busy ? 'Checking…' : 'Activate'}
      </Button>
    </form>
  );
}
