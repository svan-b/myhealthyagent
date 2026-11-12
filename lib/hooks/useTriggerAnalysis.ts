'use client';

import * as React from 'react';
import { findTriggers, type TriggerAnalysis } from '@/lib/analysis/triggers';
import type { Factor, Symptom } from '@/lib/db/schema';

/**
 * Trigger analysis in a Web Worker, falling back to the main thread when workers are unavailable.
 * Returns null until the first result arrives.
 */
export function useTriggerAnalysis(symptoms: Symptom[], factors: Factor[]): TriggerAnalysis | null {
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
    const id = ++seq.current;
    const runInline = () => {
      // Yield first so the screen paints before the work starts.
      const handle = setTimeout(() => {
        if (id === seq.current) setResult(findTriggers(symptoms, factors));
      }, 0);
      return () => clearTimeout(handle);
    };

    if (failedRef.current || typeof Worker === 'undefined') return runInline();

    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../analysis/analysis.worker.ts', import.meta.url));
        workerRef.current.onerror = () => {
          failedRef.current = true;
          workerRef.current?.terminate();
          workerRef.current = null;
          setResult(findTriggers(symptoms, factors));
        };
      }
      const worker = workerRef.current;
      worker.onmessage = (e: MessageEvent<{ id: number; result?: TriggerAnalysis; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        if (e.data.result) setResult(e.data.result);
        else setResult(findTriggers(symptoms, factors));
      };
      worker.postMessage({ id, symptoms, factors });
    } catch {
      failedRef.current = true;
      return runInline();
    }
  }, [symptoms, factors]);

  return result;
}
