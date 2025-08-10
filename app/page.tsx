'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogTab } from './components/LogTab';
import { History } from './components/History';
import { ReportGenerator } from './components/ReportGenerator';
import { ThemeToggle } from './components/ThemeToggle';
import { toast } from 'sonner';

const Charts = dynamic(() => import('./components/Charts').then(m => m.Charts), {
  ssr: false,
});

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'log' | 'history' | 'charts'>('log');

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

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="log">Log</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
          </TabsList>

          <TabsContent value="log">
            <LogTab />
          </TabsContent>

          <TabsContent value="history">
            <History onStartEdit={handleStartEdit} />
          </TabsContent>

          <TabsContent value="charts">
            <Charts />
          </TabsContent>
        </Tabs>

        <div className="mt-6">
          <ReportGenerator />
        </div>
      </div>
    </div>
  );
}
