import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

/** Fill (color) and text color (on) of a chosen severity button. The pair stays readable in both themes. */
export const SEVERITY_LEVELS = [
  { value: 2, label: 'Mild', hint: 'Noticeable, not limiting', color: 'var(--sev-1)', on: 'var(--on-sev-1)' },
  { value: 5, label: 'Moderate', hint: 'Gets in the way', color: 'var(--sev-2)', on: 'var(--on-sev-2)' },
  { value: 7, label: 'Severe', hint: 'Hard to function', color: 'var(--sev-3)', on: 'var(--on-sev-3)' },
  { value: 9, label: 'Very severe', hint: 'Can’t do much at all', color: 'var(--sev-4)', on: 'var(--on-sev-4)' },
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
