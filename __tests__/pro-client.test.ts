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
import { HealthDataProvider, useHealthData } from '@/lib/hooks/useHealthData';
import * as pro from '@/lib/pro/client';
import { LicenseKeyForm, UpgradeCard } from '@/app/components/pro/Upgrade';
import { announceActivation, supportText } from '@/app/components/pro/activation';
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
// New keys for each test, because the app remembers answers about a key while it is open.
let keys = 0;
let OLD_KEY = '';
let NEW_KEY = '';
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
  keys += 1;
  OLD_KEY = `mha1.old${keys}.key`;
  NEW_KEY = `mha1.new${keys}.key`;
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
  calls = [];
  respond = () => new TypeError('Failed to fetch');
  settings.proEnabled = true;
  settings.billingPortalUrl = PORTAL;
  settings.supportEmail = 'help@example.com';
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  jest.useRealTimers();
});

const pause = (ms = 10) => act(async () => new Promise<void>(r => setTimeout(r, ms)));

/** Waits inside act until check passes, then lets whatever was still running finish. */
async function waitFor(check: () => boolean | Promise<boolean>, ms = 3000) {
  // performance.now, because some tests stop the Date clock.
  const end = performance.now() + ms;
  for (;;) {
    let ok = false;
    await act(async () => {
      ok = await check();
      await new Promise<void>(r => setTimeout(r, 10));
    });
    if (ok) return pause(20);
    if (performance.now() > end) throw new Error('Timed out waiting');
  }
}

