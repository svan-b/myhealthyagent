/**
 * @jest-environment node
 */
// What the toast says after a backup is restored.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { exportBackup, importBackup, type ImportResult } from '@/lib/db/backup';
import { db } from '@/lib/db/client';
import { resetDBConnection } from '@/lib/db/init';
import { describeRestore } from '@/lib/utils';

const none: ImportResult = { symptoms: 0, factors: 0, schedules: 0, doses: 0, skipped: 0, keptLocal: 0 };
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

beforeAll(() => {
  // Node has BroadcastChannel, and an open channel would keep the test process running.
  Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true, writable: true });
});
beforeEach(() => {
  resetDBConnection();
  globalThis.indexedDB = new IDBFactory();
});

describe('describeRestore', () => {
  it('lists what was written', () => {
    expect(describeRestore({ ...none, symptoms: 12, factors: 1, schedules: 2, doses: 30 })).toBe(
      'Restored 12 symptoms, 1 other entry, 2 medications and 30 doses.',
    );
    expect(describeRestore({ ...none, symptoms: 1 })).toBe('Restored 1 symptom.');
  });

  it('says when entries changed on this device were kept', () => {
    expect(describeRestore({ ...none, symptoms: 3, keptLocal: 1 })).toBe(
      'Restored 3 symptoms. Kept 1 entry you changed on this device after the backup was made.',
    );
    expect(describeRestore({ ...none, keptLocal: 2 })).toBe(
      'Nothing new to add. Kept 2 entries you changed on this device after the backup was made.',
    );
  });

  it('does not report zeros when everything was already here', () => {
    expect(describeRestore(none)).toBe('Everything in this file was already on this device.');
  });

  it('says how many rows could not be read', () => {
    expect(describeRestore({ ...none, factors: 2, skipped: 1 })).toBe(
      'Restored 2 other entries. Skipped 1 unreadable row.',
    );
  });
});

it('a restore after an edit on this device says the edit was kept', async () => {
  await db.addSymptom({ id: 's1', name: 'Headache', severity: 5, timestamp: ago(3) });
  const backup = await exportBackup();
  const [s1] = await db.getAllSymptoms();
  await db.updateSymptom({ ...s1, severity: 7 });

  const text = describeRestore(await importBackup(backup));
  expect(text).toBe('Nothing new to add. Kept 1 entry you changed on this device after the backup was made.');
  expect((await db.getAllSymptoms())[0].severity).toBe(7);
});
