// lib/analysis/patterns.ts
// Descriptive patterns. These summarise what was logged; they make no causal claim.
// Each pattern is shown only when an exact test says it would rarely turn up by chance. On logs
// where nothing really differs, each kind of pattern appears in about 5% of cases or fewer.
import type { Factor, Symptom } from '@/lib/db/schema';
import { benjaminiHochberg, binomialUpperTail, mean } from './stats';
import { fisherExactTwoSided, hypergeometricUpperTail, permutationTestTwoSided } from './exact';

const DAY = 86_400_000;

/**
 * Chance level for each kind of pattern. A kind that can make two claims gives each half of it, and
 * a kind that can name several symptoms controls the false discovery rate across them at this level.
 */
const ALPHA = 0.05;

export interface PatternInsight {
  id: string;
  kind: 'time-of-day' | 'weekday' | 'trend' | 'together';
  title: string;
  detail: string;
}

export interface Readiness {
  trackedDays: number;
  symptomCount: number;
  factorCount: number;
  stage: 'empty' | 'starting' | 'collecting' | 'ready';
  message: string;
}

export const RECOMMENDED_DAYS = 14;

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lower = (s: string) => s.toLowerCase();
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function getReadiness(symptoms: Symptom[], factors: Factor[], now = new Date()): Readiness {
  const cutoff = now.getTime() - 90 * DAY;
  const days = new Set<string>();
  for (const e of [...symptoms, ...factors]) {
    const t = Date.parse(e.timestamp);
    if (t >= cutoff) days.add(dayKey(new Date(t)));
  }
  const trackedDays = days.size;
  const symptomCount = symptoms.length;
  const factorCount = factors.length;

  if (!symptomCount && !factorCount) {
    return {
      trackedDays,
      symptomCount,
      factorCount,
      stage: 'empty',
      message: 'Log your first symptom to get started.',
    };
  }
  if (trackedDays < 3) {
    return {
      trackedDays,
      symptomCount,
      factorCount,
      stage: 'starting',
      message: 'Keep logging for a few days. Patterns start to appear after about a week.',
    };
  }
  if (trackedDays < RECOMMENDED_DAYS || factorCount < 10) {
    const needs: string[] = [];
    if (trackedDays < RECOMMENDED_DAYS) needs.push(`${RECOMMENDED_DAYS - trackedDays} more days of logging`);
    if (factorCount < 10) needs.push('more food, drink and activity logs');
    return {
      trackedDays,
      symptomCount,
      factorCount,
      stage: 'collecting',
      message: `Trigger finding gets reliable with ${needs.join(' and ')}.`,
    };
  }
  return {
    trackedDays,
    symptomCount,
    factorCount,
    stage: 'ready',
    message: 'You have enough data for trigger finding. Results sharpen as you keep logging.',
  };
}

type Period = 'night' | 'morning' | 'afternoon' | 'evening';
const periodOf = (hour: number): Period =>
  hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'night';
const during = (p: Period) => (p === 'night' ? 'at night' : `in the ${p}`);

interface SymptomDays {
  name: string;
  days: Set<string>;
}

/** Days with any log in the last 60 days, and the days each symptom was logged on. */
interface LoggedDays {
  tracked: Set<string>;
  bySymptom: SymptomDays[];
}

function lastSixtyDays(symptoms: Symptom[], factors: Factor[], now: Date): LoggedDays {
  // Whole calendar days, today and the 59 before it, so the first day is never only partly counted
  // and the counts shown can never add up to more than 60 days. Logs dated after now are left out.
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 59).getTime();
  const inWindow = (t: number) => t >= from && t <= now.getTime();
  const tracked = new Set<string>();
  const bySymptom = new Map<string, SymptomDays>();
  for (const f of factors) {
    const t = Date.parse(f.timestamp);
    if (inWindow(t)) tracked.add(dayKey(new Date(t)));
  }
  for (const s of symptoms) {
    const t = Date.parse(s.timestamp);
    if (!inWindow(t)) continue;
    const k = dayKey(new Date(t));
    tracked.add(k);
    const g = bySymptom.get(lower(s.name)) ?? { name: s.name, days: new Set<string>() };
    g.days.add(k);
    bySymptom.set(lower(s.name), g);
  }
  return { tracked, bySymptom: [...bySymptom.values()] };
}

