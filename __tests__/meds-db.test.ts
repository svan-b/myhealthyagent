/**
 * @jest-environment node
 */
// Saving dose records, including doses recorded after their window.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import type { MedicationAdherence, MedicationSchedule } from '@/lib/db/schema';
import { adherenceFor, doseRecord, dosesForDay, dueKey } from '@/lib/medication/doses';

const HOUR = 3_600_000;

beforeAll(() => {
  // Node has BroadcastChannel, and an open channel would keep the test process running.
  Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true, writable: true });
});
beforeEach(() => {
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
});

const now = new Date();
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

const quetiapine: MedicationSchedule = {
  id: 'q1',
  medicationName: 'Quetiapine',
  dosage: '25 mg',
  frequency: 'daily',
  scheduleTimes: ['22:00'],
  isActive: true,
  startDate: new Date(now.getTime() - 40 * 24 * HOUR).toISOString(),
  createdAt: new Date(now.getTime() - 40 * 24 * HOUR).toISOString(),
  updatedAt: new Date(now.getTime() - 40 * 24 * HOUR).toISOString(),
};

const dose = (over: Partial<MedicationAdherence> = {}): MedicationAdherence => ({
  id: 'd1',
  scheduleId: 'q1',
  medicationName: 'Quetiapine',
  scheduledTime: dueKey(yesterday, '22:00'),
  status: 'taken',
  ...over,
});

describe('saving a dose', () => {
  it('saves yesterday’s dose recorded today at the time it was due, and it counts', async () => {
    const [slot] = dosesForDay([quetiapine], [], now, yesterday);
    expect(slot.state).toBe('overdue');
    await db.saveDose(doseRecord(slot, 'taken', 'd1', now));
    const saved = await db.getAllDoses();
    expect(saved).toEqual([
      expect.objectContaining({
        scheduledTime: dueKey(yesterday, '22:00'),
        status: 'taken',
        takenTime: slot.due.toISOString(),
      }),
    ]);
    expect(dosesForDay([quetiapine], saved, now, yesterday)[0].state).toBe('taken');
    expect(adherenceFor(quetiapine, saved, 2, now)).toMatchObject({ taken: 1, missed: 0 });
  });

  it('refuses a taken time in the future or one that is not a time', async () => {
    const later = new Date(Date.now() + HOUR).toISOString();
    await expect(db.saveDose(dose({ takenTime: later }))).rejects.toThrow('That time is in the future');
    await expect(db.saveDose(dose({ takenTime: 'soon' }))).rejects.toThrow('Invalid date');
    expect(await db.getAllDoses()).toEqual([]);
  });

  it('saves a skipped dose without a taken time and a taken one with a past time', async () => {
    await db.saveDose(dose({ status: 'skipped', takenTime: undefined }));
    await db.saveDose(dose({ id: 'd2', takenTime: new Date(Date.now() - HOUR).toISOString() }));
    expect((await db.getAllDoses()).map(d => d.id).sort()).toEqual(['d1', 'd2']);
  });

  it('puts back a removed dose as it was', async () => {
    const old = dose({ takenTime: new Date(Date.now() - 2 * HOUR).toISOString() });
    await db.saveDose(old);
    await db.deleteDose(old.id);
    await db.restoreDose(old);
    expect(await db.getAllDoses()).toEqual([old]);
  });
});
