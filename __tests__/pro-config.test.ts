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

/** What Next.js loads from a .env file with these contents. Leaves no new keys in process.env. */
function loadEnvFile(contents: string): Record<string, string | undefined> {
  // The loader keeps a value already in process.env over the file's, so start without one.
  for (const k of KEYS) delete process.env[k];
  const files = [{ path: '.env', contents, env: {} as Record<string, string | undefined> }];
  const before = { ...process.env };
  try {
    processEnv(files, path.join(__dirname, '..'), { info() {}, error() {} }, true);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
  }
  return files[0].env;
}

describe('price label (F43)', () => {
  it('.env.example gives a label that Next.js loads with its price', () => {
    const contents = readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    expect(loadEnvFile(contents).NEXT_PUBLIC_PRO_PRICE_LABEL).toBe('$19 once');
  });

  it('never shows a label whose $ amount a .env file dropped, and shows it when escaped (P4)', async () => {
    const labels = [
      '$19 once',
      '$19',
      '$4.99/month',
      '$49/year',
      'CA$19.99',
      'US$19',
      'A$29.99 once',
      'NZ$15/month',
      'From $9.99 a month',
      '$1,299',
      '$19.99 once',
      '$19 for 12 months',
      '"$19 for 12 months"',
      '2 years for $29',
      'Only $19 for 2 years',
    ];
    for (const label of labels) {
      const loaded = loadEnvFile(`NEXT_PUBLIC_PRO_PRICE_LABEL=${label}\n`).NEXT_PUBLIC_PRO_PRICE_LABEL ?? '';
      // Next.js really did drop the amount, so the label must not be shown.
      expect(loaded).not.toContain('$');
      const { config } = await loadConfig({ NEXT_PUBLIC_PRO_PRICE_LABEL: loaded });
      expect([label, loaded, config.proPriceLabel]).toEqual([label, loaded, '']);

      // Written as .env.example and the README say, with \$, it arrives whole and is shown.
      const escaped = loadEnvFile(`NEXT_PUBLIC_PRO_PRICE_LABEL=${label.replace(/\$/g, '\\$')}\n`);
      const whole = label.replace(/^"(.*)"$/, '$1');
      expect(escaped.NEXT_PUBLIC_PRO_PRICE_LABEL).toBe(whole);
      const shown = await loadConfig({ NEXT_PUBLIC_PRO_PRICE_LABEL: escaped.NEXT_PUBLIC_PRO_PRICE_LABEL });
      expect([label, shown.config.proPriceLabel]).toEqual([label, whole]);
    }
  });

  it('shows labels in other currencies, and a stray space next to a currency sign (P4)', async () => {
    for (const label of [
      '€19',
      '19,99 €',
      '£5/month',
      'CHF 19',
      '199 kr',
      'US$ 19',
      'R$ 19,90',
      '1.299,00 kr',
      ' $19 once ',
      '€19 ',
      ' ¥1000',
      '₹499  once',
      '฿99 ',
    ]) {
      const { config } = await loadConfig({ NEXT_PUBLIC_PRO_PRICE_LABEL: label });
      expect([label, config.proPriceLabel]).toEqual([label, label.trim()]);
    }
  });

  it('tells the operator at build and start up when the label was hidden (P4)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadConfig({
      NEXT_PUBLIC_PRO_ENABLED: 'true',
      NEXT_PUBLIC_SUPPORT_EMAIL: 'help@example.com',
      NEXT_PUBLIC_PRO_PRICE_LABEL: 'CA.99',
    });
    expect(mod.config.proPriceLabel).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[pro\] NEXT_PUBLIC_PRO_PRICE_LABEL is "CA\.99".*\\\$/);

    // Nothing to say when the label is fine, unset, or Pro is off.
    for (const env of [
      {
        NEXT_PUBLIC_PRO_ENABLED: 'true',
        NEXT_PUBLIC_SUPPORT_EMAIL: 'x@example.com',
        NEXT_PUBLIC_PRO_PRICE_LABEL: '$19',
      },
      { NEXT_PUBLIC_PRO_ENABLED: 'true', NEXT_PUBLIC_SUPPORT_EMAIL: 'x@example.com' },
      { NEXT_PUBLIC_PRO_PRICE_LABEL: 'CA.99' },
    ]) {
      warn.mockClear();
      await loadConfig(env);
      expect(warn).not.toHaveBeenCalled();
    }
    warn.mockRestore();
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
