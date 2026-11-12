'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { cleanName, db } from '@/lib/db/client';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { CATEGORY_LABELS, COMMON_SYMPTOMS, FACTOR_GROUPS } from '@/lib/catalog';
import type { Factor, FactorCategory } from '@/lib/db/schema';
import { cn, errorMessage, plural } from '@/lib/utils';

const key = (name: string) => cleanName(name).toLowerCase();
const same = (a: string, b: string) => key(a) === key(b);

/** The remembered symptoms shown under "Yours" on the Log screen. Listed symptoms keep their own place. */
export function yourSymptoms(remembered: string[]): string[] {
  return remembered.filter(
    (s, i) => !COMMON_SYMPTOMS.some(c => same(c, s)) && remembered.findIndex(o => same(o, s)) === i,
  );
}

const BUILT_IN_ITEMS = FACTOR_GROUPS.flatMap(g => g.items);

/** The remembered items shown under "Yours" on the Log screen. Items that have a chip of their own are left out. */
export function yourItems(remembered: { name: string; category: FactorCategory }[]) {
  return remembered.filter(
    (f, i) => !BUILT_IN_ITEMS.some(b => same(b.name, f.name)) && remembered.findIndex(o => same(o.name, f.name)) === i,
  );
}

/** Where to put a row back so the list keeps the order the sheet shows, after the rows above it still listed. */
function placeOf(name: string, shown: string[], listed: (name: string) => boolean): number {
  return shown.slice(0, shown.indexOf(name)).filter(listed).length;
}

function RemoveButton({ name, gone, onClick }: { name: string; gone: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={onClick}
      aria-label={gone ? `Undo removing ${name}` : `Remove ${name}`}
      className="shrink-0"
    >
      {gone ? 'Undo' : 'Remove'}
    </Button>
  );
}

