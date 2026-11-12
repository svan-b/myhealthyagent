// lib/analysis/triggers.ts
//
// Possible trigger finder.
//
// Question asked for every (factor, symptom, delay window):
//   "Does this symptom start more often in the hours after this factor than in the
//    same hours of the day when the factor was not logged?"
//
// Method
//   1. Time is split into 15 minute bins over the days the person actually tracked, meaning days with
//      at least one symptom or Log tab entry. Days with no logs at all are left out, so gaps in tracking
//      never look like symptom free time. Doses ticked off on the Meds tab are tested like any other
//      factor, but a day with nothing else logged does not count as tracked.
//   2. Symptoms are counted by episode. Logging a symptom again while it is still there is not a new
//      start. A log only starts a new episode once the previous one is over, which is its logged
//      duration plus an hour, or 6 hours after the previous log when the duration is unknown or the
//      symptom was still going. So lying down or taking something because of a symptom, then logging
//      the symptom again, does not make it look as if the symptom followed.
//   3. For a factor and a delay window (say 12 to 24 hours), the "exposed" bins are those inside
//      that window after any occurrence of the factor.
//   4. Symptoms cluster by time of day, and so do habits. Coffee every morning makes "the hours after
//      coffee" the same as "daytime". To avoid that trap each day is compared with other days at the
//      same clock times. Under "no effect", the symptom starts of a day could just as well have
//      happened, at the same clock times, on any other tracked day. Starts on the same day move
//      together, so two episodes on one bad day are not treated as two independent chances. The
//      number of starts inside the window is tested exactly against that distribution. A factor logged
//      at the same time every day cannot be separated from time of day, so it is not tested at all.
//   5. Many combinations are tested, so p values are corrected with Benjamini–Hochberg before
//      anything is shown. Only findings that survive correction and show a meaningful rise are kept.
//   6. For display, "followed X of N times" counts only exposures whose whole window fell on tracked
//      days. The "usual chance" next to it checks the same hours on nearby tracked days without the
//      factor (up to four weeks either side), separately for each of those exposures, and averages
//      them, so both numbers describe the same exposures.
//
// These are associations in one person's own logs. They are not proof of cause.

import type { Factor, FactorCategory, Symptom } from '@/lib/db/schema';
import { benjaminiHochberg, clusteredUpperTail } from './stats';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BIN = 15 * MINUTE;
const BINS_PER_HOUR = HOUR / BIN;
const BINS_PER_DAY = 24 * BINS_PER_HOUR;
/** How far either side of an exposure to look for comparison days. */
const MAX_SHIFT_DAYS = 28;
/** Symptom starts this close to a factor log are ambiguous about order and are ignored for that factor. */
const SIMULTANEOUS = 15 * MINUTE;
/** A symptom logged again this soon after its previous log, with no duration known, is the same episode. */
const EPISODE_GAP = 6 * HOUR;
/** A symptom logged again this soon after its logged duration ended is the same episode. */
const EPISODE_GRACE = HOUR;
/** Longest logged duration taken at face value. */
const MAX_DURATION = 24 * HOUR;

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
  /**
   * Times the factor was logged (merged when within 2 hours) whose whole window is in the past and fell
   * on tracked days.
   */
  exposures: number;
  /** How many of those windows contained the start of a symptom episode. */
  exposuresFollowed: number;
  /**
   * Usual chance of a symptom start in the same hours on nearby tracked days without the factor. It is
   * worked out for each counted exposure on its own and then averaged, so it matches when the factor was
   * logged.
   */
  baselineChance: number;
  /** Number of distinct comparable windows (same hours, nearby tracked days without the factor). */
  comparisonWindows: number;
  /** Hour of day adjusted (Mantel–Haenszel) ratio of symptom start rates, exposed vs not. */
  relativeRate: number;
  /** Symptom episode starts inside the window, and in total. */
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
  /**
   * Factors that only count as exposures, such as doses ticked off on the Meds tab. They are tested like
   * any other factor, but they never make a day count as tracked. A pill ticked on a day with nothing
   * else logged says nothing about whether symptoms happened that day.
   */
  exposureOnly?: Factor[];
}

/**
 * Why a logged item was not compared with any symptom.
 * - few means fewer than 3 logs whose delay window has passed and fell on tracked days.
 * - same-time means logged at the same time on every tracked day, so it cannot be told apart from time of day.
 * - daily means logged on nearly every tracked day, so there are not enough nearby days without it.
 * - no-symptom means no symptom has 3 separate starts, apart from starts logged at the same time as it.
 */
