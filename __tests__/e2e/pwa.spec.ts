import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { openTab, seed, startFresh, watchErrors } from './helpers';

// The cache the service worker in public/sw.js uses.
const CACHE = `mha-${/const VERSION = '([^']+)'/.exec(readFileSync('public/sw.js', 'utf8'))![1]}`;

/**
 * Serves the app as a previous deploy would have: a service worker with another VERSION, and a page whose build
 * files sit at other addresses. Once the routes are removed, the real sw.js and page are the new version.
 */
async function serveEarlierVersion(context: BrowserContext) {
  await context.route(
    url => url.pathname === '/sw.js',
    async route => {
      const res = await route.fetch();
      const body = (await res.text()).replace(/const VERSION = '[^']+'/, "const VERSION = 'e2e-earlier'");
      await route.fulfill({ response: res, body });
    },
  );
  await context.route(
    url => url.pathname === '/',
    async route => {
      const res = await route.fetch();
      if (!(res.headers()['content-type'] ?? '').includes('text/html')) return route.fulfill({ response: res });
      const body = (await res.text()).replace(/(\/_next\/static\/[^"'\\\s<>?#]+\.\w+)/g, '$1?v=earlier');
      await route.fulfill({ response: res, body });
    },
  );
}

/** Waits until a service worker controls the page and has the app page cached. */
async function waitForOfflineReady(page: Page) {
  // page.waitForFunction does not wait for a promise, so poll instead.
  await expect
    .poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller && (await caches.match('/')))), {
      timeout: 20_000,
    })
    .toBe(true);
}

/** Has the browser check for a new service worker, and waits until it is installed and waiting. */
async function findUpdate(page: Page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw new Error('No service worker registered');
    await reg.update();
    for (let i = 0; i < 200 && !reg.waiting; i++) await new Promise(r => setTimeout(r, 100));
    if (!reg.waiting) throw new Error('The update was not installed');
  });
}

/** Collects requests for build files that failed, from pages and from the service worker. */
function watchFailedFiles(context: BrowserContext) {
  const failed: string[] = [];
  context.on('requestfailed', r => {
    if (r.url().includes('/_next/static/')) failed.push(r.url());
  });
  return failed;
}

async function logFatigue(page: Page) {
  await page.getByRole('button', { name: 'Fatigue', exact: true }).click();
  await page.getByRole('button', { name: /^Mild/ }).click();
  await page.getByRole('button', { name: 'Save fatigue' }).click();
  await expect(page.getByText('Fatigue logged')).toBeVisible();
}

const updateToast = (page: Page) => page.locator('[data-sonner-toast]').filter({ hasText: 'A new version is ready' });

