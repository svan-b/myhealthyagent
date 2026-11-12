// lib/db/backup.ts
// Backup, restore and spreadsheet export. Everything happens on the device.
import { z } from 'zod';
import { startTrackingAt } from '@/lib/medication/doses';
import { initDB } from './init';
import { db, normalizePreferences } from './client';
import type { Factor, MedicationAdherence, MedicationSchedule, Symptom } from './schema';

export const BACKUP_FORMAT = 'myhealthyagent-backup';
export const BACKUP_VERSION = 2;

const isoDate = z.string().refine(s => !Number.isNaN(Date.parse(s)), 'Invalid date');

const symptomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  severity: z.number().min(0).max(10),
  timestamp: isoDate,
  duration_minutes: z.number().optional().nullable(),
  ongoing: z.boolean().optional(),
  notes: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});

const factorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  category: z.enum(['food', 'drink', 'activity', 'sleep', 'stress', 'medication', 'other']),
  timestamp: isoDate,
  notes: z.string().max(5000).optional().nullable(),
  updatedAt: z.string().optional(),
});

const legacyMedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  timestamp: isoDate,
  dose: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const frequencySchema = z.enum(['daily', 'twice-daily', 'three-times', 'four-times', 'as-needed']);

// Every schedule field must be listed here. Unknown keys are dropped, so a restore would lose them.
const scheduleSchema = z.object({
  id: z.string().min(1),
  medicationName: z.string().min(1).max(200),
  dosage: z.string().max(200),
  frequency: frequencySchema,
  scheduleTimes: z.array(z.string()),
  isActive: z.boolean(),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  pausedAt: isoDate.optional().nullable(),
  pauses: z
    .array(z.object({ from: isoDate, to: isoDate }))
    .optional()
    .nullable(),
  timesHistory: z
    .array(z.object({ frequency: frequencySchema, scheduleTimes: z.array(z.string()), until: isoDate }))
    .optional()
    .nullable(),
  notes: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const doseSchema = z.object({
  id: z.string().min(1),
  scheduleId: z.string(),
  medicationName: z.string(),
  scheduledTime: z.string(),
  takenTime: z.string().optional().nullable(),
  status: z.enum(['taken', 'skipped', 'missed', 'pending']),
  skipReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const backupSchema = z.object({
  format: z.string().optional(),
  version: z.number().optional(),
  symptoms: z.array(z.unknown()).optional(),
  factors: z.array(z.unknown()).optional(),
  meds: z.array(z.unknown()).optional(),
  schedules: z.array(z.unknown()).optional(),
  adherence: z.array(z.unknown()).optional(),
  preferences: z.unknown().optional(),
});

const stripNulls = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;

export async function exportBackup(): Promise<string> {
  const [symptoms, factors, schedules, adherence, preferences] = await Promise.all([
    db.getAllSymptoms(),
    db.getAllFactors(),
    db.getAllMedicationSchedules(),
    db.getAllDoses(),
    db.getPreferences(),
  ]);
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      symptoms,
      factors,
      schedules,
      adherence,
      preferences,
    },
    null,
    2,
  );
}

export interface ImportResult {
  /** Entries written. They were missing here, or the file has a newer edit of them. */
  symptoms: number;
  factors: number;
  schedules: number;
  doses: number;
  /** Rows that could not be read. */
  skipped: number;
  /** Entries this device has a newer version of, so its version was kept. */
  keptLocal: number;
}

/**
 * Merges a backup into the current data. Entries that are not here are added, which also brings
 * back deleted ones. An entry that is here is replaced only by a newer edit from the file, so
 * changes made on this device after the backup are kept. A dose is not added when this device
 * already has a record for the same dose. Nothing is removed. Invalid rows are skipped and counted.
 */
export async function importBackup(text: string, now = new Date()): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid backup (could not read JSON).');
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) throw new Error('This file is not a myHealthyAgent backup.');
  const data = parsed.data;
  if (!data.symptoms && !data.factors && !data.schedules) {
    throw new Error('This file is not a myHealthyAgent backup.');
  }

  let skipped = 0;
  const take = <T>(rows: unknown[] | undefined, schema: z.ZodType<T>): T[] => {
    const out: T[] = [];
    for (const r of rows ?? []) {
      const res = schema.safeParse(r);
      if (res.success) out.push(res.data);
      else skipped++;
    }
    return out;
  };

  const symptoms = take(data.symptoms, symptomSchema).map(s => {
    const row = stripNulls(s) as Symptom;
    if (row.duration_minutes === 999) {
      row.duration_minutes = undefined;
      row.ongoing = true;
    }
    row.severity = Math.round(Math.min(10, Math.max(1, row.severity)));
    return row;
  });
  const factors: Factor[] = take(data.factors, factorSchema).map(f => stripNulls(f) as Factor);
  for (const m of take(data.meds, legacyMedSchema)) {
    factors.push({
      id: m.id,
      name: m.name,
      category: 'medication',
      timestamp: m.timestamp,
      notes: [m.dose, m.notes].filter(Boolean).join(' · ') || undefined,
    });
  }
  // Files from the old app have no format field. It could not record doses, so tracking starts now.
  const legacy = data.format !== BACKUP_FORMAT;
  const schedules = take(data.schedules, scheduleSchema).map(s => {
    const row = stripNulls(s) as MedicationSchedule;
    return legacy ? startTrackingAt(row, now) : row;
  });
  const doses = take(data.adherence, doseSchema).map(d => stripNulls(d) as MedicationAdherence);

  const idb = await initDB();
  const tx = idb.transaction(['symptoms', 'factors', 'schedules', 'adherence', 'preferences'], 'readwrite');
  // Read what is here before writing anything. Waiting only on these requests keeps the transaction open.
  const [localSymptoms, localFactors, localSchedules, localDoses, localPrefs] = await Promise.all([
    tx.objectStore('symptoms').getAll() as Promise<Symptom[]>,
    tx.objectStore('factors').getAll() as Promise<Factor[]>,
    tx.objectStore('schedules').getAll() as Promise<MedicationSchedule[]>,
    tx.objectStore('adherence').getAll() as Promise<MedicationAdherence[]>,
    tx.objectStore('preferences').get('user-preferences'),
  ]);

  let keptLocal = 0;
  const editedAt = (iso?: string) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? 0 : t;
  };
  /** Rows that are not here, or that the file has a newer edit of. A missing edit time counts as oldest. */
  const toWrite = <T extends { id: string; updatedAt?: string }>(incoming: T[], local: T[]): T[] => {
    const here = new Map(local.map(r => [r.id, r]));
    return incoming.filter(r => {
      const mine = here.get(r.id);
      if (!mine || editedAt(r.updatedAt) > editedAt(mine.updatedAt)) return true;
      if (editedAt(mine.updatedAt) > editedAt(r.updatedAt)) keptLocal++;
      return false;
    });
  };
  const symptomRows = toWrite(symptoms, localSymptoms);
  const factorRows = toWrite(factors, localFactors);
  const scheduleRows = toWrite(schedules, localSchedules);

  // Dose records have no edit time. Keep this device's record for the same id or the same dose, so
  // an old "skipped" record cannot come back next to the "taken" record that replaced it.
  const doseKey = (d: MedicationAdherence) => `${d.scheduleId}|${d.scheduledTime}`;
  const localDoseById = new Map(localDoses.map(d => [d.id, d]));
  const localDoseKeys = new Set(localDoses.map(doseKey));
  const doseRows = doses.filter(d => {
    const mine = localDoseById.get(d.id);
    if (mine) {
      if (mine.status !== d.status || mine.scheduledTime !== d.scheduledTime) keptLocal++;
      return false;
    }
    if (localDoseKeys.has(doseKey(d))) {
      keptLocal++;
      return false;
    }
    return true;
  });

  const writes: Promise<unknown>[] = [
    ...symptomRows.map(s => tx.objectStore('symptoms').put(s)),
    ...factorRows.map(f => tx.objectStore('factors').put(f)),
    ...scheduleRows.map(s => tx.objectStore('schedules').put(s)),
    ...doseRows.map(d => tx.objectStore('adherence').put(d)),
  ];

  if (data.preferences) {
    const incoming = normalizePreferences(data.preferences);
    const current = normalizePreferences(localPrefs);
    const mergeNames = (a: string[], b: string[]) =>
      Array.from(new Map([...a, ...b].map(n => [n.toLowerCase(), n])).values());
    // Take the license key from the file only when this device has none, or the server rejected the
    // one here (the check time is then set to 0). Never take a check time from a file, so a key from
    // a backup is checked before it unlocks Pro.
    const rejectedHere =
      !current.licenseToken || (current.licenseCheckedAt !== undefined && Date.parse(current.licenseCheckedAt) === 0);
    const adoptKey = Boolean(incoming.licenseToken) && incoming.licenseToken !== current.licenseToken && rejectedHere;
    writes.push(
      tx.objectStore('preferences').put({
        ...current,
        customSymptoms: mergeNames(current.customSymptoms, incoming.customSymptoms),
        customFactors: Array.from(
          new Map([...current.customFactors, ...incoming.customFactors].map(f => [f.name.toLowerCase(), f])).values(),
        ),
        reportName: current.reportName ?? incoming.reportName,
        licenseToken: adoptKey ? incoming.licenseToken : current.licenseToken,
        licenseCheckedAt: adoptKey ? undefined : current.licenseCheckedAt,
        onboardedAt: current.onboardedAt ?? incoming.onboardedAt,
      }),
    );
  }
  await Promise.all([...writes, tx.done]);
  db.notifyChanged();

  return {
    symptoms: symptomRows.length,
    factors: factorRows.length,
    schedules: scheduleRows.length,
    doses: doseRows.length,
    skipped,
    keptLocal,
  };
}

