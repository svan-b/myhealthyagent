import { openDB } from 'idb';

const DB_NAME = 'myHealthyAgent';
const DB_VERSION = 2; // Bumped from 1 to 2 for meds store

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
    }
  });
}
