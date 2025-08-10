'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Plus, TrendingUp, ChevronDown, Repeat } from 'lucide-react';
import { db } from '@/lib/db/client';
import { getSeverityLabel, getSeverityColor } from '@/lib/utils';

export function QuickLog({ templateData, onTemplateUsed }: any) {
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

  // Template data handler
  useEffect(() => {
    if (templateData) {
      setSelectedSymptoms(templateData.symptoms);
      setSeverity(templateData.severity);
      setIsOpen(true);
      if (onTemplateUsed) onTemplateUsed();
    }
  }, [templateData, onTemplateUsed]);

  async function loadInitialData() {
    try {
      const prefs = await db.getPreferences();
      if (prefs) {
        setFavoriteSymptoms(prefs.favoriteSymptoms);
        setSeverity(prefs.defaultSeverity);
      }
      const currentStreak = await db.updateStreak();
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
        await db.addSymptom({
          id: crypto.randomUUID(),
          name,
          severity,
          timestamp: new Date().toISOString(),
          notes: notes || undefined
        });
      }

      const endTime = performance.now();
      const timeTaken = ((endTime - startTime) / 1000).toFixed(1);

      toast.success(`Logged in ${timeTaken}s! 🚀`);
      
      setSelectedSymptoms([]);
      setNotes('');
      setIsOpen(false);
      
      const newStreak = await db.updateStreak();
      setStreak(newStreak);
    } catch (error) {
      toast.error('Failed to save symptoms');
      console.error(error);
    } finally {
      setIsLogging(false);
    }
  }

  async function repeatYesterday() {
    try {
      const yesterday = await db.getYesterdaysSymptoms();
      if (yesterday.length === 0) {
        toast.error('No symptoms logged yesterday');
        return;
      }

      for (const symptom of yesterday) {
        await db.addSymptom({
          id: crypto.randomUUID(),
          name: symptom.name,
          severity: symptom.severity,
          timestamp: new Date().toISOString(),
          notes: symptom.notes
        });
      }

      toast.success(`Repeated ${yesterday.length} symptoms from yesterday`);
      setIsOpen(false);
      
      const newStreak = await db.updateStreak();
      setStreak(newStreak);
    } catch (error) {
      toast.error('Failed to repeat yesterday');
      console.error(error);
    }
  }

  const commonSymptoms = ['Headache', 'Fatigue', 'Nausea', 'Pain', 'Insomnia'];

  return (
    <div className="w-full space-y-4">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        size="lg"
        className="w-full h-16 text-xl"
      >
        Log Symptoms
      </Button>

      {isOpen && (
        <Card className="p-6 animate-in slide-in-from-top">
          <h2 className="text-xl font-semibold mb-4">Quick Log</h2>

          <div className="flex flex-wrap gap-2 mb-6">
            {commonSymptoms.map(symptom => (
              <Button
                key={symptom}
                variant={selectedSymptoms.includes(symptom) ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleSymptom(symptom)}
                className="rounded-full"
              >
                {symptom}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCustomInput(!showCustomInput)}
              className="rounded-full"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {showCustomInput && (
            <Input
              placeholder="Add custom symptom"
              value={customSymptom}
              onChange={(e) => setCustomSymptom(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && customSymptom) {
                  toggleSymptom(customSymptom);
                  setCustomSymptom('');
                  setShowCustomInput(false);
                }
              }}
              className="mb-4"
              autoFocus
            />
          )}

          <div className="mb-6">
            <div className="flex justify-between mb-2">
              <label className="text-sm font-medium">Severity</label>
              <span className="text-sm font-medium">{severity}/10</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              value={severity}
              onChange={(e) => setSeverity(Number(e.target.value))}
              className="w-full"
              style={{
                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${severity * 10}%, #e5e7eb ${severity * 10}%, #e5e7eb 100%)`
              }}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0</span>
              <span>10</span>
            </div>
          </div>

          <Input
            placeholder="Add a note (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mb-6"
          />

          <div className="space-y-2">
            <Button
              onClick={handleSave}
              className="w-full"
              disabled={selectedSymptoms.length === 0 || isLogging}
            >
              Save
            </Button>
            <Button
              onClick={repeatYesterday}
              variant="outline"
              className="w-full"
            >
              <Repeat className="h-4 w-4 mr-2" />
              Repeat Yesterday
            </Button>
          </div>
        </Card>
      )}

      <div className="text-center py-4">
        <p className="text-2xl font-bold">{streak}-day streak!</p>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${Math.min(streak * 10, 100)}%` }}
          />
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        Your data stays on this device
      </p>
    </div>
  );
}

export default QuickLog;
