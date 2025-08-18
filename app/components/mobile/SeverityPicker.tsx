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
    label: 'Low', 
    range: '1-3',
    description: 'Mild discomfort'
  },
  { 
    value: 'medium' as Severity, 
    label: 'Medium', 
    range: '4-6',
    description: 'Moderate impact'
  },
  { 
    value: 'high' as Severity, 
    label: 'High', 
    range: '7-8',
    description: 'Significant impact'
  },
  { 
    value: 'severe' as Severity, 
    label: 'Severe', 
    range: '9-10',
    description: 'Severe/unbearable'
  },
];

export function SeverityPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-8">
      {SEVERITY_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            onChange(option.value);
            if ('vibrate' in navigator) navigator.vibrate(5);
          }}
          className={`
            min-h-[80px] rounded-xl border-2 transition-all p-4
            ${value === option.value 
              ? 'border-transparent shadow-lg scale-105' 
              : 'bg-white border-gray-300 hover:border-gray-400'}
          `}
          style={{
            backgroundColor: value === option.value ? 
              (option.value === 'low' ? '#10b981' : 
               option.value === 'medium' ? '#eab308' :
               option.value === 'high' ? '#f97316' : '#ef4444') : undefined,
            borderColor: value === option.value ?
              (option.value === 'low' ? '#10b981' : 
               option.value === 'medium' ? '#eab308' :
               option.value === 'high' ? '#f97316' : '#ef4444') : undefined,
            color: value === option.value ? 'white' : undefined
          }}
        >
          <div className="font-bold text-lg">{option.label}</div>
          <div className="text-sm opacity-90">{option.range}</div>
          <div className="text-sm mt-1 opacity-75">{option.description}</div>
        </button>
      ))}
    </div>
  );
}
