/**
 * @jest-environment jsdom
 */
// Logging a symptom again while an earlier entry of it may still be going. The screen, the data hook and the
// database are real (in memory). Only toasts are caught, so the test can press their Undo.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as v8 from 'node:v8';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { LogScreen } from '@/app/components/log/LogScreen';
import { findTriggers } from '@/lib/analysis/triggers';
import { db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import type { Symptom } from '@/lib/db/schema';
import { HealthDataProvider } from '@/lib/hooks/useHealthData';

type ToastOptions = { description?: string; action?: { label: string; onClick: () => unknown } };
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const success = toast.success as unknown as jest.Mock<void, [string, ToastOptions?]>;
const failure = toast.error as unknown as jest.Mock;

// jsdom has neither structuredClone (fake-indexeddb needs it) nor React's act environment flag.
(globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) => v8.deserialize(v8.serialize(v));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
// 7:00 in the morning, so an entry from 10 PM last night is from yesterday.
const NOW = new Date(2026, 10, 12, 7, 0);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  // Only the clock is fake. Timers stay real, so the database and the screen run as usual.
  jest.useFakeTimers({
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
});

const settle = () => act(async () => void (await new Promise(r => setTimeout(r, 30))));

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Saves an entry, then opens the Log screen with it. */
async function start(earlier: Symptom) {
  await db.restoreSymptom(earlier);
  // Let the change notice go out before the screen listens for it.
  await new Promise(r => setTimeout(r, 10));
  await act(async () =>
    root.render(
      <HealthDataProvider>
        <LogScreen />
      </HealthDataProvider>,
    ),
  );
  // Let the screen read the database.
  await settle();
  await waitFor(() => Boolean(button('Headache')), 'the Log screen');
}

/** A button by its words. Severity buttons also show a hint after their name, so those match by the start. */
const button = (name: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll('button')].find(
    b =>
      b.textContent?.trim() === name ||
      b.getAttribute('aria-label') === name ||
      (b.hasAttribute('aria-pressed') && b.textContent?.startsWith(name) && b.className.includes('min-h-20')),
  );
const click = async (name: string, scope?: ParentNode) => {
  const b = button(name, scope);
  if (!b) throw new Error(`No button ${name}`);
  await act(async () => b.click());
  await settle();
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const describedBy = (el: HTMLElement) =>
  document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent;

/** Logs a severe headache now, with a note, and waits for the question. */
async function logHeadacheAgain() {
  await click('Headache');
  await click('Severe');
  await click('Add a note');
  const note = container.querySelector<HTMLTextAreaElement>('#symptom-note')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Lay down for an hour');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Save headache');
  await waitFor(() => dialog() !== null, 'the question');
}

const stored = () => db.getAllSymptoms();
/** Headache starts the trigger finder counts. With no items logged, it lists every symptom as skipped. */
const starts = async () =>
  findTriggers(await stored(), [], { now: NOW }).symptomsSkipped.find(s => s.name === 'Headache')?.episodes;
const lastToast = () => success.mock.calls[success.mock.calls.length - 1];

const stillGoing: Symptom = {
  id: 'earlier',
  name: 'Headache',
  severity: 5,
  timestamp: hoursAgo(9),
  ongoing: true,
  notes: 'Woke up with it',
};

it('asks, and "Same one" updates the earlier entry instead of adding a new start', async () => {
  await start(stillGoing);
  expect(await starts()).toBe(1);
  await logHeadacheAgain();

  const question = dialog()!;
  expect(question.textContent).toContain('Is this the same headache?');
  expect(describedBy(question)).toMatch(/^You logged headache yesterday at .+ as still going\./);
  await click('Same one, still going', question);
  await waitFor(() => success.mock.calls.length > 0, 'the toast');

  const [row, ...others] = await stored();
  expect(others).toEqual([]);
  expect(row).toMatchObject({
    id: 'earlier',
    timestamp: stillGoing.timestamp,
    severity: 7,
    ongoing: true,
    notes: 'Woke up with it\nLay down for an hour',
  });
  expect(row.updatedAt).toBe(NOW.toISOString());
  expect(await starts()).toBe(1);

  const [title, options] = lastToast();
  expect(title).toBe('Headache updated');
  expect(options?.description).toMatch(/^Still going since yesterday at .+, now severe\. No new entry was added\.$/);

  // The Today list shows the entry it went to, from yesterday.
  const today = [...container.querySelectorAll('h2')].find(h => h.textContent === 'Today')!.parentElement!
    .nextElementSibling!;
  expect(today.textContent).toContain('Yesterday');
  expect(today.textContent).toContain('Headache');
  expect(today.textContent).toContain('Severe, Ongoing');

  // Undo puts the earlier entry back exactly as it was.
  await act(async () => void (await options!.action!.onClick()));
  await settle();
  expect(await stored()).toEqual([stillGoing]);
  expect(failure).not.toHaveBeenCalled();
});

it('"New one" saves a new entry as before, and Undo removes only that', async () => {
  await start(stillGoing);
  await logHeadacheAgain();
  await click('New one', dialog()!);
  await waitFor(() => success.mock.calls.length > 0, 'the toast');

  const rows = await stored();
  expect(rows).toHaveLength(2);
  expect(rows.find(r => r.id === 'earlier')).toEqual(stillGoing);
  expect(rows.find(r => r.id !== 'earlier')).toMatchObject({ severity: 7, timestamp: NOW.toISOString() });
  expect(await starts()).toBe(2);

  const [title, options] = lastToast();
  expect(title).toBe('Headache logged');
  await act(async () => void (await options!.action!.onClick()));
  await settle();
  expect(await stored()).toEqual([stillGoing]);
});

it('closing the question saves a new entry', async () => {
  await start(stillGoing);
  await logHeadacheAgain();
  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await waitFor(() => success.mock.calls.length > 0, 'the toast');
  expect(dialog()).toBeNull();
  expect(lastToast()[0]).toBe('Headache logged');
  expect(await stored()).toHaveLength(2);
});

it('does not ask when the earlier entry has a duration', async () => {
  await start({ ...stillGoing, ongoing: undefined, duration_minutes: 30 });
  await click('Headache');
  await click('Mild');
  await click('Save headache');
  await waitFor(() => success.mock.calls.length > 0, 'the toast');
  expect(dialog()).toBeNull();
  expect(await stored()).toHaveLength(2);
});

it('does not ask when the earlier entry started less than 6 hours before', async () => {
  await start({ ...stillGoing, timestamp: hoursAgo(5) });
  await click('Headache');
  await click('Mild');
  await click('Save headache');
  await waitFor(() => success.mock.calls.length > 0, 'the toast');
  expect(dialog()).toBeNull();
  expect(await stored()).toHaveLength(2);
});
