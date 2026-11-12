'use client';

import * as React from 'react';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/field';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/utils';

type Choice = 'now' | '1h' | '3h' | 'custom';

/** Lets the person log something that happened earlier. Returns the chosen time through onChange. */
export function WhenPicker({ onChange, label = 'When' }: { onChange: (d: Date | null) => void; label?: string }) {
  const [choice, setChoice] = React.useState<Choice>('now');
  const [custom, setCustom] = React.useState(() => toLocalInputValue(new Date()));
  const id = React.useId();

  React.useEffect(() => {
    const now = Date.now();
    if (choice === 'now') onChange(null);
    else if (choice === '1h') onChange(new Date(now - 60 * 60_000));
    else if (choice === '3h') onChange(new Date(now - 3 * 60 * 60_000));
    else onChange(fromLocalInputValue(custom));
  }, [choice, custom, onChange]);

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-fg mb-2">{label}</legend>
      <div className="grid grid-cols-4 gap-2">
        <Chip selected={choice === 'now'} onClick={() => setChoice('now')} className="px-2 text-center text-sm">
          Now
        </Chip>
        <Chip selected={choice === '1h'} onClick={() => setChoice('1h')} className="px-2 text-center text-sm">
          1 hr ago
        </Chip>
        <Chip selected={choice === '3h'} onClick={() => setChoice('3h')} className="px-2 text-center text-sm">
          3 hrs ago
        </Chip>
        <Chip selected={choice === 'custom'} onClick={() => setChoice('custom')} className="px-2 text-center text-sm">
          Earlier
        </Chip>
      </div>
      {choice === 'custom' && (
        <div className="mt-2">
          <label htmlFor={id} className="sr-only">
            Date and time
          </label>
          <Input
            id={id}
            type="datetime-local"
            value={custom}
            max={toLocalInputValue(new Date())}
            onChange={e => setCustom(e.target.value)}
          />
        </div>
      )}
    </fieldset>
  );
}
