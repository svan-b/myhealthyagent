// Day 9: iOS-safe bottom action bar

'use client';

import { ReactNode } from 'react';

interface BottomActionsProps {
  children: ReactNode;
}

export function BottomActions({ children }: BottomActionsProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] bg-white/95 backdrop-blur border-t">
      <div className="flex gap-3">{children}</div>
    </div>
  );
}