'use client';

// Client side of Pro. There are no accounts: a purchase yields a signed license key
// that is stored on the device (and in backups). The server checks it with Stripe.
import * as React from 'react';
import { config } from '@/lib/config';
import { db } from '@/lib/db/client';
import type { UserPreferences } from '@/lib/db/schema';
import { useHealthData } from '@/lib/hooks/useHealthData';

const RECHECK_MS = 24 * 60 * 60_000;
const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60_000;
/** licenseCheckedAt is set to this when the server says a license no longer counts. */
export const LICENSE_ENDED_AT = new Date(0).toISOString();
/** After this long without a final answer, a purchase that is being confirmed can be dismissed. */
export const PENDING_CHECKOUT_PATIENCE_MS = 14 * 24 * 60 * 60_000;
export const CHECKOUT_SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

/** Waits between retries after a failed check or activation. The app also retries when it comes back online. */
const RETRY_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];
const retryDelay = (failures: number) => RETRY_DELAYS_MS[Math.min(Math.max(failures, 1), RETRY_DELAYS_MS.length) - 1];
/** Showing the app again retries at most this often. */
const MIN_RETRY_GAP_MS = 20_000;

export type PendingCheckout = NonNullable<UserPreferences['pendingCheckout']>;

/**
 * none: no key on this device. active: confirmed by the server within the offline grace period.
 * ended: the server said the license no longer counts. unverified: a key that has not been confirmed
 * yet (just restored or pasted) or not for longer than the grace period (offline or server trouble).
 */
export type LicenseState = 'none' | 'active' | 'unverified' | 'ended';

export function licenseState(
  prefs: Pick<UserPreferences, 'licenseToken' | 'licenseCheckedAt'>,
  now = Date.now(),
): LicenseState {
  if (!prefs.licenseToken) return 'none';
  if (prefs.licenseCheckedAt === undefined) return 'unverified';
  const at = Date.parse(prefs.licenseCheckedAt);
  if (at === 0) return 'ended';
  return now - at < OFFLINE_GRACE_MS ? 'active' : 'unverified';
}

type Answer = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

/**
 * A request with no answer by then counts as a network failure. Each purchase and key has only one
 * request running at a time, so without a limit one stalled connection would hold up every retry.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

async function request(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Answer }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const timedOut = () => new TypeError('The server took too long to answer. Please try again.');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (controller.signal.aborted) throw timedOut();
    return { ok: res.ok, status: res.status, data: data && typeof data === 'object' ? (data as Answer) : {} };
  } catch (e) {
    throw controller.signal.aborted ? timedOut() : e;
  } finally {
    clearTimeout(timer);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const { ok, status, data } = await request(url, body);
  if (!ok) {
    // Payment routes send `error`, license answers send `reason`. Either is better than a status code.
    const err = new Error(text(data.error) ?? text(data.reason) ?? `Request failed (${status})`);
    (err as Error & { status?: number }).status = status;
    throw err;
  }
  return data as T;
}

export function usePro() {
  const { prefs } = useHealthData();
  const enabled = config.proEnabled;
  const state = licenseState(prefs);
  const isPro = !enabled || state === 'active';

  const startCheckout = React.useCallback(async () => {
    // Never start a second payment while an earlier one is still being confirmed.
    if ((await db.getPreferences()).pendingCheckout) {
      throw new Error('Your purchase is still being confirmed. Pro will turn on automatically.');
    }
    const { url } = await post<{ url?: string }>('/api/checkout', {});
    if (!url) throw new Error('Checkout is unavailable right now. Please try again later.');
    window.location.assign(url);
  }, []);

  /** Turns on Pro with a pasted license key. */
  const activate = React.useCallback(async (token: string) => {
    const res = await post<{ valid?: boolean; reason?: string }>('/api/license', { token });
    if (res.valid !== true) throw new Error(res.reason || 'That license key is not active.');
    await db.updatePreferences({ licenseToken: token, licenseCheckedAt: new Date().toISOString() });
  }, []);

  const removeKey = React.useCallback(async () => {
    await db.updatePreferences({ licenseToken: undefined, licenseCheckedAt: undefined });
  }, []);

  return {
    enabled,
    isPro,
    hasKey: Boolean(prefs.licenseToken),
    licenseToken: prefs.licenseToken,
    licenseState: state,
    pendingCheckout: prefs.pendingCheckout,
    startCheckout,
    activate,
    removeKey,
  };
}

