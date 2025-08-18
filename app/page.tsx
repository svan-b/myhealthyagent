// app/page.tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogTab } from './components/LogTab';
import { QuickLogFlow } from './components/mobile/QuickLogFlow';
import { History } from './components/History';
import { MedicationManager } from './components/MedicationManager';
import { ReportGenerator } from './components/ReportGenerator';
import { ThemeToggle } from './components/ThemeToggle';
import { InstallPrompt } from './components/InstallPrompt';
import { VisitReport } from './components/VisitReport';
import { ExportButtons } from './components/ExportButtons';
import { DeleteDataButton } from './components/DeleteDataButton';
import { toast } from 'sonner';

const Charts = dynamic(() => import('./components/Charts').then(m => m.Charts), {
  ssr: false,
});

// Feature flag for Day 9 redesign - set to true tomorrow
const USE_NEW_MOBILE_UI = true;

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'log' | 'history' | 'charts' | 'medications'>('log');
  
  const handleStartEdit = () => {
    setActiveTab('log');
    toast('Editing entry', { description: 'Loaded into Quick Log' });
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-md mx-auto p-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">myHealthyAgent</h1>
          <ThemeToggle />
        </div>
        
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "log" | "history" | "charts" | "medications")}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="log">Log</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="medications">Meds</TabsTrigger>
          </TabsList>
          
          <TabsContent value="log">
            {USE_NEW_MOBILE_UI ? (
              <QuickLogFlow /> 
            ) : (
              <LogTab />
            )}
          </TabsContent>
          
          <TabsContent value="history">
            <History onStartEdit={handleStartEdit} />
          </TabsContent>
          
          <TabsContent value="charts">
            <Charts />
          </TabsContent>
          
          <TabsContent value="medications">
            <MedicationManager />
          </TabsContent>
        </Tabs>
        
        <InstallPrompt />
        
        {/* Report and Export Actions */}
        <div className="mt-6 space-y-3">
          <div className="flex gap-2">
            <VisitReport />
            <ReportGenerator />
          </div>
          <ExportButtons />
          <DeleteDataButton />
        </div>
        
        {/* Privacy notice */}
        <p className="text-center text-sm text-gray-500 mt-4">
          Your data stays on this device
        </p>
      </div>
    </div>
  );
}
