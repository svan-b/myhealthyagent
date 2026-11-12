import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as v8 from 'node:v8';
import * as React from 'react';
import { act } from 'react';

const h = React.createElement;
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { config } from '@/lib/config';
import { db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import { HealthDataProvider } from '@/lib/hooks/useHealthData';
import * as pro from '@/lib/pro/client';
import { LicenseKeyForm, UpgradeCard } from '@/app/components/pro/Upgrade';
import { DeleteSection, ProSection } from '@/app/components/settings/SettingsSheet';

jest.mock('@/lib/config', () => ({
  config: {
    appName: 'myHealthyAgent',
    proEnabled: true,
    proPriceLabel: '$19 once',
    supportEmail: 'help@example.com',
    billingPortalUrl: 'https://billing.stripe.com/p/login/test_portal',
    freeTriggerFindings: 1,
  },
  proSetupWarning: () => null,
  logProSetupWarning: () => {},
}));

jest.mock('sonner', () => {
  const toast = Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    loading: jest.fn(),
    dismiss: jest.fn(),
  });
  return { toast };
});

// jsdom has neither structuredClone (fake-indexeddb needs it) nor React's act environment flag.
(globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) => v8.deserialize(v8.serialize(v));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = config as { -readonly [K in keyof typeof config]: (typeof config)[K] };
const PORTAL = 'https://billing.stripe.com/p/login/test_portal';
const OLD_KEY = 'mha1.old.key';
const NEW_KEY = 'mha1.new.key';
const SID = 'cs_live_a1b2c3d4e5f6g7h8';
const EPOCH = new Date(0).toISOString();

type Reply = { status: number; body?: unknown } | Error;
let calls: Record<string, unknown>[] = [];
let respond: (body: Record<string, unknown>) => Reply | Promise<Reply> = () => new TypeError('Failed to fetch');

global.fetch = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  calls.push(body);
  const reply = await respond(body);
  if (reply instanceof Error) throw reply;
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    json: async () => {
      if (typeof reply.body !== 'object') throw new SyntaxError('Unexpected token');
      return reply.body;
    },
  } as Response;
}) as typeof fetch;

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
  calls = [];
  respond = () => new TypeError('Failed to fetch');
  settings.billingPortalUrl = PORTAL;
  settings.supportEmail = 'help@example.com';
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
});

const pause = (ms = 10) => act(async () => new Promise<void>(r => setTimeout(r, ms)));

/** Waits inside act until check passes, then lets whatever was still running finish. */
async function waitFor(check: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    let ok = false;
    await act(async () => {
      ok = await check();
      await new Promise<void>(r => setTimeout(r, 10));
    });
    if (ok) return pause(20);
    if (Date.now() > end) throw new Error('Timed out waiting');
  }
}

async function render(ui: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(h(HealthDataProvider, null, ui)));
  // Let the provider read the database.
  await pause(30);
}

const text = () => container.textContent ?? '';
const button = (name: string | RegExp) =>
  Array.from(container.querySelectorAll('button')).find(b =>
    typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? ''),
  );
const link = (name: string) => Array.from(container.querySelectorAll('a')).find(a => a.textContent?.trim() === name);
const click = (el: HTMLElement | undefined) =>
  act(async () => {
    if (!el) throw new Error('Nothing to click');
    el.click();
  });
