/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEVERITY_LEVELS } from '@/lib/utils';

// WCAG 2 contrast ratio between two #rrggbb colors.
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

/** The custom properties set in one top level block of globals.css, i.e. ':root' or '.dark'. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(m => [m[1], m[2].toLowerCase()]),
  );
}

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
])('%s theme', (_theme, selector) => {
  const t = tokens(selector);

  it.each(SEVERITY_LEVELS.map((l, i) => [l.label, i + 1]))(
    'text on the chosen %s button is at least 4.5:1',
    (_label, n) => {
      const fill = t[`sev-${n}`];
      const ink = t[`on-sev-${n}`];
      expect(fill).toBeDefined();
      expect(ink).toBeDefined();
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

it('each severity level points at its own fill and text color', () => {
  SEVERITY_LEVELS.forEach((l, i) => {
    expect(l.color).toBe(`var(--sev-${i + 1})`);
    expect(l.on).toBe(`var(--on-sev-${i + 1})`);
  });
});
