// lib/db/init.ts
import { openDB, type IDBPDatabase } from 'idb';
import { startTrackingAt } from '@/lib/medication/doses';

export const DB_NAME = 'myHealthyAgent';
// v1 symptoms/templates/preferences, v2 meds, v3 schedules/adherence, v4 factors + data fixes
export const DB_VERSION = 4;

export const STORES = ['symptoms', 'factors', 'preferences', 'schedules', 'adherence', 'meds', 'templates'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBPDatabase> | null = null;

export function initDB(): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser does not support local storage (IndexedDB).'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains('symptoms')) {
          db.createObjectStore('symptoms', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meds')) {
          const meds = db.createObjectStore('meds', { keyPath: 'id' });
          meds.createIndex('timestamp', 'timestamp');
          meds.createIndex('name', 'name');
        }
        if (!db.objectStoreNames.contains('schedules')) {
          const s = db.createObjectStore('schedules', { keyPath: 'id' });
          s.createIndex('medicationName', 'medicationName');
          s.createIndex('isActive', 'isActive');
        }
        if (!db.objectStoreNames.contains('adherence')) {
          const a = db.createObjectStore('adherence', { keyPath: 'id' });
          a.createIndex('scheduleId', 'scheduleId');
          a.createIndex('status', 'status');
          a.createIndex('scheduledTime', 'scheduledTime');
        }
        if (!db.objectStoreNames.contains('factors')) {
          const f = db.createObjectStore('factors', { keyPath: 'id' });
          f.createIndex('timestamp', 'timestamp');
          f.createIndex('name', 'name');
        }

        if (oldVersion > 0 && oldVersion < 4) {
          // Earlier builds stored "Ongoing" as a 999 minute duration.
          let cursor = await tx.objectStore('symptoms').openCursor();
          while (cursor) {
            const value = cursor.value;
            if (value.duration_minutes === 999) {
              await cursor.update({ ...value, duration_minutes: undefined, ongoing: true });
            }
            cursor = await cursor.continue();
          }
          // Legacy medication logs become medication factors so they feed the trigger finder.
          const meds = await tx.objectStore('meds').getAll();
          for (const m of meds) {
            await tx.objectStore('factors').put({
              id: m.id,
              name: m.name,
              category: 'medication',
              timestamp: m.timestamp,
              notes: [m.dose, m.notes].filter(Boolean).join(' · ') || undefined,
            });
          }
          // The last version 3 release could add medications but had no way to record a dose.
          // Count adherence from the upgrade on, so the months before do not show as missed doses.
          // createdAt keeps the original date.
          const upgradedAt = new Date();
          let scheduleCursor = await tx.objectStore('schedules').openCursor();
          while (scheduleCursor) {
            await scheduleCursor.update(startTrackingAt(scheduleCursor.value, upgradedAt));
            scheduleCursor = await scheduleCursor.continue();
          }
        }
      },
      blocked() {
        // Another tab holds an older version open. It will close on versionchange.
      },
      blocking() {
        // A newer version of the app opened in another tab. Release so it can upgrade.
        dbPromise?.then(db => db.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Test helper. Drops the cached connection. */
export function resetDBConnection() {
  dbPromise?.then(db => db.close()).catch(() => {});
  dbPromise = null;
}
