// lib/pro/stripe.ts (server only)
// Minimal Stripe REST client so we do not need the SDK.

const API = 'https://api.stripe.com/v1';
export const PRODUCT_TAG = 'myhealthyagent-pro';

export class PaymentsNotConfigured extends Error {}

export function stripeConfig() {
  const key = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  if (!key || !price || !process.env.LICENSE_SECRET) throw new PaymentsNotConfigured('Payments are not set up');
  const mode = process.env.STRIPE_MODE === 'payment' ? 'payment' : 'subscription';
  const trialDays = Number(process.env.STRIPE_TRIAL_DAYS || 0);
  return {
    key,
    price,
    mode,
    trialDays: Number.isFinite(trialDays) && trialDays > 0 ? Math.floor(trialDays) : 0,
  } as const;
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

export interface CheckoutSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  mode: 'payment' | 'subscription';
  customer: string | null;
  subscription: string | null;
  metadata: Record<string, string>;
}

export interface Subscription {
  id: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';
  customer: string;
}

/** Subscriptions in these states keep Pro. past_due gives Stripe's retry period as grace. */
export const ACTIVE_STATUSES = new Set<Subscription['status']>(['active', 'trialing', 'past_due']);
