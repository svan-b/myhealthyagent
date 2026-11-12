'use client';

import * as React from 'react';
import { findTriggers, type TriggerAnalysis } from '@/lib/analysis/triggers';
import type { Factor, Symptom } from '@/lib/db/schema';

const NONE: Factor[] = [];

/**
 * Trigger analysis in a Web Worker, falling back to the main thread when workers are unavailable.
 * `exposureOnly` takes doses ticked off on the Meds tab. They are tested, but never make a day count as
 * tracked. Nothing runs while `enabled` is false, so pass false while the data is still loading.
 * Returns null until the first result arrives.
 */
export function useTriggerAnalysis(
  symptoms: Symptom[],
  factors: Factor[],
  exposureOnly: Factor[] = NONE,
  enabled = true,
): TriggerAnalysis | null {
  const [result, setResult] = React.useState<TriggerAnalysis | null>(null);
  const workerRef = React.useRef<Worker | null>(null);
  const failedRef = React.useRef(false);
  const seq = React.useRef(0);

  React.useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const analyze = () => findTriggers(symptoms, factors, { exposureOnly });
    const runInline = () => {
      // Yield first so the screen paints before the work starts.
      const handle = setTimeout(() => {
        if (id === seq.current) setResult(analyze());
      }, 0);
      return () => clearTimeout(handle);
    };

    if (failedRef.current || typeof Worker === 'undefined') return runInline();

    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../analysis/analysis.worker.ts', import.meta.url));
      }
      const worker = workerRef.current;
      // Both handlers are replaced on every run, so a late error or reply is handled with this run's data.
      worker.onerror = () => {
        failedRef.current = true;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        if (id === seq.current) setResult(analyze());
      };
      worker.onmessage = (e: MessageEvent<{ id: number; result?: TriggerAnalysis; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        setResult(e.data.result ?? analyze());
      };
      worker.postMessage({ id, symptoms, factors, exposureOnly });
    } catch {
      failedRef.current = true;
      return runInline();
    }
  }, [symptoms, factors, exposureOnly, enabled]);

  return result;
}
