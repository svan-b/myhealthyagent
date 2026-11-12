import { getPatterns, getReadiness, summarizeSymptoms, dailySeries } from '@/lib/analysis/patterns';
import type { Symptom } from '@/lib/db/schema';
import { severityLabel } from '@/lib/utils';

const NOW = new Date(2026, 5, 30, 12, 0);

const s = (name: string, d: Date, severity = 5): Symptom => ({
  id: Math.random().toString(),
  name,
  severity,
  timestamp: d.toISOString(),
});

describe('patterns', () => {
  it('reports readiness stages', () => {
    expect(getReadiness([], [], NOW).stage).toBe('empty');
    expect(getReadiness([s('Headache', NOW)], [], NOW).stage).toBe('starting');
  });

  it('detects a time of day pattern', () => {
    const rows = Array.from({ length: 10 }, (_, i) => s('Headache', new Date(2026, 5, 10 + i, 19)));
    const p = getPatterns(rows, [], NOW);
    expect(p.find(x => x.kind === 'time-of-day')?.title).toBe('Headache usually starts in the evening');
  });

  it('summarises symptoms and builds a daily series', () => {
    const rows = [s('Headache', NOW, 7), s('headache', NOW, 3), s('Nausea', NOW, 5)];
    const sum = summarizeSymptoms(rows);
    expect(sum[0]).toMatchObject({ count: 2, avgSeverity: 5, maxSeverity: 7, days: 1 });
    const series = dailySeries(rows, 7, NOW);
    expect(series).toHaveLength(7);
    expect(series[6]).toMatchObject({ count: 3, maxSeverity: 7 });
  });
});

describe('typical severity', () => {
  const logged = (levels: number[]) => levels.map((sev, i) => s('Migraine', new Date(2026, 5, 1 + i, 9), sev));

  it.each([
    [[2, 2, 2, 9], 'Mild'],
    [[2, 2, 2, 7], 'Mild'],
    [[5, 5, 5, 9, 9, 9, 9], 'Very severe'],
    [[7, 7, 7, 2], 'Severe'],
    [[2, 2, 2, 9, 9, 9, 9], 'Very severe'],
  ])('ratings %j are usually %s', (levels, label) => {
    const [summary] = summarizeSymptoms(logged(levels));
    expect(severityLabel(summary.typicalSeverity)).toBe(label);
  });

  it('keeps the average for text that calls it an average', () => {
    const [summary] = summarizeSymptoms(logged([2, 2, 2, 9]));
    expect(summary).toMatchObject({ avgSeverity: 3.8, typicalSeverity: 2, maxSeverity: 9, count: 4 });
  });

  it('is always a level that was logged, and the middle one', () => {
    const levels = [2, 5, 7, 9];
    const combos = (n: number): number[][] =>
      n === 0
        ? [[]]
        : combos(n - 1).flatMap(c => levels.filter(l => !c.length || l >= c[c.length - 1]).map(l => [...c, l]));
    for (let n = 1; n <= 7; n++) {
      for (const c of combos(n)) {
        const { typicalSeverity } = summarizeSymptoms(logged(c))[0];
        expect(c).toContain(typicalSeverity);
        // At least half the ratings are this level or higher, and at least half are this level or lower
        expect(c.filter(v => v >= typicalSeverity).length * 2).toBeGreaterThanOrEqual(n);
        expect(c.filter(v => v <= typicalSeverity).length * 2).toBeGreaterThanOrEqual(n);
      }
    }
  });
});
