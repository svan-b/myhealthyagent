/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LogScreen } from '@/app/components/log/LogScreen';

type Row = { name: string; category?: string };

// The screen is real. Storage, toasts and the data hook are mocked.
const mockAddFactors = jest.fn<Promise<void>, [Row[]]>(async () => {});
const mockAddSymptom = jest.fn(async (s: Row & { severity: number }) => s);
const mockRememberFactor = jest.fn<Promise<void>, [string, string]>(async () => {});
const mockRememberSymptom = jest.fn<Promise<void>, [string]>(async () => {});
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
    addSymptom: (s: Row & { severity: number }) => mockAddSymptom(s),
    addFactors: (rows: Row[]) => mockAddFactors(rows),
    rememberCustomSymptom: (name: string) => mockRememberSymptom(name),
    rememberCustomFactor: (name: string, category: string) => mockRememberFactor(name, category),
    currentStreak: () => 0,
    deleteSymptom: async () => {},
    deleteFactor: async () => {},
  },
  requestPersistentStorage: async () => true,
}));
jest.mock('@/lib/hooks/useHealthData', () => ({ useHealthData: () => mockData }));
jest.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  jest.clearAllMocks();
  mockData.prefs = { customSymptoms: [], customFactors: [] };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<LogScreen />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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
const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
const field = (id: string) => container.querySelector<HTMLInputElement & HTMLSelectElement>(`#${id}`)!;
/** Types into "Something else" and presses Add, the way a person would. */
const addFactor = async (text: string, category?: string) => {
  if (category) await setValue(field('custom-factor-cat'), category);
  await setValue(field('custom-factor'), text);
  await act(async () => field('custom-factor').form!.requestSubmit());
};
const savedFactors = () => mockAddFactors.mock.calls.flatMap(c => c[0].map(r => [r.name, r.category]));

describe('typing a food or activity that is already on screen', () => {
  beforeEach(() => click('What I had or did'));

  it('selects the chip, so it shows, can be unselected, and is saved once with its own category', async () => {
    await addFactor('alcohol');
    expect(pressed('Alcohol')).toBe('true');
    expect(saveButton().textContent).toBe('Save 1 item');

    await click('Alcohol');
    expect(saveButton().textContent).toBe('Pick at least one');

    await addFactor('alcohol');
    await click('Save 1 item');
    expect(savedFactors()).toEqual([['Alcohol', 'drink']]);
  });

  it('uses the chip category even when the name is typed exactly', async () => {
    await addFactor('Caffeine', 'food');
    await click('Save 1 item');
    expect(savedFactors()).toEqual([['Caffeine', 'drink']]);
  });

  it('matches names with extra spaces the way they are stored', async () => {
    await addFactor('  spicy   FOOD ');
    expect(pressed('Spicy food')).toBe('true');
    await click('Save 1 item');
    expect(savedFactors()).toEqual([['Spicy food', 'food']]);
  });

  it('keeps the spelling and category of a remembered item', async () => {
    await act(async () => root.unmount());
    mockData.prefs = { customSymptoms: [], customFactors: [{ name: 'Red wine', category: 'drink' }] };
    root = createRoot(container);
    await act(async () => root.render(<LogScreen />));
    await click('What I had or did');

    await addFactor('red wine');
    expect(pressed('Red wine')).toBe('true');
    expect(saveButton().textContent).toBe('Save 1 item');
    await click('Save 1 item');
    expect(savedFactors()).toEqual([['Red wine', 'drink']]);
    expect(mockRememberFactor).toHaveBeenCalledWith('Red wine', 'drink');
  });

  it('adds a new item once, even when it is typed again in another case', async () => {
    await addFactor('Kombucha', 'drink');
    await addFactor('kombucha', 'drink');
    expect(pressed('Kombucha')).toBe('true');
    expect(saveButton().textContent).toBe('Save 1 item');
    await click('Save 1 item');
    expect(savedFactors()).toEqual([['Kombucha', 'drink']]);
  });
});

it('a typed symptom that is already listed uses the listed name', async () => {
  await setValue(field('custom-symptom'), 'headache');
  await act(async () => field('custom-symptom').form!.requestSubmit());
  expect(container.querySelector('h2')?.textContent).toBe('Headache');
  await click(/^Mild/);
  await click('Save headache');
  expect(mockAddSymptom.mock.calls[0][0].name).toBe('Headache');
  expect(mockRememberSymptom).not.toHaveBeenCalled();
});
