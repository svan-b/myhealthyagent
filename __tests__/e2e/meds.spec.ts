import { test, expect, type Page } from '@playwright/test';
import { openTab, startFresh, watchErrors } from './helpers';

// The checklist depends on the time of day, so these tests fix the clock and the time zone.
test.use({ timezoneId: 'America/New_York', locale: 'en-US' });

/** A wall clock time in New York in November 2026, after clocks went back (UTC-5). */
const newYork = (local: string) => new Date(`${local}:00-05:00`);

/** "yyyy-MM-dd" for the day `n` days before `date`, by plain calendar counting. */
function daysBefore(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const schedule = (id: string, medicationName: string, scheduleTimes: string[], over: object = {}) => ({
  id,
  medicationName,
  dosage: '',
  frequency: scheduleTimes.length === 1 ? 'daily' : 'twice-daily',
  scheduleTimes,
  isActive: true,
  startDate: '2026-10-01T11:00:00.000Z',
  createdAt: '2026-10-01T11:00:00.000Z',
  updatedAt: '2026-10-01T11:00:00.000Z',
  ...over,
});

/** Taken dose records for the given local slot keys ("yyyy-MM-ddTHH:mm"). */
const taken = (scheduleId: string, medicationName: string, keys: string[]) =>
  keys.map(key => ({ id: `${scheduleId}-${key}`, scheduleId, medicationName, scheduledTime: key, status: 'taken' }));

/** Opens the app with these medications and dose records already saved. */
async function openWith(page: Page, data: { schedules: object[]; doses?: object[] }) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  await page.evaluate(
    async ({ schedules, doses }) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('myHealthyAgent', 4);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction(['schedules', 'adherence', 'preferences'], 'readwrite');
      for (const s of schedules) tx.objectStore('schedules').put(s);
      for (const d of doses) tx.objectStore('adherence').put(d);
      tx.objectStore('preferences').put({
        id: 'user-preferences',
        customSymptoms: [],
        customFactors: [],
        streakCount: 0,
        onboardedAt: '2026-10-01T11:00:00.000Z',
      });
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { schedules: data.schedules, doses: data.doses ?? [] },
  );
  await page.reload();
  await openTab(page, 'Meds');
}

/** Reads a whole store, to check what the app saved. */
function readStore<T>(page: Page, store: 'schedules' | 'adherence') {
  return page.evaluate(async name => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent', 4);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows = await new Promise<unknown[]>(res => {
      const q = db.transaction(name).objectStore(name).getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return rows;
  }, store) as Promise<T[]>;
}

test('a late evening dose can still be checked off after midnight', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.setFixedTime(newYork('2026-11-12T00:10'));
  await openWith(page, { schedules: [schedule('q1', 'Quetiapine', ['23:00'])] });

  const lastNight = page.getByRole('group', { name: /^Quetiapine 11:00\sPM, Last night$/ });
  const tonight = page.getByRole('group', { name: /^Quetiapine 11:00\sPM, Later$/ });
  await expect(tonight).toBeVisible();
  await lastNight.getByRole('button', { name: 'Take', exact: true }).click();
  await expect(lastNight.getByRole('button', { name: /Taken. Tap to undo/ })).toBeVisible();
  // Tonight's dose is still open, and the record is for last night
  await expect(tonight.getByRole('button', { name: 'Take', exact: true })).toBeVisible();
  const doses = await readStore<{ scheduledTime: string; status: string }>(page, 'adherence');
  expect(doses.map(d => [d.scheduledTime, d.status])).toEqual([['2026-11-11T23:00', 'taken']]);
  expect(errors).toEqual([]);
});

