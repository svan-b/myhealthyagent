import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openTab, seed, startFresh, watchErrors } from './helpers';

test.describe('logging', () => {
  test('logs a symptom in three taps, then edits, deletes and restores it', async ({ page }) => {
    const errors = watchErrors(page);
    await startFresh(page);

    await page.getByRole('button', { name: 'Headache', exact: true }).click();
    await page.getByRole('button', { name: /^Moderate/ }).click();
    await page.getByRole('button', { name: 'Save headache' }).click();
    await expect(page.getByText('Headache logged')).toBeVisible();
    await expect(page.getByRole('main').getByText('Today', { exact: true })).toBeVisible();

    await openTab(page, 'History');
    await page
      .getByRole('main')
      .getByRole('button', { name: /Headache/ })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Edit symptom' });
    await sheet.getByRole('button', { name: 'Severe', exact: true }).click();
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await expect(page.getByRole('main').getByText('Severe', { exact: true })).toBeVisible();

    await page
      .getByRole('main')
      .getByRole('button', { name: /Headache/ })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete for good' }).click();
    await expect(page.getByText('Nothing logged yet')).toBeVisible();
    await page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Entry deleted' })
      .getByRole('button', { name: 'Undo' })
      .click();
    await expect(page.getByRole('main').getByRole('button', { name: /Headache/ })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('logs several foods at once and filters history', async ({ page }) => {
    const errors = watchErrors(page);
    await startFresh(page);
    await page.getByRole('radio', { name: 'What I had or did' }).click();
    await page.getByRole('button', { name: 'Dairy', exact: true }).click();
    await page.getByRole('button', { name: 'Gluten', exact: true }).click();
    await page.getByLabel('Something else').fill('Red wine');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save 3 items' }).click();
    await expect(page.getByText('3 items logged')).toBeVisible();

    await openTab(page, 'History');
    await page.getByRole('radio', { name: 'Symptoms' }).click();
    await expect(page.getByText('Nothing logged yet')).toBeVisible();
    await page.getByRole('radio', { name: 'Food & activity' }).click();
    for (const name of ['Dairy', 'Gluten', 'Red wine']) {
      await expect(page.getByRole('main').getByText(name, { exact: true })).toBeVisible();
    }

    // Custom items are remembered for next time
    await openTab(page, 'Log');
    await page.getByRole('radio', { name: 'What I had or did' }).click();
    await expect(page.getByRole('group', { name: 'Yours' }).getByRole('button', { name: 'Red wine' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('rejects a time in the future', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Nausea', exact: true }).click();
    await page.getByRole('button', { name: /^Mild/ }).click();
    await page.getByRole('button', { name: 'Earlier' }).click();
    const future = new Date(Date.now() + 3 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await page
      .getByLabel('Date and time')
      .fill(`${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T10:00`);
    await page.getByRole('button', { name: 'Save nausea' }).click();
    await expect(page.getByText('That time is in the future')).toBeVisible();
  });
});

test.describe('insights and reports', () => {
  test('finds the planted delayed trigger and ignores daily habits', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await seed(page);
    await page.reload();
    await openTab(page, 'Insights');
    await expect(page.getByRole('heading', { name: 'Dairy and bloating' })).toBeVisible();
    await expect(page.getByText(/Bloating followed dairy 12 to 24 hours later/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Caffeine and/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Levothyroxine and/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('downloads a doctor report PDF and a CSV', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await seed(page);
    await page.reload();
    await page.getByRole('button', { name: 'Reports and data' }).click();
    await page.getByLabel(/Your name/).fill('Alex Example');

    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF report' }).click(),
    ]);
    expect(pdf.suggestedFilename()).toMatch(/^symptom-report-\d{4}-\d{2}-\d{2}\.pdf$/);
    const pdfBytes = await readFile((await pdf.path())!);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(8_000);

    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Spreadsheet' }).click(),
    ]);
    const text = (await readFile((await csv.path())!)).toString('utf8');
    expect(text.replace('﻿', '').split('\r\n')[0]).toBe(
      'type,name,category,severity,start_local,start_utc,duration_minutes,ongoing,notes,tags',
    );
    expect(text).toContain('factor,Dairy,food');
    expect(errors).toEqual([]);
  });
});

test('medications: add a schedule, take a dose, log an as-needed dose', async ({ page }) => {
  const errors = watchErrors(page);
  await startFresh(page);
  await openTab(page, 'Meds');
  await page.getByRole('button', { name: 'Add a medication' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add medication' });
  await sheet.getByLabel('Name').fill('Metformin');
  await sheet.getByLabel('Dose', { exact: true }).fill('500 mg');
  await sheet.getByLabel('How often').selectOption('twice-daily');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Medication added')).toBeVisible();

  await page.getByRole('button', { name: 'Take', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Taken. Tap to undo/ })).toBeVisible();

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const sheet2 = page.getByRole('dialog', { name: 'Add medication' });
  await sheet2.getByLabel('Name').fill('Ibuprofen');
  await sheet2.getByLabel('How often').selectOption('as-needed');
  await sheet2.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Log dose' }).click();
  await expect(page.getByText('taken 1 time today')).toBeVisible();
  expect(errors).toEqual([]);
});

test('backup, delete everything, restore from the file', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  await seed(page);
  await page.reload();

  await page.getByRole('button', { name: 'Reports and data' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const backupPath = (await download.path())!;
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(backup.format).toBe('myhealthyagent-backup');
  const symptomCount = backup.symptoms.length;
  expect(symptomCount).toBeGreaterThan(10);

  await page.getByRole('button', { name: 'Delete all data' }).click();
  const confirm = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('delete');
  await confirm.click();
  await expect(page.getByText('All data deleted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();

  await page.locator('input[type=file]').setInputFiles(backupPath);
  await expect(page.getByText('Backup restored')).toBeVisible();
  await openTab(page, 'Insights');
  await expect(page.getByRole('heading', { name: 'Dairy and bloating' })).toBeVisible();

  // Restoring the same file twice must not duplicate anything
  const counts = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise(res => {
      const r = indexedDB.open('myHealthyAgent', 4);
      r.onsuccess = () => res(r.result);
    });
    const count = (store: string) =>
      new Promise<number>(res => {
        const req = db.transaction(store).objectStore(store).count();
        req.onsuccess = () => res(req.result);
      });
    return { symptoms: await count('symptoms') };
  });
  expect(counts.symptoms).toBe(symptomCount);
  expect(errors).toEqual([]);
});

test('rejects a file that is not a backup', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText('This file is not a myHealthyAgent backup.')).toBeVisible();
});

test('works offline after the first visit', async ({ page, context }) => {
  await startFresh(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Let the service worker finish caching what the page loaded. page.waitForFunction would not wait for the
  // promise an async check returns (a promise counts as true), so poll the check instead.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const keys = await caches.keys();
          if (!keys.length) return false;
          const cache = await caches.open(keys[0]);
          const entries = await cache.keys();
          return (
            entries.some(r => r.url.includes('/_next/static/')) && entries.some(r => new URL(r.url).pathname === '/')
          );
        }),
      { timeout: 20_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fatigue', exact: true }).click();
  await page.getByRole('button', { name: /^Mild/ }).click();
  await page.getByRole('button', { name: 'Save fatigue' }).click();
  await expect(page.getByText('Fatigue logged')).toBeVisible();
  await context.setOffline(false);
});

test('legal pages, security headers and theme switch', async ({ page }) => {
  const res = await page.goto('/privacy');
  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(res?.headers()['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Not medical advice' })).toBeVisible();

  await startFresh(page);
  await page.getByRole('button', { name: 'Reports and data' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('payment endpoints fail safely when payments are not configured', async ({ request }) => {
  const checkout = await request.post('/api/checkout', { data: {} });
  expect(checkout.status()).toBe(503);
  const license = await request.post('/api/license', { data: { token: 'mha1.fake.fake' } });
  expect(license.status()).toBe(503);
  expect(await license.json()).toEqual({ error: 'Payments are not available right now.' });
});

test('upgrades data saved by the previous version of the app', async ({ page }) => {
  const errors = watchErrors(page);
  // Build a version 3 database exactly as the old app stored it, before the new app opens it.
  await page.goto('/privacy');
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent', 3);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('symptoms', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
        d.createObjectStore('templates', { keyPath: 'id' });
        d.createObjectStore('preferences', { keyPath: 'id' });
        const meds = d.createObjectStore('meds', { keyPath: 'id' });
        meds.createIndex('timestamp', 'timestamp');
        meds.createIndex('name', 'name');
        const s = d.createObjectStore('schedules', { keyPath: 'id' });
        s.createIndex('medicationName', 'medicationName');
        s.createIndex('isActive', 'isActive');
        const a = d.createObjectStore('adherence', { keyPath: 'id' });
        a.createIndex('scheduleId', 'scheduleId');
        a.createIndex('status', 'status');
        a.createIndex('scheduledTime', 'scheduledTime');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['symptoms', 'meds', 'preferences', 'schedules'], 'readwrite');
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    // The previous release could add medications but had no way to record a dose
    const added = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const oldSchedule = {
      dosage: '10mg',
      frequency: 'twice-daily',
      scheduleTimes: ['08:00', '20:00'],
      startDate: added,
      notes: '',
      createdAt: added,
      updatedAt: added,
    };
    tx.objectStore('schedules').put({ ...oldSchedule, id: 'old-s1', medicationName: 'Lisinopril', isActive: true });
    tx.objectStore('schedules').put({ ...oldSchedule, id: 'old-s2', medicationName: 'Metformin', isActive: false });
    tx.objectStore('symptoms').put({
      id: 'old-1',
      name: 'Migraine',
      severity: 9,
      timestamp: yesterday,
      duration_minutes: 999,
      tags: ['Evening', 'Stressed'],
    });
    tx.objectStore('symptoms').put({
      id: 'old-2',
      name: 'Fatigue',
      severity: 5,
      timestamp: yesterday,
      duration_minutes: 30,
      tags: [],
    });
    tx.objectStore('meds').put({ id: 'old-med', name: 'Sumatriptan', timestamp: yesterday, dose: '50mg' });
    tx.objectStore('preferences').put({
      id: 'user-preferences',
      favoriteSymptoms: [],
      recentSymptoms: [],
      defaultSeverity: 4,
      streakCount: 3,
      lastLogDate: 'Mon Jan 01 2024',
    });
    await new Promise(res => (tx.oncomplete = res));
    db.close();
  });

  await page.goto('/');
  // Existing users skip onboarding and land in the app
  await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  await openTab(page, 'History');
  const main = page.getByRole('main');
  await expect(main.getByText('Migraine', { exact: true })).toBeVisible();
  await expect(main.getByText('Ongoing · Evening · Stressed')).toBeVisible();
  await expect(main.getByText('Sumatriptan', { exact: true })).toBeVisible();
  await expect(main.getByText('Medication', { exact: true })).toBeVisible();

  // Months with no way to record a dose are not shown as missed doses
  await openTab(page, 'Meds');
  await expect(main.getByRole('button', { name: 'Edit Lisinopril' })).toBeVisible();
  await expect(main.getByText('Paused', { exact: true })).toBeVisible();
  await expect(main.getByText(/taken in 30 days/)).toHaveCount(0);
  await expect(main.getByText('Overdue')).toHaveCount(0);
  expect(errors).toEqual([]);
});
