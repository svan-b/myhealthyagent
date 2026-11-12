/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { exportBackup, importBackup } from '@/lib/db/backup';
import { db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import type { MedicationSchedule } from '@/lib/db/schema';
import { adherenceFor, changeTimes, dosesForDay, dueKey, pauseSchedule, resumeSchedule } from '@/lib/medication/doses';

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const prednisone = (over: Partial<MedicationSchedule> = {}): MedicationSchedule => ({
  id: 'm1',
  medicationName: 'Prednisone',
  dosage: '20 mg',
  frequency: 'daily',
  scheduleTimes: ['08:00'],
  isActive: true,
  startDate: ago(40 * 24),
  createdAt: ago(40 * 24),
  updatedAt: ago(40 * 24),
  ...over,
});

/** Starts each test with an empty database. */
async function wipe() {
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
}

beforeAll(() => {
  // Node has BroadcastChannel, and an open channel would keep the test process running.
  Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true, writable: true });
});
beforeEach(wipe);

describe('restoring a backup onto a device that has data', () => {
  it('keeps entries edited on this device after the backup was made', async () => {
    await db.addSymptom({ id: 's1', name: 'Nausea', severity: 2, timestamp: ago(5) });
    await db.addFactors([{ id: 'f1', name: 'Milk', category: 'drink', timestamp: ago(6) }]);
    await db.saveMedicationSchedule(prednisone());
    const backup = await exportBackup();

    const [s1] = await db.getAllSymptoms();
    await db.updateSymptom({ ...s1, severity: 9, notes: 'Went to urgent care, vomiting' });
    const [f1] = await db.getAllFactors();
    await db.updateFactor({ ...f1, name: 'Oat milk' });
    const [m1] = await db.getAllMedicationSchedules();
    await db.saveMedicationSchedule({ ...pauseSchedule(m1), dosage: '5 mg' });

    const result = await importBackup(backup);
    expect((await db.getAllSymptoms())[0]).toMatchObject({ severity: 9, notes: 'Went to urgent care, vomiting' });
    expect((await db.getAllFactors())[0].name).toBe('Oat milk');
    expect((await db.getAllMedicationSchedules())[0]).toMatchObject({ dosage: '5 mg', isActive: false });
    expect(result).toMatchObject({ symptoms: 0, factors: 0, schedules: 0, keptLocal: 3 });
  });

  it('applies a newer edit from the file, as when moving between two devices', async () => {
    await db.addSymptom({ id: 's1', name: 'Nausea', severity: 2, timestamp: ago(5) });
    await db.saveMedicationSchedule(prednisone());
    const [s1] = await db.getAllSymptoms();
    const file = JSON.stringify({
      format: 'myhealthyagent-backup',
      version: 2,
      symptoms: [{ ...s1, severity: 7, notes: 'Edited on the tablet', updatedAt: new Date().toISOString() }],
      schedules: [prednisone({ dosage: '10 mg', updatedAt: new Date().toISOString() })],
    });
    const result = await importBackup(file);
    expect((await db.getAllSymptoms())[0]).toMatchObject({ severity: 7, notes: 'Edited on the tablet' });
    expect((await db.getAllMedicationSchedules())[0].dosage).toBe('10 mg');
    expect(result).toMatchObject({ symptoms: 1, schedules: 1, keptLocal: 0 });
  });

  it('brings back deleted entries, and a second restore of the same file changes nothing', async () => {
    await db.addSymptom({ id: 's1', name: 'Nausea', severity: 2, timestamp: ago(5) });
    await db.saveMedicationSchedule(prednisone());
    await db.saveDose({
      id: 'd1',
      scheduleId: 'm1',
      medicationName: 'Prednisone',
      scheduledTime: dueKey(new Date(Date.now() - 24 * HOUR), '08:00'),
      status: 'taken',
      takenTime: ago(24),
    });
    const backup = await exportBackup();
    await db.deleteSymptom('s1');
    await db.deleteDose('d1');
    await db.addSymptom({ id: 's2', name: 'Headache', severity: 5, timestamp: ago(1) });

    expect(await importBackup(backup)).toMatchObject({ symptoms: 1, doses: 1, keptLocal: 0 });
    expect((await db.getAllSymptoms()).map(s => s.id).sort()).toEqual(['s1', 's2']);
    expect((await db.getAllDoses()).map(d => d.id)).toEqual(['d1']);
    expect(await importBackup(backup)).toMatchObject({ symptoms: 0, factors: 0, schedules: 0, doses: 0, keptLocal: 0 });
  });

  it('does not bring back a skipped dose next to the taken dose that replaced it', async () => {
    await db.saveMedicationSchedule(prednisone());
    const yesterday = new Date(Date.now() - 24 * HOUR);
    const slot = dueKey(yesterday, '08:00');
    const base = { scheduleId: 'm1', medicationName: 'Prednisone', scheduledTime: slot };
    await db.saveDose({ ...base, id: 'z-first', status: 'skipped' });
    const backup = await exportBackup();
    // Undo deletes the record, and Take then saves a new one
    await db.deleteDose('z-first');
    await db.saveDose({ ...base, id: 'a-second', status: 'taken', takenTime: new Date().toISOString() });

    expect(await importBackup(backup)).toMatchObject({ doses: 0, keptLocal: 1 });
    const doses = await db.getAllDoses();
    expect(doses.map(d => d.id)).toEqual(['a-second']);
    const [s] = await db.getAllMedicationSchedules();
    expect(dosesForDay([s], doses, new Date(), yesterday)[0].state).toBe('taken');
  });

  it('brings back an as-needed dose logged moments after another one', async () => {
    await db.saveMedicationSchedule(prednisone({ id: 'm2', frequency: 'as-needed', scheduleTimes: [] }));
    const first = ago(3);
    const second = new Date(Date.parse(first) + 2_000).toISOString();
    const base = { scheduleId: 'm2', medicationName: 'Ibuprofen', status: 'taken' as const };
    await db.saveDose({ ...base, id: 'd1', scheduledTime: first, takenTime: first });
    await db.saveDose({ ...base, id: 'd2', scheduledTime: second, takenTime: second });
    const backup = await exportBackup();
    await db.deleteDose('d2');
    // A restore brings back what was deleted, even a dose logged seconds after another
    expect(await importBackup(backup)).toMatchObject({ doses: 1 });
    expect((await db.getAllDoses()).map(d => d.id).sort()).toEqual(['d1', 'd2']);
  });
});

