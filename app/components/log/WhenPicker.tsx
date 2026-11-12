'use client';

import * as React from 'react';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/field';
import { cn, fromLocalInputValue, toLocalInputValue } from '@/lib/utils';

/**
 * What the person picked, not a time. "1 hr ago" has to mean an hour before the entry is saved, even when the
 * screen stayed open for a while, so the time is worked out with resolveWhen when Save is tapped.
 * For "Earlier", local is the value of the date and time field.
 */
export type When = { kind: 'now' } | { kind: 'ago'; minutes: number } | { kind: 'at'; local: string };

export const WHEN_NOW: When = { kind: 'now' };

/** The time to save. Null means "Earlier" is picked but the date or time is empty or not complete. */
export function resolveWhen(when: When, now: number = Date.now()): Date | null {
  if (when.kind === 'now') return new Date(now);
  if (when.kind === 'ago') return new Date(now - when.minutes * 60_000);
  return fromLocalInputValue(when.local);
}

const AGO = [
  { minutes: 60, label: '1 hr ago' },
  { minutes: 180, label: '3 hrs ago' },
];

/** Lets the person log something that happened earlier. The parent keeps the choice and resets it after a save. */
export function WhenPicker({
  value,
  onChange,
  label = 'When',
}: {
  value: When;
  onChange: (when: When) => void;
  label?: string;
}) {
  const id = React.useId();
  const incomplete = value.kind === 'at' && !fromLocalInputValue(value.local);

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-fg mb-2">{label}</legend>
      <div className="grid grid-cols-4 gap-2">
        <Chip selected={value.kind === 'now'} onClick={() => onChange(WHEN_NOW)} className="px-2 text-center text-sm">
          Now
        </Chip>
        {AGO.map(a => (
          <Chip
            key={a.minutes}
            selected={value.kind === 'ago' && value.minutes === a.minutes}
            onClick={() => onChange({ kind: 'ago', minutes: a.minutes })}
            className="px-2 text-center text-sm"
          >
            {a.label}
          </Chip>
        ))}
        <Chip
          selected={value.kind === 'at'}
          onClick={() => {
            if (value.kind !== 'at') onChange({ kind: 'at', local: toLocalInputValue(new Date()) });
          }}
          className="px-2 text-center text-sm"
        >
          Earlier
        </Chip>
      </div>
      {value.kind === 'at' && (
        <div className="mt-2">
          <label htmlFor={id} className="sr-only">
            Date and time
          </label>
          <Input
            id={id}
            type="datetime-local"
            value={value.local}
            max={toLocalInputValue(new Date())}
            aria-invalid={incomplete || undefined}
            aria-describedby={incomplete ? `${id}-hint` : undefined}
            className={cn(incomplete && 'border-danger')}
            onChange={e => onChange({ kind: 'at', local: e.target.value })}
          />
          {incomplete && (
            <p id={`${id}-hint`} className="mt-1.5 text-sm font-medium text-danger">
              Enter a full date and time.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
