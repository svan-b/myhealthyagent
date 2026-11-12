import { findTriggers, describeFinding } from '@/lib/analysis/triggers';
import { benjaminiHochberg, binomialUpperTail, poissonBinomialUpperTail } from '@/lib/analysis/stats';
import type { Factor, Symptom } from '@/lib/db/schema';

const HOUR = 3_600_000;
const NOW = new Date(2026, 5, 30, 20, 0);

let seq = 0;
const sym = (name: string, t: number, severity = 6): Symptom => ({
  id: `s${seq++}`,
  name,
  severity,
  timestamp: new Date(t).toISOString(),
});
const fac = (name: string, t: number, category: Factor['category'] = 'food'): Factor => ({
  id: `f${seq++}`,
  name,
  category,
  timestamp: new Date(t).toISOString(),
});

// Deterministic PRNG so tests are stable
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const dayAt = (daysAgo: number, hour: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, hour).getTime();

describe('stats', () => {
  it('binomial upper tail matches known values', () => {
    expect(binomialUpperTail(0, 10, 0.5)).toBe(1);
    expect(binomialUpperTail(10, 10, 0.5)).toBeCloseTo(1 / 1024, 6);
    expect(binomialUpperTail(8, 10, 0.5)).toBeCloseTo(56 / 1024, 6);
    expect(binomialUpperTail(11, 10, 0.5)).toBe(0);
  });

  it('Poisson binomial tail matches the binomial when probabilities are equal', () => {
    for (const [k, n, p] of [
      [3, 10, 0.2],
      [7, 12, 0.5],
      [1, 5, 0.9],
      [0, 4, 0.3],
      [6, 5, 0.5],
    ]) {
      expect(poissonBinomialUpperTail(Array(n).fill(p), k)).toBeCloseTo(binomialUpperTail(k, n, p), 10);
    }
    // Certain and impossible trials
    expect(poissonBinomialUpperTail([1, 1, 0], 2)).toBeCloseTo(1);
    expect(poissonBinomialUpperTail([1, 0, 0], 2)).toBeCloseTo(0);
    expect(poissonBinomialUpperTail([0.5, 0.5], 2)).toBeCloseTo(0.25);
  });

  it('BH adjustment is monotone and capped at 1', () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.5]);
    expect(q[0]).toBeCloseTo(0.04);
    expect(q[2]).toBeCloseTo(0.053, 2);
    expect(q[1]).toBeCloseTo(0.053, 2);
    expect(q[3]).toBe(0.5);
  });
});

describe('findTriggers', () => {
  it('finds a delayed trigger and its delay window', () => {
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    const r = rng(7);
    for (let d = 40; d >= 1; d--) {
      factors.push(fac('Coffee', dayAt(d, 8), 'drink')); // daily, should not be flagged
      if (d % 3 === 0) {
        factors.push(fac('Dairy', dayAt(d, 12)));
        // headache about 15 hours later, most of the time
        if (r() < 0.85) symptoms.push(sym('Headache', dayAt(d, 12) + 15 * HOUR));
      }
      if (r() < 0.12) symptoms.push(sym('Headache', dayAt(d, 9 + Math.floor(r() * 10))));
    }
    const res = findTriggers(symptoms, factors, { now: NOW });
    expect(res.findings.length).toBeGreaterThan(0);
    const top = res.findings[0];
    expect(top.factor).toBe('Dairy');
    expect(top.symptom).toBe('Headache');
    expect(top.window.from).toBe(12);
    expect(top.exposuresFollowed).toBeGreaterThanOrEqual(8);
    expect(top.relativeRate).toBeGreaterThan(2);
    expect(top.baselineChance).toBeLessThan(0.3);
    expect(top.comparisonWindows).toBeGreaterThan(10);
    expect(res.findings.some(f => f.factor === 'Coffee')).toBe(false);
    expect(describeFinding(top)).toMatch(/Headache followed dairy 12 to 24 hours later \d+ of \d+ times/);
  });

  it('rarely reports anything for random, unrelated data', () => {
    let falsePositives = 0;
    const runs = 40;
    for (let seed = 1; seed <= runs; seed++) {
      const r = rng(seed * 97);
      const symptoms: Symptom[] = [];
      const factors: Factor[] = [];
      for (let d = 45; d >= 1; d--) {
        for (const name of ['Dairy', 'Gluten', 'Alcohol', 'Poor sleep']) {
          if (r() < 0.35) factors.push(fac(name, dayAt(d, 7 + Math.floor(r() * 14))));
        }
        for (const name of ['Headache', 'Bloating']) {
          if (r() < 0.3) symptoms.push(sym(name, dayAt(d, 6 + Math.floor(r() * 16))));
        }
      }
      if (findTriggers(symptoms, factors, { now: NOW }).findings.length) falsePositives++;
    }
    // With FDR control we expect very few runs to report anything.
    expect(falsePositives / runs).toBeLessThanOrEqual(0.15);
  });

  it('does not mistake time of day for a trigger', () => {
    // Coffee every morning and a medication every morning; headaches and fatigue happen in the
    // afternoon and evening for unrelated reasons. "After coffee" is just "daytime" here.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    const r = rng(11);
    for (let d = 40; d >= 1; d--) {
      factors.push(fac('Coffee', dayAt(d, 8), 'drink'));
      factors.push(fac('Levothyroxine', dayAt(d, 7), 'medication'));
      if (r() < 0.4) symptoms.push(sym('Headache', dayAt(d, 16 + Math.floor(r() * 5))));
      if (r() < 0.3) symptoms.push(sym('Fatigue', dayAt(d, 14)));
      if (r() < 0.3) factors.push(fac('Dairy', dayAt(d, 12)));
    }
    const res = findTriggers(symptoms, factors, { now: NOW });
    expect(res.findings).toEqual([]);
  });

  it('ignores symptoms logged at the same moment as the factor', () => {
    // People often log "stress" right when they log a headache. Order is unknown, so it is not evidence.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    const r = rng(5);
    for (let d = 40; d >= 1; d--) {
      if (r() < 0.4) {
        const t = dayAt(d, 9 + Math.floor(r() * 10));
        factors.push(fac('Stress', t, 'stress'));
        symptoms.push(sym('Headache', t + 2 * 60_000));
      } else if (r() < 0.3) {
        symptoms.push(sym('Headache', dayAt(d, 9 + Math.floor(r() * 10))));
      }
    }
    expect(findTriggers(symptoms, factors, { now: NOW }).findings).toEqual([]);
  });

  it('returns nothing with too little data', () => {
    const res = findTriggers([sym('Headache', dayAt(1, 10))], [fac('Dairy', dayAt(1, 8))], { now: NOW });
    expect(res.findings).toEqual([]);
  });

  it('ignores days with no logs at all', () => {
    // 10 tracked days with a clear link, then a 30 day gap. The gap must not count as symptom free time.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 50; d > 40; d--) {
      factors.push(fac('Wine', dayAt(d, 20), 'drink'));
      symptoms.push(sym('Migraine', dayAt(d, 20) + 2 * HOUR));
      symptoms.push(sym('Migraine', dayAt(d, 9)));
    }
    const res = findTriggers(symptoms, factors, { now: NOW });
    expect(res.trackedDays).toBe(10);
  });
});