/** RFC 4180 field. Also neutralises spreadsheet formulas (CSV injection). */
export function csvField(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(symptoms: Symptom[], factors: Factor[]): string {
  const header = [
    'type',
    'name',
    'category',
    'severity',
    'start_local',
    'start_utc',
    'duration_minutes',
    'ongoing',
    'notes',
    'tags',
  ];
  const local = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const rows = [
    ...symptoms.map(s => ({
      t: s.timestamp,
      cells: [
        'symptom',
        s.name,
        '',
        s.severity,
        local(s.timestamp),
        s.timestamp,
        s.duration_minutes ?? '',
        s.ongoing ? 'yes' : '',
        s.notes ?? '',
        (s.tags ?? []).join('; '),
      ],
    })),
    ...factors.map(f => ({
      t: f.timestamp,
      cells: ['factor', f.name, f.category, '', local(f.timestamp), f.timestamp, '', '', f.notes ?? '', ''],
    })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  // BOM so Excel opens UTF-8 correctly
  return '﻿' + [header, ...rows.map(r => r.cells)].map(r => r.map(csvField).join(',')).join('\r\n');
}

export async function exportCSV(): Promise<string> {
  const [symptoms, factors] = await Promise.all([db.getAllSymptoms(), db.getAllFactors()]);
  return toCSV(symptoms, factors);
}

export function downloadFile(content: string | Blob, filename: string, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
