'use client';

import * as React from 'react';
import { ChevronLeft, Plus, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Chip, Segmented } from '@/components/ui/chip';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Card, SectionTitle } from '@/components/ui/card';
import { WHEN_NOW, WhenPicker, resolveWhen, type When } from './WhenPicker';
import { cleanName, db, requestPersistentStorage } from '@/lib/db/client';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { COMMON_SYMPTOMS, DURATION_OPTIONS, FACTOR_GROUPS, CATEGORY_LABELS } from '@/lib/catalog';
import type { FactorCategory } from '@/lib/db/schema';
import { SEVERITY_LEVELS, cn, errorMessage, newId, severityColor, severityLabel, formatDuration } from '@/lib/utils';

type Mode = 'symptom' | 'factor';

export function LogScreen() {
  const [mode, setMode] = React.useState<Mode>('symptom');
  return (
    <div>
      <Header />
      <Segmented<Mode>
        label="What to log"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'symptom', label: 'How I feel' },
          { value: 'factor', label: 'What I had or did' },
        ]}
      />
      <div className="mt-4">{mode === 'symptom' ? <SymptomFlow /> : <FactorFlow />}</div>
      <TodayList />
    </div>
  );
}

function Header() {
  const { prefs, symptoms, factors } = useHealthData();
  const streak = db.currentStreak(prefs);
  const total = symptoms.length + factors.length;
  return (
    <div className="flex items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-2xl font-bold text-fg">Log</h1>
        <p className="text-sm text-muted">
          {total === 0
            ? 'Takes a few seconds. Everything stays on this device.'
            : 'Log symptoms, and what you ate or did.'}
        </p>
      </div>
      {streak > 1 && (
        <div
          className="flex items-center gap-1 rounded-full bg-warn-soft text-warn px-3 py-1 text-sm font-semibold whitespace-nowrap shrink-0"
          title="Days in a row with a log"
        >
          <Flame className="size-4" aria-hidden />
          {streak} days
        </div>
      )}
    </div>
  );
}

async function afterFirstLog() {
  // Ask the browser not to evict our data under storage pressure.
  await requestPersistentStorage();
}

