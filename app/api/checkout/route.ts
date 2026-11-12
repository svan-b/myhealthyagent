import { stripe, stripeConfig, PRODUCT_TAG, type CheckoutSession } from '@/lib/pro/stripe';
import { appOrigin, handleError, json, rateLimited } from '@/lib/pro/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (rateLimited(req, 10)) return json({ error: 'Too many attempts. Please wait a minute.' }, 429);
  try {
    const cfg = stripeConfig();
    const origin = appOrigin(req);
    const params: Record<string, string | number | boolean | undefined> = {
      mode: cfg.mode,
      'line_items[0][price]': cfg.price,
      'line_items[0][quantity]': 1,
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancel`,
      allow_promotion_codes: true,
      'metadata[product]': PRODUCT_TAG,
      billing_address_collection: 'auto',
    };
    if (cfg.mode === 'subscription') {
      params['subscription_data[metadata][product]'] = PRODUCT_TAG;
      if (cfg.trialDays) params['subscription_data[trial_period_days]'] = cfg.trialDays;
    } else {
      params.customer_creation = 'always';
    }
    const session = await stripe<CheckoutSession>('POST', '/checkout/sessions', params);
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return json({ url: session.url });
  } catch (e) {
    return handleError(e);
  }
}
