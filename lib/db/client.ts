// lib/db/client.ts
import { initDB, STORES } from './init';
import {
  DEFAULT_PREFERENCES,
  type Factor,
  type MedicationAdherence,
  type MedicationSchedule,
  type Symptom,
  type UserPreferences,
} from './schema';

export const MAX_NAME_LENGTH = 60;
export const MAX_NOTE_LENGTH = 1000;

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

function cleanNote(note?: string): string | undefined {
  const n = note?.trim().slice(0, MAX_NOTE_LENGTH);
  return n ? n : undefined;
}

function assertValidTime(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error('Invalid date');
  // Allow small clock skew, but not entries far in the future.
  if (t > Date.now() + 5 * 60_000) throw new Error('That time is in the future');
}

function normalizeSymptom(s: Symptom): Symptom {
  const name = cleanName(s.name);
  if (!name) throw new Error('Symptom name is required');
  assertValidTime(s.timestamp);
  const severity = Math.round(Math.min(10, Math.max(1, Number(s.severity) || 1)));
  const duration =
    s.duration_minutes != null && Number.isFinite(s.duration_minutes) && s.duration_minutes > 0
      ? Math.round(s.duration_minutes)
      : undefined;
  return {
    ...s,
    name,
    severity,
    timestamp: new Date(s.timestamp).toISOString(),
    duration_minutes: s.ongoing ? undefined : duration,
    notes: cleanNote(s.notes),
  };
}

function normalizeFactor(f: Factor): Factor {
  const name = cleanName(f.name);
  if (!name) throw new Error('Name is required');
  assertValidTime(f.timestamp);
  return { ...f, name, timestamp: new Date(f.timestamp).toISOString(), notes: cleanNote(f.notes) };
}

/** Accepts preferences saved by any earlier version and fills gaps. */
export function normalizePreferences(raw: unknown): UserPreferences {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const customFactors = Array.isArray(p.customFactors)
    ? (p.customFactors as UserPreferences['customFactors']).filter(f => f && typeof f.name === 'string')
    : [];
  return {
    ...DEFAULT_PREFERENCES,
    customSymptoms: strings(p.customSymptoms),
    customFactors,
    streakCount: typeof p.streakCount === 'number' ? p.streakCount : 0,
    lastLogDate: typeof p.lastLogDate === 'string' ? p.lastLogDate : undefined,
    onboardedAt: typeof p.onboardedAt === 'string' ? p.onboardedAt : undefined,
    lastBackupAt: typeof p.lastBackupAt === 'string' ? p.lastBackupAt : undefined,
    reportName: typeof p.reportName === 'string' ? p.reportName : undefined,
    licenseToken: typeof p.licenseToken === 'string' ? p.licenseToken : undefined,
    licenseCheckedAt: typeof p.licenseCheckedAt === 'string' ? p.licenseCheckedAt : undefined,
  };
}

const byTimeDesc = <T extends { timestamp: string }>(a: T, b: T) => b.timestamp.localeCompare(a.timestamp);

