/**
 * @jest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LogScreen } from '@/app/components/log/LogScreen';
import { SEVERITY_LEVELS } from '@/lib/utils';

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
  db: { currentStreak: () => 0 },
  requestPersistentStorage: async () => true,
}));
jest.mock('@/lib/hooks/useHealthData', () => ({ useHealthData: () => mockData }));
jest.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<LogScreen />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (text: string | RegExp) => {
  const all = [...container.querySelectorAll('button')];
  const found = all.find(b => {
    const t = b.textContent?.trim() ?? '';
    return typeof text === 'string' ? t === text : text.test(t);
  });
  if (!found) throw new Error(`No button ${text}`);
  return found;
};

it('the symptom Add and Back buttons are named by the words they show, so voice control finds them', async () => {
  const input = container.querySelector<HTMLInputElement>('#custom-symptom')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Hives');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // An aria-label would replace the visible word as the name.
  expect(button('Add').hasAttribute('aria-label')).toBe(false);
  await act(async () => input.form!.requestSubmit());
  expect(button('Back').hasAttribute('aria-label')).toBe(false);
});

it('a chosen severity uses the text color made for its fill, at full strength', async () => {
  await act(async () => button('Headache').click());
  for (const level of SEVERITY_LEVELS) {
    const b = button(new RegExp(`^${level.label}`));
    await act(async () => b.click());
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.style.color).toBe(level.on);
    expect(b.className).not.toMatch(/text-white/);
    const hint = [...b.querySelectorAll('span')].find(s => s.textContent === level.hint)!;
    // The hint takes the button color. Faded or white text fails contrast on these fills.
    expect(hint.className).not.toMatch(/text-(white|muted)/);
  }
});