async function type(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('No input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function Refresh() {
  pro.useLicenseRefresh();
  return null;
}

describe('license checks', () => {
  it('a late answer about the old key does not turn off a key bought meanwhile (F14)', async () => {
    await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: EPOCH });
    let answerOld!: (r: Reply) => void;
    respond = body => (body.token === OLD_KEY ? new Promise<Reply>(r => (answerOld = r)) : { status: 500 });
    await render(h(Refresh));
    await waitFor(() => calls.length === 1);
    expect(calls[0]).toEqual({ token: OLD_KEY });

    // The renewal finishes first and stores the new key, as activation does.
    await act(() => db.updatePreferences({ licenseToken: NEW_KEY, licenseCheckedAt: new Date().toISOString() }));
    // Then the answer about the old, lapsed key arrives.
    await act(async () => answerOld({ status: 200, body: { valid: false, reason: 'This subscription has ended.' } }));
    await pause(50);

    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBe(NEW_KEY);
    expect(Date.parse(prefs.licenseCheckedAt!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('retries a failed check when the device comes back online (F35)', async () => {
    // A key restored from a backup has never been checked on this device.
    await db.updatePreferences({ licenseToken: OLD_KEY });
    await render(h(Refresh));
    await waitFor(() => calls.length === 1);
    await pause(30);
    expect((await db.getPreferences()).licenseCheckedAt).toBeUndefined();

    respond = () => ({ status: 200, body: { valid: true } });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(async () => Boolean((await db.getPreferences()).licenseCheckedAt));
    expect(calls).toHaveLength(2);
    expect(Date.parse((await db.getPreferences()).licenseCheckedAt!)).toBeGreaterThan(0);
  });

  it('server errors are not taken as a final answer (F35)', async () => {
    await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: '2026-01-01T00:00:00.000Z' });
    respond = () => ({ status: 502, body: { error: 'Something went wrong. Please try again.' } });
    expect(await pro.checkLicense(OLD_KEY)).toBe('error');
    respond = () => ({ status: 200, body: 'not json' });
    expect(await pro.checkLicense(OLD_KEY)).toBe('error');
    expect((await db.getPreferences()).licenseCheckedAt).toBe('2026-01-01T00:00:00.000Z');
    respond = () => ({ status: 200, body: { valid: false } });
    expect(await pro.checkLicense(OLD_KEY)).toBe('ended');
    expect((await db.getPreferences()).licenseCheckedAt).toBe(EPOCH);
  });

  it('tells a key that ended apart from one that could not be checked (F35)', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(pro.licenseState({}, now)).toBe('none');
    expect(pro.licenseState({ licenseToken: 'k' }, now)).toBe('unverified');
    expect(pro.licenseState({ licenseToken: 'k', licenseCheckedAt: EPOCH }, now)).toBe('ended');
    expect(pro.licenseState({ licenseToken: 'k', licenseCheckedAt: '2026-11-11T12:00:00Z' }, now)).toBe('active');
    expect(pro.licenseState({ licenseToken: 'k', licenseCheckedAt: '2026-09-01T12:00:00Z' }, now)).toBe('unverified');
  });
});

