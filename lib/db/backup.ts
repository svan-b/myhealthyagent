// lib/db/backup.ts
// Backup, restore and spreadsheet export. Everything happens on the device.
import { z } from 'zod';
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

const scheduleSchema = z.object({
  id: z.string().min(1),
  medicationName: z.string().min(1).max(200),
  dosage: z.string().max(200),
  frequency: z.enum(['daily', 'twice-daily', 'three-times', 'four-times', 'as-needed']),
  scheduleTimes: z.array(z.string()),
  isActive: z.boolean(),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
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
  symptoms: number;
  factors: number;
  schedules: number;
  doses: number;
  skipped: number;
}

/**
 * Merges a backup into the current data. Entries with the same id are replaced,
 * nothing else is removed. Invalid rows are skipped and counted.
 */
export async function importBackup(text: string): Promise<ImportResult> {
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
  const schedules = take(data.schedules, scheduleSchema).map(s => stripNulls(s) as MedicationSchedule);
  const doses = take(data.adherence, doseSchema).map(d => stripNulls(d) as MedicationAdherence);

  const idb = await initDB();
  const tx = idb.transaction(['symptoms', 'factors', 'schedules', 'adherence', 'preferences'], 'readwrite');
  const writes: Promise<unknown>[] = [
    ...symptoms.map(s => tx.objectStore('symptoms').put(s)),
    ...factors.map(f => tx.objectStore('factors').put(f)),
    ...schedules.map(s => tx.objectStore('schedules').put(s)),
    ...doses.map(d => tx.objectStore('adherence').put(d)),
  ];

  if (data.preferences) {
    const incoming = normalizePreferences(data.preferences);
    const current = normalizePreferences(await tx.objectStore('preferences').get('user-preferences'));
    const mergeNames = (a: string[], b: string[]) =>
      Array.from(new Map([...a, ...b].map(n => [n.toLowerCase(), n])).values());
    writes.push(
      tx.objectStore('preferences').put({
        ...current,
        customSymptoms: mergeNames(current.customSymptoms, incoming.customSymptoms),
        customFactors: Array.from(
          new Map([...current.customFactors, ...incoming.customFactors].map(f => [f.name.toLowerCase(), f])).values(),
        ),
        reportName: current.reportName ?? incoming.reportName,
        licenseToken: current.licenseToken ?? incoming.licenseToken,
        onboardedAt: current.onboardedAt ?? incoming.onboardedAt,
      }),
    );
  }
  await Promise.all([...writes, tx.done]);
  db.notifyChanged();

  return {
    symptoms: symptoms.length,
    factors: factors.length,
    schedules: schedules.length,
    doses: doses.length,
    skipped,
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
