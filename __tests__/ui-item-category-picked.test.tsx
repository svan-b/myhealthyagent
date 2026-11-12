/**
 * @jest-environment jsdom
 */
// An item whose chip was picked before its category was fixed under Edit is saved with the fixed category.
// The screen, the data hook and the database are real (in memory).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as v8 from 'node:v8';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LogScreen } from '@/app/components/log/LogScreen';
import { db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import { HealthDataProvider } from '@/lib/hooks/useHealthData';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// jsdom has neither structuredClone (fake-indexeddb needs it) nor React's act environment flag.
(globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) => v8.deserialize(v8.serialize(v));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const settle = () => act(async () => void (await new Promise(r => setTimeout(r, 30))));
const button = (name: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name);
const click = async (name: string, scope?: ParentNode) => {
  const b = button(name, scope);
  if (!b) throw new Error(`No button ${name}`);
  await act(async () => b.click());
  await settle();
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const yours = () =>
  [...container.querySelectorAll('fieldset')].find(f => f.querySelector('legend')?.textContent === 'Yours')!;

beforeEach(async () => {
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
  // Kombucha was remembered as food by mistake.
  await db.addFactors([
    { id: 'k1', name: 'Kombucha', category: 'food', timestamp: new Date(Date.now() - 86_400_000).toISOString() },
  ]);
  await db.updatePreferences({ customFactors: [{ name: 'Kombucha', category: 'food' }] });
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
  await click('What I had or did');
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('saves an item picked before its category was changed with the new category, and keeps the change', async () => {
  // The chip is picked first. Then the person notices the category and fixes it under Edit.
  await click('Kombucha', yours());
  expect(button('Kombucha', yours())?.getAttribute('aria-pressed')).toBe('true');
  await click('Edit your items', yours());
  const select = [...dialog()!.querySelectorAll('select')][0];
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'drink');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
  expect(dialog()).toBeNull();
  // Still picked, so one tap saves it.
  expect(button('Kombucha', yours())?.getAttribute('aria-pressed')).toBe('true');

  await click('Save 1 item');
  const saved = (await db.getAllFactors()).find(f => f.id !== 'k1');
  expect(saved).toMatchObject({ name: 'Kombucha', category: 'drink' });
  // Saving remembers the item again. It must not put the old category back.
  expect((await db.getPreferences()).customFactors).toEqual([{ name: 'Kombucha', category: 'drink' }]);
});

it('still saves a typed item with the category chosen for it', async () => {
  const input = container.querySelector<HTMLInputElement>('#custom-factor')!;
  const category = container.querySelector<HTMLSelectElement>('#custom-factor-cat')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Oat milk');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(category, 'drink');
    category.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Add');
  await click('Save 1 item');
  expect((await db.getAllFactors()).find(f => f.name === 'Oat milk')?.category).toBe('drink');
});
