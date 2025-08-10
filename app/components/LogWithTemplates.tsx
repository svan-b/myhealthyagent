'use client';

import { useState, useRef } from 'react';
import QuickLogOriginal from './QuickLog-Simple';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Brain, Bug, Moon, Zap, Coffee, Heart } from 'lucide-react';

type Template = {
  name: string;
  icon: React.ReactNode;
  symptoms: string[];
  severity: number;
};

export function LogWithTemplates() {
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateData, setTemplateData] = useState<{symptoms: string[], severity: number} | null>(null);

  const templates: Template[] = [
    { name: 'Migraine', icon: <Brain className="h-4 w-4" />, symptoms: ['Headache', 'Light sensitivity', 'Nausea'], severity: 7 },
    { name: 'Flu/Cold', icon: <Bug className="h-4 w-4" />, symptoms: ['Fever', 'Body aches', 'Fatigue', 'Cough'], severity: 6 },
    { name: 'Insomnia', icon: <Moon className="h-4 w-4" />, symptoms: ['Insomnia', 'Fatigue', 'Irritability'], severity: 5 },
    { name: 'Stress', icon: <Zap className="h-4 w-4" />, symptoms: ['Anxiety', 'Rapid heartbeat', 'Restlessness'], severity: 6 },
    { name: 'Fatigue', icon: <Coffee className="h-4 w-4" />, symptoms: ['Fatigue', 'Weakness', 'Low energy'], severity: 5 },
    { name: 'Digestive', icon: <Heart className="h-4 w-4" />, symptoms: ['Nausea', 'Stomach pain', 'Bloating'], severity: 5 }
  ];

  return (
    <div className="space-y-4">
      <QuickLogOriginal templateData={templateData} onTemplateUsed={() => setTemplateData(null)} />
      
      <Button onClick={() => setShowTemplates(!showTemplates)} variant="outline" className="w-full">
        Use Template
      </Button>

      {showTemplates && (
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-3">Quick Templates</h3>
          <div className="grid grid-cols-2 gap-2">
            {templates.map((template) => (
              <Card
                key={template.name}
                className="p-3 cursor-pointer hover:bg-gray-50"
                onClick={() => {
                  setTemplateData({ symptoms: template.symptoms, severity: template.severity });
                  setShowTemplates(false);
                }}
              >
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 bg-blue-100 rounded">{template.icon}</div>
                  <div>
                    <p className="font-medium text-sm">{template.name}</p>
                    <p className="text-xs text-gray-500">{template.symptoms.length} symptoms</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
