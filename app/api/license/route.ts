import { issueLicense, licenseRevoked, readLicense, type LicensePayload } from '@/lib/pro/license';
import {
  ACTIVE_STATUSES,
  PRODUCT_TAG,
  SESSION_EXPAND,
  isLiveMode,
  isPaid,
  purchaseProblem,
  stripe,
  stripeConfig,
  type CheckoutSession,
  type Customer,
  type Subscription,
} from '@/lib/pro/stripe';
import { handleError, json, rateLimited, readBody } from '@/lib/pro/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const NOT_VALID = 'That license key is not valid.';
const NOT_FOUND = 'We could not find that purchase.';
const TURNED_OFF = 'This license has been turned off. Contact support if you think this is a mistake.';
const SUBSCRIPTION_ENDED = 'This subscription has ended.';

/**
 * POST { sessionId } after checkout: confirms payment with Stripe and returns a license key.
 *   200 { valid: true, token } on success. 202 { pending: true } while a bank payment is still
 *   processing, so the app asks again later. Other 4xx answers, and 200 with valid false, are final.
 *   A subscription that has ended since gets a final 402, not a key, so opening an old return link
 *   never replaces a key that still works.
 * POST { token }: confirms an existing license key still counts. Only a definite answer from Stripe
 *   gives valid false. When Stripe cannot be reached the answer is 502, and the app keeps Pro for its
 *   offline grace period.
 */
export async function POST(req: Request) {
  if (rateLimited(req, 'license', 30)) return json({ error: 'Too many attempts. Please wait a minute.' }, 429);
  try {
    stripeConfig();
    const body = await readBody(req);
    if (typeof body.sessionId === 'string') return await exchange(body.sessionId);
    return await check(body.token);
  } catch (e) {
    // Stripe answers 404 for ids it does not know, including test mode ids under live keys.
    if ((e as { status?: number }).status === 404) return json({ valid: false, reason: NOT_FOUND });
    return handleError(e);
  }
}

async function exchange(sessionId: string) {
  if (!SESSION_ID.test(sessionId)) return json({ valid: false, reason: 'Invalid checkout reference.' }, 400);
  const session = await stripe<CheckoutSession>('GET', `/checkout/sessions/${sessionId}`, SESSION_EXPAND);
  if (session.metadata?.product !== PRODUCT_TAG) {
    return json({ valid: false, reason: 'That checkout is not for this app.' }, 402);
  }
  if (session.status !== 'complete' || !session.customer) {
    return json({ valid: false, reason: 'That checkout was not completed, so you were not charged.' }, 402);
  }
  if (!isPaid(session)) {
    if (await paymentFailed(session)) {
      return json({ valid: false, reason: 'The payment did not go through, so Pro was not turned on.' }, 402);
    }
    // Bank debits and other delayed methods finish checkout before the money arrives.
    return json(
      {
        valid: false,
        pending: true,
        reason: 'Your payment is still processing. Pro will turn on automatically when it clears.',
      },
      202,
    );
  }
  const payload: Omit<LicensePayload, 't'> =
    session.mode === 'subscription' && session.subscription
      ? { c: session.customer, s: session.subscription, k: 'sub' }
      : { c: session.customer, k: 'once', cs: session.id };
  if (licenseRevoked({ ...payload, t: Math.floor(Date.now() / 1000) })) {
    return json({ valid: false, reason: TURNED_OFF }, 403);
  }
  const problem = await purchaseProblem(session);
  if (problem) return json({ valid: false, reason: problem }, 403);
  if (payload.s && (await subscriptionEnded(payload.s))) {
    return json({ valid: false, reason: SUBSCRIPTION_ENDED }, 402);
  }
  return json({ valid: true, token: issueLicense(payload) });
}

/**
 * True when the subscription a paid checkout started has ended or stopped since. Its checkout stays
 * paid, so without this an old return link would get a new key that shows Pro for a day and replaces
 * the key on the device. A subscription that is still starting (incomplete) does not count as ended.
 */
async function subscriptionEnded(id: string): Promise<boolean> {
  const sub = await stripe<Subscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);
  return !ACTIVE_STATUSES.has(sub.status) && sub.status !== 'incomplete';
}

/**
 * True when a checkout that finished before the money arrived has failed for good. A one time payment
 * shows it on its PaymentIntent. A subscription's checkout stays unpaid when its first bank debit
 * fails, so ask Stripe about the subscription. Once it is canceled or expired it can never start.
 * Anything else may still clear.
 */
async function paymentFailed(session: CheckoutSession): Promise<boolean> {
  const pi = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
  if (pi) return pi.status === 'requires_payment_method' || pi.status === 'canceled';
  if (session.mode !== 'subscription' || !session.subscription) return false;
  const sub = await stripe<Subscription>('GET', `/subscriptions/${encodeURIComponent(session.subscription)}`);
  return sub.status === 'canceled' || sub.status === 'incomplete_expired';
}

async function check(token: unknown) {
  const license = readLicense(token);
  if (!license) return json({ valid: false, reason: NOT_VALID });
  if (licenseRevoked(license)) return json({ valid: false, reason: TURNED_OFF });

  if (license.k === 'sub') {
    if (!license.s) return json({ valid: false, reason: NOT_VALID });
    const sub = await stripe<Subscription>('GET', `/subscriptions/${encodeURIComponent(license.s)}`);
    if (sub.customer !== license.c) return json({ valid: false, reason: NOT_VALID });
    return ACTIVE_STATUSES.has(sub.status)
      ? json({ valid: true, status: sub.status })
      : json({ valid: false, status: sub.status, reason: SUBSCRIPTION_ENDED });
  }

  if (license.cs) {
    // A key from a test purchase never unlocks a live store, and a live key does nothing on a test setup.
    if (license.cs.startsWith('cs_live_') !== isLiveMode()) {
      return json({
        valid: false,
        reason: license.cs.startsWith('cs_test_') ? 'That license key comes from a test purchase.' : NOT_VALID,
      });
    }
    const session = await stripe<CheckoutSession>(
      'GET',
      `/checkout/sessions/${encodeURIComponent(license.cs)}`,
      SESSION_EXPAND,
    );
    if (session.customer !== license.c || session.metadata?.product !== PRODUCT_TAG || !isPaid(session)) {
      return json({ valid: false, reason: NOT_VALID });
    }
    const problem = await purchaseProblem(session);
    return problem ? json({ valid: false, reason: problem }) : json({ valid: true });
  }

  // Keys issued before purchases were recorded in them. They stay valid while the Stripe customer
  // exists in this account. Customer ids belong to one Stripe mode, so test keys fail under live keys.
  const customer = await stripe<Customer>('GET', `/customers/${encodeURIComponent(license.c)}`);
  return customer.deleted ? json({ valid: false, reason: NOT_FOUND }) : json({ valid: true });
}
