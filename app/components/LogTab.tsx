// app/components/LogTab.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Plus, Repeat, Clock, Coffee, Utensils, Pill, X, Milk, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/db/client';
import { evaluateTimingHints } from '@/lib/rules/timing-rules';
import { v4 as uuidv4 } from 'uuid';
import type { MedLog, Symptom, MedicationSchedule, MedicationAdherence } from '@/lib/db/schema';
// Expose db for testing (remove in production)
if (typeof window !== 'undefined') {
  (window as Window & { db: typeof db }).db = db;
}

export function LogTab() {
  const [isLogging, setIsLogging] = useState(false);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState(4);
  const [notes, setNotes] = useState('');
  const [streak, setStreak] = useState(0);
  const [customSymptom, setCustomSymptom] = useState('');
  const [recentSymptoms, setRecentSymptoms] = useState<string[]>([]);
  const [contextTags, setContextTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [medicationName, setMedicationName] = useState('');
  const [medicationDose, setMedicationDose] = useState('');
  const [medSuggestions, setMedSuggestions] = useState<string[]>([]);
  const [dueMedications, setDueMedications] = useState<{
    schedule: MedicationSchedule;
    scheduledTime: string;
    status: 'due' | 'overdue';
  }[]>([]);

  // Common symptoms users actually track
  const commonSymptoms = ['Headache', 'Fatigue', 'Nausea', 'Pain', 'Insomnia', 'Anxiety', 'Dizziness'];

  // Context options for timing analysis (ids are normalized keys passed to rules)
  const contextOptions = [
    { id: 'meal', label: 'Meal', icon: Utensils },
    { id: 'dairy', label: 'Dairy', icon: Milk },
    { id: 'coffee', label: 'Coffee', icon: Coffee },
    { id: 'tea', label: 'Tea', icon: Coffee },
    { id: 'alcohol', label: 'Alcohol', icon: Coffee },
    { id: 'calcium', label: 'Calcium', icon: Pill },
  ];

  useEffect(() => {
    loadRecentSymptoms();
    loadStreak();
    loadMedSuggestions();
    loadDueMedications();
    
    // Check for due medications every minute
    const interval = setInterval(loadDueMedications, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadDueMedications() {
    try {
      const schedules = await db.getMedicationSchedules();
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const todayStr = now.toISOString().split('T')[0];
      
      const due = [];
      for (const schedule of schedules) {
        if (schedule.frequency === 'as-needed') continue;
        
        for (const schedTime of schedule.scheduleTimes) {
          const [schedHour, schedMin] = schedTime.split(':').map(Number);
          const schedMinutes = schedHour * 60 + schedMin;
          const diff = nowMinutes - schedMinutes;
          
          // Check if within window: -45 min to +90 min
          if (diff >= -45 && diff <= 90) {
            const scheduledTime = `${todayStr}T${schedTime}:00.000Z`;
            const adherence = await db.getAdherenceForTime(schedule.id, scheduledTime);
            
            if (!adherence || adherence.status === 'pending') {
              due.push({ 
                schedule, 
                scheduledTime,
                status: diff > 30 ? 'overdue' : 'due'
              });
            }
          }
        }
      }
      setDueMedications(due);
    } catch (error) {
      console.error('Error loading due medications:', error);
    }
  }

  async function handleTakeMedication(schedule: MedicationSchedule, scheduledTime: string) {
    try {
      const adherence: MedicationAdherence = {
        id: uuidv4(),
        scheduleId: schedule.id,
        medicationName: schedule.medicationName,
        scheduledTime,
        takenTime: new Date().toISOString(),
        status: 'taken',
      };
      
      await db.logAdherence(adherence);
      toast.success(`${schedule.medicationName} marked as taken`);
      
      // Also log it as a MedLog for compatibility with existing features
      await db.addMed({
        id: uuidv4(),
        name: schedule.medicationName,
        timestamp: new Date().toISOString(),
        dose: schedule.dosage,
        notes: 'Taken on schedule'
      });
      
      await loadDueMedications();
    } catch (error) {
      console.error('Error marking medication as taken:', error);
      toast.error('Failed to mark medication as taken');
    }
  }

  async function handleSkipMedication(schedule: MedicationSchedule, scheduledTime: string, reason?: string) {
    try {
      const adherence: MedicationAdherence = {
        id: uuidv4(),
        scheduleId: schedule.id,
        medicationName: schedule.medicationName,
        scheduledTime,
        status: 'skipped',
        skipReason: reason,
      };
      
      await db.logAdherence(adherence);
      toast.info(`${schedule.medicationName} skipped`);
      await loadDueMedications();
    } catch (error) {
      console.error('Error marking medication as skipped:', error);
      toast.error('Failed to mark medication as skipped');
    }
  }

  async function loadRecentSymptoms() {
    const symptoms = await db.getAllSymptoms();
    const counts: Record<string, number> = {};
    symptoms.forEach(s => { counts[s.name] = (counts[s.name] || 0) + 1; });

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    // Filter out those already in commonSymptoms to avoid duplicates
    const filtered = sorted.filter(s => !commonSymptoms.includes(s));
    setRecentSymptoms(filtered);
  }

  async function loadStreak() {
    const s = await db.updateStreak();
    setStreak(s);
  }

  async function loadMedSuggestions() {
    try {
      const meds = await db.getRecentMeds(168); // last 7 days
      const byName = new Map<string, number>();
      meds.forEach((m: MedLog) => byName.set(m.name, (byName.get(m.name) || 0) + 1));
      const top = Array.from(byName.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([n]) => n);
      setMedSuggestions(top);
    } catch {
      // Fallback if getRecentMeds not available
      try {
        const allMeds = await db.getAllMeds();
        const byName = new Map<string, number>();
        allMeds.forEach((m: MedLog) => byName.set(m.name, (byName.get(m.name) || 0) + 1));
        const top = Array.from(byName.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([n]) => n);
        setMedSuggestions(top);
      } catch {
        // No meds yet
      }
    }
  }

  const normalizedTags = useMemo(
    () => Array.from(new Set(contextTags.map(t => t.toLowerCase().trim()))),
    [contextTags]
  );

  function toggleSymptom(symptom: string) {
    setSelectedSymptoms(prev =>
      prev.includes(symptom) ? prev.filter(s => s !== symptom) : [...prev, symptom]
    );
  }

  function toggleContext(tag: string) {
    const t = tag.toLowerCase().trim();
    setContextTags(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  }

  function addCustomSymptom() {
    const s = customSymptom.trim();
    if (!s) return;
    toggleSymptom(s);
    setCustomSymptom('');
  }

  function addCustomContextTag() {
    const t = customTag.toLowerCase().trim();
    if (!t) return;
    if (!normalizedTags.includes(t)) setContextTags(prev => [...prev, t]);
    setCustomTag('');
  }

  async function handleLog() {
    if (selectedSymptoms.length === 0) {
      toast.error('Please select at least one symptom');
      return;
    }

    const t0 = Date.now();
    const timestamp = new Date().toISOString();

    try {
      // Write symptoms in parallel
      const symptomWrites = selectedSymptoms.map(symptom =>
        db.addSymptom({
          id: uuidv4(),
          name: symptom,
          severity,
          timestamp,
          notes: notes || undefined,
          tags: normalizedTags.length ? normalizedTags : undefined,
        })
      );
      await Promise.all(symptomWrites);

      // Optional med write
      let medLogged: MedLog | null = null;
      const medName = medicationName.trim();
      const medDose = medicationDose.trim();
      if (medName) {
        const medLog: MedLog = {
          id: uuidv4(),
          name: medName,
          timestamp,
          dose: medDose || undefined,
          notes: undefined,
        };
        await db.addMed(medLog);
        medLogged = medLog;
      }

      // Evaluate timing hints:
      // 1) with current med (if provided)
      // 2) with the most recent meds in the last 24h (covers coffee/meal after earlier meds)
      const [recentMeds, allSymptoms]: [MedLog[], Symptom[]] = await Promise.all([
        db.getRecentMeds(24),
        db.getAllSymptoms(),
      ]);

      const hintPool = [];
      if (medLogged) {
        hintPool.push(
          ...evaluateTimingHints({
            recentSymptoms: allSymptoms,
            recentMeds,
            currentTags: normalizedTags,
            currentMed: medLogged.name,
            now: new Date(),
          }, 2)
        );
      }
      // Evaluate against up to 2 most recent meds even if no current med
      const recentForTags = recentMeds
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 2);

      for (const m of recentForTags) {
        hintPool.push(
          ...evaluateTimingHints({
            recentSymptoms: allSymptoms,
            recentMeds,
            currentTags: normalizedTags,
            currentMed: m.name,
            now: new Date(),
          }, 1)
        );
      }

      // Show timing hints if any (dedupe by rule id/title)
      if (hintPool.length) {
        const order = { High: 3, Medium: 2, Low: 1 } as const;
        const uniq = new Map<string, typeof hintPool[0]>();
        for (const h of hintPool) {
          const key = h.meta?.ruleId ?? h.title;
          const prev = uniq.get(key);
          if (!prev || order[h.confidence] > order[prev.confidence]) uniq.set(key, h);
        }
        Array.from(uniq.values()).slice(0, 2).forEach(hint => {
          toast(hint.title, {
            description: hint.message,
            duration: 8000,
            action: hint.confidence === 'High' ? { label: 'Got it', onClick: () => {} } : undefined,
          });
        });
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.log(`[7-SECOND TEST] Symptom logging completed in ${elapsed}s (${Date.now() - t0}ms)`);
      toast.success(`Logged in ${elapsed}s! 🚀`, {
        description: `${selectedSymptoms.length} symptom${selectedSymptoms.length > 1 ? 's' : ''}${medName ? ' + medication' : ''} saved`,
      });
      
      // Reset form
      setSelectedSymptoms([]);
      setSeverity(4);
      setNotes('');
      setContextTags([]);
      setCustomTag('');
      setMedicationName('');
      setMedicationDose('');
      setIsLogging(false);

      // Refresh UI helpers
      await Promise.all([loadRecentSymptoms(), loadStreak(), loadMedSuggestions()]);
    } catch (error) {
      console.error('Logging error:', error);
      toast.error('Failed to save');
    }
  }

  async function handleRepeatYesterday() {
    const symptoms = await db.getYesterdaysSymptoms();
    if (symptoms.length === 0) {
      toast.error('No symptoms logged yesterday');
      return;
    }
    const uniqueNames = [...new Set(symptoms.map(s => s.name))];
    setSelectedSymptoms(uniqueNames);
    setIsLogging(true);
    toast.success(`Loaded ${uniqueNames.length} symptoms from yesterday`);
  }

  return (
    <div className="space-y-4" role="region" aria-label="Symptom logger">
      {/* Due Medications Strip */}
      {dueMedications.length > 0 && (
        <Card className="p-3 border-orange-200 bg-orange-50 dark:bg-orange-950">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-orange-600" />
            <span className="font-medium text-sm">Medications Due Now</span>
          </div>
          <div className="space-y-2">
            {dueMedications.map(({ schedule, scheduledTime, status }) => (
              <div key={`${schedule.id}-${scheduledTime}`} className="flex items-center justify-between">
                <div className="flex-1">
                  <span className="font-medium">{schedule.medicationName}</span>
                  <span className="text-sm text-gray-600 ml-2">{schedule.dosage}</span>
                  {status === 'overdue' && (
                    <span className="text-xs text-red-600 ml-2">(overdue)</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => handleTakeMedication(schedule, scheduledTime)}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Taken
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSkipMedication(schedule, scheduledTime, 'User skipped')}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Skip
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!isLogging ? (
        <>
          <Button
            onClick={() => setIsLogging(true)}
            className="w-full h-24 text-lg"
            size="lg"
          >
            <Plus className="mr-2 h-6 w-6" />
            Log Symptoms
          </Button>

          <Button
            variant="outline"
            onClick={handleRepeatYesterday}
            className="w-full"
          >
            <Repeat className="mr-2 h-4 w-4" />
            Repeat Yesterday
          </Button>
        </>
      ) : (
        <Card className="p-4">
          {/* Context Tags */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Context (optional)</p>
              {contextTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setContextTags([])}
                  className="h-8 px-2 text-xs"
                >
                  <X className="h-3 w-3 mr-1" /> Clear
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {contextOptions.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={normalizedTags.includes(id) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleContext(id)}
                  className="h-8"
                  aria-pressed={normalizedTags.includes(id)}
                >
                  <Icon className="h-3 w-3 mr-1" aria-hidden />
                  {label}
                </Button>
              ))}
            </div>
            {/* Custom context tag */}
            <div className="flex gap-2 mt-2">
              <Input
                placeholder="Add custom context (e.g., gluten, exercise)"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomContextTag()}
                aria-label="Custom context tag"
                className="text-sm"
              />
              <Button onClick={addCustomContextTag} size="sm">Add</Button>
            </div>
          </div>

          {/* Symptom Selection */}
          <p className="text-sm font-medium mb-2">Select symptoms:</p>

          {/* Common Symptoms */}
          <div className="flex flex-wrap gap-2 mb-3">
            {commonSymptoms.map(symptom => (
              <Button
                key={symptom}
                variant={selectedSymptoms.includes(symptom) ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleSymptom(symptom)}
                aria-pressed={selectedSymptoms.includes(symptom)}
              >
                {symptom}
              </Button>
            ))}
          </div>

          {/* Recent Symptoms */}
          {recentSymptoms.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {recentSymptoms.map(symptom => (
                <Button
                  key={symptom}
                  variant={selectedSymptoms.includes(symptom) ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleSymptom(symptom)}
                  aria-pressed={selectedSymptoms.includes(symptom)}
                >
                  <Clock className="h-3 w-3 mr-1" aria-hidden />
                  {symptom}
                </Button>
              ))}
            </div>
          )}

          {/* Custom Symptom */}
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Add custom symptom"
              value={customSymptom}
              onChange={(e) => setCustomSymptom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomSymptom()}
              aria-label="Custom symptom"
            />
            <Button onClick={addCustomSymptom} size="sm">Add</Button>
          </div>

          {/* Medication Input with suggestions */}
          <div className="mb-4 space-y-2">
            <p className="text-sm font-medium">Medication taken (optional)</p>
            <div className="flex gap-2">
              <Input
                placeholder="Medication name"
                value={medicationName}
                onChange={(e) => setMedicationName(e.target.value)}
                className="flex-1"
                list="med-suggestions"
                aria-label="Medication name"
              />
              <datalist id="med-suggestions">
                {medSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <Input
                placeholder="Dose (e.g., 50mg)"
                value={medicationDose}
                onChange={(e) => setMedicationDose(e.target.value)}
                className="w-32"
                aria-label="Medication dose"
              />
            </div>
          </div>

          {/* Severity Slider */}
          <div className="mb-4">
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium">Severity</span>
              <span className="text-sm font-medium">{severity}/10</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              value={severity}
              onChange={(e) => setSeverity(Number(e.target.value))}
              className="w-full"
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={severity}
              aria-label="Severity slider"
              style={{
                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${severity * 10}%, #e5e7eb ${severity * 10}%, #e5e7eb 100%)`,
              }}
            />
          </div>

          {/* Notes */}
          <Input
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mb-4"
            aria-label="Notes"
          />

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={handleLog}
              className="flex-1"
              disabled={selectedSymptoms.length === 0}
            >
              Save {selectedSymptoms.length > 0 && `(${selectedSymptoms.length})`}
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsLogging(false)}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Streak */}
      <div className="text-center pt-2">
        <p className="text-2xl font-bold">{streak}-day streak!</p>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${Math.min(streak * 10, 100)}%` }}
          />
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">Your data stays on this device</p>
    </div>
  );
}
