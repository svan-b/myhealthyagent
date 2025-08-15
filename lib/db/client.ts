import { initDB } from "./init";
import type { Symptom, UserPreferences, MedLog } from "./schema";

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

  // Export helpers
  async exportJSON(): Promise<string> {
    const symptoms = await this.getAllSymptoms();
    const meds = await this.getAllMeds();
    const prefs = await this.getPreferences();
    return JSON.stringify({ symptoms, meds, preferences: prefs }, null, 2);
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
};
