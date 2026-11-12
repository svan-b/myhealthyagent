import {
  adherenceFor,
  changeTimes,
  checklistDoses,
  dosesForDay,
  dueKey,
  dueKeyToDate,
  pauseSchedule,
  resumeSchedule,
  startTrackingAt,
} from '@/lib/medication/doses';
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

// ----- How a schedule changes over time -----

const HOUR = 60 * 60_000;
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const NOV12 = at(2026, 11, 12);
const nov12 = (h: number, min = 0) => at(2026, 11, 12, h, min);

function med(over: Partial<MedicationSchedule> = {}): MedicationSchedule {
  const start = at(2026, 9, 1, 7).toISOString();
  return {
    id: 'm1',
    medicationName: 'Metformin',
    dosage: '500 mg',
    frequency: 'twice-daily',
    scheduleTimes: ['08:00', '20:00'],
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
  scheduleId: 'm1',
  medicationName: 'Metformin',
  scheduledTime: dueKey(day, time),
  status,
});

/** A record for each time on each of the `n` days before `day`. */
const everyDayBefore = (day: Date, n: number, times: string[]) =>
  Array.from({ length: n }, (_, i) => times.map(t => dose(addDays(day, -(i + 1)), t))).flat();

const states = (slots: { time: string; state: string }[]) => slots.map(s => [s.time, s.state]);
const keys = (slots: { key: string; state: string }[]) => slots.map(s => [s.key, s.state]);

