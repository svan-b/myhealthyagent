// lib/medication/doses.ts
// Dose scheduling and adherence. Schedule times are local wall clock times, so a
// dose due at 08:00 stays at 08:00 when the person travels or clocks change.
import type { Factor, MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';

const pad = (n: number) => String(n).padStart(2, '0');

export const localDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "yyyy-MM-ddTHH:mm" for a local date and an "HH:mm" time. */
export const dueKey = (day: Date, time: string) => `${localDateKey(day)}T${time}`;

/** Parse a due key as local time. */
export function dueKeyToDate(key: string): Date {
  const [date, time = '00:00'] = key.slice(0, 16).split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

const normalizeKey = (key: string) => key.slice(0, 16);

export type DoseState = 'taken' | 'skipped' | 'due' | 'upcoming' | 'overdue';

export interface DoseSlot {
  schedule: MedicationSchedule;
  time: string;
  key: string;
  due: Date;
  record?: MedicationAdherence;
  state: DoseState;
}

function isScheduledOn(schedule: MedicationSchedule, day: Date): boolean {
  const start = new Date(schedule.startDate);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (day < startDay) return false;
  if (schedule.endDate) {
    const end = new Date(schedule.endDate);
    if (day > new Date(end.getFullYear(), end.getMonth(), end.getDate())) return false;
  }
  return true;
}

export function dosesForDay(
  schedules: MedicationSchedule[],
  records: MedicationAdherence[],
  now = new Date(),
  day = now,
): DoseSlot[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const byKey = new Map<string, MedicationAdherence>();
  for (const r of records) byKey.set(`${r.scheduleId}|${normalizeKey(r.scheduledTime)}`, r);

  const slots: DoseSlot[] = [];
  for (const schedule of schedules) {
    if (!schedule.isActive || schedule.frequency === 'as-needed') continue;
    if (!isScheduledOn(schedule, dayStart)) continue;
    for (const time of schedule.scheduleTimes) {
      const key = dueKey(dayStart, time);
      const due = dueKeyToDate(key);
      const record = byKey.get(`${schedule.id}|${key}`);
      let state: DoseState;
      if (record?.status === 'taken') state = 'taken';
      else if (record?.status === 'skipped') state = 'skipped';
      else {
        const diff = now.getTime() - due.getTime();
        state = diff < -60 * 60_000 ? 'upcoming' : diff > 2 * 60 * 60_000 ? 'overdue' : 'due';
      }
      slots.push({ schedule, time, key, due, record, state });
    }
  }
  return slots.sort(
    (a, b) => a.due.getTime() - b.due.getTime() || a.schedule.medicationName.localeCompare(b.schedule.medicationName),
  );
}

export interface Adherence {
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  /** 0 to 100, or null when nothing was due yet. */
  percent: number | null;
}

/** Adherence over the last `days` days for scheduled doses whose time has passed. */
export function adherenceFor(
  schedule: MedicationSchedule,
  records: MedicationAdherence[],
  days = 30,
  now = new Date(),
): Adherence {
  if (schedule.frequency === 'as-needed') return { expected: 0, taken: 0, skipped: 0, missed: 0, percent: null };
  const mine = new Map<string, MedicationAdherence>();
  for (const r of records) if (r.scheduleId === schedule.id) mine.set(normalizeKey(r.scheduledTime), r);

  const added = Date.parse(schedule.startDate);
  let expected = 0;
  let taken = 0;
  let skipped = 0;
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (!isScheduledOn(schedule, day)) continue;
    for (const time of schedule.scheduleTimes) {
      const key = dueKey(day, time);
      // Only count doses whose window has closed (2 hours after due) or that have a record.
      const rec = mine.get(key);
      const due = dueKeyToDate(key).getTime();
      if (!rec && due + 2 * 60 * 60_000 > now.getTime()) continue;
      // A dose due before the medication was added is not a missed dose.
      if (!rec && due < added) continue;
      expected++;
      if (rec?.status === 'taken') taken++;
      else if (rec?.status === 'skipped') skipped++;
    }
  }
  const missed = expected - taken - skipped;
  return { expected, taken, skipped, missed, percent: expected ? Math.round((taken / expected) * 100) : null };
}

/** Taken doses as medication factors, so the trigger finder can look for side effects. */
export function dosesAsFactors(records: MedicationAdherence[]): Factor[] {
  return records
    .filter(r => r.status === 'taken')
    .map(r => ({
      id: `dose-${r.id}`,
      name: r.medicationName,
      category: 'medication' as const,
      timestamp: r.takenTime ?? dueKeyToDate(r.scheduledTime).toISOString(),
    }))
    .filter(f => !Number.isNaN(Date.parse(f.timestamp)));
}
