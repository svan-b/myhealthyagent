// app/components/mobile/SeverityPicker.tsx
'use client';

type Severity = 'low' | 'medium' | 'high' | 'severe';

interface Props {
  value: Severity;
  onChange: (value: Severity) => void;
}

const SEVERITY_OPTIONS = [
  { 
    value: 'low' as Severity, 
    label: 'Mild', 
    range: '1-3',
    description: 'Minor discomfort',
    color: '#3b82f6', // blue-500
    darkColor: '#2563eb' // blue-600
  },
  { 
    value: 'medium' as Severity, 
    label: 'Moderate', 
    range: '4-6',
    description: 'Noticeable impact',
    color: '#0891b2', // cyan-600
    darkColor: '#0e7490' // cyan-700
  },
  { 
    value: 'high' as Severity, 
    label: 'Significant', 
    range: '7-8',
    description: 'Major impact',
    color: '#7c3aed', // violet-600
    darkColor: '#6d28d9' // violet-700
  },
  { 
    value: 'severe' as Severity, 
    label: 'Severe', 
    range: '9-10',
    description: 'Extreme impact',
    color: '#dc2626', // red-600
    darkColor: '#b91c1c' // red-700
  },
];

export function SeverityPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-8 max-w-lg mx-auto">
      {SEVERITY_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            onChange(option.value);
            if ('vibrate' in navigator) navigator.vibrate(5);
          }}
          className={`
            min-h-[90px] rounded-lg border-2 transition-all p-4
            ${value === option.value 
              ? 'text-white shadow-md transform scale-[1.02]' 
              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-900 dark:text-white'}
          `}
          style={{
            backgroundColor: value === option.value ? option.color : undefined,
            borderColor: value === option.value ? option.darkColor : undefined,
          }}
        >
          <div className="font-semibold text-base">{option.label}</div>
          <div className={`text-xs mt-1 ${value === option.value ? 'opacity-90' : 'text-gray-500 dark:text-gray-400'}`}>
            Score: {option.range}
          </div>
          <div className={`text-xs mt-1 ${value === option.value ? 'opacity-80' : 'text-gray-600 dark:text-gray-400'}`}>
            {option.description}
          </div>
        </button>
      ))}
    </div>
  );
}