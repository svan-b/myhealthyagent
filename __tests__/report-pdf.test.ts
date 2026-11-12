/** @jest-environment node */
// The doctor report, built with the real jsPDF and read back from the PDF bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport, type ReportInput } from '@/lib/report/pdf';
import { fmtRange } from '@/lib/report/text';
import { getPatterns, type PatternInsight } from '@/lib/analysis/patterns';
import { findTriggers } from '@/lib/analysis/triggers';
import { dosesAsFactors } from '@/lib/medication/doses';
import type { Factor, MedicationAdherence, MedicationSchedule, Symptom } from '@/lib/db/schema';
import { PORTAL_LINK, pdfPages, pdfRuns, pdfText, realisticDiary } from './report-helpers';

interface Captured {
  widths: number[];
  /** Lines of each header cell, as drawn. */
  head: string[][];
  /** Text of each body cell, as given. */
  body: string[][];
}
const mockTables: Captured[] = [];
// Keeps the layout of every table the report draws.
jest.mock('jspdf-autotable', () => {
  const actual = jest.requireActual('jspdf-autotable');
  return {
    __esModule: true,
    default: (doc: { lastAutoTable: unknown }, options: unknown) => {
      actual.default(doc, options);
      type Cell = { text: string[]; raw: unknown };
      const t = doc.lastAutoTable as {
        columns: { index: number; width: number }[];
        head: { cells: Record<number, Cell> }[];
        body: { cells: Record<number, Cell> }[];
      };
      mockTables.push({
        widths: t.columns.map(c => c.width),
        head: t.head.length ? t.columns.map(c => t.head[0].cells[c.index].text) : [],
        body: t.body.map(r => t.columns.map(c => String(r.cells[c.index]?.raw ?? ''))),
      });
    },
  };
});

const NOW = new Date(2026, 10, 12, 15, 0);
/** Local time `daysAgo` days before NOW's day. */
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 10, 12 - daysAgo, h, m);
const iso = (daysAgo: number, h: number, m = 0) => at(daysAgo, h, m).toISOString();

let ids = 0;
const symptom = (name: string, when: string, extra: Partial<Symptom> = {}): Symptom => ({
  id: `s${ids++}`,
  name,
  severity: 5,
  timestamp: when,
  ...extra,
});
const factor = (name: string, category: Factor['category'], when: string, notes?: string): Factor => ({
  id: `f${ids++}`,
  name,
  category,
  timestamp: when,
  ...(notes ? { notes } : {}),
});

type Input = Partial<ReportInput> & Pick<ReportInput, 'symptoms' | 'factors'>;
async function build(input: Input) {
  mockTables.length = 0;
  const report = await buildReport({ schedules: [], doses: [], days: 30, now: NOW, ...input });
  const bytes = new Uint8Array(await report.blob.arrayBuffer());
  const runs = pdfRuns(bytes);
  return { report, bytes, runs, lines: runs.map(r => r.text), text: pdfText(bytes), tables: [...mockTables] };
}
type Built = Awaited<ReturnType<typeof build>>;
const tableNamed = (b: Built, firstHeader: string) => b.tables.find(t => t.head[0]?.join(' ') === firstHeader);
/** The text drawn between two headings. */
function section(b: Built, heading: string): string {
  const all = b.text.split('\n');
  const start = all.indexOf(heading);
  if (start < 0) return '';
  const next = all.findIndex(
    (l, i) => i > start && ['Possible triggers', 'Other patterns', 'Medications', 'Entries'].includes(l),
  );
  return all.slice(start + 1, next < 0 ? undefined : next).join('\n');
}

/** Dairy followed by bloating early the next morning, headaches in the morning and coffee, on days `from` to `to` ago. */
function delayedTrigger(from: number, to: number, opts: { dairyUntil?: number } = {}) {
  const symptoms: Symptom[] = [];
  const factors: Factor[] = [];
  for (let d = from; d >= to; d--) {
    factors.push(factor('Coffee', 'drink', iso(d, 7, 30)));
    if (d % 3 === 0 && d > (opts.dairyUntil ?? to)) {
      factors.push(factor('Dairy', 'food', iso(d, 12, 30)));
      symptoms.push(symptom('Bloating', iso(d - 1, 5), { severity: 7 }));
    }
    if (d % 2 === 0 || d === to) symptoms.push(symptom('Headache', iso(d, 8, 15)));
  }
  return { symptoms, factors };
}

