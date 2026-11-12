/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { db } from '@/lib/db/client';
import { DB_NAME, initDB, resetDBConnection } from '@/lib/db/init';
import { adherenceFor, dosesForDay } from '@/lib/medication/doses';

beforeAll(() => {
  // Node has BroadcastChannel, and an open channel would keep the test process running.
  Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true, writable: true });
});

/** A version 3 database with the stores and medication schedules the previous release saved. */
async function createVersion3(schedules: object[]) {
  const old = await openDB(DB_NAME, 3, {
    upgrade(d) {
      d.createObjectStore('symptoms', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
      d.createObjectStore('templates', { keyPath: 'id' });
      d.createObjectStore('preferences', { keyPath: 'id' });
      const meds = d.createObjectStore('meds', { keyPath: 'id' });
      meds.createIndex('timestamp', 'timestamp');
      meds.createIndex('name', 'name');
      const s = d.createObjectStore('schedules', { keyPath: 'id' });
      s.createIndex('medicationName', 'medicationName');
      s.createIndex('isActive', 'isActive');
      const a = d.createObjectStore('adherence', { keyPath: 'id' });
      a.createIndex('scheduleId', 'scheduleId');
      a.createIndex('status', 'status');
      a.createIndex('scheduledTime', 'scheduledTime');
    },
  });
  for (const s of schedules) await old.put('schedules', s);
  old.close();
}

it('counts adherence for schedules from the previous release from the upgrade on', async () => {
  // Saved by the previous release's medication manager, which could not record doses
  const created = '2025-09-02T10:15:00.000Z';
  const pausedAt = '2026-01-05T12:00:00.000Z';
  const v3 = {
    medicationName: 'Lisinopril',
    dosage: '10mg',
    frequency: 'twice-daily',
    scheduleTimes: ['08:00', '20:00'],
    notes: '',
    startDate: created,
    createdAt: created,
  };
  await createVersion3([
    { ...v3, id: 'active', isActive: true, updatedAt: created },
    { ...v3, id: 'paused', medicationName: 'Metformin', isActive: false, updatedAt: pausedAt },
  ]);

  resetDBConnection();
  const before = Date.now();
  const upgraded = await initDB();
  expect(upgraded.version).toBe(4);
  const schedules = await db.getAllMedicationSchedules();
  const now = new Date();
  const active = schedules.find(s => s.id === 'active')!;
  const paused = schedules.find(s => s.id === 'paused')!;

  expect(Date.parse(active.startDate)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(active.startDate)).toBeLessThanOrEqual(now.getTime());
  expect(active.createdAt).toBe(created);
  // Nothing was due since the upgrade, so no adherence figure is shown yet (it read 0% before)
  expect(adherenceFor(active, [], 30, now).percent).toBeNull();
  expect(adherenceFor(active, [], 90, now).percent).toBeNull();
  // Doses due earlier today are not flagged as overdue either
  expect(dosesForDay([active], [], now).every(s => s.state !== 'overdue')).toBe(true);

  // A paused schedule keeps when it was paused, and counts nothing until it is resumed
  expect(paused).toMatchObject({ isActive: false, pausedAt, createdAt: created });
  expect(adherenceFor(paused, [], 90, new Date(now.getTime() + 10 * 86_400_000)).percent).toBeNull();
});
