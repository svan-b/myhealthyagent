/** @jest-environment jsdom */
// The symptom list under "Last 30 days" on Insights says how bad each symptom usually is.
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Symptom } from '@/lib/db/schema';
import { InsightsScreen } from '@/app/components/insights/InsightsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: { symptoms: Symptom[] } = { symptoms: [] };

jest.mock('@/lib/hooks/useHealthData', () => ({
  useHealthData: () => ({
    ...data,
    factors: [],
    doses: [],
    schedules: [],
    loading: false,
    error: null,
    prefs: {},
    reload: async () => {},
  }),
}));
jest.mock('@/lib/pro/client', () => ({ usePro: () => ({ isPro: true, enabled: false }) }));

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const log = (name: string, severity: number, d: number): Symptom => ({
  id: `${name}-${d}`,
  name,
  severity,
  timestamp: daysAgo(d),
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** The color dot and the text of a symptom's row in the "Last 30 days" list. */
async function row(symptoms: Symptom[], name: string) {
  data.symptoms = symptoms;
  await act(async () => root.render(<InsightsScreen />));
  // Without workers the trigger analysis runs on the main thread after a short yield.
  await act(async () => new Promise(r => setTimeout(r, 0)));
  const el = [...container.querySelectorAll('div')].find(
    d => d.children.length === 3 && d.children[1].textContent === name,
  );
  if (!el) throw new Error(`No row for ${name}`);
  return { dot: (el.children[0] as HTMLElement).style.backgroundColor, text: el.children[2].textContent };
}

it('names and colors a level the person actually logged, not the average', async () => {
  // Mild three times and Very severe once. The average (3.75) is Moderate, a level never logged.
  const { dot, text } = await row(
    [log('Headache', 2, 1), log('Headache', 2, 2), log('Headache', 2, 3), log('Headache', 9, 4)],
    'Headache',
  );
  expect(text).toBe('4 days, usually mild');
  expect(dot).toBe('var(--sev-1)');
});

it('uses the middle rating for the dot and the words together', async () => {
  // Moderate twice and Very severe once. The average (6.3) is Severe, which was never logged either.
  const { dot, text } = await row([log('Nausea', 5, 1), log('Nausea', 5, 2), log('Nausea', 9, 3)], 'Nausea');
  expect(text).toBe('3 days, usually moderate');
  expect(dot).toBe('var(--sev-2)');
});