describe('finishing a checkout (F04, F44)', () => {
  it('keeps the purchase through network errors, server errors, rate limits and processing payments', async () => {
    await pro.savePendingCheckout(SID);
    const replies: Reply[] = [
      new TypeError('Failed to fetch'),
      { status: 502, body: { error: 'Something went wrong. Please try again.' } },
      { status: 503, body: { error: 'Payments are not available right now.' } },
      { status: 429, body: { error: 'Too many attempts. Please wait a minute.' } },
      { status: 200, body: 'an error page from a proxy' },
      { status: 202, body: { valid: false, pending: true, reason: 'Your payment is still processing.' } },
    ];
    for (const reply of replies) {
      respond = () => reply;
      const outcome = await pro.finishCheckout(SID);
      expect(outcome.state).toBe('pending');
      expect((await db.getPreferences()).pendingCheckout?.sessionId).toBe(SID);
    }
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'pending', message: 'Your payment is still processing.' });

    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'active' });
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBe(NEW_KEY);
    expect(prefs.pendingCheckout).toBeUndefined();
    expect(pro.licenseState(prefs)).toBe('active');
    expect(calls.every(c => c.sessionId === SID)).toBe(true);
  });

  it('drops the purchase only on a final refusal, and passes on the reason', async () => {
    await pro.savePendingCheckout(SID);
    respond = () => ({
      status: 402,
      body: { valid: false, reason: 'That checkout was not completed, so you were not charged.' },
    });
    expect(await pro.finishCheckout(SID)).toEqual({
      state: 'failed',
      message: 'That checkout was not completed, so you were not charged.',
    });
    expect((await db.getPreferences()).pendingCheckout).toBeUndefined();
    // Nothing is left to do, and no request is sent.
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'done' });
    expect(calls).toHaveLength(1);
  });

  it('tries a saved purchase again when the app starts and when it comes back online', async () => {
    const sid = 'cs_live_retrywhenonline1';
    await pro.savePendingCheckout(sid);
    const settled = jest.fn();
    function Retry() {
      pro.usePendingCheckoutRetry(settled);
      return null;
    }
    await render(h(Retry));
    await waitFor(() => calls.length === 1);
    expect(calls[0]).toEqual({ sessionId: sid });
    expect((await db.getPreferences()).pendingCheckout?.sessionId).toBe(sid);
    expect(settled).not.toHaveBeenCalled();

    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(async () => (await db.getPreferences()).licenseToken === NEW_KEY);
    expect(settled).toHaveBeenCalledWith({ state: 'active' }, sid);
    expect((await db.getPreferences()).pendingCheckout).toBeUndefined();
  });

  it('asks once when several callers try at the same time', async () => {
    await pro.savePendingCheckout(SID);
    let answer!: (r: Reply) => void;
    respond = () => new Promise<Reply>(r => (answer = r));
    const both = Promise.all([pro.finishCheckout(SID), pro.finishCheckout(SID)]);
    await waitFor(() => calls.length === 1);
    answer({ status: 200, body: { valid: true, token: NEW_KEY } });
    expect(await both).toEqual([{ state: 'active' }, { state: 'active' }]);
    expect(calls).toHaveLength(1);
  });

  it('shows the reason a request failed instead of a status code (F44)', async () => {
    let api!: ReturnType<typeof pro.usePro>;
    function Probe() {
      api = pro.usePro();
      return null;
    }
    await render(h(Probe));
    respond = () => ({ status: 402, body: { valid: false, reason: 'That checkout has not been paid yet.' } });
    await expect(api.activate('mha1.some.key')).rejects.toThrow('That checkout has not been paid yet.');
  });
});