/** Replaces only the Date clock. Timers stay real, so the database and React keep working. */
function fakeClock(start: number) {
  jest.useFakeTimers({
    now: start,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  return (t: number) => jest.setSystemTime(t);
}

/** The app is shown again, or the device comes back online. */
const show = () =>
  act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
const online = () =>
  act(async () => {
    window.dispatchEvent(new Event('online'));
  });

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

type Settled = Parameters<typeof pro.usePendingCheckoutRetry>[1];

/** Retries every saved purchase, the way AppShell does. */
function Retries({ onSettled }: { onSettled: Settled }) {
  const { prefs } = useHealthData();
  return h(
    React.Fragment,
    null,
    (prefs.pendingCheckouts ?? []).map(p => h(RetryOne, { key: p.sessionId, pending: p, onSettled })),
  );
}
function RetryOne({ pending, onSettled }: { pending: pro.PendingCheckout; onSettled: Settled }) {
  pro.usePendingCheckoutRetry(pending, onSettled);
  return null;
}

/** Session ids of the purchases saved on the device, oldest first. */
const saved = async () => ((await db.getPreferences()).pendingCheckouts ?? []).map(p => p.sessionId);

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
    // Nobody asks again: not about the old key, and not about the new one, which was just confirmed.
    expect(calls).toHaveLength(1);
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

  it('does not ask again after a definite answer, even when the device comes back online (F35)', async () => {
    // A key the server already said has ended keeps its 1970 date when it is told so again.
    await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: EPOCH });
    respond = () => ({ status: 200, body: { valid: false, reason: 'This subscription has ended.' } });
    await render(h(Refresh));
    await waitFor(() => calls.length === 1);
    await pause(50);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      await pause(30);
    }
    expect(calls).toHaveLength(1);
    expect((await db.getPreferences()).licenseCheckedAt).toBe(EPOCH);
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
      expect(await saved()).toEqual([SID]);
    }
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'pending', message: 'Your payment is still processing.' });

    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'active' });
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBe(NEW_KEY);
    expect(prefs.pendingCheckouts).toBeUndefined();
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
    expect((await db.getPreferences()).pendingCheckouts).toBeUndefined();
    // Nothing is left to do, and no request is sent.
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'done' });
    expect(calls).toHaveLength(1);
  });

  it('tries a saved purchase again when the app starts and when it comes back online', async () => {
    const sid = 'cs_live_retrywhenonline1';
    await pro.savePendingCheckout(sid);
    const settled = jest.fn();
    await render(h(Retries, { onSettled: settled }));
    await waitFor(() => calls.length === 1);
    expect(calls[0]).toEqual({ sessionId: sid });
    expect(await saved()).toEqual([sid]);
    expect(settled).not.toHaveBeenCalled();

    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(async () => (await db.getPreferences()).licenseToken === NEW_KEY);
    expect(settled).toHaveBeenCalledWith({ state: 'active' }, sid);
    expect((await db.getPreferences()).pendingCheckouts).toBeUndefined();
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

  it('a request that never gets an answer is given up, so the next try can run (F04, F35)', async () => {
    await pro.savePendingCheckout(SID);
    // A stalled connection. Fetch only settles when the app gives up on it.
    let sent = 0;
    const stalled = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        sent++;
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      });
    (global.fetch as jest.Mock).mockImplementationOnce(stalled).mockImplementationOnce(stalled);
    // Catch the time limit's timer instead of waiting 30 seconds for it.
    const realSetTimeout = global.setTimeout;
    const limits: (() => void)[] = [];
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === pro.REQUEST_TIMEOUT_MS) {
        limits.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);
    try {
      const first = pro.finishCheckout(SID);
      await waitFor(() => sent === 1 && limits.length === 1, 1000);
      // Until the limit, everyone shares the stalled request.
      expect(pro.finishCheckout(SID)).toBe(first);
      limits[0]();
      expect(await first).toEqual({ state: 'pending', message: expect.stringContaining('keep trying') });
      expect(await saved()).toEqual([SID]);

      // A license check that stalls is given up the same way.
      await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: '2026-01-01T00:00:00.000Z' });
      const check = pro.checkLicense(OLD_KEY);
      await waitFor(() => sent === 2 && limits.length === 2, 1000);
      limits[1]();
      expect(await check).toBe('error');
    } finally {
      spy.mockRestore();
    }
    // The next try sends a new request.
    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'active' });
    expect(sent).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it('a made up checkout link cannot put its own words in the support message (F04, F44)', () => {
    expect(supportText('x. URGENT call +1 555 0100 to cancel')).toBe('If you were charged, email help@example.com.');
    expect(supportText(SID)).toBe(`If you were charged, email help@example.com and quote reference ${SID}.`);
    settings.supportEmail = '';
    expect(supportText(SID, 'If this does not resolve')).toBe(
      `If this does not resolve, contact support and quote reference ${SID}.`,
    );
  });

  it('a payment that is still processing is not announced as received (F04)', () => {
    const message = 'Your payment is still processing. Pro will turn on automatically when it clears.';
    announceActivation({ state: 'pending', message }, SID, { showPending: true });
    const [title, options] = (toast.info as jest.Mock).mock.calls[0] as [string, { description: string }];
    expect(title).not.toMatch(/payment received/i);
    expect(options.description).toContain(message);
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
    // A bank payment may still be on its way, so the card does not say the money arrived.
    expect(text()).not.toMatch(/payment received/i);
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
    await db.updatePreferences({ pendingCheckouts: [{ sessionId: SID, since: '2026-01-01T00:00:00.000Z' }] });
    await render(h(UpgradeCard));
    expect(text()).toContain('We could not confirm your Pro purchase');
    await click(button('Dismiss'));
    await waitFor(() => Boolean(button(/Get Pro, \$19 once/)));
    expect((await db.getPreferences()).pendingCheckouts).toBeUndefined();
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

describe('another checkout link while a purchase is being confirmed (P1)', () => {
  // New ids for each test, because the app remembers recent attempts for each purchase.
  let MINE = '';
  let LINK = '';
  beforeEach(() => {
    MINE = `cs_live_mypurchase${keys}x000001`;
    LINK = `cs_live_fromsomelink${keys}x0002`;
  });

  it('never replaces the saved purchase, and the new link is handled too', async () => {
    await pro.savePendingCheckout(MINE);
    // Offline: the purchase stays saved.
    expect((await pro.finishCheckout(MINE)).state).toBe('pending');

    // A link with another checkout id arrives, from someone else or an old return page.
    await pro.savePendingCheckout(LINK);
    respond = body =>
      body.sessionId === LINK
        ? { status: 200, body: { valid: false, reason: 'We could not find that purchase.' } }
        : { status: 200, body: { valid: true, token: NEW_KEY } };
    expect(await pro.finishCheckout(LINK)).toEqual({ state: 'failed', message: 'We could not find that purchase.' });

    // The real purchase was kept and still activates.
    expect(await pro.finishCheckout(MINE)).toEqual({ state: 'active' });
    expect((await db.getPreferences()).licenseToken).toBe(NEW_KEY);
    expect(calls).toEqual([{ sessionId: MINE }, { sessionId: LINK }, { sessionId: MINE }]);
  });

  it('keeps trying each saved purchase on its own until it settles', async () => {
    await pro.savePendingCheckout(MINE);
    await pro.savePendingCheckout(LINK);
    await pro.savePendingCheckout(MINE);
    expect(await saved()).toEqual([MINE, LINK]);

    const settled = jest.fn();
    respond = body =>
      body.sessionId === LINK
        ? { status: 200, body: { valid: false, reason: 'We could not find that purchase.' } }
        : new TypeError('Failed to fetch');
    await render(h(Retries, { onSettled: settled }));
    await waitFor(() => calls.length === 2);
    expect(settled).toHaveBeenCalledWith({ state: 'failed', message: 'We could not find that purchase.' }, LINK);
    expect(await saved()).toEqual([MINE]);

    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    await online();
    await waitFor(async () => (await db.getPreferences()).licenseToken === NEW_KEY);
    expect(settled).toHaveBeenCalledWith({ state: 'active' }, MINE);
    expect(await saved()).toEqual([]);
    expect(calls.filter(c => c.sessionId === LINK)).toHaveLength(1);
  });

  it('shows a card for each purchase, and Retry finishes only its own', async () => {
    await pro.savePendingCheckout(MINE);
    await pro.savePendingCheckout(LINK);
    await render(h(UpgradeCard));
    expect(text().match(/Finishing your Pro purchase/g)).toHaveLength(2);
    expect(text()).toContain(MINE);
    expect(text()).toContain(LINK);
    expect(button(/Get Pro/)).toBeUndefined();

    respond = () => ({ status: 200, body: { valid: true, token: NEW_KEY } });
    const retries = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === 'Retry activation');
    await click(retries[1]);
    await waitFor(async () => (await db.getPreferences()).licenseToken === NEW_KEY);
    expect(calls).toEqual([{ sessionId: LINK }]);
    expect(await saved()).toEqual([MINE]);
  });

  it('a checkout reference pasted in the key box joins the saved purchases', async () => {
    await pro.savePendingCheckout(MINE);
    await render(h(LicenseKeyForm));
    respond = body =>
      body.sessionId === LINK
        ? { status: 200, body: { valid: true, token: NEW_KEY } }
        : new TypeError('Failed to fetch');
    await type(container.querySelector('input'), LINK);
    await click(button('Activate'));
    await waitFor(async () => (await db.getPreferences()).licenseToken === NEW_KEY);
    expect(calls).toEqual([{ sessionId: LINK }]);
    expect(await saved()).toEqual([MINE]);
  });

  it('Delete all data names every purchase it would forget, or keeps them all', async () => {
    for (const keep of [false, true]) {
      resetDBConnection();
      globalThis.indexedDB = new IDBFactory();
      await pro.savePendingCheckout(MINE);
      await pro.savePendingCheckout(LINK);
      await render(h(DeleteSection, { onDone: () => {} }));
      await click(button('Delete all data'));
      expect(text()).toContain(
        `The Pro purchases that are still being confirmed will be forgotten too. Their references are ${MINE} and ${LINK}.`,
      );
      if (keep) await click(container.querySelector<HTMLInputElement>('input[type=checkbox]')!);
      expect(text()).toContain('Keep my Pro purchases on this device');
      await type(container.querySelector<HTMLInputElement>('#confirm-delete'), 'DELETE');
      await click(button('Delete'));
      await waitFor(() => (toast.success as jest.Mock).mock.calls.length > 0);
      expect(toast.success).toHaveBeenCalledWith(
        keep ? 'All data deleted. Your Pro purchases were kept.' : 'All data deleted',
      );
      expect(await saved()).toEqual(keep ? [MINE, LINK] : []);
      jest.clearAllMocks();
      await act(async () => root?.unmount());
      container.remove();
    }
    root = null;
  });
});

describe('a purchase saved in a build with Pro off (P2)', () => {
  it('the first answer from the server settles it, so nothing keeps running in the background', async () => {
    settings.proEnabled = false;
    await pro.savePendingCheckout(SID);
    // No answer at all, as when offline: kept, and tried again later.
    expect((await pro.finishCheckout(SID)).state).toBe('pending');
    // The server of a free build answers that payments are not available. That is final here.
    respond = () => ({ status: 503, body: { error: 'Payments are not available right now.' } });
    expect(await pro.finishCheckout(SID)).toEqual({
      state: 'failed',
      message: 'We could not turn on Pro for this purchase.',
    });
    expect(await pro.finishCheckout(SID)).toEqual({ state: 'done' });
    expect(calls).toHaveLength(2);
  });
});

describe('an activation answer after the purchase was removed (P3)', () => {
  async function answerAfter(remove: () => Promise<unknown>) {
    await pro.savePendingCheckout(SID);
    let answer!: (r: Reply) => void;
    respond = () => new Promise<Reply>(r => (answer = r));
    const attempt = pro.finishCheckout(SID);
    await waitFor(() => calls.length === 1);
    await remove();
    answer({ status: 200, body: { valid: true, token: NEW_KEY } });
    return attempt;
  }

  it('Delete all data stays deleted: the key does not come back', async () => {
    expect(await answerAfter(() => db.deleteAllData())).toEqual({ state: 'done' });
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBeUndefined();
    expect(prefs.licenseCheckedAt).toBeUndefined();
  });

  it('a dismissed purchase stays dismissed', async () => {
    expect(await answerAfter(() => pro.forgetPendingCheckout(SID))).toEqual({ state: 'done' });
    expect((await db.getPreferences()).licenseToken).toBeUndefined();
  });

  it('keeping the license on Delete all data keeps the purchase, so its key is stored', async () => {
    expect(await answerAfter(() => db.deleteAllData({ keepLicense: true }))).toEqual({ state: 'active' });
    expect((await db.getPreferences()).licenseToken).toBe(NEW_KEY);
  });
});

describe('the daily license check while the app stays open (P5)', () => {
  const DAY = 24 * 60 * 60_000;

  it('checks again when the app is shown or comes online once a day has passed, and not before', async () => {
    const start = Date.now();
    const setNow = fakeClock(start);
    await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: new Date(start - 60_000).toISOString() });
    respond = () => ({ status: 200, body: { valid: true } });
    await render(h(Refresh));
    expect(calls).toHaveLength(0);

    // Shown again and back online within the day: no request.
    setNow(start + 6 * 60 * 60_000);
    await show();
    await online();
    await pause(30);
    expect(calls).toHaveLength(0);

    // A day later the app comes back to the foreground.
    setNow(start + DAY + 60_000);
    await show();
    await waitFor(() => calls.length === 1);
    expect(Date.parse((await db.getPreferences()).licenseCheckedAt!)).toBe(start + DAY + 60_000);

    // Answered: nothing more for another day.
    await show();
    await online();
    await pause(30);
    expect(calls).toHaveLength(1);

    // The next day the subscription was canceled. Coming back online finds out.
    respond = () => ({ status: 200, body: { valid: false, reason: 'This subscription has ended.' } });
    setNow(start + 2 * DAY + 2 * 60_000);
    await online();
    await waitFor(() => calls.length === 2);
    await waitFor(async () => (await db.getPreferences()).licenseCheckedAt === EPOCH);
    expect(pro.licenseState(await db.getPreferences())).toBe('ended');

    // An ended key keeps its 1970 date, and is still asked about only once a day.
    setNow(start + 2 * DAY + 3 * 60 * 60_000);
    await show();
    await online();
    await pause(30);
    expect(calls).toHaveLength(2);
    setNow(start + 3 * DAY + 3 * 60_000);
    await show();
    await waitFor(() => calls.length === 3);
  });

  it('an app left open in the foreground checks when the day is up, a hidden one when it is shown', async () => {
    const start = Date.now();
    const setNow = fakeClock(start);
    // Catch the timer for the next daily check instead of waiting a day for it.
    const realSetTimeout = global.setTimeout;
    const daily: { fn: () => void; ms: number }[] = [];
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if ((ms ?? 0) > 60 * 60_000) {
        daily.push({ fn, ms: ms! });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);
    // Old timers belong to effects that have ended, and do nothing.
    const timeUp = () =>
      act(async () => {
        for (const t of daily.splice(0)) t.fn();
      });
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    try {
      await db.updatePreferences({
        licenseToken: OLD_KEY,
        licenseCheckedAt: new Date(start - 60 * 60_000).toISOString(),
      });
      respond = () => ({ status: 200, body: { valid: true } });
      await render(h(Refresh));
      expect(calls).toHaveLength(0);
      expect(daily[daily.length - 1].ms).toBe(DAY - 60 * 60_000);

      // The day passes with the app on screen the whole time.
      setNow(start + DAY);
      await timeUp();
      await waitFor(() => calls.length === 1);

      // The next day the app is in the background when the time comes. It waits until it is shown.
      visibility = 'hidden';
      setNow(start + 2 * DAY + 60_000);
      await timeUp();
      await pause(30);
      expect(calls).toHaveLength(1);
      visibility = 'visible';
      await show();
      await waitFor(() => calls.length === 2);
    } finally {
      spy.mockRestore();
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  it('a check that fails keeps Pro through the 30 day grace period, and is tried again (P5)', async () => {
    const start = Date.now();
    const setNow = fakeClock(start);
    const checked = new Date(start - 60_000).toISOString();
    await db.updatePreferences({ licenseToken: OLD_KEY, licenseCheckedAt: checked });
    await render(h(Refresh));

    // Two days later the app is shown while offline.
    setNow(start + 2 * DAY);
    await show();
    await waitFor(() => calls.length === 1);
    let prefs = await db.getPreferences();
    expect(prefs.licenseCheckedAt).toBe(checked);
    expect(pro.licenseState(prefs)).toBe('active');
    expect(pro.licenseState(prefs, start + 31 * DAY)).toBe('unverified');

    // Back online: asked again straight away.
    respond = () => ({ status: 200, body: { valid: true } });
    setNow(start + 2 * DAY + 60 * 60_000);
    await online();
    await waitFor(() => calls.length === 2);
    await waitFor(async () => (await db.getPreferences()).licenseCheckedAt !== checked);
    prefs = await db.getPreferences();
    expect(Date.parse(prefs.licenseCheckedAt!)).toBe(start + 2 * DAY + 60 * 60_000);
  });
});
