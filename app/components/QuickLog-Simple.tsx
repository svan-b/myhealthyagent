'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Plus, TrendingUp, ChevronDown, Repeat } from 'lucide-react';
import {
  addSymptom,
  getPreferences,
  savePreferences,
  getYesterdaysSymptoms,
  getStreak,
} from '@/lib/db/client';
import { getSeverityLabel, getSeverityColor } from '@/lib/utils';

export function QuickLog() {
  const [isOpen, setIsOpen] = useState(false);
  const [favoriteSymptoms, setFavoriteSymptoms] = useState<string[]>([]);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState(4);
  const [notes, setNotes] = useState('');
  const [customSymptom, setCustomSymptom] = useState('');
  const [isLogging, setIsLogging] = useState(false);
  const [streak, setStreak] = useState(0);
  const [showCustomInput, setShowCustomInput] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      const prefs = await getPreferences();
      setFavoriteSymptoms(prefs.favoriteSymptoms);
      setSeverity(prefs.defaultSeverity);
      const currentStreak = await getStreak();
      setStreak(currentStreak);
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }

  function toggleSymptom(symptom: string) {
    setSelectedSymptoms(prev =>
      prev.includes(symptom)
        ? prev.filter(s => s !== symptom)
        : [...prev, symptom]
    );
  }

  async function handleSave() {
    if (selectedSymptoms.length === 0) {
      toast.error('Select at least one symptom');
      return;
    }

    setIsLogging(true);
    const startTime = performance.now();

    try {
      for (const name of selectedSymptoms) {
        await addSymptom({
          name,
          severity,
          timestamp: new Date(),
          notes: notes || undefined,
        });
      }

      const newStreak = await getStreak();
      setStreak(newStreak);

      const timeTaken = ((performance.now() - startTime) / 1000).toFixed(1);
      toast.success(`Logged in ${timeTaken}s! 🚀`, {
        description: `${selectedSymptoms.join(', ')} • Severity ${severity}/10`,
      });

      setSelectedSymptoms([]);
      setSeverity(4);
      setNotes('');
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to log symptoms:', error);
      toast.error('Failed to save symptoms');
    } finally {
      setIsLogging(false);
    }
  }

  async function repeatYesterday() {
    setIsLogging(true);
    try {
      const yesterdaysSymptoms = await getYesterdaysSymptoms();
      if (yesterdaysSymptoms.length === 0) {
        toast.error('No symptoms found for yesterday');
        return;
      }

      const symptomMap = new Map<string, number>();
      yesterdaysSymptoms.forEach(s => {
        const current = symptomMap.get(s.name) || 0;
        symptomMap.set(s.name, Math.max(current, s.severity));
      });

      for (const [name, maxSeverity] of symptomMap.entries()) {
        await addSymptom({
          name,
          severity: maxSeverity,
          timestamp: new Date(),
          notes: 'Repeated from yesterday',
        });
      }

      toast.success(`Repeated ${symptomMap.size} symptom(s) from yesterday`);
      setIsOpen(false);
      const newStreak = await getStreak();
      setStreak(newStreak);
    } catch (error) {
      console.error('Failed to repeat yesterday:', error);
      toast.error('Failed to repeat yesterday\'s symptoms');
    } finally {
      setIsLogging(false);
    }
  }

  return (
    <div className="space-y-4">
      {streak > 0 && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-full">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            <span className="font-semibold text-blue-900">{streak}-day streak!</span>
          </div>
        </div>
      )}

      <Button
        className="w-full h-20 text-xl font-semibold shadow-lg hover:shadow-xl transition-all"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLogging}
      >
        {isOpen ? (
          <>
            <ChevronDown className="mr-2 h-6 w-6" />
            Close Quick Log
          </>
        ) : (
          <>
            <Plus className="mr-2 h-6 w-6" />
            Log Symptoms
          </>
        )}
      </Button>

      {isOpen && (
        <Card className="p-6 space-y-6 animate-in slide-in-from-top duration-300">
          <h2 className="text-lg font-semibold">Quick Log</h2>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Select symptoms:
            </label>
            <div className="flex flex-wrap gap-2">
              {favoriteSymptoms.map(symptom => (
                <Button
                  key={symptom}
                  type="button"
                  variant={selectedSymptoms.includes(symptom) ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => toggleSymptom(symptom)}
                >
                  {symptom}
                </Button>
              ))}
              
              {!showCustomInput ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setShowCustomInput(true)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Input
                    placeholder="Add symptom..."
                    value={customSymptom}
                    onChange={(e) => setCustomSymptom(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && customSymptom.trim()) {
                        const trimmed = customSymptom.trim();
                        toggleSymptom(trimmed);
                        if (!favoriteSymptoms.includes(trimmed)) {
                          const updated = [trimmed, ...favoriteSymptoms].slice(0, 8);
                          setFavoriteSymptoms(updated);
                          savePreferences({ favoriteSymptoms: updated });
                        }
                        setCustomSymptom('');
                        setShowCustomInput(false);
                      }
                    }}
                    className="h-8 w-32"
                    autoFocus
                  />
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Severity</label>
              <span className={`text-sm font-bold ${getSeverityColor(severity)}`}>
                {severity}/10 - {getSeverityLabel(severity)}
              </span>
            </div>
            
            {/* SIMPLE INLINE STYLED SLIDER - THIS WILL WORK */}
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={severity}
              onChange={(e) => setSeverity(parseInt(e.target.value))}
              style={{
                width: '100%',
                height: '8px',
                background: '#e5e7eb',
                borderRadius: '4px',
                outline: 'none',
                opacity: 1,
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                cursor: 'pointer'
              }}
            />
            
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>None</span>
              <span>Mild</span>
              <span>Moderate</span>
              <span>Severe</span>
              <span>Critical</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Notes (optional):
            </label>
            <Input
              placeholder="Any additional details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={repeatYesterday}
              disabled={isLogging}
            >
              <Repeat className="mr-2 h-4 w-4" />
              Repeat Yesterday
            </Button>
            <Button
              onClick={handleSave}
              disabled={isLogging || selectedSymptoms.length === 0}
            >
              {isLogging ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
