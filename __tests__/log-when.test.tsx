/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LogScreen } from '@/app/components/log/LogScreen';
import { WHEN_NOW, resolveWhen } from '@/app/components/log/WhenPicker';
import { toLocalInputValue } from '@/lib/utils';

// The screen and the time picker are real. Storage, toasts and the data hook are mocked.
const mockAddSymptom = jest.fn(async (s: { timestamp: string }) => s);
const mockAddFactors = jest.fn<Promise<void>, [{ timestamp: string }[]]>(async () => {});
const mockToastError = jest.fn();
const mockData = {
  symptoms: [],
  factors: [],
  schedules: [],
  doses: [],
  prefs: { customSymptoms: [] as string[], customFactors: [] as { name: string; category: string }[] },
  loading: false,
  error: null,
  reload: async () => {},
};

jest.mock('@/lib/db/client', () => ({
  ...jest.requireActual('@/lib/db/client'),
  db: {
    addSymptom: (s: { timestamp: string }) => mockAddSymptom(s),
    addFactors: (rows: { timestamp: string }[]) => mockAddFactors(rows),
    rememberCustomSymptom: async () => {},
    rememberCustomFactor: async () => {},
    currentStreak: () => 0,
    deleteSymptom: async () => {},
    deleteFactor: async () => {},
  },
  requestPersistentStorage: async () => true,
}));
jest.mock('@/lib/hooks/useHealthData', () => ({ useHealthData: () => mockData }));
jest.mock('sonner', () => ({
  toast: { success: () => {}, error: (...a: unknown[]) => mockToastError(...a) },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m);
const minutesBefore = (iso: string, ref: Date) => Math.round((ref.getTime() - new Date(iso).getTime()) / 60_000);

describe('resolveWhen', () => {
  const now = at(12).getTime();

  it('works out relative choices from the time it is given', () => {
    expect(resolveWhen(WHEN_NOW, now)?.getTime()).toBe(now);
    expect(resolveWhen({ kind: 'ago', minutes: 60 }, now)?.getTime()).toBe(at(11).getTime());
    expect(resolveWhen({ kind: 'ago', minutes: 180 }, now)?.getTime()).toBe(at(9).getTime());
  });

  it('keeps an earlier date as typed and gives null when it is empty or not complete', () => {
    expect(resolveWhen({ kind: 'at', local: '2026-11-11T19:30' }, now)?.getTime()).toBe(
      new Date(2026, 10, 11, 19, 30).getTime(),
    );
    expect(resolveWhen({ kind: 'at', local: '' }, now)).toBeNull();
    expect(resolveWhen({ kind: 'at', local: '2026-11-11T' }, now)).toBeNull();
  });
});

describe('time picker on the log screen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    // Only the clock is fake, so the time can move between taps like a phone left open on the screen.
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
    jest.setSystemTime(at(8));
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<LogScreen />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  const buttons = () => [...container.querySelectorAll('button')];
  const button = (name: string | RegExp) => {
    const found = buttons().find(b => {
      const text = b.textContent?.trim() ?? '';
      return typeof name === 'string' ? text === name : name.test(text);
    });
    if (!found)
      throw new Error(
        `No button ${name} in: ${buttons()
          .map(b => b.textContent?.trim())
          .join(' | ')}`,
      );
    return found;
  };
  const click = (name: string | RegExp) => act(async () => button(name).click());
  const pressed = (name: string) => button(name).getAttribute('aria-pressed');
  const saveButton = () => buttons()[buttons().length - 1];
  const dateInput = () => container.querySelector<HTMLInputElement>('input[type="datetime-local"]');
  // What a browser does when the person edits the field. The value changes, then an input event fires.
  const typeDate = (value: string) =>
    act(async () => {
      const input = dateInput()!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const lastFactorTime = () => mockAddFactors.mock.calls[mockAddFactors.mock.calls.length - 1][0][0].timestamp;
  const lastSymptomTime = () => mockAddSymptom.mock.calls[mockAddSymptom.mock.calls.length - 1][0].timestamp;

  it('"1 hr ago" for food counts from Save, and the picker goes back to Now after a save', async () => {
    await click('What I had or did');
    await click('1 hr ago');
    await click('Caffeine');
    jest.setSystemTime(at(8, 5));
    await click('Save 1 item');
    expect(minutesBefore(lastFactorTime(), at(8, 5))).toBe(60);
    expect(pressed('Now')).toBe('true');
    expect(pressed('1 hr ago')).toBe('false');

    // The screen stays open. Four hours later the next item is logged without touching the picker.
    jest.setSystemTime(at(12));
    await click('Dairy');
    await click('Save 1 item');
    expect(minutesBefore(lastFactorTime(), at(12))).toBe(0);

    await click('3 hrs ago');
    jest.setSystemTime(at(13));
    await click('Gluten');
    await click('Save 1 item');
    expect(minutesBefore(lastFactorTime(), at(13))).toBe(180);
    expect(pressed('Now')).toBe('true');
  });

  it('"1 hr ago" for a symptom counts from Save, and the next symptom starts at Now', async () => {
    await click('Headache');
    await click(/^Moderate/);
    await click('1 hr ago');
    jest.setSystemTime(at(8, 20));
    await click('Save headache');
    expect(minutesBefore(lastSymptomTime(), at(8, 20))).toBe(60);

    jest.setSystemTime(at(12));
    await click('Headache');
    expect(pressed('Now')).toBe('true');
    await click(/^Mild/);
    await click('Save headache');
    expect(minutesBefore(lastSymptomTime(), at(12))).toBe(0);
  });

  it('an emptied "Earlier" date blocks saving a symptom with a clear message, instead of saving it as now', async () => {
    await click('Headache');
    await click(/^Moderate/);
    await click('Earlier');
    expect(dateInput()?.value).toBe(toLocalInputValue(at(8)));
    await typeDate('2026-11-11T19:00');
    await typeDate('');

    expect(saveButton().textContent).toBe('Enter a date and time');
    expect(saveButton().disabled).toBe(true);
    expect(dateInput()?.getAttribute('aria-invalid')).toBe('true');
    const hint = document.getElementById(dateInput()!.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe('Enter a full date and time.');
    expect(pressed('Earlier')).toBe('true');
    await act(async () => saveButton().click());
    expect(mockAddSymptom).not.toHaveBeenCalled();

    await typeDate('2026-11-11T19:00');
    expect(dateInput()?.hasAttribute('aria-invalid')).toBe(false);
    await click('Save headache');
    expect(new Date(lastSymptomTime()).getTime()).toBe(new Date(2026, 10, 11, 19, 0).getTime());
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('an emptied "Earlier" date blocks saving food, and a full one is saved as typed', async () => {
    await click('What I had or did');
    await click('Dairy');
    await click('Earlier');
    await typeDate('');
    expect(saveButton().textContent).toBe('Enter a date and time');
    expect(saveButton().disabled).toBe(true);
    await act(async () => saveButton().click());
    expect(mockAddFactors).not.toHaveBeenCalled();

    await typeDate('2026-11-11T21:15');
    jest.setSystemTime(at(9));
    await click('Save 1 item');
    expect(new Date(lastFactorTime()).getTime()).toBe(new Date(2026, 10, 11, 21, 15).getTime());
    // Back to Now for the next item, so the old date is not reused by mistake.
    expect(pressed('Now')).toBe('true');
    expect(dateInput()).toBeNull();
  });

  it('"Earlier" starts at the time it is tapped, not when the screen opened', async () => {
    await click('What I had or did');
    jest.setSystemTime(at(15, 40));
    await click('Earlier');
    expect(dateInput()?.value).toBe(toLocalInputValue(at(15, 40)));
  });
});
