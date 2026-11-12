/** @jest-environment node */
// Seeded simulations. When nothing really differs, each kind of pattern should appear in 5% of
// datasets or fewer, and real, sizable differences should still show.
import { getPatterns, type PatternInsight } from '@/lib/analysis/patterns';
import type { Factor, Symptom } from '@/lib/db/schema';

jest.setTimeout(60_000);

const HOUR = 3_600_000;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;

interface Ctx {
  daysAgo: number;
  dow: number;
  /** In the last 14 days. */
  recent: boolean;
  /** Symptoms already placed on this day. */
  today: Set<string>;
}
interface Spec {
  name: string;
  present: (r: Rng, c: Ctx) => boolean;
  entries?: (r: Rng) => number;
  severity?: (r: Rng, c: Ctx) => number;
  hour?: (r: Rng) => number;
}

const LEVELS = [2, 5, 7, 9];
const anyLevel = (r: Rng) => LEVELS[Math.floor(r() * 4)];
const fromMix = (weights: number[]) => (r: Rng) => {
  let x = r() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < LEVELS.length; i++) if ((x -= weights[i]) < 0) return LEVELS[i];
  return LEVELS[LEVELS.length - 1];
};
const MILD = fromMix([0.6, 0.3, 0.1, 0]);
const SEVERE = fromMix([0, 0.1, 0.4, 0.5]);
const chance = (p: number) => (r: Rng) => r() < p;
/** Waking hours, 7:00 to 23:00. */
const waking = (r: Rng) => 7 + 16 * r();

/** A diary of `days` days ending on `end`, with coffee logged every morning. */
function diary(seed: number, days: number, specs: Spec[], end = new Date(2026, 5, 30)) {
  const r = mulberry32(seed * 7919 + 13);
  const symptoms: Symptom[] = [];
  const factors: Factor[] = [];
  let id = 0;
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    const d0 = new Date(end.getFullYear(), end.getMonth(), end.getDate() - daysAgo);
    const at = (h: number) => new Date(d0.getTime() + h * HOUR).toISOString();
    factors.push({ id: `f${id++}`, name: 'Coffee', category: 'drink', timestamp: at(8) });
    const c: Ctx = { daysAgo, dow: d0.getDay(), recent: daysAgo < 14, today: new Set() };
    for (const s of specs) {
      if (!s.present(r, c)) continue;
      c.today.add(s.name);
      const n = s.entries ? s.entries(r) : 1;
      for (let k = 0; k < n; k++) {
        const severity = s.severity ? s.severity(r, c) : anyLevel(r);
        symptoms.push({ id: `s${id++}`, name: s.name, severity, timestamp: at((s.hour ?? waking)(r)) });
      }
    }
  }
  // Newest first, the order the database returns.
  symptoms.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const now = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59);
  return { symptoms, factors, now };
}

/** Share of seeded datasets for which `hit` is true. */
function share(runs: number, make: (seed: number) => ReturnType<typeof diary>, hit: (p: PatternInsight[]) => boolean) {
  let n = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const { symptoms, factors, now } = make(seed);
    if (hit(getPatterns(symptoms, factors, now))) n++;
  }
  return n / runs;
}
const has = (kind: PatternInsight['kind']) => (p: PatternInsight[]) => p.some(x => x.kind === kind);