export type FactorSkipReason = 'few' | 'same-time' | 'daily' | 'no-symptom';

/**
 * Why a symptom was not compared with any logged item.
 * - few means fewer than 3 separate episodes on tracked days.
 * - no-factor means no logged item could be compared with it.
 */
export type SymptomSkipReason = 'few' | 'no-factor';

export interface TriggerAnalysis {
  findings: TriggerFinding[];
  testsRun: number;
  trackedDays: number;
  factorsEligible: number;
  symptomsEligible: number;
  /** Logged items compared with at least one symptom, by name. Every other item is in factorsSkipped. */
  factorsTested: string[];
  /** Most logged first. `logs` counts logs in the period, merged when within 2 hours. */
  factorsSkipped: { name: string; category: FactorCategory; reason: FactorSkipReason; logs: number }[];
  /** Symptoms compared with at least one logged item, by name. Every other symptom is in symptomsSkipped. */
  symptomsTested: string[];
  /** Most episodes first. */
  symptomsSkipped: { name: string; reason: SymptomSkipReason; episodes: number }[];
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

/** How long a symptom log says it lasted, or null when that is unknown or it was still going. */
function loggedDuration(s: Symptom): number | null {
  const m = s.duration_minutes;
  return !s.ongoing && typeof m === 'number' && m > 0 ? Math.min(m * MINUTE, MAX_DURATION) : null;
}

/**
 * Start times of the episodes of one symptom, sorted. Each log extends the current episode, so a symptom
 * logged again and again while it lasts has one start. Gaps are measured from the previous log, not
 * from the first one.
 */
function episodeStarts(logs: { t: number; dur: number | null }[]): number[] {
  const sorted = [...logs].sort((a, b) => a.t - b.t);
  const out: number[] = [];
  let end = -Infinity;
  for (const l of sorted) {
    if (l.t > end) out.push(l.t);
    end = Math.max(end, l.t + (l.dur == null ? EPISODE_GAP : l.dur + EPISODE_GRACE));
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

/** True if any value in the sorted array is in [a, a + len). */
function hasIn(sorted: number[], a: number, len: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < a) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo] < a + len;
}

function prefixSum(arr: Uint8Array): Int32Array {
  const p = new Int32Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i];
  return p;
}

/** Number of set bits in a 32 bit integer. */
function bitCount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** What the usual chance of one test needs. Kept small, because it is only worked out for possible findings. */
interface BaselineInput {
  len: number;
  /** First bin of each counted exposure window (whole window in the past and tracked). */
  exposureStarts: number[];
  /** Comparable windows of each counted exposure, from matches[matchFrom[e]] up to matches[matchFrom[e + 1]]. */
  matchFrom: Int32Array;
  matches: Int32Array;
}

interface WindowPrep {
  w: DelayWindow;
  base: BaselineInput;
  covered: Uint8Array;
  exposedByHour: Int32Array;
  /** Distinct comparable windows found from all complete exposures. */
  comparisons: number;
  /** For each clock slot, the number of tracked days on which it was exposed. */
  coveredBySlot: Int32Array;
  /** For each clock slot, one bit per tracked day on which it was exposed (dayWords words per slot). */
  coveredDays: Int32Array;
}

const SKIP_RANK: Record<FactorSkipReason, number> = { few: 0, daily: 1, 'same-time': 2, 'no-symptom': 3 };