/** Nausea and dizziness on the same days until a month ago, and headaches all along. */
function stoppedPair() {
  const symptoms: Symptom[] = [];
  const factors: Factor[] = [];
  for (let d = 59; d >= 0; d--) {
    factors.push(factor('Coffee', 'drink', iso(d, 7, 30)));
    if (d >= 32 && d % 2 === 0) symptoms.push(symptom('Nausea', iso(d, 10)), symptom('Dizziness', iso(d, 11)));
    if (d % 4 === 1) symptoms.push(symptom('Headache', iso(d, 16)));
  }
  return { symptoms, factors };
}

describe('dates and the period each part covers (F19)', () => {
  test('when every log is older than the period, the trigger and pattern sections say which dates they come from', async () => {
    const b = await build(delayedTrigger(160, 40));
    expect(b.text).toContain('Period: Oct 14 to Nov 12, 2026 (30 days)');
    expect(b.text).toContain('No symptoms were logged in this period.');
    expect(b.text).toContain('No entries in this period.');

    const triggers = section(b, 'Possible triggers');
    // Logs from day 160 (Jun 5) to day 40 (Oct 3).
    expect(triggers.split('\n')[0]).toBe('Based on logs from Jun 5 to Oct 3, 2026.');
    expect(tableNamed(b, 'Logged item')?.body.map(r => r.slice(0, 2))).toEqual([['Dairy (food)', 'Bloating']]);
    expect(triggers).toContain('Dairy was last logged on Oct 1, 2026, before this report’s period.');
    expect(triggers).toContain('Bloating was last logged on Oct 2, 2026, before this report’s period.');

    // Every pattern says which logs it is based on. Time of day looks at every symptom logged.
    const patterns = section(b, 'Other patterns').split('\n');
    const title = patterns.indexOf('Headache usually starts in the morning');
    expect(title).toBeGreaterThanOrEqual(0);
    expect(patterns.slice(title + 1, title + 3)).toContain('Based on logs from Jun 5 to Oct 3, 2026.');
  });

  test('a trigger found before an elimination diet stays visible, marked as not logged in the period', async () => {
    const b = await build(delayedTrigger(120, 0, { dairyUntil: 35 }));
    const triggers = section(b, 'Possible triggers');
    expect(triggers.split('\n')[0]).toBe('Based on logs from Jul 15 to Nov 12, 2026.');
    expect(tableNamed(b, 'Logged item')?.body.map(r => r.slice(0, 2))).toEqual([['Dairy (food)', 'Bloating']]);
    expect(triggers).toContain('Dairy was last logged on Oct 7, 2026, before this report’s period.');
    expect(triggers).toContain('Bloating was last logged on Oct 8, 2026, before this report’s period.');
    // The period itself shows no dairy and no bloating.
    expect(tableNamed(b, 'Symptom')?.body.map(r => r[0])).toEqual(['Headache']);
    expect(tableNamed(b, 'When')?.body.some(r => /Dairy|Bloating/.test(r[1]))).toBe(false);
  });

  test('a pattern about a symptom that stopped before the period gives its own dates and says when it was last logged', async () => {
    // After the elimination diet, bloating stopped 35 days ago. Headaches go on.
    const b = await build(delayedTrigger(120, 0, { dairyUntil: 35 }));
    const patterns = section(b, 'Other patterns').split('\n');
    const bloating = patterns.indexOf('Bloating usually starts in the morning');
    expect(bloating).toBeGreaterThanOrEqual(0);
    expect(patterns.slice(bloating + 2, bloating + 4)).toEqual([
      // Only the bloating logs, not every symptom up to today.
      'Based on logs from Jul 16 to Oct 8, 2026.',
      'Bloating was last logged on Oct 8, 2026, before this report’s period.',
    ]);
    // Headaches were logged in the period, so their card has no such note.
    const headache = patterns.indexOf('Headache usually starts in the morning');
    expect(patterns[headache + 2]).toBe('Based on logs from Jul 15 to Nov 12, 2026.');
    expect(patterns.join('\n')).not.toContain('Headache was last logged');
  });

  test('a together card names each symptom that was last logged before the period', async () => {
    const { symptoms, factors } = stoppedPair();
    const cards = getPatterns(symptoms, factors, NOW);
    expect(cards.map(c => c.kind).sort()).toEqual(['time-of-day', 'time-of-day', 'time-of-day', 'together']);
    const b = await build({ symptoms, factors });
    const lines = section(b, 'Other patterns').split('\n');
    const together = lines.indexOf('Nausea and dizziness tend to happen on the same day');
    expect(together).toBeGreaterThanOrEqual(0);
    expect(lines.slice(together + 1).join(' ')).toContain(
      'Based on logs from Sep 14 to Nov 12, 2026. Nausea was last logged on Oct 11, 2026, before this report’s period. Dizziness was last logged on Oct 11, 2026, before this report’s period.',
    );
  });

  test('wherever the page ends, a heading never ends a page and a pattern card is never split', async () => {
    const { symptoms, factors } = stoppedPair();
    const cards = getPatterns(symptoms, factors, NOW);
    const footer = (r: { text: string }) => /^Page \d+ of \d+$|^Patient-recorded/.test(r.text);
    const headings = ['Overview', 'Symptoms', 'Possible triggers', 'Other patterns', 'Medications', 'Entries'];
    // Each symptom logged once in the period adds a row to the symptom table, which moves the patterns down.
    for (let extra = 0; extra < 24; extra++) {
      const once = Array.from({ length: extra }, (_, i) => symptom(`Symptom ${i + 1}`, iso(2, 9)));
      const b = await build({ symptoms: [...symptoms, ...once], factors });
      const runs = b.runs.filter(r => !footer(r));
      runs.forEach((r, i) => {
        if (headings.includes(r.text) && i + 1 < runs.length)
          expect([extra, r.text, runs[i + 1].page]).toEqual([extra, r.text, r.page]);
      });
      for (const card of cards) {
        const start = runs.findIndex(r => r.text === card.title);
        const end = runs.findIndex(
          (r, i) => i > start && (cards.some(c => c.title === r.text) || headings.includes(r.text)),
        );
        expect(start).toBeGreaterThanOrEqual(0);
        expect([extra, card.title, new Set(runs.slice(start, end).map(r => r.page)).size]).toEqual([
          extra,
          card.title,
          1,
        ]);
      }
    }
  });

  test('triggers come from the same data as the Insights screen, whatever the period', async () => {
    const diary = realisticDiary(NOW);
    const insights = findTriggers(diary.symptoms, diary.factors, {
      now: NOW,
      exposureOnly: dosesAsFactors(diary.doses),
    });
    expect(insights.findings.length).toBeGreaterThan(0);
    const rows = insights.findings.map(f => [f.factor, f.symptom, f.window.label]);
    for (const days of [30, 90]) {
      const b = await build({ ...diary, days });
      expect(tableNamed(b, 'Logged item')?.body.map(r => [r[0].replace(/ \(\w+\)$/, ''), r[1], r[2]])).toEqual(rows);
    }
  });

  test.each([
    [
      'trend and together',
      () => {
        const symptoms: Symptom[] = [];
        const factors: Factor[] = [];
        for (let d = 80; d >= 0; d--) {
          factors.push(factor('Coffee', 'drink', iso(d, 7, 30)));
          // Fatigue on most of the last two weeks and rarely before. Nausea and dizziness on the same days.
          if (d < 14 ? d % 7 !== 3 : d % 9 === 0) symptoms.push(symptom('Fatigue', iso(d, 14)));
          if (d % 5 === 0) symptoms.push(symptom('Nausea', iso(d, 10)), symptom('Dizziness', iso(d, 11)));
        }
        return { symptoms, factors };
      },
    ],
    ['time of day and weekday', () => realisticDiary(NOW)],
  ])('each pattern names the dates it is based on (%s)', async (name, diary) => {
    const data = diary();
    const b = await build({ ...data, days: 30 });
    const cards = getPatterns(data.symptoms, data.factors, NOW);
    const kinds = name === 'trend and together' ? ['trend', 'together', 'time-of-day'] : ['time-of-day', 'weekday'];
    expect(new Set(cards.map(c => c.kind))).toEqual(new Set(kinds));
    const expected = (card: PatternInsight) => {
      if (card.kind === 'time-of-day') {
        // Every log of the card's own symptom.
        const times = data.symptoms
          .filter(s => card.id === `tod-${s.name.toLowerCase()}`)
          .map(s => Date.parse(s.timestamp));
        expect(times.length).toBeGreaterThan(0);
        return `Based on logs from ${fmtRange(new Date(Math.min(...times)), new Date(Math.max(...times)))}.`;
      }
      return {
        // The last 60 days, today included.
        weekday: 'Based on logs from Sep 14 to Nov 12, 2026.',
        together: 'Based on logs from Sep 14 to Nov 12, 2026.',
        // The last four weeks, today included.
        trend: 'Based on logs from Oct 16 to Nov 12, 2026.',
      }[card.kind];
    };
    const lines = section(b, 'Other patterns').split('\n');
    const starts = cards.map(c => lines.indexOf(c.title));
    expect(starts.every(i => i >= 0)).toBe(true);
    cards.forEach((card, k) => {
      const block = lines.slice(starts[k] + 1, starts[k + 1]);
      expect(block.filter(l => l.startsWith('Based on'))).toEqual([expected(card)]);
    });
  });
});

