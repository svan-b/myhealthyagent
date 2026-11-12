/**
 * @jest-environment node
 */
// A chosen severity button must stand out from the page (WCAG 1.4.11 asks for 3:1), in both themes, without
// changing the severity colors used for dots elsewhere.
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

// The severity colors as they were. Dots in History, Today and Insights use them.
const FILLS = {
  light: ['#3d9a8b', '#d39b1d', '#e06c2b', '#c4302b'],
  dark: ['#4fb5a4', '#e0b03a', '#ec864a', '#ec5a52'],
};

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
] as const)('%s theme', (theme, selector) => {
  const t = tokens(selector);
  // The page, cards and sheets, and the grey used for raised parts.
  const around = ['bg', 'surface', 'surface-2'].map(n => t[n]);

  it.each(SEVERITY_LEVELS.map((l, i) => [l.label, i + 1]))(
    'the chosen %s button has a border of at least 3:1 against the page, cards and sheets',
    (_label, n) => {
      const edge = t[`edge-sev-${n}`];
      expect(edge).toBeDefined();
      for (const color of around) expect(contrast(edge, color)).toBeGreaterThanOrEqual(3);
      // Its text stays readable on the fill.
      expect(contrast(t[`on-sev-${n}`], t[`sev-${n}`])).toBeGreaterThanOrEqual(4.5);
      // The fill itself is unchanged.
      expect(t[`sev-${n}`]).toBe(FILLS[theme][n - 1]);
    },
  );
});

it('each severity level points at its own border color', () => {
  SEVERITY_LEVELS.forEach((l, i) => expect(l.edge).toBe(`var(--edge-sev-${i + 1})`));
});
