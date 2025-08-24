'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Edit2, Search } from 'lucide-react';
import { db } from '@/lib/db/client';
import type { Symptom } from '@/lib/db/schema';
import { toast } from 'sonner';
import { format, startOfDay } from 'date-fns';

type HistoryProps = {
  onStartEdit?: (s: Symptom) => void;
};

const PAGE_SIZE = 30;

export function History({ onStartEdit }: HistoryProps) {
  const [all, setAll] = useState<Symptom[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadSymptoms();
  }, []);

  const loadSymptoms = async () => {
    const rows = await db.getAllSymptoms();
    rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setAll(rows);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? all.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.notes?.toLowerCase().includes(q) ?? false)
        )
      : all;
    return base.slice(0, visibleCount);
  }, [all, search, visibleCount]);

  const grouped = useMemo(() => {
    const map = new Map<string, Symptom[]>();
    for (const s of filtered) {
      const d = startOfDay(new Date(s.timestamp));
      const key = format(d, 'MMM dd, yyyy');
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleDelete = async (row: Symptom) => {
    await db.deleteSymptom(row.id);
    setAll(prev => prev.filter(s => s.id !== row.id));

    toast('Entry deleted', {
      description: 'Undo within 5 seconds',
      action: {
        label: 'Undo',
        onClick: async () => {
          await db.updateSymptom(row.id, row);
          loadSymptoms();
        },
      },
      duration: 5000,
    });
  };

  const startEdit = (row: Symptom) => {
    localStorage.setItem('mha_edit_draft', JSON.stringify(row));
    onStartEdit?.(row);
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500 dark:text-slate-400" />
        <Input
          placeholder="Search symptoms..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
        />
      </div>

      {grouped.map(([date, items]) => (
        <div key={date}>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{date}</h3>
          <div className="space-y-2">
            {items.map(s => (
              <Card key={s.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
                      <span className="text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded">
                        {s.severity}/10
                      </span>
                    </div>
                    {s.notes && <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{s.notes}</p>}
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {format(new Date(s.timestamp), 'h:mm a')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(s)} className="hover:bg-slate-100 dark:hover:bg-slate-700">
                      <Edit2 className="h-3 w-3 text-slate-600 dark:text-slate-400" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(s)} className="hover:bg-slate-100 dark:hover:bg-slate-700">
                      <Trash2 className="h-3 w-3 text-slate-600 dark:text-slate-400" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="text-center py-8 text-slate-700 dark:text-slate-300">
          {search ? 'No results found' : 'No symptoms logged yet'}
        </div>
      )}

      {visibleCount < all.length && !search && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