describe('characters and fonts (F21)', () => {
  const names = ['Ból głowy', 'Головная боль', 'Πονοκέφαλος', 'Đau đầu', 'Baş ağrısı', 'Dvořák'];
  // The emoji style selector after ©, a keycap 1, and a family joined with zero width joiners.
  const emojiStyle = String.fromCodePoint(0xfe0f);
  const keycap = `1${emojiStyle}${String.fromCodePoint(0x20e3)}`;
  const family = ['👨', '👩', '👧'].join(String.fromCodePoint(0x200d));
  const unicodeDiary = () => ({
    symptoms: [
      ...names.map((n, i) => symptom(n, iso(i + 1, 9))),
      symptom('Headache', iso(1, 18), { notes: 'Po kawie 😣' }),
      symptom('Headache', iso(2, 18), { notes: '头痛 since morning' }),
      symptom('Rash', iso(3, 18), {
        notes: `©${emojiStyle} brand cream, ${keycap} dose, flag 🇵🇱, family ${family}`,
      }),
    ],
    factors: [factor('Żurek', 'food', iso(1, 12), 'Zupa u babci.\nDruga linia.')],
    patientName: 'Łukasz Żółć',
  });

  test('names and notes in Polish, Russian, Greek, Vietnamese, Turkish and Czech print as typed, in an embedded font', async () => {
    const b = await build(unicodeDiary());
    expect(b.text).toContain('Patient: Łukasz Żółć');
    for (const n of names) expect(b.lines).toContain(n);
    expect(b.lines).toContain('Żurek (food)');
    expect(b.lines).toEqual(expect.arrayContaining(['Zupa u babci.', 'Druga linia.']));
    // Every line is drawn in the embedded Noto Sans, none in the built-in Helvetica.
    expect(new Set(b.runs.map(r => r.font))).toEqual(new Set(['NotoSans']));
    const pdf = Buffer.from(b.bytes).toString('latin1');
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/Identity-H');
  });

  test('emoji and Chinese print as a visible mark, and the person is told', async () => {
    const b = await build(unicodeDiary());
    const mark = String.fromCharCode(0xfffd);
    expect(b.report.replacedCharacters).toBe(true);
    expect(b.lines).toContain(`Po kawie ${mark}`);
    expect(b.lines).toContain(`${mark}${mark} since morning`);
    // A flag or a family is one mark. A style selector on a character the font has is simply left off.
    expect(b.text.replace(/\n/g, ' ')).toContain(`© brand cream, 1 dose, flag ${mark}, family ${mark}`);
    expect(b.text.replace(/\n/g, ' ')).toContain(
      `Characters that could not be printed, such as emoji, show as ${mark}.`,
    );
  });

  test('a report with nothing to replace says nothing about it', async () => {
    const b = await build({
      symptoms: [symptom('Headache', iso(1, 9), { notes: 'Café, naïve, “quoted” – 5 €' })],
      factors: [],
    });
    expect(b.report.replacedCharacters).toBe(false);
    expect(b.lines).toContain('Café, naïve, “quoted” – 5 €');
    expect(b.text).not.toContain('could not be printed');
  });

  test('dates are in English whatever the device language', async () => {
    const real = {
      date: Date.prototype.toLocaleDateString,
      both: Date.prototype.toLocaleString,
      time: Date.prototype.toLocaleTimeString,
    };
    const RealFormat = Intl.DateTimeFormat;
    // A phone set to Polish.
    const spies = [
      jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, l, o) {
        return real.date.call(this, l ?? 'pl-PL', o);
      }),
      jest.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, l, o) {
        return real.both.call(this, l ?? 'pl-PL', o);
      }),
      jest.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (this: Date, l, o) {
        return real.time.call(this, l ?? 'pl-PL', o);
      }),
      jest
        .spyOn(Intl, 'DateTimeFormat')
        .mockImplementation(
          ((l?: string | string[], o?: Intl.DateTimeFormatOptions) =>
            new RealFormat(l ?? 'pl-PL', o)) as unknown as typeof Intl.DateTimeFormat,
        ),
    ];
    try {
      await jest.isolateModulesAsync(async () => {
        const { buildReport: isolated } = await import('@/lib/report/pdf');
        const report = await isolated({
          symptoms: [symptom('Headache', iso(1, 20, 5))],
          factors: [],
          schedules: [],
          doses: [],
          days: 30,
          now: NOW,
        });
        const lines = pdfText(new Uint8Array(await report.blob.arrayBuffer())).split('\n');
        expect(lines).toEqual(
          expect.arrayContaining([
            'Period: Oct 14 to Nov 12, 2026 (30 days)',
            'Prepared: Nov 12, 2026',
            'Nov 11, 8:05 PM',
            'Oct 14',
            'Nov 12',
          ]),
        );
      });
    } finally {
      spies.forEach(s => s.mockRestore());
    }
  });
});