test.describe('updates', () => {
  test('Update reloads once into the new version, also when the session started without a service worker', async ({
    page,
    context,
  }) => {
    let loads = 0;
    page.on('load', () => loads++);
    await serveEarlierVersion(context);
    await startFresh(page);
    await waitForOfflineReady(page);
    // The first install took over this page without reloading it.
    expect(loads).toBe(1);

    await context.unrouteAll({ behavior: 'wait' });
    await findUpdate(page);
    await expect(updateToast(page)).toBeVisible();
    await Promise.all([page.waitForEvent('load'), updateToast(page).getByRole('button', { name: 'Update' }).click()]);
    await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
    expect(await page.evaluate(() => caches.keys())).toEqual([CACHE]);
    // Exactly one reload, and no loop.
    await page.waitForTimeout(2000);
    expect(loads).toBe(2);
  });

  test('after an update, the app starts offline the next time it opens', async ({ page, context }) => {
    const failed = watchFailedFiles(context);
    await serveEarlierVersion(context);
    await startFresh(page);
    await waitForOfflineReady(page);
    await context.unrouteAll({ behavior: 'wait' });
    await findUpdate(page);

    // Closing the app lets the new version take over. The next start has no connection.
    await page.close();
    await context.setOffline(true);
    const next = await context.newPage();
    await next.goto('/');
    await expect(next.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
    await logFatigue(next);
    expect(await next.evaluate(() => caches.keys())).toEqual([CACHE]);
    expect(failed).toEqual([]);
    await context.setOffline(false);
  });

  test('tapping Update without a connection still starts the new version', async ({ page, context }) => {
    const failed = watchFailedFiles(context);
    await serveEarlierVersion(context);
    await startFresh(page);
    await waitForOfflineReady(page);
    // A later start of the earlier version, under its service worker.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
    await context.unrouteAll({ behavior: 'wait' });
    await findUpdate(page);
    await expect(updateToast(page)).toBeVisible();

    await context.setOffline(true);
    await Promise.all([page.waitForEvent('load'), updateToast(page).getByRole('button', { name: 'Update' }).click()]);
    await logFatigue(page);
    expect(await page.evaluate(() => caches.keys())).toEqual([CACHE]);
    expect(failed).toEqual([]);
    await context.setOffline(false);
  });
});

/** Every file the doctor report loads on demand, as listed by the production build. */
async function reportFiles() {
  const manifest: Record<string, { files: string[] }> = JSON.parse(
    await readFile('.next/react-loadable-manifest.json', 'utf8'),
  );
  const files = Object.entries(manifest)
    .filter(([from]) => / -> (@\/lib\/report\/pdf|jspdf|jspdf-autotable)$/.test(from))
    .flatMap(([, entry]) => entry.files.map(f => `/_next/${f}`));
  return [...new Set(files)];
}

test('makes the doctor report offline without having made one online', async ({ page, context }) => {
  const files = await reportFiles();
  expect(files.length).toBeGreaterThanOrEqual(3);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  await seed(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  await waitForOfflineReady(page);
  // The app loads the report code in idle time and the service worker caches it.
  await expect
    .poll(
      () => page.evaluate(async list => (await Promise.all(list.map(f => caches.match(f)))).every(Boolean), files),
      { timeout: 30_000 },
    )
    .toBe(true);
  // The worker also remembers these files, so cleaning up the cache after later deploys keeps them.
  await expect
    .poll(
      () =>
        page.evaluate(async list => {
          const saved = await caches.match('/__mha/loaded');
          const urls: string[] = saved ? await saved.json() : [];
          return list.every(f => urls.includes(location.origin + f));
        }, files),
      { timeout: 30_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Reports and data' }).click();
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF report' }).click(),
  ]);
  const bytes = await readFile((await pdf.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await context.setOffline(false);
});

test('opens the cached app when the host answers with an error', async ({ page, context }) => {
  await startFresh(page);
  await waitForOfflineReady(page);
  for (const status of [503, 404]) {
    await context.route(
      url => url.pathname === '/',
      route => route.fulfill({ status, contentType: 'text/html', body: `<h1>Host error ${status}</h1>` }),
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
    await logFatigue(page);
    await context.unrouteAll({ behavior: 'wait' });
  }
  // A page that does not exist still gets the not found page.
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('the installed app follows the device orientation', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest).not.toHaveProperty('orientation');
});

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// iPadOS Safari asks for desktop sites, so it reports a Mac. Only the touch screen tells them apart.
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const touchPoints = (page: Page, n: number) =>
  page.addInitScript(points => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => points }), n);

test.describe('moving to the home screen on iPhone', () => {
  test.use({ userAgent: IPHONE_SAFARI });

  test('onboarding suggests adding to the home screen before starting', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Add it to your home screen first')).toBeVisible();
    await expect(page.getByText(/On iPhone, the home screen app keeps its data separate from Safari/)).toBeVisible();
  });

  test('the install card has people download a backup first, then explains how to restore it', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await seed(page);
    await page.reload();
    await expect(page.getByText('Add to your home screen', { exact: true })).toBeVisible();
    await expect(page.getByText(/keeps its data separate from Safari and starts empty/)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download backup' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^myhealthyagent-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(backup.format).toBe('myhealthyagent-backup');
    expect(backup.symptoms.length).toBeGreaterThan(10);
    await expect(page.getByText('Backup saved')).toBeVisible();
    await expect(page.getByText('Tap the Share button in Safari, then Add to Home Screen.')).toBeVisible();
    await expect(page.getByText('Open the new icon and tap “I have a backup file”.')).toBeVisible();

    // The download counts as a backup.
    await page.getByRole('button', { name: 'Reports and data' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Download backup' })).toBeVisible();
    await expect(page.getByText('You have not made a backup yet.')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('once the backup is saved, focus moves to the message so the steps are read next', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await seed(page);
    await page.reload();
    await page.getByRole('button', { name: 'Download backup' }).focus();
    await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    await expect(page.getByText('Backup saved')).toBeFocused();
  });

  test('medications and doses count toward showing the card', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('myHealthyAgent');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction(['schedules', 'adherence', 'preferences'], 'readwrite');
      const start = new Date(Date.now() - 3 * 86_400_000).toISOString();
      tx.objectStore('schedules').put({
        id: 'm1',
        medicationName: 'Metformin',
        dosage: '500 mg',
        frequency: 'daily',
        scheduleTimes: ['08:00'],
        isActive: true,
        startDate: start,
        createdAt: start,
        updatedAt: start,
      });
      for (const day of [1, 2]) {
        const when = new Date(Date.now() - day * 86_400_000).toISOString();
        tx.objectStore('adherence').put({
          id: `d${day}`,
          scheduleId: 'm1',
          medicationName: 'Metformin',
          scheduledTime: when,
          takenTime: when,
          status: 'taken',
        });
      }
      tx.objectStore('preferences').put({
        id: 'user-preferences',
        customSymptoms: [],
        customFactors: [],
        streakCount: 0,
        onboardedAt: start,
      });
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Download backup' })).toBeVisible();
  });

  test('the home screen app says where earlier entries are and restores a backup', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
    await page.goto('/');
    await expect(page.getByText('Used this in Safari before?')).toBeVisible();
    await expect(page.getByText(/open this site in Safari, tap Reports and data, then Download backup/)).toBeVisible();
    await expect(page.getByText('Add it to your home screen first')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'I have a backup file' })).toHaveCount(1);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const file = {
      format: 'myhealthyagent-backup',
      version: 2,
      symptoms: [{ id: 's1', name: 'Migraine', severity: 7, timestamp: yesterday }],
      factors: [{ id: 'f1', name: 'Red wine', category: 'drink', timestamp: yesterday }],
      schedules: [],
      adherence: [],
    };
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await expect(page.getByText('Backup restored')).toBeVisible();
    await openTab(page, 'History');
    await expect(page.getByRole('main').getByText('Migraine', { exact: true })).toBeVisible();
    // The installed app does not suggest installing.
    await expect(page.getByText('Add to your home screen', { exact: true })).toHaveCount(0);
  });
});

test.describe('moving to the home screen on iPad', () => {
  test.use({ userAgent: MAC_SAFARI });

  test('iPad Safari, which reports a Mac, gets the same advice', async ({ page }) => {
    await touchPoints(page, 5);
    await page.goto('/');
    await expect(page.getByText(/On iPad, the home screen app keeps its data separate from Safari/)).toBeVisible();
    await seed(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Download backup' })).toBeVisible();
  });

  test('a Mac without a touch screen gets no home screen advice', async ({ page }) => {
    await touchPoints(page, 0);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await expect(page.getByText('Add it to your home screen first')).toHaveCount(0);
  });
});