describe('Pro screens', () => {
  it('shows no buy button while a purchase is being confirmed, and Retry finishes it (F04)', async () => {
    await pro.savePendingCheckout(SID);
    await render(h(UpgradeCard));
    expect(text()).toContain('Finishing your Pro purchase');
    expect(text()).toContain(SID);
    expect(text()).toContain('help@example.com');
    expect(button(/Get Pro/)).toBeUndefined();

    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    await click(button('Retry activation'));
    await waitFor(async () => (await db.getPreferences()).licenseToken === NEW_KEY);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Pro is active'), expect.anything());
  });

  it('refuses to start a second payment while one is being confirmed (F04)', async () => {
    await pro.savePendingCheckout(SID);
    let api!: ReturnType<typeof pro.usePro>;
    function Probe() {
      api = pro.usePro();
      return null;
    }
    await render(h(Probe));
    await expect(api.startCheckout()).rejects.toThrow(/still being confirmed/);
    expect(calls).toHaveLength(0);
  });

  it('after two weeks without an answer the purchase can be dismissed, then bought again (F04)', async () => {
    await db.updatePreferences({ pendingCheckout: { sessionId: SID, since: '2026-01-01T00:00:00.000Z' } });
    await render(h(UpgradeCard));
    expect(text()).toContain('We could not confirm your Pro purchase');
    await click(button('Dismiss'));
    await waitFor(() => Boolean(button(/Get Pro, \$19 once/)));
    expect((await db.getPreferences()).pendingCheckout).toBeUndefined();
  });

  it('a key that could not be checked yet offers Check again instead of a buy button (F35)', async () => {
    await db.updatePreferences({ licenseToken: OLD_KEY });
    await render(h(UpgradeCard));
    expect(text()).toContain('We could not confirm your Pro license yet');
    expect(button(/Get Pro/)).toBeUndefined();
    respond = () => ({ status: 200, body: { valid: true } });
    await click(button('Check again'));
    await waitFor(async () => Boolean((await db.getPreferences()).licenseCheckedAt));
    expect(toast.success).toHaveBeenCalledWith('Pro is active on this device');
  });

  it('the license key box also takes a checkout reference from support (F04)', async () => {
    await render(h(LicenseKeyForm));
    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    await type(container.querySelector('input'), SID);
    await click(button('Activate'));
    await waitFor(async () => (await db.getPreferences()).licenseToken === NEW_KEY);
    expect(calls).toEqual([{ sessionId: SID }]);
  });

  it('Manage billing is a link to the Stripe portal login in every state, never a request with the key (F17, F35)', async () => {
    const states = [
      { name: 'active', prefs: { licenseToken: OLD_KEY, licenseCheckedAt: new Date().toISOString() } },
      { name: 'ended', prefs: { licenseToken: OLD_KEY, licenseCheckedAt: EPOCH } },
      { name: 'unverified', prefs: { licenseToken: OLD_KEY, licenseCheckedAt: '2025-01-01T00:00:00.000Z' } },
      { name: 'no key', prefs: {} },
    ];
    for (const state of states) {
      resetDBConnection();
      globalThis.indexedDB = new IDBFactory();
      await db.updatePreferences(state.prefs);
      await render(h(ProSection));
      const manage = link('Manage billing');
      expect({ state: state.name, href: manage?.getAttribute('href') }).toEqual({ state: state.name, href: PORTAL });
      expect(manage?.getAttribute('target')).toBe('_blank');
      expect(button('Manage billing')).toBeUndefined();
      if (state.name === 'ended')
        expect(text()).toContain('Your Pro license is no longer active. Renew below or manage billing.');
      if (state.name === 'unverified') expect(text()).not.toContain('no longer active');
      await act(async () => root?.unmount());
      container.remove();
    }
    root = null;
    expect(calls.filter(c => 'token' in c && !('sessionId' in c))).toHaveLength(0);
  });

  it('without a portal link, billing help points to the support email (F17)', async () => {
    settings.billingPortalUrl = '';
    await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: EPOCH });
    await render(h(ProSection));
    expect(link('Manage billing')).toBeUndefined();
    expect(text()).toContain('Your Pro license is no longer active. Renew below.');
    expect(text()).toContain('To cancel or for billing questions, email help@example.com.');
  });

  it('Remove license key from this device asks first, then removes it (F15)', async () => {
    await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: new Date().toISOString() });
    await render(h(ProSection));
    await click(button('Remove license key from this device'));
    expect(text()).toContain('Copy the key first');
    expect((await db.getPreferences()).licenseToken).toBe(OLD_KEY);
    await click(button('Remove key'));
    await waitFor(async () => !(await db.getPreferences()).licenseToken);
    await waitFor(() => Boolean(button(/Get Pro/)));
  });

  it('Delete all data removes the key unless the person keeps it (F15)', async () => {
    for (const keep of [false, true]) {
      resetDBConnection();
      globalThis.indexedDB = new IDBFactory();
      await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: new Date().toISOString() });
      await render(h(DeleteSection, { onDone: () => {} }));
      await click(button('Delete all data'));
      const box = container.querySelector<HTMLInputElement>('input[type=checkbox]');
      expect(box?.checked).toBe(false);
      expect(text()).toContain('your Pro license key will be erased');
      expect(text()).toContain(OLD_KEY);
      expect(button('Copy key')).toBeDefined();
      if (keep) {
        await click(box!);
        expect(text()).toContain('Anyone using this browser can see it');
      }
      await type(container.querySelector<HTMLInputElement>('#confirm-delete'), 'DELETE');
      await click(button('Delete'));
      await waitFor(() => (toast.success as jest.Mock).mock.calls.length > 0);
      expect((await db.getPreferences()).licenseToken).toBe(keep ? OLD_KEY : undefined);
      expect(toast.success).toHaveBeenCalledWith(
        keep ? 'All data deleted. Your Pro license key was kept.' : 'All data deleted',
      );
      jest.clearAllMocks();
      await act(async () => root?.unmount());
      container.remove();
    }
    root = null;
  });
});
