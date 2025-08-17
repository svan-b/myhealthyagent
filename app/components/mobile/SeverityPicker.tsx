// Day 9: Segmented severity selector (Low/Med/High/Severe)
// Replaces broken slider

'use client';

type Severity = 'low' | 'medium' | 'high' | 'severe';

interface SeverityPickerProps {
  value: Severity;
  onChange: (value: Severity) => void;
}

export function SeverityPicker({ value, onChange }: SeverityPickerProps) {
  // TODO: Implement segmented buttons
  return (
    <div className="p-4 border rounded">
      <p>Severity Picker - TODO</p>
    </div>
  );
}