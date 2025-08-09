'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
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
import { cn, getSeverityLabel, getSeverityColor, formatTime, debugLog } from '@/lib/utils';

// Form validation schema
const symptomSchema = z.object({
  names: z.array(z.string()).min(1, 'Select at least one symptom'),
  severity: z.number().min(0).max(10),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof symptomSchema>;

export function QuickLog() {
  const [isOpen, setIsOpen] = useState(false);
  const [favoriteSymptoms, setFavoriteSymptoms] = useState<string[]>([]);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState([4]);
  const [customSymptom, setCustomSymptom] = useState('');
  const [isLogging, setIsLogging] = useState(false);
  const [streak, setStreak] = useState(0);
  const [showCustomInput, setShowCustomInput] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(symptomSchema),
    defaultValues: {
      names: [],
      severity: 4,
      notes: '',
    },
  });

  // Load preferences and streak on mount
  useEffect(() => {
    loadInitialData();
  }, []);

  // Sync selected symptoms with form
  useEffect(() => {
    setValue('names', selectedSymptoms);
  }, [selectedSymptoms, setValue]);

  // Sync severity slider with form
  useEffect(() => {
    setValue('severity', severity[0]);
  }, [severity, setValue]);

  async function loadInitialData() {
    try {
      const prefs = await getPreferences();
      setFavoriteSymptoms(prefs.favoriteSymptoms);
      setSeverity([prefs.defaultSeverity]);
      
      const currentStreak = await getStreak();
      setStreak(currentStreak);
      
      debugLog('Initial data loaded', { prefs, currentStreak });
    } catch (error) {
      console.error('Failed to load initial data:', error);
      toast.error('Failed to load preferences');
    }
  }

  function toggleSymptom(symptom: string) {
    setSelectedSymptoms(prev =>
      prev.includes(symptom)
        ? prev.filter(s => s !== symptom)
        : [...prev, symptom]
    );
  }

  async function addCustomSymptom() {
    if (!customSymptom.trim()) return;
    
    const trimmed = customSymptom.trim();
    toggleSymptom(trimmed);
    
    // Add to favorites if new
    if (!favoriteSymptoms.includes(trimmed)) {
      const updated = [trimmed, ...favoriteSymptoms].slice(0, 8);
      setFavoriteSymptoms(updated);
      await savePreferences({ favoriteSymptoms: updated });
    }
    
    setCustomSymptom('');
    setShowCustomInput(false);
  }

  async function onSubmit(data: FormData) {
    setIsLogging(true);
    const startTime = performance.now();
    
    try {
      // Log each symptom
      for (const name of data.names) {
        await addSymptom({
          name,
          severity: data.severity,
          timestamp: new Date(),
          notes: data.notes,
        });
      }
      
      // Update recent symptoms in preferences
      const recentSymptoms = [...new Set([...data.names, ...favoriteSymptoms])].slice(0, 8);
      await savePreferences({ 
        favoriteSymptoms: recentSymptoms,
        defaultSeverity: data.severity,
      });
      setFavoriteSymptoms(recentSymptoms);
      
      // Update streak
      const newStreak = await getStreak();
      setStreak(newStreak);
      
      // Calculate time taken
      const timeTaken = ((performance.now() - startTime) / 1000).toFixed(1);
      
      // Success feedback
      if (parseFloat(timeTaken) < 7) {
        toast.success(`Logged in ${timeTaken}s! 🚀`, {
          description: `${data.names.join(', ')} • Severity ${data.severity}/10`,
        });
      } else {
        toast.success('Symptoms logged!', {
          description: `${data.names.join(', ')} • Severity ${data.severity}/10`,
        });
      }
      
      // Reset form
      setSelectedSymptoms([]);
      setSeverity([4]);
      setIsOpen(false);
      
      debugLog('Symptoms logged', { data, timeTaken });
    } catch (error) {
      console.error('Failed to log symptoms:', error);
      toast.error('Failed to save symptoms. Please try again.');
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
      
      // Group by name and take highest severity
      const symptomMap = new Map<string, number>();
      yesterdaysSymptoms.forEach(s => {
        const current = symptomMap.get(s.name) || 0;
        symptomMap.set(s.name, Math.max(current, s.severity));
      });
      
      // Log each unique symptom
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
      
      // Update streak
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
      {/* Streak indicator */}
      {streak > 0 && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-full">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            <span className="font-semibold text-blue-900">{streak}-day streak!</span>
          </div>
        </div>
      )}

      {/* Main Log button */}
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

      {/* Quick Log panel */}
      {isOpen && (
        <Card className="p-6 space-y-6 animate-in slide-in-from-top duration-300">
          <h2 className="text-lg font-semibold">Quick Log</h2>

          {/* Symptom selection */}
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
                    onKeyPress={(e) => e.key === 'Enter' && addCustomSymptom()}
                    className="h-8 w-32"
                    autoFocus
                  />
                  <Button size="sm" onClick={addCustomSymptom}>
                    Add
                  </Button>
                </div>
              )}
            </div>
            {errors.names && (
              <p className="text-sm text-red-600 mt-1">{errors.names.message}</p>
            )}
          </div>

          {/* Severity slider */}
          <div>
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Severity</label>
              <span className={cn("text-sm font-bold", getSeverityColor(severity[0]))}>
                {severity[0]}/10 - {getSeverityLabel(severity[0])}
              </span>
            </div>
            <Slider
              value={severity}
              onValueChange={setSeverity}
              min={0}
              max={10}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>None</span>
              <span>Mild</span>
              <span>Moderate</span>
              <span>Severe</span>
              <span>Critical</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Notes (optional):
            </label>
            <Input
              placeholder="Any additional details..."
              {...register('notes')}
            />
          </div>

          {/* Action buttons */}
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
              onClick={handleSubmit(onSubmit)}
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
