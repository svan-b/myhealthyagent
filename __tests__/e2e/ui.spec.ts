import { test, expect, type Page } from '@playwright/test';
import { openTab, startFresh, watchErrors } from './helpers';

type Row = Record<string, unknown>;

/** Reads a store straight from the app database. */
async function stored(page: Page, store: 'symptoms' | 'factors' | 'preferences'): Promise<Row[]> {
  return page.evaluate(async s => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('myHealthyAgent');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: Row[] = await new Promise((res, rej) => {
      const req = db.transaction(s).objectStore(s).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return rows;
  }, store);
}

const toast = (page: Page, title: string) => page.locator('[data-sonner-toast]').filter({ hasText: title });

/** Waits for a toast and closes it, so a later toast with the same words is the only one. */
async function closeToast(page: Page, title: string) {
  const t = toast(page, title);
  await expect(t).toBeVisible();
  await t.getByRole('button', { name: 'Close toast' }).click();
  await expect(t).toHaveCount(0);
}

async function logSymptom(page: Page, name: string, level: string, duration?: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${level}`) }).click();
  if (duration) await page.getByRole('button', { name: duration, exact: true }).click();
  await page.getByRole('button', { name: `Save ${name.toLowerCase()}` }).click();
}

test.describe('sheets', () => {
  test('a sheet with a description has it read, and one without has nothing read twice', async ({ page }) => {
    const errors = watchErrors(page);
    const warnings: string[] = [];
    page.on('console', m => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    await startFresh(page);

    await page.getByRole('button', { name: 'Reports and data' }).click();
    const settings = page.getByRole('dialog', {
      name: 'Reports and data',
      description: 'Everything here runs on your device.',
    });
    await expect(settings).toBeVisible();
    await expect(settings).toHaveAccessibleDescription('Everything here runs on your device.');
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    await logSymptom(page, 'Headache', 'Mild');
    await expect(toast(page, 'Headache logged')).toBeVisible();
    await openTab(page, 'History');
    await page
      .getByRole('main')
      .getByRole('button', { name: /Headache/ })
      .click();
    const edit = page.getByRole('dialog', { name: 'Edit symptom' });
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAccessibleDescription('');
    // The title is in the sheet once, so it is read once.
    await expect(edit.getByText('Edit symptom', { exact: true })).toHaveCount(1);
    expect(warnings.filter(w => /Description|aria-describedby/.test(w))).toEqual([]);
    expect(errors).toEqual([]);
  });
});

/** WCAG 2 contrast of two computed rgb() colors. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = c
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(v => {
        const x = Number(v) / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the chosen severity stands out from the page in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await startFresh(page);
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await page.getByRole('button', { name: 'Headache', exact: true }).click();

    const levels = ['Mild', 'Moderate', 'Severe', 'Very severe'];
    for (const [i, label] of levels.entries()) {
      const button = page.getByRole('button', { name: new RegExp(`^${label}`) });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const colors = await button.evaluate(async (el, n) => {
        await Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished));
        // What is behind the button, which is the nearest parent with a background.
        let behind = 'rgba(0, 0, 0, 0)';
        for (let p = el.parentElement; p && /rgba\(0, 0, 0, 0\)|transparent/.test(behind); p = p.parentElement) {
          behind = getComputedStyle(p).backgroundColor;
        }
        // The severity color as the dots use it, turned into rgb() the way the browser writes colors.
        const probe = document.createElement('span');
        probe.style.color = `var(--sev-${n})`;
        document.body.append(probe);
        const sev = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(el);
        return { border: style.borderTopColor, width: style.borderTopWidth, fill: style.backgroundColor, behind, sev };
      }, i + 1);
      expect(contrast(colors.border, colors.behind), `${label} border`).toBeGreaterThanOrEqual(3);
      expect(colors.width).toBe('2px');
      // The fill is still the severity color used for dots elsewhere.
      expect(colors.fill).toBe(colors.sev);
    }
  });
}

test('the hint under "Earlier" is tied to the field and announced when it appears', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('button', { name: 'Headache', exact: true }).click();
  await page.getByRole('button', { name: /^Moderate/ }).click();
  await page.getByRole('button', { name: 'Earlier' }).click();
  const field = page.getByLabel('Date and time');
  const id = await field.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  const hint = page.locator(`[id="${id}"]`);
  // A live region is only announced when it was already in the page before its text changed.
  await expect(hint).toHaveAttribute('aria-live', 'polite');
  await expect(hint).toHaveText('');
  await hint.evaluate(el => el.setAttribute('data-test-mark', ''));

  await field.focus();
  await page.keyboard.press('Backspace');
  await expect(hint).toHaveText('Enter a full date and time.');
  await expect(hint).toHaveAttribute('data-test-mark', '');
  await expect(field).toHaveAccessibleDescription('Enter a full date and time.');
});

test.describe('restoring a backup', () => {
  test('says when entries changed on this device since the backup were kept', async ({ page }) => {
    const errors = watchErrors(page);
    await startFresh(page);
    await logSymptom(page, 'Headache', 'Moderate');
    await expect(toast(page, 'Headache logged')).toBeVisible();

    await page.getByRole('button', { name: 'Reports and data' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reports and data' });
    await expect(
      sheet.getByText(
        'Restoring adds entries from the file. It never removes what is already here, and changes made on this device since the backup are kept.',
      ),
    ).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      sheet.getByRole('button', { name: 'Download backup' }).click(),
    ]);
    const backup = (await download.path())!;
    await page.keyboard.press('Escape');

    // Changed here after the backup was made.
    await openTab(page, 'History');
    await page
      .getByRole('main')
      .getByRole('button', { name: /Headache/ })
      .click();
    const edit = page.getByRole('dialog', { name: 'Edit symptom' });
    await edit.getByRole('button', { name: 'Severe', exact: true }).click();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(toast(page, 'Changes saved')).toBeVisible();

    await page.getByRole('button', { name: 'Reports and data' }).click();
    await page.locator('input[type=file]').setInputFiles(backup);
    const restored = toast(page, 'Backup restored');
    await expect(restored).toBeVisible();
    await expect(restored).toContainText(
      'Nothing new to add. Kept 1 entry you changed on this device after the backup was made.',
    );
    const [row] = await stored(page, 'symptoms');
    expect(row.severity).toBe(7);
    expect(errors).toEqual([]);
  });

  test('from the first screen, says what was restored', async ({ page }) => {
    await page.goto('/');
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
    const restored = toast(page, 'Backup restored');
    await expect(restored).toBeVisible();
    await expect(restored).toContainText('Restored 1 symptom and 1 other entry.');
  });
});

test.describe('logging a symptom again while it may still be going', () => {
  test('asks once, "Same one" updates the earlier entry, and Undo puts it back', async ({ page }) => {
    const errors = watchErrors(page);
    await page.clock.install({ time: new Date(2026, 10, 12, 8, 0) });
    await startFresh(page);
    await logSymptom(page, 'Headache', 'Moderate', 'Still going');
    await closeToast(page, 'Headache logged');
    const [earlier] = await stored(page, 'symptoms');

    // Eight and a half hours later, after lying down for a while, the headache is logged again.
    await page.clock.setSystemTime(new Date(2026, 10, 12, 16, 30));
    const question = page.getByRole('dialog', {
      name: 'Is this the same headache?',
      description: /^You logged headache at .+ as still going\. If it has not stopped since, it is the same one\.$/,
    });
    const logAgainAsSameOne = async () => {
      await page.getByRole('button', { name: 'Headache', exact: true }).click();
      await page.getByRole('button', { name: /^Severe/ }).click();
      await page.getByRole('button', { name: 'Add a note' }).click();
      await page.getByLabel('Note').fill('Lay down after lunch');
      await page.getByRole('button', { name: 'Save headache' }).click();
      await expect(question).toBeVisible();
      await question.getByRole('button', { name: 'Same one, still going' }).click();
      await expect(question).toBeHidden();
    };
    await logAgainAsSameOne();
    const updated = toast(page, 'Headache updated');
    await expect(updated).toBeVisible();
    await expect(updated).toContainText(/Still going since .+, now severe\. No new entry was added\./);

    // One entry, still going, with the higher rating and both notes.
    const rows = await stored(page, 'symptoms');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: earlier.id,
      timestamp: earlier.timestamp,
      severity: 7,
      ongoing: true,
      notes: 'Lay down after lunch',
    });
    expect(rows[0].updatedAt).toBeTruthy();
    // The Today list shows the one entry, updated.
    await expect(page.getByRole('main').getByText('Severe, Ongoing')).toHaveCount(1);

    // Undo puts the earlier entry back exactly as it was.
    await updated.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => stored(page, 'symptoms')).toEqual([earlier]);
    await expect(page.getByRole('main').getByText('Moderate, Ongoing')).toBeVisible();
    await expect(updated).toHaveCount(0);

    // Asked again, and History shows the one entry with what was added to it.
    await logAgainAsSameOne();
    await expect(toast(page, 'Headache updated')).toBeVisible();
    await openTab(page, 'History');
    const entry = page.getByRole('main').getByRole('button', { name: /Headache/ });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('Severe');
    await expect(entry).toContainText('Ongoing');
    await expect(entry).toContainText('Lay down after lunch');
    expect(errors).toEqual([]);
  });

  test('closing the question saves a new entry, and Undo removes only that one', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 12, 8, 0) });
    await startFresh(page);
    await logSymptom(page, 'Headache', 'Moderate');
    await closeToast(page, 'Headache logged');
    const [earlier] = await stored(page, 'symptoms');

    await page.clock.setSystemTime(new Date(2026, 10, 12, 15, 0));
    await logSymptom(page, 'Headache', 'Mild');
    const question = page.getByRole('dialog', { name: 'Is this the same headache?' });
    await expect(question).toHaveAccessibleDescription(/without saying how long it lasted/);
    await page.keyboard.press('Escape');
    await expect(question).toBeHidden();
    const logged = toast(page, 'Headache logged');
    await expect(logged).toBeVisible();
    expect(await stored(page, 'symptoms')).toHaveLength(2);

    await logged.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => stored(page, 'symptoms')).toEqual([earlier]);
  });

  test('does not ask when the earlier entry says how long it lasted', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 12, 8, 0) });
    await startFresh(page);
    await logSymptom(page, 'Nausea', 'Mild', '30 min');
    await closeToast(page, 'Nausea logged');
    await page.clock.setSystemTime(new Date(2026, 10, 12, 16, 0));
    await logSymptom(page, 'Nausea', 'Mild');
    await expect(toast(page, 'Nausea logged')).toBeVisible();
    expect(await stored(page, 'symptoms')).toHaveLength(2);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('your own symptoms and items', () => {
  test('an item can get another category, with its earlier entries if asked, and be removed', async ({ page }) => {
    const errors = watchErrors(page);
    await startFresh(page);
    await page.getByRole('radio', { name: 'What I had or did' }).click();
    // Typed with the category left on Food by mistake.
    await page.getByLabel('Something else').fill('Kombucha');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save 1 item' }).click();
    await closeToast(page, 'Kombucha logged');

    const yours = page.getByRole('group', { name: 'Yours' });
    const edit = yours.getByRole('button', { name: 'Edit your items' });
    await edit.click();
    const sheet = page.getByRole('dialog', {
      name: 'Your items',
      description: /^Remove an item you no longer need, or change the category it is saved with\./,
    });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Category of Kombucha').selectOption('drink');
    await expect(sheet.getByRole('status').filter({ hasText: '1 earlier entry is under Food.' })).toBeVisible();
    expect((await stored(page, 'factors')).map(f => f.category)).toEqual(['food']);
    await sheet.getByRole('button', { name: 'Change it to Drink' }).click();
    await expect(sheet.getByText('1 earlier entry changed to Drink.')).toBeVisible();
    expect((await stored(page, 'factors')).map(f => f.category)).toEqual(['drink']);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(edit).toBeFocused();

    // Logged again from its chip, it is now a drink.
    await yours.getByRole('button', { name: 'Kombucha', exact: true }).click();
    await page.getByRole('button', { name: 'Save 1 item' }).click();
    await expect(toast(page, 'Kombucha logged')).toBeVisible();
    await expect.poll(async () => (await stored(page, 'factors')).map(f => f.category)).toEqual(['drink', 'drink']);

    // Removed from the list, its entries stay in History.
    await edit.click();
    await sheet.getByRole('button', { name: 'Remove Kombucha' }).click();
    await expect(sheet.getByRole('button', { name: 'Undo removing Kombucha' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(yours).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Log', level: 1 })).toBeFocused();
    await openTab(page, 'History');
    await expect(page.getByRole('main').getByText('Kombucha', { exact: true })).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('a symptom typed with a mistake can be removed from the list', async ({ page }) => {
    await startFresh(page);
    await page.getByLabel('Other symptom').fill('Brain fogg');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: /^Mild/ }).click();
    await page.getByRole('button', { name: 'Save brain fogg' }).click();
    await expect(toast(page, 'Brain fogg logged')).toBeVisible();

    const yours = page.getByRole('group', { name: 'Yours' });
    await expect(yours.getByRole('button', { name: 'Brain fogg', exact: true })).toBeVisible();
    await yours.getByRole('button', { name: 'Edit your symptoms' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your symptoms' });
    await sheet.getByRole('button', { name: 'Remove Brain fogg' }).click();
    await page.keyboard.press('Escape');
    await expect(yours).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Brain fogg', exact: true })).toHaveCount(0);
    expect((await stored(page, 'preferences'))[0].customSymptoms).toEqual([]);
    // The entry is still there.
    expect((await stored(page, 'symptoms')).map(s => s.name)).toEqual(['Brain fogg']);
  });
});