describe('editing dose times', () => {
  const records = [...everyDayBefore(NOV12, 30, ['08:00', '20:00']), dose(NOV12, '08:00')];

  it('keeps a dose taken before its time was moved, and keeps adherence at 100%', () => {
    // Took the 08:00 dose, then moved it to 08:30 at 10:00
    const edited = changeTimes(med(), 'twice-daily', ['08:30', '20:00'], nov12(10));
    expect(states(dosesForDay([edited], records, nov12(10, 5)))).toEqual([
      ['08:30', 'taken'],
      ['20:00', 'upcoming'],
    ]);
    expect(adherenceFor(edited, records, 30, nov12(10, 5))).toMatchObject({ expected: 59, taken: 59, percent: 100 });

    // Moving it earlier, or moving both times, keeps it taken too
    const earlier = changeTimes(med(), 'twice-daily', ['07:00', '20:00'], nov12(10));
    expect(states(dosesForDay([earlier], records, nov12(10, 5)))[0]).toEqual(['07:00', 'taken']);
    const both = changeTimes(med(), 'twice-daily', ['09:00', '21:00'], nov12(11));
    expect(adherenceFor(both, records, 30, nov12(11, 5))).toMatchObject({ expected: 59, taken: 59, percent: 100 });
  });

  it('adds no missed doses on earlier days when a medication goes from once to twice a day', () => {
    const once = med({ frequency: 'daily', scheduleTimes: ['08:00'] });
    const recs = [...everyDayBefore(NOV12, 30, ['08:00']), dose(NOV12, '08:00')];
    const twice = changeTimes(once, 'twice-daily', ['08:00', '20:00'], nov12(21));
    // Today's 20:00 dose was added at 21:00, after it was due, so it is not missed either
    expect(adherenceFor(twice, recs, 30, nov12(23))).toMatchObject({ expected: 30, taken: 30, percent: 100 });
    expect(states(dosesForDay([twice], recs, nov12(21, 5)))).toEqual([
      ['08:00', 'taken'],
      ['20:00', 'untracked'],
    ]);
  });

  it('does not count days before an as-needed medication became scheduled', () => {
    const asNeeded = med({ frequency: 'as-needed', scheduleTimes: [] });
    const t = at(2026, 11, 10, 9).toISOString();
    const loggedAsNeeded = [{ ...dose(NOV12, '00:00'), scheduledTime: t, takenTime: t }];
    const daily = changeTimes(asNeeded, 'daily', ['08:00'], nov12(15));
    expect(adherenceFor(daily, loggedAsNeeded, 30, nov12(23))).toMatchObject({ expected: 0, percent: null });
    expect(states(dosesForDay([daily], loggedAsNeeded, nov12(15)))).toEqual([['08:00', 'untracked']]);
    // From the next day on, the new schedule counts
    expect(adherenceFor(daily, loggedAsNeeded, 30, at(2026, 11, 13, 12))).toMatchObject({ expected: 1, missed: 1 });
  });

  it('reports 30 of 30 when a daily time changed today and today’s dose was taken', () => {
    const levo = med({ medicationName: 'Levothyroxine', frequency: 'daily', scheduleTimes: ['08:00'] });
    const recs = [...everyDayBefore(NOV12, 60, ['08:00']), dose(NOV12, '09:00')];
    const edited = changeTimes(levo, 'daily', ['09:00'], nov12(8, 30));
    expect(adherenceFor(edited, recs, 30, nov12(12))).toMatchObject({ expected: 30, taken: 30, percent: 100 });
  });

  it('still counts doses that were missed before an edit', () => {
    // Every evening dose missed, then the evening time moved
    const recs = [...everyDayBefore(NOV12, 30, ['08:00']), dose(NOV12, '08:00')];
    const edited = changeTimes(med(), 'twice-daily', ['08:00', '21:00'], nov12(10));
    expect(adherenceFor(edited, recs, 30, nov12(12))).toMatchObject({ expected: 59, taken: 30, missed: 29 });
  });

  it('never moves a taken dose onto a dose that was due anyway', () => {
    // Took the morning dose, then dropped it. The evening dose is still to take, and the morning
    // dose stays listed at its own time.
    const eveningOnly = changeTimes(med(), 'daily', ['20:00'], nov12(10));
    expect(states(dosesForDay([eveningOnly], [dose(NOV12, '08:00')], nov12(10, 5)))).toEqual([
      ['08:00', 'taken'],
      ['20:00', 'upcoming'],
    ]);
  });

  it('shows one dose, not two, when a time is moved before the dose is taken', () => {
    const moved = changeTimes(med({ frequency: 'daily', scheduleTimes: ['08:00'] }), 'daily', ['11:00'], nov12(7, 30));
    expect(states(dosesForDay([moved], [], nov12(10, 30)))).toEqual([['11:00', 'due']]);
  });

  it('keeps an evening dose taken early as taken when its time moves later', () => {
    const recs = [dose(NOV12, '08:00'), dose(NOV12, '20:00')]; // the 20:00 dose was taken at 19:00
    const later = changeTimes(med(), 'twice-daily', ['08:00', '22:00'], nov12(19, 30));
    expect(states(dosesForDay([later], recs, nov12(19, 35)))).toEqual([
      ['08:00', 'taken'],
      ['22:00', 'taken'],
    ]);
  });

  it('does not count a dose added later in the day as missed earlier that day', () => {
    const recs = [...everyDayBefore(NOV12, 30, ['08:00', '20:00']), dose(NOV12, '08:00'), dose(NOV12, '20:00')];
    const three = changeTimes(med(), 'three-times', ['08:00', '14:00', '20:00'], nov12(16));
    expect(states(dosesForDay([three], recs, nov12(16, 5)))[1]).toEqual(['14:00', 'untracked']);
    expect(adherenceFor(three, recs, 30, nov12(23))).toMatchObject({ expected: 60, taken: 60, percent: 100 });
  });

  it('keeps the old version and leaves everything else alone', () => {
    const s = med({ pauses: [{ from: at(2026, 10, 1).toISOString(), to: at(2026, 10, 2).toISOString() }] });
    expect(changeTimes(s, 'twice-daily', ['20:00', '08:00', '08:00'], nov12(10)).timesHistory).toBeUndefined();
    const edited = changeTimes(s, 'twice-daily', ['09:00', '20:00'], nov12(10));
    expect(edited).toMatchObject({
      startDate: s.startDate,
      pauses: s.pauses,
      scheduleTimes: ['09:00', '20:00'],
      timesHistory: [{ frequency: 'twice-daily', scheduleTimes: ['08:00', '20:00'], until: nov12(10).toISOString() }],
    });
  });
});

