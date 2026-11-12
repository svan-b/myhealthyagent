// Recording a dose after its window closed, and changing recent doses.
import {
  adherenceFor,
  changeTimes,
  checklistDoses,
  doseRecord,
  dosesAsFactors,
  dosesForDay,
  dueKey,
  dueKeyToDate,
  pauseSchedule,
  recentDoses,
  takenAt,
  type DoseSlot,
} from '@/lib/medication/doses';
import type { MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const NOV12 = at(2026, 11, 12);
const NOV11 = at(2026, 11, 11);
const nov12 = (h: number, min = 0) => at(2026, 11, 12, h, min);
const nov11 = (h: number, min = 0) => at(2026, 11, 11, h, min);

function med(over: Partial<MedicationSchedule> = {}): MedicationSchedule {
  const start = at(2026, 9, 1, 7).toISOString();
  return {
    id: 'q1',
    medicationName: 'Quetiapine',
    dosage: '25 mg',
    frequency: 'daily',
    scheduleTimes: ['22:00'],
    isActive: true,
    startDate: start,
    createdAt: start,
    updatedAt: start,
    ...over,
  };
}

let nextId = 0;
const dose = (day: Date, time: string, status: MedicationAdherence['status'] = 'taken'): MedicationAdherence => ({
  id: `r${String(nextId++).padStart(5, '0')}`,
  scheduleId: 'q1',
  medicationName: 'Quetiapine',
  scheduledTime: dueKey(day, time),
  status,
});
const everyDayBefore = (day: Date, n: number, time: string) =>
  Array.from({ length: n }, (_, i) => dose(addDays(day, -(i + 1)), time));

const keys = (slots: { key: string; state: string }[]) => slots.map(s => [s.key, s.state]);
const slotAt = (slots: DoseSlot[], key: string) => {
  const slot = slots.find(s => s.key === key);
  if (!slot) throw new Error(`no slot ${key}`);
  return slot;
};

describe('last night’s dose, the next morning', () => {
  const quetiapine = med();
  // Every night taken except last night's 22:00 dose, which was taken but not ticked
  const records = everyDayBefore(NOV11, 40, '22:00');

  it('is no longer on the checklist, but is still there to record as yesterday’s dose', () => {
    expect(keys(checklistDoses([quetiapine], records, nov12(7, 30)))).toEqual([['2026-11-12T22:00', 'upcoming']]);
    expect(keys(dosesForDay([quetiapine], records, nov12(7, 30), NOV11))).toEqual([['2026-11-11T22:00', 'overdue']]);
    expect(adherenceFor(quetiapine, records, 30, nov12(7, 30))).toMatchObject({ expected: 29, taken: 28, missed: 1 });
  });

  it('is recorded at the time it was due, keeps its slot and counts as taken', () => {
    const slot = slotAt(dosesForDay([quetiapine], records, nov12(7, 30), NOV11), '2026-11-11T22:00');
    const saved = doseRecord(slot, 'taken', 'new-id', nov12(7, 30));
    expect(saved).toEqual({
      id: 'new-id',
      scheduleId: 'q1',
      medicationName: 'Quetiapine',
      scheduledTime: '2026-11-11T22:00',
      status: 'taken',
      takenTime: nov11(22).toISOString(),
    });
    const after = [...records, saved];
    expect(adherenceFor(quetiapine, after, 30, nov12(7, 30))).toMatchObject({ expected: 29, taken: 29, percent: 100 });
    expect(keys(dosesForDay([quetiapine], after, nov12(7, 30), NOV11))).toEqual([['2026-11-11T22:00', 'taken']]);
    // The trigger finder sees the dose at 22:00 last night, not at 07:30 this morning
    expect(dosesAsFactors([saved])).toEqual([
      { id: 'dose-new-id', name: 'Quetiapine', category: 'medication', timestamp: nov11(22).toISOString() },
    ]);
  });

  it('can be recorded as skipped', () => {
    const slot = slotAt(dosesForDay([quetiapine], records, nov12(7, 30), NOV11), '2026-11-11T22:00');
    const saved = doseRecord(slot, 'skipped', 'new-id', nov12(7, 30));
    expect(saved).toMatchObject({ scheduledTime: '2026-11-11T22:00', status: 'skipped' });
    expect(saved.takenTime).toBeUndefined();
    expect(adherenceFor(quetiapine, [...records, saved], 30, nov12(7, 30))).toMatchObject({ skipped: 1, missed: 0 });
  });
});

describe('the time a dose is recorded as taken', () => {
  const s = med({ frequency: 'twice-daily', scheduleTimes: ['08:00', '20:00'] });
  const morning = (now: Date) => slotAt(dosesForDay([s], [], now), '2026-11-12T08:00');

  it('is the tap while the dose’s window is open, also when taken early', () => {
    expect(doseRecord(morning(nov12(7)), 'taken', 'a', nov12(7)).takenTime).toBe(nov12(7).toISOString());
    expect(doseRecord(morning(nov12(9, 59)), 'taken', 'a', nov12(9, 59)).takenTime).toBe(nov12(9, 59).toISOString());
    const evening = slotAt(dosesForDay([s], [], nov12(12)), '2026-11-12T20:00');
    expect(doseRecord(evening, 'taken', 'a', nov12(12)).takenTime).toBe(nov12(12).toISOString());
  });

  it('is the time it was due once its window has closed', () => {
    expect(doseRecord(morning(nov12(10)), 'taken', 'a', nov12(10)).takenTime).toBe(nov12(8).toISOString());
    expect(doseRecord(morning(nov12(18)), 'taken', 'a', nov12(18)).takenTime).toBe(nov12(8).toISOString());
  });

  it('keeps the record’s id, key and other fields when it is changed', () => {
    const skipped = { ...dose(NOV12, '08:00', 'skipped'), notes: 'felt sick' };
    const slot = slotAt(dosesForDay([s], [skipped], nov12(18)), '2026-11-12T08:00');
    expect(doseRecord(slot, 'taken', 'unused', nov12(18))).toEqual({
      ...skipped,
      status: 'taken',
      takenTime: nov12(8).toISOString(),
    });
    const taken = { ...dose(NOV12, '08:00'), takenTime: nov12(8, 40).toISOString() };
    const back = doseRecord(
      slotAt(dosesForDay([s], [taken], nov12(18)), '2026-11-12T08:00'),
      'skipped',
      'x',
      nov12(18),
    );
    expect(back).toMatchObject({ id: taken.id, status: 'skipped', takenTime: undefined });
  });

  it('keeps the key of a record that moved to another slot', () => {
    // The 23:00 dose was skipped, then the time moved to 00:30. Changing it later keeps its key.
    const night = med({ scheduleTimes: ['23:00'] });
    const skipped = dose(NOV12, '23:00', 'skipped');
    const moved = changeTimes(night, 'daily', ['00:30'], nov12(23, 10));
    const slot = slotAt(dosesForDay([moved], [skipped], at(2026, 11, 14, 9), at(2026, 11, 13)), '2026-11-13T00:30');
    expect(slot.record).toBe(skipped);
    expect(doseRecord(slot, 'taken', 'x', at(2026, 11, 14, 9))).toMatchObject({
      id: skipped.id,
      scheduledTime: '2026-11-12T23:00',
      status: 'taken',
      takenTime: at(2026, 11, 13, 0, 30).toISOString(),
    });
  });
});

describe('recent doses for the dose list', () => {
  const s = med({ frequency: 'twice-daily', scheduleTimes: ['08:00', '20:00'] });

  it('lists every dose that counts from today and the 7 days before, recorded or not', () => {
    const records = [dose(NOV11, '20:00'), dose(addDays(NOV12, -3), '08:00', 'skipped')];
    const list = recentDoses(s, records, nov12(12));
    // Nov 5 to Nov 11, two a day, then this morning's. Tonight's is not due yet.
    expect(list[0].key).toBe('2026-11-05T08:00');
    expect(list).toHaveLength(15);
    expect(keys(list.slice(-4))).toEqual([
      ['2026-11-10T20:00', 'overdue'],
      ['2026-11-11T08:00', 'overdue'],
      ['2026-11-11T20:00', 'taken'],
      ['2026-11-12T08:00', 'overdue'],
    ]);
    expect(list.find(x => x.key === '2026-11-09T08:00')?.state).toBe('skipped');
  });

  it('includes a dose taken early and leaves out doses not due yet', () => {
    const early = dose(NOV12, '20:00');
    expect(recentDoses(s, [early], nov12(12)).map(x => x.key)).toContain('2026-11-12T20:00');
    expect(recentDoses(s, [], nov12(12)).map(x => x.key)).not.toContain('2026-11-12T20:00');
  });

  it('leaves out doses from before the start and during a pause, unless they were recorded', () => {
    const added = med({ ...s, startDate: nov12(9).toISOString() });
    expect(keys(recentDoses(added, [], nov12(12)))).toEqual([]);
    const paused = pauseSchedule(s, nov11(12));
    const list = recentDoses(paused, [dose(NOV12, '08:00')], nov12(12));
    // Up to the pause: Nov 5 to Nov 11 08:00
    expect(list.map(x => x.key).slice(-2)).toEqual(['2026-11-10T20:00', '2026-11-11T08:00']);
    expect(list.map(x => x.key)).not.toContain('2026-11-12T08:00');
  });

  it('lists nothing for an as-needed medication', () => {
    expect(recentDoses(med({ frequency: 'as-needed', scheduleTimes: [] }), [], nov12(12))).toEqual([]);
  });
});

describe('a time typed for when a dose was taken', () => {
  it('is read on the day nearest to when the dose was due', () => {
    expect(takenAt(nov11(23), '00:30')).toEqual(nov12(0, 30));
    expect(takenAt(nov11(23), '22:15')).toEqual(nov11(22, 15));
    expect(takenAt(nov12(0, 30), '23:50')).toEqual(nov11(23, 50));
    expect(takenAt(nov12(8), '13:30')).toEqual(nov12(13, 30));
    // Exactly 12 hours either way: the earlier one
    expect(takenAt(nov12(20), '08:00')).toEqual(nov12(8));
  });

  it('is null when it is not a time', () => {
    expect(takenAt(nov12(8), '')).toBeNull();
    expect(takenAt(nov12(8), '8:00')).toBeNull();
  });
});

describe('doses for the trigger finder', () => {
  it('uses the time a dose was taken, or the time it was due when that is unknown or unreadable', () => {
    const base = dose(NOV12, '08:00');
    const factors = dosesAsFactors([
      { ...base, id: 'a', takenTime: nov12(9, 15).toISOString() },
      { ...base, id: 'b' },
      { ...base, id: 'c', takenTime: 'not a time' },
      { ...base, id: 'd', status: 'skipped' },
      { ...base, id: 'e', scheduledTime: 'garbage' },
    ]);
    expect(factors.map(f => [f.id, f.timestamp])).toEqual([
      ['dose-a', nov12(9, 15).toISOString()],
      ['dose-b', dueKeyToDate('2026-11-12T08:00').toISOString()],
      ['dose-c', nov12(8).toISOString()],
    ]);
  });
});