describe('table columns (F20)', () => {
  const entries = (note?: string) => {
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 1; d <= 6; d++) {
      symptoms.push(symptom('Stomach pain', iso(d, 9), d === 3 && note ? { notes: note } : {}));
      factors.push(factor('Fried or fatty food', 'food', iso(d, 8)));
    }
    return { symptoms, factors };
  };

  test('a pasted link in a note wraps inside the note and leaves the entry names readable', async () => {
    const plain = await build(entries('Lab results here'));
    const linked = await build(entries(`Lab results here ${PORTAL_LINK}`));
    const log = tableNamed(linked, 'When')!;
    expect(log.head.map(h => h.join(' '))).toEqual(['When', 'Entry', 'Severity', 'Duration', 'Note']);
    expect(log.widths[1]).toBeGreaterThanOrEqual(100);
    expect(linked.lines).toContain('Stomach pain');
    expect(linked.lines).toContain('Fried or fatty food (food)');
    expect(pdfPages(linked.bytes)).toBe(pdfPages(plain.bytes));
  });

  test('60 character names and long unbroken words never squeeze another column', async () => {
    const longSymptom = 'Stomachcrampsandbloatingaftereverymealthatgetsworseatnightxx';
    const longFood = 'Homemadefermentedcabbagesoupwithsmokedsausageandsourdoughxxx';
    const longMed = 'Extendedreleasemagnesiumglycinatewithvitaminb6andzinccomplex';
    expect([longSymptom, longFood, longMed].map(s => s.length)).toEqual([60, 60, 60]);
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 60; d >= 0; d--) {
      factors.push(factor('Coffee', 'drink', iso(d, 7, 30)));
      if (d % 3 === 0 && d > 0) {
        factors.push(factor(longFood, 'food', iso(d, 12, 30)));
        symptoms.push(symptom(longSymptom, iso(d - 1, 5), { severity: 7, notes: 'x'.repeat(1000) }));
      }
      if (d % 2 === 0) symptoms.push(symptom('Headache', iso(d, 8, 15)));
    }
    const schedules: MedicationSchedule[] = [
      {
        id: 'm',
        medicationName: longMed,
        dosage: '2capsulesinthemorningwithfoodandaglassofwaterunlessotherwise',
        frequency: 'four-times',
        scheduleTimes: ['08:00', '12:00', '16:00', '20:00'],
        isActive: true,
        startDate: iso(60, 0),
        createdAt: iso(60, 0),
        updatedAt: iso(60, 0),
      },
    ];
    const b = await build({ symptoms, factors, schedules });
    const expected: Record<string, string[]> = {
      Symptom: ['Symptom', 'Days', 'Entries', 'Typical severity', 'Worst', 'Typical duration'],
      'Logged item': ['Logged item', 'Symptom', 'Delay', 'Followed by symptom', 'Same hours, other days', 'Signal'],
      Medication: ['Medication', 'Dose', 'Schedule', 'Doses taken (last 30 days)'],
      When: ['When', 'Entry', 'Severity', 'Duration', 'Note'],
    };
    for (const [first, headers] of Object.entries(expected)) {
      const t = tableNamed(b, first);
      expect(t).toBeDefined();
      // Header words are wrapped between words, never split into letters.
      expect(t!.head.map(lines => lines.join(' '))).toEqual(headers);
      for (const lines of t!.head)
        for (const line of lines)
          expect(line.split(' ').every(w => headers.join(' ').split(' ').includes(w))).toBe(true);
      for (const w of t!.widths) expect(w).toBeGreaterThanOrEqual(40);
    }
    expect(tableNamed(b, 'Logged item')!.body[0].slice(0, 2)).toEqual([`${longFood} (food)`, longSymptom]);
  });
});

