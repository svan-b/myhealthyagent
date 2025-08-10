'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { Zap, Brain, Bug, Moon, Coffee, Heart } from 'lucide-react';

type Template = {
  name: string;
  icon: React.ReactNode;
  symptoms: string[];
  defaultSeverity: number;
  description: string;
};

type TemplatesProps = {
  onApplyTemplate: (symptoms: string[], severity: number) => void;
};

export function Templates({ onApplyTemplate }: TemplatesProps) {
  const templates: Template[] = [
    {
      name: 'Migraine',
      icon: <Brain className="h-4 w-4" />,
      symptoms: ['Headache', 'Light sensitivity', 'Nausea', 'Dizziness'],
      defaultSeverity: 7,
      description: 'Severe headache with sensitivity'
    },
    {
      name: 'Flu/Cold',
      icon: <Bug className="h-4 w-4" />,
      symptoms: ['Fever', 'Body aches', 'Fatigue', 'Cough', 'Congestion'],
      defaultSeverity: 6,
      description: 'Common cold or flu symptoms'
    },
    {
      name: 'Insomnia',
      icon: <Moon className="h-4 w-4" />,
      symptoms: ['Insomnia', 'Fatigue', 'Irritability', 'Difficulty concentrating'],
      defaultSeverity: 5,
      description: 'Sleep-related issues'
    },
    {
      name: 'Stress/Anxiety',
      icon: <Zap className="h-4 w-4" />,
      symptoms: ['Anxiety', 'Rapid heartbeat', 'Sweating', 'Restlessness'],
      defaultSeverity: 6,
      description: 'Stress and anxiety symptoms'
    },
    {
      name: 'Fatigue',
      icon: <Coffee className="h-4 w-4" />,
      symptoms: ['Fatigue', 'Weakness', 'Drowsiness', 'Low energy'],
      defaultSeverity: 5,
      description: 'General tiredness and exhaustion'
    },
    {
      name: 'Digestive',
      icon: <Heart className="h-4 w-4" />,
      symptoms: ['Nausea', 'Stomach pain', 'Bloating', 'Loss of appetite'],
      defaultSeverity: 5,
      description: 'Digestive system issues'
    }
  ];

  const applyTemplate = (template: Template) => {
    onApplyTemplate(template.symptoms, template.defaultSeverity);
    toast.success(`Applied ${template.name} template`);
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm text-gray-600">Quick Templates</h3>
      <div className="grid grid-cols-2 gap-2">
        {templates.map((template) => (
          <Card
            key={template.name}
            className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => applyTemplate(template)}
          >
            <div className="flex items-start space-x-2">
              <div className="p-2 bg-blue-100 rounded-lg">
                {template.icon}
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{template.name}</p>
                <p className="text-xs text-gray-500">{template.description}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {template.symptoms.length} symptoms
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
