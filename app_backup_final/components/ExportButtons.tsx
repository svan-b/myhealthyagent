// app/components/ExportButtons.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileJson, FileSpreadsheet } from 'lucide-react';
import { db } from '@/lib/db/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function ExportButtons() {
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);

  const exportJSON = async () => {
    setExporting('json');
    try {
      const data = await db.exportJSON();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `health-data-${format(new Date(), 'yyyy-MM-dd')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Data exported!', {
        description: 'JSON backup downloaded to your device'
      });
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    } finally {
      setExporting(null);
    }
  };

  const exportCSV = async () => {
    setExporting('csv');
    try {
      const csv = await db.exportCSV();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `symptoms-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Symptoms exported!', {
        description: 'CSV file downloaded to your device'
      });
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export symptoms');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex gap-2">
      <Button
        onClick={exportJSON}
        disabled={exporting !== null}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <FileJson className="h-4 w-4" />
        {exporting === 'json' ? 'Exporting...' : 'Export JSON'}
      </Button>
      
      <Button
        onClick={exportCSV}
        disabled={exporting !== null}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <FileSpreadsheet className="h-4 w-4" />
        {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
      </Button>
    </div>
  );
}