// ----- License checks -----

export type LicenseCheck = 'valid' | 'ended' | 'error';

const runningChecks = new Map<string, Promise<LicenseCheck>>();

/**
 * Asks the server whether a stored key still counts and records the answer. The answer is written
 * only while the same key is still stored, and that test runs in the same transaction as the write,
 * so a slow answer about an old key can never land on a newer one. Never throws.
 */
export function checkLicense(token: string): Promise<LicenseCheck> {
  const running = runningChecks.get(token);
  if (running) return running;
  const check = (async (): Promise<LicenseCheck> => {
    try {
      const res = await post<{ valid?: unknown }>('/api/license', { token });
      if (typeof res.valid !== 'boolean') return 'error';
      const licenseCheckedAt = res.valid ? new Date().toISOString() : LICENSE_ENDED_AT;
      await db.updatePreferences(cur => (cur.licenseToken === token ? { licenseCheckedAt } : null));
      return res.valid ? 'valid' : 'ended';
    } catch {
      return 'error';
    }
  })().finally(() => runningChecks.delete(token));
  runningChecks.set(token, check);
  return check;
}

/** Calls run when the device comes back online or the app is shown again. Returns a cleanup function. */
function onComeBack(run: () => void, lastTry: () => number) {
  const online = () => run();
  const visible = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastTry() > MIN_RETRY_GAP_MS) run();
  };
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', visible);
  };
}

/**
 * Rechecks a stored license about once a day. A check that fails (offline, server or Stripe trouble)
 * keeps the cached result and is tried again when the device comes back online, when the app is shown
 * again, and on a back off timer. After a definite answer it is not asked again until the next start.
 */
export function useLicenseRefresh() {
  const { prefs, loading } = useHealthData();
  const token = prefs.licenseToken;
  const checkedAt = prefs.licenseCheckedAt;
  const answered = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!config.proEnabled || loading || !token || answered.current === token) return;
    const last = checkedAt ? Date.parse(checkedAt) : 0;
    if (Date.now() - last < RECHECK_MS) return;
    let stopped = false;
    let busy = false;
    let failures = 0;
    let lastTry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      // A key the server already answered for can keep its date (an ended key stays at 1970), so this
      // effect and its listeners can outlive the answer. They must not ask again.
      if (stopped || busy || answered.current === token) return;
      busy = true;
      clearTimeout(timer);
      lastTry = Date.now();
      const result = await checkLicense(token);
      busy = false;
      if (result !== 'error') answered.current = token;
      if (stopped || result !== 'error') return;
      failures += 1;
      timer = setTimeout(run, retryDelay(failures));
    };
    const stopListening = onComeBack(run, () => lastTry);
    void run();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stopListening();
    };
  }, [token, checkedAt, loading]);
}

// ----- Finishing a checkout -----

export type ActivationOutcome =
  | { state: 'active' }
  /** No final answer yet. The purchase stays saved and the app asks again later. */
  | { state: 'pending'; message: string }
  /** A final answer. The saved purchase is dropped. */
  | { state: 'failed'; message: string }
  /** Nothing to do. This purchase was already activated, dropped or replaced. */
  | { state: 'done' };

const STILL_CONFIRMING = 'We could not confirm it yet. The app will keep trying automatically.';

const runningCheckouts = new Map<string, Promise<ActivationOutcome>>();
const lastCheckoutTry = new Map<string, number>();

/** Saves the checkout Stripe returned with, before anything else, so activation can be retried until it works. */
export async function savePendingCheckout(sessionId: string): Promise<void> {
  await db.updatePreferences(cur =>
    cur.pendingCheckout?.sessionId === sessionId
      ? null
      : { pendingCheckout: { sessionId, since: new Date().toISOString() } },
  );
}

/** Forgets a saved checkout, if it is still the saved one. */
export async function forgetPendingCheckout(sessionId: string): Promise<void> {
  await db.updatePreferences(cur =>
    cur.pendingCheckout?.sessionId === sessionId ? { pendingCheckout: undefined } : null,
  );
}

