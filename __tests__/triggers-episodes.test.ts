// What counts as a symptom start, and how a day with several starts is tested.
import { findTriggers, type TriggerAnalysis } from '@/lib/analysis/triggers';
import { clusteredUpperTail, poissonBinomialUpperTail } from '@/lib/analysis/stats';
import type { Factor, Symptom } from '@/lib/db/schema';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date(2026, 5, 30, 20, 0);
const nowMs = NOW.getTime();

let seq = 0;
const sym = (name: string, t: number, extra: Partial<Symptom> = {}): Symptom => ({
  id: `s${seq++}`,
  name,
  severity: 6,
  timestamp: new Date(t).toISOString(),
  ...extra,
});
const fac = (name: string, t: number, category: Factor['category'] = 'food'): Factor => ({
  id: `f${seq++}`,
  name,
  category,
  timestamp: new Date(t).toISOString(),
});

/** Local time `hour` (fractions allowed) on the day `daysAgo` days before NOW. */
const dayAt = (daysAgo: number, hour: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo).getTime() + hour * HOUR;

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('clusteredUpperTail', () => {
  it('matches the Poisson binomial when every count is 0 or 1', () => {
    const probs = [0.1, 0.5, 0.25, 0.9, 0.3];
    for (let k = 0; k <= 6; k++) {
      expect(
        clusteredUpperTail(
          probs.map(p => [1 - p, p]),
          k,
        ),
      ).toBeCloseTo(poissonBinomialUpperTail(probs, k), 12);
    }
  });

  it('treats a day with two starts as one draw', () => {
    // Each day has both of its starts in the window, or neither, half the time.
    const day = [0.5, 0, 0.5];
    expect(clusteredUpperTail([day, day], 2)).toBeCloseTo(0.75);
    expect(clusteredUpperTail([day, day], 3)).toBeCloseTo(0.25);
    expect(clusteredUpperTail([day, day], 4)).toBeCloseTo(0.25);
    expect(clusteredUpperTail([day, day], 5)).toBe(0);
    // Four independent starts would make all four in the window look four times less likely.
    expect(poissonBinomialUpperTail([0.5, 0.5, 0.5, 0.5], 4)).toBeCloseTo(0.0625);
  });
});

describe('symptom episodes', () => {
  // Enough other logging for the analysis to run.
  const background = () => {
    const factors: Factor[] = [];
    for (let d = 20; d >= 1; d--) factors.push(fac('Dairy', dayAt(d, 12 + (d % 5))));
    return factors;
  };

  it('counts a symptom logged again while it lasts as one start', () => {
    // Nausea logged at 8, 10 and 12 on one morning, and once on another day, is two episodes and not four.
    const symptoms = [8, 10, 12].map(h => sym('Nausea', dayAt(6, h)));
    symptoms.push(sym('Nausea', dayAt(3, 9)));
    const res = findTriggers(symptoms, background(), { now: NOW });
    expect(res.symptomsEligible).toBe(0);
    expect(res.symptomsSkipped).toEqual([{ name: 'Nausea', reason: 'few', episodes: 2 }]);
  });

  it('chains re-logs from the previous log, so a long episode logged every few hours stays one start', () => {
    const symptoms = [7, 12, 17, 22].map(h => sym('Fatigue', dayAt(8, h)));
    symptoms.push(sym('Fatigue', dayAt(4, 9)));
    const res = findTriggers(symptoms, background(), { now: NOW });
    expect(res.symptomsEligible).toBe(0);
  });

  it('uses a logged duration to tell separate episodes apart', () => {
    // The same times, but each log says it lasted under 15 minutes, so these are four separate episodes.
    const symptoms = [8, 10, 12].map(h => sym('Nausea', dayAt(6, h), { duration_minutes: 10 }));
    symptoms.push(sym('Nausea', dayAt(3, 9), { duration_minutes: 10 }));
    const res = findTriggers(symptoms, background(), { now: NOW });
    expect(res.symptomsEligible).toBe(1);
  });

  it('does not take a log marked still going as a short episode', () => {
    const symptoms = [8, 10, 12].map(h => sym('Nausea', dayAt(6, h), { ongoing: true }));
    symptoms.push(sym('Nausea', dayAt(3, 9)));
    expect(findTriggers(symptoms, background(), { now: NOW }).symptomsEligible).toBe(0);
  });

  // Headache at onset, "Lie down" 30 to 60 minutes later because of it, and the headache logged again
  // later because it is still there. Lying down never causes the headache here.
  function lieDown(seed: number, relogFrom: number, relogTo: number) {
    const r = mulberry32(seed);
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 45; d >= 1; d--) {
      factors.push(fac('Water', dayAt(d, 8 + r() * 4), 'drink'));
      factors.push(fac('Water', dayAt(d, 14 + r() * 6), 'drink'));
      for (const n of ['Dairy', 'Gluten', 'Sugar']) if (r() < 0.3) factors.push(fac(n, dayAt(d, 7 + r() * 14)));
      if (r() < 0.25) {
        const onset = dayAt(d, 9 + r() * 9);
        symptoms.push(sym('Headache', onset));
        if (r() < 0.6) {
          factors.push(fac('Lie down', onset + (30 + r() * 30) * MIN, 'activity'));
          symptoms.push(sym('Headache', onset + (relogFrom + r() * (relogTo - relogFrom)) * HOUR));
        }
      } else if (r() < 0.1) {
        factors.push(fac('Lie down', dayAt(d, 13 + r() * 5), 'activity'));
      }
    }
    return findTriggers(symptoms, factors, { now: NOW });
  }

  it('does not credit something done because of a symptom when the symptom is logged again', () => {
    let soon = 0;
    let later = 0;
    for (let seed = 1; seed <= 30; seed++) {
      if (lieDown(seed, 2, 3).findings.some(f => f.factor === 'Lie down')) soon++;
      if (lieDown(seed + 100, 4, 6).findings.some(f => f.factor === 'Lie down')) later++;
    }
    expect(soon).toBe(0);
    expect(later).toBeLessThanOrEqual(1);
  });
});