describe('pattern calibration', () => {
  it('trends rarely appear when nothing changes, even with several entries a day', () => {
    // One symptom on 40-60% of 28 tracked days, ratings drawn from 2, 5, 7 and 9 throughout
    const make = (entries?: (r: Rng) => number) => (seed: number) => {
      const p = 0.4 + 0.2 * mulberry32(seed)();
      return diary(seed, 28, [{ name: 'Headache', present: chance(p), entries }]);
    };
    const oneToThree = (r: Rng) => 1 + Math.floor(3 * r());
    // About 2% and 3%, against 64% and 66% with the old rules
    expect(share(1000, make(), has('trend'))).toBeLessThanOrEqual(0.05);
    expect(share(1000, make(oneToThree), has('trend'))).toBeLessThanOrEqual(0.05);
  });

  it('trends still show real changes', () => {
    const more = share(
      300,
      seed => diary(seed, 28, [{ name: 'Headache', present: (r, c) => r() < (c.recent ? 0.7 : 0.3) }]),
      p => p.some(x => x.id === 'trend-frequency' && x.title.startsWith('More')),
    );
    const fewer = share(
      300,
      seed => diary(seed, 28, [{ name: 'Headache', present: (r, c) => r() < (c.recent ? 0.15 : 0.7) }]),
      p => p.some(x => x.id === 'trend-frequency' && x.title.startsWith('Fewer')),
    );
    const worse = share(
      300,
      seed =>
        diary(seed, 28, [
          { name: 'Headache', present: chance(0.5), severity: (r, c) => (c.recent ? SEVERE(r) : MILD(r)) },
        ]),
      p => p.some(x => x.id === 'trend-severity' && x.title.endsWith('more severe lately')),
    );
    // About 38%, 73% and 77%. Comparing two weeks with two weeks cannot do much better honestly.
    expect(more).toBeGreaterThanOrEqual(0.3);
    expect(fewer).toBeGreaterThanOrEqual(0.6);
    expect(worse).toBeGreaterThanOrEqual(0.65);
  });

  it('a weekday or weekend pattern rarely appears when there is none', () => {
    // About 1.5%, 3% and 4%, against 45%, 25% and 9% with the old rule
    for (const days of [14, 28, 56]) {
      // Starting on Monday Nov 2, 2026, symptoms on 35% of days
      const end = new Date(2026, 10, 1 + days);
      expect(
        share(600, seed => diary(seed, days, [{ name: 'Headache', present: chance(0.35) }], end), has('weekday')),
      ).toBeLessThanOrEqual(0.05);
    }
  });

  it('a real weekend effect still shows after six weeks', () => {
    const end = new Date(2026, 10, 1 + 42);
    const found = share(
      300,
      seed =>
        diary(seed, 42, [{ name: 'Headache', present: (r, c) => r() < (c.dow === 0 || c.dow === 6 ? 0.7 : 0.3) }], end),
      p => p.some(x => x.kind === 'weekday' && x.title.endsWith('weekends')),
    );
    expect(found).toBeGreaterThanOrEqual(0.5); // about 62%
  });

  it('a near daily symptom is not paired with independent ones', () => {
    // About 1.5% each, against 76% and 98% with the old rule
    const daily = share(
      500,
      seed =>
        diary(seed, 60, [
          { name: 'Fatigue', present: chance(0.7) },
          { name: 'Headache', present: chance(0.15) },
        ]),
      has('together'),
    );
    const many = share(
      500,
      seed =>
        diary(
          seed,
          60,
          [0.5, 0.33, 0.6, 0.15, 0.4, 0.2].map((p, i) => ({ name: `Symptom ${i}`, present: chance(p) })),
        ),
      has('together'),
    );
    expect(daily).toBeLessThanOrEqual(0.05);
    expect(many).toBeLessThanOrEqual(0.05);
  });

  it('a real pair still shows next to a near daily symptom', () => {
    const isPair = (x: PatternInsight) =>
      x.kind === 'together' && /nausea/i.test(x.title) && /dizziness/i.test(x.title);
    let found = 0;
    let wrong = 0;
    const runs = 200;
    for (let seed = 1; seed <= runs; seed++) {
      const { symptoms, factors, now } = diary(seed, 60, [
        { name: 'Fatigue', present: chance(0.8) },
        { name: 'Headache', present: chance(0.15) },
        { name: 'Bloating', present: chance(0.15) },
        { name: 'Back pain', present: chance(0.15) },
        { name: 'Nausea', present: chance(0.2) },
        { name: 'Dizziness', present: (r, c) => r() < (c.today.has('Nausea') ? 0.8 : 0.03) },
      ]);
      const together = getPatterns(symptoms, factors, now).filter(x => x.kind === 'together');
      if (together.some(isPair)) found++;
      if (together.some(x => !isPair(x))) wrong++;
    }
    expect(found / runs).toBeGreaterThanOrEqual(0.9); // about 99%, and 19% with the old rule
    expect(wrong / runs).toBeLessThanOrEqual(0.05);
  });

  it('a usual time of day rarely appears when starts are spread over the day', () => {
    // About 1% to 2%, against 64%, 42% and 17% with the old rule
    for (const n of [8, 12, 20]) {
      const made = share(
        600,
        seed => {
          const r = mulberry32(seed);
          const symptoms = Array.from({ length: n }, (_, k) => ({
            id: `s${k}`,
            name: 'Headache',
            severity: 5,
            timestamp: new Date(new Date(2026, 5, 29 - 2 * k).getTime() + waking(r) * HOUR).toISOString(),
          }));
          return { symptoms, factors: [], now: new Date(2026, 5, 30, 23) };
        },
        has('time-of-day'),
      );
      expect(made).toBeLessThanOrEqual(0.05);
    }
    // A full diary with several symptoms, some logged more than once a day
    const diaryRate = share(
      200,
      seed =>
        diary(seed, 60, [
          { name: 'Fatigue', present: chance(0.7) },
          { name: 'Headache', present: chance(0.15), entries: r => (r() < 0.3 ? 2 : 1) },
          { name: 'Bloating', present: chance(0.4), entries: r => 1 + Math.floor(3 * r()) },
          { name: 'Nausea', present: chance(0.2) },
        ]),
      has('time-of-day'),
    );
    expect(diaryRate).toBeLessThanOrEqual(0.05);
  });

  it('a real time of day still shows', () => {
    const evening = (n: number, p: number) =>
      share(
        300,
        seed => {
          const r = mulberry32(seed);
          const symptoms = Array.from({ length: n }, (_, k) => {
            // Evening with chance p, otherwise another waking hour (7-17 or 22-23)
            const x = 11 * r();
            const h = r() < p ? 17 + 5 * r() : x < 10 ? 7 + x : 22 + (x - 10);
            const day = new Date(2026, 5, 29 - 2 * k);
            return {
              id: `s${k}`,
              name: 'Headache',
              severity: 5,
              timestamp: new Date(day.getTime() + h * HOUR).toISOString(),
            };
          });
          return { symptoms, factors: [], now: new Date(2026, 5, 30, 23) };
        },
        p => p.some(x => x.kind === 'time-of-day' && x.title.endsWith('evening')),
      );
    expect(evening(12, 0.8)).toBeGreaterThanOrEqual(0.7); // about 81%
    expect(evening(20, 0.7)).toBeGreaterThanOrEqual(0.8); // about 88%
  });
});
