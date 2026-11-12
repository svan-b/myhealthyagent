import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pdfRuns, pdfText } from '../report-helpers';
import { watchErrors } from './helpers';

const MARK = String.fromCharCode(0xfffd);

/** Two weeks of logs with names and notes in Polish and Russian, and an emoji in a note. */
async function seedUnicode(page: Page) {
  await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['symptoms', 'factors', 'preferences'], 'readwrite');
    const now = new Date();
    const at = (d: number, h: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, h).toISOString();
    for (let d = 14; d >= 1; d--) {
      tx.objectStore('factors').put({ id: `f${d}`, name: 'Żurek', category: 'food', timestamp: at(d, 12) });
      if (d % 2)
        tx.objectStore('symptoms').put({
          id: `s${d}`,
          name: 'Ból głowy',
          severity: 5,
          timestamp: at(d, 9),
          notes: d === 1 ? 'Po kawie 😣' : undefined,
        });
      else tx.objectStore('symptoms').put({ id: `s${d}`, name: 'Головная боль', severity: 7, timestamp: at(d, 20) });
    }
    tx.objectStore('preferences').put({
      id: 'user-preferences',
      customSymptoms: [],
      customFactors: [],
      streakCount: 1,
      onboardedAt: at(14, 8),
    });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  });
}

async function downloadReport(page: Page) {
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF report' }).click(),
  ]);
  return new Uint8Array(await readFile((await pdf.path())!));
}

test('the report prints Polish and Russian names in an embedded font and says when an emoji could not be printed', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  await seedUnicode(page);
  await page.reload();
  await page.getByRole('button', { name: 'Reports and data' }).click();
  await page.getByLabel(/Your name/).fill('Łukasz Żółć');

  const bytes = await downloadReport(page);
  const lines = pdfText(bytes).split('\n');
  expect(lines).toEqual(
    expect.arrayContaining(['Patient: Łukasz Żółć', 'Ból głowy', 'Головная боль', 'Żurek (food)', `Po kawie ${MARK}`]),
  );
  expect(new Set(pdfRuns(bytes).map(r => r.font))).toEqual(new Set(['NotoSans']));
  await expect(page.getByText('Report downloaded')).toBeVisible();
  await expect(
    page.getByText(
      'Some characters, like emoji, could not be printed in the PDF. They are still in the app and in the spreadsheet export.',
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('without the report code', () => {
  // No service worker, so nothing is cached and going offline leaves the report code out of reach, as on the
  // first offline start after an update.
  test.use({ serviceWorkers: 'block' });

  test('a report made offline before its code was saved says to connect once, not a raw error', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await seedUnicode(page);
    await page.reload();
    await page.getByRole('button', { name: 'Reports and data' }).click();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Download PDF report' }).click();
    await expect(
      page.getByText(
        'Reports need an internet connection the first time after an update. Connect once, then try again.',
      ),
    ).toBeVisible();
    await expect(page.getByText(/Loading chunk/)).toHaveCount(0);
    await context.setOffline(false);
  });
});

/** Every file the report code loads on demand, as listed by the production build, the fonts included. */
async function reportFiles() {
  const manifest: Record<string, { files: string[] }> = JSON.parse(
    await readFile('.next/react-loadable-manifest.json', 'utf8'),
  );
  const entries = Object.entries(manifest).filter(
    ([from]) => from.endsWith(' -> @/lib/report/pdf') || from.startsWith('lib/report/pdf.ts -> '),
  );
  return {
    keys: entries.map(([from]) => from),
    files: [...new Set(entries.flatMap(([, entry]) => entry.files.map(f => `/_next/${f}`)))],
  };
}

test('after the first online visit, a report made offline still has its fonts', async ({ page, context }) => {
  const { keys, files } = await reportFiles();
  expect(keys).toEqual(expect.arrayContaining([expect.stringMatching(/-> \.\/noto-sans$/)]));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  await seedUnicode(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  // The app loads the report code in idle time, and the service worker caches it.
  await expect
    .poll(
      () => page.evaluate(async list => (await Promise.all(list.map(f => caches.match(f)))).every(Boolean), files),
      { timeout: 30_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Reports and data' }).click();
  const bytes = await downloadReport(page);
  expect(pdfText(bytes).split('\n')).toEqual(expect.arrayContaining(['Ból głowy', 'Головная боль']));
  expect(new Set(pdfRuns(bytes).map(r => r.font))).toEqual(new Set(['NotoSans']));
  await context.setOffline(false);
});
