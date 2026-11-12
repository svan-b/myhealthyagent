'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="max-w-lg mx-auto px-4 py-16 text-center">
      <h1 className="text-xl font-bold text-fg">Something went wrong</h1>
      <p className="text-muted mt-2">
        Your saved data is safe on this device. Try again, and if this keeps happening, reload the page.
      </p>
      <div className="mt-6 flex gap-2 justify-center">
        <button onClick={reset} className="h-11 px-4 rounded-xl bg-accent text-on-accent font-semibold">
          Try again
        </button>
        <button
          onClick={() => location.reload()}
          className="h-11 px-4 rounded-xl border border-line-strong text-fg font-semibold"
        >
          Reload
        </button>
      </div>
    </main>
  );
}
