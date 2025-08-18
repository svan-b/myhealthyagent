// app/components/mobile/QuickLogFlow.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Plus, ChevronRight, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { SeverityPicker } from './SeverityPicker';
import { BottomActions } from './BottomActions';
import { db } from '@/lib/db/client';
import { v4 as uuidv4 } from 'uuid';

const COMMON_SYMPTOMS = [
  'Headache', 'Fatigue', 'Nausea', 'Bloating', 'Pain', 
  'Anxiety', 'Insomnia', 'Dizziness', 'Cramps', 'Brain fog'
];

const CONTEXT_OPTIONS = [
  'After meal', 'Morning', 'Evening', 'Stressed', 
  'Exercise', 'Work', 'Weekend', 'Menstrual'
];

export function QuickLogFlow() {
  const [screen, setScreen] = useState<'symptoms' | 'severity' | 'context'>('symptoms');
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'severe'>('medium');
  const [selectedContext, setSelectedContext] = useState<string[]>([]);
  const [customSymptom, setCustomSymptom] = useState('');
  const [saving, setSaving] = useState(false);
  const [startTime] = useState(Date.now());

  const toggleSymptom = React.useCallback((symptom: string) => {
    setSelectedSymptoms(prev => 
      prev.includes(symptom) 
        ? prev.filter(s => s !== symptom)
        : [...prev, symptom]
    );
  }, []);

  const addCustomSymptom = () => {
    if (customSymptom.trim() && !selectedSymptoms.includes(customSymptom)) {
      setSelectedSymptoms([...selectedSymptoms, customSymptom.trim()]);
      setCustomSymptom('');
    }
  };

  const toggleContext = React.useCallback((context: string) => {
    setSelectedContext(prev =>
      prev.includes(context)
        ? prev.filter(c => c !== context)
        : [...prev, context]
    );
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const timestamp = new Date().toISOString();
    
    // Convert severity to number (1-10)
    const severityMap = { low: 2, medium: 5, high: 7, severe: 9 };
    const severityNum = severityMap[severity];

    try {
      // Save each symptom
      for (const symptom of selectedSymptoms) {
        await db.addSymptom({
          id: uuidv4(),
          name: symptom,
          severity: severityNum,
          timestamp,
          tags: selectedContext
        });
      }

      // Update streak
      await db.updateStreak();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      toast.success(`Logged in ${elapsed}s! 🚀`, {
        description: `${selectedSymptoms.length} symptom(s) tracked`
      });

      // Reset
      setSelectedSymptoms([]);
      setSeverity('medium');
      setSelectedContext([]);
      setScreen('symptoms');
    } catch (error) {
      toast.error('Failed to save symptoms');
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  // Screen 1: Symptom Selection
  if (screen === 'symptoms') {
    return (
      <div className="flex flex-col h-full p-4 pb-20">
        <h2 className="text-xl font-semibold mb-4">What&apos;s bothering you?</h2>
        
        {/* Common symptoms grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {COMMON_SYMPTOMS.map(symptom => (
            <button
              key={symptom}
              type="button"
              aria-pressed={selectedSymptoms.includes(symptom)}
              onPointerDown={(e) => {
                e.preventDefault();
                toggleSymptom(symptom);
              }}
              className={`
                w-full px-3 py-3 rounded-lg border-2 font-medium
                transition-all duration-150 active:scale-95
                ${selectedSymptoms.includes(symptom)
                  ? 'bg-purple-500 text-white border-purple-500 shadow-md'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-purple-300'
                }
              `}
              style={{ touchAction: 'manipulation' }}
            >
              {symptom}
            </button>
          ))}
        </div>

        {/* Custom symptom */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={customSymptom}
            onChange={(e) => setCustomSymptom(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addCustomSymptom()}
            placeholder="Other symptom..."
            className="flex-1 px-3 py-2 border rounded-lg"
          />
          <Button 
            onClick={addCustomSymptom}
            disabled={!customSymptom.trim()}
            size="icon"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Selected count */}
        {selectedSymptoms.length > 0 && (
          <div className="text-sm text-gray-600 mb-4">
            {selectedSymptoms.length} selected: {selectedSymptoms.join(', ')}
          </div>
        )}

        <BottomActions
          primaryLabel="Next"
          primaryIcon={<ChevronRight />}
          onPrimary={() => setScreen('severity')}
          primaryDisabled={selectedSymptoms.length === 0}
        />
      </div>
    );
  }

  // Screen 2: Severity
  if (screen === 'severity') {
    return (
      <div className="flex flex-col h-full p-4 pb-20">
        <button 
          onClick={() => setScreen('symptoms')}
          className="flex items-center text-gray-600 mb-4"
        >
          ← Back
        </button>
        
        <h2 className="text-xl font-semibold mb-2">How severe?</h2>
        <p className="text-gray-600 mb-6">
          Rating for: {selectedSymptoms.join(', ')}
        </p>

        <SeverityPicker value={severity} onChange={setSeverity} />

        <BottomActions
          primaryLabel="Next"
          primaryIcon={<ChevronRight />}
          onPrimary={() => setScreen('context')}
          secondaryLabel="Skip Context"
          onSecondary={handleSave}
        />
      </div>
    );
  }

  // Screen 3: Context (Optional)
  if (screen === 'context') {
    return (
      <div className="flex flex-col h-full p-4 pb-20">
        <button 
          onClick={() => setScreen('severity')}
          className="flex items-center text-gray-600 mb-4"
        >
          ← Back
        </button>
        
        <h2 className="text-xl font-semibold mb-2">Any context?</h2>
        <p className="text-gray-600 mb-6">Optional - helps find patterns</p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {CONTEXT_OPTIONS.map(context => (
            <button
              key={context}
              type="button"
              aria-pressed={selectedContext.includes(context)}
              onPointerDown={(e) => {
                e.preventDefault(); // Prevent any default touch behavior
                toggleContext(context);
              }}
              className={`
                w-full px-3 py-3 rounded-lg border-2 font-medium
                transition-all duration-150 active:scale-95
                ${selectedContext.includes(context)
                  ? 'bg-blue-500 text-white border-blue-500 shadow-md'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                }
              `}
              style={{ touchAction: 'manipulation' }} // Removes 300ms delay on mobile
            >
              {context}
            </button>
          ))}
        </div>

        <BottomActions
          primaryLabel={saving ? "Saving..." : "Save"}
          primaryIcon={<Check />}
          onPrimary={handleSave}
          primaryDisabled={saving}
          secondaryLabel="Skip"
          onSecondary={handleSave}
        />
      </div>
    );
  }

  return null;
}