describe('pausing and resuming', () => {
  it('keeps earlier adherence after a resume and skips only the paused doses', () => {
    // Mornings taken, evenings missed, paused Nov 9 at 07:00, resumed Nov 11 at 18:00
    const records = [
      ...everyDayBefore(at(2026, 11, 9), 30, ['08:00']),
      dose(at(2026, 11, 11), '20:00'),
      dose(NOV12, '08:00'),
    ];
    const s = med();
    const resumed = resumeSchedule(pauseSchedule(s, at(2026, 11, 9, 7)), at(2026, 11, 11, 18));
    expect(resumed.startDate).toBe(s.startDate);
    expect(resumed.pausedAt).toBeUndefined();
    expect(resumed.pauses).toEqual([
      { from: at(2026, 11, 9, 7).toISOString(), to: at(2026, 11, 11, 18).toISOString() },
    ]);
    // From Oct 14 to Nov 8, 26 mornings taken and 26 evenings missed. Then Nov 11 20:00 and Nov 12 08:00.
    expect(adherenceFor(resumed, records, 30, nov12(12))).toMatchObject({ expected: 54, taken: 28, missed: 26 });
    // The dose that fell due during the pause is not overdue after the resume
    expect(states(dosesForDay([resumed], [], at(2026, 11, 11, 18, 5)))).toEqual([
      ['08:00', 'untracked'],
      ['20:00', 'upcoming'],
    ]);
  });

  it('reports a paused medication’s doses up to the pause', () => {
    const records = everyDayBefore(at(2026, 11, 11), 30, ['08:00']).filter(
      r => !r.scheduledTime.startsWith('2026-11-01'),
    );
    const paused = pauseSchedule(med({ frequency: 'daily', scheduleTimes: ['08:00'] }), at(2026, 11, 11, 7));
    expect(adherenceFor(paused, records, 30, nov12(12))).toMatchObject({ expected: 28, taken: 27, percent: 96 });
    expect(dosesForDay([paused], records, nov12(12))).toEqual([]);
  });

  it('counts recorded doses from before the start date', () => {
    // An earlier build moved the start date to the resume time
    const reset = med({ frequency: 'daily', scheduleTimes: ['08:00'], startDate: nov12(8, 30).toISOString() });
    const records = everyDayBefore(NOV12, 26, ['08:00']);
    expect(adherenceFor(reset, records, 30, nov12(12))).toMatchObject({ expected: 26, taken: 26, percent: 100 });
  });

  it('resumes a medication paused by the old app from when it was paused', () => {
    const old = med({ isActive: false, updatedAt: at(2026, 11, 9, 7).toISOString() });
    expect(resumeSchedule(old, at(2026, 11, 11, 18))).toMatchObject({
      isActive: true,
      startDate: old.startDate,
      pauses: [{ from: at(2026, 11, 9, 7).toISOString(), to: at(2026, 11, 11, 18).toISOString() }],
    });
  });
});

describe('daily checklist around midnight', () => {
  const quetiapine = med({ medicationName: 'Quetiapine', frequency: 'daily', scheduleTimes: ['23:00'] });

  it('still offers last night’s dose until its window closes', () => {
    expect(keys(checklistDoses([quetiapine], [], nov12(0, 10)))).toEqual([
      ['2026-11-11T23:00', 'due'],
      ['2026-11-12T23:00', 'upcoming'],
    ]);
    expect(keys(checklistDoses([quetiapine], [], nov12(1, 10)))).toEqual([['2026-11-12T23:00', 'upcoming']]);
    // The plain day view is unchanged
    expect(keys(dosesForDay([quetiapine], [], nov12(0, 10)))).toEqual([['2026-11-12T23:00', 'upcoming']]);
  });

  it('keeps a dose checked off just before midnight visible as taken', () => {
    const taken = [dose(at(2026, 11, 11), '23:00')];
    expect(keys(checklistDoses([quetiapine], taken, nov12(0, 30)))[0]).toEqual(['2026-11-11T23:00', 'taken']);
  });

  it('offers a dose due just after midnight from an hour before', () => {
    const late = med({ frequency: 'daily', scheduleTimes: ['00:30'] });
    expect(keys(checklistDoses([late], [], at(2026, 11, 11, 23, 45)))).toEqual([
      ['2026-11-11T00:30', 'overdue'],
      ['2026-11-12T00:30', 'due'],
    ]);
    expect(keys(checklistDoses([late], [], at(2026, 11, 11, 23, 15)))).toEqual([['2026-11-11T00:30', 'overdue']]);
  });

  it('does not carry over doses from before the start or during a pause', () => {
    const addedTonight = { ...quetiapine, startDate: nov12(0, 5).toISOString() };
    expect(keys(checklistDoses([addedTonight], [], nov12(0, 10)))).toEqual([['2026-11-12T23:00', 'upcoming']]);
    const resumed = resumeSchedule(pauseSchedule(quetiapine, at(2026, 11, 11, 22)), nov12(0, 5));
    expect(keys(checklistDoses([resumed], [], nov12(0, 10)))).toEqual([['2026-11-12T23:00', 'upcoming']]);
  });
});

