/** @jest-environment node */
// Text the report font cannot draw is replaced with a visible mark, so nothing silently disappears (F21).
import { jsPDF } from 'jspdf';
import { COVERAGE, NOTO_SANS_BOLD, NOTO_SANS_REGULAR } from '@/lib/report/noto-sans';
import { createPrinter, REPLACEMENT } from '@/lib/report/printable';

const cp = (...points: number[]) => String.fromCodePoint(...points);
const ZWJ = cp(0x200d);
const VS16 = cp(0xfe0f);
const MARK = REPLACEMENT;

describe.each([
  ['with Intl.Segmenter', false],
  ['without Intl.Segmenter', true],
])('printing text %s', (_, withoutSegmenter) => {
  const segmenter = Intl.Segmenter;
  beforeAll(() => {
    if (withoutSegmenter) delete (Intl as { Segmenter?: unknown }).Segmenter;
  });
  afterAll(() => {
    (Intl as { Segmenter?: unknown }).Segmenter = segmenter;
  });
  const print = (text: string) => {
    const p = createPrinter(COVERAGE);
    return { out: p.print(text), replaced: p.replaced };
  };

  test.each([
    'Łukasz Żółć, Ból głowy, Żurek',
    'Головная боль, Квас',
    'Πονοκέφαλος',
    'Đau đầu, phở',
    'Baş ağrısı, Dvořák',
    'Café, naïve, “quoted” – 5 € … ½',
  ])('keeps %s as typed', text => {
    expect(print(text)).toEqual({ out: text, replaced: false });
  });

  test('replaces each emoji and each Chinese character with one mark', () => {
    expect(print('Po kawie 😣')).toEqual({ out: `Po kawie ${MARK}`, replaced: true });
    expect(print('头痛 since morning')).toEqual({ out: `${MARK}${MARK} since morning`, replaced: true });
  });

  test('a flag, a family or a skin tone is one character, and so one mark', () => {
    const family = ['👨', '👩', '👧'].join(ZWJ);
    expect(print(`flag 🇵🇱, family ${family}, thumbs 👍🏽.`).out).toBe(`flag ${MARK}, family ${MARK}, thumbs ${MARK}.`);
  });

  test('an emoji style on a character the font has is left off, and only a lost part counts as replaced', () => {
    expect(print(`©${VS16} brand`)).toEqual({ out: '© brand', replaced: false });
    // A keycap keeps its digit, but the keycap itself is lost.
    expect(print(`step 1${VS16}${cp(0x20e3)}`)).toEqual({ out: 'step 1', replaced: true });
  });

  test('letters typed with separate accents are joined first', () => {
    expect(print(`Cafe${cp(0x301)} Z${cp(0x307)}urek`)).toEqual({ out: 'Café Żurek', replaced: false });
  });

  test('leaves out characters that show nothing, such as soft hyphens, joiners and direction marks', () => {
    const text = `Re${cp(0xad)}flux${cp(0x200b)} ${cp(0x200e)}after${cp(0x2060)} meals${cp(0xfeff)}`;
    expect(print(text)).toEqual({ out: 'Reflux after meals', replaced: false });
  });

  test('keeps line breaks, turns tabs into spaces and drops other control characters', () => {
    expect(print(`one\r\ntwo\rthree${cp(0x2028)}four\tfive${cp(0x7)}${cp(0)}six`)).toEqual({
      out: 'one\ntwo\nthree\nfour fivesix',
      replaced: false,
    });
  });
});

test('the replacement mark is in both fonts', () => {
  expect(createPrinter(COVERAGE).print(MARK)).toBe(MARK);
});

test('the coverage list is exactly what both embedded fonts can draw', () => {
  const doc = new jsPDF();
  doc.addFileToVFS('r.ttf', NOTO_SANS_REGULAR);
  doc.addFont('r.ttf', 'R', 'normal');
  doc.addFileToVFS('b.ttf', NOTO_SANS_BOLD);
  doc.addFont('b.ttf', 'B', 'bold');
  type Font = { metadata: { cmap: { unicode: { codeMap: Record<number, number> } } } };
  const internal = doc.internal as unknown as { getFont: (name: string, style: string) => Font };
  const mapped = (font: Font) =>
    Object.entries(font.metadata.cmap.unicode.codeMap)
      .filter(([, glyph]) => glyph > 0)
      .map(([code]) => Number(code));
  const regular = new Set(mapped(internal.getFont('R', 'normal')));
  const both = mapped(internal.getFont('B', 'bold')).filter(c => regular.has(c));
  const listed: number[] = [];
  for (let i = 0; i < COVERAGE.length; i += 2) for (let c = COVERAGE[i]; c <= COVERAGE[i + 1]; c++) listed.push(c);
  expect(listed).toEqual(both.sort((a, b) => a - b));
});