describe('possible triggers never imply that something unchecked was ruled out (F23)', () => {
  const NEGATIVE = 'No logged food, drink, activity or medication was followed by a clear rise in any symptom.';

  test('caffeine at the same time every day and dairy twice: nothing could be checked, and the report says why', async () => {
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 29; d >= 0; d--) {
      factors.push(factor('Caffeine', 'drink', iso(d, 8)));
      if (d % 2 === 1) symptoms.push(symptom('Headache', iso(d, 15)));
    }
    factors.push(factor('Dairy', 'food', iso(10, 12)), factor('Dairy', 'food', iso(20, 12)));
    const b = await build({ symptoms, factors });
    const text = section(b, 'Possible triggers').replace(/\n/g, ' ');
    expect(text).not.toContain(NEGATIVE);
    expect(text).not.toContain('No checked item');
    expect(text).toContain('No logged item could be checked for triggers yet, so none is ruled out.');
    expect(text).toContain('Not checked, so not ruled out');
    expect(text).toContain(
      'Caffeine is logged every day or at the same time each day, so it cannot be told apart from the daily routine.',
    );
    expect(text).toContain('Dairy needs at least 3 logs before it can be checked.');
  });

  test('when some items were checked, the negative result names them and lists what was not checked', async () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 40; d >= 0; d--) {
      factors.push(factor('Coffee', 'drink', iso(d, 7, 30)));
      if (rnd() < 0.35) factors.push(factor('Dairy', 'food', iso(d, 11 + Math.floor(rnd() * 9))));
      if (rnd() < 0.4) symptoms.push(symptom('Headache', iso(d, 9 + Math.floor(rnd() * 12))));
    }
    const b = await build({ symptoms, factors });
    expect(tableNamed(b, 'Logged item')).toBeUndefined();
    const text = section(b, 'Possible triggers').replace(/\n/g, ' ');
    expect(text).not.toContain(NEGATIVE);
    expect(text).toContain('No checked item was clearly followed by a rise in a checked symptom.');
    expect(text).toContain('The item checked was Dairy.');
    expect(text).toContain('The symptom checked was Headache.');
    expect(text).toContain(
      'Coffee is logged every day or at the same time each day, so it cannot be told apart from the daily routine.',
    );
  });

  test('a symptom logged twice is named as not checked', async () => {
    const factors: Factor[] = [];
    for (let d = 40; d >= 0; d--) factors.push(factor(['Bread', 'Rice', 'Beans'][d % 3], 'food', iso(d, 9 + (d % 7))));
    const symptoms = [symptom('Bloating', iso(5, 20)), symptom('Bloating', iso(15, 20))];
    const b = await build({ symptoms, factors });
    const text = section(b, 'Possible triggers').replace(/\n/g, ' ');
    expect(text).not.toContain(NEGATIVE);
    expect(text).toContain('No logged item could be checked for triggers yet, so none is ruled out.');
    expect(text).toContain('Bloating needs to be logged on at least 3 separate occasions before it can be checked.');
  });

  test('a medication taken every day is named as not checked, not as cleared', async () => {
    const symptoms: Symptom[] = [];
    const doses: MedicationAdherence[] = [];
    for (let d = 30; d >= 1; d--) {
      if (d % 2) symptoms.push(symptom('Headache', iso(d, 16)));
      doses.push({
        id: `d${d}`,
        scheduleId: 'sert',
        medicationName: 'Sertraline',
        scheduledTime: `${at(d, 0).toISOString().slice(0, 10)}T08:00`,
        takenTime: iso(d, 8, d % 40),
        status: 'taken',
      });
    }
    const b = await build({ symptoms, factors: [], doses });
    const text = section(b, 'Possible triggers').replace(/\n/g, ' ');
    expect(text).not.toContain(NEGATIVE);
    expect(text).toContain(
      'Sertraline is logged every day or at the same time each day, so it cannot be told apart from the daily routine.',
    );
  });
});

