/**
 * @jest-environment node
 */
// When the Log screen asks whether a symptom logged again is the same one, and why that matters to the
// trigger finder.
import { continuedToday, openEarlierLog, startedAt } from '@/app/components/log/episodes';
import { findTriggers } from '@/lib/analysis/triggers';
import type { Symptom } from '@/lib/db/schema';

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 12, 16, 0).getTime();
let seq = 0;
const log = (hoursBefore: number, more: Partial<Symptom> = {}): Symptom => ({
  id: `s${seq++}`,
  name: 'Headache',
  severity: 5,
  timestamp: new Date(NOW - hoursBefore * HOUR).toISOString(),
  ...more,
});
const ask = (symptoms: Symptom[], name = 'Headache', start = NOW) => openEarlierLog(symptoms, name, start);

/** Episode starts the trigger finder counts for Headache. With no items logged it lists every symptom as skipped. */
const starts = (symptoms: Symptom[]) =>
  findTriggers(symptoms, [], { now: new Date(NOW + HOUR) }).symptomsSkipped.find(s => s.name === 'Headache')
    ?.episodes ?? 0;

describe('asks only about an earlier log that may still be going, 6 to 24 hours before', () => {
  it.each([
    ['still going, 8 hours before', { ongoing: true }, 8, true],
    ['no duration, 8 hours before', {}, 8, true],
    ['still going, 6 hours and a minute before', { ongoing: true }, 6 + 1 / 60, true],
    ['still going, 24 hours before', { ongoing: true }, 24, true],
    ['still going, exactly 6 hours before', { ongoing: true }, 6, false],
    ['still going, 3 hours before', { ongoing: true }, 3, false],
    ['still going, 25 hours before', { ongoing: true }, 25, false],
    ['lasted 30 minutes, 8 hours before', { duration_minutes: 30 }, 8, false],
    ['lasted most of the day, 8 hours before', { duration_minutes: 480 }, 8, false],
  ] as const)('%s', (_what, more, hours, asks) => {
    const earlier = log(hours, more);
    expect(ask([earlier])).toBe(asks ? earlier : null);
  });

  it('never for another symptom, and ignores capitals and spaces in the name', () => {
    const earlier = log(8, { ongoing: true });
    expect(ask([earlier], 'Nausea')).toBeNull();
    expect(ask([earlier], ' headache ')).toBe(earlier);
  });

  it('only about the latest earlier log', () => {
    // Logged again with a duration after the open one, so it was over.
    expect(ask([log(10, { ongoing: true }), log(8, { duration_minutes: 30 })])).toBeNull();
    // A later open log within 6 hours already keeps the new one in the same episode.
    expect(ask([log(10, { ongoing: true }), log(5, { ongoing: true })])).toBeNull();
    const latest = log(9, { ongoing: true });
    expect(ask([log(20, { duration_minutes: 60 }), latest])).toBe(latest);
  });

  it('not when an older log with a long duration still reaches the new one', () => {
    // 22 hours long from 22 hours before, plus an hour, reaches past now.
    expect(ask([log(22, { duration_minutes: 22 * 60 }), log(8)])).toBeNull();
    // 20 hours long ends, with the hour after it, an hour before now.
    expect(ask([log(22, { duration_minutes: 20 * 60 }), log(8)])).not.toBeNull();
  });

  it('measures from the time the new log starts, as for "3 hrs ago" or "Earlier"', () => {
    const earlier = log(10, { ongoing: true });
    // The new log started 3 hours ago, so 7 hours after the earlier one.
    expect(ask([earlier], 'Headache', NOW - 3 * HOUR)).toBe(earlier);
    // Started 5 hours ago, so within 6 hours of the earlier one.
    expect(ask([earlier], 'Headache', NOW - 5 * HOUR)).toBeNull();
    // A log after the new one's start is not earlier.
    expect(ask([log(1, { ongoing: true })], 'Headache', NOW - 9 * HOUR)).toBeNull();
  });
});

describe('matches the trigger finder', () => {
  // For each case the question is asked exactly when a new entry would be counted as a new start.
  it.each([
    [[{ h: 8, ongoing: true }]],
    [[{ h: 8 }]],
    [[{ h: 5, ongoing: true }]],
    [[{ h: 6 }]],
    [[{ h: 12, dur: 30 }]],
    [[{ h: 14, dur: 600 }]],
    [[{ h: 20, dur: 480 }, { h: 7 }]],
    [[{ h: 22, dur: 1200 }, { h: 8 }]],
    [[{ h: 22, dur: 1320 }, { h: 8 }]],
    [[{ h: 18, ongoing: true }, { h: 13 }]],
    [[{ h: 23 }, { h: 9, dur: 10 }]],
  ])('%j', earlierLogs => {
    const earlier = earlierLogs.map(e =>
      log(e.h, { ongoing: 'ongoing' in e ? e.ongoing : undefined, duration_minutes: 'dur' in e ? e.dur : undefined }),
    );
    const newStart = starts([...earlier, log(0)]) > starts(earlier);
    const latest = earlier.reduce((a, b) => (Date.parse(a.timestamp) > Date.parse(b.timestamp) ? a : b));
    const open = Boolean(latest.ongoing) || !latest.duration_minutes;
    expect(ask(earlier) !== null).toBe(newStart && open);
  });
});

it('"Same one" adds no new start, while a new entry would', () => {
  const earlier = log(8, { ongoing: true });
  expect(starts([earlier])).toBe(1);
  // What "New one" saves.
  expect(starts([earlier, log(0, { severity: 7 })])).toBe(2);
  // "Same one" leaves only the earlier entry, still going and with the higher rating.
  expect(starts([{ ...earlier, severity: 7, ongoing: true, updatedAt: new Date(NOW).toISOString() }])).toBe(1);
});

describe('words and the Today list', () => {
  it('says when the earlier entry started', () => {
    const now = new Date(NOW);
    // Times and days are written the device's way, as elsewhere in the app.
    const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const morning = new Date(2026, 10, 12, 8, 10);
    const lastNight = new Date(2026, 10, 11, 22, 0);
    const monday = new Date(2026, 10, 9, 22, 0);
    expect(startedAt(morning.toISOString(), now)).toEqual({
      at: `at ${clock(morning)}`,
      since: `since ${clock(morning)}`,
    });
    expect(startedAt(lastNight.toISOString(), now)).toEqual({
      at: `yesterday at ${clock(lastNight)}`,
      since: `since yesterday at ${clock(lastNight)}`,
    });
    const day = monday.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    expect(startedAt(monday.toISOString(), now)).toEqual({
      at: `on ${day} at ${clock(monday)}`,
      since: `since ${day} at ${clock(monday)}`,
    });
  });

  it('shows an entry from yesterday that was continued today', () => {
    const now = new Date(NOW);
    const today = new Date(NOW - HOUR).toISOString();
    const yesterday = new Date(2026, 10, 11, 22, 0).toISOString();
    expect(continuedToday({ ...log(0), timestamp: yesterday, ongoing: true, updatedAt: today }, now)).toBe(true);
    // Not continued today, not still going, started today, or more than a day ago.
    expect(continuedToday({ ...log(0), timestamp: yesterday, ongoing: true }, now)).toBe(false);
    expect(continuedToday({ ...log(0), timestamp: yesterday, updatedAt: today }, now)).toBe(false);
    expect(continuedToday({ ...log(2), ongoing: true, updatedAt: today }, now)).toBe(false);
    expect(continuedToday({ ...log(30), ongoing: true, updatedAt: today }, now)).toBe(false);
  });
});
