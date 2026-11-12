'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Segmented, Chip } from '@/components/ui/chip';
import { Input, Select, Textarea, Label } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { db } from '@/lib/db/client';
import type { Factor, FactorCategory, Symptom } from '@/lib/db/schema';
import { CATEGORY_LABELS, DURATION_OPTIONS } from '@/lib/catalog';
import {
  SEVERITY_LEVELS,
  errorMessage,
  formatDuration,
  fromLocalInputValue,
  severityColor,
  severityLabel,
  toLocalInputValue,
  cn,
} from '@/lib/utils';

type Filter = 'all' | 'symptoms' | 'factors';
type Row = { kind: 'symptom'; t: string; s: Symptom } | { kind: 'factor'; t: string; f: Factor };

const PAGE = 60;

export function HistoryScreen() {
  const { symptoms, factors, loading } = useHealthData();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState(PAGE);
  const [editing, setEditing] = React.useState<Row | null>(null);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (...fields: (string | undefined)[]) => !q || fields.some(f => f?.toLowerCase().includes(q));
    const all: Row[] = [
      ...(filter !== 'factors'
        ? symptoms
            .filter(s => match(s.name, s.notes, ...(s.tags ?? [])))
            .map(s => ({ kind: 'symptom' as const, t: s.timestamp, s }))
        : []),
      ...(filter !== 'symptoms'
        ? factors
            .filter(f => match(f.name, f.notes, CATEGORY_LABELS[f.category]))
            .map(f => ({ kind: 'factor' as const, t: f.timestamp, f }))
        : []),
    ];
    return all.sort((a, b) => b.t.localeCompare(a.t));
  }, [symptoms, factors, filter, query]);

  const visible = rows.slice(0, limit);
  const groups = React.useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of visible) {
      const d = new Date(r.t);
      const key = d.toDateString();
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [visible]);

  const remove = async (row: Row) => {
    try {
      if (row.kind === 'symptom') {
        await db.deleteSymptom(row.s.id);
        toast('Entry deleted', { action: { label: 'Undo', onClick: () => db.restoreSymptom(row.s) } });
      } else {
        await db.deleteFactor(row.f.id);
        toast('Entry deleted', { action: { label: 'Undo', onClick: () => db.restoreFactor(row.f) } });
      }
      setEditing(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-4">History</h1>
      <div className="space-y-3 mb-5">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-subtle" aria-hidden />
          <label htmlFor="history-search" className="sr-only">
            Search
          </label>
          <Input
            id="history-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search entries and notes"
            className="pl-10"
          />
        </div>
        <Segmented<Filter>
          label="Filter entries"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'symptoms', label: 'Symptoms' },
            { value: 'factors', label: 'Food & activity' },
          ]}
        />
      </div>

      {!loading && rows.length === 0 && (
        <Card className="p-6 text-center text-muted">
          {query ? 'Nothing matches that search.' : 'Nothing logged yet. Entries you log will show up here.'}
        </Card>
      )}

      <div className="space-y-5">
        {groups.map(([day, items]) => (
          <section key={day}>
            <h2 className="text-sm font-semibold text-muted mb-2">{formatDay(day)}</h2>
            <Card className="divide-y divide-line overflow-hidden">
              {items.map(r => (
                <button
                  key={r.kind === 'symptom' ? r.s.id : r.f.id}
                  // Lets the edit sheet find this entry again when a new date moves it to another day.
                  id={`entry-${r.kind}-${r.kind === 'symptom' ? r.s.id : r.f.id}`}
                  type="button"
                  onClick={() => setEditing(r)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors"
                >
                  <span className="text-sm text-subtle w-16 shrink-0 tabular-nums pt-0.5">
                    {new Date(r.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {r.kind === 'symptom' ? <SymptomRow s={r.s} /> : <FactorRow f={r.f} />}
                </button>
              ))}
            </Card>
          </section>
        ))}
      </div>

      {rows.length > limit && (
        <div className="flex justify-center mt-5">
          <Button variant="secondary" onClick={() => setLimit(l => l + PAGE)}>
            Show older entries
          </Button>
        </div>
      )}

      {editing && <EditSheet row={editing} onClose={() => setEditing(null)} onDelete={() => remove(editing)} />}
    </div>
  );
}

function formatDay(dateString: string) {
  const d = new Date(dateString);
  const today = new Date();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function SymptomRow({ s }: { s: Symptom }) {
  const duration = formatDuration(s.duration_minutes, s.ongoing);
  return (
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-2">
        <span
          className="size-2.5 rounded-full shrink-0"
          style={{ backgroundColor: severityColor(s.severity) }}
          aria-hidden
        />
        <span className="font-semibold text-fg truncate">{s.name}</span>
        <span className="ml-auto text-sm text-muted shrink-0">{severityLabel(s.severity)}</span>
      </span>
      {(duration || s.tags?.length) && (
        <span className="block text-[13px] text-subtle mt-0.5">
          {[duration, ...(s.tags ?? [])].filter(Boolean).join(' · ')}
        </span>
      )}
      {s.notes && <span className="block text-sm text-muted mt-1 line-clamp-2">{s.notes}</span>}
    </span>
  );
}

function FactorRow({ f }: { f: Factor }) {
  return (
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm shrink-0 bg-line-strong" aria-hidden />
        <span className="text-fg truncate">{f.name}</span>
        <span className="ml-auto text-sm text-subtle shrink-0">{CATEGORY_LABELS[f.category]}</span>
      </span>
      {f.notes && <span className="block text-sm text-muted mt-1 line-clamp-2">{f.notes}</span>}
    </span>
  );
}

function durationIndex(s: Symptom) {
  if (s.ongoing) return DURATION_OPTIONS.findIndex(d => d.ongoing);
  if (!s.duration_minutes) return 0;
  // Closest preset
  let best = 0;
  let bestDiff = Infinity;
  DURATION_OPTIONS.forEach((d, i) => {
    if (d.minutes == null) return;
    const diff = Math.abs(d.minutes - (s.duration_minutes ?? 0));
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  });
  return best;
}

function EditSheet({ row, onClose, onDelete }: { row: Row; onClose: () => void; onDelete: () => void }) {
  const isSymptom = row.kind === 'symptom';
  const [name, setName] = React.useState(isSymptom ? row.s.name : row.f.name);
  const [time, setTime] = React.useState(toLocalInputValue(new Date(row.t)));
  const [notes, setNotes] = React.useState((isSymptom ? row.s.notes : row.f.notes) ?? '');
  const [severity, setSeverity] = React.useState(isSymptom ? row.s.severity : 5);
  const [duration, setDuration] = React.useState(isSymptom ? durationIndex(row.s) : 0);
  const [category, setCategory] = React.useState<FactorCategory>(isSymptom ? 'food' : row.f.category);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const save = async () => {
    const date = fromLocalInputValue(time);
    if (!date) {
      toast.error('Please enter a valid date and time');
      return;
    }
    setSaving(true);
    try {
      if (row.kind === 'symptom') {
        const d = DURATION_OPTIONS[duration];
        // Keep the original duration if the person did not change the preset
        const unchanged = duration === durationIndex(row.s);
        await db.updateSymptom({
          ...row.s,
          name,
          severity,
          notes,
          timestamp: date.toISOString(),
          duration_minutes: unchanged ? row.s.duration_minutes : d.minutes,
          ongoing: unchanged ? row.s.ongoing : d.ongoing,
        });
      } else {
        await db.updateFactor({ ...row.f, name, category, notes, timestamp: date.toISOString() });
      }
      toast.success('Changes saved');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={o => !o && onClose()}
      title={isSymptom ? 'Edit symptom' : 'Edit entry'}
      footer={
        <div className="flex gap-2">
          {confirmDelete ? (
            <Button variant="danger" onClick={onDelete} className="flex-1">
              Delete for good
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmDelete(true)} className="text-danger">
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={saving || !name.trim()} className="flex-1">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
        </div>
        {isSymptom ? (
          <>
            <fieldset>
              <legend className="text-sm font-semibold text-fg mb-1.5">Severity</legend>
              <div className="grid grid-cols-2 gap-2">
                {SEVERITY_LEVELS.map(l => (
                  <Chip
                    key={l.value}
                    selected={severityLabel(severity) === l.label}
                    onClick={() => setSeverity(l.value)}
                    className="text-sm"
                  >
                    <span
                      className="inline-block size-2.5 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: l.color }}
                      aria-hidden
                    />
                    {l.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <div>
              <Label htmlFor="edit-duration">Duration</Label>
              <Select id="edit-duration" value={duration} onChange={e => setDuration(Number(e.target.value))}>
                {DURATION_OPTIONS.map((d, i) => (
                  <option key={d.label} value={i}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="edit-category">Category</Label>
            <Select id="edit-category" value={category} onChange={e => setCategory(e.target.value as FactorCategory)}>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="edit-time">Date and time</Label>
          <Input
            id="edit-time"
            type="datetime-local"
            value={time}
            max={toLocalInputValue(new Date())}
            onChange={e => setTime(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="edit-notes">Note</Label>
          <Textarea
            id="edit-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={1000}
            className={cn(!notes && 'min-h-16')}
          />
        </div>
      </div>
    </Sheet>
  );
}
