/**
 * @jest-environment jsdom
 */
// The hint under the "Earlier" date field reaches screen reader users.
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WHEN_NOW, WhenPicker, type When } from '@/app/components/log/WhenPicker';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Picker() {
  const [when, setWhen] = React.useState<When>(WHEN_NOW);
  return <WhenPicker value={when} onChange={setWhen} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Picker />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const input = () => container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
const typeDate = (value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
const hint = () => document.getElementById(input().getAttribute('aria-describedby') ?? '');

it('is a polite live region tied to the field, there before the hint appears, so it is announced', async () => {
  const earlier = [...container.querySelectorAll('button')].find(b => b.textContent === 'Earlier')!;
  await act(async () => earlier.click());

  // Screen readers only announce changes to a live region that was already in the page.
  const region = hint();
  expect(region).not.toBeNull();
  expect(region!.getAttribute('aria-live')).toBe('polite');
  expect(region!.getAttribute('role')).toBe('status');
  expect(region!.textContent).toBe('');

  await typeDate('');
  expect(hint()).toBe(region);
  expect(region!.textContent).toBe('Enter a full date and time.');
  expect(input().getAttribute('aria-invalid')).toBe('true');

  await typeDate('2026-11-11T19:00');
  expect(hint()).toBe(region);
  expect(region!.textContent).toBe('');
  expect(input().hasAttribute('aria-invalid')).toBe(false);
});
