/**
 * @jest-environment node
 */
import { issueLicense, readLicense } from '@/lib/pro/license';

const SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
const SESSION = 'cs_live_a1b2c3d4e5f6g7h8';

function setEnv(key = 'sk_live_123') {
  process.env.STRIPE_SECRET_KEY = key;
  process.env.STRIPE_PRICE_ID = 'price_123';
  process.env.LICENSE_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  delete process.env.LICENSE_REVOKED;
  delete process.env.LICENSE_VALID_FROM;
}

let ip = 0;
const post = (body: unknown) =>
  new Request('https://app.example.com/api/license', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.${Math.floor(ip / 250)}.${ip++ % 250}` },
    body: JSON.stringify(body),
  });

type Reply = Record<string, unknown> & { __status?: number };
function mockStripe(handler: (url: URL) => Reply) {
  const calls: URL[] = [];
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const body = handler(url);
    return new Response(JSON.stringify(body), { status: body.__status ?? 200 });
  }) as typeof fetch;
  return calls;
}

const charge = (over: Partial<{ refunded: boolean; disputed: boolean }> = {}) => ({
  id: 'ch_1',
  refunded: false,
  disputed: false,
  ...over,
});

const session = (over: Record<string, unknown> = {}) => ({
  id: SESSION,
  status: 'complete',
  payment_status: 'paid',
  mode: 'payment',
  customer: 'cus_1',
  subscription: null,
  metadata: { product: 'myhealthyagent-pro' },
  payment_intent: { id: 'pi_1', status: 'succeeded', latest_charge: charge() },
  ...over,
});

async function route() {
  return (await import('@/app/api/license/route')).POST;
}

beforeEach(() => {
  jest.resetModules();
  setEnv();
});

describe('one time keys are checked with Stripe (F37)', () => {
  it('records the purchase in new keys and accepts a paid purchase', async () => {
    const calls = mockStripe(() => session());
    const POST = await route();
    const res = await (await POST(post({ sessionId: SESSION }))).json();
    expect(res.valid).toBe(true);
    expect(readLicense(res.token)).toMatchObject({ c: 'cus_1', k: 'once', cs: SESSION });

    expect(await (await POST(post({ token: res.token }))).json()).toEqual({ valid: true });
    const check = calls[calls.length - 1];
    expect(check.pathname).toBe(`/v1/checkout/sessions/${SESSION}`);
    expect(check.searchParams.get('expand[]')).toBe('payment_intent.latest_charge');
  });

  it('rejects a key from a test purchase under live keys without asking Stripe', async () => {
    const calls = mockStripe(() => ({ __status: 404, error: { message: 'No such checkout session' } }));
    const token = issueLicense({ c: 'cus_test', k: 'once', cs: 'cs_test_a1b2c3d4e5f6' });
    const POST = await route();
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });
    expect(calls).toHaveLength(0);
  });

  it('turns off refunded purchases and purchases whose dispute was lost', async () => {
    const token = issueLicense({ c: 'cus_1', k: 'once', cs: SESSION });
    const POST = await route();

    mockStripe(() =>
      session({ payment_intent: { id: 'pi_1', status: 'succeeded', latest_charge: charge({ refunded: true }) } }),
    );
    expect(await (await POST(post({ token }))).json()).toMatchObject({
      valid: false,
      reason: 'This purchase was refunded.',
    });

    const disputed = { id: 'pi_1', status: 'succeeded', latest_charge: charge({ disputed: true }) };
    let disputeStatus = 'lost';
    const calls = mockStripe(url =>
      url.pathname === '/v1/disputes'
        ? { data: [{ id: 'dp_1', status: disputeStatus }] }
        : session({ payment_intent: disputed }),
    );
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });
    expect(calls.find(u => u.pathname === '/v1/disputes')?.searchParams.get('charge')).toBe('ch_1');

    // Only a final answer counts: an open dispute, an inquiry or a won dispute keep Pro.
    for (const status of ['needs_response', 'under_review', 'warning_needs_response', 'won']) {
      disputeStatus = status;
      expect(await (await POST(post({ token }))).json()).toEqual({ valid: true });
    }
  });

  it('keeps a free checkout (100% off code, no payment) valid', async () => {
    mockStripe(() => session({ payment_status: 'no_payment_required', payment_intent: null }));
    const token = issueLicense({ c: 'cus_1', k: 'once', cs: SESSION });
    expect(await (await (await route())(post({ token }))).json()).toEqual({ valid: true });
  });

  it('only a definite answer revokes: Stripe trouble returns 502 so the app keeps its grace period', async () => {
    const token = issueLicense({ c: 'cus_1', k: 'once', cs: SESSION });
    const POST = await route();
    mockStripe(() => ({ __status: 500, error: { message: 'Stripe is down' } }));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await POST(post({ token }))).status).toBe(502);
    mockStripe(() => ({ __status: 429, error: { message: 'Too many requests' } }));
    expect((await POST(post({ token }))).status).toBe(502);
    spy.mockRestore();

    mockStripe(() => ({ __status: 404, error: { message: 'No such checkout session' } }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });
    mockStripe(() => session({ customer: 'cus_OTHER' }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });
  });

  it('keeps older keys without a purchase working while Stripe confirms the customer', async () => {
    const token = issueLicense({ c: 'cus_old', k: 'once' });
    const POST = await route();

    const calls = mockStripe(() => ({ id: 'cus_old' }));
    expect(await (await POST(post({ token }))).json()).toEqual({ valid: true });
    expect(calls.map(u => u.pathname)).toEqual(['/v1/customers/cus_old']);

    mockStripe(() => ({ id: 'cus_old', deleted: true }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });

    // A test mode customer is unknown to the live account.
    mockStripe(() => ({ __status: 404, error: { message: 'No such customer' } }));
    expect(await (await POST(post({ token }))).json()).toMatchObject({ valid: false });

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockStripe(() => ({ __status: 503, error: { message: 'unavailable' } }));
    expect((await POST(post({ token }))).status).toBe(502);
    spy.mockRestore();
  });

  it('LICENSE_REVOKED and LICENSE_VALID_FROM turn off keys by hand', async () => {
    const calls = mockStripe(() => session());
    const POST = await route();
    const old = issueLicense({ c: 'cus_1', k: 'once', cs: SESSION }, Date.parse('2026-01-01T00:00:00Z'));
    const fresh = issueLicense({ c: 'cus_2', k: 'once', cs: SESSION }, Date.parse('2026-06-01T00:00:00Z'));
    const sub = issueLicense({ c: 'cus_3', s: 'sub_3', k: 'sub' });

    process.env.LICENSE_REVOKED = ' cus_9 , cus_3 ';
    expect(await (await POST(post({ token: sub }))).json()).toMatchObject({ valid: false });
    expect(calls).toHaveLength(0);
    // The checkout itself cannot be exchanged for a new key either.
    mockStripe(() => session({ customer: 'cus_3' }));
    expect((await POST(post({ sessionId: SESSION }))).status).toBe(403);

    delete process.env.LICENSE_REVOKED;
    process.env.LICENSE_VALID_FROM = '2026-03-01T00:00:00Z';
    mockStripe(() => session({ customer: 'cus_2' }));
    expect(await (await POST(post({ token: old }))).json()).toMatchObject({ valid: false });
    expect(await (await POST(post({ token: fresh }))).json()).toEqual({ valid: true });

    process.env.LICENSE_VALID_FROM = String(Date.parse('2026-03-01T00:00:00Z') / 1000);
    expect(await (await POST(post({ token: old }))).json()).toMatchObject({ valid: false });
  });

  it('a refunded checkout cannot be exchanged for a new key', async () => {
    mockStripe(() =>
      session({ payment_intent: { id: 'pi_1', status: 'succeeded', latest_charge: charge({ refunded: true }) } }),
    );
    const res = await (await route())(post({ sessionId: SESSION }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ valid: false, reason: 'This purchase was refunded.' });
  });

  it('rejects keys whose purchase field is not a checkout session', () => {
    expect(readLicense(issueLicense({ c: 'cus_1', k: 'once', cs: '../customers/cus_2' }))).toBeNull();
    expect(readLicense(issueLicense({ c: 'cus_1', k: 'once', cs: 'cs_live_abc' }))).toMatchObject({
      cs: 'cs_live_abc',
    });
  });
});

describe('checkout activation answers (F04)', () => {
  it('a payment that is still processing gets a non final answer', async () => {
    mockStripe(() =>
      session({ payment_status: 'unpaid', payment_intent: { id: 'pi_1', status: 'processing', latest_charge: null } }),
    );
    const res = await (await route())(post({ sessionId: SESSION }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ valid: false, pending: true });
  });

  it('a subscription paid by bank debit is still processing too', async () => {
    const calls = mockStripe(url =>
      url.pathname === '/v1/subscriptions/sub_1'
        ? { id: 'sub_1', status: 'incomplete', customer: 'cus_1' }
        : session({ mode: 'subscription', subscription: 'sub_1', payment_status: 'unpaid', payment_intent: null }),
    );
    expect((await (await route())(post({ sessionId: SESSION }))).status).toBe(202);
    expect(calls.map(u => u.pathname)).toEqual([`/v1/checkout/sessions/${SESSION}`, '/v1/subscriptions/sub_1']);
  });

  it('a subscription whose bank debit failed gets a final answer, so the app stops waiting', async () => {
    const POST = await route();
    for (const [status, code] of [
      ['incomplete_expired', 402],
      ['canceled', 402],
      ['incomplete', 202],
      ['past_due', 202],
    ] as const) {
      mockStripe(url =>
        url.pathname === '/v1/subscriptions/sub_1'
          ? { id: 'sub_1', status, customer: 'cus_1' }
          : session({ mode: 'subscription', subscription: 'sub_1', payment_status: 'unpaid', payment_intent: null }),
      );
      const res = await POST(post({ sessionId: SESSION }));
      expect([status, res.status]).toEqual([status, code]);
      if (code === 402) {
        expect(await res.json()).toMatchObject({ valid: false, reason: expect.stringContaining('did not go through') });
      }
    }
    // Stripe trouble while asking is not an answer.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockStripe(url =>
      url.pathname === '/v1/subscriptions/sub_1'
        ? { __status: 500, error: { message: 'Stripe is down' } }
        : session({ mode: 'subscription', subscription: 'sub_1', payment_status: 'unpaid', payment_intent: null }),
    );
    expect((await POST(post({ sessionId: SESSION }))).status).toBe(502);
    spy.mockRestore();
  });

  it('a failed or unfinished payment gets a final answer', async () => {
    const POST = await route();
    mockStripe(() =>
      session({
        payment_status: 'unpaid',
        payment_intent: { id: 'pi_1', status: 'requires_payment_method', latest_charge: null },
      }),
    );
    expect((await POST(post({ sessionId: SESSION }))).status).toBe(402);
    mockStripe(() => session({ status: 'expired', payment_status: 'unpaid' }));
    const expired = await POST(post({ sessionId: SESSION }));
    expect(expired.status).toBe(402);
    expect(await expired.json()).toMatchObject({ valid: false, reason: expect.stringContaining('not charged') });
  });

  it('refuses to take payments while LICENSE_SECRET is too short to sign keys', async () => {
    process.env.LICENSE_SECRET = 'short-secret';
    const calls = mockStripe(() => ({ id: 'cs_test_x', url: 'https://checkout.stripe.com/x' }));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('@/app/api/checkout/route');
    expect((await POST(post({}))).status).toBe(503);
    expect((await (await route())(post({ sessionId: SESSION }))).status).toBe(503);
    expect(calls).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('LICENSE_SECRET'));
    spy.mockRestore();
  });
});

describe('an old return link of a subscription (P1)', () => {
  // The checkout of a subscription stays paid after the subscription ends.
  const paidSubscription = () => session({ mode: 'subscription', subscription: 'sub_1', payment_intent: null });

  it('gets a final answer once the subscription has ended, so it cannot replace a key that works', async () => {
    const POST = await route();
    for (const [status, code] of [
      ['canceled', 402],
      ['incomplete_expired', 402],
      ['unpaid', 402],
      ['paused', 402],
      ['active', 200],
      ['trialing', 200],
      ['past_due', 200],
      ['incomplete', 200],
    ] as const) {
      const calls = mockStripe(url =>
        url.pathname === '/v1/subscriptions/sub_1' ? { id: 'sub_1', status, customer: 'cus_1' } : paidSubscription(),
      );
      const res = await POST(post({ sessionId: SESSION }));
      const data = await res.json();
      expect([status, res.status]).toEqual([status, code]);
      if (code === 402) {
        expect(data).toEqual({ valid: false, reason: 'This subscription has ended.' });
      } else {
        expect(readLicense(data.token)).toMatchObject({ c: 'cus_1', s: 'sub_1', k: 'sub' });
      }
      expect(calls.map(u => u.pathname)).toEqual([`/v1/checkout/sessions/${SESSION}`, '/v1/subscriptions/sub_1']);
    }
  });

  it('Stripe trouble while asking about the subscription is not an answer', async () => {
    const POST = await route();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockStripe(url =>
      url.pathname === '/v1/subscriptions/sub_1'
        ? { __status: 500, error: { message: 'Stripe is down' } }
        : paidSubscription(),
    );
    expect((await POST(post({ sessionId: SESSION }))).status).toBe(502);
    spy.mockRestore();
  });
});
