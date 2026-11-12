/** @jest-environment node */
// Regression tests for the pattern cards: each one needs evidence that would rarely come from chance.
import { getPatterns, type PatternInsight } from '@/lib/analysis/patterns';
import type { Factor, Symptom } from '@/lib/db/schema';

let seq = 0;
const sym = (name: string, at: Date, severity = 5): Symptom => ({
  id: `s${seq++}`,
  name,
  severity,
  timestamp: at.toISOString(),
});
const fac = (name: string, at: Date): Factor => ({
  id: `f${seq++}`,
  name,
  category: 'drink',
  timestamp: at.toISOString(),
});
const of = (p: PatternInsight[], kind: PatternInsight['kind']) => p.filter(x => x.kind === kind);

describe('weekday pattern', () => {
  // Mon Nov 2 to Sun Nov 15, 2026, coffee every morning
  const twoWeeks = Array.from({ length: 14 }, (_, i) => fac('Coffee', new Date(2026, 10, 2 + i, 8)));
  const now = new Date(2026, 10, 15, 21);

  it('does not claim a weekend pattern from 3 of 4 weekend days against 4 of 10 weekdays', () => {
    const headaches = [7, 8, 14, 2, 4, 10, 12].map(d => sym('Headache', new Date(2026, 10, d, 15)));
    expect(of(getPatterns(headaches, twoWeeks, now), 'weekday')).toEqual([]);
  });

  it('still reports an extreme difference within two weeks, with the counts', () => {
    const headaches = [7, 8, 14, 15, 4].map(d => sym('Headache', new Date(2026, 10, d, 15)));
    expect(of(getPatterns(headaches, twoWeeks, now), 'weekday')).toEqual([
      {
        id: 'weekday',
        kind: 'weekday',
        title: 'Symptoms show up more on weekends',
        detail:
          'In the last 60 days you logged symptoms on 1 of 10 tracked weekdays (10%) and 4 of 4 tracked weekend days (100%).',
      },
    ]);
  });

  it('reports a large weekend effect over six weeks', () => {
    // Mon Oct 5 to Sun Nov 15, 2026. Headache on 11 of the 12 weekend days and 4 of the 30 weekdays.
    const days = Array.from({ length: 42 }, (_, i) => new Date(2026, 9, 5 + i, 15));
    const coffee = days.map(d => fac('Coffee', new Date(d.getTime() - 7 * 3_600_000)));
    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const headacheDays = [
      ...days.filter(isWeekend).slice(1),
      ...days.filter(d => !isWeekend(d)).filter((_, i) => i % 8 === 1),
    ];
    const headaches = headacheDays.map(d => sym('Headache', d));
    const [w] = of(getPatterns(headaches, coffee, now), 'weekday');
    expect(w.title).toBe('Symptoms show up more on weekends');
    expect(w.detail).toBe(
      'In the last 60 days you logged symptoms on 4 of 30 tracked weekdays (13%) and 11 of 12 tracked weekend days (92%).',
    );
  });
});

