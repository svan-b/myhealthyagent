// lib/db/client.ts
import { initDB } from "./init";
import type { Symptom, UserPreferences, MedLog, MedicationSchedule, MedicationAdherence } from "./schema";

export const db = {
  // Symptom operations
  async addSymptom(symptom: Symptom): Promise<void> {
    const idb = await initDB();
    await idb.add("symptoms", symptom);
  },

  async getAllSymptoms(): Promise<Symptom[]> {
    const idb = await initDB();
    const rows = await idb.getAll("symptoms");
    return rows as Symptom[];
  },

  async deleteSymptom(id: string): Promise<void> {
    const idb = await initDB();
    await idb.delete("symptoms", id);
  },

  async updateSymptom(id: string, symptom: Symptom): Promise<void> {
    const idb = await initDB();
    await idb.put("symptoms", symptom);
  },

  async getYesterdaysSymptoms(): Promise<Symptom[]> {
    const symptoms = await this.getAllSymptoms();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    return symptoms.filter(s =>
      new Date(s.timestamp).toDateString() === yesterdayStr
    );
  },

  // Preferences operations
  async getPreferences(): Promise<UserPreferences | undefined> {
    const idb = await initDB();
    return await idb.get("preferences", "user-preferences");
  },

  async savePreferences(prefs: UserPreferences): Promise<void> {
    const idb = await initDB();
    await idb.put("preferences", { ...prefs, id: "user-preferences" });
  },

  async updateStreak(): Promise<number> {
    const prefs = await this.getPreferences() || {
      id: "user-preferences",
      favoriteSymptoms: [],
      recentSymptoms: [],
      defaultSeverity: 4,
      streakCount: 0,
      lastLogDate: undefined
    };

    const today = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    let newStreak = prefs.streakCount;
    if (prefs.lastLogDate === today) {
      // Already logged today, no change
    } else if (prefs.lastLogDate === yesterdayStr) {
      // Continuing streak
      newStreak = prefs.streakCount + 1;
    } else {
      // Streak broken or first log
      newStreak = 1;
    }

    await this.savePreferences({
      ...prefs,
      streakCount: newStreak,
      lastLogDate: today
    });

    return newStreak;
  },

  // Medication operations
  async addMed(med: MedLog): Promise<void> {
    const idb = await initDB();
    await idb.add("meds", med);
  },

  async getAllMeds(): Promise<MedLog[]> {
    const idb = await initDB();
    const rows = await idb.getAll("meds");
    return rows as MedLog[];
  },

  async getMedsInRange(startDate: Date, endDate: Date): Promise<MedLog[]> {
    const meds = await this.getAllMeds();
    return meds.filter(m => {
      const medDate = new Date(m.timestamp);
      return medDate >= startDate && medDate <= endDate;
    });
  },

  async deleteMed(id: string): Promise<void> {
    const idb = await initDB();
    await idb.delete("meds", id);
  },

  async updateMed(id: string, med: MedLog): Promise<void> {
    const idb = await initDB();
    await idb.put("meds", med);
  },

  async getRecentMeds(hours: number = 24): Promise<MedLog[]> {
    const meds = await this.getAllMeds();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return meds.filter(m => new Date(m.timestamp) >= cutoff);
  },

  // ===== MEDICATION SCHEDULES =====
  async getMedicationSchedules(): Promise<MedicationSchedule[]> {
    const idb = await initDB();
    const schedules = await idb.getAll("schedules");
    return schedules.filter(s => s.isActive);
  },

  async getAllMedicationSchedules(): Promise<MedicationSchedule[]> {
    const idb = await initDB();
    return idb.getAll("schedules");
  },

  async saveMedicationSchedule(schedule: MedicationSchedule): Promise<void> {
    const idb = await initDB();
    await idb.put("schedules", schedule);
  },

  async deleteMedicationSchedule(id: string): Promise<void> {
    const idb = await initDB();
    await idb.delete("schedules", id);
  },

  // ===== MEDICATION ADHERENCE =====
  async logAdherence(adherence: MedicationAdherence): Promise<void> {
    const idb = await initDB();
    await idb.put("adherence", adherence);
  },

  async getAdherenceBySchedule(scheduleId: string, days: number = 30): Promise<MedicationAdherence[]> {
    const idb = await initDB();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    const all = await idb.getAll("adherence");
    return all.filter(r => 
      r.scheduleId === scheduleId && 
      new Date(r.scheduledTime) >= cutoff
    );
  },

  async getTodaysDueMedications(): Promise<{schedule: MedicationSchedule, adherence?: MedicationAdherence}[]> {
    const schedules = await this.getMedicationSchedules();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const result = [];
    for (const schedule of schedules) {
      for (const time of schedule.scheduleTimes) {
        const scheduledTime = `${todayStr}T${time}:00`;
        const adherence = await this.getAdherenceForTime(schedule.id, scheduledTime);
        
        if (!adherence || adherence.status === 'pending') {
          result.push({ schedule, adherence });
        }
      }
    }
    return result;
  },

  async getAdherenceForTime(scheduleId: string, scheduledTime: string): Promise<MedicationAdherence | undefined> {
    const idb = await initDB();
    const all = await idb.getAll("adherence");
    return all.find(a => 
      a.scheduleId === scheduleId && 
      a.scheduledTime === scheduledTime
    );
  },

  async updateAdherence(id: string, adherence: MedicationAdherence): Promise<void> {
    const idb = await initDB();
    await idb.put("adherence", adherence);
  },

  // Export helpers
  async exportJSON(): Promise<string> {
    const symptoms = await this.getAllSymptoms();
    const meds = await this.getAllMeds();
    const schedules = await this.getAllMedicationSchedules();
    const adherence = await this.getAllAdherence();
    const prefs = await this.getPreferences();
    return JSON.stringify({ 
      symptoms, 
      meds, 
      schedules,
      adherence,
      preferences: prefs 
    }, null, 2);
  },

  async exportCSV(): Promise<string> {
    const rows = await this.getAllSymptoms();
    const headers = ["id", "name", "severity", "timestamp", "notes", "tags"];
    const body = rows.map(r =>
      [
        r.id, 
        r.name, 
        r.severity, 
        r.timestamp, 
        (r.notes ?? "").replace(/,/g, ";").replace(/\n/g, " "),
        (r.tags ?? []).join(";")
      ].join(",")
    );
    return [headers.join(","), ...body].join("\n");
  },

  async getAllAdherence(): Promise<MedicationAdherence[]> {
    const idb = await initDB();
    return idb.getAll("adherence");
  },
};
