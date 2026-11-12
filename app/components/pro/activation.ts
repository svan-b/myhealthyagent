'use client';

import type { MouseEvent } from 'react';
import { toast } from 'sonner';
import { config } from '@/lib/config';
import { CHECKOUT_SESSION_ID, finishCheckout, type ActivationOutcome } from '@/lib/pro/client';

export const PRO_ACTIVE_MESSAGE = 'Thank you. Pro is active. Your license key is saved under Reports and data.';

/**
 * Who to contact about a purchase, quoting its checkout reference. The reference can come from the
 * address, which anyone can write into a link, so it is only quoted when it is a real checkout id.
 */
export function supportText(reference: string, lead = 'If you were charged'): string {
  const who = config.supportEmail ? `email ${config.supportEmail}` : 'contact support';
  return CHECKOUT_SESSION_ID.test(reference) ? `${lead}, ${who} and quote reference ${reference}.` : `${lead}, ${who}.`;
}

type Kind = 'loading' | 'success' | 'error' | 'info';

/**
 * Every message about one purchase uses the same toast, so an answer heard twice (from the return
 * page and a background retry) shows once. Each call sets every field, because sonner merges an
 * update into the toast it replaces.
 */
function show(kind: Kind, sessionId: string, title: string, description: string | undefined, duration: number) {
  const action =
    kind === 'info'
      ? {
          label: 'Retry',
          onClick: (event: MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            void retryActivation(sessionId);
          },
        }
      : undefined;
  toast[kind](title, { id: `checkout:${sessionId}`, description, duration, action });
}

export function announceActivating(sessionId: string) {
  show('loading', sessionId, 'Activating Pro…', undefined, Infinity);
}

/**
 * Tells the person what happened to a purchase. A refusal stays on screen until closed, with the
 * reason, who to contact and the reference to quote. A purchase still waiting for an answer is only
 * announced when asked, because background retries should not keep interrupting.
 */
export function announceActivation(
  outcome: ActivationOutcome,
  sessionId: string,
  { showPending = false, pendingTitle = 'Thank you for your purchase. Finishing activation.' } = {},
) {
  switch (outcome.state) {
    case 'active':
      show('success', sessionId, PRO_ACTIVE_MESSAGE, undefined, 8000);
      break;
    case 'failed':
      show('error', sessionId, outcome.message, supportText(sessionId), Infinity);
      break;
    case 'pending':
      // An info toast, because a plain one would keep the spinner of the "Activating Pro" toast it replaces.
      if (showPending) {
        const help = supportText(sessionId, 'If this does not resolve');
        show('info', sessionId, pendingTitle, `${outcome.message} ${help}`, 20_000);
      }
      break;
    case 'done':
      toast.dismiss(`checkout:${sessionId}`);
      break;
  }
}

/** Tries to finish a purchase now, at the person's request, and says how it went. */
export async function retryActivation(sessionId: string): Promise<ActivationOutcome> {
  announceActivating(sessionId);
  const outcome = await finishCheckout(sessionId);
  announceActivation(outcome, sessionId, { showPending: true, pendingTitle: 'Still waiting for confirmation' });
  return outcome;
}
