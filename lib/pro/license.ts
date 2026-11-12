// lib/pro/license.ts (server only)
// License keys are HMAC signed. They identify a Stripe customer and purchase, nothing else.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type LicenseKind = 'sub' | 'once';

export interface LicensePayload {
  /** Stripe customer id */
  c: string;
  /** Stripe subscription id, for subscriptions */
  s?: string;
  k: LicenseKind;
  /** Issued at, seconds since epoch */
  t: number;
}

const PREFIX = 'mha1';

const b64url = (buf: Buffer) => buf.toString('base64url');

function secret(): string {
  const s = process.env.LICENSE_SECRET;
  if (!s || s.length < 32) throw new Error('LICENSE_SECRET must be set to at least 32 characters');
  return s;
}

function sign(data: string): string {
  return b64url(createHmac('sha256', secret()).update(data).digest());
}

export function issueLicense(payload: Omit<LicensePayload, 't'>, now = Date.now()): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, t: Math.floor(now / 1000) })));
  return `${PREFIX}.${body}.${sign(`${PREFIX}.${body}`)}`;
}

export function readLicense(token: unknown): LicensePayload | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as LicensePayload;
    if (typeof p.c !== 'string' || (p.k !== 'sub' && p.k !== 'once')) return null;
    return p;
  } catch {
    return null;
  }
}
