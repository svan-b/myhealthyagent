/**
 * @jest-environment jsdom
 */
// Removing remembered symptoms and items, and fixing an item's category. The screen, the data hook and the
// database are real (in memory).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as v8 from 'node:v8';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LogScreen } from '@/app/components/log/LogScreen';
import { findTriggers } from '@/lib/analysis/triggers';
import { db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import type { Factor } from '@/lib/db/schema';
import { HealthDataProvider } from '@/lib/hooks/useHealthData';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// jsdom has neither structuredClone (fake-indexeddb needs it) nor React's act environment flag.
(globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) => v8.deserialize(v8.serialize(v));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
// Kombucha was remembered as food by mistake, so every entry of it says food.
const kombucha: Factor[] = [3, 2, 1].map(d => ({
  id: `k${d}`,
  name: 'Kombucha',
  category: 'food',
  timestamp: daysAgo(d),
}));
const oatMilk: Factor = { id: 'o1', name: 'Oat milk', category: 'drink', timestamp: daysAgo(1) };

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
  await db.addFactors([...kombucha, oatMilk]);
  await db.updatePreferences({
    customSymptoms: ['Brain fogg', 'Hives'],
    customFactors: [
      { name: 'Kombucha', category: 'food' },
      { name: 'Oat milk', category: 'drink' },
    ],
  });
  // Let the change notice go out before the screen listens for it.
  await new Promise(r => setTimeout(r, 10));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <HealthDataProvider>
        <LogScreen />
      </HealthDataProvider>,
    ),
  );
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const settle = () => act(async () => void (await new Promise(r => setTimeout(r, 30))));
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll('button')];
/** A button by its accessible name, which is its aria-label or its words. */
const button = (name: string, scope: ParentNode = document) =>
  buttons(scope).find(b => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name);
const click = async (name: string, scope?: ParentNode) => {
  const b = button(name, scope);
  if (!b)
    throw new Error(
      `No button ${name} in: ${buttons(scope)
        .map(x => x.getAttribute('aria-label') ?? x.textContent?.trim())
        .join(' | ')}`,
    );
  await act(async () => b.click());
  await settle();
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const group = (name: string) =>
  [...container.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent === name);
const prefs = () => db.getPreferences();
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
};
const labelled = (text: string) => {
  const label = [...dialog().querySelectorAll('label')].find(l => l.textContent === text)!;
  return document.getElementById(label.htmlFor) as HTMLSelectElement;
};

describe('your symptoms', () => {
  it('Edit opens a sheet where a symptom can be removed, and Undo puts it back in its place', async () => {
    const yours = group('Yours')!;
    expect(buttons(yours).map(b => b.textContent?.trim())).toEqual(['Edit your symptoms', 'Brain fogg', 'Hives']);
    await click('Edit your symptoms', yours);
    expect(dialog().textContent).toContain('Your symptoms');

    await click('Remove Brain fogg', dialog());
    expect((await prefs()).customSymptoms).toEqual(['Hives']);
    // The chip is gone from the Log screen, and the row stays with Undo while the sheet is open.
    expect(button('Brain fogg', container)).toBeUndefined();
    expect(dialog().textContent).toContain('Removed');

    await click('Undo removing Brain fogg', dialog());
    expect((await prefs()).customSymptoms).toEqual(['Brain fogg', 'Hives']);
    expect(button('Brain fogg', container)).toBeDefined();
  });

  it('removing the last one closes nothing and leaves the listed symptoms', async () => {
    await click('Edit your symptoms', group('Yours')!);
    await click('Remove Brain fogg', dialog());
    await click('Remove Hives', dialog());
    expect((await prefs()).customSymptoms).toEqual([]);
    expect(dialog()).not.toBeNull();
    expect(group('Yours')).toBeUndefined();
    expect(button('Headache', container)).toBeDefined();
  });
});

