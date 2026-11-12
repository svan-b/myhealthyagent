import { adherenceFor, dosesForDay, dueKey } from '@/lib/medication/doses';
import { getPatterns, getReadiness, summarizeSymptoms, dailySeries } from '@/lib/analysis/patterns';
import { csvField, toCSV } from '@/lib/db/backup';
import type { MedicationAdherence, MedicationSchedule, Symptom } from '@/lib/db/schema';

const NOW = new Date(2026, 5, 30, 12, 0);

const schedule: MedicationSchedule = {
  id: 'm1',
  medicationName: 'Metformin',
  dosage: '500mg',
  frequency: 'twice-daily',
  scheduleTimes: ['08:00', '20:00'],
  isActive: true,
  startDate: new Date(2026, 5, 20, 7).toISOString(),
  createdAt: '',
  updatedAt: '',
};

const rec = (day: Date, time: string, status: MedicationAdherence['status']): MedicationAdherence => ({
  id: `${dueKey(day, time)}`,
  scheduleId: 'm1',
  medicationName: 'Metformin',
  scheduledTime: dueKey(day, time),
  status,
});

describe('doses', () => {
  it('lists today’s doses with local times and states', () => {
    const today = dosesForDay([schedule], [rec(NOW, '08:00', 'taken')], NOW);
    expect(today.map(d => [d.time, d.state])).toEqual([
      ['08:00', 'taken'],
      ['20:00', 'upcoming'],
    ]);
    const overdue = dosesForDay([schedule], [], NOW);
    expect(overdue[0].state).toBe('overdue');
  });

  it('skips paused and as-needed schedules', () => {
    expect(dosesForDay([{ ...schedule, isActive: false }], [], NOW)).toEqual([]);
    expect(dosesForDay([{ ...schedule, frequency: 'as-needed', scheduleTimes: [] }], [], NOW)).toEqual([]);
  });

  it('computes adherence only for doses that are due', () => {
    // Schedule started June 20, so June 20 to June 29 = 10 days x 2 = 20, plus June 30 08:00 = 21 due
    const records = [rec(NOW, '08:00', 'taken'), rec(new Date(2026, 5, 29), '20:00', 'skipped')];
    const a = adherenceFor(schedule, records, 30, NOW);
    expect(a.expected).toBe(21);
    expect(a.taken).toBe(1);
    expect(a.skipped).toBe(1);
    expect(a.missed).toBe(19);
    expect(a.percent).toBe(5);
  });
});

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

describe('csv export', () => {
  it('quotes fields and blocks formula injection', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField(undefined)).toBe('');
  });

  it('includes symptoms and factors in time order', () => {
    const csv = toCSV(
      [{ id: '1', name: 'Headache', severity: 7, timestamp: '2026-06-02T10:00:00.000Z', notes: 'bad, very' }],
      [{ id: '2', name: 'Dairy', category: 'food', timestamp: '2026-06-01T10:00:00.000Z' }],
    );
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[0]).toMatch(/^type,name,category,severity/);
    expect(lines[1]).toMatch(/^factor,Dairy,food/);
    expect(lines[2]).toMatch(/^symptom,Headache,,7,.*"bad, very"/);
  });
});

describe('adherence edge cases', () => {
  it('does not count doses that were due before the medication was added', () => {
    // Added today at 9:00. The 08:00 dose today was never expected.
    const addedToday = { ...schedule, startDate: new Date(2026, 5, 30, 9, 0).toISOString() };
    const a = adherenceFor(addedToday, [], 30, new Date(2026, 5, 30, 23, 0));
    expect(a.expected).toBe(1); // only the 20:00 dose, once its window closed
  });

  it('still counts an early dose the person recorded', () => {
    const addedToday = { ...schedule, startDate: new Date(2026, 5, 30, 9, 0).toISOString() };
    const a = adherenceFor(addedToday, [rec(NOW, '08:00', 'taken')], 30, new Date(2026, 5, 30, 23, 0));
    expect(a).toMatchObject({ expected: 2, taken: 1 });
  });
});
