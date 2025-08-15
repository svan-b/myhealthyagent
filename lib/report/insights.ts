// lib/report/insights.ts
// MVP-friendly but future-proof: pluggable detectors, stable outputs.
// Aligns with Day 4 report (last-30, top 3 hypotheses) and lets you add
// rule-based + ML detectors later without changing the PDF caller.

import type { Symptom } from '@/lib/db/schema';
import {
  addDays,
  differenceInHours,
  format,
  parseISO,
  startOfDay,
  subDays,
  isAfter,
  getDay,
} from 'date-fns';

export interface TrendData {
  date: string;        // yyyy-MM-dd (user-local)
  avgSeverity: number; // 0..10
}

export interface TopSymptom {
  name: string;
  count: number;
  avgSeverity: number;
}

export type PatternType = 'temporal' | 'correlation' | 'timing' | 'statistical' | 'cluster';

export interface Pattern {
  text: string;                          // human-readable hypothesis
  confidence: 'High' | 'Medium' | 'Low';
  type: PatternType;
  metadata?: Record<string, unknown>;    // counts, windows, slope, etc.
}

export interface TrendOptions {
  days?: number;          // default 30
  now?: Date;             // injectable clock for testing
}

export interface PatternOptions {
  now?: Date;                              // injectable clock
  minOccurrences?: number;                 // default 3
  tagLagWindowHours?: [number, number];    // default [12, 24]
  lookbackDays?: number;                   // default 30
  detectors?: PatternDetector[];           // add/override detectors
}

export interface PatternDetector {
  name: string;
  detect(symptoms: Symptom[], opts: Required<PatternOptions>): Pattern[];
}

/* ------------------------------- Utilities ------------------------------- */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);
const toDate = (ts: string | number | Date) =>
  ts instanceof Date ? ts : typeof ts === 'string' ? parseISO(ts) : new Date(ts);

// Build a yyyy-MM-dd key in local time (keeps report human-aligned)
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

/* ----------------------------- Public: Trends ---------------------------- */

export function calculateTrend(symptoms: Symptom[], options: TrendOptions = {}): TrendData[] {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();

  // Prime last N days with empty arrays
  const daily: Map<string, number[]> = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = startOfDay(subDays(now, i));
    daily.set(dayKey(d), []);
  }

  // Bucket severities into those days
  for (const s of symptoms) {
    const d = dayKey(startOfDay(toDate(s.timestamp)));
    if (daily.has(d)) daily.get(d)!.push(s.severity);
  }

  // Average per day
  return Array.from(daily.entries()).map(([date, vals]) => ({
    date,
    avgSeverity: Number(mean(vals).toFixed(2)),
  }));
}

/* ------------------------- Public: Top N symptoms ------------------------ */

