// lib/db/schema.ts
// All timestamps are ISO 8601 strings in UTC. Display code converts to local time.

/** Something the person felt. */
export interface Symptom {
  id: string;
  name: string;
  /** 1 to 10. The quick logger writes 2, 5, 7 or 9. */
  severity: number;
  /** When the symptom started (or was noticed). */
  timestamp: string;
  /** Length in minutes. Undefined when unknown or ongoing. */
  duration_minutes?: number;
  /** True when the symptom had not ended at the time of logging. */
  ongoing?: boolean;
  notes?: string;
  /** Legacy context tags from earlier versions. Kept for display and export. */
  tags?: string[];
  updatedAt?: string;
}

export type FactorCategory = 'food' | 'drink' | 'activity' | 'sleep' | 'stress' | 'medication' | 'other';

/** Something the person ate, drank, did or experienced that might affect symptoms. */
export interface Factor {
  id: string;
  name: string;
  category: FactorCategory;
  timestamp: string;
  notes?: string;
  updatedAt?: string;
}

export interface UserPreferences {
  id: 'user-preferences';
  customSymptoms: string[];
  customFactors: { name: string; category: FactorCategory }[];
  streakCount: number;
  /** Local date string (Date.toDateString) of the last day anything was logged. */
  lastLogDate?: string;
  onboardedAt?: string;
  lastBackupAt?: string;
  /** Optional name printed on clinician reports. Never leaves the device. */
  reportName?: string;
  /** Signed license token for Pro, issued by /api/license. */
  licenseToken?: string;
  /** Last time the license was confirmed valid by the server. 1970-01-01 means the server said it ended. */
  licenseCheckedAt?: string;
  /**
   * A paid checkout that has not been turned into a license key yet. Saved before anything else
   * happens after Stripe sends the person back, and kept until activation succeeds or fails for good.
   */
  pendingCheckout?: {
    /** Stripe checkout session id (cs_...). */
    sessionId: string;
    /** When the app first saw it. */
    since: string;
  };
}

export type Frequency = 'daily' | 'twice-daily' | 'three-times' | 'four-times' | 'as-needed';

/** Times and frequency a schedule had before an edit. See lib/medication/doses.ts. */
export interface ScheduleVersion {
  frequency: Frequency;
  scheduleTimes: string[];
  /** When this version was replaced by the next one. */
  until: string;
}

/** A pause that has ended. */
export interface SchedulePause {
  from: string;
  to: string;
}

export interface MedicationSchedule {
  id: string;
  medicationName: string;
  dosage: string;
  frequency: Frequency;
  /** Local wall clock times, 24h "HH:mm". Empty for as-needed. */
  scheduleTimes: string[];
  isActive: boolean;
  /** When tracking started. Unrecorded doses due before this never count as missed. */
  startDate: string;
  endDate?: string;
  /** When the current pause started. Only set while paused. */
  pausedAt?: string;
  /** Earlier pauses, oldest first. Doses due during them never count as missed. */
  pauses?: SchedulePause[];
  /** Earlier times and frequency, oldest first, so past days are read against the times in effect then. */
  timesHistory?: ScheduleVersion[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type DoseStatus = 'taken' | 'skipped' | 'missed' | 'pending';

/** One dose record. Store name is "adherence" for backwards compatibility. */
export interface MedicationAdherence {
  id: string;
  scheduleId: string;
  medicationName: string;
  /**
   * For scheduled doses: local date and time "yyyy-MM-ddTHH:mm" the dose was due.
   * For as-needed doses: the ISO time it was taken.
   */
  scheduledTime: string;
  takenTime?: string;
  status: DoseStatus;
  skipReason?: string;
  notes?: string;
}

/** Legacy medication log from v2. Migrated into factors on upgrade. */
export interface MedLog {
  id: string;
  name: string;
  timestamp: string;
  dose?: string;
  notes?: string;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  id: 'user-preferences',
  customSymptoms: [],
  customFactors: [],
  streakCount: 0,
};
