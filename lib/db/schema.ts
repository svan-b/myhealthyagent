// Type definitions for our database
export interface Symptom {
  id: string;
  name: string;
  severity: number;  // 0-10
  timestamp: Date;   // Use Date, not string
  notes?: string;
  tags?: string[];
}

export interface UserPreferences {
  id: 'preferences';  // Singleton
  favoriteSymptoms: string[];
  recentSymptoms: string[];
  defaultSeverity: number;
  streakCount: number;
  lastLogDate?: string;  // ISO string for date comparison
}

export interface Template {
  id: string;
  name: string;
  symptoms: string[];
  defaultSeverity: number;
}