export function getTopSymptoms(symptoms: Symptom[], topN = 5): TopSymptom[] {
  const map = new Map<string, { count: number; total: number }>();
  for (const s of symptoms) {
    const cur = map.get(s.name) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += s.severity;
    map.set(s.name, cur);
  }
  return Array.from(map.entries())
    .map(([name, { count, total }]) => ({
      name,
      count,
      avgSeverity: Number(safeDiv(total, count).toFixed(2)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

/* ---------------------- Built-in pattern detectors (MVP) ------------------ */

// 1) Statistical trend: is severity improving or worsening?
const severityTrendDetector: PatternDetector = {
  name: 'severity-trend',
  detect(symptoms, opts) {
    // Use last 14 days of daily averages, simple least-squares slope.
    const daily = calculateTrend(symptoms, { days: 14, now: opts.now });
    if (daily.length < 7) return [];

    const ys = daily.map(d => d.avgSeverity);
    const xs = daily.map((_, i) => i); // 0..n-1
    const xMean = mean(xs);
    const yMean = mean(ys);
    const num = xs.reduce((acc, x, i) => acc + (x - xMean) * (ys[i] - yMean), 0);
    const den = xs.reduce((acc, x) => acc + (x - xMean) ** 2, 0);
    const slope = safeDiv(num, den); // severity units per day
    const delta = ys[ys.length - 1] - ys[0]; // net change over window

    const mag = Math.abs(slope);
    if (mag < 0.04 && Math.abs(delta) < 0.8) return []; // small/no trend

    const improving = slope < 0;
    const conf: Pattern['confidence'] = mag > 0.08 || Math.abs(delta) > 1.5 ? 'High' : 'Medium';
    return [
      {
        text: improving
          ? `Severity trending down (~${(Math.abs(delta)).toFixed(1)} points over 2 weeks)`
          : `Severity trending up (~${delta.toFixed(1)} points over 2 weeks)`,
        confidence: conf,
        type: 'statistical',
        metadata: { slopePerDay: Number(slope.toFixed(3)), delta: Number(delta.toFixed(2)) },
      },
    ];
  },
};

// 2) Timing (tag → later symptoms): generic 12–24h lag correlation.
// Works for tags like 'dairy', 'gluten', 'coffee', etc.
const tagLagDetector: PatternDetector = {
  name: 'tag-lag-12-24h',
  detect(symptoms, opts) {
    const [minH, maxH] = opts.tagLagWindowHours;
    const byTag = new Map<string, { hits: number[]; base: number[] }>();

    // Pre-sort events by time
    const events = symptoms
      .map(s => ({ ...s, _t: toDate(s.timestamp) }))
      .sort((a, b) => a._t.getTime() - b._t.getTime());

    // Index by time for quick scans
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const tags = (e.tags ?? []) as string[];
      if (!tags.length) continue;

      for (const tag of tags) {
        if (!byTag.has(tag)) byTag.set(tag, { hits: [], base: [] });

        // Collect severities within window AFTER this tag
        const start = addDays(e._t, 0); // same moment
        for (let j = i + 1; j < events.length; j++) {
          const e2 = events[j];
          const h = differenceInHours(e2._t, start);
          if (h > maxH) break;
          if (h >= minH && h <= maxH) byTag.get(tag)!.hits.push(e2.severity);
        }
      }
    }

    // Baseline = all severities outside windows (coarse but OK for MVP)
    const allSev = events.map(e => e.severity);

    const patterns: Pattern[] = [];
    for (const [tag, { hits }] of byTag.entries()) {
      if (hits.length < (opts.minOccurrences ?? 3)) continue;
      const hitAvg = mean(hits);
      // Very rough baseline: overall average; small sample bias is acceptable for MVP.
      const baseAvg = mean(allSev);
      const lift = hitAvg - baseAvg;

      if (lift > 0.8 && hitAvg > 5) {
        const conf: Pattern['confidence'] = lift > 1.5 && hits.length >= 5 ? 'High' : 'Medium';
        patterns.push({
          text: `Higher severity ${minH}–${maxH}h after "${tag}" (${hits.length} occurrences, avg ${hitAvg.toFixed(
            1,
          )}/10)`,
          confidence: conf,
          type: 'timing',
          metadata: { windowHours: [minH, maxH], occurrences: hits.length, lift: Number(lift.toFixed(2)) },
        });
      }
    }

    return patterns;
  },
};

// 3) Temporal period (morning/afternoon/evening/night) peaks.
const periodPeakDetector: PatternDetector = {
  name: 'period-peak',
  detect(symptoms) {
    if (symptoms.length < 7) return [];
    const buckets: Record<'night' | 'morning' | 'afternoon' | 'evening', number[]> = {
      night: [],
      morning: [],
      afternoon: [],
      evening: [],
    };
    for (const s of symptoms) {
      const h = toDate(s.timestamp).getHours();
      const key = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
      buckets[key].push(s.severity);
    }
    const entries = Object.entries(buckets) as [keyof typeof buckets, number[]][];
    const scored = entries
      .filter(([, vals]) => vals.length >= 3)
      .map(([k, vals]) => ({ k, avg: mean(vals), n: vals.length }))
      .sort((a, b) => b.avg - a.avg);

    if (!scored.length) return [];
    const best = scored[0];
    if (best.avg <= 5) return [];

    const conf: Pattern['confidence'] = best.avg > 7 ? 'High' : 'Medium';
    return [
      {
        text: `Symptoms often peak in the ${best.k} (avg ${best.avg.toFixed(1)}/10)`,
        confidence: conf,
        type: 'temporal',
        metadata: { count: best.n },
      },
    ];
  },
};

// 4) Detect symptoms that frequently occur together
const symptomClusterDetector: PatternDetector = {
  name: 'symptom-clusters',
  detect(symptoms, opts) {
    const patterns: Pattern[] = [];
    const lookbackDays = opts.lookbackDays ?? 30;
    const cutoff = subDays(opts.now, lookbackDays);
    
    // Filter symptoms within lookback period
    const recent = symptoms.filter(s => isAfter(toDate(s.timestamp), cutoff));
    if (recent.length < opts.minOccurrences * 2) return patterns;
    
    // Group symptoms by day
    const byDay = new Map<string, Symptom[]>();
    recent.forEach(s => {
      const day = dayKey(toDate(s.timestamp));
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(s);
    });
    
    // Find co-occurring symptoms
    const cooccurrences = new Map<string, number>();
    byDay.forEach(daySymptoms => {
      const names = [...new Set(daySymptoms.map(s => s.name))];
      if (names.length >= 2) {
        // Generate pairs
        for (let i = 0; i < names.length; i++) {
          for (let j = i + 1; j < names.length; j++) {
            const pair = [names[i], names[j]].sort().join(' + ');
            cooccurrences.set(pair, (cooccurrences.get(pair) ?? 0) + 1);
          }
        }
      }
    });
    
    // Report significant clusters
    const sorted = Array.from(cooccurrences.entries())
      .filter(([, count]) => count >= opts.minOccurrences)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    for (const [pair, count] of sorted) {
      patterns.push({
        text: `${pair} occur together (${count} days in past ${lookbackDays})`,
        confidence: count >= opts.minOccurrences * 2 ? 'High' : 'Medium',
        type: 'cluster',
        metadata: {
          pair,
          occurrences: count,
          lookbackDays,
        },
      });
    }
    
    return patterns;
  },
};

// 5) Detect weekday vs weekend patterns
const weekdayPatternDetector: PatternDetector = {
  name: 'weekday-pattern',
  detect(symptoms, opts) {
    const patterns: Pattern[] = [];
    const lookbackDays = opts.lookbackDays ?? 30;
    const cutoff = subDays(opts.now, lookbackDays);
    
    // Filter symptoms within lookback period
    const recent = symptoms.filter(s => isAfter(toDate(s.timestamp), cutoff));
    if (recent.length < 10) return patterns; // Need sufficient data
    
    // Categorize by weekday vs weekend
    let weekdayCount = 0;
    let weekdaySum = 0;
    let weekendCount = 0;
    let weekendSum = 0;
    
    recent.forEach(s => {
      const date = toDate(s.timestamp);
      const dayOfWeek = getDay(date); // 0 = Sunday, 6 = Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      if (isWeekend) {
        weekendCount++;
        weekendSum += s.severity;
      } else {
        weekdayCount++;
        weekdaySum += s.severity;
      }
    });
    
    if (weekdayCount === 0 || weekendCount === 0) return patterns;
    
    const weekdayAvg = weekdaySum / weekdayCount;
    const weekendAvg = weekendSum / weekendCount;
    const diff = Math.abs(weekdayAvg - weekendAvg);
    
    // Report if significant difference (>1.5 severity points)
    if (diff > 1.5) {
      const worse = weekdayAvg > weekendAvg ? 'weekdays' : 'weekends';
      const better = weekdayAvg > weekendAvg ? 'weekends' : 'weekdays';
      
      patterns.push({
        text: `Symptoms worse on ${worse} (${diff.toFixed(1)} points higher than ${better})`,
        confidence: diff > 2.5 ? 'High' : 'Medium',
        type: 'temporal',
        metadata: {
          weekdayAvg: weekdayAvg.toFixed(1),
          weekendAvg: weekendAvg.toFixed(1),
          difference: diff.toFixed(1),
          lookbackDays,
        },
      });
    }
    
    return patterns;
  },
};

/* --------------------------- Pattern orchestration ----------------------- */

const builtInDetectors: PatternDetector[] = [
  severityTrendDetector,
  tagLagDetector,
  periodPeakDetector,
  symptomClusterDetector,
  weekdayPatternDetector,
];

export function detectPatterns(
  symptoms: Symptom[],
  options: PatternOptions = {},
): Pattern[] {
  const opts: Required<PatternOptions> = {
    now: options.now ?? new Date(),
    minOccurrences: options.minOccurrences ?? 3,
    tagLagWindowHours: options.tagLagWindowHours ?? [12, 24],
    lookbackDays: options.lookbackDays ?? 30,
    detectors: options.detectors ?? builtInDetectors,
  };

  const patterns: Pattern[] = [];
  for (const det of opts.detectors) {
    try {
      patterns.push(...det.detect(symptoms, opts));
    } catch {
      // Fail-open per detector to avoid breaking the report
    }
  }

  // Always return at most 3, highest-confidence first
  const order = { High: 3, Medium: 2, Low: 1 } as const;
  const top = patterns
    .sort((a, b) => order[b.confidence] - order[a.confidence])
    .slice(0, 3);

  if (!top.length) {
    top.push({
      text: 'Insufficient data for pattern detection (aim for 7+ days of logs).',
      confidence: 'Low',
      type: 'statistical',
    });
  }
  return top;
}

/* -------------------------- (Optional) Rule hook ------------------------- */
// When you add the 25 timing/compat rules, expose them as PatternDetectors and
// pass through detectPatterns({ detectors: [...builtInDetectors, ...ruleDetectors] }).
// Later, ONNX model outputs can be wrapped as another PatternDetector that emits
// Pattern objects with `type: 'correlation'` and a model id in metadata.
