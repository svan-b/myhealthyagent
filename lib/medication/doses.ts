// lib/medication/doses.ts
// Dose scheduling and adherence. Schedule times are local wall clock times, so a
// dose due at 08:00 stays at 08:00 when the person travels or clocks change.
//
// How a schedule changes over time
//
// A slot is one scheduled dose, a local time on a local day. Its key is "yyyy-MM-ddTHH:mm",
// and a dose record names its slot by that key.
//
// - startDate is when tracking started. It is set when the medication is added. For schedules
//   from the old app, which could not record doses, it is the time of the upgrade or restore.
//   Pausing, resuming and editing never move it.
// - While a medication is paused, pausedAt holds when the pause started. Resuming moves the
//   pause into `pauses` as { from, to }.
// - Editing the times or frequency keeps the old version in `timesHistory`, with `until` set to
//   the moment it was replaced. A day uses the version in effect at the end of that day, so an
//   edit applies from the day it was made and earlier days keep the times they had.
//
// Records are matched to the slots of their own day. A record goes to the slot with its key. A
// record whose time an edit removed goes to the nearest free slot that day whose time the edit
// added, so a dose taken before its time was moved still shows as taken.
//
// A slot with a record always counts. A slot with no record does not count, and is never shown as
// due or overdue, when it fell before startDate, during a pause, or at a time that was not in the
// schedule at that moment. Otherwise it counts as missed once its 2 hour window has closed.
import type { Factor, Frequency, MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';

const HOUR = 60 * 60_000;
/** A dose shows as due from an hour before its time. */
const DUE_FROM = HOUR;
/** Two hours after its time, a dose with no record is overdue and counts as missed. */
const MISSED_AFTER = 2 * HOUR;

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

const SLOT_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** Scheduled dose records name their slot by a local key. As-needed doses store an ISO time instead. */
export const isSlotKey = (scheduledTime: string) => SLOT_KEY.test(scheduledTime);

/** Sorted, unique "HH:mm" times. As-needed medications have none. */
export function normalizeTimes(frequency: Frequency, times: readonly string[] | undefined): string[] {
  if (frequency === 'as-needed' || !Array.isArray(times)) return [];
  return Array.from(new Set(times.filter(t => TIME.test(t)))).sort();
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** An ISO time in milliseconds, or `fallback` when it is missing or not a date. */
function ms(iso: string | undefined, fallback: number): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? fallback : t;
}

interface Version {
  frequency: Frequency;
  times: string[];
  /** In effect from this moment until `until`, in milliseconds. */
  from: number;
  until: number;
}

/** The schedule's versions, oldest first. The last one is the current schedule. */
function versionsOf(s: MedicationSchedule): Version[] {
  const past = (s.timesHistory ?? [])
    .map(h => ({
      frequency: h.frequency,
      times: normalizeTimes(h.frequency, h.scheduleTimes),
      until: ms(h.until, NaN),
    }))
    .filter(h => !Number.isNaN(h.until))
    .sort((a, b) => a.until - b.until);
  const versions: Version[] = [];
  let from = -Infinity;
  for (const h of past) {
    versions.push({ ...h, from });
    from = h.until;
  }
  versions.push({ frequency: s.frequency, times: normalizeTimes(s.frequency, s.scheduleTimes), from, until: Infinity });
  return versions;
}

const versionAt = (versions: Version[], t: number) => versions.find(v => t < v.until) ?? versions[versions.length - 1];

/** Whether the medication was paused at moment `t`. */
function isPausedAt(s: MedicationSchedule, t: number): boolean {
  // Schedules paused by the old app have no pausedAt. They were last changed when they were paused.
  if (!s.isActive && t >= ms(s.pausedAt ?? s.updatedAt, -Infinity)) return true;
  return (s.pauses ?? []).some(p => t >= ms(p.from, Infinity) && t < ms(p.to, -Infinity));
}

/** Whether a dose at `time`, due at moment `due`, was part of the schedule then. */
function inSchedule(s: MedicationSchedule, versions: Version[], time: string, due: number): boolean {
  if (due < ms(s.startDate, -Infinity) || isPausedAt(s, due)) return false;
  const v = versionAt(versions, due);
  return v.frequency !== 'as-needed' && v.times.includes(time);
}

interface Slot {
  time: string;
  key: string;
  due: Date;
  record?: MedicationAdherence;
  /** False when the dose fell before the start, during a pause or at a time not in the schedule then. */
  expected: boolean;
}

const statusRank = (r: MedicationAdherence) => (r.status === 'taken' ? 2 : r.status === 'skipped' ? 1 : 0);

/**
 * Attaches a day's records to its slots. A record goes to the slot with its key. A record whose
 * time is not a slot that day goes to the nearest free slot whose time was not in the schedule
 * while the record's time was, so it never lands on a dose that was due anyway.
 */
function attachRecords(slots: Slot[], records: MedicationAdherence[], dayVersions: Version[]) {
  // One record per key. If a restore left two for the same dose, a taken record wins.
  const byKey = new Map<string, MedicationAdherence>();
  for (const r of records) {
    const current = byKey.get(r.scheduledTime);
    if (!current || statusRank(r) > statusRank(current)) byKey.set(r.scheduledTime, r);
  }
  const leftover: MedicationAdherence[] = [];
  for (const [key, r] of byKey) {
    const slot = slots.find(x => x.key === key);
    if (slot) slot.record = r;
    else leftover.push(r);
  }
  const pairs: { r: MedicationAdherence; slot: Slot; distance: number }[] = [];
  for (const r of leftover) {
    const time = r.scheduledTime.slice(11);
    const at = dueKeyToDate(r.scheduledTime).getTime();
    // The latest version that day with the record's time. Without one (data saved before times
    // were kept) any free slot that day may take the record.
    const own = dayVersions.filter(v => v.times.includes(time)).pop();
    for (const slot of slots) {
      if (slot.record || own?.times.includes(slot.time)) continue;
      pairs.push({ r, slot, distance: Math.abs(slot.due.getTime() - at) });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const placed = new Set<MedicationAdherence>();
  for (const { r, slot } of pairs) {
    if (slot.record || placed.has(r)) continue;
    slot.record = r;
    placed.add(r);
  }
}

/** A schedule's slots on a local day, with that day's records attached. */
function slotsOn(s: MedicationSchedule, versions: Version[], day: Date, records: MedicationAdherence[]): Slot[] {
  const start = startOfDay(day).getTime();
  const end = addDays(day, 1).getTime();
  const slots: Slot[] = versionAt(versions, end - 1).times.map(time => {
    const key = dueKey(day, time);
    const due = dueKeyToDate(key);
    return { time, key, due, expected: inSchedule(s, versions, time, due.getTime()) };
  });
  attachRecords(
    slots,
    records,
    versions.filter(v => v.from < end && v.until > start),
  );
  return slots;
}

function isAfterEnd(s: MedicationSchedule, day: Date): boolean {
  const end = ms(s.endDate, NaN);
  return !Number.isNaN(end) && startOfDay(day) > startOfDay(new Date(end));
}

/** The checklist lists a schedule from the day tracking started until its end day. */
function isListedOn(s: MedicationSchedule, day: Date): boolean {
  const start = ms(s.startDate, NaN);
  if (!Number.isNaN(start) && startOfDay(day) < startOfDay(new Date(start))) return false;
  return !isAfterEnd(s, day);
}

/**
 * "untracked" means the dose fell before tracking started, during a pause or at a time that was
 * not in the schedule then. It can still be recorded, and it never counts as missed.
 */
export type DoseState = 'taken' | 'skipped' | 'due' | 'upcoming' | 'overdue' | 'untracked';

export interface DoseSlot {
  schedule: MedicationSchedule;
  time: string;
  key: string;
  due: Date;
  record?: MedicationAdherence;
  state: DoseState;
}

function stateOf(slot: Slot, now: Date): DoseState {
  if (slot.record?.status === 'taken') return 'taken';
  if (slot.record?.status === 'skipped') return 'skipped';
  if (!slot.record && !slot.expected) return 'untracked';
  const diff = now.getTime() - slot.due.getTime();
  return diff < -DUE_FROM ? 'upcoming' : diff >= MISSED_AFTER ? 'overdue' : 'due';
}

/** Doses of active scheduled medications on one local day (the day of `now` by default). */
export function dosesForDay(
  schedules: MedicationSchedule[],
  records: MedicationAdherence[],
  now = new Date(),
  day = now,
): DoseSlot[] {
  const dayKey = localDateKey(day);
  const slots: DoseSlot[] = [];
  for (const schedule of schedules) {
    if (!schedule.isActive || schedule.frequency === 'as-needed' || !isListedOn(schedule, day)) continue;
    const mine = records.filter(
      r => r.scheduleId === schedule.id && isSlotKey(r.scheduledTime) && r.scheduledTime.startsWith(dayKey),
    );
    for (const slot of slotsOn(schedule, versionsOf(schedule), day, mine)) {
      const { time, key, due, record } = slot;
      slots.push({ schedule, time, key, due, record, state: stateOf(slot, now) });
    }
  }
  return slots.sort(
    (a, b) => a.due.getTime() - b.due.getTime() || a.schedule.medicationName.localeCompare(b.schedule.medicationName),
  );
}

/**
 * The daily checklist. Today's doses, plus doses from last night or early tomorrow whose window is
 * open now (from an hour before their time until 2 hours after), so a dose due at 23:00 can still
 * be checked off at 00:30 and a dose due at 00:30 can be checked off at 23:45.
 */
export function checklistDoses(
  schedules: MedicationSchedule[],
  records: MedicationAdherence[],
  now = new Date(),
): DoseSlot[] {
  const t = now.getTime();
  const isOpen = (s: DoseSlot) =>
    s.state !== 'untracked' && t >= s.due.getTime() - DUE_FROM && t < s.due.getTime() + MISSED_AFTER;
  return [
    ...dosesForDay(schedules, records, now, addDays(now, -1)).filter(isOpen),
    ...dosesForDay(schedules, records, now),
    ...dosesForDay(schedules, records, now, addDays(now, 1)).filter(isOpen),
  ];
}

export interface Adherence {
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  /** 0 to 100, or null when nothing was due yet. */
  percent: number | null;
}

/**
 * Adherence over the last `days` local days, today included, for scheduled doses. A dose with a
 * record always counts. A dose with no record counts as missed once its 2 hour window has closed,
 * unless it fell before tracking started, during a pause or at a time not in the schedule then.
 * Paused medications get their counts up to the pause.
 */
export function adherenceFor(
  schedule: MedicationSchedule,
  records: MedicationAdherence[],
  days = 30,
  now = new Date(),
): Adherence {
  if (schedule.frequency === 'as-needed') return { expected: 0, taken: 0, skipped: 0, missed: 0, percent: null };
  const versions = versionsOf(schedule);
  const byDay = new Map<string, MedicationAdherence[]>();
  for (const r of records) {
    if (r.scheduleId !== schedule.id || !isSlotKey(r.scheduledTime)) continue;
    const dayKey = r.scheduledTime.slice(0, 10);
    const list = byDay.get(dayKey);
    if (list) list.push(r);
    else byDay.set(dayKey, [r]);
  }

  let expected = 0;
  let taken = 0;
  let skipped = 0;
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(now, -i);
    if (isAfterEnd(schedule, day)) continue;
    for (const slot of slotsOn(schedule, versions, day, byDay.get(localDateKey(day)) ?? [])) {
      if (!slot.record && (!slot.expected || slot.due.getTime() + MISSED_AFTER > now.getTime())) continue;
      expected++;
      if (slot.record?.status === 'taken') taken++;
      else if (slot.record?.status === 'skipped') skipped++;
    }
  }
  const missed = expected - taken - skipped;
  return { expected, taken, skipped, missed, percent: expected ? Math.round((taken / expected) * 100) : null };
}

/** The schedule after pausing it. */
export function pauseSchedule(s: MedicationSchedule, at = new Date()): MedicationSchedule {
  if (!s.isActive) return s;
  const iso = at.toISOString();
  return { ...s, isActive: false, pausedAt: iso, updatedAt: iso };
}

/** The schedule after resuming it. The pause is kept, so doses due during it never count as missed. */
export function resumeSchedule(s: MedicationSchedule, at = new Date()): MedicationSchedule {
  if (s.isActive) return s;
  const { pausedAt, ...rest } = s;
  // Schedules paused by the old app have no pausedAt. They were last changed when they were paused.
  const from = ms(pausedAt ?? s.updatedAt, NaN);
  const pauses = s.pauses ?? [];
  const iso = at.toISOString();
  return {
    ...rest,
    isActive: true,
    pauses: from < at.getTime() ? [...pauses, { from: new Date(from).toISOString(), to: iso }] : pauses,
    updatedAt: iso,
  };
}

/** The schedule with new times or frequency. The old version is kept so earlier days keep their times. */
export function changeTimes(
  s: MedicationSchedule,
  frequency: Frequency,
  times: readonly string[],
  at = new Date(),
): MedicationSchedule {
  const next = normalizeTimes(frequency, times);
  const previous = normalizeTimes(s.frequency, s.scheduleTimes);
  if (frequency === s.frequency && next.join() === previous.join()) return { ...s, scheduleTimes: next };
  return {
    ...s,
    frequency,
    scheduleTimes: next,
    timesHistory: [
      ...(s.timesHistory ?? []),
      { frequency: s.frequency, scheduleTimes: previous, until: at.toISOString() },
    ],
  };
}

/**
 * Moves the start of tracking to `at`, for a schedule from the old app, which could not record
 * doses. The time before then does not count as missed. A paused schedule keeps when it was paused.
 */
export function startTrackingAt(s: MedicationSchedule, at = new Date()): MedicationSchedule {
  const iso = at.toISOString();
  if (s.isActive || s.pausedAt) return { ...s, startDate: iso };
  // The old app last changed a paused schedule when it paused it.
  const paused = ms(s.updatedAt, NaN);
  return { ...s, startDate: iso, pausedAt: Number.isNaN(paused) ? iso : new Date(paused).toISOString() };
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
