'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { config } from '@/lib/config';
import {
  CHECKOUT_SESSION_ID,
  checkLicense,
  forgetPendingCheckout,
  pendingCheckoutOverdue,
  savePendingCheckout,
  usePro,
  type PendingCheckout,
} from '@/lib/pro/client';
import { errorMessage } from '@/lib/utils';
import { retryActivation } from './activation';

export const PRO_FEATURES = [
  'Every possible trigger the app finds, not just the top one',
  'Doctor-ready PDF report with trends, triggers and medication adherence',
  'Supports an independent, ad free, tracker free app',
];

/**
 * The upsell shown wherever Pro is locked. While a purchase is being confirmed, or a key on this device
 * could not be checked yet, it shows that instead of a buy button, so nobody pays twice.
 */
export function UpgradeCard({
  title = 'Unlock everything with Pro',
  compact = false,
}: {
  title?: string;
  compact?: boolean;
}) {
  const pro = usePro();
  const pending = pro.pendingCheckouts;
  const waiting = pending.length > 0 || (pro.licenseState === 'unverified' && pro.licenseToken);
  // The compact card sits above the Pro section in Reports and data, which shows the details.
  if (waiting && compact) {
    return (
      <p className="text-sm rounded-xl bg-accent-soft text-accent-ink px-3 py-2 font-medium">
        {pending.length > 0
          ? 'Your Pro purchase is being confirmed. Details are under Pro below.'
          : 'We could not confirm your Pro license yet. Details are under Pro below.'}
      </p>
    );
  }
  // Usually one purchase. Each one gets its own card, with its own reference.
  if (pending.length > 0) {
    return (
      <div className="space-y-3">
        {pending.map(p => (
          <PendingPurchase key={p.sessionId} pending={p} />
        ))}
      </div>
    );
  }
  if (pro.licenseState === 'unverified' && pro.licenseToken) return <UnverifiedLicense token={pro.licenseToken} />;
  return <BuyCard title={title} compact={compact} />;
}

function BuyCard({ title, compact }: { title: string; compact: boolean }) {
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

function PendingPurchase({ pending }: { pending: PendingCheckout }) {
  const [busy, setBusy] = React.useState(false);
  const since = new Date(pending.since);
  const overdue = pendingCheckoutOverdue(pending);

  const retry = async () => {
    setBusy(true);
    await retryActivation(pending.sessionId);
    setBusy(false);
  };

  return (
    <Card className="p-5 border-accent/40 bg-accent-soft space-y-3">
      <div className="flex items-center gap-2 text-accent-ink font-bold">
        <Sparkles className="size-5" aria-hidden />
        {overdue ? 'We could not confirm your Pro purchase' : 'Finishing your Pro purchase'}
      </div>
      <p className="text-sm text-fg">
        {overdue
          ? `We have been trying since ${since.toLocaleDateString()}. If the payment did not go through, you can dismiss this and buy again.`
          : 'Thank you for your purchase. Pro turns on as soon as Stripe confirms the payment, usually within a minute. Bank payments can take a few days. The app keeps checking on its own.'}
      </p>
      <div className="space-y-2">
        <Button block onClick={retry} disabled={busy}>
          {busy ? 'Checking…' : 'Retry activation'}
        </Button>
        {overdue && (
          <Button variant="secondary" block onClick={() => void forgetPendingCheckout(pending.sessionId)}>
            Dismiss
          </Button>
        )}
      </div>
      <SupportHint reference={pending.sessionId} />
    </Card>
  );
}

function UnverifiedLicense({ token }: { token: string }) {
  const [busy, setBusy] = React.useState(false);

  const check = async () => {
    setBusy(true);
    const result = await checkLicense(token);
    setBusy(false);
    if (result === 'valid') toast.success('Pro is active on this device');
    else if (result === 'ended') toast.error('This license is no longer active.');
    else toast.error('Could not reach the server. Check your connection and try again.');
  };

  return (
    <Card className="p-5 border-warn/40 bg-warn-soft space-y-3">
      <p className="font-bold text-warn">We could not confirm your Pro license yet</p>
      <p className="text-sm text-fg">
        This happens when you are offline or have just restored a backup. Pro turns back on as soon as the check works.
      </p>
      <Button block onClick={check} disabled={busy}>
        {busy ? 'Checking…' : 'Check again'}
      </Button>
    </Card>
  );
}

/** Who to contact about a purchase, with the checkout reference to quote. */
export function SupportHint({ reference }: { reference: string }) {
  return (
    <p className="text-[13px] text-muted">
      If you were charged and this does not resolve,{' '}
      {config.supportEmail ? (
        <>
          email{' '}
          <a className="text-accent underline" href={`mailto:${config.supportEmail}?subject=myHealthyAgent%20Pro`}>
            {config.supportEmail}
          </a>
        </>
      ) : (
        'contact support'
      )}{' '}
      and quote reference <span className="break-all font-mono text-[12px]">{reference}</span>.
    </p>
  );
}

const linkButton =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-[15px] font-semibold transition-colors ' +
  'bg-surface text-fg border border-line-strong hover:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * Manage billing opens Stripe's customer portal login page, where Stripe emails a one time code. It
 * works without the license key, so a lost or shared key changes nothing about who can see billing.
 * Without a portal link it points to the support email, and without either it shows nothing.
 */
export function ManageBilling({ className }: { className?: string }) {
  if (config.billingPortalUrl) {
    return (
      <a
        href={config.billingPortalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={[linkButton, className].filter(Boolean).join(' ')}
      >
        Manage billing <ExternalLink aria-hidden />
      </a>
    );
  }
  if (config.supportEmail) {
    return (
      <p className="text-sm text-muted">
        To cancel or for billing questions, email{' '}
        <a className="text-accent underline" href={`mailto:${config.supportEmail}?subject=myHealthyAgent%20billing`}>
          {config.supportEmail}
        </a>
        .
      </p>
    );
  }
  return null;
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
        const value = key.trim();
        setBusy(true);
        try {
          if (CHECKOUT_SESSION_ID.test(value)) {
            // A checkout reference, for example from support. Finish that purchase as if Stripe had just sent it.
            await savePendingCheckout(value);
            const outcome = await retryActivation(value);
            if (outcome.state !== 'failed') setKey('');
          } else {
            await activate(value);
            toast.success('Pro is active on this device');
            setKey('');
          }
        } catch (err) {
          toast.error(
            err instanceof TypeError
              ? 'Could not check that key. Are you online?'
              : errorMessage(err, 'Could not check that key. Are you online?'),
          );
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
