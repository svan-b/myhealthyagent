// app/page.tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// Removed old LogTab - using QuickLogFlow for all devices
import { QuickLogFlow } from './components/mobile/QuickLogFlow';
import { DiscoveryMode } from './components/DiscoveryMode';
import { History } from './components/History';
import { MedicationManager } from './components/MedicationManager';
import { ThemeToggle } from './components/ThemeToggle';
import { InstallPrompt } from './components/InstallPrompt';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import ShareExportSheet from './components/ui/ShareExportSheet';
import { db } from '@/lib/db/client';
import { format } from 'date-fns';

const Charts = dynamic(() => import('./components/Charts').then(m => m.Charts), {
  ssr: false,
});

// Using clean, simple UI for both mobile and desktop

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'log' | 'history' | 'charts' | 'medications'>('log');
  const [showExportSheet, setShowExportSheet] = useState(false);
  
  const handleStartEdit = () => {
    setActiveTab('log');
    toast('Editing entry', { description: 'Loaded into Quick Log' });
  };

  // Export functions for ShareExportSheet
  const exportJSON = async () => {
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
      toast.success('Data exported!', { description: 'JSON backup downloaded' });
    } catch {
      toast.error('Failed to export data');
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
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Symptoms exported!', { description: 'CSV file downloaded' });
    } catch {
      toast.error('Failed to export symptoms');
    }
  };

  const generateVisitReport = async () => {
    try {
      const { default: jsPDF } = await import('jspdf');
      const { subDays } = await import('date-fns');
      
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 30);
      
      // Fetch data
      const allSymptoms = await db.getAllSymptoms();
      const symptoms = allSymptoms.filter(s => new Date(s.timestamp) >= thirtyDaysAgo);
      
      // Create PDF
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('myHealthyAgent — Visit Report', 20, 20);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${format(now, 'PPP')}`, 20, 30);
      doc.text(`Period: ${format(thirtyDaysAgo, 'MMM d')} – ${format(now, 'MMM d, yyyy')}`, 20, 35);
      
      // Basic symptom summary
      let y = 50;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Symptom Summary', 20, y);
      y += 10;
      
      doc.setFont('helvetica', 'normal');
      doc.text(`Total entries: ${symptoms.length}`, 20, y);
      y += 5;
      
      if (symptoms.length > 0) {
        const avgSeverity = (symptoms.reduce((sum, s) => sum + s.severity, 0) / symptoms.length).toFixed(1);
        doc.text(`Average severity: ${avgSeverity}/10`, 20, y);
        y += 10;
        
        // List recent symptoms
        const recentSymptoms = symptoms.slice(-10);
        doc.text('Recent entries:', 20, y);
        y += 5;
        
        recentSymptoms.forEach(symptom => {
          const date = format(new Date(symptom.timestamp), 'MMM d');
          doc.text(`${date}: ${symptom.name} (${symptom.severity}/10)`, 25, y);
          y += 4;
        });
      }
      
      // Save the PDF with timestamp
      doc.save(`visit-report-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`);
      
      toast.success('Visit report downloaded');
    } catch {
      toast.error('Failed to generate report');
    }
  };

  const generatePdfReport = async () => {
    try {
      toast.info('PDF report generation', { description: 'Generating comprehensive PDF report...' });
      
      // For now, call the visit report as the full report
      await generateVisitReport();
      
      toast.success('Full report generated!');
    } catch (error) {
      console.error('PDF report generation failed:', error);
      toast.error('Failed to generate full report');
    }
  };

  const handleDeleteAll = async () => {
    try {
      toast.info('Deleting all data...', { description: 'This may take a moment' });
      
      // Delete all data using the db client
      await db.deleteAllData();
      
      toast.success('All data deleted', { description: 'Your health data has been cleared' });
      
      // Optionally refresh the page or update UI
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete all data:', error);
      toast.error('Failed to delete data', { description: 'Please try again' });
    }
  };
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-safe">
      <div className="max-w-screen-sm mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-blue-900 dark:text-white">Health Tracker</h1>
          <ThemeToggle />
        </div>
        
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "log" | "history" | "charts" | "medications")}>
          <TabsList className="grid w-full grid-cols-5 bg-slate-50 border-b border-slate-200">
            <TabsTrigger value="log" className="h-12 text-sm font-medium text-slate-600 data-[state=active]:text-cyan-600 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-cyan-600 transition-all">
              Log
            </TabsTrigger>
            <TabsTrigger value="history" className="h-12 text-sm font-medium text-slate-600 data-[state=active]:text-cyan-600 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-cyan-600 transition-all">
              History
            </TabsTrigger>
            <TabsTrigger value="charts" className="h-12 text-sm font-medium text-slate-600 data-[state=active]:text-cyan-600 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-cyan-600 transition-all">
              Analytics
            </TabsTrigger>
            <TabsTrigger value="discover" className="h-12 text-sm font-medium text-slate-600 data-[state=active]:text-cyan-600 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-cyan-600 transition-all">
              Insights
            </TabsTrigger>
            <TabsTrigger value="medications" className="h-12 text-sm font-medium text-slate-600 data-[state=active]:text-cyan-600 data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-cyan-600 transition-all">
              Medications
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="log">
            <QuickLogFlow />
          </TabsContent>
          
          <TabsContent value="history">
            <History onStartEdit={handleStartEdit} />
          </TabsContent>
          
          <TabsContent value="charts">
            <Charts />
          </TabsContent>
          
          <TabsContent value="discover">
            <DiscoveryMode />
          </TabsContent>
          
          <TabsContent value="medications">
            <MedicationManager />
          </TabsContent>
        </Tabs>
        
        <InstallPrompt />
        
        {/* Floating Export Button - always visible */}
        <button
          onClick={() => setShowExportSheet(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-blue-900 hover:bg-blue-800 text-white rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center justify-center"
          aria-label="Export & Reports"
        >
          <Download className="h-6 w-6" />
        </button>
        
        {/* ShareExportSheet Modal */}
        <ShareExportSheet
          open={showExportSheet}
          onClose={() => setShowExportSheet(false)}
          onVisitReport={generateVisitReport}
          onPdfReport={generatePdfReport}
          onJsonExport={exportJSON}
          onCsvExport={exportCSV}
          onDeleteAll={handleDeleteAll}
        />
        
        {/* Privacy notice */}
        <p className="text-center text-sm text-gray-500 mt-4">
          Your data stays on this device
        </p>
      </div>
    </div>
  );
}
