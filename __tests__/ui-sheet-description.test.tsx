/**
 * @jest-environment jsdom
 */
// What a screen reader is told about a sheet. Its title is its name, and its description is read if it has one.
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sheet } from '@/components/ui/sheet';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  error = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  warn.mockRestore();
  error.mockRestore();
});

async function open(props: { title: string; description?: string }) {
  await act(async () =>
    root.render(
      <Sheet open onOpenChange={() => {}} {...props}>
        <button type="button">Download backup</button>
      </Sheet>,
    ),
  );
  // Radix checks for a title and a description in an effect after the sheet opens.
  await act(async () => new Promise(r => setTimeout(r, 10)));
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

/** The text an attribute like aria-describedby points at, as a screen reader would read it. */
const textOf = (ids: string | null) =>
  (ids ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ');

it('reads the description of a sheet that has one', async () => {
  const dialog = await open({ title: 'Reports and data', description: 'Everything here runs on your device.' });
  expect(textOf(dialog.getAttribute('aria-labelledby'))).toBe('Reports and data');
  expect(textOf(dialog.getAttribute('aria-describedby'))).toBe('Everything here runs on your device.');
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it('reads nothing extra for a sheet without one, and Radix does not warn', async () => {
  const dialog = await open({ title: 'Edit symptom' });
  expect(textOf(dialog.getAttribute('aria-labelledby'))).toBe('Edit symptom');
  expect(dialog.hasAttribute('aria-describedby')).toBe(false);
  // The title is in the sheet once. A hidden copy of it would be read a second time.
  const copies = [...dialog.querySelectorAll('*')].filter(
    el => el.children.length === 0 && el.textContent === 'Edit symptom',
  );
  expect(copies).toHaveLength(1);
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
