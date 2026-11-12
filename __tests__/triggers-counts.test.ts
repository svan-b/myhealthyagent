// "Followed X of N times", the usual chance next to it, doses, and what the analysis says it checked.
import { findTriggers } from '@/lib/analysis/triggers';
import type { Factor, Symptom } from '@/lib/db/schema';

const MIN = 60_000;
const HOUR = 60 * MIN;
const BIN = 15 * MIN;
const NOW = new Date(2026, 5, 30, 20, 0);
const nowMs = NOW.getTime();

let seq = 0;
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

/** Local time `hour` (fractions allowed) on the day `daysAgo` days before NOW. */
const dayAt = (daysAgo: number, hour: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo).getTime() + hour * HOUR;
const localDay = (t: number) => new Date(t).toDateString();

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const times = (rows: { timestamp: string }[]) => rows.map(r => Date.parse(r.timestamp));

describe('followed X of N times', () => {
  it('counts only exposures whose whole window fell on tracked days', () => {
    // Logs on weekdays only. Red wine on some weekday evenings, migraine 28 to 34 hours later most times.
    const r = mulberry32(3);
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    const wine: number[] = [];
    for (let d = 60; d >= 1; d--) {
      const weekday = ![0, 6].includes(new Date(dayAt(d, 12)).getDay());
      if (!weekday) continue;
      for (const n of ['Dairy', 'Gluten']) if (r() < 0.35) factors.push(fac(n, dayAt(d, 7 + r() * 12)));
      if (r() < 0.08) symptoms.push(sym('Migraine', dayAt(d, 8 + r() * 12)));
      if (r() < 0.4) {
        const t = dayAt(d, 19 + r() * 2);
        wine.push(t);
        factors.push(fac('Red wine', t, 'drink'));
        const m = t + (28 + r() * 6) * HOUR;
        const day = new Date(m).getDay();
        if (r() < 0.8 && day >= 1 && day <= 5 && m < nowMs) symptoms.push(sym('Migraine', m));
      }
    }
    const res = findTriggers(symptoms, factors, { now: NOW });
    const f = res.findings.find(x => x.factor === 'Red wine' && x.symptom === 'Migraine');
    expect(f).toBeDefined();
    expect(f!.window.from).toBe(24);
    // Weekends were not tracked. A window that ran into a weekend says nothing about whether a
    // migraine followed, so it must not count as "not followed".
    const logged = new Set([...times(symptoms), ...times(factors)].map(localDay));
    const tracked = wine.filter(t => {
      const from = Math.ceil((t + 24 * HOUR) / BIN) * BIN;
      const to = Math.ceil((t + 48 * HOUR) / BIN) * BIN;
      if (to > nowMs) return false;
      for (let x = from; x < to; x += BIN) if (!logged.has(localDay(x))) return false;
      return true;
    });
    expect(f!.exposures).toBe(tracked.length);
    expect(f!.exposures).toBeLessThan(wine.length);
    expect(f!.exposuresFollowed / f!.exposures).toBeGreaterThanOrEqual(0.7);
  });
});

