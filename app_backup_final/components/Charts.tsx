'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { db } from '@/lib/db/client';
import type { Symptom } from '@/lib/db/schema';
import { format, startOfDay, subDays, isSameDay } from 'date-fns';

export function Charts() {
  const [rows, setRows] = useState<Symptom[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const all = await db.getAllSymptoms();
    all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    setRows(all);
  };

  const severityData = useMemo(() => {
    const out: { date: string; severity: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = startOfDay(subDays(new Date(), i));
      const dayRows = rows.filter(r => isSameDay(new Date(r.timestamp), day));
      const avg = dayRows.length
        ? dayRows.reduce((sum, r) => sum + r.severity, 0) / dayRows.length
        : 0;
      out.push({ date: format(day, 'MMM dd'), severity: Number(avg.toFixed(1)) });
    }
    return out;
  }, [rows]);

  const frequencyData = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach(r => counts.set(r.name, (counts.get(r.name) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-4 text-slate-900 dark:text-slate-100">Severity Trend (7 days)</h3>
        <div className="bg-white dark:bg-slate-800 p-2 rounded-lg">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={severityData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={[0, 10]} />
            <Tooltip />
            <Line type="monotone" dataKey="severity" stroke="#3b82f6" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-4 text-slate-900 dark:text-slate-100">Top Symptoms</h3>
        <div className="bg-white dark:bg-slate-800 p-2 rounded-lg">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={frequencyData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
