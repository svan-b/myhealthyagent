// app/components/mobile/SeverityPicker.tsx
'use client';

type Severity = 'low' | 'medium' | 'high' | 'severe';

interface Props {
  value: Severity;
  onChange: (value: Severity) => void;
}

const SEVERITY_OPTIONS = [
  { value: 'low' as Severity, label: 'Low', range: '1-3', emoji: '😐' },
  { value: 'medium' as Severity, label: 'Medium', range: '4-6', emoji: '😕' },
  { value: 'high' as Severity, label: 'High', range: '7-8', emoji: '😣' },
  { value: 'severe' as Severity, label: 'Severe', range: '9-10', emoji: '😫' },
];

export function SeverityPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-8">
      {SEVERITY_OPTIONS.map(option => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`
            min-h-[80px] rounded-xl border-2 transition-all p-4
            ${value === option.value 
              ? 'text-white shadow-lg scale-105' 
              : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'}
          `}
          style={{
            backgroundColor: value === option.value ? 
              (option.value === 'low' ? '#10b981' : 
               option.value === 'medium' ? '#eab308' :
               option.value === 'high' ? '#f97316' : '#ef4444') : undefined,
            borderColor: value === option.value ?
              (option.value === 'low' ? '#10b981' : 
               option.value === 'medium' ? '#eab308' :
               option.value === 'high' ? '#f97316' : '#ef4444') : undefined
          }}
        >
          <div className="text-2xl mb-1">{option.emoji}</div>
          <div className="font-semibold">{option.label}</div>
          <div className="text-xs opacity-75">{option.range}</div>
        </button>
      ))}
    </div>
  );
}
