import { expect, type Page } from '@playwright/test';

/** Collects page errors, console errors and CSP violations so tests can assert none happened. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
}

/**
 * Seeds 35 days of realistic data: daily morning caffeine (not a trigger), dairy every third day
 * followed by bloating the next early morning (a planted trigger), random headaches and fatigue.
 */
export async function seed(page: Page) {
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent', 4);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['symptoms', 'factors', 'schedules', 'adherence', 'preferences'], 'readwrite');
    let seedValue = 42;
    const rnd = () => (seedValue = (seedValue * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const now = new Date();
    const at = (d: number, h: number, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, h, m);
    let id = 0;
    for (let d = 34; d >= 1; d--) {
      tx.objectStore('factors').put({
        id: `f${id++}`,
        name: 'Caffeine',
        category: 'drink',
        timestamp: at(d, 8).toISOString(),
      });
      if (d % 3 === 1) {
        tx.objectStore('factors').put({
          id: `f${id++}`,
          name: 'Dairy',
          category: 'food',
          timestamp: at(d, 12, 30).toISOString(),
        });
        if (rnd() < 0.85 && d > 1) {
          tx.objectStore('symptoms').put({
            id: `s${id++}`,
            name: 'Bloating',
            severity: 7,
            timestamp: at(d - 1, 4 + Math.floor(rnd() * 3)).toISOString(),
            duration_minutes: 180,
          });
        }
      }
      if (rnd() < 0.15)
        tx.objectStore('symptoms').put({
          id: `s${id++}`,
          name: 'Bloating',
          severity: 2,
          timestamp: at(d, 15).toISOString(),
        });
      if (rnd() < 0.35)
        tx.objectStore('symptoms').put({
          id: `s${id++}`,
          name: 'Headache',
          severity: 5,
          timestamp: at(d, 17 + Math.floor(rnd() * 4)).toISOString(),
          duration_minutes: 60,
        });
      if (rnd() < 0.2)
        tx.objectStore('symptoms').put({
          id: `s${id++}`,
          name: 'Fatigue',
          severity: 5,
          timestamp: at(d, 14).toISOString(),
        });
    }
    const start = at(34, 7).toISOString();
    tx.objectStore('schedules').put({
      id: 'm1',
      medicationName: 'Levothyroxine',
      dosage: '50 mcg',
      frequency: 'daily',
      scheduleTimes: ['07:00'],
      isActive: true,
      startDate: start,
      createdAt: start,
      updatedAt: start,
    });
    tx.objectStore('preferences').put({
      id: 'user-preferences',
      customSymptoms: [],
      customFactors: [],
      streakCount: 5,
      onboardedAt: start,
    });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  });
}

export async function openTab(page: Page, name: 'Log' | 'History' | 'Insights' | 'Meds') {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click();
}
