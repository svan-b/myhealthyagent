'use client';

// Client side of Pro. There are no accounts: a purchase yields a signed license key
// that is stored on the device (and in backups). The server checks it with Stripe.
import * as React from 'react';
import { config } from '@/lib/config';
import { db } from '@/lib/db/client';
import type { UserPreferences } from '@/lib/db/schema';
import { useHealthData } from '@/lib/hooks/useHealthData';

/** A purchase still being confirmed. */
export type PendingCheckout = NonNullable<UserPreferences['pendingCheckouts']>[number];

/** How long a license answer counts before the app asks again. */
export const RECHECK_MS = 24 * 60 * 60_000;
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

const NO_PURCHASES: PendingCheckout[] = [];

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
    if ((await db.getPreferences()).pendingCheckouts) {
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
    /** Purchases still being confirmed, oldest first. Usually none or one. */
    pendingCheckouts: prefs.pendingCheckouts ?? NO_PURCHASES,
    startCheckout,
    activate,
    removeKey,
  };
}

// ----- License checks -----

export type LicenseCheck = 'valid' | 'ended' | 'error';

const runningChecks = new Map<string, Promise<LicenseCheck>>();
/** When the server last gave a definite answer about each key while the app was open. */
const answeredAt = new Map<string, number>();

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
      let stored = false;
      await db.updatePreferences(cur => {
        if (cur.licenseToken !== token) return null;
        stored = true;
        return { licenseCheckedAt };
      });
      if (stored) answeredAt.set(token, Date.now());
      return res.valid ? 'valid' : 'ended';
    } catch {
      return 'error';
    }
  })().finally(() => runningChecks.delete(token));
  runningChecks.set(token, check);
  return check;
}

/**
 * When the server last answered about a key: its stored check time, or a later answer while the app
 * was open. An ended key keeps its 1970 check time, so only the second one says when it was asked.
 */
