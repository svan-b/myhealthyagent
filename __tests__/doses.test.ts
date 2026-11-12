import { adherenceFor, dosesForDay, dueKey } from '@/lib/medication/doses';
import type { MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';

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