describe('symptoms that show up together', () => {
  // 60 tracked days ending Tue Jun 30, 2026. Day 0 is May 2.
  const now = new Date(2026, 5, 30, 21);
  const day = (i: number, hour = 14) => new Date(2026, 4, 2 + i, hour);
  const coffee = Array.from({ length: 60 }, (_, i) => fac('Coffee', day(i, 8)));
  const on = (name: string, days: number[], hour = 14) => days.map(i => sym(name, day(i, hour)));

  it('does not pair a near daily symptom with a less frequent one by chance', () => {
    // Fatigue on 50 of 60 days. Headache on 10 days, 7 of them fatigue days, which is fewer than the
    // 8.3 that chance alone would give.
    const fatigueDays = Array.from({ length: 50 }, (_, i) => i);
    const fatigue = on('Fatigue', fatigueDays);
    const headache = on('Headache', [0, 1, 2, 3, 4, 5, 6, 50, 51, 52], 16);
    expect(of(getPatterns([...fatigue, ...headache], coffee, now), 'together')).toEqual([]);
  });

  it('reports a real pair and compares it with other days', () => {
    const nausea = on('Nausea', [2, 9, 16, 23, 30, 37, 44, 51, 58, 5]);
    const dizziness = on('Dizziness', [2, 9, 16, 23, 30, 37, 44, 51, 12], 15);
    expect(of(getPatterns([...nausea, ...dizziness], coffee, now), 'together')).toEqual([
      {
        id: 'together-dizziness-nausea',
        kind: 'together',
        title: 'Dizziness and nausea tend to happen on the same day',
        detail:
          'Nausea was logged on 8 of the 9 days with dizziness (89%), compared with 2 of 51 other tracked days (4%).',
      },
    ]);
  });

  it('lists the strongest pairs first and leaves out pairs with a near daily symptom', () => {
    // Fatigue on 54 of 60 days, logged first, so the old rule filled every slot with fatigue pairs.
    const fatigueDays = Array.from({ length: 60 }, (_, i) => i).filter(i => i % 10 !== 3);
    const symptoms = [
      ...on('Fatigue', fatigueDays),
      ...on('Headache', [1, 8, 15, 22, 29, 36, 43, 50, 57]),
      ...on('Bloating', [0, 7, 14, 21, 28, 35, 42, 49, 56]),
      ...on('Back pain', [6, 13, 20, 27, 34, 41, 48, 55, 59]),
      ...on('Migraine', [4, 11, 18, 25, 32, 39, 46, 53]),
      ...on('Light sensitivity', [4, 11, 18, 25, 32, 6, 14, 20], 15),
      ...on('Nausea', [2, 9, 16, 23, 30, 37, 44, 51, 58, 5]),
      ...on('Dizziness', [2, 9, 16, 23, 30, 37, 44, 51, 12], 15),
    ];
    const together = of(getPatterns(symptoms, coffee, now), 'together');
    expect(together.map(t => t.title)).toEqual([
      'Dizziness and nausea tend to happen on the same day',
      'Migraine and light sensitivity tend to happen on the same day',
    ]);
  });
});

