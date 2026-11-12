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

class RequestTooLarge extends Error {}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 4096) throw new RequestTooLarge('Request too large');
  if (!text) return {};
  const v = JSON.parse(text);
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

// Best effort, per instance rate limit. Enough to blunt casual abuse of the endpoints.
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimited(req: Request, limit = 30, windowMs = 60_000): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || cur.reset < now) {
    hits.set(ip, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  cur.n++;
  return cur.n > limit;
}

export function handleError(e: unknown) {
  if (e instanceof PaymentsNotConfigured) return json({ error: 'Payments are not available right now.' }, 503);
  if (e instanceof SyntaxError) return json({ error: 'Invalid request' }, 400);
  if (e instanceof RequestTooLarge) return json({ error: 'Request too large' }, 413);
  console.error('[pro]', e instanceof Error ? e.message : e);
  return json({ error: 'Something went wrong. Please try again.' }, 502);
}
