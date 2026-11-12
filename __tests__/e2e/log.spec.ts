import { test, expect, type Locator, type Page } from '@playwright/test';
import { openTab, startFresh, watchErrors } from './helpers';

type Saved = { name: string; category?: string; timestamp: string };

/** Reads saved entries straight from the app database. */
async function saved(page: Page, store: 'symptoms' | 'factors'): Promise<Saved[]> {
  return page.evaluate(async s => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: Saved[] = await new Promise((res, rej) => {
      const req = db.transaction(s).objectStore(s).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return rows.map(r => ({ name: r.name, category: r.category, timestamp: r.timestamp }));
  }, store);
}

// "|| 0" turns -0 into 0 when the entry was saved a moment after the given time.
const minutesBetween = (later: Date, iso: string) =>
  Math.round((later.getTime() - new Date(iso).getTime()) / 60_000) || 0;
const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

test.describe('when it happened', () => {
  test('"1 hr ago" counts from Save, and the picker is back on Now after saving food', async ({ page }) => {
    const errors = watchErrors(page);
    const morning = new Date(2026, 10, 12, 8, 0);
    await page.clock.install({ time: morning });
    await startFresh(page);
    await page.getByRole('radio', { name: 'What I had or did' }).click();
    const now = page.getByRole('button', { name: 'Now', exact: true });
    const hourAgo = page.getByRole('button', { name: '1 hr ago' });

    await hourAgo.click();
    await page.getByRole('button', { name: 'Caffeine', exact: true }).click();
    // A few minutes pass before Save is tapped.
    const firstSave = new Date(2026, 10, 12, 8, 10);
    await page.clock.setSystemTime(firstSave);
    await page.getByRole('button', { name: 'Save 1 item' }).click();
    await expect(page.getByText('Caffeine logged')).toBeVisible();
    await expect(now).toHaveAttribute('aria-pressed', 'true');
    await expect(hourAgo).toHaveAttribute('aria-pressed', 'false');

    // The screen stays open. Four hours later the next item is saved without touching the picker.
    const secondSave = new Date(2026, 10, 12, 12, 10);
    await page.clock.setSystemTime(secondSave);
    await page.getByRole('button', { name: 'Dairy', exact: true }).click();
    await page.getByRole('button', { name: 'Save 1 item' }).click();
    await expect(page.getByText('Dairy logged')).toBeVisible();

    const rows = await saved(page, 'factors');
    expect(minutesBetween(firstSave, rows.find(r => r.name === 'Caffeine')!.timestamp)).toBe(60);
    expect(minutesBetween(secondSave, rows.find(r => r.name === 'Dairy')!.timestamp)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a date and time that is cleared or half entered blocks Save until it is complete', async ({ page }) => {
    const errors = watchErrors(page);
    await startFresh(page);
    await page.getByRole('button', { name: 'Headache', exact: true }).click();
    await page.getByRole('button', { name: /^Moderate/ }).click();
    await page.getByRole('button', { name: 'Earlier' }).click();
    const field = page.getByLabel('Date and time');
    const lastNight = new Date();
    lastNight.setDate(lastNight.getDate() - 1);
    lastNight.setHours(19, 0, 0, 0);
    await field.fill(localInput(lastNight));

    // Deleting one part of the date with the keyboard leaves the field incomplete, and its value empty.
    await field.focus();
    await page.keyboard.press('Backspace');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter a full date and time.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter a date and time' })).toBeDisabled();
    expect(await saved(page, 'symptoms')).toEqual([]);

    await field.fill(localInput(lastNight));
    await expect(field).not.toHaveAttribute('aria-invalid');
    await page.getByRole('button', { name: 'Save headache' }).click();
    await expect(page.getByText('Headache logged')).toBeVisible();
    const [row] = await saved(page, 'symptoms');
    expect(new Date(row.timestamp).getTime()).toBe(lastNight.getTime());
    expect(errors).toEqual([]);
  });
});

test('typing a food that already has a chip selects that chip and saves it once', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('radio', { name: 'What I had or did' }).click();
  await page.getByLabel('Something else').fill('alcohol');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const chip = page.getByRole('button', { name: 'Alcohol', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save 1 item' }).click();
  await expect(page.getByText('Alcohol logged')).toBeVisible();
  const rows = await saved(page, 'factors');
  expect(rows.map(r => [r.name, r.category])).toEqual([['Alcohol', 'drink']]);
});

test('voice control can find the symptom Add and Back buttons by the words they show', async ({ page }) => {
  await startFresh(page);
  await page.getByLabel('Other symptom').fill('Hives');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hives' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Headache', exact: true })).toBeVisible();
});

