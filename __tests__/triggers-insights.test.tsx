/** @jest-environment jsdom */
// The Insights screen. What it says when nothing stands out, the readiness card, and doses.
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Factor, MedicationAdherence, Symptom } from '@/lib/db/schema';
import { InsightsScreen } from '@/app/components/insights/InsightsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: { symptoms: Symptom[]; factors: Factor[]; doses: MedicationAdherence[] } = {
  symptoms: [],
  factors: [],
  doses: [],
};

jest.mock('@/lib/hooks/useHealthData', () => ({
  useHealthData: () => ({ ...data, schedules: [], loading: false, error: null, prefs: {}, reload: async () => {} }),
}));
jest.mock('@/lib/pro/client', () => ({ usePro: () => ({ isPro: true, enabled: false }) }));

let seq = 0;
const today = new Date();
const at = (daysAgo: number, hour: number) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, 0, 0).getTime() + hour * 3_600_000;
const sym = (name: string, t: number): Symptom => ({
  id: `s${seq++}`,
  name,
  severity: 6,
  timestamp: new Date(t).toISOString(),
});
const fac = (name: string, t: number, category: Factor['category'] = 'food'): Factor => ({
  id: `f${seq++}`,
  name,
  category,
  timestamp: new Date(t).toISOString(),
});

let root: Root;
let container: HTMLDivElement;

async function show(next: Partial<typeof data>) {
  data.symptoms = next.symptoms ?? [];
  data.factors = next.factors ?? [];
  data.doses = next.doses ?? [];
  await act(async () => root.render(<InsightsScreen />));
  // Without workers the analysis runs on the main thread after a short yield.
  await act(async () => new Promise(r => setTimeout(r, 0)));
  return container.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('when nothing stands out', () => {
  it('does not claim a real result when nothing could be checked', async () => {
    // 20 days with coffee at 08:00 every day, a different dinner each night, pizza on two nights each
    // followed by a migraine 14 hours later, and five other migraines.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 20; d >= 1; d--) {
      factors.push(fac('Coffee', at(d, 8), 'drink'));
      factors.push(fac(d === 15 || d === 6 ? 'Pizza' : `Dinner ${d}`, at(d, 19)));
    }
    symptoms.push(sym('Migraine', at(15, 33)), sym('Migraine', at(6, 33)));
    for (const d of [18, 13, 10, 4, 2]) symptoms.push(sym('Migraine', at(d, 11)));

    const text = await show({ symptoms, factors });
    expect(text).toContain('Nothing could be checked yet, so nothing is ruled out.');
    expect(text).toContain('Coffee is logged every day or at the same time each day');
    expect(text).toMatch(/Pizza, .* more need at least 3 logs before they can be checked\./);
    expect(text).not.toContain('That is a real result');
  });

  it('says what was checked and what was not', async () => {
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 30; d >= 1; d--) {
      factors.push(fac('Coffee', at(d, 8), 'drink'));
      if (d % 3 === 0) factors.push(fac('Dairy', at(d, 9 + (d % 7))));
      if (d % 4 === 1) factors.push(fac('Gluten', at(d, 11 + (d % 5))));
      if (d % 5 === 2) symptoms.push(sym('Headache', at(d, 10 + (d % 9))));
    }
    factors.push(fac('Pizza', at(12, 19)), fac('Pizza', at(4, 19)));
    symptoms.push(sym('Migraine', at(11, 9)));

    const text = await show({ symptoms, factors });
    expect(text).toContain(
      'None of the 2 items that could be checked is clearly followed by more symptoms than usual.',
    );
    expect(text).toContain('That is a real result.');
    expect(text).toContain('Not checked yet, so not ruled out');
    expect(text).toContain('Coffee is logged every day or at the same time each day');
    expect(text).toContain('Pizza needs at least 3 logs before it can be checked.');
    expect(text).toContain('Migraine needs to be logged on at least 3 separate occasions before it can be checked.');
  });
});

describe('readiness card', () => {
  it('never shows more days than the goal', async () => {
    // 40 days of symptom logs and only 4 other logs. Still collecting, because of the other logs.
    const symptoms = Array.from({ length: 40 }, (_, i) => sym('Fatigue', at(i + 1, 14)));
    const factors = [1, 2, 3, 4].map(d => fac('Dairy', at(d, 12)));
    const text = await show({ symptoms, factors });
    expect(text).toContain('4 of 10 food, drink and activity logs');
    expect(text).toContain('40 days tracked');
    expect(text).not.toMatch(/40 of 14/);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.getAttribute('aria-label')).toBe('Food, drink and activity logs');
  });

  it('counts days while there are fewer than the goal', async () => {
    const symptoms = Array.from({ length: 6 }, (_, i) => sym('Fatigue', at(i + 1, 14)));
    const text = await show({ symptoms, factors: [fac('Dairy', at(1, 12))] });
    expect(text).toContain('6 of 14 days tracked');
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('6');
    expect(bar.getAttribute('aria-valuemax')).toBe('14');
  });
});

describe('doses', () => {
  it('does not treat a day with only a ticked dose as tracked', async () => {
    // A pill ticked every morning for 60 days. The Log tab is used every other day, with coffee at
    // 08:00 and, on half of those days, a headache at 14:00. On the days with only the pill nothing
    // was logged, so they say nothing about headaches.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    const doses: MedicationAdherence[] = [];
    for (let d = 60; d >= 1; d--) {
      const day = new Date(at(d, 0));
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      doses.push({
        id: `dose${d}`,
        scheduleId: 'm1',
        medicationName: 'Sertraline',
        scheduledTime: `${key}T07:30`,
        takenTime: new Date(at(d, 7.5)).toISOString(),
        status: 'taken',
      });
      if (d % 2) continue;
      factors.push(fac('Coffee', at(d, 8), 'drink'));
      if (d % 4 === 0) symptoms.push(sym('Headache', at(d, 14)));
    }
    const text = await show({ symptoms, factors, doses });
    expect(container.querySelector('h3')).toBeNull();
    expect(text).not.toContain('Headache followed coffee');
    expect(text).toContain('Sertraline and Coffee are logged every day or at the same time each day');
  });
});