describe('usual chance', () => {
  // The usual chance of a factor within 3 hours, worked out the slow way. For each exposure, the same
  // 3 hours on each day up to 28 days either side that has logs and no exposure, averaged over exposures.
  // Symptom starts are counted as the analysis counts them. Logs within 6 hours of the previous log
  // are one episode, and starts within 15 minutes of the factor are left out.
  function exposureMatched(exposures: number[], symptomTimes: number[], allTimes: number[]) {
    const logged = new Set(allTimes.map(localDay));
    const first = Math.floor(Math.min(...allTimes) / BIN) * BIN;
    const len = 3 * HOUR;
    const exposedAt = (x: number) =>
      exposures.some(e => x >= Math.ceil(e / BIN) * BIN && x < Math.ceil((e + len) / BIN) * BIN);
    const starts: number[] = [];
    let last = -Infinity;
    for (const t of [...symptomTimes].sort((a, b) => a - b)) {
      if (t - last > 6 * HOUR && !exposures.some(e => Math.abs(e - t) <= 15 * MIN)) starts.push(t);
      last = t;
    }
    let sum = 0;
    let n = 0;
    for (const e of exposures) {
      const a = Math.ceil(e / BIN) * BIN;
      if (e + len > nowMs) continue;
      let windows = 0;
      let hits = 0;
      for (let k = -28; k <= 28; k++) {
        const s = a + k * 96 * BIN;
        if (k === 0 || s < first || s + len > Math.floor(nowMs / BIN) * BIN + BIN) continue;
        let ok = true;
        for (let x = s; x < s + len && ok; x += BIN) ok = logged.has(localDay(x)) && !exposedAt(x);
        if (!ok) continue;
        windows++;
        if (starts.some(t => t >= s && t < s + len)) hits++;
      }
      if (windows) {
        sum += hits / windows;
        n++;
      }
    }
    return sum / n;
  }

  function mealData(seed: number, morning: boolean) {
    const r = mulberry32(seed);
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    const item: number[] = [];
    for (let d = 90; d >= 1; d--) {
      factors.push(fac('Water', dayAt(d, 6 + r() * 16), 'drink'));
      let main = false;
      if (r() < 0.6) {
        // The usual time, which is lunch, or morning coffee in the second case.
        const t = dayAt(d, morning ? 7 + r() * 2 : 12 + r());
        item.push(t);
        main = true;
        if (r() < (morning ? 0.5 : 0.75)) symptoms.push(sym('Headache', t + (0.5 + r() * 2) * HOUR));
      }
      if (r() < 0.1) item.push(dayAt(d, morning ? 15 + r() * 2 : 19 + r()));
      // Unrelated afternoon headaches, on days without the usual exposure, or often in the second case.
      if (morning ? r() < 0.4 : !main && r() < 0.3)
        symptoms.push(sym('Headache', dayAt(d, morning ? 15 + r() * 3 : 12 + r() * 6)));
    }
    const name = morning ? 'Coffee' : 'Dairy';
    for (const t of item) factors.push(fac(name, t, morning ? 'drink' : 'food'));
    return { symptoms, factors, item, name };
  }

  it.each([
    ['mostly at lunch, sometimes at dinner', false],
    ['mostly in the morning, sometimes in the afternoon', true],
  ])('matches when the factor was actually logged (%s)', (_label, morning) => {
    const { symptoms, factors, item, name } = mealData(11, morning);
    const res = findTriggers(symptoms, factors, { now: NOW });
    const f = res.findings.find(x => x.factor === name && x.symptom === 'Headache');
    expect(f).toBeDefined();
    expect(f!.window.from).toBe(0);
    const expected = exposureMatched(item, times(symptoms), [...times(symptoms), ...times(factors)]);
    expect(f!.baselineChance).toBeCloseTo(expected, 6);
  });
});

describe('doses ticked on the Meds tab', () => {
  it('never makes a day with only a dose count as tracked', () => {
    // A pill ticked every morning. The Log tab is used on about half the days, with coffee and any
    // headache that day. Headaches have nothing to do with coffee.
    let flagged = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = mulberry32(seed);
      const symptoms: Symptom[] = [];
      const factors: Factor[] = [];
      const doses: Factor[] = [];
      const logDays = new Set<string>();
      for (let d = 60; d >= 1; d--) {
        doses.push(fac('Sertraline', dayAt(d, 7.5 + r() * 2), 'medication'));
        const headache = r() < 0.5;
        if (r() >= 0.5) continue;
        logDays.add(localDay(dayAt(d, 12)));
        factors.push(fac('Coffee', dayAt(d, 7 + r() * 3), 'drink'));
        if (headache) symptoms.push(sym('Headache', dayAt(d, 8 + r() * 13)));
      }
      const res = findTriggers(symptoms, factors, { now: NOW, exposureOnly: doses });
      expect(res.trackedDays).toBe(logDays.size);
      expect([...res.factorsTested, ...res.factorsSkipped.map(f => f.name)]).toContain('Sertraline');
      if (res.findings.length) flagged++;
    }
    expect(flagged).toBeLessThanOrEqual(1);
  });

  it('still finds a side effect of doses taken on tracked days', () => {
    let found = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = mulberry32(seed + 50);
      const symptoms: Symptom[] = [];
      const factors: Factor[] = [];
      const doses: Factor[] = [];
      for (let d = 60; d >= 1; d--) {
        if (r() < 0.7) {
          for (const n of ['Dairy', 'Coffee']) if (r() < 0.4) factors.push(fac(n, dayAt(d, 7 + r() * 12)));
          if (r() < 0.1) symptoms.push(sym('Nausea', dayAt(d, 8 + r() * 12)));
        }
        if (r() < 0.25) {
          const t = dayAt(d, 9 + r() * 10);
          doses.push(fac('Ibuprofen', t, 'medication'));
          if (r() < 0.7) symptoms.push(sym('Nausea', t + (1 + r()) * HOUR));
        }
      }
      const res = findTriggers(symptoms, factors, { now: NOW, exposureOnly: doses });
      if (res.findings.some(f => f.factor === 'Ibuprofen' && f.symptom === 'Nausea' && f.category === 'medication'))
        found++;
    }
    expect(found).toBeGreaterThanOrEqual(18);
  });
});