describe('trends', () => {
  // 28 tracked days ending Tue Jun 30, 2026. Days 0-13 are the earlier fortnight (Jun 3-16).
  const now = new Date(2026, 5, 30, 21);
  const day = (i: number, hour = 14) => new Date(2026, 5, 3 + i, hour);
  const coffee = Array.from({ length: 28 }, (_, i) => fac('Coffee', day(i, 8)));
  const trends = (symptoms: Symptom[], factors = coffee, at = now) => of(getPatterns(symptoms, factors, at), 'trend');

  it('does not call a small shift in a few ratings more severe', () => {
    // 7 symptom days in each fortnight. Mean 4.7 before and 6.0 after, well within chance.
    const before = [2, 5, 7, 2, 5, 7, 5].map((sev, k) => sym('Headache', day(2 * k), sev));
    const after = [5, 7, 9, 5, 7, 2, 7].map((sev, k) => sym('Headache', day(14 + 2 * k), sev));
    expect(trends([...before, ...after])).toEqual([]);
  });

  it('counts days, not entries, so logging more often on the same days is not more symptoms', () => {
    const days = [0, 2, 5, 7, 9, 12];
    const before = days.map(i => sym('Bloating', day(i)));
    const after = days.flatMap(i => [10, 14, 18].map(h => sym('Bloating', day(14 + i, h))));
    expect(trends([...before, ...after])).toEqual([]);
  });

  it('does not report a change from 5 to 9 symptom days out of 14', () => {
    const before = [0, 3, 6, 9, 12].map(i => sym('Headache', day(i)));
    const after = [0, 1, 3, 4, 6, 7, 9, 11, 13].map(i => sym('Headache', day(14 + i)));
    expect(trends([...before, ...after])).toEqual([]);
  });

  it('reports a large drop in symptom days with the counts', () => {
    const before = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map(i => sym('Headache', day(i)));
    const after = [3, 9].map(i => sym('Headache', day(14 + i)));
    expect(trends([...before, ...after])).toEqual([
      {
        id: 'trend-frequency',
        kind: 'trend',
        title: 'Fewer symptoms in the last two weeks',
        detail:
          'You logged symptoms on 2 of 14 tracked days in the last two weeks, compared with 12 of 14 in the two weeks before.',
      },
    ]);
  });

  it('reports worse days using the worst rating of each day', () => {
    const days = [0, 2, 3, 5, 7, 9, 11, 13];
    const before = days.map(i => sym('Headache', day(i), 2));
    // A mild and a very severe entry on each recent day: the day counts as very severe.
    const after = days.flatMap(i => [sym('Headache', day(14 + i, 9), 2), sym('Headache', day(14 + i, 20), 9)]);
    expect(trends([...before, ...after])).toEqual([
      {
        id: 'trend-severity',
        kind: 'trend',
        title: 'Symptoms have been more severe lately',
        detail:
          'On days with symptoms, the worst severity averaged 9.0 out of 10 in the last two weeks, compared with 2.0 in the two weeks before.',
      },
    ]);
  });

  it('compares whole calendar days, so a day is never split between the two fortnights', () => {
    // Opened at 8 in the morning. The evening of Jun 16 belongs to the earlier fortnight.
    const factors = Array.from({ length: 28 }, (_, i) => fac('Coffee', day(i, 7)));
    const before = Array.from({ length: 14 }, (_, i) => sym('Headache', day(i, 20)));
    const [t] = trends(before, factors, new Date(2026, 5, 30, 8));
    expect(t.detail).toBe(
      'You logged symptoms on 0 of 14 tracked days in the last two weeks, compared with 14 of 14 in the two weeks before.',
    );
  });
});

describe('time of day', () => {
  const now = new Date(2026, 5, 30, 23);
  const day = (i: number, hour: number, minute = 0) => new Date(2026, 5, 1 + i, hour, minute);

  it('does not claim a usual time from 5 of 8 starts', () => {
    const rows = [19, 9, 19, 9, 19, 9, 19, 19].map((h, i) => sym('Headache', day(2 * i, h)));
    expect(of(getPatterns(rows, [], now), 'time-of-day')).toEqual([]);
  });

  it('counts a symptom logged again the same evening as one start', () => {
    const rows = [0, 3, 6, 9].flatMap(i => [
      sym('Headache', day(i, 19)),
      sym('Headache', day(i, 19, 40)),
      sym('Headache', day(i, 20, 30)),
    ]);
    expect(rows).toHaveLength(12);
    expect(of(getPatterns(rows, [], now), 'time-of-day')).toEqual([]);
  });

  it('reports a clear time of day with the number of starts', () => {
    const rows = Array.from({ length: 10 }, (_, i) => sym('Headache', day(i, 19)));
    expect(of(getPatterns(rows, [], now), 'time-of-day')).toEqual([
      {
        id: 'tod-headache',
        kind: 'time-of-day',
        title: 'Headache usually starts in the evening',
        detail: 'It began in the evening 10 times out of 10.',
      },
    ]);
  });

  it('treats a night that runs past midnight as one start', () => {
    const rows = Array.from({ length: 8 }, (_, i) => [
      sym('Cough', day(2 * i, 23, 30)),
      sym('Cough', day(2 * i + 1, 0, 30)),
    ]).flat();
    const [t] = of(getPatterns(rows, [], now), 'time-of-day');
    expect(t.title).toBe('Cough usually starts at night');
    expect(t.detail).toBe('It began at night 8 times out of 8.');
  });

  it('needs more than half of the starts in one part of the day', () => {
    const rows = Array.from({ length: 20 }, (_, i) => sym('Headache', day(i, i % 2 ? 19 : 9)));
    expect(of(getPatterns(rows, [], now), 'time-of-day')).toEqual([]);
  });
});
