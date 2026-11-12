import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ImportResult } from '@/lib/db/backup';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // randomUUID throws outside secure contexts in some browsers
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Fill (color), text color (on) and border (edge) of a chosen severity button. The text stays readable on the
 * fill, and the border makes the chosen button stand out from the page, in both themes.
 */
export const SEVERITY_LEVELS = [
  {
    value: 2,
    label: 'Mild',
    hint: 'Noticeable, not limiting',
    color: 'var(--sev-1)',
    on: 'var(--on-sev-1)',
    edge: 'var(--edge-sev-1)',
  },
  {
    value: 5,
    label: 'Moderate',
    hint: 'Gets in the way',
    color: 'var(--sev-2)',
    on: 'var(--on-sev-2)',
    edge: 'var(--edge-sev-2)',
  },
  {
    value: 7,
    label: 'Severe',
    hint: 'Hard to function',
    color: 'var(--sev-3)',
    on: 'var(--on-sev-3)',
    edge: 'var(--edge-sev-3)',
  },
  {
    value: 9,
    label: 'Very severe',
    hint: 'Can’t do much at all',
    color: 'var(--sev-4)',
    on: 'var(--on-sev-4)',
    edge: 'var(--edge-sev-4)',
  },
] as const;

export function severityLabel(value: number): string {
  if (value <= 3) return 'Mild';
  if (value <= 6) return 'Moderate';
  if (value <= 8) return 'Severe';
  return 'Very severe';
}

export function severityColor(value: number): string {
  if (value <= 3) return 'var(--sev-1)';
  if (value <= 6) return 'var(--sev-2)';
  if (value <= 8) return 'var(--sev-3)';
  return 'var(--sev-4)';
}

export function formatDuration(minutes?: number, ongoing?: boolean): string | null {
  if (ongoing) return 'Ongoing';
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hr`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** "1 symptom" or "3 symptoms". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c". */
function andList(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What a restore did, for the toast after a backup is restored. The counts are rows actually written, so a
 * second restore of the same file says nothing was new. Entries kept because they were changed on this
 * device after the backup was made are counted too.
 */
export function describeRestore(r: ImportResult): string {
  const restored = [
    r.symptoms && plural(r.symptoms, 'symptom', 'symptoms'),
    r.factors && plural(r.factors, 'other entry', 'other entries'),
    r.schedules && plural(r.schedules, 'medication', 'medications'),
    r.doses && plural(r.doses, 'dose', 'doses'),
  ].filter((p): p is string => Boolean(p));
  const out: string[] = [];
  if (restored.length) out.push(`Restored ${andList(restored)}.`);
  else if (r.keptLocal || r.skipped) out.push('Nothing new to add.');
  else out.push('Everything in this file was already on this device.');
  if (r.keptLocal) {
    out.push(`Kept ${plural(r.keptLocal, 'entry', 'entries')} you changed on this device after the backup was made.`);
  }
  if (r.skipped) out.push(`Skipped ${plural(r.skipped, 'unreadable row', 'unreadable rows')}.`);
  return out.join(' ');
}
