// lib/pro/license.ts (server only)
// License keys are HMAC signed. They identify a Stripe customer and purchase, nothing else.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type LicenseKind = 'sub' | 'once';

export interface LicensePayload {
  /** Stripe customer id */
  c: string;
  /** Stripe subscription id, for subscriptions */
  s?: string;
  /**
   * Stripe checkout session id, for one time purchases, so the purchase can be checked for refunds
   * and disputes. Its cs_live_ or cs_test_ prefix records the Stripe mode. Keys issued before this
   * field existed do not have it.
   */
  cs?: string;
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
    if (p.s !== undefined && typeof p.s !== 'string') return null;
    if (p.cs !== undefined && (typeof p.cs !== 'string' || !/^cs_(test|live)_\w+$/.test(p.cs))) return null;
    return p;
  } catch {
    return null;
  }
}

let warnedValidFrom = false;

/** LICENSE_VALID_FROM as seconds since epoch. Accepts an ISO date and time, or Unix seconds. */
function validFrom(): number | null {
  const raw = process.env.LICENSE_VALID_FROM?.trim();
  if (!raw) return null;
  const seconds = /^\d{1,11}$/.test(raw) ? Number(raw) : Date.parse(raw) / 1000;
  if (Number.isFinite(seconds)) return seconds;
  if (!warnedValidFrom) {
    warnedValidFrom = true;
    console.error(`[pro] LICENSE_VALID_FROM is not a date, so it is ignored: ${raw}`);
  }
  return null;
}

/**
 * Operator controls for keys that were already handed out, read on every check:
 * LICENSE_REVOKED lists customer, subscription or checkout session ids whose keys stop working, and
 * keys issued before LICENSE_VALID_FROM stop working (set it to the go live time to drop test keys).
 */
export function licenseRevoked(p: Pick<LicensePayload, 'c' | 's' | 'cs' | 't'>): boolean {
  const revoked = (process.env.LICENSE_REVOKED || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (revoked.length && [p.c, p.s, p.cs].some(id => id && revoked.includes(id))) return true;
  const from = validFrom();
  return from !== null && !(p.t >= from);
}
