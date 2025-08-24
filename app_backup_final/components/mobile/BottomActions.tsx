// app/components/mobile/BottomActions.tsx
'use client';

import { Button } from '@/components/ui/button';

interface Props {
  primaryLabel: string;
  primaryIcon?: React.ReactNode;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function BottomActions({
  primaryLabel,
  primaryIcon,
  onPrimary,
  primaryDisabled = false,
  secondaryLabel,
  onSecondary
}: Props) {
  return (
    <>
      {/* Spacer to prevent content overlap */}
      <div className="h-20" aria-hidden="true" />
      
      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 flex gap-3 z-50"
           style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {secondaryLabel && onSecondary && (
          <Button
            variant="outline"
            size="lg"
            onClick={onSecondary}
            className="flex-1"
          >
            {secondaryLabel}
          </Button>
        )}
        <Button
          size="lg"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="flex-1 gap-2"
        >
          {primaryLabel}
          {primaryIcon}
        </Button>
      </div>
    </>
  );
}
