/** @jest-environment node */
// Clock changes. CI runs the tests in UTC, so the analysis runs in a child process with the time zone
// set, and its p values are checked against a slow reference that reads every clock time with Intl.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import type { TriggerFinding } from '@/lib/analysis/triggers';
import type { Factor, Symptom } from '@/lib/db/schema';

const MIN = 60_000;
const HOUR = 60 * MIN;
const BIN = 15 * MIN;

/** [year, month from 0, day, hour, minute] in the child's time zone, or UTC milliseconds. */
type When = [number, number, number, number, number] | number;
type Day = [number, number, number];
interface Spec {
  symptoms: [string, When][];
  factors: [string, When][];
  now: When;
}
interface Run {
  symptoms: Symptom[];
  factors: Factor[];
  now: string;
  findings: TriggerFinding[];
}

// Runs each delay window on its own with the q value and rate ratio gates open, so most tests come back.
const RUNNER = `
const { findTriggers, DEFAULT_WINDOWS } = require('./triggers.js');
const spec = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const iso = x => (Array.isArray(x) ? new Date(x[0], x[1], x[2], x[3], x[4]) : new Date(x)).toISOString();
const symptoms = spec.symptoms.map(([name, at], i) => ({ id: 's' + i, name, severity: 5, timestamp: iso(at) }));
const factors = spec.factors.map(([name, at], i) => ({ id: 'f' + i, name, category: 'food', timestamp: iso(at) }));
const now = new Date(iso(spec.now));
const findings = DEFAULT_WINDOWS.flatMap(
  w => findTriggers(symptoms, factors, { now, windows: [w], maxQ: 1, minRelativeRate: 0 }).findings,
);
process.stdout.write(JSON.stringify({ symptoms, factors, now: now.toISOString(), findings }));
`;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'triggers-zones-'));
  for (const name of ['triggers', 'stats']) {
    const source = readFileSync(join(__dirname, '..', 'lib', 'analysis', `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    writeFileSync(join(dir, `${name}.js`), outputText);
  }
  writeFileSync(join(dir, 'run.js'), RUNNER);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function runIn(timeZone: string, spec: Spec): Run {
  const res = spawnSync(process.execPath, [join(dir, 'run.js')], {
    input: JSON.stringify(spec),
    env: { ...process.env, TZ: timeZone },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

/** Local day and clock time of an instant in a time zone. */
function clockIn(timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  return (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
}

/**
 * The day-block exact test, the slow way. Each day's symptom starts could have happened at the same
 * clock times on any tracked day that has all of them. A clock time on a day counts as exposed if any
 * instant with that clock time on that day is inside the window. No durations are logged here, so a
 * log within 6 hours of the previous one is the same episode.
 */
function reference(timeZone: string, run: Run): (f: TriggerFinding) => number {
  const clock = clockIn(timeZone);
  const now = Date.parse(run.now);
  const inRange = (t: number) => t >= now - 180 * 24 * HOUR && t <= now;
  const sx = run.symptoms.map(s => ({ name: s.name, t: Date.parse(s.timestamp) })).filter(s => inRange(s.t));
  const fx = run.factors.map(x => ({ name: x.name, t: Date.parse(x.timestamp) })).filter(x => inRange(x.t));
  const tracked = new Set([...sx, ...fx].map(e => clock(e.t).day));
  const firstBin = Math.floor(Math.min(...sx.map(s => s.t), ...fx.map(x => x.t)) / BIN);
  const lastBin = Math.floor(now / BIN);

  // The bins of each tracked day, by clock time. An hour that repeats has two bins per clock time.
  const days = new Map<string, Map<string, number[]>>();
  for (let b = firstBin; b <= lastBin; b++) {
    const { day, time } = clock(b * BIN);
    if (!tracked.has(day)) continue;
    const slots = days.get(day) ?? new Map<string, number[]>();
    slots.set(time, [...(slots.get(time) ?? []), b]);
    days.set(day, slots);
  }

  return f => pValue(f, sx, fx, days, clock);
}

function pValue(
  f: TriggerFinding,
  sx: { name: string; t: number }[],
  fx: { name: string; t: number }[],
  days: Map<string, Map<string, number[]>>,
  clock: ReturnType<typeof clockIn>,
): number {
  const raw = fx
    .filter(x => x.name === f.factor)
    .map(x => x.t)
    .sort((a, b) => a - b);
  const times: number[] = [];
  for (const t of raw) if (!times.length || t - times[times.length - 1] > 2 * HOUR) times.push(t);
  const spans = times.map(t => [
    Math.ceil((t + f.window.from * HOUR) / BIN),
    Math.ceil((t + f.window.to * HOUR) / BIN),
  ]);
  const covered = (b: number) => spans.some(([a, z]) => b >= a && b < z);

  const logs = sx
    .filter(s => s.name === f.symptom)
    .map(s => s.t)
    .sort((a, b) => a - b);
  const starts = logs
    .filter((t, i) => i === 0 || t - logs[i - 1] > 6 * HOUR)
    .filter(t => !raw.some(r => Math.abs(r - t) <= 15 * MIN));

  let observed = 0;
  const byDay = new Map<string, string[]>();
  for (const t of starts) {
    const b = Math.floor(t / BIN);
    if (covered(b)) observed++;
    const { day, time } = clock(b * BIN);
    byDay.set(day, [...(byDay.get(day) ?? []), time]);
  }
  expect(observed).toBe(f.symptomStartsInWindow);

  let dist = [1];
  for (const slots of byDay.values()) {
    const hist: number[] = new Array(slots.length + 1).fill(0);
    let n = 0;
    for (const have of days.values()) {
      if (!slots.every(s => have.has(s))) continue;
      n++;
      hist[slots.filter(s => have.get(s)!.some(covered)).length]++;
    }
    const next: number[] = new Array(dist.length + slots.length).fill(0);
    dist.forEach((a, i) => hist.forEach((h, j) => (next[i + j] += (a * h) / n)));
    dist = next;
  }
  return Math.min(
    1,
    dist.slice(observed).reduce((a, b) => a + b, 0),
  );
}

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random logs on the given local days, many of them in the small hours when clocks change. */
function randomLogs(seed: number, days: Day[]): Pick<Spec, 'symptoms' | 'factors'> {
  const r = mulberry32(seed);
  const at = ([y, m, d]: Day, h: number): When => [y, m, d, Math.floor(h), Math.floor((h % 1) * 60)];
  const symptoms: [string, When][] = [];
  const factors: [string, When][] = [];
  for (const day of days) {
    if (r() < 0.15) continue;
    for (const name of ['Tea', 'Toast', 'Rice', 'Fruit', 'Nuts']) {
      if (r() < 0.5) factors.push([name, at(day, r() < 0.5 ? r() * 6 : 6 + r() * 18)]);
    }
    for (const name of ['Headache', 'Nausea', 'Dizziness']) {
      if (r() < 0.4) continue;
      let h = r() < 0.5 ? r() * 5 : 5 + r() * 12;
      for (let k = 1 + Math.floor(r() * 3); k > 0 && h < 24; k--, h += 2 + r() * 8) symptoms.push([name, at(day, h)]);
    }
  }
  return { symptoms, factors };
}

/** `count` days in a row, starting on the given date. */
function daysFrom([y, m, d]: Day, count: number): Day[] {
  return Array.from({ length: count }, (_, i) => {
    const x = new Date(Date.UTC(y, m, d + i));
    return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()];
  });
}

function expectMatchesReference(timeZone: string, run: Run) {
  expect(run.findings.length).toBeGreaterThanOrEqual(10);
  const expectedP = reference(timeZone, run);
  for (const f of run.findings) {
    const expected = expectedP(f);
    expect(Math.abs(f.pValue - expected)).toBeLessThanOrEqual(1e-9 + 1e-6 * expected);
  }
}

describe('the exact test across clock changes', () => {
  it('handles the hour that repeats when clocks go back', () => {
    // New York. Clocks go back from 2:00 to 1:00 on 1 November 2026.
    const zone = 'America/New_York';
    const data = randomLogs(7, daysFrom([2026, 9, 1], 42));
    for (let d = 2; d <= 30; d += 4) {
      data.factors.push(['Snack', [2026, 9, d, 14, 0]]);
      data.symptoms.push(['Cramp', [2026, 9, d, 15, 30]]);
    }
    // A snack at 1:20 and a cramp at 1:40, both in the second pass of the repeated hour. The first pass
    // of 1:30 to 1:45 that night was not after a snack. Every in-window start must still be possible
    // under "no effect", so the exact chance can never be 0.
    const secondPass = Date.UTC(2026, 10, 1, 6, 0);
    data.factors.push(['Snack', secondPass + 20 * MIN]);
    data.symptoms.push(['Cramp', secondPass + 40 * MIN]);
    const run = runIn(zone, { ...data, now: [2026, 10, 12, 20, 7] });

    const night = run.findings.find(f => f.factor === 'Snack' && f.symptom === 'Cramp' && f.window.from === 0);
    expect(night?.pValue).toBeGreaterThan(0);
    expectMatchesReference(zone, run);
  });

  it('reads the clock correctly when clocks change at 2:45 and not on the hour', () => {
    // Chatham Islands. Clocks go back from 3:45 to 2:45 on 5 April 2026 and forward from 2:45 to 3:45
    // on 27 September 2026.
    const zone = 'Pacific/Chatham';
    const data = randomLogs(11, [...daysFrom([2026, 3, 3], 18), ...daysFrom([2026, 8, 12], 18)]);
    for (const [m, d] of [
      [3, 5],
      [8, 27],
    ]) {
      data.factors.push(['Tea', [2026, m, d, 0, 50]]);
      data.symptoms.push(['Headache', [2026, m, d, 3, 50]]);
    }
    expectMatchesReference(zone, runIn(zone, { ...data, now: [2026, 8, 29, 22, 0] }));
  });

  it.each<[string, Day, Day]>([
    // Clocks go back half an hour, from 2:00 to 1:30, on 5 April 2026.
    ['Australia/Lord_Howe', [2026, 2, 15], [2026, 3, 20]],
    // Clocks go forward from 2:00 to 3:00 on 8 March 2026, at a 3.5 hour offset.
    ['America/St_Johns', [2026, 1, 20], [2026, 2, 25]],
    // A 5.75 hour offset with no clock changes.
    ['Asia/Kathmandu', [2026, 4, 1], [2026, 5, 5]],
  ])('matches the reference in %s', (zone, first, last) => {
    const count = Math.round((Date.UTC(...last) - Date.UTC(...first)) / (24 * HOUR)) + 1;
    const data = randomLogs(3, daysFrom(first, count));
    expectMatchesReference(zone, runIn(zone, { ...data, now: [...last, 21, 0] }));
  });
});
