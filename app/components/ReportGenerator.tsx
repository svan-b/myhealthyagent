'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Download, Share2 } from 'lucide-react';
import { db } from '@/lib/db/client';
import { format } from 'date-fns';
import { toast } from 'sonner';

export function ReportGenerator() {
  const [generating, setGenerating] = useState(false);

  const generatePDF = async () => {
    setGenerating(true);
    try {
      const jsPDF = (await import('jspdf')).default;
      const symptoms = await db.getAllSymptoms();
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(20);
      doc.text('Symptom Report', 20, 20);
      
      doc.setFontSize(10);
      doc.text(`Generated: ${format(new Date(), 'PPP')}`, 20, 30);
      doc.text(`Total entries: ${symptoms.length}`, 20, 36);
      
      // Sort symptoms by date (newest first)
      const sortedSymptoms = symptoms
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 30); // Take last 30 for PDF
      
      // Content
      let yPosition = 50;
      doc.setFontSize(12);
      doc.text('Recent Symptoms (Last 30 entries):', 20, yPosition);
      yPosition += 10;
      
      doc.setFontSize(10);
      sortedSymptoms.forEach((symptom, index) => {
        if (yPosition > 270) { // Start new page if needed
          doc.addPage();
          yPosition = 20;
        }
        
        const date = format(new Date(symptom.timestamp), 'MM/dd/yy h:mm a');
        const line = `${date} - ${symptom.name} (${symptom.severity}/10)`;
        doc.text(line, 20, yPosition);
        
        if (symptom.notes) {
          yPosition += 5;
          const notes = symptom.notes.substring(0, 60);
          doc.setFontSize(8);
          doc.text(`  Notes: ${notes}`, 20, yPosition);
          doc.setFontSize(10);
        }
        
        yPosition += 8;
      });
      
      // Add summary stats
      doc.addPage();
      doc.setFontSize(14);
      doc.text('Summary Statistics', 20, 20);
      
      doc.setFontSize(10);
      const symptomCounts: { [key: string]: number } = {};
      symptoms.forEach(s => {
        symptomCounts[s.name] = (symptomCounts[s.name] || 0) + 1;
      });
      
      const topSymptoms = Object.entries(symptomCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      let statY = 35;
      doc.text('Top Symptoms:', 20, statY);
      statY += 8;
      
      topSymptoms.forEach(([name, count]) => {
        doc.text(`• ${name}: ${count} times`, 25, statY);
        statY += 6;
      });
      
      // Average severity
      const avgSeverity = symptoms.length > 0
        ? (symptoms.reduce((sum, s) => sum + s.severity, 0) / symptoms.length).toFixed(1)
        : 0;
      
      statY += 10;
      doc.text(`Average Severity: ${avgSeverity}/10`, 20, statY);
      
      // Save PDF
      doc.save(`symptom-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success('PDF Report generated!');
    } catch (error) {
      toast.error('Failed to generate PDF');
      console.error(error);
    }
    setGenerating(false);
  };

  const exportJSON = async () => {
    try {
      const json = await db.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `symptoms-${format(new Date(), 'yyyy-MM-dd')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data exported as JSON');
    } catch (error) {
      toast.error('Export failed');
      console.error(error);
    }
  };

  const exportCSV = async () => {
    try {
      const csv = await db.exportCSV();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `symptoms-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data exported as CSV');
    } catch (error) {
      toast.error('Export failed');
      console.error(error);
    }
  };

  return (
    <div className="space-y-3">
      <Button 
        onClick={generatePDF}
        disabled={generating}
        className="w-full"
        size="lg"
      >
        <FileText className="mr-2 h-4 w-4" />
        Generate PDF Report
      </Button>
      
      <div className="grid grid-cols-2 gap-2">
        <Button 
          onClick={exportJSON}
          variant="outline"
          size="sm"
        >
          <Download className="mr-2 h-3 w-3" />
          Export JSON
        </Button>
        
        <Button 
          onClick={exportCSV}
          variant="outline"
          size="sm"
        >
          <Download className="mr-2 h-3 w-3" />
          Export CSV
        </Button>
      </div>
    </div>
  );
}