test('a medication added in the afternoon does not call its morning dose overdue', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.setFixedTime(newYork('2026-11-12T15:00'));
  await startFresh(page);
  await openTab(page, 'Meds');
  await page.getByRole('button', { name: 'Add a medication' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add medication' });
  await sheet.getByLabel('Name').fill('Amoxicillin');
  await sheet.getByLabel('How often').selectOption('twice-daily');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Medication added')).toBeVisible();

  const morning = page.getByRole('group', { name: /^Amoxicillin 8:00\sAM$/ });
  await expect(morning.getByRole('button', { name: 'Take', exact: true })).toBeVisible();
  await expect(morning.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Overdue')).toHaveCount(0);
  const evening = page.getByRole('group', { name: /^Amoxicillin 8:00\sPM, Later$/ });
  await expect(evening.getByRole('button', { name: 'Skip' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('moving a dose time after taking the dose keeps it taken', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.setFixedTime(newYork('2026-11-12T10:00'));
  const keys = Array.from({ length: 30 }, (_, i) => daysBefore('2026-11-12', i + 1)).flatMap(day => [
    `${day}T08:00`,
    `${day}T20:00`,
  ]);
  await openWith(page, {
    schedules: [schedule('m1', 'Metformin', ['08:00', '20:00'])],
    doses: taken('m1', 'Metformin', [...keys, '2026-11-12T08:00']),
  });
  await expect(page.getByText(/100% taken in 30 days/)).toBeVisible();

  await page.getByRole('button', { name: 'Edit Metformin' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit medication' });
  await sheet.getByLabel('Dose 1 time').fill('08:30');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Medication updated')).toBeVisible();

  const moved = page.getByRole('group', { name: /^Metformin 8:30\sAM/ });
  await expect(moved.getByRole('button', { name: /Taken. Tap to undo/ })).toBeVisible();
  await expect(moved.getByRole('button', { name: 'Take', exact: true })).toHaveCount(0);
  await expect(page.getByText(/100% taken in 30 days/)).toBeVisible();
  const [saved] = await readStore<{ timesHistory?: unknown[] }>(page, 'schedules');
  expect(saved.timesHistory).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('pausing and resuming keeps the adherence from before the pause', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.setFixedTime(newYork('2026-11-09T12:00'));
  const sertraline = schedule('s1', 'Sertraline', ['08:00']);
  const keys = Array.from({ length: 31 }, (_, i) => `${daysBefore('2026-11-09', i)}T08:00`);
  await openWith(page, { schedules: [sertraline], doses: taken('s1', 'Sertraline', keys) });
  await expect(page.getByText(/100% taken in 30 days/)).toBeVisible();

  await page.getByRole('button', { name: 'Edit Sertraline' }).click();
  await page.getByRole('dialog', { name: 'Edit medication' }).getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused · 100% taken in 30 days')).toBeVisible();

  // Three days later, the paused days have not turned into missed doses
  await page.clock.setFixedTime(newYork('2026-11-12T12:00'));
  await page.reload();
  await openTab(page, 'Meds');
  await expect(page.getByText('Paused · 100% taken in 30 days')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Sertraline' }).click();
  await page.getByRole('dialog', { name: 'Edit medication' }).getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Resumed')).toBeVisible();

  // This morning's dose fell during the pause, so it is neither overdue nor counted
  const morning = page.getByRole('group', { name: /^Sertraline 8:00\sAM$/ });
  await expect(morning.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Overdue')).toHaveCount(0);
  await expect(page.getByText(/^8:00\sAM · 100% taken in 30 days$/)).toBeVisible();
  const [saved] = await readStore<{ startDate: string; pauses: unknown[] }>(page, 'schedules');
  expect(saved.startDate).toBe(sertraline.startDate);
  expect(saved.pauses).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('an as-needed dose logged by mistake can be removed later', async ({ page }) => {
  const errors = watchErrors(page);
  await startFresh(page);
  await openTab(page, 'Meds');
  await page.getByRole('button', { name: 'Add a medication' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add medication' });
  await sheet.getByLabel('Name').fill('Ibuprofen');
  await sheet.getByLabel('How often').selectOption('as-needed');
  await sheet.getByRole('button', { name: 'Save' }).click();

  const logDose = page.getByRole('button', { name: 'Log dose' });
  await logDose.click();
  await expect(page.getByText('Taken 1 time today')).toBeVisible();
  await logDose.click();
  await page.getByRole('button', { name: /^Taken 2 times today/ }).click();

  const list = page.getByRole('dialog', { name: 'Ibuprofen doses' });
  await expect(list.getByRole('button', { name: /^Remove the dose taken at/ })).toHaveCount(2);
  await list
    .getByRole('button', { name: /^Remove the dose taken at/ })
    .first()
    .click();
  await expect(list.getByText('Removed')).toBeVisible();
  // Undo stays in the list while it is open, with no time limit
  await list.getByRole('button', { name: /^Undo removing/ }).click();
  await expect(list.getByRole('button', { name: /^Remove the dose taken at/ })).toHaveCount(2);
  await list
    .getByRole('button', { name: /^Remove the dose taken at/ })
    .first()
    .click();
  await list.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Taken 1 time today')).toBeVisible();
  expect(await readStore(page, 'adherence')).toHaveLength(1);

  // Doses stay reachable from the medication's edit sheet, also on later days
  await page.getByRole('button', { name: 'Edit Ibuprofen' }).click();
  await page.getByRole('dialog', { name: 'Edit medication' }).getByRole('button', { name: 'Logged doses' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Ibuprofen doses' }).getByRole('button', { name: /^Remove the dose/ }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

/** Opens the app with Ibuprofen doses taken at 9:00 AM and 2:00 PM on Nov 10. */
async function openWithIbuprofen(page: Page) {
  const loggedAt = (id: string, iso: string) => ({
    id,
    scheduleId: 'i1',
    medicationName: 'Ibuprofen',
    scheduledTime: iso,
    takenTime: iso,
    status: 'taken',
  });
  await openWith(page, {
    schedules: [{ ...schedule('i1', 'Ibuprofen', []), frequency: 'as-needed' }],
    doses: [loggedAt('d1', '2026-11-10T14:00:00.000Z'), loggedAt('d2', '2026-11-10T19:00:00.000Z')],
  });
}

/** Opens the list of Ibuprofen doses from the medication's edit sheet. */
async function openDoseList(page: Page) {
  await openWithIbuprofen(page);
  await page.getByRole('button', { name: 'Edit Ibuprofen' }).click();
  await page.getByRole('dialog', { name: 'Edit medication' }).getByRole('button', { name: 'Logged doses' }).click();
  const list = page.getByRole('dialog', { name: 'Ibuprofen doses' });
  await expect(list.getByRole('button', { name: /^Remove the dose taken at/ })).toHaveCount(2);
  return list;
}

const doseCount = async (page: Page) => (await readStore(page, 'adherence')).length;

test('a dose tapped twice in the dose list is removed and listed once', async ({ page }) => {
  const errors = watchErrors(page);
  const list = await openDoseList(page);
  // Two taps before the first removal has been saved
  await list.getByRole('button', { name: /^Remove the dose taken at 2:00\sPM$/ }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => doseCount(page)).toBe(1);
  await expect(list.getByText('Removed')).toHaveCount(1);
  await expect(list.getByRole('button', { name: /^(Remove|Undo removing) the dose taken at/ })).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('looking at logged doses keeps changes in the edit sheet that are not saved yet', async ({ page }) => {
  const errors = watchErrors(page);
  await openWithIbuprofen(page);
  await page.getByRole('button', { name: 'Edit Ibuprofen' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit medication' });
  await edit.getByLabel('Dose', { exact: true }).fill('400 mg');
  await edit.getByRole('button', { name: 'Logged doses' }).click();
  await page.getByRole('dialog', { name: 'Ibuprofen doses' }).getByRole('button', { name: 'Close' }).click();

  // The edit sheet is still open with the new dose, and saving it keeps the dose
  await expect(edit.getByLabel('Dose', { exact: true })).toHaveValue('400 mg');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Medication updated')).toBeVisible();
  const [saved] = await readStore<{ dosage: string }>(page, 'schedules');
  expect(saved.dosage).toBe('400 mg');
  expect(errors).toEqual([]);
});

test('doses the old app recorded are listed with their status', async ({ page }) => {
  const errors = watchErrors(page);
  // The old app keyed scheduled doses by their due time with seconds, and could record a skip
  const old = (id: string, scheduledTime: string, over: object) => ({
    id,
    scheduleId: 'm1',
    medicationName: 'Metformin',
    scheduledTime,
    ...over,
  });
  await openWith(page, {
    schedules: [schedule('m1', 'Metformin', ['08:00'])],
    doses: [
      old('old-1', '2025-08-16T08:00:00', { status: 'skipped' }),
      old('old-2', '2025-08-17T08:00:00', { status: 'taken', takenTime: '2025-08-17T12:05:00.000Z' }),
    ],
  });
  await page.getByRole('button', { name: 'Edit Metformin' }).click();
  await page.getByRole('dialog', { name: 'Edit medication' }).getByRole('button', { name: 'Logged doses' }).click();
  const list = page.getByRole('dialog', { name: 'Metformin doses' });
  await expect(list.getByText(/^8:00\sAM dose, skipped$/)).toBeVisible();
  await expect(list.getByText(/^Taken at 8:05\sAM$/)).toBeVisible();
  await expect(list.getByText(/^Taken at 8:00\sAM$/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('putting back a removed dose keeps focus on that dose', async ({ page }) => {
  const errors = watchErrors(page);
  const list = await openDoseList(page);
  await list.getByRole('button', { name: /^Remove the dose taken at 2:00\sPM$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(list.getByRole('button', { name: /^Undo removing the dose taken at 2:00\sPM$/ })).toBeFocused();
  await expect.poll(() => doseCount(page)).toBe(1);

  await page.keyboard.press('Enter');
  await expect.poll(() => doseCount(page)).toBe(2);
  await expect(list.getByText('Removed')).toHaveCount(0);
  await expect(list.getByRole('button', { name: /^Remove the dose taken at 2:00\sPM$/ })).toBeFocused();
  expect(errors).toEqual([]);
});
