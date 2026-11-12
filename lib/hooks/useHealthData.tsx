'use client';

import * as React from 'react';
import { db, subscribe } from '@/lib/db/client';
import type { Factor, MedicationAdherence, MedicationSchedule, Symptom, UserPreferences } from '@/lib/db/schema';
import { DEFAULT_PREFERENCES } from '@/lib/db/schema';

export interface HealthData {
  symptoms: Symptom[];
  factors: Factor[];
  schedules: MedicationSchedule[];
  doses: MedicationAdherence[];
  prefs: UserPreferences;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = React.createContext<HealthData | null>(null);

export function HealthDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<Omit<HealthData, 'reload'>>({
    symptoms: [],
    factors: [],
    schedules: [],
    doses: [],
    prefs: DEFAULT_PREFERENCES,
    loading: true,
    error: null,
  });

  const reload = React.useCallback(async () => {
    try {
      const [symptoms, factors, schedules, doses, prefs] = await Promise.all([
        db.getAllSymptoms(),
        db.getAllFactors(),
        db.getAllMedicationSchedules(),
        db.getAllDoses(),
        db.getPreferences(),
      ]);
      setState({ symptoms, factors, schedules, doses, prefs, loading: false, error: null });
    } catch (e) {
      setState(s => ({
        ...s,
        loading: false,
        error:
          e instanceof Error && e.message ? e.message : 'Could not open local storage. Private browsing can block it.',
      }));
    }
  }, []);

  React.useEffect(() => {
    reload();
    return subscribe(() => {
      reload();
    });
  }, [reload]);

  const value = React.useMemo(() => ({ ...state, reload }), [state, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHealthData(): HealthData {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useHealthData must be used inside HealthDataProvider');
  return v;
}
