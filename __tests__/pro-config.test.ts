/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { processEnv } from '@next/env';

const KEYS = [
  'NEXT_PUBLIC_PRO_ENABLED',
  'NEXT_PUBLIC_PRO_PRICE_LABEL',
  'NEXT_PUBLIC_SUPPORT_EMAIL',
  'NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL',
] as const;

async function loadConfig(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  jest.resetModules();
  delete (globalThis as { __mhaProSetupWarned?: boolean }).__mhaProSetupWarned;
  return import('@/lib/config');
}

afterAll(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('price label (F43)', () => {
  it('.env.example gives a label that Next.js loads with its price', () => {
    const contents = readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    const files = [{ path: '.env', contents, env: {} as Record<string, string | undefined> }];
    const before = { ...process.env };
    try {
      processEnv(files, path.join(__dirname, '..'), { info() {}, error() {} }, true);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    }
    expect(files[0].env.NEXT_PUBLIC_PRO_PRICE_LABEL).toBe('$19 once');
  });

  it('never shows a label that lost its price', async () => {
    const cases: [string, string][] = [
      ['$19 once', '$19 once'],
      ['\\$19 once', '$19 once'],
      ['€19 one time', '€19 one time'],
      [' once', ''],
      ['/month', ''],
      ['.99 once', ''],
      ['', ''],
    ];
    for (const [raw, shown] of cases) {
      const { config } = await loadConfig({ NEXT_PUBLIC_PRO_PRICE_LABEL: raw });
      expect([raw, config.proPriceLabel]).toEqual([raw, shown]);
    }
  });
});

describe('billing and support setup (F17)', () => {
  it('reads the portal login link and only accepts https', async () => {
    let { config } = await loadConfig({
      NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL: 'https://billing.stripe.com/p/login/abc',
    });
    expect(config.billingPortalUrl).toBe('https://billing.stripe.com/p/login/abc');
    ({ config } = await loadConfig({ NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL: 'javascript:alert(1)' }));
    expect(config.billingPortalUrl).toBe('');
  });

  it('warns the operator once when Pro is on with no way for buyers to get help', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadConfig({ NEXT_PUBLIC_PRO_ENABLED: 'true' });
    expect(mod.proSetupWarning()).toMatch(/NEXT_PUBLIC_SUPPORT_EMAIL.*NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL/);
    mod.logProSetupWarning();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[pro\]/);

    for (const env of [
      { NEXT_PUBLIC_PRO_ENABLED: 'true', NEXT_PUBLIC_SUPPORT_EMAIL: 'help@example.com' },
      { NEXT_PUBLIC_PRO_ENABLED: 'true', NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL: 'https://billing.stripe.com/p/login/x' },
      {},
    ]) {
      warn.mockClear();
      const other = await loadConfig(env);
      expect(other.proSetupWarning()).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    }
    warn.mockRestore();
  });

  it('the payment routes keep working, and log the warning, when it is missing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await loadConfig({ NEXT_PUBLIC_PRO_ENABLED: 'true' });
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    process.env.LICENSE_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/x' })),
    );
    const { POST } = await import('@/app/api/checkout/route');
    const res = await POST(new Request('https://app.example.com/api/checkout', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_SUPPORT_EMAIL'));
    warn.mockRestore();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    delete process.env.LICENSE_SECRET;
  });
});