/**
 * True when a purchase has waited longer than the app's patience. The app still checks it when it
 * starts and when it comes back online, but stops its timer, and the person may dismiss it and buy again.
 */
export function pendingCheckoutOverdue(pending: PendingCheckout, now = Date.now()): boolean {
  return !(now - Date.parse(pending.since) < PENDING_CHECKOUT_PATIENCE_MS);
}

/** True when an attempt for this purchase finished in the last few seconds. */
export function checkoutTriedRecently(sessionId: string, now = Date.now()): boolean {
  return now - (lastCheckoutTry.get(sessionId) ?? 0) < MIN_RETRY_GAP_MS;
}

/**
 * Exchanges a saved checkout for a license key. Only one request per purchase runs at a time, and
 * callers that ask while it runs share its answer. Network trouble, server errors, rate limits and
 * payments that are still processing keep the purchase saved. Only an explicit refusal from the
 * server drops it. Never throws.
 */
export function finishCheckout(sessionId: string): Promise<ActivationOutcome> {
  const running = runningCheckouts.get(sessionId);
  if (running) return running;
  const attempt = runCheckout(sessionId)
    .catch((): ActivationOutcome => ({ state: 'pending', message: STILL_CONFIRMING }))
    .finally(() => {
      runningCheckouts.delete(sessionId);
      lastCheckoutTry.set(sessionId, Date.now());
    });
  runningCheckouts.set(sessionId, attempt);
  return attempt;
}

async function runCheckout(sessionId: string): Promise<ActivationOutcome> {
  if ((await db.getPreferences()).pendingCheckout?.sessionId !== sessionId) return { state: 'done' };
  let answer: Awaited<ReturnType<typeof request>>;
  try {
    answer = await request('/api/license', { sessionId });
  } catch {
    return { state: 'pending', message: STILL_CONFIRMING };
  }
  const { ok, status, data } = answer;
  const token = text(data.token);
  if (ok && data.valid === true && token) {
    // A key that was paid for is always kept, even if the purchase was dismissed meanwhile.
    await db.updatePreferences(cur => ({
      licenseToken: token,
      licenseCheckedAt: new Date().toISOString(),
      pendingCheckout: cur.pendingCheckout?.sessionId === sessionId ? undefined : cur.pendingCheckout,
    }));
    return { state: 'active' };
  }
  const final = data.valid === false && data.pending !== true && status !== 202 && status !== 429 && status < 500;
  if (!final) {
    return { state: 'pending', message: (status === 202 && text(data.reason)) || STILL_CONFIRMING };
  }
  await forgetPendingCheckout(sessionId);
  return { state: 'failed', message: text(data.reason) ?? 'We could not turn on Pro for this purchase.' };
}

/**
 * Keeps trying to turn a saved checkout into a license key until it works or gets a final answer:
 * when the app starts, when the device comes back online or the app is shown again, and on a back
 * off timer while it is open (for the first 14 days). onSettled hears about each final answer. Pass
 * a stable function.
 */
export function usePendingCheckoutRetry(
  onSettled: (outcome: Extract<ActivationOutcome, { state: 'active' | 'failed' }>, sessionId: string) => void,
) {
  const { prefs, loading } = useHealthData();
  const sessionId = prefs.pendingCheckout?.sessionId;
  const overdue = prefs.pendingCheckout ? pendingCheckoutOverdue(prefs.pendingCheckout) : false;
  React.useEffect(() => {
    if (loading || !sessionId) return;
    let stopped = false;
    let busy = false;
    let failures = 0;
    let lastTry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stopped || busy) return;
      busy = true;
      clearTimeout(timer);
      lastTry = Date.now();
      const outcome = await finishCheckout(sessionId);
      busy = false;
      if (outcome.state === 'active' || outcome.state === 'failed') onSettled(outcome, sessionId);
      if (stopped || outcome.state !== 'pending' || overdue) return;
      failures += 1;
      timer = setTimeout(run, retryDelay(failures));
    };
    const stopListening = onComeBack(run, () => lastTry);
    // Right after returning from Stripe an attempt has just run. Wait a little before the next one.
    if (checkoutTriedRecently(sessionId)) timer = setTimeout(run, retryDelay(1));
    else void run();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stopListening();
    };
  }, [loading, sessionId, overdue, onSettled]);
}