describe('what was checked', () => {
  it('says nothing was tested when the only items are daily or rare', () => {
    // Caffeine at 08:00 every day, dairy on two days, a headache every other afternoon.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 30; d >= 1; d--) {
      factors.push(fac('Caffeine', dayAt(d, 8), 'drink'));
      if (d % 2 === 0) symptoms.push(sym('Headache', dayAt(d, 15)));
    }
    factors.push(fac('Dairy', dayAt(20, 12)), fac('Dairy', dayAt(9, 12)));
    const res = findTriggers(symptoms, factors, { now: NOW });
    expect(res.trackedDays).toBe(30);
    expect(res.testsRun).toBe(0);
    expect(res.factorsTested).toEqual([]);
    expect(res.factorsSkipped).toEqual([
      { name: 'Caffeine', category: 'drink', reason: 'same-time', logs: 30 },
      { name: 'Dairy', category: 'food', reason: 'few', logs: 2 },
    ]);
    expect(res.symptomsTested).toEqual([]);
    expect(res.symptomsSkipped).toEqual([{ name: 'Headache', reason: 'no-factor', episodes: 15 }]);
  });

  it('calls an item logged every day at varying times daily', () => {
    const r = mulberry32(5);
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 30; d >= 1; d--) {
      factors.push(fac('Coffee', dayAt(d, 7.25 + r() * 1.5), 'drink'));
      if (r() < 0.5) symptoms.push(sym('Headache', dayAt(d, 9 + r() * 10)));
    }
    const res = findTriggers(symptoms, factors, { now: NOW });
    expect(res.testsRun).toBe(0);
    expect(res.factorsSkipped).toEqual([{ name: 'Coffee', category: 'drink', reason: 'daily', logs: 30 }]);
  });

  it('lists tested and untested items and symptoms', () => {
    const r = mulberry32(9);
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 40; d >= 1; d--) {
      factors.push(fac('Coffee', dayAt(d, 8), 'drink'));
      if (r() < 0.35) factors.push(fac('Dairy', dayAt(d, 7 + r() * 14)));
      if (r() < 0.3) symptoms.push(sym('Headache', dayAt(d, 6 + r() * 16)));
    }
    // Logged twice with two spellings. That is one item, with too few logs to check.
    factors.push(fac('Pizza', dayAt(12, 19)), fac('pizza ', dayAt(5, 19)));
    symptoms.push(sym('Migraine', dayAt(10, 9)), sym('Migraine', dayAt(4, 9)));
    const res = findTriggers(symptoms, factors, { now: NOW });
    expect(res.testsRun).toBeGreaterThan(0);
    expect(res.factorsTested).toEqual(['Dairy']);
    expect(res.factorsSkipped).toEqual([
      { name: 'Coffee', category: 'drink', reason: 'same-time', logs: 40 },
      { name: 'Pizza', category: 'food', reason: 'few', logs: 2 },
    ]);
    expect(res.symptomsTested).toEqual(['Headache']);
    expect(res.symptomsSkipped).toEqual([{ name: 'Migraine', reason: 'few', episodes: 2 }]);
  });

  it('says when an item was only ever logged together with the symptom', () => {
    // Stress is logged at the same moment as every bloating episode, so which came first is unknown.
    // A different dinner each night keeps the other days tracked.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 30; d >= 1; d--) factors.push(fac(`Dinner ${d}`, dayAt(d, 19)));
    for (const d of [28, 22, 15, 8, 3]) {
      factors.push(fac('Stress', dayAt(d, 13), 'stress'));
      symptoms.push(sym('Bloating', dayAt(d, 13) + 5 * MIN));
    }
    const res = findTriggers(symptoms, factors, { now: NOW });
    expect(res.testsRun).toBe(0);
    expect(res.factorsSkipped[0]).toEqual({ name: 'Stress', category: 'stress', reason: 'no-symptom', logs: 5 });
    expect(res.factorsSkipped.filter(f => f.reason === 'few')).toHaveLength(30);
    expect(res.symptomsSkipped).toEqual([{ name: 'Bloating', reason: 'no-factor', episodes: 5 }]);
  });

  it('marks every item as untested when there are no symptoms', () => {
    const factors = [fac('Dairy', dayAt(5, 12)), fac('Dairy', dayAt(3, 12)), fac('Dairy', dayAt(1, 12))];
    const res = findTriggers([], factors, { now: NOW });
    expect(res.testsRun).toBe(0);
    expect(res.factorsSkipped).toEqual([{ name: 'Dairy', category: 'food', reason: 'no-symptom', logs: 3 }]);
    expect(res.symptomsTested).toEqual([]);
    expect(res.symptomsSkipped).toEqual([]);
  });
});