describe('doses ticked off on the Meds tab (F05)', () => {
  // A pill ticked every morning, and the Log tab used on about half the days for coffee and that day's
  // headache. Headaches have nothing to do with coffee.
  function pillAndDiary(seed: number) {
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    const doses: MedicationAdherence[] = [];
    for (let d = 59; d >= 1; d--) {
      doses.push({
        id: `d${d}`,
        scheduleId: 'sert',
        medicationName: 'Sertraline',
        scheduledTime: 'x',
        takenTime: iso(d, 7, 30 + Math.floor(rnd() * 120)),
        status: 'taken',
      });
      const logs = rnd() < 0.5;
      const headache = rnd() < 0.5;
      const hour = 8 + Math.floor(rnd() * 14);
      if (logs) {
        factors.push(factor('Coffee', 'drink', iso(d, 7, Math.floor(rnd() * 120))));
        if (headache) symptoms.push(symptom('Headache', iso(d, hour)));
      }
    }
    return { symptoms, factors, doses };
  }

  test('a day with only a ticked pill does not count as tracked, so no false trigger appears', async () => {
    const diary = pillAndDiary(1);
    // Counting pill-only days as symptom free makes coffee look like a strong trigger.
    const naive = findTriggers(diary.symptoms, [...diary.factors, ...dosesAsFactors(diary.doses)], { now: NOW });
    expect(naive.findings.map(f => [f.factor, f.strength])).toEqual([['Coffee', 'strong']]);

    const b = await build(diary);
    expect(tableNamed(b, 'Logged item')).toBeUndefined();
    expect(section(b, 'Possible triggers')).not.toContain('Coffee (drink)');
  });
});

