import * as React from "react";

type TogglePillProps = {
  label: string;
  selected: boolean;
  onToggle: (label: string) => void;
  color?: "blue" | "violet" | "amber" | "green";
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
};

const colorClasses = (on: boolean, color: NonNullable<TogglePillProps["color"]>) => {
  if (on) {
    switch(color) {
      case "violet": return "bg-purple-500 border-purple-500 text-white";
      case "blue": return "bg-blue-500 border-blue-500 text-white";
      case "amber": return "bg-yellow-500 border-yellow-500 text-white";
      case "green": return "bg-green-500 border-green-500 text-white";
    }
  }
  return "bg-white border-gray-300 text-gray-900 hover:border-gray-400";
};

const sizeClasses = (size: NonNullable<TogglePillProps["size"]>) => {
  switch(size) {
    case "sm": return "px-2 py-1.5 text-sm";
    case "lg": return "px-4 py-3 text-lg";
    default: return "px-3 py-2.5 text-base";
  }
};

const TogglePill = React.memo<TogglePillProps>(function TogglePill({
  label, selected, onToggle, color = "blue", disabled = false, size = "md"
}) {
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (disabled) return;
      onToggle(label);
      // Subtle haptic for clinical feel
      if ('vibrate' in navigator) {
        navigator.vibrate(5);
      }
    },
    [disabled, label, onToggle]
  );

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={`
        w-full rounded-lg border-2 font-medium
        transition-all duration-150 active:scale-[0.98]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${colorClasses(selected, color)}
        ${sizeClasses(size)}
      `}
      onPointerDown={handlePointerDown}
      style={{ touchAction: 'manipulation' }}
    >
      {label}
    </button>
  );
});

export default TogglePill;