// Every way of looking at doses agrees after any mix of edits, including edits made in the hour
// before or after midnight that move a bedtime dose past it. The cases are random but the same on
// every run.
import { adherenceFor, changeTimes, dosesForDay, dueKey, recentDoses } from '@/lib/medication/doses';
import type { Frequency, MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const TIMES = ['00:00', '00:30', '02:30', '06:00', '08:00', '12:00', '18:00', '20:00', '22:00', '23:00', '23:59'];
const EVENING = ['20:00', '22:00', '23:00', '23:59'];
const NIGHT = ['00:30', '01:00', '02:30', '04:00'];
const FREQUENCIES: Frequency[] = ['daily', 'twice-daily', 'three-times'];
// Around clock changes in New York, Europe, Chile, Australia, Lord Howe and Chatham
const STARTS = [at(2026, 10, 1, 7), at(2026, 10, 20, 7), at(2026, 2, 25, 7), at(2026, 3, 20, 7), at(2026, 9, 20, 7)];

function cases(count: number) {
  let seed = 20261112;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const times = (n: number, from: string[]) => Array.from({ length: n }, () => pick(from));
  return Array.from({ length: count }, () => {
    const start = pick(STARTS);
    const bedtime = rand() < 0.5;
    let s: MedicationSchedule = {
      id: 'q1',
      medicationName: 'Quetiapine',
      dosage: '',
      frequency: 'twice-daily',
      scheduleTimes: [pick(TIMES), pick(bedtime ? EVENING : TIMES)],
      isActive: true,
      startDate: start.toISOString(),
      createdAt: start.toISOString(),
      updatedAt: start.toISOString(),
    };
    // Up to four edits at any time of day, or in the hour before or after midnight
    const edits = Array.from({ length: Math.floor(rand() * 5) }, () => {
      const midnight = addDays(start, 2 + Math.floor(rand() * 18));
      const hours = bedtime ? rand() * 2 - 1 : rand() * 24;
      return new Date(midnight.getTime() + hours * 3_600_000);
    }).sort((a, b) => a.getTime() - b.getTime());
    for (const when of edits) {
      const n = 1 + Math.floor(rand() * 3);
      s = changeTimes(s, FREQUENCIES[n - 1], times(n, bedtime ? [...NIGHT, ...TIMES] : TIMES), when);
    }
    // Taken and skipped records at times from any version, and now and then at other times
    const recorded = new Set([...s.scheduleTimes, ...(s.timesHistory ?? []).flatMap(h => h.scheduleTimes)]);
    const records: MedicationAdherence[] = [];
    for (let d = 0; d < 21; d++) {
      if (rand() < 0.2) recorded.add(pick(TIMES));
      for (const t of recorded) {
        if (rand() < 0.4) continue;
        records.push({
          id: `r${records.length}`,
          scheduleId: 'q1',
          medicationName: 'Quetiapine',
          scheduledTime: dueKey(addDays(start, d), t),
          status: rand() < 0.8 ? 'taken' : 'skipped',
        });
      }
    }
    return { s, records, now: new Date(start.getTime() + (22 + rand() * 4) * 86_400_000) };
  });
}

describe('dose views', () => {
  it('show every record once and agree with adherence and the dose list', () => {
    let movedToNextDay = 0;
    for (const { s, records, now } of cases(300)) {
      const days = 20;
      const first = addDays(now, -(days - 1));
      const shown = new Map<string, number>();
      let expected = 0;
      let taken = 0;
      for (let i = 0; i < days; i++) {
        for (const slot of dosesForDay([s], records, now, addDays(first, i))) {
          if (slot.record) shown.set(slot.record.id, (shown.get(slot.record.id) ?? 0) + 1);
          if (slot.record && slot.record.scheduledTime.slice(0, 10) < slot.key.slice(0, 10)) movedToNextDay++;
          if (slot.record || slot.state === 'overdue') expected++;
          if (slot.record?.status === 'taken') taken++;
        }
      }
      // Records away from the edges of the window show exactly once
      const inside = records.filter(r => {
        const day = r.scheduledTime.slice(0, 10);
        return day > dueKey(addDays(first, 1), '').slice(0, 10) && day < dueKey(addDays(now, -1), '').slice(0, 10);
      });
      expect(inside.filter(r => shown.get(r.id) !== 1)).toEqual([]);
      expect([...shown.values()].filter(n => n > 1)).toEqual([]);
      expect(adherenceFor(s, records, days, now)).toMatchObject({ expected, taken });

      // The dose list has each dose of the last week that counts and has come due
      const listed = new Set(recentDoses(s, records, now).map(x => `${x.key}|${x.record?.id ?? ''}`));
      for (let i = 7; i >= 0; i--) {
        for (const slot of dosesForDay([s], records, now, addDays(now, -i))) {
          if ((slot.state === 'overdue' || slot.state === 'due') && slot.due.getTime() <= now.getTime()) {
            expect(listed).toContain(`${slot.key}|`);
          }
        }
      }
    }
    // The cases include many bedtime doses moved past midnight
    expect(movedToNextDay).toBeGreaterThan(20);
  });
});
