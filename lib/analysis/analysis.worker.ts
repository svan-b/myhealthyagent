// Runs trigger analysis off the main thread so the interface never stalls on large histories.
import { findTriggers } from './triggers';
import type { Factor, Symptom } from '@/lib/db/schema';

interface Request {
  id: number;
  symptoms: Symptom[];
  factors: Factor[];
  /** Doses ticked off on the Meds tab. They are tested, but never make a day count as tracked. */
  exposureOnly?: Factor[];
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, symptoms, factors, exposureOnly } = event.data;
  try {
    (self as unknown as Worker).postMessage({ id, result: findTriggers(symptoms, factors, { exposureOnly }) });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