/** Subscribers are told when data changes so open screens can refresh. */
type Listener = () => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
function getChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('mha-data');
    channel.onmessage = () => listeners.forEach(l => l());
  }
  return channel;
}
let notifyScheduled = false;
/** Tells open screens (and other tabs) that data changed. Bursts of writes are coalesced into one refresh. */
function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  setTimeout(() => {
    notifyScheduled = false;
    listeners.forEach(l => l());
    getChannel()?.postMessage('changed');
  }, 0);
}
export function subscribe(listener: Listener): () => void {
  getChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const db = {
  // ----- Symptoms -----
  async addSymptom(symptom: Symptom): Promise<Symptom> {
    const clean = normalizeSymptom(symptom);
    const idb = await initDB();
    await idb.put('symptoms', clean);
    await this.recordActivity();
    notify();
    return clean;
  },

  async updateSymptom(symptom: Symptom): Promise<void> {
    const idb = await initDB();
    await idb.put('symptoms', { ...normalizeSymptom(symptom), updatedAt: new Date().toISOString() });
    notify();
  },

  async deleteSymptom(id: string): Promise<void> {
    const idb = await initDB();
    await idb.delete('symptoms', id);
    notify();
  },

  async restoreSymptom(symptom: Symptom): Promise<void> {
    const idb = await initDB();
    await idb.put('symptoms', symptom);
    notify();
  },

  async getAllSymptoms(): Promise<Symptom[]> {
    const idb = await initDB();
    const rows = (await idb.getAll('symptoms')) as Symptom[];
    return rows.sort(byTimeDesc);
  },

  // ----- Factors (food, drink, activity, sleep, stress, medication, other) -----
  async addFactors(factors: Factor[]): Promise<void> {
    const clean = factors.map(normalizeFactor);
    const idb = await initDB();
    const tx = idb.transaction('factors', 'readwrite');
    await Promise.all([...clean.map(f => tx.store.put(f)), tx.done]);
    await this.recordActivity();
    notify();
  },

  async updateFactor(factor: Factor): Promise<void> {
    const idb = await initDB();
    await idb.put('factors', { ...normalizeFactor(factor), updatedAt: new Date().toISOString() });
    notify();
  },

  async deleteFactor(id: string): Promise<void> {
    const idb = await initDB();
    await idb.delete('factors', id);
    notify();
  },

  async restoreFactor(factor: Factor): Promise<void> {
    const idb = await initDB();
    await idb.put('factors', factor);
    notify();
  },

  async getAllFactors(): Promise<Factor[]> {
    const idb = await initDB();
    const rows = (await idb.getAll('factors')) as Factor[];
    return rows.sort(byTimeDesc);
  },

  // ----- Preferences -----
  async getPreferences(): Promise<UserPreferences> {
    const idb = await initDB();
    return normalizePreferences(await idb.get('preferences', 'user-preferences'));
  },

  async updatePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const idb = await initDB();
    const tx = idb.transaction('preferences', 'readwrite');
    const current = normalizePreferences(await tx.store.get('user-preferences'));
    const next: UserPreferences = { ...current, ...patch, id: 'user-preferences' };
    await tx.store.put(next);
    await tx.done;
    notify();
    return next;
  },

  /** Updates the daily streak. Called after anything is logged. */
  async recordActivity(now = new Date()): Promise<number> {
    const prefs = await this.getPreferences();
    const today = now.toDateString();
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    let streak = prefs.streakCount;
    if (prefs.lastLogDate === today) {
      streak = Math.max(streak, 1);
    } else if (prefs.lastLogDate === y.toDateString()) {
      streak += 1;
    } else {
      streak = 1;
    }
    await this.updatePreferences({ streakCount: streak, lastLogDate: today });
    return streak;
  },

  /** Streak to display. Shows 0 if the person missed yesterday and has not logged today. */
  currentStreak(prefs: UserPreferences, now = new Date()): number {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    if (prefs.lastLogDate === now.toDateString() || prefs.lastLogDate === y.toDateString()) {
      return prefs.streakCount;
    }
    return 0;
  },

  async rememberCustomSymptom(name: string): Promise<void> {
    const prefs = await this.getPreferences();
    const clean = cleanName(name);
    const list = [clean, ...prefs.customSymptoms.filter(s => s.toLowerCase() !== clean.toLowerCase())].slice(0, 20);
    await this.updatePreferences({ customSymptoms: list });
  },

  async rememberCustomFactor(name: string, category: Factor['category']): Promise<void> {
    const prefs = await this.getPreferences();
    const clean = cleanName(name);
    const list = [
      { name: clean, category },
      ...prefs.customFactors.filter(f => f.name.toLowerCase() !== clean.toLowerCase()),
    ].slice(0, 30);
    await this.updatePreferences({ customFactors: list });
  },

  // ----- Medication schedules -----
  async getAllMedicationSchedules(): Promise<MedicationSchedule[]> {
    const idb = await initDB();
    const rows = (await idb.getAll('schedules')) as MedicationSchedule[];
    return rows.sort((a, b) => a.medicationName.localeCompare(b.medicationName));
  },

  async saveMedicationSchedule(schedule: MedicationSchedule): Promise<void> {
    const name = cleanName(schedule.medicationName);
    if (!name) throw new Error('Medication name is required');
    const times = Array.from(new Set(schedule.scheduleTimes.filter(t => /^\d{2}:\d{2}$/.test(t)))).sort();
    const idb = await initDB();
    await idb.put('schedules', {
      ...schedule,
      medicationName: name,
      dosage: schedule.dosage.trim().slice(0, MAX_NAME_LENGTH),
      notes: cleanNote(schedule.notes),
      scheduleTimes: schedule.frequency === 'as-needed' ? [] : times,
    });
    notify();
  },

  async deleteMedicationSchedule(id: string): Promise<void> {
    const idb = await initDB();
    const tx = idb.transaction(['schedules', 'adherence'], 'readwrite');
    await tx.objectStore('schedules').delete(id);
    let cursor = await tx.objectStore('adherence').index('scheduleId').openCursor(id);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
    notify();
  },

  // ----- Dose records -----
  async getAllDoses(): Promise<MedicationAdherence[]> {
    const idb = await initDB();
    return (await idb.getAll('adherence')) as MedicationAdherence[];
  },

  async saveDose(dose: MedicationAdherence): Promise<void> {
    const idb = await initDB();
    await idb.put('adherence', dose);
    if (dose.status === 'taken') await this.recordActivity();
    notify();
  },

  async deleteDose(id: string): Promise<void> {
    const idb = await initDB();
    await idb.delete('adherence', id);
    notify();
  },

  // ----- Everything -----
  async deleteAllData(): Promise<void> {
    const idb = await initDB();
    const names = STORES.filter(s => idb.objectStoreNames.contains(s));
    const tx = idb.transaction(names, 'readwrite');
    // A purchased license is not health data. Keep it so the person does not lose Pro.
    const prefs = normalizePreferences(await tx.objectStore('preferences').get('user-preferences'));
    await Promise.all(names.map(n => tx.objectStore(n).clear()));
    if (prefs.licenseToken) {
      await tx.objectStore('preferences').put({
        ...DEFAULT_PREFERENCES,
        onboardedAt: prefs.onboardedAt,
        licenseToken: prefs.licenseToken,
        licenseCheckedAt: prefs.licenseCheckedAt,
      });
    }
    await tx.done;
    try {
      localStorage.removeItem('mha_edit_draft');
    } catch {
      // Storage may be unavailable in private mode
    }
    notify();
  },

  notifyChanged: notify,
};

/**
 * Ask the browser to keep our data even when storage is tight.
 * Safe to call repeatedly. Returns true if storage is persistent.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
