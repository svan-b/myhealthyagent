'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <p>Your saved data is safe on this device.</p>
        <button onClick={reset} style={{ padding: '10px 16px', borderRadius: 12 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
