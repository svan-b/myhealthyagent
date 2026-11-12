/**
 * @jest-environment jsdom
 */
// "Same one" adds the new note to the earlier entry. Nothing the person wrote may be cut or dropped on the way,
// and the toast that offers Undo stays long enough to use. The screen, the data hook and the database are real
// (in memory). Only toasts are caught.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as v8 from 'node:v8';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { LogScreen } from '@/app/components/log/LogScreen';
import { MAX_NOTE_LENGTH, db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import type { Symptom } from '@/lib/db/schema';
import { HealthDataProvider } from '@/lib/hooks/useHealthData';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const success = toast.success as unknown as jest.Mock;
const failure = toast.error as unknown as jest.Mock;

// jsdom has neither structuredClone (fake-indexeddb needs it) nor React's act environment flag.
(globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) => v8.deserialize(v8.serialize(v));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const earlier = (notes: string): Symptom => ({
  id: 'earlier',
  name: 'Headache',
  severity: 5,
  timestamp: new Date(Date.now() - 8 * 3_600_000).toISOString(),
  ongoing: true,
  notes,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});

describe('db.continueSymptom', () => {
  it('keeps a long earlier note whole when no note is added', async () => {
    // Notes from an old backup can be longer than a note can be now.
    const long = 'Woke up with it. '.repeat(100).trim();
    expect(long.length).toBeGreaterThan(MAX_NOTE_LENGTH);
    await db.restoreSymptom(earlier(long));
    const { after } = await db.continueSymptom('earlier', { severity: 7, notes: '' });
    expect(after.notes).toBe(long);
    expect((await db.getAllSymptoms())[0].notes).toBe(long);
  });

  it('adds a note that fits on its own line', async () => {
    await db.restoreSymptom(earlier('x'.repeat(MAX_NOTE_LENGTH - 10)));
    const { after } = await db.continueSymptom('earlier', { severity: 7, notes: ' Lay down ' });
    expect(after.notes).toBe(`${'x'.repeat(MAX_NOTE_LENGTH - 10)}\nLay down`);
  });

  it('refuses a note that does not fit, and changes nothing', async () => {
    const row = earlier('y'.repeat(990));
    await db.restoreSymptom(row);
    await expect(db.continueSymptom('earlier', { severity: 9, notes: 'Lay down for an hour' })).rejects.toThrow(
      'This note does not fit in the earlier entry, which already has a long note. Shorten it, or tap Save again and choose New one.',
    );
    expect(await db.getAllSymptoms()).toEqual([row]);
  });
});

describe('on the Log screen', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const settle = () => act(async () => void (await new Promise(r => setTimeout(r, 30))));
  const button = (name: string, scope: ParentNode = document) =>
    [...scope.querySelectorAll('button')].find(
      b =>
        b.textContent?.trim() === name ||
        (b.hasAttribute('aria-pressed') && b.textContent?.startsWith(name) && b.className.includes('min-h-20')),
    );
  const click = async (name: string, scope?: ParentNode) => {
    const b = button(name, scope);
    if (!b) throw new Error(`No button ${name}`);
    await act(async () => b.click());
    await settle();
  };
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  /** Opens the Log screen with an earlier entry, logs a severe headache with a note, and answers "Same one". */
  async function logAgainAsSameOne(row: Symptom) {
    await db.restoreSymptom(row);
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

    await click('Headache');
    await click('Severe');
    await click('Add a note');
    const note = container.querySelector<HTMLTextAreaElement>('#symptom-note')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Lay down for an hour');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Save headache');
    await click('Same one, still going', dialog()!);
  }

  it('keeps the toast long enough to read it and reach Undo', async () => {
    await logAgainAsSameOne(earlier('Woke up with it'));
    expect(success).toHaveBeenCalledTimes(1);
    const [title, options] = success.mock.calls[0];
    expect(title).toBe('Headache updated');
    expect(options.action.label).toBe('Undo');
    // The default is 4 seconds, too short for two sentences and a button.
    expect(options.duration).toBeGreaterThanOrEqual(10_000);
  });

  it('says so when the note does not fit, keeps what was entered, and saves it as a new one when asked', async () => {
    const row = earlier('y'.repeat(990));
    await logAgainAsSameOne(row);

    expect(failure).toHaveBeenCalledWith(expect.stringMatching(/^This note does not fit in the earlier entry/));
    expect(success).not.toHaveBeenCalled();
    expect(await db.getAllSymptoms()).toEqual([row]);
    // Nothing entered is lost. The form is still there with the note.
    expect(container.querySelector<HTMLTextAreaElement>('#symptom-note')?.value).toBe('Lay down for an hour');

    await click('Save headache');
    await click('New one', dialog()!);
    const rows = await db.getAllSymptoms();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id !== 'earlier')).toMatchObject({ severity: 7, notes: 'Lay down for an hour' });
  });
});
