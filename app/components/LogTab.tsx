'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Plus, Repeat, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/db/client';

export function LogTab() {
  const [isLogging, setIsLogging] = useState(false);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState(4);
  const [notes, setNotes] = useState('');
  const [streak, setStreak] = useState(0);
  const [customSymptom, setCustomSymptom] = useState('');
  const [recentSymptoms, setRecentSymptoms] = useState<string[]>([]);

  // Common symptoms that users actually track
  const commonSymptoms = ['Headache', 'Fatigue', 'Nausea', 'Pain', 'Insomnia', 'Anxiety', 'Dizziness'];

  useEffect(() => {
    loadRecentSymptoms();
    loadStreak();
  }, []);

  async function loadRecentSymptoms() {
    // Get the user's most frequently logged symptoms
    const symptoms = await db.getAllSymptoms();
    const counts: Record<string, number> = {};
    symptoms.forEach(s => {
      counts[s.name] = (counts[s.name] || 0) + 1;
    });
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    
    // Filter out symptoms that are already in commonSymptoms to avoid duplicates
    const filtered = sorted.filter(s => !commonSymptoms.includes(s));
    setRecentSymptoms(filtered);
  }

  async function loadStreak() {
    const s = await db.updateStreak();
    setStreak(s);
  }

  async function handleLog() {
    if (selectedSymptoms.length === 0) {
      toast.error('Select at least one symptom');
      return;
    }

    const startTime = performance.now();
    
    for (const name of selectedSymptoms) {
      await db.addSymptom({
        id: crypto.randomUUID(),
        name,
        severity,
        timestamp: new Date().toISOString(),
        notes: notes || undefined
      });
    }
    
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    toast.success(`Logged in ${elapsed}s! 🚀`);
    
    setSelectedSymptoms([]);
    setSeverity(4);
    setNotes('');
    setIsLogging(false);
    loadStreak();
    loadRecentSymptoms();
  }

  async function repeatYesterday() {
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
    loadStreak();
  }

  return (
    <div className="space-y-4">
      {/* Quick Actions */}
      <div className="flex gap-2">
        <Button 
          size="lg"
          className="flex-1 h-14"
          onClick={() => setIsLogging(!isLogging)}
        >
          <Plus className="mr-2 h-5 w-5" />
          Quick Log
        </Button>
        
        <Button 
          size="lg"
          variant="outline"
          className="h-14"
          onClick={repeatYesterday}
        >
          <Repeat className="h-5 w-5" />
        </Button>
      </div>

      {/* Logging Form */}
      {isLogging && (
        <Card className="p-4 animate-in slide-in-from-top">
          <h3 className="font-semibold mb-3">What are you feeling?</h3>
          
          {/* Recent symptoms if any (excluding common ones) */}
          {recentSymptoms.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-2">Your frequent symptoms:</p>
              <div className="flex flex-wrap gap-2">
                {recentSymptoms.map(s => (
                  <Button
                    key={s}
                    size="sm"
                    variant={selectedSymptoms.includes(s) ? 'default' : 'secondary'}
                    onClick={() => {
                      setSelectedSymptoms(prev =>
                        prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                      );
                    }}
                    className="rounded-full text-xs"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Common symptoms */}
          <p className="text-xs text-gray-500 mb-2">Common symptoms:</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {commonSymptoms.map(s => (
              <Button
                key={s}
                size="sm"
                variant={selectedSymptoms.includes(s) ? 'default' : 'outline'}
                onClick={() => {
                  setSelectedSymptoms(prev =>
                    prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                  );
                }}
                className="rounded-full"
              >
                {s}
              </Button>
            ))}
          </div>

          {/* Custom symptom */}
          <Input
            placeholder="Other symptom (type and press Enter)"
            value={customSymptom}
            onChange={(e) => setCustomSymptom(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && customSymptom) {
                setSelectedSymptoms(prev => [...prev, customSymptom]);
                setCustomSymptom('');
              }
            }}
            className="mb-4"
          />

          {/* Severity */}
          <div className="mb-4">
            <div className="flex justify-between mb-1">
              <span className="text-sm">Severity</span>
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
          </div>

          {/* Notes */}
          <Input
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mb-4"
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
          <div className="bg-blue-600 h-2 rounded-full transition-all" 
               style={{ width: `${Math.min(streak * 10, 100)}%` }} />
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        Your data stays on this device
      </p>
    </div>
  );
}