describe('doses due before a medication was added', () => {
  it('are not shown as due or overdue', () => {
    const added = (h: number, min = 0) => med({ startDate: nov12(h, min).toISOString() });
    expect(states(dosesForDay([added(15)], [], nov12(15)))).toEqual([
      ['08:00', 'untracked'],
      ['20:00', 'upcoming'],
    ]);
    expect(states(dosesForDay([added(10, 1)], [], nov12(10, 1)))[0]).toEqual(['08:00', 'untracked']);
    expect(states(dosesForDay([added(8, 30)], [], nov12(8, 30)))[0]).toEqual(['08:00', 'untracked']);
  });
});

describe('schedules from the old app', () => {
  it('start tracking at the upgrade and keep when they were created or paused', () => {
    const created = at(2025, 9, 2, 10, 15).toISOString();
    const old = med({
      frequency: 'daily',
      scheduleTimes: ['08:00'],
      startDate: created,
      createdAt: created,
      updatedAt: created,
    });
    const upgraded = startTrackingAt(old, nov12(9));
    expect(upgraded).toMatchObject({ startDate: nov12(9).toISOString(), createdAt: created });
    expect(upgraded.pausedAt).toBeUndefined();
    expect(adherenceFor(upgraded, [], 30, nov12(9)).percent).toBeNull();
    expect(adherenceFor(upgraded, [], 90, at(2026, 11, 22, 12))).toMatchObject({ expected: 10, missed: 10 });

    const paused = startTrackingAt({ ...old, isActive: false, updatedAt: at(2026, 1, 5).toISOString() }, nov12(9));
    expect(paused.pausedAt).toBe(at(2026, 1, 5).toISOString());
    expect(adherenceFor(paused, [], 30, at(2026, 11, 22, 12)).percent).toBeNull();
  });
});

describe('time zones and clock changes', () => {
  // Clock change days in New York, Adelaide and Europe. In zones without a change they are ordinary days.
  const changeDays = [
    at(2026, 3, 8),
    at(2026, 3, 29),
    at(2026, 4, 5),
    at(2026, 10, 4),
    at(2026, 10, 25),
    at(2026, 11, 1),
  ];

  it.each(changeDays)('builds one slot per time and counts a full month around %s', changeDay => {
    const times = ['00:30', '02:30', '12:00', '23:30'];
    const s = med({ frequency: 'four-times', scheduleTimes: times, startDate: addDays(changeDay, -40).toISOString() });
    const now = new Date(changeDay.getFullYear(), changeDay.getMonth(), changeDay.getDate() + 3, 12);
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const records = [...everyDayBefore(day0, 35, times), dose(day0, '00:30'), dose(day0, '02:30')];
    expect(adherenceFor(s, records, 30, now)).toMatchObject({ expected: 29 * 4 + 2, taken: 29 * 4 + 2, percent: 100 });
    expect(keys(dosesForDay([s], records, now, changeDay))).toEqual(times.map(t => [dueKey(changeDay, t), 'taken']));
  });

  it.each(changeDays)('keeps a late dose open for two hours after its time, the night before %s', changeDay => {
    const s = med({ frequency: 'daily', scheduleTimes: ['23:30'], startDate: addDays(changeDay, -5).toISOString() });
    const eve = addDays(changeDay, -1);
    const key = dueKey(eve, '23:30');
    const due = dueKeyToDate(key).getTime();
    const carried = (t: number) => checklistDoses([s], [], new Date(t)).some(x => x.key === key);
    expect(carried(due + 2 * HOUR - 60_000)).toBe(true);
    expect(carried(due + 2 * HOUR)).toBe(false);
    // The dose counts as missed once its window has closed, and not before
    expect(adherenceFor(s, [], 2, new Date(due + 2 * HOUR - 60_000))).toMatchObject({ expected: 0 });
    expect(adherenceFor(s, [], 2, new Date(due + 2 * HOUR))).toMatchObject({ expected: 1, missed: 1 });
  });
});
