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
import TogglePill from '../ui/TogglePill';

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
  const [selectedSymptom, setSelectedSymptom] = useState<string>('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'severe'>('medium');
  const [duration, setDuration] = useState<number>(30); // default 30 minutes
  const [selectedContext, setSelectedContext] = useState<string[]>([]);
  const [customSymptom, setCustomSymptom] = useState('');
  const [saving, setSaving] = useState(false);
  const [startTime] = useState(Date.now());

  const selectSymptom = React.useCallback((symptom: string) => {
    setSelectedSymptom(symptom);
    // Auto-advance to severity screen for better UX
    setTimeout(() => setScreen('severity'), 300);
  }, []);

  const addCustomSymptom = () => {
    if (customSymptom.trim()) {
      setSelectedSymptom(customSymptom.trim());
      setCustomSymptom('');
      // Auto-advance to severity screen
      setTimeout(() => setScreen('severity'), 300);
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
      // Save the single symptom
      await db.addSymptom({
        id: uuidv4(),
        name: selectedSymptom,
        severity: severityNum,
        timestamp,
        duration_minutes: duration,
        tags: selectedContext
      });

      // Update streak
      await db.updateStreak();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      toast.success(`${selectedSymptom} logged successfully`, {
        description: `Severity: ${severity}, Context: ${selectedContext.join(', ') || 'None'}`
      });

      // Reset
      setSelectedSymptom('');
      setSeverity('medium');
      setDuration(30);
      setSelectedContext([]);
      setScreen('symptoms');
    } catch (error) {
      toast.error('Failed to save symptom');
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  // Screen 1: Symptom Selection
  if (screen === 'symptoms') {
    return (
      <div className="min-h-[600px] bg-white dark:bg-gray-900">
        <div className="max-w-2xl mx-auto">
          {/* Clean Header */}
          <div className="px-4 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white text-center">
              Track Your Health
            </h1>
            <p className="text-sm text-gray-600 text-center mt-1">
              Choose one symptom to log right now
            </p>
            <div className="mt-3 px-3 py-2 bg-slate-100 rounded-lg max-w-md mx-auto">
              <p className="text-xs text-slate-600 text-center">
                Track one symptom at a time for accurate pattern detection
              </p>
            </div>
          </div>

          {/* Symptoms List */}
          <div className="px-4 py-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
              {COMMON_SYMPTOMS.map(symptom => (
                <button
                  key={symptom}
                  onClick={() => selectSymptom(symptom)}
                  className={`w-full h-12 px-4 text-left rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-1
                    ${selectedSymptom === symptom
                      ? 'bg-cyan-600 text-white border-2 border-cyan-700'
                      : 'bg-white border border-slate-300 text-gray-900 hover:bg-slate-50 hover:border-cyan-400'
                    }`}
                >
                  {symptom}
                </button>
              ))}
            </div>

            {/* Custom Symptom */}
            <div className="border-t border-gray-100 dark:border-gray-800 pt-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Other symptom
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={customSymptom}
                  onChange={(e) => setCustomSymptom(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addCustomSymptom()}
                  placeholder="Enter symptom name..."
                  className="flex-1 h-12 px-4 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 
                           rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <Button 
                  onClick={addCustomSymptom}
                  disabled={!customSymptom.trim()}
                  className="h-12 px-6 bg-blue-900 hover:bg-blue-800 text-white rounded-lg 
                           disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Screen 2: Severity
  if (screen === 'severity') {
    return (
      <div className="min-h-[600px] bg-white dark:bg-gray-900">
        <div className="max-w-2xl mx-auto">
          {/* Header with back button */}
          <div className="px-4 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center">
              <button 
                onClick={() => setScreen('symptoms')}
                className="flex items-center text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            </div>
            <div className="text-center mt-4">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                Rate Your {selectedSymptom}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                How intense is it right now?
              </p>
              <div className="mt-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg max-w-md mx-auto">
                <p className="text-xs text-blue-900 dark:text-blue-300 text-center">
                  Rate based on impact to daily activities
                </p>
              </div>
            </div>
          </div>

          {/* Severity Picker */}
          <div className="px-4 py-8">
            <SeverityPicker value={severity} onChange={setSeverity} />
          </div>

          {/* Duration Picker */}
          <div className="px-4 mt-8">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              How long did it last?
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Duration helps identify patterns
            </p>
            <div className="grid grid-cols-3 gap-2 max-w-lg mx-auto">
              {[
                { label: '< 5 min', value: 5 },
                { label: '15 min', value: 15 },
                { label: '30 min', value: 30 },
                { label: '1 hour', value: 60 },
                { label: '2+ hrs', value: 120 },
                { label: 'Ongoing', value: 999 }
              ].map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDuration(value)}
                  className={`py-3 px-3 rounded-lg font-medium text-sm transition-all ${
                    duration === value
                      ? 'bg-blue-900 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="p-4 mt-8 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
            <div className="mb-2 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Next: Add timing details (optional) or save now
              </p>
            </div>
            <div className="flex gap-3 max-w-lg mx-auto">
              <Button
                variant="outline"
                onClick={handleSave}
                className="flex-1 h-12 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300
                         hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Save {selectedSymptom}
              </Button>
              <Button
                onClick={() => setScreen('context')}
                className="flex-1 h-12 bg-blue-900 hover:bg-blue-800 text-white"
              >
                Add Context
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Screen 3: Context (Optional)
  if (screen === 'context') {
    return (
      <div className="min-h-[600px] bg-white dark:bg-gray-900">
        <div className="max-w-2xl mx-auto">
          {/* Header with back button */}
          <div className="px-4 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center">
              <button 
                onClick={() => setScreen('severity')}
                className="flex items-center text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            </div>
            <div className="text-center mt-4">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                When Did This Happen?
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Help us find patterns in your <span className="font-medium text-blue-600 dark:text-blue-400">{selectedSymptom}</span>
              </p>
              <div className="mt-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg max-w-md mx-auto">
                <p className="text-xs text-blue-900 dark:text-blue-300 text-center">
                  Context helps identify triggers and patterns
                </p>
              </div>
            </div>
          </div>

          {/* Context Options */}
          <div className="px-4 py-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
              {CONTEXT_OPTIONS.map(context => (
                <button
                  key={context}
                  onClick={() => toggleContext(context)}
                  className={`
                    w-full h-14 px-4 text-left font-medium rounded-lg border transition-colors duration-150
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                    ${selectedContext.includes(context)
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span>{context}</span>
                    {selectedContext.includes(context) && (
                      <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    )}
                  </div>
                </button>
              ))}
            </div>

            {selectedContext.length > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>Selected:</strong> {selectedContext.join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Bottom Actions */}
          <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
            <div className="mb-3 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Ready to save your {selectedSymptom} with {selectedContext.length > 0 ? `${selectedContext.length} context detail${selectedContext.length > 1 ? 's' : ''}` : 'no context'} 
              </p>
            </div>
            <div className="max-w-lg mx-auto">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full h-14 bg-blue-900 hover:bg-blue-800 text-white disabled:opacity-50 text-base font-medium"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving your health data...
                  </>
                ) : (
                  <>
                    Complete & Save {selectedSymptom}
                  </>
                )}
              </Button>
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2">
                Your data stays secure on this device
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}