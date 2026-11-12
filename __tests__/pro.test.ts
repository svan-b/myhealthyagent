/**
 * @jest-environment node
 */
import { issueLicense, readLicense } from '@/lib/pro/license';

const SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';

function setEnv(on: boolean) {
  if (on) {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    process.env.LICENSE_SECRET = SECRET;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  } else {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    delete process.env.LICENSE_SECRET;
  }
}

const post = (body: unknown) =>
  new Request('https://app.example.com/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });

function mockStripe(handler: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = handler(String(url), init ?? {});
    const status = (body as { __status?: number })?.__status ?? 200;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

describe('license keys', () => {
  beforeEach(() => setEnv(true));

  it('round trips and rejects tampering', () => {
    const token = issueLicense({ c: 'cus_1', s: 'sub_1', k: 'sub' });
    expect(readLicense(token)).toMatchObject({ c: 'cus_1', s: 'sub_1', k: 'sub' });

    const [p, body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ c: 'cus_2', k: 'once', t: 1 })).toString('base64url');
    expect(readLicense(`${p}.${forged}.${sig}`)).toBeNull();
    expect(readLicense(`${p}.${body}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(readLicense('nonsense')).toBeNull();
    expect(readLicense(42)).toBeNull();
  });

  it('keys signed with another secret are invalid', () => {
    const token = issueLicense({ c: 'cus_1', k: 'once' });
    process.env.LICENSE_SECRET = 'a-completely-different-secret-value-1234567890';
    expect(readLicense(token)).toBeNull();
  });

  it('refuses to run with a weak secret', () => {
    process.env.LICENSE_SECRET = 'short';
    expect(() => issueLicense({ c: 'cus_1', k: 'once' })).toThrow(/LICENSE_SECRET/);
  });
});

describe('payment routes', () => {
  beforeEach(() => {
    jest.resetModules();
    setEnv(true);
  });

  it('report payments unavailable when not configured', async () => {
    setEnv(false);
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(post({}));
    expect(res.status).toBe(503);
  });

  it('creates a checkout session with the configured price and redirect URLs', async () => {
    const calls = mockStripe(() => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }));
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(post({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc' });
    const sent = new URLSearchParams(String(calls[0].init.body));
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent.get('mode')).toBe('subscription');
    expect(sent.get('line_items[0][price]')).toBe('price_123');
    expect(sent.get('success_url')).toBe('https://app.example.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}');
    expect(sent.get('metadata[product]')).toBe('myhealthyagent-pro');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_123');
  });

  it('issues a license only for a paid checkout of this product', async () => {
    const session = {
      id: 'cs_test_abcdefghijkl',
      status: 'complete',
      payment_status: 'paid',
      mode: 'subscription',
      customer: 'cus_9',
      subscription: 'sub_9',
      metadata: { product: 'myhealthyagent-pro' },
    };
    mockStripe(url =>
      url.endsWith('/v1/subscriptions/sub_9') ? { id: 'sub_9', status: 'active', customer: 'cus_9' } : session,
    );
    const { POST } = await import('@/app/api/license/route');
    const ok = await POST(post({ sessionId: session.id }));
    const data = await ok.json();
    expect(data.valid).toBe(true);
    expect(readLicense(data.token)).toMatchObject({ c: 'cus_9', s: 'sub_9', k: 'sub' });

    mockStripe(() => ({ ...session, payment_status: 'unpaid', status: 'open' }));
    expect((await POST(post({ sessionId: session.id }))).status).toBe(402);

    mockStripe(() => ({ ...session, metadata: { product: 'something-else' } }));
    expect((await POST(post({ sessionId: session.id }))).status).toBe(402);

    expect((await POST(post({ sessionId: '../../v1/customers' }))).status).toBe(400);
  });

  it('checks subscription status for existing keys', async () => {
    const token = issueLicense({ c: 'cus_9', s: 'sub_9', k: 'sub' });
    const { POST } = await import('@/app/api/license/route');

    mockStripe(() => ({ id: 'sub_9', status: 'active', customer: 'cus_9' }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: true });

    mockStripe(() => ({ id: 'sub_9', status: 'canceled', customer: 'cus_9' }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });

    mockStripe(() => ({ id: 'sub_9', status: 'active', customer: 'cus_OTHER' }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });

    mockStripe(() => ({ __status: 404, error: { message: 'No such subscription' } }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });

    expect(await (await POST(post({ token: 'mha1.fake.fake' }))).json()).toMatchObject({ valid: false });
  });

  it('one time purchases are confirmed with Stripe', async () => {
    const calls = mockStripe(() => ({ id: 'cus_1' }));
    const token = issueLicense({ c: 'cus_1', k: 'once' });
    const { POST } = await import('@/app/api/license/route');
    expect(await (await POST(post({ token }))).json()).toEqual({ valid: true });
    expect(calls.map(c => c.url)).toEqual(['https://api.stripe.com/v1/customers/cus_1']);
  });

  it('rejects oversized and malformed bodies', async () => {
    const { POST } = await import('@/app/api/license/route');
    const big = new Request('https://app.example.com/api/license', { method: 'POST', body: 'x'.repeat(10_000) });
    expect((await POST(big)).status).toBe(413);
    const bad = new Request('https://app.example.com/api/license', { method: 'POST', body: '{not json' });
    expect((await POST(bad)).status).toBe(400);
  });
});