/** WCAG 2 contrast of two computed colors. A see-through foreground is blended over the background first. */
function contrast(fg: string, bg: string): number {
  const parse = (c: string) => {
    const m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (!m) throw new Error(`Unexpected color ${c}`);
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
  };
  const b = parse(bg);
  const f = parse(fg);
  const mixed = f.rgb.map((v, i) => v * f.a + b.rgb[i] * (1 - f.a));
  const lum = (rgb: number[]) => {
    const [r, g, bl] = rgb.map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(mixed), lum(b.rgb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the chosen severity is readable in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await startFresh(page);
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await page.getByRole('button', { name: 'Headache', exact: true }).click();

    for (const label of ['Mild', 'Moderate', 'Severe', 'Very severe']) {
      const button = page.getByRole('button', { name: new RegExp(`^${label}`) });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const colors = await button.evaluate(async el => {
        // The button fades to its new colors. Read them once that has finished.
        await Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished));
        const [name, hint] = [...el.children].map(c => getComputedStyle(c));
        return {
          fill: getComputedStyle(el).backgroundColor,
          name: name.color,
          hint: hint.color,
          opacity: hint.opacity,
        };
      });
      expect(colors.opacity).toBe('1');
      expect(contrast(colors.name, colors.fill), `${label} name`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.hint, colors.fill), `${label} hint`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test.describe('closing a sheet gives focus back', () => {
  async function logSymptom(page: Page, name: string) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: /^Mild/ }).click();
    await page.getByRole('button', { name: `Save ${name.toLowerCase()}` }).click();
    await expect(page.getByText(`${name} logged`)).toBeVisible();
  }

  /** Opens a sheet the way keyboard users do, by focusing the control and pressing Enter. */
  async function openWithKeyboard(page: Page, opener: Locator, sheet: Locator) {
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
  }

  test('in History, to the entry after Escape, Close and Save, and to the heading after Delete', async ({ page }) => {
    const errors = watchErrors(page);
    await startFresh(page);
    await logSymptom(page, 'Headache');
    await logSymptom(page, 'Nausea');
    await openTab(page, 'History');
    const row = page.getByRole('main').getByRole('button', { name: /Headache/ });
    const sheet = page.getByRole('dialog', { name: 'Edit symptom' });

    await openWithKeyboard(page, row, sheet);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(row).toBeFocused();

    await openWithKeyboard(page, row, sheet);
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(row).toBeFocused();

    await openWithKeyboard(page, row, sheet);
    await sheet.getByRole('button', { name: 'Save changes' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Changes saved')).toBeVisible();
    await expect(row).toBeFocused();

    await openWithKeyboard(page, row, sheet);
    await sheet.getByRole('button', { name: 'Delete', exact: true }).focus();
    await page.keyboard.press('Enter');
    await sheet.getByRole('button', { name: 'Delete for good' }).focus();
    await page.keyboard.press('Enter');
    await expect(row).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('in History, to the entry it was opened from, even when a click did not focus it', async ({ page }) => {
    await startFresh(page);
    await logSymptom(page, 'Headache');
    await openTab(page, 'History');
    // Safari does not focus a button on click or tap. Chromium behaves the same when mousedown is cancelled.
    await page.evaluate(() => document.addEventListener('mousedown', e => e.preventDefault(), true));
    await page.getByLabel('Search', { exact: true }).focus();
    const row = page.getByRole('main').getByRole('button', { name: /Headache/ });
    await row.click();
    const sheet = page.getByRole('dialog', { name: 'Edit symptom' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(row).toBeFocused();
  });

  test('from Reports and data, to the header button', async ({ page }) => {
    await startFresh(page);
    const menu = page.getByRole('button', { name: 'Reports and data' });
    const sheet = page.getByRole('dialog', { name: 'Reports and data' });
    await openWithKeyboard(page, menu, sheet);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test('in Meds, to the edit button, and to the heading after the medication is deleted', async ({ page }) => {
    const errors = watchErrors(page);
    await startFresh(page);
    await openTab(page, 'Meds');
    await page.getByRole('button', { name: 'Add a medication' }).click();
    const add = page.getByRole('dialog', { name: 'Add medication' });
    await add.getByLabel('Name').fill('Metformin');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Medication added')).toBeVisible();

    const edit = page.getByRole('button', { name: 'Edit Metformin' });
    const sheet = page.getByRole('dialog', { name: 'Edit medication' });
    await openWithKeyboard(page, edit, sheet);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(edit).toBeFocused();

    await openWithKeyboard(page, edit, sheet);
    await sheet.getByRole('button', { name: 'Delete', exact: true }).focus();
    await page.keyboard.press('Enter');
    await sheet.getByRole('button', { name: 'Delete for good' }).focus();
    await page.keyboard.press('Enter');
    await expect(edit).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Medications', level: 1 })).toBeFocused();
    expect(errors).toEqual([]);
  });
});
