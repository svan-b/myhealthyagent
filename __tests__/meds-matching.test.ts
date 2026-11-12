// How dose records are matched to slots after the times change. See the top of lib/medication/doses.ts.
import { adherenceFor, changeTimes, checklistDoses, dosesForDay, dueKey } from '@/lib/medication/doses';
import type { MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const NOV12 = at(2026, 11, 12);
const nov12 = (h: number, min = 0) => at(2026, 11, 12, h, min);
const nov13 = (h: number, min = 0) => at(2026, 11, 13, h, min);

function med(over: Partial<MedicationSchedule> = {}): MedicationSchedule {
  const start = at(2026, 9, 1, 7).toISOString();
  return {
    id: 'q1',
    medicationName: 'Quetiapine',
    dosage: '25 mg',
    frequency: 'daily',
    scheduleTimes: ['23:00'],
    isActive: true,
    startDate: start,
    createdAt: start,
    updatedAt: start,
    ...over,
  };
}

let nextId = 0;
const dose = (
  day: Date,
  time: string,
  status: MedicationAdherence['status'] = 'taken',
  takenTime?: Date,
): MedicationAdherence => ({
  id: `r${String(nextId++).padStart(5, '0')}`,
  scheduleId: 'q1',
  medicationName: 'Quetiapine',
  scheduledTime: dueKey(day, time),
  status,
  takenTime: takenTime?.toISOString(),
});

/** A taken record for each time on each of the `n` days before `day`. */
const everyDayBefore = (day: Date, n: number, times: string[]) =>
  Array.from({ length: n }, (_, i) => times.map(t => dose(addDays(day, -(i + 1)), t))).flat();

const keys = (slots: { key: string; state: string }[]) => slots.map(s => [s.key, s.state]);
const dueNow = (slots: { state: string }[]) => slots.filter(s => s.state === 'due' || s.state === 'overdue');

describe('a bedtime dose moved past midnight just after it was taken', () => {
  // Quetiapine at 23:00, taken at 23:05, then moved to 00:30 at 23:10
  const taken = dose(NOV12, '23:00', 'taken', nov12(23, 5));
  const moved = changeTimes(med(), 'daily', ['00:30'], nov12(23, 10));

  it('shows tonight’s 00:30 dose as taken, not due', () => {
    for (const now of [nov12(23, 15), nov12(23, 40), nov13(0, 30), nov13(1)]) {
      const list = checklistDoses([moved], [taken], now);
      expect(list.find(s => s.key === '2026-11-13T00:30')).toMatchObject({ state: 'taken', record: taken });
      // Only that row. This morning's 00:30 is not offered next to it.
      expect(list.map(s => s.key)).toEqual(['2026-11-13T00:30']);
      expect(dueNow(list)).toEqual([]);
    }
    // This morning's 00:30 was not in the schedule, so it is not due either
    expect(keys(dosesForDay([moved], [taken], nov12(23, 40)))).toEqual([['2026-11-12T00:30', 'untracked']]);
  });

  it('still lists a dose that does not count when nothing else is at that time', () => {
    // Added at 15:00, so this morning's dose can still be recorded
    const added = med({
      frequency: 'twice-daily',
      scheduleTimes: ['08:00', '20:00'],
      startDate: nov12(15).toISOString(),
    });
    expect(keys(checklistDoses([added], [], nov12(15)))).toEqual([
      ['2026-11-12T08:00', 'untracked'],
      ['2026-11-12T20:00', 'upcoming'],
    ]);
  });

  it('counts the dose once, on the night it now belongs to', () => {
    const records = [...everyDayBefore(NOV12, 31, ['23:00']), taken];
    // Oct 15 to Nov 11 at 23:00, then Nov 13 at 00:30 with the dose taken on the 12th at 23:05
    expect(adherenceFor(moved, records, 30, nov13(12))).toMatchObject({ expected: 29, taken: 29, percent: 100 });
    expect(keys(dosesForDay([moved], records, nov13(12)))).toEqual([['2026-11-13T00:30', 'taken']]);
  });

  it('still offers the next night’s dose', () => {
    expect(keys(checklistDoses([moved], [taken], nov13(23, 40)))).toEqual([
      ['2026-11-13T00:30', 'taken'],
      ['2026-11-14T00:30', 'due'],
    ]);
  });

  it('moves a dose past midnight by up to 6 hours, and treats a bigger move as a new day’s dose', () => {
    const late = dose(NOV12, '22:00');
    const by = (time: string) => changeTimes(med({ scheduleTimes: ['22:00'] }), 'daily', [time], nov12(22, 30));
    // 03:30 is 5½ hours later, the same night
    expect(checklistDoses([by('03:30')], [late], nov12(22, 35)).find(s => s.key === '2026-11-13T03:30')?.state).toBe(
      'taken',
    );
    // 04:30 is 6½ hours later. The record stays on its own day and tomorrow’s 04:30 dose is due.
    expect(keys(dosesForDay([by('04:30')], [late], nov13(4)))).toEqual([['2026-11-13T04:30', 'due']]);
    expect(keys(dosesForDay([by('04:30')], [late], nov13(4), NOV12))).toEqual([['2026-11-12T04:30', 'taken']]);
  });
});

describe('never hides a dose that is really due', () => {
  it('keeps tonight’s dose due after a dose taken just after midnight moves to the evening', () => {
    // 00:30 dose taken at 00:35 (last night's), then moved to 23:00 at 01:00
    const early = dose(NOV12, '00:30', 'taken', nov12(0, 35));
    const moved = changeTimes(med({ scheduleTimes: ['00:30'] }), 'daily', ['23:00'], nov12(1));
    expect(keys(dosesForDay([moved], [early], nov12(22, 30)))).toEqual([
      ['2026-11-12T00:30', 'taken'],
      ['2026-11-12T23:00', 'due'],
    ]);
    // Once tonight's dose is taken, the day has two doses, both counted
    const tonight = dose(NOV12, '23:00');
    expect(adherenceFor(moved, [early, tonight], 1, nov12(23, 59))).toMatchObject({ expected: 2, taken: 2 });
  });

  it('keeps tomorrow morning’s dose due after an evening dose moves to the morning', () => {
    const evening = dose(NOV12, '20:00', 'taken', nov12(20, 5));
    const morning = changeTimes(med({ scheduleTimes: ['20:00'] }), 'daily', ['07:00'], nov12(20, 30));
    expect(keys(dosesForDay([morning], [evening], nov13(6, 30)))).toEqual([['2026-11-13T07:00', 'due']]);
    // Today's dose was taken, under the time it had
    expect(keys(dosesForDay([morning], [evening], nov12(20, 35)))).toEqual([['2026-11-12T07:00', 'taken']]);
  });

  it('matches by when a dose was due, so a morning dose taken late does not hide the afternoon dose', () => {
    const s = med({ frequency: 'twice-daily', scheduleTimes: ['08:00', '14:00'] });
    // The 08:00 dose was taken at 14:50, then both times moved an hour later
    const morning = dose(NOV12, '08:00', 'taken', nov12(14, 50));
    const later = changeTimes(s, 'twice-daily', ['09:00', '15:00'], nov12(14, 55));
    expect(keys(dosesForDay([later], [morning], nov12(15)))).toEqual([
      ['2026-11-12T09:00', 'taken'],
      ['2026-11-12T15:00', 'due'],
    ]);
    // Without an edit a late morning dose never touches the afternoon dose either
    expect(keys(dosesForDay([s], [morning], nov12(14, 55)))).toEqual([
      ['2026-11-12T08:00', 'taken'],
      ['2026-11-12T14:00', 'due'],
    ]);
  });

  it('puts a dose ticked for tonight’s 00:30 row before an edit that night on tonight’s new time', () => {
    // At 23:45 the 00:30 dose is ticked, which records it for the 13th. At 23:50 the time moves to 23:00.
    const ticked = dose(at(2026, 11, 13), '00:30', 'taken', nov12(23, 45));
    const lastNight = dose(NOV12, '00:30');
    const moved = changeTimes(med({ scheduleTimes: ['00:30'] }), 'daily', ['23:00'], nov12(23, 50));
    expect(keys(checklistDoses([moved], [lastNight, ticked], nov12(23, 55)))).toEqual([
      ['2026-11-12T00:30', 'taken'],
      ['2026-11-12T23:00', 'taken'],
    ]);
    // Tomorrow night's dose is still to take
    expect(keys(dosesForDay([moved], [lastNight, ticked], nov13(22, 30)))).toEqual([['2026-11-13T23:00', 'due']]);
  });

  it('keeps daytime moves on the same day, as before', () => {
    // A once a day 08:00 dose taken, then moved to 23:00 at 10:00. Today's dose was taken.
    const s = med({ scheduleTimes: ['08:00'] });
    const moved = changeTimes(s, 'daily', ['23:00'], nov12(10));
    expect(keys(dosesForDay([moved], [dose(NOV12, '08:00')], nov12(22, 30)))).toEqual([['2026-11-12T23:00', 'taken']]);
  });
});

describe('every record counts on its day', () => {
  const metformin = (over: Partial<MedicationSchedule> = {}) =>
    med({ medicationName: 'Metformin', frequency: 'twice-daily', scheduleTimes: ['08:00', '20:00'], ...over });

  it('keeps a taken dose whose time an edit removed with nothing to move to', () => {
    // Twice a day, the 08:00 dose taken, then at 09:00 the schedule changes to once a day at 20:00
    const records = [...everyDayBefore(NOV12, 30, ['08:00', '20:00']), dose(NOV12, '08:00')];
    const once = changeTimes(metformin(), 'daily', ['20:00'], nov12(9));
    expect(keys(dosesForDay([once], records, nov12(9, 5)))).toEqual([
      ['2026-11-12T08:00', 'taken'],
      ['2026-11-12T20:00', 'upcoming'],
    ]);
    expect(adherenceFor(once, records, 30, nov12(19))).toMatchObject({ expected: 59, taken: 59, percent: 100 });
    // The evening dose still counts as missed once its window has closed
    expect(adherenceFor(once, records, 30, nov12(23))).toMatchObject({ expected: 60, taken: 59, missed: 1 });
    // The next day has only the evening dose
    expect(keys(dosesForDay([once], records, nov13(9)))).toEqual([['2026-11-13T20:00', 'upcoming']]);
  });

  it('keeps a skipped dose too', () => {
    const once = changeTimes(metformin(), 'daily', ['20:00'], nov12(9));
    const skipped = dose(NOV12, '08:00', 'skipped');
    expect(keys(dosesForDay([once], [skipped], nov12(9, 5)))[0]).toEqual(['2026-11-12T08:00', 'skipped']);
    expect(adherenceFor(once, [skipped], 1, nov12(19))).toMatchObject({ expected: 1, skipped: 1, taken: 0 });
  });

  it('keeps a record at a time the schedule never had when no slot is free', () => {
    const records = [dose(NOV12, '08:00'), dose(NOV12, '11:15'), dose(NOV12, '20:00')];
    expect(keys(dosesForDay([metformin()], records, nov12(21)))).toEqual([
      ['2026-11-12T08:00', 'taken'],
      ['2026-11-12T11:15', 'taken'],
      ['2026-11-12T20:00', 'taken'],
    ]);
    expect(adherenceFor(metformin(), records, 1, nov12(23))).toMatchObject({ expected: 3, taken: 3 });
  });

  it('moves a record from an edit that kept no history only to a nearby slot', () => {
    // Edits made before times were kept: 08:00 became 08:30, and twice a day became 20:00 only
    const moved = metformin({ frequency: 'daily', scheduleTimes: ['08:30'] });
    expect(keys(dosesForDay([moved], [dose(NOV12, '08:00')], nov12(12)))).toEqual([['2026-11-12T08:30', 'taken']]);
    const evening = metformin({ frequency: 'daily', scheduleTimes: ['20:00'] });
    expect(keys(dosesForDay([evening], [dose(NOV12, '08:00')], nov12(19, 30)))).toEqual([
      ['2026-11-12T08:00', 'taken'],
      ['2026-11-12T20:00', 'due'],
    ]);
  });

  it('moves one of two doses when an edit leaves one time to move to', () => {
    // Three times a day, morning and midday taken, then changed to twice a day at 09:00 and 20:00
    const three = metformin({ frequency: 'three-times', scheduleTimes: ['08:00', '13:00', '20:00'] });
    const records = [dose(NOV12, '08:00'), dose(NOV12, '13:00')];
    const twice = changeTimes(three, 'twice-daily', ['09:00', '20:00'], nov12(14));
    expect(keys(dosesForDay([twice], records, nov12(14, 5)))).toEqual([
      ['2026-11-12T09:00', 'taken'],
      ['2026-11-12T13:00', 'taken'],
      ['2026-11-12T20:00', 'upcoming'],
    ]);
    expect(adherenceFor(twice, records, 1, nov12(23))).toMatchObject({ expected: 3, taken: 2, missed: 1 });
  });
});

describe('moves across midnight on clock change nights', () => {
  // Clock change days in New York, Europe, Chile, Australia, Lord Howe and Chatham. Elsewhere they are
  // ordinary days. In Santiago, midnight does not exist on Sep 6 and comes twice on Apr 5.
  const changeDays = [
    at(2026, 3, 8),
    at(2026, 3, 29),
    at(2026, 4, 5),
    at(2026, 9, 6),
    at(2026, 9, 27),
    at(2026, 10, 4),
    at(2026, 10, 25),
    at(2026, 11, 1),
  ];

  it.each(changeDays)('moves a bedtime dose to the same night around %s', changeDay => {
    for (const time of ['00:30', '02:30']) {
      const eve = addDays(changeDay, -1);
      const records = [dose(addDays(eve, -2), '23:00'), dose(addDays(eve, -1), '23:00'), dose(eve, '23:00')];
      const moved = changeTimes(
        med({ startDate: addDays(eve, -10).toISOString() }),
        'daily',
        [time],
        new Date(eve.getFullYear(), eve.getMonth(), eve.getDate(), 23, 10),
      );
      const night = new Date(eve.getFullYear(), eve.getMonth(), eve.getDate(), 23, 40);
      const list = checklistDoses([moved], records, night);
      expect(list.find(s => s.key === dueKey(changeDay, time))).toMatchObject({ state: 'taken', record: records[2] });
      expect(dueNow(list)).toEqual([]);
      // At noon on the change day: three nights, three doses, each counted once
      const noon = new Date(changeDay.getFullYear(), changeDay.getMonth(), changeDay.getDate(), 12);
      expect(adherenceFor(moved, records, 4, noon)).toMatchObject({ expected: 3, taken: 3 });
      expect(keys(dosesForDay([moved], records, noon))).toEqual([[dueKey(changeDay, time), 'taken']]);
    }
  });
});
