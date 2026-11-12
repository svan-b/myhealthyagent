// lib/report/printable.ts
// The report font draws Latin, Greek and Cyrillic text. jsPDF silently leaves out anything the font
// has no glyph for, such as emoji or Chinese, so that text is replaced with a visible mark first and
// the person is told about it.

/** Printed in place of a character the report font cannot draw. */
export const REPLACEMENT = String.fromCharCode(0xfffd);

export interface Printer {
  /** The text as the report can print it. */
  print(text: string): string;
  /** True once any character could not be printed. */
  readonly replaced: boolean;
}

/** A line break, including the Unicode line and paragraph separators. */
const LINE_BREAKS = new Set(['\n', '\r\n', '\r', String.fromCharCode(0x2028), String.fromCharCode(0x2029)]);
const isControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
/**
 * Characters that show nothing themselves, such as the emoji style selector, joiners, direction marks and
 * soft hyphens. A PDF has no use for them, so they are left out.
 */
const isInvisible = (cp: number) =>
  cp === 0x00ad ||
  cp === 0x034f ||
  cp === 0x061c ||
  cp === 0x180e ||
  (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x206f) ||
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  cp === 0xfeff ||
  (cp >= 0xe0000 && cp <= 0xe0fff);
/** Characters that belong to the one before them, for browsers that cannot split text into characters. */
const joinsPrevious = (cp: number) =>
  (cp >= 0x0300 && cp <= 0x036f) ||
  (cp >= 0x1ab0 && cp <= 0x1aff) ||
  (cp >= 0x1dc0 && cp <= 0x1dff) ||
  (cp >= 0x20d0 && cp <= 0x20ff) ||
  (cp >= 0xfe20 && cp <= 0xfe2f) ||
  (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
  cp === 0x200d ||
  isInvisible(cp);
const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;

/**
 * Splits text into what a reader sees as one character: a letter with its accents, or a whole emoji such
 * as a flag or a family.
 */
function splitter(): (text: string) => string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return text => Array.from(segmenter.segment(text), s => s.segment);
  }
  return characters;
}

/** Close enough to Intl.Segmenter for the few browsers without it. */
function characters(text: string): string[] {
  const out: string[] = [];
  let afterJoiner = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const last = out.length ? out[out.length - 1] : '';
    const lastCp = last ? last.codePointAt(0)! : 0;
    const pair = isRegionalIndicator(cp) && isRegionalIndicator(lastCp) && [...last].length === 1;
    if (last && (afterJoiner || pair || joinsPrevious(cp) || (ch === '\n' && last === '\r'))) {
      out[out.length - 1] += ch;
    } else {
      out.push(ch);
    }
    afterJoiner = cp === 0x200d;
  }
  return out;
}

/**
 * Prints with fonts that cover `coverage`, a list of first and last code points of each range, sorted.
 * Line breaks are kept, tabs become spaces, and other control and invisible characters are left out. A
 * character the fonts cannot draw becomes REPLACEMENT, except that an accent the fonts lack is left off
 * a letter they can draw.
 */
export function createPrinter(coverage: readonly number[]): Printer {
  const split = splitter();
  const covered = (cp: number) => {
    let lo = 0;
    let hi = coverage.length / 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cp < coverage[2 * mid]) hi = mid;
      else if (cp > coverage[2 * mid + 1]) lo = mid + 1;
      else return true;
    }
    return false;
  };
  let replaced = false;

  const printOne = (char: string): string => {
    if (LINE_BREAKS.has(char)) return '\n';
    if (char === '\t') return ' ';
    const points = [...char].map(ch => ch.codePointAt(0)!);
    if (isControl(points[0])) return '';
    let out = '';
    let lost = false;
    for (const cp of points) {
      if (isInvisible(cp)) continue;
      if (covered(cp)) out += String.fromCodePoint(cp);
      else lost = true;
    }
    if (!lost) return out;
    replaced = true;
    return covered(points[0]) ? out : REPLACEMENT;
  };

  return {
    print: text => split(text.normalize('NFC')).map(printOne).join(''),
    get replaced() {
      return replaced;
    },
  };
}
