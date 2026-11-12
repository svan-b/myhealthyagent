'use client';

import * as React from 'react';
import { Plus, Check, Pause, Play, Pencil, ChevronRight, History } from 'lucide-react';
import { toast } from 'sonner';
import { Card, SectionTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Label } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { db } from '@/lib/db/client';
import type { Frequency, MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';
import {
  adherenceFor,
  changeTimes,
  checklistDoses,
  dueKeyToDate,
  isSlotKey,
  localDateKey,
  pauseSchedule,
  resumeSchedule,
  type DoseSlot,
  type DoseState,
} from '@/lib/medication/doses';
import { cn, errorMessage, newId } from '@/lib/utils';

const FREQUENCIES: { value: Frequency; label: string; times: string[] }[] = [
  { value: 'daily', label: 'Once a day', times: ['08:00'] },
  { value: 'twice-daily', label: 'Twice a day', times: ['08:00', '20:00'] },
  { value: 'three-times', label: 'Three times a day', times: ['08:00', '14:00', '20:00'] },
  { value: 'four-times', label: 'Four times a day', times: ['08:00', '12:00', '16:00', '20:00'] },
  { value: 'as-needed', label: 'As needed', times: [] },
];

const STATE_LABELS: Record<DoseState, string> = {
  overdue: 'Overdue',
  due: 'Due now',
  upcoming: 'Later',
  taken: '',
  skipped: '',
  untracked: '',
};

/** Toasts with an Undo button stay long enough to read and reach. */
const UNDO_MS = 10_000;

const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const times = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`;

export function MedsScreen() {
  const { schedules, doses, loading } = useHealthData();
  const [editing, setEditing] = React.useState<MedicationSchedule | 'new' | null>(null);
  const [reviewing, setReviewing] = React.useState<MedicationSchedule | null>(null);
  const [now, setNow] = React.useState(() => new Date());
  const logging = React.useRef(new Set<string>());

  // Refresh due states every minute while the screen is open
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const checklist = checklistDoses(schedules, doses, now);
  const asNeeded = schedules.filter(s => s.isActive && s.frequency === 'as-needed');
  const todayKey = localDateKey(now);
  const asNeededToday = doses.filter(
    d =>
      d.status === 'taken' &&
      d.takenTime &&
      localDateKey(new Date(d.takenTime)) === todayKey &&
      asNeeded.some(s => s.id === d.scheduleId),
  );

  const mark = async (slot: DoseSlot, status: 'taken' | 'skipped') => {
    try {
      await db.saveDose({
        id: slot.record?.id ?? newId(),
        scheduleId: slot.schedule.id,
        medicationName: slot.schedule.medicationName,
        scheduledTime: slot.key,
        status,
        takenTime: status === 'taken' ? new Date().toISOString() : undefined,
      });
      toast.success(
        status === 'taken' ? `${slot.schedule.medicationName} marked taken` : `${slot.schedule.medicationName} skipped`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const undo = async (slot: DoseSlot) => {
    if (slot.record) await db.deleteDose(slot.record.id);
  };

  const logAsNeeded = async (s: MedicationSchedule) => {
    // A second tap while the first one is still saving would log the dose twice.
    if (logging.current.has(s.id)) return;
    logging.current.add(s.id);
    const t = new Date().toISOString();
    const id = newId();
    try {
      await db.saveDose({
        id,
        scheduleId: s.id,
        medicationName: s.medicationName,
        scheduledTime: t,
        takenTime: t,
        status: 'taken',
      });
      toast.success(`${s.medicationName} logged`, {
        duration: UNDO_MS,
        action: { label: 'Undo', onClick: () => db.deleteDose(id) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      logging.current.delete(s.id);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-fg">Medications</h1>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> Add
        </Button>
      </div>

      {!loading && schedules.length === 0 && (
        <Card className="p-6 text-center">
          <p className="font-semibold text-fg">No medications yet</p>
          <p className="text-sm text-muted mt-1">
            Add what you take to check off doses and see your adherence. Doses you take are also checked as possible
            causes of symptoms.
          </p>
          <Button className="mt-4" onClick={() => setEditing('new')}>
            <Plus /> Add a medication
          </Button>
        </Card>
      )}

      {checklist.length > 0 && (
        <>
          <SectionTitle>Today</SectionTitle>
          <Card className="divide-y divide-line">
            {checklist.map(slot => {
              // Last night's late doses stay here until their window closes, and doses just after
              // midnight show from an hour before.
              const day = slot.key.slice(0, 10);
              const label = day < todayKey ? 'Last night' : day > todayKey ? 'Tonight' : STATE_LABELS[slot.state];
              return (
                <div
                  key={`${slot.schedule.id}-${slot.key}`}
                  role="group"
                  aria-label={[`${slot.schedule.medicationName} ${fmtTime(slot.time)}`, label]
                    .filter(Boolean)
                    .join(', ')}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="w-16 shrink-0">
                    <p className="text-sm font-semibold text-fg tabular-nums">{fmtTime(slot.time)}</p>
                    <p
                      className={cn(
                        'text-[12px]',
                        slot.state === 'overdue' ? 'text-warn font-semibold' : 'text-subtle',
                      )}
                    >
                      {label}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-fg truncate">{slot.schedule.medicationName}</p>
                    <p className="text-sm text-muted truncate">{slot.schedule.dosage}</p>
                  </div>
                  {slot.state === 'taken' || slot.state === 'skipped' ? (
                    <button
                      type="button"
                      onClick={() => undo(slot)}
                      className={cn(
                        'rounded-full px-3 h-9 text-sm font-semibold',
                        slot.state === 'taken' ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-muted',
                      )}
                      aria-label={`${slot.state === 'taken' ? 'Taken' : 'Skipped'}. Tap to undo.`}
                    >
                      {slot.state === 'taken' ? (
                        <span className="flex items-center gap-1">
                          <Check className="size-4" aria-hidden /> Taken
                        </span>
                      ) : (
                        'Skipped'
                      )}
                    </button>
                  ) : (
                    <div className="flex gap-1.5 shrink-0">
                      {/* A dose that was never due cannot be skipped, but one taken anyway can be recorded. */}
                      {slot.state !== 'untracked' && (
                        <Button size="sm" variant="quiet" onClick={() => mark(slot, 'skipped')}>
                          Skip
                        </Button>
                      )}
                      <Button size="sm" onClick={() => mark(slot, 'taken')}>
                        Take
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </>
      )}

      {asNeeded.length > 0 && (
        <>
          <SectionTitle>As needed</SectionTitle>
          <Card className="divide-y divide-line">
            {asNeeded.map(s => {
              const count = asNeededToday.filter(d => d.scheduleId === s.id).length;
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-fg truncate">{s.medicationName}</p>
                    {s.dosage && <p className="text-sm text-muted truncate">{s.dosage}</p>}
                    {count > 0 && (
                      <button
                        type="button"
                        onClick={() => setReviewing(s)}
                        className="flex items-center gap-0.5 text-sm font-medium text-accent-ink hover:underline"
                        aria-label={`Taken ${times(count)} today. Show or remove doses.`}
                      >
                        Taken {times(count)} today
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => logAsNeeded(s)}>
                    Log dose
                  </Button>
                </div>
              );
            })}
          </Card>
        </>
      )}

      {schedules.length > 0 && (
        <>
          <SectionTitle>Your medications</SectionTitle>
          <Card className="divide-y divide-line">
            {schedules.map(s => {
              const a = adherenceFor(s, doses, 30, now);
              return (
                <div key={s.id} className={cn('flex items-center gap-3 px-4 py-3', !s.isActive && 'opacity-60')}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-fg truncate">
                      {s.medicationName} <span className="text-muted font-normal">{s.dosage}</span>
                    </p>
                    <p className="text-sm text-muted">
                      {!s.isActive
                        ? 'Paused'
                        : s.frequency === 'as-needed'
                          ? 'As needed'
                          : s.scheduleTimes.map(fmtTime).join(', ')}
                      {a.percent != null ? ` · ${a.percent}% taken in 30 days` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Edit ${s.medicationName}`}
                    onClick={() => setEditing(s)}
                  >
                    <Pencil />
                  </Button>
                </div>
              );
            })}
          </Card>
          <p className="text-[13px] text-subtle mt-3">
            This list helps you keep track. It does not give medical advice or send reminders. Always follow your
            prescriber’s instructions.
          </p>
        </>
      )}

      {editing && (
        <MedicationSheet
          schedule={editing === 'new' ? null : editing}
          hasDoses={editing !== 'new' && doses.some(d => d.scheduleId === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {reviewing && <DoseListSheet schedule={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}

function MedicationSheet({
  schedule,
  hasDoses,
  onClose,
}: {
  schedule: MedicationSchedule | null;
  hasDoses: boolean;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(schedule?.medicationName ?? '');
  const [dosage, setDosage] = React.useState(schedule?.dosage ?? '');
  const [frequency, setFrequency] = React.useState<Frequency>(schedule?.frequency ?? 'daily');
  const [times, setTimes] = React.useState<string[]>(schedule?.scheduleTimes ?? ['08:00']);
  const [notes, setNotes] = React.useState(schedule?.notes ?? '');
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // The dose list opens on top of this sheet, so changes not saved yet are still here after it closes.
  const [showDoses, setShowDoses] = React.useState(false);

  const changeFrequency = (f: Frequency) => {
    setFrequency(f);
    setTimes(FREQUENCIES.find(x => x.value === f)?.times ?? []);
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error('Please enter the medication name');
      return;
    }
    setSaving(true);
    const at = new Date();
    const now = at.toISOString();
    try {
      // An edit keeps everything else about the schedule, including its start, pauses and earlier
      // times, so past days are still read against the times that applied then.
      const next: MedicationSchedule = schedule
        ? changeTimes(schedule, frequency, times, at)
        : {
            id: newId(),
            medicationName: name,
            dosage,
            frequency,
            scheduleTimes: times,
            isActive: true,
            startDate: now,
            createdAt: now,
            updatedAt: now,
          };
      await db.saveMedicationSchedule({ ...next, medicationName: name, dosage, notes, updatedAt: now });
      toast.success(schedule ? 'Medication updated' : 'Medication added');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async () => {
    if (!schedule) return;
    try {
      // Pausing never moves the start date. The pause itself is kept, so its days do not count as missed.
      await db.saveMedicationSchedule(schedule.isActive ? pauseSchedule(schedule) : resumeSchedule(schedule));
      toast.success(schedule.isActive ? 'Paused' : 'Resumed');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!schedule) return;
    await db.deleteMedicationSchedule(schedule.id);
    toast.success('Medication and its dose history deleted');
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={o => !o && onClose()}
      title={schedule ? 'Edit medication' : 'Add medication'}
      footer={
        <Button block onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="med-name">Name</Label>
          <Input id="med-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="med-dose">Dose</Label>
          <Input
            id="med-dose"
            value={dosage}
            onChange={e => setDosage(e.target.value)}
            maxLength={60}
            placeholder="50 mg, 2 tablets"
          />
        </div>
        <div>
          <Label htmlFor="med-freq">How often</Label>
          <Select id="med-freq" value={frequency} onChange={e => changeFrequency(e.target.value as Frequency)}>
            {FREQUENCIES.map(f => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        {frequency !== 'as-needed' && (
          <fieldset>
            <legend className="text-sm font-semibold text-fg mb-1.5">Times</legend>
            <div className="grid grid-cols-2 gap-2">
              {times.map((t, i) => (
                <div key={i}>
                  <label htmlFor={`med-time-${i}`} className="sr-only">
                    Dose {i + 1} time
                  </label>
                  <Input
                    id={`med-time-${i}`}
                    type="time"
                    value={t}
                    required
                    onChange={e => setTimes(prev => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <Label htmlFor="med-notes">Notes</Label>
          <Input
            id="med-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={300}
            placeholder="With food"
          />
        </div>
        {schedule && hasDoses && (
          <Button variant="secondary" block onClick={() => setShowDoses(true)}>
            <History /> Logged doses
          </Button>
        )}
        {schedule && (
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={togglePause} className="flex-1">
              {schedule.isActive ? (
                <>
                  <Pause /> Pause
                </>
              ) : (
                <>
                  <Play /> Resume
                </>
              )}
            </Button>
            {confirmDelete ? (
              <Button variant="danger" onClick={remove} className="flex-1">
                Delete for good
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmDelete(true)} className="flex-1 text-danger">
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
      {schedule && showDoses && <DoseListSheet schedule={schedule} onClose={() => setShowDoses(false)} />}
    </Sheet>
  );
}

const PAGE = 60;

/** When a dose was due (scheduled) or taken (as needed). */
const doseTime = (d: MedicationAdherence) =>
  isSlotKey(d.scheduledTime) ? dueKeyToDate(d.scheduledTime) : new Date(d.takenTime ?? d.scheduledTime);

const STATUS_WORDS: Record<MedicationAdherence['status'], string> = {
  taken: 'taken',
  skipped: 'skipped',
  missed: 'missed',
  pending: 'not taken yet',
};

/** What the list shows for a dose, and how its buttons name it. */
function describeDose(d: MedicationAdherence, at: Date): { text: string; name: string } {
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // As-needed doses are always taken. Doses the old app recorded have a different key and can be skipped.
  if (!isSlotKey(d.scheduledTime) && d.status === 'taken') {
    return { text: `Taken at ${clock}`, name: `the dose taken at ${clock}` };
  }
  return { text: `${clock} dose, ${STATUS_WORDS[d.status]}`, name: `the ${clock} dose, ${STATUS_WORDS[d.status]}` };
}

function dayHeading(dayKey: string, now: Date): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey === localDateKey(now)) return 'Today';
  if (dayKey === localDateKey(yesterday)) return 'Yesterday';
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Every logged dose of one medication, newest first, so a dose logged by mistake can be removed
 * later. A removed dose stays in the list with Undo until the sheet closes. A toast would not do,
 * because nothing outside an open sheet can be reached.
 */
function DoseListSheet({ schedule, onClose }: { schedule: MedicationSchedule; onClose: () => void }) {
  const { doses } = useHealthData();
  const [limit, setLimit] = React.useState(PAGE);
  // Doses removed or put back while the list is open, by id. Each keeps its row until the sheet
  // closes, also while the data reloads, so focus stays on its button and a double tap cannot list
  // it twice.
  const [changed, setChanged] = React.useState<ReadonlyMap<string, { dose: MedicationAdherence; removed: boolean }>>(
    () => new Map(),
  );
  const now = new Date();

  const rows = React.useMemo(() => {
    const here = doses.filter(d => d.scheduleId === schedule.id);
    const ids = new Set(here.map(d => d.id));
    const kept = [...changed.values()].filter(c => !ids.has(c.dose.id)).map(c => c.dose);
    return [...here, ...kept]
      .map(d => ({ d, at: doseTime(d) }))
      .filter(r => !Number.isNaN(r.at.getTime()))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [doses, changed, schedule.id]);
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows.slice(0, limit)) {
      const key = localDateKey(r.at);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [rows, limit]);

  const isRemoved = (d: MedicationAdherence) => changed.get(d.id)?.removed === true;
  const note = (dose: MedicationAdherence, removed: boolean) =>
    setChanged(map => new Map(map).set(dose.id, { dose, removed }));

  const remove = async (d: MedicationAdherence) => {
    try {
      await db.deleteDose(d.id);
      note(d, true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const putBack = async (d: MedicationAdherence) => {
    try {
      await db.restoreDose(d);
      note(d, false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Sheet
      open
      onOpenChange={o => !o && onClose()}
      title={`${schedule.medicationName} doses`}
      description="Remove a dose that was logged by mistake."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No doses logged.</p>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, items]) => (
            <section key={day}>
              <h3 className="text-sm font-semibold text-muted mb-2">{dayHeading(day, now)}</h3>
              <Card className="divide-y divide-line">
                {items.map(({ d, at }) => {
                  const { text, name } = describeDose(d, at);
                  const gone = isRemoved(d);
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-4 py-2">
                      <p className={cn('flex-1 min-w-0', gone ? 'text-subtle line-through' : 'text-fg')}>{text}</p>
                      {gone && <span className="text-sm text-subtle">Removed</span>}
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => (gone ? putBack(d) : remove(d))}
                        aria-label={gone ? `Undo removing ${name}` : `Remove ${name}`}
                      >
                        {gone ? 'Undo' : 'Remove'}
                      </Button>
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
          {rows.length > limit && (
            <Button variant="secondary" block onClick={() => setLimit(l => l + PAGE)}>
              Show older doses
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
