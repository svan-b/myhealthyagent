import { test, expect, type Page } from '@playwright/test';
import { openTab, seed, watchErrors } from './helpers';

type Row = Record<string, unknown>;

/**
 * Opens the app once so it creates its database, then writes the rows that `build` returns into it.
 * `build` runs in the browser, so dates use the browser's own clock and time zone.
 */
async function seedWith(page: Page, build: () => Record<string, Row[]>) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  const rows = await page.evaluate(build);
  await page.evaluate(async (stores: Record<string, Row[]>) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const names = [...Object.keys(stores), 'preferences'];
    const tx = db.transaction(names, 'readwrite');
    for (const [store, rows] of Object.entries(stores)) for (const row of rows) tx.objectStore(store).put(row);
    tx.objectStore('preferences').put({
      id: 'user-preferences',
      customSymptoms: [],
      customFactors: [],
      streakCount: 1,
      onboardedAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, rows);
}

test.describe('insights', () => {
  test('a day with only a ticked dose does not count as a day without symptoms', async ({ page }) => {
    const errors = watchErrors(page);
    // A pill ticked every morning for 60 days. The Log tab is used every other day, with coffee at 08:00
    // and, on half of those days, a headache at 14:00. Coffee is not linked to anything here.
    await seedWith(page, () => {
      const now = new Date();
      const at = (d: number, h: number, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, h, m);
      const pad = (n: number) => String(n).padStart(2, '0');
      const symptoms: Row[] = [];
      const factors: Row[] = [];
      const adherence: Row[] = [];
      for (let d = 60; d >= 1; d--) {
        const day = at(d, 0);
        adherence.push({
          id: `dose-${d}`,
          scheduleId: 'm1',
          medicationName: 'Sertraline',
          scheduledTime: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T07:30`,
          takenTime: at(d, 7, 30).toISOString(),
          status: 'taken',
        });
        if (d % 2) continue;
        factors.push({ id: `f${d}`, name: 'Coffee', category: 'drink', timestamp: at(d, 8).toISOString() });
        if (d % 4 === 0)
          symptoms.push({ id: `s${d}`, name: 'Headache', severity: 5, timestamp: at(d, 14).toISOString() });
      }
      const start = at(61, 7).toISOString();
      const schedules: Row[] = [
        {
          id: 'm1',
          medicationName: 'Sertraline',
          dosage: '50 mg',
          frequency: 'daily',
          scheduleTimes: ['07:30'],
          isActive: true,
          startDate: start,
          createdAt: start,
          updatedAt: start,
        },
      ];
      return { symptoms, factors, adherence, schedules };
    });
    await page.reload();
    await openTab(page, 'Insights');
    await expect(page.getByText('Nothing could be checked yet, so nothing is ruled out.')).toBeVisible();
    await expect(
      page.getByText(/Sertraline and Coffee are logged every day or at the same time each day/),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Coffee and/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('says nothing could be checked instead of claiming a real result', async ({ page }) => {
    const errors = watchErrors(page);
    // Coffee at 08:00 every day, a different dinner each night, pizza on two nights each followed by a
    // migraine 14 hours later, and five other migraines.
    await seedWith(page, () => {
      const now = new Date();
      const at = (d: number, h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, h);
      const symptoms: Row[] = [];
      const factors: Row[] = [];
      for (let d = 20; d >= 1; d--) {
        factors.push({ id: `c${d}`, name: 'Coffee', category: 'drink', timestamp: at(d, 8).toISOString() });
        const dinner = d === 15 || d === 6 ? 'Pizza' : `Dinner ${d}`;
        factors.push({ id: `d${d}`, name: dinner, category: 'food', timestamp: at(d, 19).toISOString() });
      }
      for (const d of [15, 6])
        symptoms.push({ id: `p${d}`, name: 'Migraine', severity: 7, timestamp: at(d, 33).toISOString() });
      for (const d of [18, 13, 10, 4, 2]) {
        symptoms.push({ id: `m${d}`, name: 'Migraine', severity: 7, timestamp: at(d, 11).toISOString() });
      }
      return { symptoms, factors };
    });
    await page.reload();
    await openTab(page, 'Insights');
    await expect(page.getByText('Nothing could be checked yet, so nothing is ruled out.')).toBeVisible();
    await expect(page.getByText(/^Pizza, .* need at least 3 logs before they can be checked\.$/)).toBeVisible();
    await expect(page.getByText(/That is a real result/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the readiness card never shows more days than the goal', async ({ page }) => {
    const errors = watchErrors(page);
    // 40 days of symptom logs but only 4 food logs. Still collecting, because of the food logs.
    await seedWith(page, () => {
      const now = new Date();
      const at = (d: number, h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, h);
      const symptoms: Row[] = [];
      for (let d = 40; d >= 1; d--) {
        symptoms.push({ id: `s${d}`, name: 'Fatigue', severity: 5, timestamp: at(d, 14).toISOString() });
      }
      const factors = [1, 2, 3, 4].map(d => ({
        id: `f${d}`,
        name: 'Dairy',
        category: 'food',
        timestamp: at(d, 12).toISOString(),
      }));
      return { symptoms, factors };
    });
    await page.reload();
    await openTab(page, 'Insights');
    await expect(page.getByText('4 of 10 food, drink and activity logs')).toBeVisible();
    await expect(page.getByText(/of 14 days tracked/)).toHaveCount(0);
    const bar = page.getByRole('progressbar', { name: 'Food, drink and activity logs' });
    await expect(bar).toHaveAttribute('aria-valuenow', '4');
    await expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(errors).toEqual([]);
  });

  test('uses the loaded data when the analysis worker fails after opening the app on Insights', async ({ page }) => {
    // A worker that fails, as when its script cannot be fetched, but only once real data reaches it.
    await page.addInitScript(() => {
      class FailingWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        postMessage(msg: { symptoms?: unknown[] }) {
          if (msg?.symptoms?.length) setTimeout(() => this.onerror?.(new Event('error')), 50);
        }
        terminate() {}
      }
      (window as unknown as { Worker: unknown }).Worker = FailingWorker;
    });
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await seed(page);
    // Open the app straight on Insights, so the screen starts while the data is still loading.
    await page.goto('/#insights');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dairy and bloating' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
