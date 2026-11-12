/**
 * @jest-environment node
 */
import type * as Http from '@/lib/pro/http';

let http: typeof Http;

beforeEach(async () => {
  jest.resetModules();
  delete process.env.TRUSTED_PROXY_HOPS;
  http = await import('@/lib/pro/http');
});

const req = (xff?: string) =>
  new Request('https://app.example.com/api/checkout', {
    method: 'POST',
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
  });

describe('rate limits (F38)', () => {
  it('counts the address your own proxy added, not what the client wrote in front of it', () => {
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) {
      // The client invents a new first entry every time. nginx appends the real address.
      results.push(http.rateLimited(req(`198.18.${i}.1, 203.0.113.7`), 'checkout', 10));
    }
    expect(results.slice(0, 10).every(limited => !limited)).toBe(true);
    expect(results[10]).toBe(true);
    // Someone else behind the same proxy is not affected.
    expect(http.rateLimited(req('198.18.0.1, 203.0.113.8'), 'checkout', 10)).toBe(false);
  });

  it('TRUSTED_PROXY_HOPS counts more than one proxy', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(http.clientAddress(req('1.1.1.1, 203.0.113.7, 10.0.0.2'))).toBe('203.0.113.7');
    expect(http.clientAddress(req('203.0.113.7'))).toBe('203.0.113.7');
    process.env.TRUSTED_PROXY_HOPS = 'nonsense';
    expect(http.clientAddress(req('1.1.1.1, 203.0.113.7'))).toBe('203.0.113.7');
    expect(http.clientAddress(req())).toBe('unknown');
  });

  it('normalises addresses and counts IPv6 per /64', () => {
    expect(http.clientAddress(req('2001:db8:1:2:aaaa::1'))).toBe('2001:db8:1:2::/64');
    expect(http.clientAddress(req('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'))).toBe('2001:db8:1:2::/64');
    expect(http.clientAddress(req('[2001:db8:1:2::9]:443'))).toBe('2001:db8:1:2::/64');
    expect(http.clientAddress(req('::ffff:203.0.113.7'))).toBe('203.0.113.7');
    expect(http.clientAddress(req('203.0.113.7:51234'))).toBe('203.0.113.7');
    for (let i = 0; i < 10; i++) http.rateLimited(req(`2001:db8:1:2::${i.toString(16)}`), 'checkout', 10);
    expect(http.rateLimited(req('2001:db8:1:2::ffff'), 'checkout', 10)).toBe(true);
  });

  it('keeps a separate count for each route', () => {
    for (let i = 0; i < 10; i++) http.rateLimited(req('203.0.113.7'), 'checkout', 10);
    expect(http.rateLimited(req('203.0.113.7'), 'checkout', 10)).toBe(true);
    expect(http.rateLimited(req('203.0.113.7'), 'license', 30)).toBe(false);
  });

  it('stays bounded and forgets expired entries under a flood of new addresses', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const started = performance.now();
    for (let i = 0; i < 30_000; i++) {
      http.rateLimited(req(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`), 'license', 30);
    }
    const elapsed = performance.now() - started;
    expect(http.rateLimitTracked()).toBeLessThanOrEqual(10_000);
    // The old code scanned the whole table for every new address once it held 5000, which took seconds here.
    expect(elapsed).toBeLessThan(5_000);
    now.mockReturnValue(1_000_000 + 61_000);
    http.rateLimited(req('192.0.2.1'), 'license', 30);
    expect(http.rateLimitTracked()).toBe(1);
    now.mockRestore();
  });
});

/** A body that counts how much of it was pulled. */
function countingStream(chunks: number, size = 1024) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(32));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, pulled: () => pulled, cancelled: () => cancelled };
}

const streamed = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request('https://app.example.com/api/license', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

describe('request bodies (F46)', () => {
  it('stops reading a large body once it passes 4 KB', async () => {
    const big = countingStream(10_000);
    await expect(http.readBody(streamed(big.stream))).rejects.toThrow('Request too large');
    expect(big.pulled()).toBeLessThanOrEqual(6);
    expect(big.cancelled()).toBe(true);
  });

  it('rejects a declared size over the limit without reading anything', async () => {
    const big = countingStream(10_000);
    await expect(http.readBody(streamed(big.stream, { 'content-length': '50000000' }))).rejects.toThrow(
      'Request too large',
    );
    expect(big.pulled()).toBeLessThanOrEqual(1);
  });

  it('still reads small bodies', async () => {
    const body = (text: string) => new Request('https://app.example.com/api/license', { method: 'POST', body: text });
    expect(await http.readBody(body('{"token":"abc"}'))).toEqual({ token: 'abc' });
    expect(await http.readBody(body(''))).toEqual({});
    expect(await http.readBody(body('[1,2]'))).toEqual({});
    expect(await http.readBody(new Request('https://app.example.com/api/license', { method: 'POST' }))).toEqual({});
    await expect(http.readBody(body('{nope'))).rejects.toThrow(SyntaxError);
  });

  it('the license route answers 413 for a large streamed body', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_ID = 'price_123';
    process.env.LICENSE_SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';
    const { POST } = await import('@/app/api/license/route');
    const big = countingStream(10_000);
    expect((await POST(streamed(big.stream))).status).toBe(413);
    expect(big.pulled()).toBeLessThanOrEqual(6);
  });
});
