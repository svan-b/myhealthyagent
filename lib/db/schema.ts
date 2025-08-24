  // lib/db/schema.ts
export interface Symptom {
  id: string;
  name: string;
  severity: number;
  duration_minutes?: number;
  timestamp: string;  // Changed from Date to string
  notes?: string;
  tags?: string[];
}

export interface UserPreferences {
  id: string;
  favoriteSymptoms: string[];
  recentSymptoms: string[];
  defaultSeverity: number;
  streakCount: number;
  lastLogDate?: string;
}

export interface Template {
  id: string;
  name: string;
  symptoms: string[];
  defaultSeverity: number;
}

export interface MedLog {
  id: string;
  name: string;
  timestamp: string;  // ISO string, consistent with Symptom
  dose?: string;      // e.g., "50mg", "2 tablets"
  notes?: string;     // e.g., "with food", "missed dose"
}

// Medication Schedule Management
export interface MedicationSchedule {
  id: string;
  medicationName: string;
  dosage: string;
  frequency: 'daily' | 'twice-daily' | 'three-times' | 'four-times' | 'as-needed';
  scheduleTimes: string[]; // ['08:00', '20:00'] in 24h format
  isActive: boolean;
  startDate: string; // ISO string
  endDate?: string; // ISO string
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// Medication Adherence Tracking
export interface MedicationAdherence {
  id: string;
  scheduleId: string;
  medicationName: string;
  scheduledTime: string; // ISO string of when it was due
  takenTime?: string; // ISO string of when actually taken
  status: 'taken' | 'skipped' | 'missed' | 'pending';
  skipReason?: string;
  notes?: string;
}