function timeOfDay(symptoms: Symptom[]): PatternInsight[] {
  // Each symptom counts at most one start per part of each day, so logging a symptom again while it
  // lasts does not count twice. A night that runs past midnight belongs to the day it began.
  const groups = new Map<string, { name: string; starts: Set<string> }>();
  for (const s of symptoms) {
    const d = new Date(s.timestamp);
    const h = d.getHours();
    if (Number.isNaN(h)) continue;
    const day = dayKey(h < 5 ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1) : d);
    const g = groups.get(lower(s.name)) ?? { name: s.name, starts: new Set<string>() };
    g.starts.add(`${day}|${periodOf(h)}`);
    groups.set(lower(s.name), g);
  }
  const tested = [...groups.values()]
    .filter(g => g.starts.size >= 8)
    .map(g => {
      const counts: Record<Period, number> = { night: 0, morning: 0, afternoon: 0, evening: 0 };
      for (const k of g.starts) counts[k.slice(k.indexOf('|') + 1) as Period]++;
      const [period, count] = (Object.entries(counts) as [Period, number][]).sort((a, b) => b[1] - a[1])[0];
      const n = g.starts.size;
      // With no usual time, the morning, afternoon and evening would each get about a third of the
      // starts, and the night, when most people sleep, fewer. So this is about the chance that some
      // part of the day gets `count` or more by chance alone.
      const p = Math.min(1, 3 * binomialUpperTail(count, n, 1 / 3));
      return { name: g.name, period, count, n, p };
    });
  const q = benjaminiHochberg(tested.map(t => t.p));
  return tested
    .filter((t, i) => t.count * 2 > t.n && q[i] <= ALPHA)
    .map(t => ({
      id: `tod-${lower(t.name)}`,
      kind: 'time-of-day',
      title: `${t.name} usually starts ${during(t.period)}`,
      detail: `It began ${during(t.period)} ${plural(t.count, 'time')} out of ${t.n}.`,
    }));
}

function weekday({ tracked, bySymptom }: LoggedDays): PatternInsight[] {
  const weekend: string[] = [];
  const weekdays: string[] = [];
  for (const k of tracked) ([0, 6].includes(new Date(`${k}T12:00:00`).getDay()) ? weekend : weekdays).push(k);
  if (weekend.length < 4 || weekdays.length < 10) return [];

  const withSymptoms = (d: string) => bySymptom.some(g => g.days.has(d));
  const we = weekend.filter(withSymptoms).length;
  const wd = weekdays.filter(withSymptoms).length;
  const weShare = we / weekend.length;
  const wdShare = wd / weekdays.length;
  if (Math.abs(weShare - wdShare) < 0.25) return [];
  // Two sided, because a difference either way would be reported.
  if (fisherExactTwoSided(we, weekend.length - we, wd, weekdays.length - wd) >= ALPHA) return [];
  const worse = weShare > wdShare ? 'weekends' : 'weekdays';
  return [
    {
      id: 'weekday',
      kind: 'weekday',
      title: `Symptoms show up more on ${worse}`,
      detail: `In the last 60 days you logged symptoms on ${wd} of ${weekdays.length} tracked weekdays (${pct(wdShare)}) and ${we} of ${weekend.length} tracked weekend days (${pct(weShare)}).`,
    },
  ];
}

function trend(symptoms: Symptom[], factors: Factor[], now: Date): PatternInsight[] {
  // Compare whole calendar days, the last 14 including today against the 14 before them. Days are
  // the unit, so several logs on one bad day count once.
  const fortnight = (back: number) =>
    new Set(
      Array.from({ length: 14 }, (_, i) =>
        dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back - i)),
      ),
    );
  const halves = [fortnight(0), fortnight(14)].map(keys => ({
    keys,
    tracked: new Set<string>(),
    /** Worst severity on each day with a symptom, the same measure as the daily chart. */
    worst: new Map<string, number>(),
  }));
  const [recent, prior] = halves;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27).getTime();
  const place = (timestamp: string) => {
    const t = Date.parse(timestamp);
    if (!(t >= from && t <= now.getTime())) return null;
    const k = dayKey(new Date(t));
    const half = halves.find(x => x.keys.has(k));
    if (half) half.tracked.add(k);
    return half ? { half, k } : null;
  };
  for (const f of factors) place(f.timestamp);
  for (const s of symptoms) {
    const at = place(s.timestamp);
    if (at) at.half.worst.set(at.k, Math.max(at.half.worst.get(at.k) ?? 0, s.severity));
  }
  if (recent.tracked.size < 7 || prior.tracked.size < 7) return [];
  const out: PatternInsight[] = [];

  // Share of tracked days with any symptom, tested with a two sided Fisher exact test.
  const r = recent.worst.size;
  const rDays = recent.tracked.size;
  const p = prior.worst.size;
  const pDays = prior.tracked.size;
  const rShare = r / rDays;
  const pShare = p / pDays;
  const bigChange = pShare === 0 ? rShare > 0 : Math.abs(rShare - pShare) / pShare >= 0.3;
  if (bigChange && fisherExactTwoSided(r, rDays - r, p, pDays - p) < ALPHA / 2) {
    out.push({
      id: 'trend-frequency',
      kind: 'trend',
      title: rShare < pShare ? 'Fewer symptoms in the last two weeks' : 'More symptoms in the last two weeks',
      detail: `You logged symptoms on ${r} of ${rDays} tracked days in the last two weeks, compared with ${p} of ${pDays} in the two weeks before.`,
    });
  }

  // Worst severity on days with symptoms, tested with an exact two sided permutation test.
  const rVals = [...recent.worst.values()];
  const pVals = [...prior.worst.values()];
  if (rVals.length >= 5 && pVals.length >= 5) {
    const rSev = mean(rVals);
    const pSev = mean(pVals);
    if (Math.abs(rSev - pSev) >= 1 && permutationTestTwoSided(rVals, pVals) < ALPHA / 2) {
      out.push({
        id: 'trend-severity',
        kind: 'trend',
        title: rSev < pSev ? 'Symptoms have been milder lately' : 'Symptoms have been more severe lately',
        detail: `On days with symptoms, the worst severity averaged ${rSev.toFixed(1)} out of 10 in the last two weeks, compared with ${pSev.toFixed(1)} in the two weeks before.`,
      });
    }
  }
  return out;
}

