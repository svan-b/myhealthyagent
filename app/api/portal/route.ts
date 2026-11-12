import { readLicense } from '@/lib/pro/license';
import { stripe, stripeConfig } from '@/lib/pro/stripe';
import { appOrigin, handleError, json, rateLimited, readBody } from '@/lib/pro/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { token }: opens the Stripe billing portal for the license holder (cancel, update card, invoices). */
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return json({ error: 'Too many attempts. Please wait a minute.' }, 429);
  try {
    stripeConfig();
    const license = readLicense((await readBody(req)).token);
    if (!license) return json({ error: 'That license key is not valid.' }, 400);
    const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', {
      customer: license.c,
      return_url: `${appOrigin(req)}/#settings`,
    });
    return json({ url: session.url });
  } catch (e) {
    return handleError(e);
  }
}
