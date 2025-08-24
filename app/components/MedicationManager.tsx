'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/db/client';
import type { MedicationSchedule } from '@/lib/db/schema';

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Once daily', times: ['08:00'] },
  { value: 'twice-daily', label: 'Twice daily', times: ['08:00', '20:00'] },
  { value: 'three-times', label: 'Three times daily', times: ['08:00', '14:00', '20:00'] },
  { value: 'four-times', label: 'Four times daily', times: ['08:00', '12:00', '16:00', '20:00'] },
  { value: 'as-needed', label: 'As needed', times: [] }
];

export function MedicationManager() {
  const [medications, setMedications] = useState<MedicationSchedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingMed, setEditingMed] = useState<MedicationSchedule | null>(null);
  const [formData, setFormData] = useState({
    medicationName: '',
    dosage: '',
    frequency: 'daily',
    scheduleTimes: ['08:00'],
    notes: ''
  });

  useEffect(() => {
    loadMedications();
  }, []);

  async function loadMedications() {
    try {
      const schedules = await db.getAllMedicationSchedules();
      setMedications(schedules);
    } catch (error) {
      console.error('Error loading medications:', error);
    }
  }

  function resetForm() {
    setFormData({
      medicationName: '',
      dosage: '',
      frequency: 'daily',
      scheduleTimes: ['08:00'],
      notes: ''
    });
    setEditingMed(null);
    setShowForm(false);
  }

  function handleEdit(med: MedicationSchedule) {
    setEditingMed(med);
    setFormData({
      medicationName: med.medicationName,
      dosage: med.dosage,
      frequency: med.frequency,
      scheduleTimes: med.scheduleTimes,
      notes: med.notes || ''
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!formData.medicationName || !formData.dosage) {
      toast.error('Please fill in medication name and dosage');
      return;
    }

    try {
      const now = new Date().toISOString();
      const schedule: MedicationSchedule = {
        id: editingMed?.id || uuidv4(),
        medicationName: formData.medicationName,
        dosage: formData.dosage,
        frequency: formData.frequency as MedicationSchedule['frequency'],
        scheduleTimes: formData.scheduleTimes,
        isActive: true,
        startDate: editingMed?.startDate || now,
        notes: formData.notes,
        createdAt: editingMed?.createdAt || now,
        updatedAt: now
      };

      await db.saveMedicationSchedule(schedule);
      toast.success(editingMed ? 'Medication updated' : 'Medication added');
      
      resetForm();
      loadMedications();
    } catch (error) {
      console.error('Error saving medication:', error);
      toast.error('Failed to save medication');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this medication schedule?')) return;
    
    try {
      await db.deleteMedicationSchedule(id);
      toast.success('Medication deleted');
      loadMedications();
    } catch (error) {
      console.error('Error deleting medication:', error);
      toast.error('Failed to delete medication');
    }
  }

  async function toggleActive(med: MedicationSchedule) {
    try {
      await db.saveMedicationSchedule({
        ...med,
        isActive: !med.isActive,
        updatedAt: new Date().toISOString()
      });
      loadMedications();
      toast.success(med.isActive ? 'Medication paused' : 'Medication activated');
    } catch (error) {
      console.error('Error toggling medication:', error);
      toast.error('Failed to update medication');
    }
  }

  function handleFrequencyChange(freq: string) {
    const option = FREQUENCY_OPTIONS.find(o => o.value === freq);
    setFormData({
      ...formData,
      frequency: freq,
      scheduleTimes: option?.times || []
    });
  }

  function updateScheduleTime(index: number, time: string) {
    const newTimes = [...formData.scheduleTimes];
    newTimes[index] = time;
    setFormData({ ...formData, scheduleTimes: newTimes });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Medication Schedules</h2>
        <Button onClick={() => setShowForm(true)} disabled={showForm} className="bg-cyan-600 hover:bg-cyan-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Medication
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-900 dark:text-slate-100">{editingMed ? 'Edit' : 'Add'} Medication</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                placeholder="Medication name"
                value={formData.medicationName}
                onChange={(e) => setFormData({ ...formData, medicationName: e.target.value })}
                className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 placeholder-slate-500 dark:placeholder-slate-400"
                required
              />
              
              <Input
                placeholder="Dosage (e.g., 50mg, 2 tablets)"
                value={formData.dosage}
                onChange={(e) => setFormData({ ...formData, dosage: e.target.value })}
                className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 placeholder-slate-500 dark:placeholder-slate-400"
                required
              />

              <div>
                <label className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2 block">Frequency</label>
                <select
                  value={formData.frequency}
                  onChange={(e) => handleFrequencyChange(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600"
                >
                  {FREQUENCY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {formData.frequency !== 'as-needed' && formData.scheduleTimes.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2 block">Schedule Times</label>
                  <div className="space-y-2">
                    {formData.scheduleTimes.map((time, idx) => (
                      <Input
                        key={idx}
                        type="time"
                        value={time}
                        onChange={(e) => updateScheduleTime(idx, e.target.value)}
                        className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                      />
                    ))}
                  </div>
                </div>
              )}

              <Input
                placeholder="Notes (optional)"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 placeholder-slate-500 dark:placeholder-slate-400"
              />

              <div className="flex gap-2">
                <Button type="submit" className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white">
                  {editingMed ? 'Update' : 'Add'} Medication
                </Button>
                <Button type="button" variant="outline" onClick={resetForm} className="text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {medications.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-slate-700 dark:text-slate-300">
              No medications scheduled yet
            </CardContent>
          </Card>
        ) : (
          medications.map(med => (
            <Card key={med.id} className={!med.isActive ? 'opacity-50' : ''}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {med.medicationName} - {med.dosage}
                  </div>
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    {med.frequency === 'as-needed' 
                      ? 'As needed' 
                      : med.scheduleTimes.join(', ')}
                  </div>
                  {med.notes && (
                    <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">{med.notes}</div>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={med.isActive ? 'outline' : 'default'}
                    onClick={() => toggleActive(med)}
                    className={med.isActive ? "hover:bg-slate-100 dark:hover:bg-slate-700" : "bg-green-600 hover:bg-green-700 text-white"}
                  >
                    {med.isActive ? <X className="h-4 w-4 text-slate-600 dark:text-slate-400" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(med)}
                    className="hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Edit2 className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(med.id)}
                    className="hover:bg-red-600"
                  >
                    <Trash2 className="h-4 w-4 text-white" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
