export interface Symptom {
  id: string;
  name: string;
  severity: number;
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
