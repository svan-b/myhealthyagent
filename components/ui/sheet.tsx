'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Putting focus back when a sheet closes. Radix only does this for a Dialog.Trigger, and these sheets are opened by
 * ordinary buttons, so without the code below focus fell to <body> and keyboard and screen reader users lost their
 * place on the page.
 */

const PRESSABLE = 'button, a[href], input, select, textarea, summary, [role="button"], [tabindex]';

// Safari does not focus a button when it is clicked or tapped, so remember the control that was pressed last.
let lastPress: { el: HTMLElement | null; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    e => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(PRESSABLE) : null;
      lastPress = { el, at: performance.now() };
    },
    true,
  );
}

/** Finds what opened the sheet, which is the control just pressed, or else the one that had focus. */
function findOpener(content: Element): HTMLElement | null {
  const pressed = lastPress && performance.now() - lastPress.at < 1000 ? lastPress.el : null;
  const active = document.activeElement;
  const el = pressed ?? (active instanceof HTMLElement && active !== document.body ? active : null);
  return el && !content.contains(el) ? el : null;
}

function tryFocus(el: HTMLElement | null): boolean {
  if (!el?.isConnected) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

/**
 * Focuses the opener. If it is gone, for instance because its entry was deleted, focuses the same control drawn
 * again (same id), or else the heading of the screen.
 */
function focusOpenerOrHeading(opener: HTMLElement | null) {
  if (tryFocus(opener)) return;
  if (opener?.id && tryFocus(document.getElementById(opener.id))) return;
  const heading = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main');
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  tryFocus(heading);
}

let stopWatching: (() => void) | null = null;

/**
 * The screen behind a sheet often redraws a moment after it closes. A deleted entry, for instance, only leaves the
 * list once the data has reloaded. If that takes focus away, put it back. Stops when the person presses a key or
 * taps, or after a few seconds.
 */
function keepFocusAfterClose(opener: HTMLElement | null) {
  stopWatching?.();
  const observer = new MutationObserver(() => {
    const active = document.activeElement;
    if (!active || active === document.body) focusOpenerOrHeading(opener);
  });
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    document.removeEventListener('pointerdown', stop, true);
    document.removeEventListener('keydown', stop, true);
    if (stopWatching === stop) stopWatching = null;
  };
  const timer = window.setTimeout(stop, 5000);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', stop, true);
  document.addEventListener('keydown', stop, true);
  stopWatching = stop;
}

function returnFocus(opener: HTMLElement | null) {
  const active = document.activeElement;
  // Focus is somewhere on purpose already. This also skips the extra close event React's strict mode sends in
  // development while the sheet is still open.
  if (active && active !== document.body) return;
  focusOpenerOrHeading(opener);
  keepFocusAfterClose(opener);
}

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
  const opener = React.useRef<HTMLElement | null>(null);
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
          // With a description, Radix links it to the sheet so it is read after the title. Without one, the sheet
          // must say it has none, so nothing is linked and Radix does not warn about a missing description.
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={e => {
            stopWatching?.();
            opener.current = e.currentTarget instanceof Element ? findOpener(e.currentTarget) : null;
          }}
          onCloseAutoFocus={e => {
            // Stops Radix from looking for a Dialog.Trigger, which this sheet does not have.
            e.preventDefault();
            returnFocus(opener.current);
          }}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div>
              <Dialog.Title className="text-lg font-bold text-fg">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-sm text-muted mt-0.5">{description}</Dialog.Description>
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