describe('medications in every state (F10, R3)', () => {
  const base = (id: string, name: string, extra: Partial<MedicationSchedule> = {}): MedicationSchedule => ({
    id,
    medicationName: name,
    dosage: '10 mg',
    frequency: 'daily',
    scheduleTimes: ['08:00'],
    isActive: true,
    startDate: iso(120, 7),
    createdAt: iso(120, 7),
    updatedAt: iso(120, 7),
    ...extra,
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  const slot = (daysAgo: number, time: string) => {
    const d = at(daysAgo, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}`;
  };
  const taken = (s: MedicationSchedule, daysAgo: number, time = '08:00'): MedicationAdherence => ({
    id: `${s.id}-${daysAgo}-${time}`,
    scheduleId: s.id,
    medicationName: s.medicationName,
    scheduledTime: slot(daysAgo, time),
    takenTime: iso(daysAgo, Number(time.slice(0, 2)), 10),
    status: 'taken',
  });
  const range = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

  test('each schedule state reads right in the doses column', async () => {
    // Paused on day 3 at 07:00, after every dose before was taken.
    const lisinopril = base('lisi', 'Lisinopril', {
      frequency: 'twice-daily',
      scheduleTimes: ['08:00', '20:00'],
      isActive: false,
      pausedAt: iso(3, 7),
      updatedAt: iso(3, 7),
    });
    // Taken every day, paused on day 4 at 21:00 and resumed today at 08:30.
    const sertraline = base('sert', 'Sertraline', { pauses: [{ from: iso(4, 21), to: iso(0, 8, 30) }] });
    // Ended ten days ago.
    const metformin = base('metf', 'Metformin', { endDate: iso(10, 12) });
    const ibuprofen = base('ibu', 'Ibuprofen', { frequency: 'as-needed', scheduleTimes: [] });
    // Tracking started five days ago.
    const vitaminD = base('vitd', 'Vitamin D', { startDate: iso(5, 7) });
    // Added today after its 08:00 dose.
    const iron = base('iron', 'Iron', { startDate: iso(0, 14) });
    // Paused before the period, with a dose recorded during the pause.
    const zinc = base('zinc', 'Zinc', { isActive: false, pausedAt: iso(40, 7), updatedAt: iso(40, 7) });
    const folic = base('folic', 'Folic acid', { isActive: false, pausedAt: iso(50, 7), updatedAt: iso(50, 7) });
    const doses = [
      ...range(120, 4).flatMap(d => [taken(lisinopril, d), taken(lisinopril, d, '20:00')]),
      ...range(120, 4).map(d => taken(sertraline, d)),
      ...range(120, 10).map(d => taken(metformin, d)),
      { ...taken(ibuprofen, 6), scheduledTime: iso(6, 21) },
      ...range(5, 0).map(d => taken(vitaminD, d)),
      taken(zinc, 20),
    ];
    const b = await build({
      symptoms: [symptom('Headache', iso(1, 9))],
      factors: [],
      schedules: [lisinopril, sertraline, metformin, ibuprofen, vitaminD, iron, zinc, folic],
      doses,
    });
    const rows = Object.fromEntries(tableNamed(b, 'Medication')!.body.map(r => [r[0], r[3]]));
    expect(rows).toEqual({
      // 26 days of two doses before the pause, and the 08:00 dose on the day it was paused at 07:00 is not due.
      Lisinopril: '52 of 52 (100%), paused since Nov 9, 2026',
      Sertraline: '26 of 26 (100%), paused Nov 8 to Nov 12, 2026',
      Metformin: '20 of 20 (100%), ended Nov 2, 2026',
      Ibuprofen: '1 dose logged',
      'Vitamin D': '6 of 6 (100%), tracked from Nov 7, 2026',
      Iron: 'No doses due yet, tracked from Nov 12, 2026',
      Zinc: '1 of 1 (100%), paused since Oct 3, 2026',
      'Folic acid': 'Paused since Sep 23, 2026',
    });
    expect(tableNamed(b, 'Medication')!.body.find(r => r[0] === 'Ibuprofen')![2]).toBe('As needed');
    expect(
      tableNamed(b, 'Medication')!
        .body.find(r => r[0] === 'Lisinopril')![2]
        .replace(/\s/g, ' '),
    ).toBe('8:00 AM, 8:00 PM');
  });
});

describe('symptom table', () => {
  test('typical severity is a level the person logged, not an average of levels (F42)', async () => {
    const symptoms = [2, 2, 2, 9].map((severity, i) => symptom('Migraine', iso(i + 1, 7), { severity }));
    const b = await build({ symptoms, factors: [] });
    expect(tableNamed(b, 'Symptom')!.body).toEqual([['Migraine', '4', '4', 'Mild', 'Very severe', 'Not recorded']]);
  });
});

describe('method note (R1)', () => {
  test('describes the day by day comparison, episodes, the usual chance and the correction', async () => {
    const b = await build(delayedTrigger(60, 0));
    const method = section(b, 'Possible triggers').replace(/\n/g, ' ');
    expect(method).not.toContain('stratified by hour of day');
    for (const phrase of [
      'with an exact test',
      'at the same clock times on other tracked days',
      'A symptom logged again within 6 hours, or within its logged duration plus an hour, counts as one episode.',
      'averaged over the times the item was logged',
      'Results are corrected for the',
    ]) {
      expect(method).toContain(phrase);
    }
  });

  test('says which days count as tracked: any diary entry, such as stress, but not a ticked dose alone', async () => {
    // Stress is the only item, so a day with a stress entry has to count as tracked.
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 40; d >= 0; d--) {
      factors.push(factor('Stress', 'stress', iso(d, 9 + (d % 5))));
      if (d % 3 === 0) symptoms.push(symptom('Headache', iso(d, 18)));
    }
    const b = await build({ symptoms, factors });
    const text = section(b, 'Possible triggers').replace(/\n/g, ' ');
    expect(text).toContain('The item checked was Stress.');
    expect(text).toContain(
      'Only days with at least one symptom or other diary entry count as tracked, not days with only a medication dose ticked off.',
    );
    expect(text).not.toContain('food, drink or activity entry');
  });

  test('is left out when there is not enough logging yet, even if a few comparisons were made', async () => {
    let seed = 2;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const symptoms: Symptom[] = [];
    const factors: Factor[] = [];
    for (let d = 9; d >= 0; d--) {
      factors.push(factor('Dairy', 'food', iso(d, 7 + Math.floor(rnd() * 12))));
      if (rnd() < 0.6) symptoms.push(symptom('Headache', iso(d, 8 + Math.floor(rnd() * 12))));
    }
    const t = findTriggers(symptoms, factors, { now: NOW });
    expect(t.trackedDays).toBeLessThan(14);
    expect(t.testsRun).toBeGreaterThan(0);
    expect(t.findings).toEqual([]);
    const text = section(await build({ symptoms, factors }), 'Possible triggers').replace(/\n/g, ' ');
    expect(text).toContain('Not enough logging yet to look for triggers.');
    expect(text).not.toContain('Method:');
  });
});

describe('a realistic diary', () => {
  test.each([30, 90])('the %i day report prints every section in the embedded font', async days => {
    const diary = realisticDiary(NOW);
    const b = await build({ ...diary, days, patientName: 'Łukasz Żółć-Wiśniewski' });
    expect(new Set(b.runs.map(r => r.font))).toEqual(new Set(['NotoSans']));
    for (const heading of ['Overview', 'Symptoms', 'Possible triggers', 'Other patterns', 'Medications', 'Entries']) {
      expect(b.lines).toContain(heading);
    }
    expect(b.report.replacedCharacters).toBe(true);
    // Set REPORT_PDF_DIR to keep the PDFs and look at them.
    const dir = process.env.REPORT_PDF_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `report-${days}.pdf`), b.bytes);
    }
  });
});