describe('your items', () => {
  beforeEach(() => click('What I had or did'));

  it('a category change is used from now on, and earlier entries change only when asked', async () => {
    await click('Edit your items', group('Yours')!);
    await choose(labelled('Category of Kombucha'), 'drink');

    // The remembered item changes in place. The entries already logged do not, until the person asks.
    expect((await prefs()).customFactors).toEqual([
      { name: 'Kombucha', category: 'drink' },
      { name: 'Oat milk', category: 'drink' },
    ]);
    const before = (await db.getAllFactors()).filter(f => f.name === 'Kombucha');
    expect(before.map(f => f.category)).toEqual(['food', 'food', 'food']);
    expect(dialog().textContent).toContain('3 earlier entries are under Food.');

    await click('Change them to Drink', dialog());
    const after = (await db.getAllFactors()).filter(f => f.name === 'Kombucha');
    expect(after.map(f => f.category)).toEqual(['drink', 'drink', 'drink']);
    expect(after.every(f => f.updatedAt)).toBe(true);
    expect(dialog().textContent).toContain('3 earlier entries changed to Drink.');

    // Undo puts them back exactly as they were.
    await click('Undo changing earlier entries of Kombucha', dialog());
    expect((await db.getAllFactors()).filter(f => f.name === 'Kombucha')).toEqual(before);
    expect(dialog().textContent).toContain('3 earlier entries are under Food.');

    // Close the sheet and log Kombucha. It is saved as a drink.
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();
    await click('Kombucha', group('Yours')!);
    await click('Save 1 item');
    const logged = (await db.getAllFactors()).find(f => f.name === 'Kombucha' && !f.id.startsWith('k'));
    expect(logged?.category).toBe('drink');
  });

  it('an item can be removed, and Undo puts it back with its category in its place', async () => {
    await click('Edit your items', group('Yours')!);
    await click('Remove Kombucha', dialog());
    expect((await prefs()).customFactors).toEqual([{ name: 'Oat milk', category: 'drink' }]);
    expect(button('Kombucha', container)).toBeUndefined();
    // Entries already logged stay.
    expect((await db.getAllFactors()).filter(f => f.name === 'Kombucha')).toHaveLength(3);

    await click('Undo removing Kombucha', dialog());
    expect((await prefs()).customFactors).toEqual([
      { name: 'Kombucha', category: 'food' },
      { name: 'Oat milk', category: 'drink' },
    ]);
  });
});

it('finds names restored from a backup as they were typed, with other spaces and capitals', async () => {
  await db.updatePreferences({
    customSymptoms: ['  brain   FOGG '],
    customFactors: [{ name: ' kombucha ', category: 'food' }],
  });
  await db.setCustomFactorCategory('Kombucha', 'drink');
  expect((await prefs()).customFactors).toEqual([{ name: ' kombucha ', category: 'drink' }]);
  await db.forgetCustomFactor('Kombucha');
  await db.forgetCustomSymptom('Brain fogg');
  expect(await prefs()).toMatchObject({ customSymptoms: [], customFactors: [] });
});

it('the trigger finder groups an item by name, so entries under two categories stay one item', () => {
  const day = (d: number, h: number) => new Date(2026, 9, 1 + d, h).toISOString();
  const factors: Factor[] = Array.from({ length: 20 }, (_, d) => ({
    id: `f${d}`,
    name: 'Kombucha',
    category: d % 2 ? 'drink' : 'food',
    timestamp: day(d, 12),
  }));
  const symptoms = Array.from({ length: 20 }, (_, d) => ({
    id: `s${d}`,
    name: 'Bloating',
    severity: 5,
    timestamp: day(d, 18),
  }));
  const result = findTriggers(symptoms, factors, { now: new Date(day(21, 0)) });
  const names = [...result.factorsTested, ...result.factorsSkipped.map(f => f.name)];
  expect(names.filter(n => n === 'Kombucha')).toHaveLength(1);
});