function lastAnswer(token: string, checkedAt: string | undefined): number {
  return Math.max((checkedAt && Date.parse(checkedAt)) || 0, answeredAt.get(token) ?? 0);
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
 * Checks a stored license again once a day has passed since the server last answered: when the app
 * starts, when it comes back to the foreground or online, and when it stays open in the foreground
 * that long. Until then none of these sends anything. A check that fails (offline, server or Stripe
 * trouble) keeps the cached result, so Pro keeps working for the offline grace period, and is tried
 * again on a back off timer and on the same events.
 */
export function useLicenseRefresh() {
  const { prefs, loading } = useHealthData();
  const token = prefs.licenseToken;
  const checkedAt = prefs.licenseCheckedAt;
  React.useEffect(() => {
    if (!config.proEnabled || loading) return;
    if (!token) {
      // The key was removed. If it is stored again, from a backup say, it is checked again.
      answeredAt.clear();
      return;
    }
    let stopped = false;
    let busy = false;
    let failures = 0;
    let lastTry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // If the app is still in the foreground when the next check is due, check then. A hidden app
    // checks when it is shown again.
    const later = (wait: number) => {
      timer = setTimeout(
        () => {
          if (document.visibilityState === 'visible') void run();
        },
        Math.min(wait, RECHECK_MS),
      );
    };
    const run = async () => {
      if (stopped || busy) return;
      clearTimeout(timer);
      const wait = lastAnswer(token, checkedAt) + RECHECK_MS - Date.now();
      if (wait > 0) return later(wait);
      busy = true;
      lastTry = Date.now();
      const result = await checkLicense(token);
      busy = false;
      if (stopped) return;
      if (result === 'error') {
        failures += 1;
        timer = setTimeout(run, retryDelay(failures));
      } else {
        failures = 0;
        later(RECHECK_MS);
      }
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
  /** Nothing to do. This purchase is no longer saved: it was activated, dropped, dismissed or erased. */
  | { state: 'done' };

const STILL_CONFIRMING = 'We could not confirm it yet. The app will keep trying automatically.';

const runningCheckouts = new Map<string, Promise<ActivationOutcome>>();
const lastCheckoutTry = new Map<string, number>();

const isSaved = (prefs: Pick<UserPreferences, 'pendingCheckouts'>, sessionId: string) =>
  Boolean(prefs.pendingCheckouts?.some(p => p.sessionId === sessionId));

/** The saved purchases without this one. Undefined when none are left. */
function without(list: PendingCheckout[] | undefined, sessionId: string): PendingCheckout[] | undefined {
  const rest = (list ?? []).filter(p => p.sessionId !== sessionId);
  return rest.length ? rest : undefined;
}

/**
 * Saves a checkout Stripe returned with, before anything else, so activation can be retried until it
 * works. Purchases saved earlier stay: a link with another checkout id, sent by someone or opened
 * from an old return page, never replaces a purchase that is still being confirmed.
 */
export async function savePendingCheckout(sessionId: string): Promise<void> {
  await db.updatePreferences(cur =>
    isSaved(cur, sessionId)
      ? null
      : { pendingCheckouts: [...(cur.pendingCheckouts ?? []), { sessionId, since: new Date().toISOString() }] },
  );
}

/** Forgets a saved checkout. Other saved purchases stay. */
export async function forgetPendingCheckout(sessionId: string): Promise<void> {
  await db.updatePreferences(cur =>
    isSaved(cur, sessionId) ? { pendingCheckouts: without(cur.pendingCheckouts, sessionId) } : null,
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
 * callers that ask while it runs share its answer. What keeps the purchase saved and what drops it
 * is up to finalAnswer below. Never throws.
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
  if (!isSaved(await db.getPreferences(), sessionId)) return { state: 'done' };
  let answer: Awaited<ReturnType<typeof request>>;
  try {
    answer = await request('/api/license', { sessionId });
  } catch {
    return { state: 'pending', message: STILL_CONFIRMING };
  }
  const { ok, status, data } = answer;
  const token = text(data.token);
  if (ok && data.valid === true && token) {
    // The key is stored only while the purchase is still saved, tested in the same transaction as the
    // write. A purchase dismissed, or erased with Delete all data, while this answer was on its way
    // stays gone, and its key with it.
    let stored = false;
    await db.updatePreferences(cur => {
      if (!isSaved(cur, sessionId)) return null;
      stored = true;
      return {
        licenseToken: token,
        licenseCheckedAt: new Date().toISOString(),
        pendingCheckouts: without(cur.pendingCheckouts, sessionId),
      };
    });
    return stored ? { state: 'active' } : { state: 'done' };
  }
  if (!finalAnswer(status, data)) {
    return { state: 'pending', message: (status === 202 && text(data.reason)) || STILL_CONFIRMING };
  }
  await forgetPendingCheckout(sessionId);
  return { state: 'failed', message: text(data.reason) ?? 'We could not turn on Pro for this purchase.' };
}

/**
 * Whether an answer that did not activate a purchase is final, so the purchase is dropped.
 *
 * With Pro on, only an explicit refusal is. Server errors, rate limits and payments that are still
 * processing are waited out, so a paid purchase is never lost to a passing problem.
 *
 * With Pro off there is nothing to unlock, and the server normally has no payments set up, so it
 * answers 503. There the first answer from the server is final, unless it says the payment is still
 * processing. This ends a purchase that only came from a link, which nothing on screen would show or
 * let anyone dismiss. As in a Pro build, a request that got no answer at all, such as when offline,
 * is tried again, which is also what lets the checkout return be tested end to end in a free build.
 */
function finalAnswer(status: number, data: Answer): boolean {
  if (!config.proEnabled) return status !== 202;
  return data.valid === false && data.pending !== true && status !== 202 && status !== 429 && status < 500;
}

/**
 * Keeps trying to turn one saved checkout into a license key until it works or gets a final answer:
 * right away, when the device comes back online or the app is shown again, and on a back off timer
 * while the app is open (for the first 14 days). Call it once for each saved purchase. onSettled hears
 * about the final answer. Pass a stable function.
 */
export function usePendingCheckoutRetry(
  pending: PendingCheckout,
  onSettled: (outcome: Extract<ActivationOutcome, { state: 'active' | 'failed' }>, sessionId: string) => void,
) {
  const { sessionId } = pending;
  const overdue = pendingCheckoutOverdue(pending);
  React.useEffect(() => {
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
  }, [sessionId, overdue, onSettled]);
}
