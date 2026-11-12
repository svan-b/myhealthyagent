'use client';

import * as React from 'react';
import { Plus, Check, Pause, Play, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Card, SectionTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Label } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { db } from '@/lib/db/client';
import type { Frequency, MedicationSchedule } from '@/lib/db/schema';
import { adherenceFor, dosesForDay, localDateKey, type DoseSlot } from '@/lib/medication/doses';
import { cn, errorMessage, newId } from '@/lib/utils';

const FREQUENCIES: { value: Frequency; label: string; times: string[] }[] = [
  { value: 'daily', label: 'Once a day', times: ['08:00'] },
  { value: 'twice-daily', label: 'Twice a day', times: ['08:00', '20:00'] },
  { value: 'three-times', label: 'Three times a day', times: ['08:00', '14:00', '20:00'] },
  { value: 'four-times', label: 'Four times a day', times: ['08:00', '12:00', '16:00', '20:00'] },
  { value: 'as-needed', label: 'As needed', times: [] },
];

const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export function MedsScreen() {
  const { schedules, doses, loading } = useHealthData();
  const [editing, setEditing] = React.useState<MedicationSchedule | 'new' | null>(null);
  const [now, setNow] = React.useState(() => new Date());

  // Refresh due states every minute while the screen is open
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = dosesForDay(schedules, doses, now);
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
      toast.success(`${s.medicationName} logged`, { action: { label: 'Undo', onClick: () => db.deleteDose(id) } });
    } catch (e) {
      toast.error(errorMessage(e));
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

      {today.length > 0 && (
        <>
          <SectionTitle>Today</SectionTitle>
          <Card className="divide-y divide-line">
            {today.map(slot => (
              <div key={`${slot.schedule.id}-${slot.time}`} className="flex items-center gap-3 px-4 py-3">
                <div className="w-16 shrink-0">
                  <p className="text-sm font-semibold text-fg tabular-nums">{fmtTime(slot.time)}</p>
                  <p
                    className={cn('text-[12px]', slot.state === 'overdue' ? 'text-warn font-semibold' : 'text-subtle')}
                  >
                    {slot.state === 'overdue'
                      ? 'Overdue'
                      : slot.state === 'due'
                        ? 'Due now'
                        : slot.state === 'upcoming'
                          ? 'Later'
                          : ''}
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
                    <Button size="sm" variant="quiet" onClick={() => mark(slot, 'skipped')}>
                      Skip
                    </Button>
                    <Button size="sm" onClick={() => mark(slot, 'taken')}>
                      Take
                    </Button>
                  </div>
                )}
              </div>
            ))}
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
                    <p className="text-sm text-muted">
                      {s.dosage}
                      {count ? `, taken ${count} ${count === 1 ? 'time' : 'times'} today` : ''}
                    </p>
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
                      {a.percent != null && s.isActive ? ` · ${a.percent}% taken in 30 days` : ''}
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

      {editing && <MedicationSheet schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MedicationSheet({ schedule, onClose }: { schedule: MedicationSchedule | null; onClose: () => void }) {
  const [name, setName] = React.useState(schedule?.medicationName ?? '');
  const [dosage, setDosage] = React.useState(schedule?.dosage ?? '');
  const [frequency, setFrequency] = React.useState<Frequency>(schedule?.frequency ?? 'daily');
  const [times, setTimes] = React.useState<string[]>(schedule?.scheduleTimes ?? ['08:00']);
  const [notes, setNotes] = React.useState(schedule?.notes ?? '');
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

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
    const now = new Date().toISOString();
    try {
      await db.saveMedicationSchedule({
        id: schedule?.id ?? newId(),
        medicationName: name,
        dosage,
        frequency,
        scheduleTimes: times,
        isActive: schedule?.isActive ?? true,
        startDate: schedule?.startDate ?? now,
        notes,
        createdAt: schedule?.createdAt ?? now,
        updatedAt: now,
      });
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
    const now = new Date().toISOString();
    await db.saveMedicationSchedule({
      ...schedule,
      isActive: !schedule.isActive,
      // Restart the adherence count on resume so the paused days do not count as missed doses.
      startDate: schedule.isActive ? schedule.startDate : now,
      updatedAt: now,
    });
    toast.success(schedule.isActive ? 'Paused' : 'Resumed');
    onClose();
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
    </Sheet>
  );
}
