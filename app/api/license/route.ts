import { issueLicense, readLicense } from '@/lib/pro/license';
import {
  ACTIVE_STATUSES,
  PRODUCT_TAG,
  stripe,
  stripeConfig,
  type CheckoutSession,
  type Subscription,
} from '@/lib/pro/stripe';
import { handleError, json, rateLimited, readBody } from '@/lib/pro/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { sessionId } after checkout: confirms payment with Stripe and returns a license key.
 * POST { token }: confirms an existing license key is still active.
 */
export async function POST(req: Request) {
  if (rateLimited(req, 30)) return json({ error: 'Too many attempts. Please wait a minute.' }, 429);
  try {
    stripeConfig();
    const body = await readBody(req);

    if (typeof body.sessionId === 'string') {
      if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(body.sessionId))
        return json({ valid: false, reason: 'Invalid checkout reference.' }, 400);
      const session = await stripe<CheckoutSession>('GET', `/checkout/sessions/${body.sessionId}`);
      const paid =
        session.status === 'complete' &&
        (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');
      if (session.metadata?.product !== PRODUCT_TAG || !paid || !session.customer) {
        return json({ valid: false, reason: 'That checkout has not been paid yet.' }, 402);
      }
      const token =
        session.mode === 'subscription' && session.subscription
          ? issueLicense({ c: session.customer, s: session.subscription, k: 'sub' })
          : issueLicense({ c: session.customer, k: 'once' });
      return json({ valid: true, token });
    }

    const license = readLicense(body.token);
    if (!license) return json({ valid: false, reason: 'That license key is not valid.' });
    if (license.k === 'once') return json({ valid: true });
    if (!license.s) return json({ valid: false, reason: 'That license key is not valid.' });
    const sub = await stripe<Subscription>('GET', `/subscriptions/${license.s}`);
    if (sub.customer !== license.c) return json({ valid: false, reason: 'That license key is not valid.' });
    return ACTIVE_STATUSES.has(sub.status)
      ? json({ valid: true, status: sub.status })
      : json({ valid: false, status: sub.status, reason: 'This subscription has ended.' });
  } catch (e) {
    if ((e as { status?: number }).status === 404)
      return json({ valid: false, reason: 'We could not find that purchase.' });
    return handleError(e);
  }
}
