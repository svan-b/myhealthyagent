// lib/pro/stripe.ts (server only)
// Minimal Stripe REST client so we do not need the SDK.
import { logProSetupWarning } from '@/lib/config';

const API = 'https://api.stripe.com/v1';
export const PRODUCT_TAG = 'myhealthyagent-pro';

export class PaymentsNotConfigured extends Error {}

let warnedSecret = false;

export function stripeConfig() {
  const key = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  const secret = process.env.LICENSE_SECRET;
  if (!key || !price || !secret) throw new PaymentsNotConfigured('Payments are not set up');
  if (secret.length < 32) {
    // Checkout would take the money and then fail to sign a license key, so sell nothing until it is fixed.
    if (!warnedSecret) {
      warnedSecret = true;
      console.error('[pro] LICENSE_SECRET must be at least 32 characters. Payments stay off until it is.');
    }
    throw new PaymentsNotConfigured('LICENSE_SECRET is too short');
  }
  logProSetupWarning();
  const mode = process.env.STRIPE_MODE === 'payment' ? 'payment' : 'subscription';
  const trialDays = Number(process.env.STRIPE_TRIAL_DAYS || 0);
  return {
    key,
    price,
    mode,
    trialDays: Number.isFinite(trialDays) && trialDays > 0 ? Math.floor(trialDays) : 0,
  } as const;
}

/** True when the server uses live Stripe keys (secret or restricted), false for test keys. */
export function isLiveMode(): boolean {
  return /^(sk|rk)_live_/.test(stripeConfig().key);
}

function encode(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.append(k, String(v));
  return sp.toString();
}

export async function stripe<T>(
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const { key } = stripeConfig();
  const url = method === 'GET' && params ? `${API}${path}?${encode(params)}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: method === 'POST' && params ? encode(params) : undefined,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe error ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data;
}

export interface Charge {
  id: string;
  /** True only when the whole amount was refunded. */
  refunded: boolean;
  /** Set by any dispute, including inquiries and disputes the seller won. */
  disputed: boolean;
}

export interface PaymentIntent {
  id: string;
  status: string;
  latest_charge: string | Charge | null;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  mode: 'payment' | 'subscription';
  customer: string | null;
  subscription: string | null;
  /** Null for subscriptions and for checkouts that cost nothing. An object when expanded. */
  payment_intent?: string | PaymentIntent | null;
  metadata: Record<string, string>;
}

export interface Subscription {
  id: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';
  customer: string;
}

export interface Customer {
  id: string;
  deleted?: boolean;
}

export interface Dispute {
  id: string;
  status: string;
}

/** Subscriptions in these states keep Pro. past_due gives Stripe's retry period as grace. */
export const ACTIVE_STATUSES = new Set<Subscription['status']>(['active', 'trialing', 'past_due']);

/** Fetch a checkout session with its payment and charge, so refunds and disputes can be seen. */
export const SESSION_EXPAND = { 'expand[]': 'payment_intent.latest_charge' } as const;

export const isPaid = (s: CheckoutSession) =>
  s.status === 'complete' && (s.payment_status === 'paid' || s.payment_status === 'no_payment_required');

/**
 * Why a paid one time purchase no longer counts, which is when the whole payment was refunded or a
 * dispute was lost. Null when it still counts. Open disputes, inquiries and disputes the seller won
 * do not count against it, because only a final answer should take Pro away. Needs a session fetched
 * with SESSION_EXPAND. Subscriptions are checked by their status instead, and free checkouts have no
 * payment to check.
 */
export async function purchaseProblem(session: CheckoutSession): Promise<string | null> {
  const pi = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
  const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  if (!charge) return null;
  if (charge.refunded) return 'This purchase was refunded.';
  if (charge.disputed) {
    const disputes = await stripe<{ data: Dispute[] }>('GET', '/disputes', { charge: charge.id, limit: 10 });
    if (disputes.data?.some(d => d.status === 'lost')) return 'The payment for this purchase was reversed.';
  }
  return null;
}
