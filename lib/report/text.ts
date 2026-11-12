// lib/report/text.ts
// Wording for the doctor report. The report is in English, so dates are too, whatever the device language.
import type { TriggerAnalysis } from '@/lib/analysis/triggers';
import type { MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';
import { adherenceFor, dueKeyToDate, isSlotKey } from '@/lib/medication/doses';

const DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const DAY_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** Keeps "8:05 PM" on one line. Newer browsers put a narrow no-break space there, older ones a plain space. */
const keepTime = (s: string) => s.replace(/\s(AM|PM)$/, `${String.fromCharCode(0xa0)}$1`);

/** "Nov 12, 2026" */
export const fmtDate = (d: Date) => DATE.format(d);
/** "Nov 12" */
export const fmtDay = (d: Date) => DAY.format(d);
/** "Nov 12, 8:05 PM" */
export const fmtDayTime = (d: Date) => keepTime(DAY_TIME.format(d));

/** "8:05 PM" for a schedule time stored as "20:05". */
export function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? keepTime(TIME.format(new Date(2000, 0, 1, h, m))) : hhmm;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Oct 14 to Nov 12, 2026", "Dec 20, 2025 to Jan 18, 2026" or "Nov 12, 2026". */
export function fmtRange(a: Date, b: Date): string {
  if (sameDay(a, b)) return fmtDate(a);
  if (a.getFullYear() === b.getFullYear()) return `${fmtDay(a)} to ${fmtDate(b)}`;
  return `${fmtDate(a)} to ${fmtDate(b)}`;
}

/**
 * "Dairy", "Dairy and Gluten" or "Dairy, Gluten and Wine". Every name is listed, so a reader can tell
 * exactly what was and was not checked.
 */
export function nameList(names: string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface TriggerText {
  /** Shown instead of the table when nothing was found. */
  lead: string | null;
  /** What was compared. A negative result covers only these. */
  checked: string[];
  /** What could not be compared, so is not ruled out, with the reason. */
  notChecked: string[];
}

/**
 * What the trigger analysis did and did not check, so that finding nothing is never read as ruling out
 * something that was not compared at all. The wording follows the Insights screen.
 */
export function triggerText(t: TriggerAnalysis): TriggerText {
  const notChecked: string[] = [];
  const add = (names: string[], one: string, many: string) => {
    if (names.length) notChecked.push(`${nameList(names)} ${names.length === 1 ? one : many}`);
  };
  const skipped = (...reasons: string[]) => t.factorsSkipped.filter(f => reasons.includes(f.reason)).map(f => f.name);
  add(
    skipped('daily', 'same-time'),
    'is logged every day or at the same time each day, so it cannot be told apart from the daily routine.',
    'are logged every day or at the same time each day, so they cannot be told apart from the daily routine.',
  );
  add(
    skipped('few'),
    'needs at least 3 logs before it can be checked.',
    'need at least 3 logs before they can be checked.',
  );
  if (t.symptomsEligible > 0) {
    add(
      skipped('no-symptom'),
      'was always logged at about the same time as a symptom, so it is not clear which came first.',
      'were always logged at about the same time as a symptom, so it is not clear which came first.',
    );
  }
  add(
    t.symptomsSkipped.filter(s => s.reason === 'few').map(s => s.name),
    'needs to be logged on at least 3 separate occasions before it can be checked.',
    'need to be logged on at least 3 separate occasions before they can be checked.',
  );
  // When some items could be checked, a symptom none of them was compared with was logged at about the
  // same time as each of them.
  if (t.testsRun > 0) {
    add(
      t.symptomsSkipped.filter(s => s.reason === 'no-factor').map(s => s.name),
      'was logged at about the same time as the items that could be checked, so it is not clear which came first.',
      'were logged at about the same time as the items that could be checked, so it is not clear which came first.',
    );
  }
  if (!t.symptomsTested.length && !t.symptomsSkipped.length) {
    notChecked.push('No symptoms were logged in the last six months.');
  }
  if (!t.factorsTested.length && !t.factorsSkipped.length) {
    notChecked.push('No food, drink, activity or medication was logged in the last six months.');
  }

  if (t.findings.length) {
    const found = new Set(t.findings.map(f => f.factor.trim().toLowerCase()));
    const others = t.factorsTested.filter(name => !found.has(name.trim().toLowerCase()));
    return {
      lead: null,
      checked: others.length
        ? [`${nameList(others)} ${others.length === 1 ? 'was' : 'were'} also checked, with no clear link to a symptom.`]
        : [],
      notChecked,
    };
  }
  if (t.trackedDays < 14) {
    return {
      lead: 'Not enough logging yet to look for triggers. About two weeks of symptoms plus food, drink and activity logs are needed.',
      checked: [],
      notChecked: [],
    };
  }
  if (!t.testsRun) {
    return { lead: 'No logged item could be checked for triggers yet, so none is ruled out.', checked: [], notChecked };
  }
  const items = t.factorsTested;
  const symptoms = t.symptomsTested;
  return {
    lead: 'No checked item was clearly followed by a rise in a checked symptom.',
    checked: [
      items.length === 1 ? `The item checked was ${items[0]}.` : `The items checked were ${nameList(items)}.`,
      symptoms.length === 1
        ? `The symptom checked was ${symptoms[0]}.`
        : `The symptoms checked were ${nameList(symptoms)}.`,
    ],
    notChecked,
  };
}

/** How the trigger analysis works, for a clinician. */
export function methodNote(testsRun: number): string {
  return `Method: for each item and delay, symptom starts in the window after the item were compared, with an exact test, with how many would fall there if each tracked day’s starts had happened at the same clock times on other tracked days. Only days with at least one symptom, food, drink or activity entry count as tracked. A symptom logged again within 6 hours, or within its logged duration plus an hour, counts as one episode. “Same hours, other days” is the usual chance of the symptom in the same hours on nearby days without the item, averaged over the times the item was logged. Results are corrected for the ${testsRun} ${testsRun === 1 ? 'comparison' : 'comparisons'} made (Benjamini–Hochberg). Medications taken for a symptom will naturally appear linked to it.`;
}

const time = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/**
 * The doses column of the medications table for the report period: taken of expected doses for a schedule,
 * or doses logged for an as-needed medication, with whatever explains the count. That is when tracking
 * started if it was during the period, pauses, and when the medication ended.
 */
export function doseSummary(
  m: MedicationSchedule,
  doses: MedicationAdherence[],
  days: number,
  from: Date,
  now: Date,
): string {
  const notes: string[] = [];
  const start = time(m.startDate);
  if (start > from.getTime() && start <= now.getTime()) notes.push(`tracked from ${fmtDate(new Date(start))}`);
  const pauses = (m.pauses ?? []).filter(p => time(p.to) > from.getTime() && time(p.from) <= now.getTime());
  if (pauses.length > 2) notes.push(`paused ${pauses.length} times`);
  else for (const p of pauses) notes.push(`paused ${fmtRange(new Date(time(p.from)), new Date(time(p.to)))}`);
  // Schedules paused by the old app have no pausedAt. They were last changed when they were paused.
  const pausedAt = time(m.pausedAt ?? m.updatedAt);
  if (!m.isActive) notes.push(Number.isNaN(pausedAt) ? 'paused' : `paused since ${fmtDate(new Date(pausedAt))}`);
  const end = time(m.endDate);
  if (end <= now.getTime()) notes.push(`ended ${fmtDate(new Date(end))}`);
  const withNotes = (text: string) => [text, ...notes].join(', ');

  if (m.frequency === 'as-needed') {
    const logged = doses.filter(d => {
      if (d.scheduleId !== m.id || d.status !== 'taken') return false;
      const t = d.takenTime
        ? time(d.takenTime)
        : isSlotKey(d.scheduledTime)
          ? dueKeyToDate(d.scheduledTime).getTime()
          : time(d.scheduledTime);
      return t >= from.getTime() && t <= now.getTime();
    }).length;
    return withNotes(logged === 0 ? 'None logged' : logged === 1 ? '1 dose logged' : `${logged} doses logged`);
  }
  const a = adherenceFor(m, doses, days, now);
  if (a.percent != null) return withNotes(`${a.taken} of ${a.expected} (${a.percent}%)`);
  // Nothing was due. A paused or ended medication says so, anything else has no doses due yet.
  if (!m.isActive || end <= now.getTime()) {
    const text = notes.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return withNotes('No doses due yet');
}
