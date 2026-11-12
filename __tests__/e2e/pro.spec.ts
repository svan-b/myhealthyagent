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
  await expect(page.getByText('Payment received. Finishing activation.')).toBeVisible();
  await expect(page.getByText('The app will keep trying automatically.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await readPrefs(page)).toMatchObject({ pendingCheckout: { sessionId: SESSION } });

  // Next time the app opens it tries again, and this time it works.
  online = true;
  await page.reload();
  await expect(page.getByText('Thank you. Pro is active.')).toBeVisible();
  await expect.poll(async () => (await readPrefs(page)).licenseToken).toBe('mha1.e2e.key');
  expect((await readPrefs(page)).pendingCheckout).toBeUndefined();
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
  await expect.poll(async () => (await readPrefs(page)).pendingCheckout).toBeUndefined();
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
