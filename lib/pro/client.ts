'use client';

// Client side of Pro. There are no accounts: a purchase yields a signed license key
// that is stored on the device (and in backups). The server checks it with Stripe.
import * as React from 'react';
import { config } from '@/lib/config';
import { db } from '@/lib/db/client';
import { useHealthData } from '@/lib/hooks/useHealthData';

const RECHECK_MS = 24 * 60 * 60_000;
const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60_000;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data as T;
}

export function usePro() {
  const { prefs } = useHealthData();
  const enabled = config.proEnabled;
  const hasKey = Boolean(prefs.licenseToken);
  const checkedAt = prefs.licenseCheckedAt ? Date.parse(prefs.licenseCheckedAt) : 0;
  const isPro = !enabled || (hasKey && Date.now() - checkedAt < OFFLINE_GRACE_MS);

  const startCheckout = React.useCallback(async () => {
    const { url } = await post<{ url: string }>('/api/checkout', {});
    window.location.assign(url);
  }, []);

  const activate = React.useCallback(async (input: { token?: string; sessionId?: string }) => {
    const res = await post<{ valid: boolean; token?: string; reason?: string }>('/api/license', input);
    if (!res.valid || !(res.token ?? input.token)) throw new Error(res.reason || 'That license key is not active.');
    await db.updatePreferences({ licenseToken: res.token ?? input.token, licenseCheckedAt: new Date().toISOString() });
  }, []);

  const openPortal = React.useCallback(async () => {
    if (!prefs.licenseToken) return;
    const { url } = await post<{ url: string }>('/api/portal', { token: prefs.licenseToken });
    window.location.assign(url);
  }, [prefs.licenseToken]);

  const removeKey = React.useCallback(async () => {
    await db.updatePreferences({ licenseToken: undefined, licenseCheckedAt: undefined });
  }, []);

  return { enabled, isPro, hasKey, licenseToken: prefs.licenseToken, startCheckout, activate, openPortal, removeKey };
}

/** Rechecks a stored license about once a day. Network failures keep the cached result. */
export function useLicenseRefresh() {
  const { prefs, loading } = useHealthData();
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (!config.proEnabled || loading || ran.current || !prefs.licenseToken) return;
    const last = prefs.licenseCheckedAt ? Date.parse(prefs.licenseCheckedAt) : 0;
    if (Date.now() - last < RECHECK_MS) return;
    ran.current = true;
    post<{ valid: boolean }>('/api/license', { token: prefs.licenseToken })
      .then(async res => {
        if (res.valid) await db.updatePreferences({ licenseCheckedAt: new Date().toISOString() });
        else await db.updatePreferences({ licenseCheckedAt: new Date(0).toISOString() });
      })
      .catch(() => {
        // Offline or server error: keep the cached state until the grace period ends.
      });
  }, [prefs.licenseToken, prefs.licenseCheckedAt, loading]);
}