async function attempt(work: () => Promise<void>) {
  try {
    await work();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/**
 * The symptoms the person added themselves. Removing one only takes it off the Log screen. A removed symptom
 * keeps its row with Undo until the sheet closes, because a toast cannot be reached while a sheet is open.
 */
export function YourSymptomsSheet({ onClose }: { onClose: () => void }) {
  const { prefs } = useHealthData();
  const current = yourSymptoms(prefs.customSymptoms);
  // The rows as they were when the sheet opened, so a removed one stays in place.
  const [shown] = React.useState(current);
  const listed = (name: string) => prefs.customSymptoms.some(s => same(s, name));

  const toggle = (name: string) =>
    attempt(() =>
      listed(name) ? db.forgetCustomSymptom(name) : db.putBackCustomSymptom(name, placeOf(name, shown, listed)),
    );

  return (
    <Sheet
      open
      onOpenChange={o => !o && onClose()}
      title="Your symptoms"
      description="Remove a symptom you no longer need from the Log screen. Entries already logged stay as they are."
    >
      <Card className="divide-y divide-line">
        {shown.map(name => {
          const gone = !listed(name);
          return (
            <div key={name} className="flex items-center gap-3 px-4 py-2">
              <p className={cn('flex-1 min-w-0 truncate', gone ? 'text-subtle line-through' : 'text-fg')}>{name}</p>
              {gone && <span className="text-sm text-subtle">Removed</span>}
              <RemoveButton name={name} gone={gone} onClick={() => toggle(name)} />
            </div>
          );
        })}
      </Card>
    </Sheet>
  );
}

/**
 * The items the person added themselves. Removing one only takes it off the Log screen. A new category is
 * used for what is logged from now on. Entries already logged keep theirs unless the person asks to change
 * them too. The trigger finder groups entries by name only, so a mix of categories never splits an item.
 */
export function YourItemsSheet({ onClose }: { onClose: () => void }) {
  const { prefs, factors } = useHealthData();
  const current = yourItems(prefs.customFactors);
  // The rows as they were when the sheet opened, so a removed one stays in place.
  const [shown] = React.useState(() => current.map(f => f.name));
  // The category picked here for each row. It shows at once, and a removed item comes back with it.
  const [picked, setPicked] = React.useState<ReadonlyMap<string, FactorCategory>>(new Map());
  // Items whose category was changed here. Only these offer to change the entries already logged.
  const [changed, setChanged] = React.useState<ReadonlySet<string>>(new Set());
  // Entries changed to a new category here, as they were before, for Undo.
  const [moved, setMoved] = React.useState<ReadonlyMap<string, { rows: Factor[]; to: FactorCategory }>>(new Map());
  const find = (name: string) => current.find(f => same(f.name, name));
  const listed = (name: string) => prefs.customFactors.some(f => same(f.name, name));
  const categoryOf = (name: string): FactorCategory => picked.get(key(name)) ?? find(name)?.category ?? 'other';
  const forgetMove = (name: string) =>
    setMoved(m => {
      const next = new Map(m);
      next.delete(key(name));
      return next;
    });

  const toggle = (name: string) =>
    attempt(async () => {
      const category = categoryOf(name);
      setPicked(m => new Map(m).set(key(name), category));
      if (find(name)) await db.forgetCustomFactor(name);
      else await db.putBackCustomFactor({ name, category }, placeOf(name, shown, listed));
    });

  const setCategory = async (name: string, category: FactorCategory) => {
    const before = picked;
    setPicked(m => new Map(m).set(key(name), category));
    setChanged(s => new Set(s).add(key(name)));
    forgetMove(name);
    try {
      await db.setCustomFactorCategory(name, category);
    } catch (e) {
      setPicked(before);
      toast.error(errorMessage(e));
    }
  };

  const moveLogged = (name: string, to: FactorCategory) =>
    attempt(async () => {
      const rows = await db.setLoggedFactorCategory(name, to);
      setMoved(m => new Map(m).set(key(name), { rows, to }));
    });

  const undoMove = (name: string) =>
    attempt(async () => {
      for (const row of moved.get(key(name))?.rows ?? []) await db.restoreFactor(row);
      forgetMove(name);
    });

  return (
    <Sheet
      open
      onOpenChange={o => !o && onClose()}
      title="Your items"
      description="Remove an item you no longer need, or change the category it is saved with. Entries already logged keep theirs unless you change them too."
    >
      <Card className="divide-y divide-line">
        {shown.map((name, i) => {
          const gone = !find(name);
          const category = categoryOf(name);
          const done = moved.get(key(name));
          // Entries of this item logged under another category, once its category was changed here.
          const other = changed.has(key(name))
            ? factors.filter(f => same(f.name, name) && f.category !== category)
            : [];
          const from = [...new Set(other.map(f => f.category))];
          const message = done
            ? `${plural(done.rows.length, 'earlier entry', 'earlier entries')} changed to ${CATEGORY_LABELS[done.to]}.`
            : other.length
              ? `${plural(other.length, 'earlier entry is', 'earlier entries are')} under ${
                  from.length === 1 ? CATEGORY_LABELS[from[0]] : 'other categories'
                }.`
              : '';
          const id = `your-item-${i}`;
          return (
            <div key={name} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <p className={cn('flex-1 min-w-0 truncate font-medium', gone ? 'text-subtle line-through' : 'text-fg')}>
                  {name}
                </p>
                {gone && <span className="text-sm text-subtle">Removed</span>}
                <RemoveButton name={name} gone={gone} onClick={() => toggle(name)} />
              </div>
              {!gone && (
                <>
                  <div className="mt-2 flex items-center gap-3">
                    <label htmlFor={id} className="text-sm text-muted shrink-0">
                      Category<span className="sr-only"> of {name}</span>
                    </label>
                    <Select
                      id={id}
                      value={category}
                      onChange={e => setCategory(name, e.target.value as FactorCategory)}
                      className="h-10"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {/* Always in the page, so screen readers announce the message when it appears. */}
                  <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', message && 'mt-2')}>
                    <p role="status" className="flex-1 min-w-40 text-sm text-muted">
                      {message}
                    </p>
                    {done ? (
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => undoMove(name)}
                        aria-label={`Undo changing earlier entries of ${name}`}
                        className="shrink-0"
                      >
                        Undo
                      </Button>
                    ) : (
                      other.length > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => moveLogged(name, category)}
                          className="shrink-0"
                        >
                          Change {other.length === 1 ? 'it' : 'them'} to {CATEGORY_LABELS[category]}
                        </Button>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </Card>
    </Sheet>
  );
}