function together(logged: LoggedDays): PatternInsight[] {
  const tracked = logged.tracked.size;
  const list = logged.bySymptom.filter(g => g.days.size >= 3);
  const pairs: { rare: SymptomDays; common: SymptomDays; both: number; p: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [rare, common] = list[i].days.size <= list[j].days.size ? [list[i], list[j]] : [list[j], list[i]];
      const both = [...rare.days].filter(d => common.days.has(d)).length;
      // Chance of this much overlap or more if the two came and went independently of each other.
      // A symptom logged on most days overlaps with everything, and this accounts for that.
      const p = hypergeometricUpperTail(both, tracked, common.days.size, rare.days.size);
      pairs.push({ rare, common, both, p });
    }
  }
  // Every pair counts as a comparison, so having many symptoms does not make chance pairs likely.
  const q = benjaminiHochberg(pairs.map(x => x.p));
  return pairs
    .filter((x, i) => x.both >= 3 && q[i] <= ALPHA)
    .sort((a, b) => a.p - b.p || b.both - a.both)
    .slice(0, 3)
    .map(({ rare, common, both }) => {
      const otherDays = tracked - rare.days.size;
      const commonOnly = common.days.size - both;
      return {
        id: `together-${lower(rare.name)}-${lower(common.name)}`,
        kind: 'together',
        title: `${rare.name} and ${lower(common.name)} tend to happen on the same day`,
        detail: `${common.name} was logged on ${both} of the ${rare.days.size} days with ${lower(rare.name)} (${pct(both / rare.days.size)}), compared with ${commonOnly} of ${otherDays} other tracked days (${pct(otherDays ? commonOnly / otherDays : 0)}).`,
      };
    });
}

export function getPatterns(symptoms: Symptom[], factors: Factor[], now = new Date()): PatternInsight[] {
  const logged = lastSixtyDays(symptoms, factors, now);
  return [...trend(symptoms, factors, now), ...timeOfDay(symptoms), ...weekday(logged), ...together(logged)];
}

export interface DailyPoint {
  date: string; // yyyy-MM-dd local
  label: string;
  count: number;
  maxSeverity: number | null;
  avgSeverity: number | null;
}

export function dailySeries(symptoms: Symptom[], days = 30, now = new Date()): DailyPoint[] {
  const map = new Map<string, number[]>();
  for (const s of symptoms) {
    const k = dayKey(new Date(s.timestamp));
    map.set(k, [...(map.get(k) ?? []), s.severity]);
  }
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = dayKey(d);
    const vals = map.get(k) ?? [];
    out.push({
      date: k,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      count: vals.length,
      maxSeverity: vals.length ? Math.max(...vals) : null,
      avgSeverity: vals.length ? Number(mean(vals).toFixed(1)) : null,
    });
  }
  return out;
}

export interface SymptomSummary {
  name: string;
  count: number;
  /** Mean of the logged ratings. Use it only where the text says it is an average. */
  avgSeverity: number;
  /**
   * Middle logged rating (the higher of the two middle ones when the count is even), so it is
   * always a level the person actually chose. Use it for "typical" or "usually".
   */
  typicalSeverity: number;
  maxSeverity: number;
  days: number;
}

export function summarizeSymptoms(symptoms: Symptom[]): SymptomSummary[] {
  const groups = new Map<string, Symptom[]>();
  for (const s of symptoms) groups.set(lower(s.name), [...(groups.get(lower(s.name)) ?? []), s]);
  return [...groups.values()]
    .map(list => {
      const sevs = list.map(s => s.severity).sort((a, b) => a - b);
      return {
        name: list[0].name,
        count: list.length,
        avgSeverity: Number(mean(sevs).toFixed(1)),
        typicalSeverity: sevs[Math.floor(sevs.length / 2)],
        maxSeverity: Math.max(...sevs),
        days: new Set(list.map(s => dayKey(new Date(s.timestamp)))).size,
      };
    })
    .sort((a, b) => b.count - a.count);
}
