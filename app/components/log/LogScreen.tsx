'use client';

import * as React from 'react';
import { ChevronLeft, Plus, Flame, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Chip, Segmented } from '@/components/ui/chip';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Card, SectionTitle } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { WHEN_NOW, WhenPicker, resolveWhen, type When } from './WhenPicker';
import { continuedToday, dayWord, openEarlierLog, startedAt } from './episodes';
import { YourItemsSheet, YourSymptomsSheet, yourItems, yourSymptoms } from './YoursSheet';
import { cleanName, db, requestPersistentStorage } from '@/lib/db/client';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { COMMON_SYMPTOMS, DURATION_OPTIONS, FACTOR_GROUPS, CATEGORY_LABELS } from '@/lib/catalog';
import type { FactorCategory, Symptom } from '@/lib/db/schema';
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

/** What the person entered, kept while the Log screen asks whether it is the same symptom as an earlier entry. */
type SymptomDraft = { name: string; severity: number; at: Date; duration: number; note: string };

function SymptomFlow() {
  const { prefs, symptoms } = useHealthData();
  const [name, setName] = React.useState<string | null>(null);
  const [custom, setCustom] = React.useState('');
  const [severity, setSeverity] = React.useState<number | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [when, setWhen] = React.useState<When>(WHEN_NOW);
  const [note, setNote] = React.useState('');
  const [showNote, setShowNote] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [asking, setAsking] = React.useState<{ draft: SymptomDraft; earlier: Symptom } | null>(null);
  // One answer per question, also when a tap on a button and a tap outside the sheet arrive together.
  const answered = React.useRef(false);
  const timeMissing = resolveWhen(when) === null;

  const yours = React.useMemo(() => yourSymptoms(prefs.customSymptoms), [prefs.customSymptoms]);
  const options = React.useMemo(() => [...yours, ...COMMON_SYMPTOMS], [yours]);

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

  const remember = async (symptom: string) => {
    if (!COMMON_SYMPTOMS.some(s => s.toLowerCase() === symptom.toLowerCase())) {
      await db.rememberCustomSymptom(symptom);
    }
  };

  const saveNew = async (draft: SymptomDraft) => {
    setSaving(true);
    const d = DURATION_OPTIONS[draft.duration];
    try {
      const saved = await db.addSymptom({
        id: newId(),
        name: draft.name,
        severity: draft.severity,
        timestamp: draft.at.toISOString(),
        duration_minutes: d.minutes,
        ongoing: d.ongoing,
        notes: draft.note,
      });
      await remember(draft.name);
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

  /** For "Same one". No new entry is added. The earlier entry stays still going and takes the new rating and note. */
  const addToEarlier = async ({ draft, earlier }: { draft: SymptomDraft; earlier: Symptom }) => {
    setSaving(true);
    try {
      const { before, after } = await db.continueSymptom(earlier.id, { severity: draft.severity, notes: draft.note });
      await remember(draft.name);
      const level = severityLabel(after.severity);
      const raised = level !== severityLabel(before.severity) ? `, now ${level.toLowerCase()}` : '';
      toast.success(`${after.name} updated`, {
        description: `Still going ${startedAt(before.timestamp).since}${raised}. No new entry was added.`,
        // Puts the earlier entry back exactly as it was.
        action: { label: 'Undo', onClick: () => db.restoreSymptom(before) },
      });
      reset();
      afterFirstLog();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!name || severity == null) return;
    // Work out the time now, so "1 hr ago" means an hour before Save was tapped.
    const at = resolveWhen(when);
    if (!at) {
      toast.error('Please enter a valid date and time');
      return;
    }
    const draft: SymptomDraft = { name, severity, at, duration, note };
    // Logged again hours after an earlier entry that may still be going. Saved as a new entry, it would count as
    // a new start, and whatever was done in between could look like a trigger. Only the person knows, so ask.
    // A time in the future is left for the save to refuse.
    const earlier = at.getTime() <= Date.now() ? openEarlierLog(symptoms, name, at.getTime()) : null;
    if (earlier) {
      answered.current = false;
      setAsking({ draft, earlier });
      return;
    }
    await saveNew(draft);
  };

  /** Closing the question without an answer saves a new entry, as if the question had not been asked. */
  const answer = (sameOne: boolean) => {
    if (!asking || answered.current) return;
    answered.current = true;
    setAsking(null);
    void (sameOne ? addToEarlier(asking) : saveNew(asking.draft));
  };

  if (!name) {
    const chips = (list: string[]) => (
      <div className="grid grid-cols-2 gap-2">
        {list.map(s => (
          <Chip key={s} onClick={() => setName(s)} className="truncate">
            {s}
          </Chip>
        ))}
      </div>
    );
    return (
      <div>
        {yours.length > 0 ? (
          <div className="space-y-5">
            <ChipGroup title="Yours" edit={{ label: 'your symptoms', onClick: () => setEditing(true) }}>
              {chips(yours)}
            </ChipGroup>
            <ChipGroup title="Common">{chips(COMMON_SYMPTOMS)}</ChipGroup>
          </div>
        ) : (
          chips(COMMON_SYMPTOMS)
        )}
        {editing && <YourSymptomsSheet onClose={() => setEditing(false)} />}
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
                // The text color is set per level and theme so the label and hint stay readable on the fill. The
                // border is a darker shade (lighter in the dark theme), so the chosen button stands out from the page.
                style={selected ? { backgroundColor: l.color, borderColor: l.edge, color: l.on } : undefined}
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

      {asking && <SameSymptomSheet name={asking.draft.name} earlier={asking.earlier} onAnswer={answer} />}
    </div>
  );
}

/** Asks whether a symptom logged again is the one from the earlier entry, still going, or a new one. */
function SameSymptomSheet({
  name,
  earlier,
  onAnswer,
}: {
  name: string;
  earlier: Symptom;
  onAnswer: (sameOne: boolean) => void;
}) {
  const lower = name.toLowerCase();
  const how = earlier.ongoing ? 'as still going' : 'without saying how long it lasted';
  return (
    <Sheet
      open
      onOpenChange={o => !o && onAnswer(false)}
      title={`Is this the same ${lower}?`}
      description={`You logged ${lower} ${startedAt(earlier.timestamp).at} ${how}. If it has not stopped since, it is the same one.`}
    >
      <div className="grid gap-2 pt-1">
        <Button size="lg" block onClick={() => onAnswer(true)}>
          Same one, still going
        </Button>
        <Button size="lg" block variant="secondary" onClick={() => onAnswer(false)}>
          New one
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * A group of chips with a title. With `edit`, the title row also has an Edit button. The title then stays the
 * group's name for screen readers, without the button's words in it.
 */
function ChipGroup({
  title,
  edit,
  children,
}: {
  title: string;
  edit?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      {edit ? (
        <>
          <legend className="sr-only">{title}</legend>
          <div className="flex items-center justify-between gap-3 mb-2">
            <span aria-hidden className="text-sm font-semibold text-fg">
              {title}
            </span>
            <Button variant="quiet" size="sm" onClick={edit.onClick} className="h-8 -my-1 -mr-2">
              <Pencil aria-hidden /> Edit<span className="sr-only"> {edit.label}</span>
            </Button>
          </div>
        </>
      ) : (
        <legend className="text-sm font-semibold text-fg mb-2">{title}</legend>
      )}
      {children}
    </fieldset>
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
  const [editing, setEditing] = React.useState(false);
  const timeMissing = resolveWhen(when) === null;

  const builtIn = new Set(FACTOR_GROUPS.flatMap(g => g.items.map(i => i.name.toLowerCase())));
  const yours = yourItems(prefs.customFactors);

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

  // Every selected item needs a chip that shows it. The chips match names exactly, so this check must too. Another
  // tab can remember "Kombucha" while "kombucha" is selected here, and that item must not disappear from view.
  const chipNames = new Set([...FACTOR_GROUPS.flatMap(g => g.items.map(i => i.name)), ...yours.map(y => y.name)]);
  const extraSelected = [...selected.entries()].filter(([n]) => !chipNames.has(n));

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
          edit={yours.length > 0 ? { label: 'your items', onClick: () => setEditing(true) } : undefined}
        />
      )}
      {FACTOR_GROUPS.map(g => (
        <FactorGroup key={g.title} title={g.title} items={g.items} selected={selected} onToggle={toggle} />
      ))}
      {/* Outside the group, so the sheet stays open when the last item is removed. */}
      {editing && <YourItemsSheet onClose={() => setEditing(false)} />}

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
  edit,
}: {
  title: string;
  items: { name: string; category: FactorCategory }[];
  selected: Map<string, FactorCategory>;
  onToggle: (name: string, category: FactorCategory) => void;
  edit?: { label: string; onClick: () => void };
}) {
  return (
    <ChipGroup title={title} edit={edit}>
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
    </ChipGroup>
  );
}

function TodayList() {
  const { symptoms, factors } = useHealthData();
  const now = new Date();
  const today = now.toDateString();
  const items = [
    ...symptoms
      // A symptom still going from yesterday that was logged again today as the same one is listed too.
      .filter(s => new Date(s.timestamp).toDateString() === today || continuedToday(s, now))
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
              {new Date(i.t).toDateString() !== today && (
                <span className="block text-[12px]">{dayWord(new Date(i.t), now)}</span>
              )}
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
