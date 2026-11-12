'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Bottom sheet on phones, centered panel on larger screens. Built on Radix Dialog for focus and escape handling. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 inset-x-0 bottom-0 max-h-[92dvh] flex flex-col rounded-t-3xl bg-surface shadow-2xl animate-sheet-in',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-3xl sm:max-h-[85dvh]',
            className,
          )}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-lg font-bold text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-muted mt-0.5">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mr-2 -mt-1 size-10 grid place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Close"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 pb-5 flex-1">{children}</div>
          {footer && <div className="px-5 pt-3 pb-4 border-t border-line safe-bottom">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