function SymptomFlow() {
  const { prefs } = useHealthData();
  const [name, setName] = React.useState<string | null>(null);
  const [custom, setCustom] = React.useState('');
  const [severity, setSeverity] = React.useState<number | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [when, setWhen] = React.useState<When>(WHEN_NOW);
  const [note, setNote] = React.useState('');
  const [showNote, setShowNote] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const timeMissing = resolveWhen(when) === null;

  const options = React.useMemo(() => {
    const seen = new Set<string>();
    return [...prefs.customSymptoms, ...COMMON_SYMPTOMS].filter(s => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [prefs.customSymptoms]);

  const reset = () => {
    setName(null);
    setSeverity(null);
    setDuration(0);
    setNote('');
    setShowNote(false);
    setWhen(WHEN_NOW);
  };

  const pickCustom = () => {
    const v = cleanName(custom);
    if (!v) return;
    // Typing a symptom that is already listed uses the listed spelling, so History shows one name for it.
    setName(options.find(o => o.toLowerCase() === v.toLowerCase()) ?? v);
    setCustom('');
  };

  const save = async () => {
    if (!name || severity == null) return;
    // Work out the time now, so "1 hr ago" means an hour before Save was tapped.
    const at = resolveWhen(when);
    if (!at) {
      toast.error('Please enter a valid date and time');
      return;
    }
    setSaving(true);
    const d = DURATION_OPTIONS[duration];
    try {
      const saved = await db.addSymptom({
        id: newId(),
        name,
        severity,
        timestamp: at.toISOString(),
        duration_minutes: d.minutes,
        ongoing: d.ongoing,
        notes: note,
      });
      if (!COMMON_SYMPTOMS.some(s => s.toLowerCase() === name.toLowerCase())) {
        await db.rememberCustomSymptom(name);
      }
      toast.success(`${saved.name} logged`, {
        description: severityLabel(saved.severity),
        action: { label: 'Undo', onClick: () => db.deleteSymptom(saved.id) },
      });
      reset();
      afterFirstLog();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (!name) {
    return (
      <div>
        <div className="grid grid-cols-2 gap-2">
          {options.map(s => (
            <Chip key={s} onClick={() => setName(s)} className="truncate">
              {s}
            </Chip>
          ))}
        </div>
        <form
          className="flex gap-2 mt-3"
          onSubmit={e => {
            e.preventDefault();
            pickCustom();
          }}
        >
          <label htmlFor="custom-symptom" className="sr-only">
            Other symptom
          </label>
          <Input
            id="custom-symptom"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            placeholder="Something else"
            maxLength={60}
            autoComplete="off"
            enterKeyHint="next"
          />
          <Button type="submit" variant="secondary" disabled={!custom.trim()} className="h-12 shrink-0">
            <Plus /> Add
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="quiet" size="sm" onClick={reset} className="-ml-2">
          <ChevronLeft /> Back
        </Button>
        <h2 className="text-xl font-bold text-fg truncate">{name}</h2>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">How bad is it?</legend>
        <div className="grid grid-cols-2 gap-2">
          {SEVERITY_LEVELS.map(l => {
            const selected = severity === l.value;
            return (
              <button
                key={l.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setSeverity(l.value)}
                className={cn(
                  'min-h-20 rounded-xl border-2 p-3 text-left transition-colors',
                  !selected && 'bg-surface border-line-strong hover:border-accent',
                )}
                // The text color is set per level and theme so the label and hint stay readable on the fill.
                style={selected ? { backgroundColor: l.color, borderColor: l.color, color: l.on } : undefined}
              >
                <span className="flex items-center gap-2 font-semibold">
                  {!selected && (
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                  )}
                  {l.label}
                </span>
                <span className={cn('block text-[13px] mt-0.5', !selected && 'text-muted')}>{l.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <WhenPicker value={when} onChange={setWhen} label="When did it start?" />

      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">How long did it last?</legend>
        <div className="flex flex-wrap gap-2">
          {DURATION_OPTIONS.map((d, i) => (
            <Chip
              key={d.label}
              selected={duration === i}
              onClick={() => setDuration(i)}
              className="text-sm min-h-10 px-3"
            >
              {d.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      {showNote ? (
        <div>
          <label htmlFor="symptom-note" className="text-sm font-semibold text-fg mb-2 block">
            Note
          </label>
          <Textarea
            id="symptom-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Anything worth remembering"
            autoFocus
          />
        </div>
      ) : (
        <button type="button" onClick={() => setShowNote(true)} className="text-sm font-semibold text-accent">
          Add a note
        </button>
      )}

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] pt-2 bg-gradient-to-t from-bg via-bg to-transparent">
        <Button block size="lg" onClick={save} disabled={severity == null || timeMissing || saving}>
          {saving
            ? 'Saving…'
            : severity == null
              ? 'Choose how bad it is'
              : timeMissing
                ? 'Enter a date and time'
                : `Save ${name.toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}

function FactorFlow() {
  const { prefs } = useHealthData();
  const [selected, setSelected] = React.useState<Map<string, FactorCategory>>(new Map());
  const [when, setWhen] = React.useState<When>(WHEN_NOW);
  const [custom, setCustom] = React.useState('');
  const [customCategory, setCustomCategory] = React.useState<FactorCategory>('food');
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const timeMissing = resolveWhen(when) === null;

  const builtIn = new Set(FACTOR_GROUPS.flatMap(g => g.items.map(i => i.name.toLowerCase())));
  const yours = prefs.customFactors.filter(f => !builtIn.has(f.name.toLowerCase()));

  const toggle = (name: string, category: FactorCategory) =>
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(name)) next.delete(name);
      else next.set(name, category);
      return next;
    });

  const addCustom = () => {
    const v = cleanName(custom);
    if (!v) return;
    const k = v.toLowerCase();
    // A name that matches a chip on screen, in any case, selects that chip with its own spelling and category. The
    // item then shows as selected, can be unselected, and is never saved twice or under the wrong category.
    const existing =
      FACTOR_GROUPS.flatMap(g => g.items).find(i => i.name.toLowerCase() === k) ??
      yours.find(i => i.name.toLowerCase() === k);
    setSelected(prev => {
      const next = new Map(prev);
      if (existing) next.set(existing.name, existing.category);
      else next.set([...next.keys()].find(n => n.toLowerCase() === k) ?? v, customCategory);
      return next;
    });
    setCustom('');
  };

  const save = async () => {
    if (!selected.size) return;
    // Work out the time now, so "1 hr ago" means an hour before Save was tapped.
    const at = resolveWhen(when);
    if (!at) {
      toast.error('Please enter a valid date and time');
      return;
    }
    setSaving(true);
    const ts = at.toISOString();
    const rows = [...selected.entries()].map(([name, category]) => ({
      id: newId(),
      name,
      category,
      timestamp: ts,
      notes: note,
    }));
    try {
      await db.addFactors(rows);
      for (const r of rows) {
        if (!builtIn.has(r.name.toLowerCase())) await db.rememberCustomFactor(r.name, r.category);
      }
      toast.success(rows.length === 1 ? `${rows[0].name} logged` : `${rows.length} items logged`, {
        action: { label: 'Undo', onClick: () => rows.forEach(r => db.deleteFactor(r.id)) },
      });
      setSelected(new Map());
      setNote('');
      setWhen(WHEN_NOW);
      afterFirstLog();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const extraSelected = [...selected.entries()].filter(
    ([n]) => !builtIn.has(n.toLowerCase()) && !yours.some(y => y.name.toLowerCase() === n.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Pick everything that applies. Logging these is what lets the app spot delayed triggers, like a food that bothers
        you the next day.
      </p>

      {(yours.length > 0 || extraSelected.length > 0) && (
        <FactorGroup
          title="Yours"
          items={[...yours, ...extraSelected.map(([name, category]) => ({ name, category }))]}
          selected={selected}
          onToggle={toggle}
        />
      )}
      {FACTOR_GROUPS.map(g => (
        <FactorGroup key={g.title} title={g.title} items={g.items} selected={selected} onToggle={toggle} />
      ))}

      <form
        className="space-y-2"
        onSubmit={e => {
          e.preventDefault();
          addCustom();
        }}
      >
        <label htmlFor="custom-factor" className="text-sm font-semibold text-fg block">
          Something else
        </label>
        <div className="flex gap-2">
          <Input
            id="custom-factor"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            placeholder="Red wine, tomatoes, anything"
            maxLength={60}
            autoComplete="off"
          />
          <Button type="submit" variant="secondary" disabled={!custom.trim()} className="h-12 shrink-0">
            <Plus /> Add
          </Button>
        </div>
        <label htmlFor="custom-factor-cat" className="sr-only">
          Category
        </label>
        <Select
          id="custom-factor-cat"
          value={customCategory}
          onChange={e => setCustomCategory(e.target.value as FactorCategory)}
        >
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </form>

      <WhenPicker value={when} onChange={setWhen} />

      <div>
        <label htmlFor="factor-note" className="text-sm font-semibold text-fg mb-2 block">
          Note <span className="font-normal text-subtle">(optional)</span>
        </label>
        <Input
          id="factor-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={1000}
          placeholder="Pizza at lunch"
        />
      </div>

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] pt-2 bg-gradient-to-t from-bg via-bg to-transparent">
        <Button block size="lg" onClick={save} disabled={!selected.size || timeMissing || saving}>
          {saving
            ? 'Saving…'
            : selected.size === 0
              ? 'Pick at least one'
              : timeMissing
                ? 'Enter a date and time'
                : selected.size === 1
                  ? 'Save 1 item'
                  : `Save ${selected.size} items`}
        </Button>
      </div>
    </div>
  );
}

function FactorGroup({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string;
  items: { name: string; category: FactorCategory }[];
  selected: Map<string, FactorCategory>;
  onToggle: (name: string, category: FactorCategory) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-fg mb-2">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {items.map(i => (
          <Chip
            key={i.name}
            selected={selected.has(i.name)}
            onClick={() => onToggle(i.name, i.category)}
            className="text-sm min-h-10 px-3"
          >
            {i.name}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}

function TodayList() {
  const { symptoms, factors } = useHealthData();
  const today = new Date().toDateString();
  const items = [
    ...symptoms
      .filter(s => new Date(s.timestamp).toDateString() === today)
      .map(s => ({ kind: 'symptom' as const, t: s.timestamp, s })),
    ...factors
      .filter(f => new Date(f.timestamp).toDateString() === today)
      .map(f => ({ kind: 'factor' as const, t: f.timestamp, f })),
  ].sort((a, b) => b.t.localeCompare(a.t));
  if (!items.length) return null;
  return (
    <div className="mt-8">
      <SectionTitle>Today</SectionTitle>
      <Card className="divide-y divide-line">
        {items.map(i => (
          <div key={i.kind === 'symptom' ? i.s.id : i.f.id} className="flex items-center gap-3 px-4 py-3">
            <span className="text-sm text-subtle w-16 shrink-0 tabular-nums">
              {new Date(i.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
            {i.kind === 'symptom' ? (
              <>
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: severityColor(i.s.severity) }}
                  aria-hidden
                />
                <span className="font-medium text-fg truncate">{i.s.name}</span>
                <span className="ml-auto text-sm text-muted shrink-0">
                  {severityLabel(i.s.severity)}
                  {formatDuration(i.s.duration_minutes, i.s.ongoing)
                    ? `, ${formatDuration(i.s.duration_minutes, i.s.ongoing)}`
                    : ''}
                </span>
              </>
            ) : (
              <>
                <span className="size-2.5 rounded-sm shrink-0 bg-line-strong" aria-hidden />
                <span className="text-fg truncate">{i.f.name}</span>
                <span className="ml-auto text-sm text-subtle shrink-0">{CATEGORY_LABELS[i.f.category]}</span>
              </>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
