import { initDB } from "./init";
import type { Symptom, UserPreferences } from "./schema";

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

  // Export helpers
  async exportJSON(): Promise<string> {
    const rows = await this.getAllSymptoms();
    return JSON.stringify(rows, null, 2);
  },

  async exportCSV(): Promise<string> {
    const rows = await this.getAllSymptoms();
    const headers = ["id", "name", "severity", "timestamp", "notes"];
    const body = rows.map(r =>
      [r.id, r.name, r.severity, r.timestamp, (r.notes ?? "").replace(/\n/g, " ")].join(",")
    );
    return [headers.join(","), ...body].join("\n");
  },
};
