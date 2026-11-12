// lib/analysis/patterns.ts
// Descriptive patterns. These summarise what was logged; they make no causal claim.
import type { Factor, Symptom } from '@/lib/db/schema';
import { mean } from './stats';

const DAY = 86_400_000;

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

function timeOfDay(symptoms: Symptom[]): PatternInsight[] {
  const out: PatternInsight[] = [];
  const groups = new Map<string, Symptom[]>();
  for (const s of symptoms) groups.set(lower(s.name), [...(groups.get(lower(s.name)) ?? []), s]);
  for (const list of groups.values()) {
    if (list.length < 8) continue;
    const buckets = { night: 0, morning: 0, afternoon: 0, evening: 0 };
    for (const s of list) {
      const h = new Date(s.timestamp).getHours();
      buckets[h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night']++;
    }
    const [period, count] = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
    if (count / list.length >= 0.5) {
      const name = list[0].name;
      out.push({
        id: `tod-${lower(name)}`,
        kind: 'time-of-day',
        title: `${name} usually starts in the ${period}`,
        detail: `${count} of ${list.length} logged ${lower(name)} entries began in the ${period}.`,
      });
    }
  }
  return out;
}

function weekday(symptoms: Symptom[], factors: Factor[], now: Date): PatternInsight[] {
  const cutoff = now.getTime() - 60 * DAY;
  const active = new Set<string>();
  for (const e of [...symptoms, ...factors]) {
    const t = Date.parse(e.timestamp);
    if (t >= cutoff) active.add(dayKey(new Date(t)));
  }
  const weekend = [...active].filter(k => [0, 6].includes(new Date(`${k}T12:00:00`).getDay()));
  const weekdays = [...active].filter(k => ![0, 6].includes(new Date(`${k}T12:00:00`).getDay()));
  if (weekend.length < 4 || weekdays.length < 10) return [];

  const sevByDay = new Map<string, number[]>();
  for (const s of symptoms) {
    const t = Date.parse(s.timestamp);
    if (t < cutoff) continue;
    const k = dayKey(new Date(t));
    sevByDay.set(k, [...(sevByDay.get(k) ?? []), s.severity]);
  }
  const share = (days: string[]) => days.filter(d => sevByDay.has(d)).length / days.length;
  const we = share(weekend);
  const wd = share(weekdays);
  if (Math.abs(we - wd) < 0.25) return [];
  const worse = we > wd ? 'weekends' : 'weekdays';
  return [
    {
      id: 'weekday',
      kind: 'weekday',
      title: `Symptoms show up more on ${worse}`,
      detail: `You logged symptoms on ${Math.round(wd * 100)}% of tracked weekdays and ${Math.round(we * 100)}% of tracked weekend days over the last 60 days.`,
    },
  ];
}

function trend(symptoms: Symptom[], factors: Factor[], now: Date): PatternInsight[] {
  const t0 = now.getTime();
  const inRange = (t: number, from: number, to: number) => t > t0 - from * DAY && t <= t0 - to * DAY;
  const activeDays = (from: number, to: number) => {
    const set = new Set<string>();
    for (const e of [...symptoms, ...factors]) {
      const t = Date.parse(e.timestamp);
      if (inRange(t, from, to)) set.add(dayKey(new Date(t)));
    }
    return set.size;
  };
  const recentDays = activeDays(14, 0);
  const priorDays = activeDays(28, 14);
  if (recentDays < 7 || priorDays < 7) return [];
  const recent = symptoms.filter(s => inRange(Date.parse(s.timestamp), 14, 0));
  const prior = symptoms.filter(s => inRange(Date.parse(s.timestamp), 28, 14));
  if (recent.length + prior.length < 10) return [];

  const rRate = recent.length / recentDays;
  const pRate = prior.length / priorDays;
  const rSev = mean(recent.map(s => s.severity));
  const pSev = mean(prior.map(s => s.severity));
  const out: PatternInsight[] = [];

  if (pRate > 0 && Math.abs(rRate - pRate) / pRate >= 0.3) {
    const better = rRate < pRate;
    out.push({
      id: 'trend-frequency',
      kind: 'trend',
      title: better ? 'Fewer symptoms in the last two weeks' : 'More symptoms in the last two weeks',
      detail: `${rRate.toFixed(1)} per tracked day recently, compared with ${pRate.toFixed(1)} in the two weeks before.`,
    });
  }
  if (recent.length >= 5 && prior.length >= 5 && Math.abs(rSev - pSev) >= 1) {
    const better = rSev < pSev;
    out.push({
      id: 'trend-severity',
      kind: 'trend',
      title: better ? 'Symptoms have been milder lately' : 'Symptoms have been more severe lately',
      detail: `Average severity ${rSev.toFixed(1)} out of 10 in the last two weeks, compared with ${pSev.toFixed(1)} before.`,
    });
  }
  return out;
}

function together(symptoms: Symptom[], now: Date): PatternInsight[] {
  const cutoff = now.getTime() - 60 * DAY;
  const daysBySymptom = new Map<string, { name: string; days: Set<string> }>();
  for (const s of symptoms) {
    const t = Date.parse(s.timestamp);
    if (t < cutoff) continue;
    const k = lower(s.name);
    const g = daysBySymptom.get(k) ?? { name: s.name, days: new Set<string>() };
    g.days.add(dayKey(new Date(t)));
    daysBySymptom.set(k, g);
  }
  const list = [...daysBySymptom.values()].filter(g => g.days.size >= 3);
  const out: PatternInsight[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const both = [...a.days].filter(d => b.days.has(d)).length;
      const smaller = Math.min(a.days.size, b.days.size);
      if (both >= 3 && both / smaller >= 0.6) {
        out.push({
          id: `together-${lower(a.name)}-${lower(b.name)}`,
          kind: 'together',
          title: `${a.name} and ${lower(b.name)} tend to happen on the same day`,
          detail: `They were both logged on ${plural(both, 'day')} out of ${smaller} days with the less frequent one.`,
        });
      }
    }
  }
  return out.slice(0, 3);
}

export function getPatterns(symptoms: Symptom[], factors: Factor[], now = new Date()): PatternInsight[] {
  return [
    ...trend(symptoms, factors, now),
    ...timeOfDay(symptoms),
    ...weekday(symptoms, factors, now),
    ...together(symptoms, now),
  ];
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
  avgSeverity: number;
  maxSeverity: number;
  days: number;
}

export function summarizeSymptoms(symptoms: Symptom[]): SymptomSummary[] {
  const groups = new Map<string, Symptom[]>();
  for (const s of symptoms) groups.set(lower(s.name), [...(groups.get(lower(s.name)) ?? []), s]);
  return [...groups.values()]
    .map(list => ({
      name: list[0].name,
      count: list.length,
      avgSeverity: Number(mean(list.map(s => s.severity)).toFixed(1)),
      maxSeverity: Math.max(...list.map(s => s.severity)),
      days: new Set(list.map(s => dayKey(new Date(s.timestamp)))).size,
    }))
    .sort((a, b) => b.count - a.count);
}
