import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Symptom, UserPreferences, Template } from './schema';

interface HealthDB extends DBSchema {
  symptoms: {
    key: string;
    value: Symptom;
    indexes: { 'by-date': Date; 'by-name': string };
  };
  preferences: {
    key: 'preferences';
    value: UserPreferences;
  };
  templates: {
    key: string;
    value: Template;
  };
}

let dbInstance: IDBPDatabase<HealthDB> | null = null;

// Initialize database with error recovery
export async function getDB(): Promise<IDBPDatabase<HealthDB>> {
  if (dbInstance) return dbInstance;
  
  try {
    dbInstance = await openDB<HealthDB>('myHealthyAgent', 1, {
      upgrade(db, oldVersion, newVersion, transaction) {
        console.log(`Upgrading DB from v${oldVersion} to v${newVersion}`);
        
        // Create symptoms store
        if (!db.objectStoreNames.contains('symptoms')) {
          const store = db.createObjectStore('symptoms', { keyPath: 'id' });
          store.createIndex('by-date', 'timestamp');
          store.createIndex('by-name', 'name');
        }
        
        // Create preferences store
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'id' });
        }
        
        // Create templates store
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
      },
      blocked() {
        console.warn('Database upgrade blocked - please close other tabs');
      },
      blocking() {
        console.log('This tab is blocking database upgrade');
        dbInstance?.close();
        dbInstance = null;
      },
    });
    
    console.log('✅ Database initialized successfully');
    return dbInstance;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw new Error('Failed to initialize database. Please refresh the page.');
  }
}

// Add symptom with validation
export async function addSymptom(symptom: Omit<Symptom, 'id'>): Promise<Symptom> {
  const db = await getDB();
  const newSymptom: Symptom = {
    ...symptom,
    id: crypto.randomUUID(),
  };
  
  await db.add('symptoms', newSymptom);
  console.log('✅ Symptom saved:', newSymptom.name);
  
  // Update streak
  await updateStreak();
  
  return newSymptom;
}

// Get recent symptoms with proper date handling
export async function getRecentSymptoms(days = 30): Promise<Symptom[]> {
  const db = await getDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const tx = db.transaction('symptoms', 'readonly');
  const index = tx.store.index('by-date');
  const range = IDBKeyRange.lowerBound(cutoff);
  
  const symptoms = await index.getAll(range);
  return symptoms.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

// Get yesterday's symptoms for repeat feature
export async function getYesterdaysSymptoms(): Promise<Symptom[]> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);
  
  const db = await getDB();
  const tx = db.transaction('symptoms', 'readonly');
  const index = tx.store.index('by-date');
  const range = IDBKeyRange.bound(yesterday, endOfYesterday);
  
  return index.getAll(range);
}

// Preferences with defaults
export async function getPreferences(): Promise<UserPreferences> {
  const db = await getDB();
  const prefs = await db.get('preferences', 'preferences');
  
  return prefs || {
    id: 'preferences',
    favoriteSymptoms: ['Headache', 'Fatigue', 'Nausea', 'Cough'],
    recentSymptoms: [],
    defaultSeverity: 4,
    streakCount: 0,
    lastLogDate: undefined,
  };
}

export async function savePreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const db = await getDB();
  const current = await getPreferences();
  await db.put('preferences', { ...current, ...prefs });
}

// Streak tracking
export async function updateStreak(): Promise<number> {
  const prefs = await getPreferences();
  const today = new Date().toDateString();
  const lastLog = prefs.lastLogDate ? new Date(prefs.lastLogDate).toDateString() : null;
  
  let newStreak = prefs.streakCount;
  
  if (!lastLog) {
    // First log ever
    newStreak = 1;
  } else if (lastLog === today) {
    // Already logged today, no change
    return newStreak;
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastLog === yesterday.toDateString()) {
      // Consecutive day!
      newStreak++;
    } else {
      // Streak broken
      newStreak = 1;
    }
  }
  
  await savePreferences({
    streakCount: newStreak,
    lastLogDate: new Date().toISOString(),
  });
  
  return newStreak;
}

export async function getStreak(): Promise<number> {
  const prefs = await getPreferences();
  return prefs.streakCount;
}
