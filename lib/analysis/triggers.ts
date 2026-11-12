// lib/analysis/triggers.ts
//
// Possible trigger finder.
//
// Question asked for every (factor, symptom, delay window):
//   "Does this symptom start more often in the hours after this factor than in the
//    same hours of the day when the factor was not logged?"
//
// Method
//   1. Time is split into 15 minute bins over the days the person actually logged something.
//      Days with no logs at all are left out, so gaps in tracking never look like symptom free time.
//   2. For a factor and a delay window (say 12 to 24 hours), the "exposed" bins are those inside
//      that window after any occurrence of the factor.
//   3. Symptoms cluster by time of day, and so do habits. Coffee every morning makes "the hours after
//      coffee" the same as "daytime". To avoid that trap the comparison is stratified by hour of day:
//      under "no effect", a symptom starting at 3 pm is exposed with the same probability as any
//      tracked 3 pm bin. The observed exposed count is tested against that Poisson binomial
//      distribution exactly. A factor logged at the same time every day cannot be separated from
//      time of day, so it is not tested at all.
//   4. Many combinations are tested, so p values are corrected with Benjamini–Hochberg before
//      anything is shown. Only findings that survive correction and show a meaningful rise are kept.
//   5. For display, the same delay window is checked on nearby days (up to four weeks either side)
//      when the factor was not logged, giving a like for like "usual chance".
//
// These are associations in one person's own logs. They are not proof of cause.

import type { Factor, FactorCategory, Symptom } from '@/lib/db/schema';
import { benjaminiHochberg, poissonBinomialUpperTail } from './stats';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BIN = 15 * MINUTE;
const BINS_PER_HOUR = HOUR / BIN;
const BINS_PER_DAY = 24 * BINS_PER_HOUR;
/** How far either side of an exposure to look for comparison days. */
const MAX_SHIFT_DAYS = 28;
/** Symptom starts this close to a factor log are ambiguous about order and are ignored for that factor. */
const SIMULTANEOUS = 15 * MINUTE;

export interface DelayWindow {
  from: number; // hours after the factor
  to: number;
  label: string;
}

export const DEFAULT_WINDOWS: DelayWindow[] = [
  { from: 0, to: 3, label: 'within 3 hours' },
  { from: 3, to: 12, label: '3 to 12 hours later' },
  { from: 12, to: 24, label: '12 to 24 hours later' },
  { from: 24, to: 48, label: '1 to 2 days later' },
];

export type FindingStrength = 'strong' | 'moderate' | 'early';

export interface TriggerFinding {
  factor: string;
  category: FactorCategory;
  symptom: string;
  window: DelayWindow;
  /** Times the factor was logged (merged when within 2 hours) with the whole window in the past. */
  exposures: number;
  /** How many of those were followed by the symptom inside the window. */
  exposuresFollowed: number;
  /** Share of comparable windows (same hours, nearby days without the factor) that contained the symptom. */
  baselineChance: number;
  /** Number of comparable windows behind baselineChance. */
  comparisonWindows: number;
  /** Hour of day adjusted (Mantel–Haenszel) ratio of symptom start rates, exposed vs not. */
  relativeRate: number;
  symptomStartsInWindow: number;
  symptomStartsTotal: number;
  pValue: number;
  qValue: number;
  strength: FindingStrength;
}

export interface TriggerOptions {
  now?: Date;
  windows?: DelayWindow[];
  minExposures?: number;
  minSymptomStarts?: number;
  lookbackDays?: number;
  /** Maximum false discovery rate for a finding to be shown. */
  maxQ?: number;
  /** Minimum relative rate for a finding to be shown. */
  minRelativeRate?: number;
}

export interface TriggerAnalysis {
  findings: TriggerFinding[];
  testsRun: number;
  trackedDays: number;
  factorsEligible: number;
  symptomsEligible: number;
}

const key = (s: string) => s.trim().toLowerCase();

const localDayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Collapse repeats of the same thing logged close together. Input must be sorted. */
function mergeClose(sorted: number[], gapMs: number): number[] {
  const out: number[] = [];
  for (const t of sorted) {
    if (!out.length || t - out[out.length - 1] > gapMs) out.push(t);
  }
  return out;
}

/** True if any value in the sorted array is within `gap` of t. */
function hasNear(sorted: number[], t: number, gap: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t - gap) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo] <= t + gap;
}

function prefixSum(arr: Uint8Array): Int32Array {
  const p = new Int32Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i];
  return p;
}

interface WindowPrep {
  w: DelayWindow;
  covered: Uint8Array;
  exposedByHour: Int32Array;
  exposureStarts: number[];
  comparisons: number[];
  len: number;
}

export function findTriggers(symptoms: Symptom[], factors: Factor[], options: TriggerOptions = {}): TriggerAnalysis {
  const now = (options.now ?? new Date()).getTime();
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const minExposures = options.minExposures ?? 3;
  const minSymptomStarts = options.minSymptomStarts ?? 3;
  const lookbackMs = (options.lookbackDays ?? 180) * 24 * HOUR;
  const maxQ = options.maxQ ?? 0.1;
  const minRR = options.minRelativeRate ?? 1.5;

  const empty: TriggerAnalysis = { findings: [], testsRun: 0, trackedDays: 0, factorsEligible: 0, symptomsEligible: 0 };

  const startLimit = now - lookbackMs;
  const sx = symptoms
    .map(s => ({ name: s.name, t: Date.parse(s.timestamp) }))
    .filter(s => Number.isFinite(s.t) && s.t >= startLimit && s.t <= now);
  const fx = factors
    .map(f => ({ name: f.name, category: f.category, t: Date.parse(f.timestamp) }))
    .filter(f => Number.isFinite(f.t) && f.t >= startLimit && f.t <= now);
  if (!sx.length || !fx.length) return empty;

  // Active days: any local day with at least one log.
  const activeDays = new Set<string>();
  for (const e of [...sx, ...fx]) activeDays.add(localDayKey(new Date(e.t)));

  let minT = Infinity;
  for (const e of sx) minT = Math.min(minT, e.t);
  for (const e of fx) minT = Math.min(minT, e.t);
  const firstBin = Math.floor(minT / BIN);
  const nBins = Math.floor(now / BIN) - firstBin + 1;

  const active = new Uint8Array(nBins);
  const hourOf = new Uint8Array(nBins);
  const trackedByHour = new Int32Array(24);
  let activeCount = 0;
  // Local hour and tracked day only change on the hour, so compute them once per hour of bins.
  for (let i = 0; i < nBins;) {
    const d = new Date((firstBin + i) * BIN);
    const hour = d.getHours();
    const isActive = activeDays.has(localDayKey(d));
    // Bins until the next local hour. Zone offsets are multiples of 15 minutes, so local hour
    // boundaries always fall on bin edges, including in zones offset by 30 or 45 minutes.
    const binsToNextHour = Math.max(1, Math.round((60 - d.getMinutes()) / 15));
    const end = Math.min(nBins, i + binsToNextHour);
    for (; i < end; i++) {
      hourOf[i] = hour;
      if (isActive) {
        active[i] = 1;
        activeCount++;
        trackedByHour[hour]++;
      }
    }
  }
  if (activeCount < 72 * BINS_PER_HOUR) return { ...empty, trackedDays: activeDays.size };
  const activePrefix = prefixSum(active);

  const binOf = (t: number) => Math.floor(t / BIN) - firstBin;
  // Window edges round up, so a window never starts before the factor was logged.
  const edgeOf = (t: number) => Math.ceil(t / BIN) - firstBin;

  // Group symptoms by name, merging repeats within an hour.
  const symptomGroups = new Map<string, { name: string; times: number[] }>();
  for (const s of sx) {
    const g = symptomGroups.get(key(s.name)) ?? { name: s.name, times: [] };
    g.times.push(s.t);
    symptomGroups.set(key(s.name), g);
  }
  const symptomList = [...symptomGroups.values()]
    .map(g => ({
      name: g.name,
      times: mergeClose(
        g.times.sort((a, b) => a - b),
        HOUR,
      ).filter(t => active[binOf(t)]),
    }))
    .filter(g => g.times.length >= minSymptomStarts);

  // Group factors by name, merging repeats within two hours.
  const factorGroups = new Map<string, { name: string; category: FactorCategory; raw: number[] }>();
  for (const f of fx) {
    const g = factorGroups.get(key(f.name)) ?? { name: f.name, category: f.category, raw: [] };
    g.raw.push(f.t);
    factorGroups.set(key(f.name), g);
  }
  const factorList = [...factorGroups.values()]
    .map(g => {
      const raw = g.raw.sort((a, b) => a - b);
      return { ...g, raw, times: mergeClose(raw, 2 * HOUR) };
    })
    .filter(g => g.times.length >= minExposures);

  const base = {
    trackedDays: activeDays.size,
    factorsEligible: factorList.length,
    symptomsEligible: symptomList.length,
  };
  if (!symptomList.length || !factorList.length) return { ...empty, ...base };

  type Candidate = Omit<TriggerFinding, 'qValue' | 'strength'>;
  const tests: Candidate[] = [];
  const mark = new Uint8Array(nBins);
  const symptomBinsMask = new Uint8Array(nBins);

  for (const f of factorList) {
    const preps: WindowPrep[] = [];
    for (const w of windows) {
      const covered = new Uint8Array(nBins);
      for (const t of f.times) {
        const a = Math.max(0, edgeOf(t + w.from * HOUR));
        const b = Math.min(nBins, edgeOf(t + w.to * HOUR));
        for (let i = a; i < b; i++) covered[i] = 1;
      }
      const exposedByHour = new Int32Array(24);
      let exposedActive = 0;
      for (let i = 0; i < nBins; i++) {
        if (covered[i] && active[i]) {
          exposedByHour[hourOf[i]]++;
          exposedActive++;
        }
      }
      // Need hours of the day that are sometimes exposed and sometimes not. Otherwise exposure is
      // indistinguishable from time of day (a factor logged at the same time every day).
      let informative = false;
      for (let h = 0; h < 24; h++) if (exposedByHour[h] > 0 && exposedByHour[h] < trackedByHour[h]) informative = true;
      if (!informative || exposedActive < 6 * BINS_PER_HOUR) continue;

      const complete = f.times.filter(t => t + w.to * HOUR <= now);
      if (complete.length < minExposures) continue;

      // Matched comparison windows: the same clock window on nearby tracked days with no exposure.
      const len = (w.to - w.from) * BINS_PER_HOUR;
      const coveredPrefix = prefixSum(covered);
      const exposureStarts = complete.map(t => edgeOf(t + w.from * HOUR));
      const comparisons: number[] = [];
      mark.fill(0);
      for (const s0 of exposureStarts) {
        for (let k = -MAX_SHIFT_DAYS; k <= MAX_SHIFT_DAYS; k++) {
          if (k === 0) continue;
          const s = s0 + k * BINS_PER_DAY;
          if (s < 0 || s + len > nBins || mark[s]) continue;
          if (activePrefix[s + len] - activePrefix[s] !== len) continue;
          if (coveredPrefix[s + len] - coveredPrefix[s] !== 0) continue;
          mark[s] = 1;
          comparisons.push(s);
        }
      }
      if (comparisons.length < 5) continue;
      preps.push({ w, covered, exposedByHour, exposureStarts, comparisons, len });
    }
    if (!preps.length) continue;

    for (const s of symptomList) {
      const times = s.times.filter(t => !hasNear(f.raw, t, SIMULTANEOUS));
      if (times.length < minSymptomStarts) continue;
      const bins = times.map(binOf);
      symptomBinsMask.fill(0);
      for (const b of bins) symptomBinsMask[b] = 1;
      const symPrefix = prefixSum(symptomBinsMask);
      const hasSymptom = (a: number, len: number) => {
        const lo = Math.max(0, a);
        const hi = Math.min(nBins, a + len);
        return hi > lo && symPrefix[hi] - symPrefix[lo] > 0;
      };

      for (const p of preps) {
        const probs: number[] = [];
        const exposedStarts = new Float64Array(24);
        const otherStarts = new Float64Array(24);
        let inWindow = 0;
        for (const b of bins) {
          const h = hourOf[b];
          probs.push(p.exposedByHour[h] / trackedByHour[h]);
          if (p.covered[b]) {
            inWindow++;
            exposedStarts[h]++;
          } else {
            otherStarts[h]++;
          }
        }
        const pValue = poissonBinomialUpperTail(probs, inWindow);

        // Mantel–Haenszel rate ratio across hour of day strata
        let num = 0;
        let den = 0;
        for (let h = 0; h < 24; h++) {
          const T = trackedByHour[h];
          if (!T) continue;
          const E = p.exposedByHour[h];
          num += (exposedStarts[h] * (T - E)) / T;
          den += (otherStarts[h] * E) / T;
        }
        const relativeRate = den === 0 ? (num > 0 ? Infinity : 0) : num / den;

        let followed = 0;
        for (const a of p.exposureStarts) if (hasSymptom(a, p.len)) followed++;
        let baseHits = 0;
        for (const a of p.comparisons) if (hasSymptom(a, p.len)) baseHits++;

        tests.push({
          factor: f.name,
          category: f.category,
          symptom: s.name,
          window: p.w,
          exposures: p.exposureStarts.length,
          exposuresFollowed: followed,
          baselineChance: baseHits / p.comparisons.length,
          comparisonWindows: p.comparisons.length,
          relativeRate,
          symptomStartsInWindow: inWindow,
          symptomStartsTotal: times.length,
          pValue,
        });
      }
    }
  }

  const q = benjaminiHochberg(tests.map(t => t.pValue));
  const findings: TriggerFinding[] = [];
  tests.forEach((t, i) => {
    const qValue = q[i];
    if (qValue > maxQ || t.relativeRate < minRR || t.exposuresFollowed < 3) return;
    if (t.exposuresFollowed / t.exposures <= t.baselineChance) return;
    const strength: FindingStrength =
      qValue < 0.01 && t.exposuresFollowed >= 5 ? 'strong' : qValue < 0.05 ? 'moderate' : 'early';
    findings.push({ ...t, qValue, strength });
  });

  // Keep only the clearest delay window for each factor and symptom pair.
  const best = new Map<string, TriggerFinding>();
  for (const f of findings) {
    const k = `${key(f.factor)}|${key(f.symptom)}`;
    const cur = best.get(k);
    if (!cur || f.pValue < cur.pValue) best.set(k, f);
  }
  const rank = { strong: 0, moderate: 1, early: 2 } as const;
  const sorted = [...best.values()].sort((a, b) => rank[a.strength] - rank[b.strength] || a.qValue - b.qValue);

  return { findings: sorted, testsRun: tests.length, ...base };
}

/** One plain sentence describing a finding. */
export function describeFinding(f: TriggerFinding): string {
  return `${f.symptom} followed ${f.factor.toLowerCase()} ${f.window.label} ${f.exposuresFollowed} of ${f.exposures} times.`;
}

export function describeBaseline(f: TriggerFinding): string {
  const pct = Math.round(f.baselineChance * 100);
  return `On nearby days without ${f.factor.toLowerCase()}, the same hours included ${f.symptom.toLowerCase()} ${pct}% of the time.`;
}
