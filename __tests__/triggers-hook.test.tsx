/** @jest-environment jsdom */
// The worker hook. What it sends, which replies it keeps, and what happens when the worker fails.
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTriggerAnalysis } from '@/lib/hooks/useTriggerAnalysis';
import { findTriggers, type TriggerAnalysis } from '@/lib/analysis/triggers';
import type { Factor, Symptom } from '@/lib/db/schema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  posted: { id: number; symptoms: Symptom[]; factors: Factor[]; exposureOnly?: Factor[] }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: FakeWorker['posted'][number]) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  reply(id: number, result: TriggerAnalysis) {
    this.onmessage?.({ data: { id, result } } as MessageEvent);
  }
}

let seq = 0;
const today = new Date();
const at = (daysAgo: number, hour: number) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour).getTime();

/** Dairy every third day and a headache 15 hours later, with daily coffee, relative to today. */
function planted() {
  const symptoms: Symptom[] = [];
  const factors: Factor[] = [];
  for (let d = 40; d >= 2; d--) {
    factors.push({ id: `f${seq++}`, name: 'Coffee', category: 'drink', timestamp: new Date(at(d, 8)).toISOString() });
    if (d % 3 === 0) {
      factors.push({ id: `f${seq++}`, name: 'Dairy', category: 'food', timestamp: new Date(at(d, 12)).toISOString() });
      symptoms.push({ id: `s${seq++}`, name: 'Headache', severity: 6, timestamp: new Date(at(d, 27)).toISOString() });
    }
    if (d % 7 === 0) {
      symptoms.push({ id: `s${seq++}`, name: 'Headache', severity: 4, timestamp: new Date(at(d, 10)).toISOString() });
    }
  }
  return { symptoms, factors };
}

let root: Root;
let container: HTMLDivElement;
let latest: TriggerAnalysis | null = null;

function Probe(props: { symptoms: Symptom[]; factors: Factor[]; doses?: Factor[]; enabled?: boolean }) {
  latest = useTriggerAnalysis(props.symptoms, props.factors, props.doses, props.enabled);
  return null;
}

const render = (props: React.ComponentProps<typeof Probe>) =>
  act(async () => {
    root.render(<Probe {...props} />);
  });

beforeEach(() => {
  FakeWorker.all = [];
  latest = null;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  delete (globalThis as { Worker?: unknown }).Worker;
});

const EMPTY: Symptom[] = [];
const NO_FACTORS: Factor[] = [];

describe('useTriggerAnalysis', () => {
  it('falls back to the current data, not the data it started with, when the worker fails', async () => {
    const data = planted();
    await render({ symptoms: EMPTY, factors: NO_FACTORS });
    await render({ symptoms: data.symptoms, factors: data.factors });
    const worker = FakeWorker.all[0];
    expect(FakeWorker.all).toHaveLength(1);
    expect(worker.posted.map(p => p.symptoms.length)).toEqual([0, data.symptoms.length]);

    // The worker script fails to load after the real data was sent to it.
    await act(async () => worker.onerror?.(new Event('error')));

    expect(worker.terminated).toBe(true);
    const expected = findTriggers(data.symptoms, data.factors);
    expect(expected.findings.length).toBeGreaterThan(0);
    expect(latest?.findings.map(f => [f.factor, f.symptom, f.window.label])).toEqual(
      expected.findings.map(f => [f.factor, f.symptom, f.window.label]),
    );
  });

  it('runs on the main thread after a failure, with the newest data', async () => {
    const data = planted();
    await render({ symptoms: EMPTY, factors: NO_FACTORS });
    await act(async () => FakeWorker.all[0].onerror?.(new Event('error')));
    await render({ symptoms: data.symptoms, factors: data.factors });
    await act(async () => new Promise(r => setTimeout(r, 0)));
    expect(FakeWorker.all).toHaveLength(1);
    expect(latest?.findings[0]?.factor).toBe('Dairy');
  });

  it('waits until it is enabled, then sends doses separately from other factors', async () => {
    const data = planted();
    const doses: Factor[] = [
      { id: 'd1', name: 'Sertraline', category: 'medication', timestamp: new Date(at(3, 8)).toISOString() },
    ];
    await render({ symptoms: EMPTY, factors: NO_FACTORS, doses, enabled: false });
    expect(FakeWorker.all).toHaveLength(0);
    expect(latest).toBeNull();

    await render({ symptoms: data.symptoms, factors: data.factors, doses, enabled: true });
    const worker = FakeWorker.all[0];
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0].factors).toBe(data.factors);
    expect(worker.posted[0].exposureOnly).toBe(doses);
  });

  it('ignores a late reply to an older request', async () => {
    const data = planted();
    await render({ symptoms: EMPTY, factors: NO_FACTORS });
    await render({ symptoms: data.symptoms, factors: data.factors });
    const worker = FakeWorker.all[0];
    const [first, second] = worker.posted;
    const stale = findTriggers(first.symptoms, first.factors);
    const fresh = findTriggers(second.symptoms, second.factors);

    await act(async () => worker.reply(first.id, stale));
    expect(latest).toBeNull();
    await act(async () => worker.reply(second.id, fresh));
    expect(latest).toBe(fresh);
  });
});

it('finds the planted trigger in the test data', () => {
  const { symptoms, factors } = planted();
  const dairy = factors.filter(f => f.name === 'Dairy').map(f => Date.parse(f.timestamp));
  const followed = symptoms.filter(s => dairy.includes(Date.parse(s.timestamp) - 15 * HOUR));
  expect(followed).toHaveLength(dairy.length);
  const top = findTriggers(symptoms, factors).findings[0];
  expect(top.factor).toBe('Dairy');
  expect(top.window.from).toBe(12);
});
