import { test, expect, type Page } from '@playwright/test';
import { startFresh, watchErrors } from './helpers';

// These run against the free build CI makes, with no Stripe settings. Returning from checkout works the
// same there, and /api/license is answered by page.route. The service worker is off so it cannot get in
// the way of those routes.
test.use({ serviceWorkers: 'block' });

const SESSION = 'cs_test_a1b2c3d4e5f6g7h8i9j0';

async function readPrefs(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const prefs = await new Promise<Record<string, unknown> | undefined>(res => {
      const req = db.transaction('preferences').objectStore('preferences').get('user-preferences');
      req.onsuccess = () => res(req.result);
    });
    db.close();
    return prefs ?? {};
  });
}

async function storeKey(page: Page, key: string) {
  await page.evaluate(async key => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('preferences', 'readwrite');
    const store = tx.objectStore('preferences');
    const req = store.get('user-preferences');
    req.onsuccess = () => store.put({ ...req.result, licenseToken: key, licenseCheckedAt: new Date().toISOString() });
    await new Promise(res => (tx.oncomplete = res));
    db.close();
  }, key);
}

test('cancelling checkout shows the message and leaves Back working (F34)', async ({ page }) => {
  const errors = watchErrors(page);
  await startFresh(page);
  await page.goto('/?checkout=cancel');
  await expect(page.getByText('Checkout cancelled. You were not charged.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  // Next keeps its own state in history. Cleaning the address must not wipe it.
  expect(await page.evaluate(() => history.state !== null)).toBe(true);

  // The toast sits over the header button. Close it rather than wait for it to go.
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Close toast' }).click();
  await page.getByRole('button', { name: 'Reports and data' }).click();
  await page.getByRole('link', { name: 'Terms and medical disclaimer' }).click();
  await expect(page.getByRole('heading', { name: 'Not medical advice' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not medical advice' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('a purchase is saved before the address is cleaned and finished after a failed first try (F04)', async ({
  page,
}) => {
  await startFresh(page);
  let online = false;
  const bodies: unknown[] = [];
  await page.route('**/api/license', async route => {
    bodies.push(route.request().postDataJSON());
    if (online) await route.fulfill({ json: { valid: true, token: 'mha1.e2e.key' } });
    else await route.abort('internetdisconnected');
  });

  await page.goto(`/?checkout=success&session_id=${SESSION}`);
  await expect(page.getByText('Thank you for your purchase. Finishing activation.')).toBeVisible();
  await expect(page.getByText('The app will keep trying automatically.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await readPrefs(page)).toMatchObject({ pendingCheckouts: [{ sessionId: SESSION }] });

  // Next time the app opens it tries again, and this time it works.
  online = true;
  await page.reload();
  await expect(page.getByText('Thank you. Pro is active.')).toBeVisible();
  await expect.poll(async () => (await readPrefs(page)).licenseToken).toBe('mha1.e2e.key');
  expect((await readPrefs(page)).pendingCheckouts).toBeUndefined();
  expect(bodies.length).toBeGreaterThanOrEqual(2);
  expect(bodies.every(b => JSON.stringify(b) === JSON.stringify({ sessionId: SESSION }))).toBe(true);
});

test('a refused activation shows the reason, who to contact and the reference (F04, F44)', async ({ page }) => {
  await startFresh(page);
  await page.route('**/api/license', route =>
    route.fulfill({
      status: 402,
      json: { valid: false, reason: 'That checkout was not completed, so you were not charged.' },
    }),
  );
  await page.goto(`/?checkout=success&session_id=${SESSION}`);
  await expect(page.getByText('That checkout was not completed, so you were not charged.')).toBeVisible();
  await expect(page.getByText(`contact support and quote reference ${SESSION}`)).toBeVisible();
  await expect(page.getByText('Request failed')).toHaveCount(0);
  await expect.poll(async () => (await readPrefs(page)).pendingCheckouts).toBeUndefined();
});

test('another checkout link does not replace a purchase that is still being confirmed (P1)', async ({ page }) => {
  await startFresh(page);
  const mine = 'cs_test_mypurchase0000000001';
  const link = 'cs_test_fromsomelink00000002';
  let mineConfirmed = false;
  const asked: string[] = [];
  await page.route('**/api/license', async route => {
    const { sessionId } = route.request().postDataJSON() as { sessionId: string };
    asked.push(sessionId);
    if (sessionId === link) {
      await route.fulfill({ json: { valid: false, reason: 'We could not find that purchase.' } });
    } else if (mineConfirmed) {
      await route.fulfill({ json: { valid: true, token: 'mha1.e2e.mine' } });
    } else {
      await route.abort('internetdisconnected');
    }
  });

  await page.goto(`/?checkout=success&session_id=${mine}`);
  await expect(page.getByText('The app will keep trying automatically.')).toBeVisible();

  // Someone sends a link with another checkout id. It is handled, and the purchase stays saved.
  await page.goto(`/?checkout=success&session_id=${link}`);
  await expect(page.getByText('We could not find that purchase.')).toBeVisible();
  await expect(page.getByText(`contact support and quote reference ${link}`)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // The purchase is confirmed later, and the app still finishes it.
  mineConfirmed = true;
  await page.reload();
  await expect(page.getByText('Thank you. Pro is active.')).toBeVisible();
  await expect.poll(async () => (await readPrefs(page)).licenseToken).toBe('mha1.e2e.mine');
  expect(asked.filter(id => id === link)).toHaveLength(1);
  expect(asked[asked.length - 1]).toBe(mine);
});

test('in the free build, the server saying payments are off ends a purchase from a link (P2)', async ({ page }) => {
  await startFresh(page);
  // No page.route here: the free build's own server answers, as it would for anyone.
  const asked: unknown[] = [];
  page.on('request', r => {
    if (new URL(r.url()).pathname === '/api/license') asked.push(r.postDataJSON());
  });
  await page.goto(`/?checkout=success&session_id=${SESSION}`);
  await expect(page.getByText('We could not turn on Pro for this purchase.')).toBeVisible();
  await expect(page.getByText(`contact support and quote reference ${SESSION}`)).toBeVisible();
  await expect.poll(async () => JSON.stringify(await readPrefs(page))).not.toContain(SESSION);

  // Nothing is left to try: coming back online or opening the app again sends nothing more.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(asked).toEqual([{ sessionId: SESSION }]);
});

test('a made up checkout link cannot put its own words in the toast (F04, F44)', async ({ page }) => {
  await startFresh(page);
  let requests = 0;
  await page.route('**/api/license', route => {
    requests++;
    return route.abort();
  });
  await page.goto(`/?checkout=success&session_id=${encodeURIComponent('x. URGENT call +1 555 0100 to cancel')}`);
  await expect(page.getByText('That checkout link is not complete, so Pro could not be turned on.')).toBeVisible();
  await expect(page.getByText('If you were charged, contact support.')).toBeVisible();
  await expect(page.getByText(/URGENT/)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect((await readPrefs(page)).pendingCheckouts).toBeUndefined();
  expect(requests).toBe(0);
});

test('Delete all data removes the license key unless the person keeps it (F15)', async ({ page }) => {
  const errors = watchErrors(page);
  await startFresh(page);
  await storeKey(page, 'mha1.e2e.key');
  await page.reload();

  await page.getByRole('button', { name: 'Reports and data' }).click();
  await page.getByRole('button', { name: 'Delete all data' }).click();
  const keep = page.getByLabel('Keep my Pro license key on this device');
  await expect(keep).not.toBeChecked();
  await expect(page.getByText('mha1.e2e.key')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy key' })).toBeVisible();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('All data deleted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  expect((await readPrefs(page)).licenseToken).toBeUndefined();

  // Again, this time keeping the key.
  await page.getByRole('button', { name: 'Get started' }).click();
  await storeKey(page, 'mha1.e2e.key');
  await page.reload();
  await page.getByRole('button', { name: 'Reports and data' }).click();
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByLabel('Keep my Pro license key on this device').check();
  await expect(page.getByText('Anyone using this browser can see it')).toBeVisible();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Your Pro license key was kept.')).toBeVisible();
  expect((await readPrefs(page)).licenseToken).toBe('mha1.e2e.key');
  expect(errors).toEqual([]);
});

test('a license key no longer opens a billing portal (F17)', async ({ request }) => {
  const res = await request.post('/api/portal', { data: { token: 'mha1.fake.fake' } });
  expect(res.status()).toBe(404);
});
