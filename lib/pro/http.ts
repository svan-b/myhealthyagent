// lib/pro/http.ts (server only)
import { PaymentsNotConfigured } from './stripe';

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function appOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  return new URL(req.url).origin;
}

/** Request bodies here are tiny JSON objects. */
export const MAX_BODY_BYTES = 4096;

class RequestTooLarge extends Error {}

/**
 * Reads a small JSON body. Route handlers get no size limit from Next.js, so this stops reading as
 * soon as the body passes the limit instead of holding a huge upload in memory first.
 */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) throw new RequestTooLarge('Request too large');
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      // Stop pulling the upload. The rest of it is never read.
      await reader.cancel().catch(() => {});
      throw new RequestTooLarge('Request too large');
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  if (!text.trim()) return {};
  const v = JSON.parse(text);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * The address a request came from, for rate limits.
 *
 * X-Forwarded-For is a list that each proxy appends to, and the client can write anything at the
 * start of it. So count from the right. TRUSTED_PROXY_HOPS is how many proxies of yours add an entry,
 * and the entry they added last is the address they saw. The default of 1 fits Vercel (which replaces
 * the header) and a single nginx, Caddy or load balancer in front. Without any proxy, `next start`
 * keeps whatever the client sent, so per address limits cannot work there.
 */
export function clientAddress(req: Request): string {
  const entries = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const hops = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS)) || 1);
  const ip = entries[Math.max(0, entries.length - hops)];
  return ip ? addressKey(ip) : 'unknown';
}

/** Normalises an address. IPv6 addresses count per /64, because one home or phone usually gets a whole /64. */
function addressKey(raw: string): string {
  let ip = raw.toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  ip = ip.replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::', 2);
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map(g => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

// Best effort, per instance rate limit. Enough to blunt casual abuse of the endpoints.
const WINDOW_MS = 60_000;
const MAX_TRACKED = 10_000;
const hits = new Map<string, { n: number; reset: number }>();

/**
 * True when this address has made more than `limit` requests to this route in the last minute.
 * Every entry lives for the same window, so the map stays in expiry order. Expired entries are
 * dropped from the front, and under a flood of new addresses the oldest one is dropped, so the
 * work per request and the memory used stay small.
 */
export function rateLimited(req: Request, route: string, limit: number): boolean {
  const key = `${route} ${clientAddress(req)}`;
  const now = Date.now();
  for (const [k, v] of hits) {
    if (v.reset > now) break;
    hits.delete(k);
  }
  let cur = hits.get(key);
  if (!cur) {
    if (hits.size >= MAX_TRACKED) hits.delete(hits.keys().next().value as string);
    cur = { n: 0, reset: now + WINDOW_MS };
    hits.set(key, cur);
  }
  cur.n += 1;
  return cur.n > limit;
}

/** How many addresses the rate limit is tracking. For tests and monitoring. */
export function rateLimitTracked(): number {
  return hits.size;
}

export function handleError(e: unknown) {
  if (e instanceof PaymentsNotConfigured) return json({ error: 'Payments are not available right now.' }, 503);
  if (e instanceof SyntaxError) return json({ error: 'Invalid request' }, 400);
  if (e instanceof RequestTooLarge) return json({ error: 'Request too large' }, 413);
  console.error('[pro]', e instanceof Error ? e.message : e);
  return json({ error: 'Something went wrong. Please try again.' }, 502);
}
