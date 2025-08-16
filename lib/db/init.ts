// lib/db/init.ts
import { openDB } from 'idb';

const DB_NAME = 'myHealthyAgent';
const DB_VERSION = 3; // Bumped from 2 to 3 for schedules and adherence stores

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Original stores (version 1)
      if (!db.objectStoreNames.contains('symptoms')) {
        const store = db.createObjectStore('symptoms', {
          keyPath: 'id',
          autoIncrement: false
        });
        store.createIndex('timestamp', 'timestamp');
      }
      
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('preferences')) {
        db.createObjectStore('preferences', { keyPath: 'id' });
      }
      
      // New store for version 2
      if (oldVersion < 2 && !db.objectStoreNames.contains('meds')) {
        const medsStore = db.createObjectStore('meds', {
          keyPath: 'id',
          autoIncrement: false
        });
        medsStore.createIndex('timestamp', 'timestamp');
        medsStore.createIndex('name', 'name');
      }
      
      // New stores for version 3
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('schedules')) {
          const schedulesStore = db.createObjectStore('schedules', {
            keyPath: 'id',
            autoIncrement: false
          });
          schedulesStore.createIndex('medicationName', 'medicationName');
          schedulesStore.createIndex('isActive', 'isActive');
        }
        
        if (!db.objectStoreNames.contains('adherence')) {
          const adherenceStore = db.createObjectStore('adherence', {
            keyPath: 'id',
            autoIncrement: false
          });
          adherenceStore.createIndex('scheduleId', 'scheduleId');
          adherenceStore.createIndex('status', 'status');
          adherenceStore.createIndex('scheduledTime', 'scheduledTime');
        }
      }
    }
  });
}