describe('backups keep how a schedule changed', () => {
  it('restores pauses, the current pause and earlier times', async () => {
    const t = (h: number) => new Date(Date.now() - h * HOUR);
    const edited = changeTimes(prednisone(), 'daily', ['09:00'], t(20 * 24));
    const resumed = resumeSchedule(pauseSchedule(edited, t(10 * 24)), t(7 * 24));
    const paused = pauseSchedule({ ...prednisone({ id: 'm2', medicationName: 'Sertraline' }) }, t(2 * 24));
    await db.saveMedicationSchedule(resumed);
    await db.saveMedicationSchedule(paused);
    const backup = await exportBackup();

    await wipe();
    expect(await importBackup(backup)).toMatchObject({ schedules: 2, skipped: 0 });
    const byId = new Map((await db.getAllMedicationSchedules()).map(s => [s.id, s]));
    expect(byId.get('m1')).toMatchObject({
      startDate: resumed.startDate,
      pauses: resumed.pauses,
      timesHistory: resumed.timesHistory,
    });
    expect(byId.get('m2')).toMatchObject({ isActive: false, pausedAt: paused.pausedAt });
  });

  it('starts tracking schedules from an old app backup at the restore', async () => {
    const created = '2025-09-02T10:15:00.000Z';
    const v3 = (over: object) => ({
      id: 'v3-a',
      medicationName: 'Lisinopril',
      dosage: '10mg',
      frequency: 'daily',
      scheduleTimes: ['08:00'],
      isActive: true,
      startDate: created,
      notes: '',
      createdAt: created,
      updatedAt: created,
      ...over,
    });
    // The old app exported plain JSON with no format field
    const file = JSON.stringify({
      symptoms: [],
      meds: [],
      schedules: [
        v3({}),
        v3({ id: 'v3-b', medicationName: 'Metformin', isActive: false, updatedAt: '2026-01-05T12:00:00.000Z' }),
      ],
      adherence: [],
      preferences: { id: 'user-preferences', streakCount: 2 },
    });
    const now = new Date();
    await importBackup(file, now);
    const byId = new Map((await db.getAllMedicationSchedules()).map(s => [s.id, s]));
    const active = byId.get('v3-a')!;
    expect(active).toMatchObject({ startDate: now.toISOString(), createdAt: created });
    expect(adherenceFor(active, [], 30, now).percent).toBeNull();
    expect(adherenceFor(active, [], 90, now).percent).toBeNull();
    expect(byId.get('v3-b')).toMatchObject({ startDate: now.toISOString(), pausedAt: '2026-01-05T12:00:00.000Z' });
  });
});

describe('license key in a backup', () => {
  const fileWithKey = (licenseToken: string) =>
    JSON.stringify({
      format: 'myhealthyagent-backup',
      version: 2,
      symptoms: [],
      // A check time in a file must never be trusted
      preferences: { licenseToken, licenseCheckedAt: '2999-01-01T00:00:00.000Z' },
    });

  it('replaces a key the server rejected with the key from the file', async () => {
    await db.updatePreferences({ licenseToken: 'T1-dead', licenseCheckedAt: new Date(0).toISOString() });
    await importBackup(fileWithKey('T2-live'));
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBe('T2-live');
    expect(prefs.licenseCheckedAt).toBeUndefined();
  });

  it('keeps a working key and when it was checked', async () => {
    const checked = ago(3);
    await db.updatePreferences({ licenseToken: 'T1', licenseCheckedAt: checked });
    await importBackup(fileWithKey('T2'));
    expect(await db.getPreferences()).toMatchObject({ licenseToken: 'T1', licenseCheckedAt: checked });
  });

  it('keeps a key that has not been checked yet', async () => {
    await db.updatePreferences({ licenseToken: 'T1' });
    await importBackup(fileWithKey('T2'));
    expect((await db.getPreferences()).licenseToken).toBe('T1');
  });

  it('takes the key on a device without one, but not the check time', async () => {
    await importBackup(fileWithKey('T2'));
    const prefs = await db.getPreferences();
    expect(prefs.licenseToken).toBe('T2');
    expect(prefs.licenseCheckedAt).toBeUndefined();
  });
});
