import * as React from "react";

type TogglePillProps = {
  label: string;
  selected: boolean;
  onToggle: (label: string) => void;
  color?: "blue" | "violet" | "amber";
  disabled?: boolean;
};

const colorClasses = (on: boolean, color: NonNullable<TogglePillProps["color"]>) => {
  const active: Record<string,string> = {
    violet: "bg-purple-500 border-purple-500 text-white",
    blue: "bg-blue-500 border-blue-500 text-white",
    amber: "bg-yellow-500 border-yellow-500 text-white",
  };
  const idle: Record<string,string> = {
    violet: "bg-white border-gray-300 text-gray-700 hover:border-purple-400",
    blue: "bg-white border-gray-300 text-gray-700 hover:border-blue-400",
    amber: "bg-white border-gray-300 text-gray-700 hover:border-yellow-400",
  };
  return on ? active[color] : idle[color];
};

const TogglePill = React.memo<TogglePillProps>(function TogglePill({
  label,
  selected,
  onToggle,
  color = "blue",
  disabled = false,
}) {
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (disabled) return;
      onToggle(label);
    },
    [disabled, label, onToggle]
  );

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`
        w-full rounded-xl border-2 px-3 py-3 text-base font-medium
        transition-all duration-150 active:scale-95
        ${colorClasses(selected, color)}
      `}
      onPointerDown={handlePointerDown}
      style={{ touchAction: 'manipulation' }}
    >
      {label}
    </button>
  );
});

export default TogglePill;