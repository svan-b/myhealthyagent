import { getPatterns, getReadiness, summarizeSymptoms, dailySeries } from '@/lib/analysis/patterns';
import type { Symptom } from '@/lib/db/schema';

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
