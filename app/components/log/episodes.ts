import type { Symptom } from '@/lib/db/schema';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// The same rules as the trigger finder in lib/analysis/triggers.ts uses to count a symptom's episodes.
/** A symptom logged again this soon after its previous log, with no duration known, is the same episode. */
const EPISODE_GAP = 6 * HOUR;
/** A symptom logged again this soon after its logged duration ended is the same episode. */
const EPISODE_GRACE = HOUR;
/** Longest logged duration taken at face value. */
const MAX_DURATION = 24 * HOUR;

/** How long after an earlier log that may still be going the Log screen asks whether a new log is the same one. */
export const ASK_WITHIN = 24 * HOUR;

const key = (name: string) => name.trim().toLowerCase();

/** True when the entry is marked still going or does not say how long it lasted. */
export function mayStillBeGoing(s: Symptom): boolean {
  return Boolean(s.ongoing) || !(typeof s.duration_minutes === 'number' && s.duration_minutes > 0);
}

/**
 * The earlier entry a new log of a symptom may belong to, or null when there is nothing to ask.
 *
 * The trigger finder treats a log more than 6 hours after the previous one, when that one is still going or
 * has no duration, as a new start of the symptom. If it is really the same one, logged again hours later,
 * whatever the person did in between (lying down, a painkiller) can look like a trigger. Only the person
 * knows, so the Log screen asks. It asks only when the latest earlier log of the same symptom started more
 * than 6 and at most 24 hours before the new one and is still going or has no duration, and no earlier log
 * reaches the new one either (as a long logged duration would).
 */
export function openEarlierLog(symptoms: Symptom[], name: string, start: number): Symptom | null {
  const k = key(name);
  let latest: { s: Symptom; t: number } | null = null;
  let end = -Infinity;
  for (const s of symptoms) {
    if (key(s.name) !== k) continue;
    const t = Date.parse(s.timestamp);
    if (!(t < start)) continue;
    const dur =
      !s.ongoing && typeof s.duration_minutes === 'number' && s.duration_minutes > 0
        ? Math.min(s.duration_minutes * MINUTE, MAX_DURATION)
        : null;
    end = Math.max(end, t + (dur == null ? EPISODE_GAP : dur + EPISODE_GRACE));
    if (!latest || t > latest.t) latest = { s, t };
  }
  if (!latest || !mayStillBeGoing(latest.s)) return null;
  const gap = start - latest.t;
  return gap > EPISODE_GAP && gap <= ASK_WITHIN && start > end ? latest.s : null;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "Yesterday" for yesterday, otherwise the day of the week, as in "Tue". */
export function dayWord(d: Date, now = new Date()): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return d.toDateString() === yesterday.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short' });
}

/**
 * When an entry started, in words. `at` reads "at 8:10 AM" today, "yesterday at 10:00 PM", or "on Tuesday,
 * Nov 10 at 10:00 PM" for an older day. `since` reads the same with "since" in front.
 */
export function startedAt(iso: string, now = new Date()): { at: string; since: string } {
  const d = new Date(iso);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return { at: `at ${clock(d)}`, since: `since ${clock(d)}` };
  const day =
    d.toDateString() === yesterday.toDateString()
      ? 'yesterday'
      : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const text = `${day} at ${clock(d)}`;
  return { at: day === 'yesterday' ? text : `on ${text}`, since: `since ${text}` };
}

/**
 * True for an entry that started before today, within the last 24 hours, is still going and was updated today,
 * as "Same one" does. The Today list shows it, so the person sees what their log did.
 */
export function continuedToday(s: Symptom, now = new Date()): boolean {
  const today = now.toDateString();
  const started = Date.parse(s.timestamp);
  return (
    Boolean(s.ongoing) &&
    Boolean(s.updatedAt) &&
    new Date(s.updatedAt!).toDateString() === today &&
    new Date(started).toDateString() !== today &&
    now.getTime() - started < ASK_WITHIN
  );
}