describe('several logs of a symptom on one day', () => {
  type Mode = 'relog' | 'packed' | 'separate';
  // Random, unrelated data. Symptom days get 2 or 3 logs, as re-logs 2.5 to 7 hours apart, the same
  // total logs packed onto fewer days, or separate episodes 6.5 to 8 hours apart.
  function nullData(seed: number, mode: Mode) {
    const r = mulberry32(seed);
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 45; d >= 1; d--) {
      for (const name of ['Dairy', 'Gluten', 'Alcohol', 'Poor sleep']) {
        if (r() < 0.35) factors.push(fac(name, dayAt(d, 7 + r() * 14)));
      }
      for (const name of ['Headache', 'Bloating']) {
        if (r() >= (mode === 'relog' ? 0.3 : 0.12)) continue;
        const n = r() < 0.5 ? 2 : 3;
        let t = dayAt(d, mode === 'separate' ? 5 + r() * 3 : 6 + r() * 10);
        for (let i = 0; i < n && t < nowMs && t < dayAt(d, 23.5); i++) {
          symptoms.push(sym(name, t));
          t += (mode === 'separate' ? 6.5 + r() * 1.5 : 2.5 + r() * 4.5) * HOUR;
        }
      }
    }
    return findTriggers(symptoms, factors, { now: NOW });
  }

  const rates = (mode: Mode, runs: number) => {
    let any = 0;
    let strong = 0;
    for (let k = 0; k < runs; k++) {
      const res: TriggerAnalysis = nullData(1000 + k * 7919, mode);
      if (res.findings.length) any++;
      if (res.findings.some(f => f.strength === 'strong')) strong++;
    }
    return { any: any / runs, strong };
  };

  it.each<Mode>(['relog', 'packed', 'separate'])('stays calibrated on random data (%s)', mode => {
    const { any, strong } = rates(mode, 200);
    expect(strong).toBe(0);
    expect(any).toBeLessThanOrEqual(0.05);
  });

  it('still finds a short delay trigger when the symptom also happens earlier the same day', () => {
    // Spicy dinner, heartburn 30 minutes to 2 hours later, plus unrelated morning heartburn on half the days.
    let found = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = mulberry32(seed);
      const symptoms: Symptom[] = [];
      const factors: Factor[] = [];
      for (let d = 45; d >= 1; d--) {
        for (const n of ['Dairy', 'Coffee', 'Alcohol']) if (r() < 0.35) factors.push(fac(n, dayAt(d, 7 + r() * 14)));
        if (r() < 0.5) symptoms.push(sym('Heartburn', dayAt(d, 8 + r() * 3)));
        if (r() < 0.35) {
          const t = dayAt(d, 18 + r() * 2);
          factors.push(fac('Spicy food', t));
          if (r() < 0.7) symptoms.push(sym('Heartburn', t + (0.5 + r() * 1.5) * HOUR));
        }
      }
      const hit = findTriggers(symptoms, factors, { now: NOW }).findings.find(
        f => f.factor === 'Spicy food' && f.symptom === 'Heartburn',
      );
      if (hit?.window.from === 0) found++;
    }
    expect(found).toBeGreaterThanOrEqual(38);
  });

  it('still finds a delayed trigger whose symptom is logged again later', () => {
    let found = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = mulberry32(seed);
      const symptoms: Symptom[] = [];
      const factors: Factor[] = [];
      for (let d = 40; d >= 1; d--) {
        factors.push(fac('Coffee', dayAt(d, 8), 'drink'));
        if (d % 3 === 0) {
          factors.push(fac('Dairy', dayAt(d, 12)));
          if (r() < 0.85) {
            const t = dayAt(d, 12) + 15 * HOUR;
            symptoms.push(sym('Headache', t), sym('Headache', t + 3 * HOUR));
          }
        }
        if (r() < 0.12) symptoms.push(sym('Headache', dayAt(d, 9 + Math.floor(r() * 10))));
      }
      const top = findTriggers(symptoms, factors, { now: NOW }).findings[0];
      if (top?.factor === 'Dairy' && top.window.from === 12) found++;
    }
    expect(found).toBeGreaterThanOrEqual(38);
  });
});