export function findTriggers(symptoms: Symptom[], factors: Factor[], options: TriggerOptions = {}): TriggerAnalysis {
  const now = (options.now ?? new Date()).getTime();
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const minExposures = options.minExposures ?? 3;
  const minSymptomStarts = options.minSymptomStarts ?? 3;
  const lookbackMs = (options.lookbackDays ?? 180) * 24 * HOUR;
  const maxQ = options.maxQ ?? 0.1;
  const minRR = options.minRelativeRate ?? 1.5;

  const startLimit = now - lookbackMs;
  const inRange = (t: number) => Number.isFinite(t) && t >= startLimit && t <= now;
  const sx = symptoms
    .map(s => ({ name: s.name, t: Date.parse(s.timestamp), dur: loggedDuration(s) }))
    .filter(s => inRange(s.t));
  const asExposure = (tracked: boolean) => (f: Factor) => ({
    name: f.name,
    category: f.category,
    t: Date.parse(f.timestamp),
    tracked,
  });
  const fx = [...factors.map(asExposure(true)), ...(options.exposureOnly ?? []).map(asExposure(false))].filter(f =>
    inRange(f.t),
  );

  // Group by name, ignoring case and surrounding spaces. The first spelling seen is the one shown.
  const symptomGroups = new Map<string, { name: string; logs: { t: number; dur: number | null }[] }>();
  for (const s of sx) {
    const g = symptomGroups.get(key(s.name)) ?? { name: s.name, logs: [] };
    g.logs.push({ t: s.t, dur: s.dur });
    symptomGroups.set(key(s.name), g);
  }
  const factorGroups = new Map<string, { name: string; category: FactorCategory; raw: number[] }>();
  for (const f of fx) {
    const g = factorGroups.get(key(f.name)) ?? { name: f.name, category: f.category, raw: [] };
    g.raw.push(f.t);
    factorGroups.set(key(f.name), g);
  }

  // What happened to each item and symptom. Null once tested, otherwise the reason it was not.
  const factorReason = new Map<string, FactorSkipReason | null>();
  const symptomReason = new Map<string, SymptomSkipReason | null>();
  const finish = (
    findings: TriggerFinding[],
    testsRun: number,
    counts: Pick<TriggerAnalysis, 'trackedDays' | 'factorsEligible' | 'symptomsEligible'>,
    otherwise: { factor: FactorSkipReason; symptom: SymptomSkipReason },
  ): TriggerAnalysis => {
    const byName = (a: string, b: string) => a.localeCompare(b);
    const factorsTested: string[] = [];
    const factorsSkipped: TriggerAnalysis['factorsSkipped'] = [];
    for (const [k, g] of factorGroups) {
      const reason = factorReason.get(k);
      if (reason === null) factorsTested.push(g.name);
      else {
        const logs = mergeClose(
          [...g.raw].sort((a, b) => a - b),
          2 * HOUR,
        ).length;
        factorsSkipped.push({ name: g.name, category: g.category, reason: reason ?? otherwise.factor, logs });
      }
    }
    const symptomsTested: string[] = [];
    const symptomsSkipped: TriggerAnalysis['symptomsSkipped'] = [];
    for (const [k, g] of symptomGroups) {
      const reason = symptomReason.get(k);
      if (reason === null) symptomsTested.push(g.name);
      else
        symptomsSkipped.push({
          name: g.name,
          reason: reason ?? otherwise.symptom,
          episodes: episodeStarts(g.logs).length,
        });
    }
    return {
      findings,
      testsRun,
      ...counts,
      factorsTested: factorsTested.sort(byName),
      factorsSkipped: factorsSkipped.sort((a, b) => b.logs - a.logs || byName(a.name, b.name)),
      symptomsTested: symptomsTested.sort(byName),
      symptomsSkipped: symptomsSkipped.sort((a, b) => b.episodes - a.episodes || byName(a.name, b.name)),
    };
  };
  const none = { trackedDays: 0, factorsEligible: 0, symptomsEligible: 0 };
  if (!sx.length || !fx.length) return finish([], 0, none, { factor: 'no-symptom', symptom: 'no-factor' });

  // Tracked days are local days with at least one symptom or Log tab entry.
  const activeDays = new Set<string>();
  for (const e of sx) activeDays.add(localDayKey(new Date(e.t)));
  for (const e of fx) if (e.tracked) activeDays.add(localDayKey(new Date(e.t)));

  let minT = Infinity;
  for (const e of sx) minT = Math.min(minT, e.t);
  for (const e of fx) minT = Math.min(minT, e.t);
  const firstBin = Math.floor(minT / BIN);
  const nBins = Math.floor(now / BIN) - firstBin + 1;

  const active = new Uint8Array(nBins);
  const hourOf = new Uint8Array(nBins);
  const trackedByHour = new Int32Array(24);
  // Tracked day number and clock slot (15 minute steps from midnight) of each tracked bin, so the starts
  // of one day can be moved to the same clock times on another tracked day.
  const dayOf = new Int32Array(nBins).fill(-1);
  const slotOf = new Uint8Array(nBins);
  const dayNumber = new Map<string, number>();
  let activeCount = 0;
  // Local hour and tracked day only change on the hour, so compute them once per hour of bins.
  for (let i = 0; i < nBins;) {
    const d = new Date((firstBin + i) * BIN);
    const hour = d.getHours();
    const dayKey = localDayKey(d);
    const isActive = activeDays.has(dayKey);
    const day = isActive ? (dayNumber.get(dayKey) ?? dayNumber.size) : -1;
    if (isActive) dayNumber.set(dayKey, day);
    // Bins until the next local hour. Zone offsets are multiples of 15 minutes, so local hour
    // boundaries always fall on bin edges, including in zones offset by 30 or 45 minutes.
    const binsToNextHour = Math.max(1, Math.round((60 - d.getMinutes()) / 15));
    const end = Math.min(nBins, i + binsToNextHour);
    for (let slot = hour * BINS_PER_HOUR + Math.floor(d.getMinutes() / 15); i < end; i++, slot++) {
      hourOf[i] = hour;
      if (isActive) {
        active[i] = 1;
        activeCount++;
        trackedByHour[hour]++;
        dayOf[i] = day;
        slotOf[i] = slot;
      }
    }
  }
  if (activeCount < 72 * BINS_PER_HOUR) {
    return finish([], 0, { ...none, trackedDays: activeDays.size }, { factor: 'few', symptom: 'few' });
  }
  const activePrefix = prefixSum(active);

  // Which clock slots each tracked day has. The first and last tracked days are cut short by the first
  // log and by now, and clock changes skip or repeat an hour. When an hour repeats, its first pass is
  // the one used for that clock time.
  const nTracked = dayNumber.size;
  // Day sets are bit sets with one bit per tracked day, dayWords words long.
  const dayWords = (nTracked + 31) >> 5;
  const slotBin = new Uint8Array(nBins);
  const validBySlot = new Int32Array(BINS_PER_DAY);
  const validDays = new Int32Array(BINS_PER_DAY * dayWords);
  for (let i = 0; i < nBins; i++) {
    const day = dayOf[i];
    if (day < 0) continue;
    const c = slotOf[i];
    const at = c * dayWords + (day >> 5);
    const bit = 1 << (day & 31);
    if (validDays[at] & bit) continue;
    validDays[at] |= bit;
    slotBin[i] = 1;
    validBySlot[c]++;
  }

  /**
   * Chance of at least k starts inside the window if each day's starts had happened, at the same clock
   * times, on a tracked day picked at random. Days are independent of each other, but the starts of one
   * day move together, so a day with several starts is one draw and not several. `days` holds the clock
   * slots of the starts of each day.
   */
  const planes = new Int32Array(32);
  const dayBlockUpperTail = (p: WindowPrep, days: number[][], k: number): number => {
    const dists: Float64Array[] = [];
    for (const slots of days) {
      if (slots.length === 1) {
        const chance = p.coveredBySlot[slots[0]] / validBySlot[slots[0]];
        if (chance > 0) dists.push(Float64Array.of(1 - chance, chance));
        continue;
      }
      // Count, for every tracked day that has all these clock times, how many of them were exposed.
      // The counts of 32 days are added at once in bit slices (planes[b] holds bit b of each count).
      const m = slots.length;
      const nPlanes = 32 - Math.clz32(m);
      const hist = new Float64Array(m + 1);
      let n = 0;
      for (let w = 0; w < dayWords; w++) {
        let valid = -1;
        for (const c of slots) valid &= validDays[c * dayWords + w];
        if (!valid) continue;
        planes.fill(0, 0, nPlanes);
        for (const c of slots) {
          let carry = p.coveredDays[c * dayWords + w] & valid;
          for (let b = 0; carry && b < nPlanes; b++) {
            const next = planes[b] & carry;
            planes[b] ^= carry;
            carry = next;
          }
        }
        n += bitCount(valid);
        for (let j = 0; j <= m; j++) {
          let same = valid;
          for (let b = 0; b < nPlanes; b++) same &= (j >> b) & 1 ? planes[b] : ~planes[b];
          hist[j] += bitCount(same);
        }
      }
      if (hist[0] === n) continue;
      for (let j = 0; j <= m; j++) hist[j] /= n;
      dists.push(hist);
    }
    return clusteredUpperTail(dists, k);
  };

  const binOf = (t: number) => Math.floor(t / BIN) - firstBin;
  // Window edges round up, so a window never starts before the factor was logged.
  const edgeOf = (t: number) => Math.ceil(t / BIN) - firstBin;

  const symptomList: { key: string; name: string; times: number[] }[] = [];
  for (const [k, g] of symptomGroups) {
    const times = episodeStarts(g.logs).filter(t => active[binOf(t)]);
    if (times.length >= minSymptomStarts) symptomList.push({ key: k, name: g.name, times });
    else symptomReason.set(k, 'few');
  }

  // Factors merge repeats within two hours.
  const factorList: { key: string; name: string; category: FactorCategory; raw: number[]; times: number[] }[] = [];
  for (const [k, g] of factorGroups) {
    const raw = g.raw.sort((a, b) => a - b);
    const times = mergeClose(raw, 2 * HOUR);
    if (times.length >= minExposures) factorList.push({ key: k, name: g.name, category: g.category, raw, times });
    else factorReason.set(k, 'few');
  }

  type Candidate = Omit<TriggerFinding, 'baselineChance' | 'qValue' | 'strength'>;
  const tests: Candidate[] = [];
  // Inputs for the usual chance of each test, worked out later and only for possible findings.
  const baseInputs: { base: BaselineInput; bins: number[] }[] = [];
  const mark = new Uint8Array(nBins);

  for (const f of factorList) {
    const preps: WindowPrep[] = [];
    let skipped: FactorSkipReason = 'few';
    const skip = (reason: FactorSkipReason) => {
      if (SKIP_RANK[reason] > SKIP_RANK[skipped]) skipped = reason;
    };
    for (const w of windows) {
      const covered = new Uint8Array(nBins);
      for (const t of f.times) {
        const a = Math.max(0, edgeOf(t + w.from * HOUR));
        const b = Math.min(nBins, edgeOf(t + w.to * HOUR));
        for (let i = a; i < b; i++) covered[i] = 1;
      }
      const exposedByHour = new Int32Array(24);
      const coveredBySlot = new Int32Array(BINS_PER_DAY);
      const coveredDays = new Int32Array(BINS_PER_DAY * dayWords);
      let exposedActive = 0;
      for (let i = 0; i < nBins; i++) {
        if (!covered[i] || !active[i]) continue;
        exposedByHour[hourOf[i]]++;
        exposedActive++;
        if (slotBin[i]) {
          const c = slotOf[i];
          coveredBySlot[c]++;
          coveredDays[c * dayWords + (dayOf[i] >> 5)] |= 1 << (dayOf[i] & 31);
        }
      }
      if (exposedActive < 6 * BINS_PER_HOUR) {
        skip('few');
        continue;
      }
      // Need hours of the day that are sometimes exposed and sometimes not. Otherwise exposure is
      // indistinguishable from time of day (a factor logged at the same time every day).
      let informative = false;
      for (let h = 0; h < 24; h++) if (exposedByHour[h] > 0 && exposedByHour[h] < trackedByHour[h]) informative = true;
      if (!informative) {
        skip('same-time');
        continue;
      }

      // Only exposures whose whole window is in the past and was tracked can say whether the symptom
      // followed. A window that ran into days with no logs would count as "not followed" for no reason.
      const len = (w.to - w.from) * BINS_PER_HOUR;
      const completeStarts = f.times.filter(t => t + w.to * HOUR <= now).map(t => edgeOf(t + w.from * HOUR));
      const exposureStarts = completeStarts.filter(a => activePrefix[a + len] - activePrefix[a] === len);
      if (exposureStarts.length < minExposures) {
        skip('few');
        continue;
      }

      // Matched comparison windows: the same clock window on nearby tracked days with no exposure.
      const coveredPrefix = prefixSum(covered);
      const comparable = (s: number) =>
        s >= 0 &&
        s + len <= nBins &&
        activePrefix[s + len] - activePrefix[s] === len &&
        coveredPrefix[s + len] - coveredPrefix[s] === 0;
      let comparisons = 0;
      mark.fill(0);
      for (const s0 of completeStarts) {
        for (let k = -MAX_SHIFT_DAYS; k <= MAX_SHIFT_DAYS; k++) {
          const s = s0 + k * BINS_PER_DAY;
          if (k === 0 || !comparable(s) || mark[s]) continue;
          mark[s] = 1;
          comparisons++;
        }
      }
      // The comparable windows of each counted exposure, for a usual chance matched to its time of day.
      const matchFrom = new Int32Array(exposureStarts.length + 1);
      const matches: number[] = [];
      exposureStarts.forEach((a, e) => {
        for (let k = -MAX_SHIFT_DAYS; k <= MAX_SHIFT_DAYS; k++) {
          const s = a + k * BINS_PER_DAY;
          if (k !== 0 && comparable(s)) matches.push(s);
        }
        matchFrom[e + 1] = matches.length;
      });
      if (comparisons < 5 || !matches.length) {
        skip('daily');
        continue;
      }
      preps.push({
        w,
        base: { len, exposureStarts, matchFrom, matches: Int32Array.from(matches) },
        covered,
        exposedByHour,
        comparisons,
        coveredBySlot,
        coveredDays,
      });
    }
    if (!preps.length) {
      factorReason.set(f.key, skipped);
      continue;
    }

    let tested = false;
    for (const s of symptomList) {
      const times = s.times.filter(t => !hasNear(f.raw, t, SIMULTANEOUS));
      if (times.length < minSymptomStarts) continue;
      const bins = times.map(binOf);
      // Clock slots of the starts of each day. Starts are sorted, so the starts of one day are together.
      const days: number[][] = [];
      bins.forEach((b, i) => {
        if (i === 0 || dayOf[b] !== dayOf[bins[i - 1]]) days.push([]);
        days[days.length - 1].push(slotOf[b]);
      });

      for (const p of preps) {
        const exposedStarts = new Float64Array(24);
        const otherStarts = new Float64Array(24);
        let inWindow = 0;
        for (const b of bins) {
          const h = hourOf[b];
          if (p.covered[b]) {
            inWindow++;
            exposedStarts[h]++;
          } else {
            otherStarts[h]++;
          }
        }
        const pValue = inWindow ? dayBlockUpperTail(p, days, inWindow) : 1;

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
        for (const a of p.base.exposureStarts) if (hasIn(bins, a, p.base.len)) followed++;

        tests.push({
          factor: f.name,
          category: f.category,
          symptom: s.name,
          window: p.w,
          exposures: p.base.exposureStarts.length,
          exposuresFollowed: followed,
          comparisonWindows: p.comparisons,
          relativeRate,
          symptomStartsInWindow: inWindow,
          symptomStartsTotal: times.length,
          pValue,
        });
        baseInputs.push({ base: p.base, bins });
      }
      tested = true;
      symptomReason.set(s.key, null);
    }
    factorReason.set(f.key, tested ? null : 'no-symptom');
  }

  const q = benjaminiHochberg(tests.map(t => t.pValue));
  const findings: TriggerFinding[] = [];
  tests.forEach((t, i) => {
    const qValue = q[i];
    if (qValue > maxQ || t.relativeRate < minRR || t.exposuresFollowed < 3) return;
    const baselineChance = usualChance(baseInputs[i].base, baseInputs[i].bins);
    if (t.exposuresFollowed / t.exposures <= baselineChance) return;
    const strength: FindingStrength =
      qValue < 0.01 && t.exposuresFollowed >= 5 ? 'strong' : qValue < 0.05 ? 'moderate' : 'early';
    findings.push({ ...t, baselineChance, qValue, strength });
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

  const counts = {
    trackedDays: activeDays.size,
    factorsEligible: factorList.length,
    symptomsEligible: symptomList.length,
  };
  return finish(sorted, tests.length, counts, { factor: 'few', symptom: 'no-factor' });
}

/**
 * Share of each counted exposure's comparable windows that contained a symptom start, averaged over the
 * exposures that have any. Exposures that happened at a habitual time and ones logged at an unusual time
 * each count once, just as they do in "followed X of N times".
 */
function usualChance(base: BaselineInput, bins: number[]): number {
  let sum = 0;
  let n = 0;
  for (let e = 0; e < base.exposureStarts.length; e++) {
    const from = base.matchFrom[e];
    const to = base.matchFrom[e + 1];
    if (to === from) continue;
    let hits = 0;
    for (let x = from; x < to; x++) if (hasIn(bins, base.matches[x], base.len)) hits++;
    sum += hits / (to - from);
    n++;
  }
  return n ? sum / n : 0;
}

/** One plain sentence describing a finding. */
export function describeFinding(f: TriggerFinding): string {
  return `${f.symptom} followed ${f.factor.toLowerCase()} ${f.window.label} ${f.exposuresFollowed} of ${f.exposures} times.`;
}

export function describeBaseline(f: TriggerFinding): string {
  const pct = Math.round(f.baselineChance * 100);
  return `On nearby days without ${f.factor.toLowerCase()}, the same hours included ${f.symptom.toLowerCase()} ${pct}% of the time.`;
}
