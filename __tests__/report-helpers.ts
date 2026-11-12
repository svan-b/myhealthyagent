// Helpers for the doctor report tests, shared by the unit tests and the e2e spec.
import { inflateSync } from 'node:zlib';
import type { Factor, MedicationAdherence, MedicationSchedule, Symptom } from '@/lib/db/schema';

export interface TextRun {
  /** Page number, from 1. */
  page: number;
  /** The font's PostScript name, such as NotoSans-Bold or Helvetica. */
  font: string;
  text: string;
}

const hexToCodes = (hex: string) => {
  const codes: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) codes.push(parseInt(hex.slice(i, i + 4), 16));
  return codes;
};

function unescapeLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c as 'n'] ?? c;
  });
}

/**
 * Every line of text a jsPDF document draws, in order, with the font it uses. Text in embedded fonts is
 * decoded through the font's ToUnicode map, which is what PDF readers and copy and paste use.
 */
export function pdfRuns(bytes: Uint8Array): TextRun[] {
  const pdf = Buffer.from(bytes).toString('latin1');
  const objects = new Map<number, string>();
  for (const m of pdf.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objects.set(Number(m[1]), m[2]);
  /** The data of a stream object, inflated if it is compressed. */
  const stream = (id: number) => {
    const obj = objects.get(id) ?? '';
    const start = obj.indexOf('stream');
    if (start < 0) return '';
    const dict = obj.slice(0, start);
    let from = start + 'stream'.length;
    if (obj[from] === '\r') from++;
    if (obj[from] === '\n') from++;
    const raw = obj.slice(from, from + Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0));
    return dict.includes('/FlateDecode') ? inflateSync(Buffer.from(raw, 'latin1')).toString('latin1') : raw;
  };

  const fonts = new Map<string, { name: string; unicode: Map<number, string> | null }>();
  const resourceObject = [...objects.values()].find(o => !o.includes('stream') && o.includes('/Font <<')) ?? '';
  const resources = /\/Font <<([\s\S]*?)>>/.exec(resourceObject)?.[1] ?? '';
  for (const [, label, id] of resources.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const font = objects.get(Number(id)) ?? '';
    const name = /\/BaseFont \/([^\s/>]+)/.exec(font)?.[1] ?? '?';
    const toUnicode = /\/ToUnicode (\d+) 0 R/.exec(font)?.[1];
    let unicode: Map<number, string> | null = null;
    if (toUnicode) {
      unicode = new Map();
      const cmap = stream(Number(toUnicode));
      for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
          unicode.set(parseInt(src, 16), String.fromCharCode(...hexToCodes(dst)));
        }
      }
      for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const [, lo, hi, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
          const start = parseInt(dst, 16);
          for (let c = parseInt(lo, 16); c <= parseInt(hi, 16); c++) {
            unicode.set(c, String.fromCharCode(start + c - parseInt(lo, 16)));
          }
        }
      }
    }
    fonts.set(label, { name, unicode });
  }

  const pagesObject = [...objects.values()].find(o => /\/Type \/Pages\b/.test(o)) ?? '';
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(pagesObject)?.[1].matchAll(/(\d+) 0 R/g) ?? [])].map(m => Number(m[1]));
  const runs: TextRun[] = [];
  kids.forEach((pageId, index) => {
    const contents = /\/Contents (\d+) 0 R/.exec(objects.get(pageId) ?? '')?.[1];
    if (!contents) return;
    let font = fonts.get('F1')!;
    const ops = /\/(F\d+) [\d.]+ Tf|<([0-9a-fA-F]*)> Tj|\(((?:\\[\s\S]|[^\\)])*)\) Tj/g;
    for (const m of stream(Number(contents)).matchAll(ops)) {
      if (m[1]) {
        font = fonts.get(m[1]) ?? { name: m[1], unicode: null };
      } else {
        const text =
          m[2] !== undefined
            ? hexToCodes(m[2])
                .map(code => font.unicode?.get(code) ?? '?')
                .join('')
            : unescapeLiteral(m[3]);
        runs.push({ page: index + 1, font: font.name, text });
      }
    }
  });
  return runs;
}

/** All drawn text, one line per line drawn, with no-break spaces read as spaces. */
export function pdfText(bytes: Uint8Array): string {
  return pdfRuns(bytes)
    .map(r => r.text)
    .join('\n')
    .replace(/[^\S\n]/g, ' ');
}

/** Number of pages. */
export const pdfPages = (bytes: Uint8Array) =>
  Number(/\/Type \/Pages\s[^>]*?\/Count (\d+)/.exec(Buffer.from(bytes).toString('latin1'))?.[1] ?? 0);

/** A long link, as people paste from a patient portal. */
export const PORTAL_LINK =
  'https://mychart.examplehealth.org/MyChart/app/test-results/details?eorderid=WP-24abcDEF1234567890xyz';

export interface Diary {
  symptoms: Symptom[];
  factors: Factor[];
  schedules: MedicationSchedule[];
  doses: MedicationAdherence[];
}

/**
 * About four months of realistic logging up to `now`: several symptoms and foods in English, Polish and
 * Russian, a planted delayed trigger (dairy, then bloating early the next morning), notes with links,
 * newlines and emoji, a 60 character name and a 1000 character note, and medications in every state.
 */
export function realisticDiary(now: Date): Diary {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const at = (daysAgo: number, h: number, m = 0) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m);
  const iso = (daysAgo: number, h: number, m = 0) => at(daysAgo, h, m).toISOString();
  const symptoms: Symptom[] = [];
  const factors: Factor[] = [];
  let id = 0;
  const symptom = (name: string, severity: number, when: string, extra: Partial<Symptom> = {}) =>
    symptoms.push({ id: `s${id++}`, name, severity, timestamp: when, ...extra });
  const factor = (name: string, category: Factor['category'], when: string, notes?: string) =>
    factors.push({ id: `f${id++}`, name, category, timestamp: when, ...(notes ? { notes } : {}) });

  const longName = 'Bardzo długa nazwa objawu bólowego po posiłku z dużą ilością';
  const longFood = 'Homemadefermentedcabbagesoupwithsmokedsausageandsourdoughbread';
  const longNote =
    `${'Woke up with a dull ache behind the eyes that got worse after breakfast. '.repeat(13)}End.`.slice(0, 1000);
  for (let d = 120; d >= 0; d--) {
    // Today only has the morning coffee, so nothing is logged after `now`.
    if (d === 0) {
      if (now.getHours() >= 9) factor('Caffeine', 'drink', iso(d, 8));
      continue;
    }
    factor('Caffeine', 'drink', iso(d, 8));
    if (d % 3 === 1) {
      factor('Dairy', 'food', iso(d, 12, 30), d === 4 ? `Pizza with extra cheese ${PORTAL_LINK}` : undefined);
      if (rnd() < 0.85 && d > 1)
        symptom('Bloating', 7, iso(d - 1, 4 + Math.floor(rnd() * 3)), { duration_minutes: 180 });
    }
    if (rnd() < 0.3) factor('Gluten', 'food', iso(d, 13 + Math.floor(rnd() * 6)));
    if (rnd() < 0.15) factor('Żurek', 'food', iso(d, 19), 'Zupa u babci. Smaczna!\nDruga linia notatki.');
    if (rnd() < 0.12) factor('Квас', 'drink', iso(d, 17), 'Холодный квас 🍺');
    if ([0, 6].includes(at(d, 12).getDay()) && rnd() < 0.6) factor('Red wine', 'drink', iso(d, 20));
    if (rnd() < 0.3) {
      symptom('Headache', rnd() < 0.7 ? 5 : 7, iso(d, 15 + Math.floor(rnd() * 4)), {
        duration_minutes: 60,
        notes: d % 11 === 0 ? `Lab results here ${PORTAL_LINK}` : undefined,
      });
    }
    if (rnd() < 0.2)
      symptom('Fatigue', 5, iso(d, 14), d % 9 === 0 ? { notes: 'Tired all day 😴😴 after a bad night' } : {});
    if (rnd() < 0.1) symptom('Ból głowy', 5, iso(d, 10), { notes: 'Po kawie 😣, ból z prawej strony' });
    if (rnd() < 0.1) symptom('Головная боль', 7, iso(d, 21), { ongoing: true, notes: 'Сильная боль, принял таблетку' });
  }
  // Mostly mild with one very severe attack, so the typical severity is mild.
  for (const [d, sev] of [
    [25, 2],
    [18, 2],
    [12, 2],
    [5, 9],
  ]) {
    symptom('Migraine', sev, iso(d, 7), { duration_minutes: 240 });
  }
  symptom(longName, 5, iso(3, 11), { notes: longNote });
  symptom('Rash', 2, iso(2, 18), { notes: 'Small patch on the arm 🙁 photo in 头痛 folder' });
  factor(longFood, 'food', iso(6, 18, 30));
  factor('Sushi', 'food', iso(9, 19));
  factor('Pizza', 'food', iso(15, 20));

  const day = (daysAgo: number) => at(daysAgo, 0).toISOString();
  const schedule = (s: Partial<MedicationSchedule> & Pick<MedicationSchedule, 'id' | 'medicationName'>) => ({
    dosage: '',
    frequency: 'daily' as const,
    scheduleTimes: ['08:00'],
    isActive: true,
    startDate: day(120),
    createdAt: day(120),
    updatedAt: day(120),
    ...s,
  });
  const schedules: MedicationSchedule[] = [
    schedule({ id: 'levo', medicationName: 'Levothyroxine', dosage: '50 mcg', scheduleTimes: ['07:00'] }),
    // Paused three days ago, after months of use.
    schedule({
      id: 'lisi',
      medicationName: 'Lisinopril',
      dosage: '10 mg',
      frequency: 'twice-daily',
      scheduleTimes: ['08:00', '20:00'],
      isActive: false,
      pausedAt: at(3, 9).toISOString(),
      updatedAt: at(3, 9).toISOString(),
    }),
    // Paused for four days earlier in the period, then resumed.
    schedule({
      id: 'sert',
      medicationName: 'Sertraline',
      dosage: '50 mg',
      pauses: [{ from: at(14, 9).toISOString(), to: at(10, 9).toISOString() }],
    }),
    // Ended ten days ago.
    schedule({ id: 'metf', medicationName: 'Metformin', dosage: '500 mg', endDate: at(10, 12).toISOString() }),
    schedule({ id: 'ibu', medicationName: 'Ibuprofen', dosage: '400 mg', frequency: 'as-needed', scheduleTimes: [] }),
    // Started five days ago, with one dose recorded the day before tracking started.
    schedule({ id: 'vitd', medicationName: 'Vitamin D', dosage: '1000 IU', startDate: at(5, 7).toISOString() }),
    // Added today, after its time.
    schedule({
      id: 'iron',
      medicationName: 'Iron',
      dosage: '65 mg',
      scheduleTimes: ['06:00'],
      startDate: at(0, 7).toISOString(),
    }),
    schedule({
      id: 'long',
      medicationName: 'Extendedreleasemagnesiumglycinatewithvitaminb6andzinccomplex',
      dosage: '2capsulesinthemorningwithfoodandaglassofwaterunlessotherwise',
      frequency: 'four-times',
      scheduleTimes: ['08:00', '12:00', '16:00', '20:00'],
      startDate: day(40),
    }),
  ];
  const doses: MedicationAdherence[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  const slot = (daysAgo: number, time: string) => {
    const d = at(daysAgo, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}`;
  };
  const dose = (
    s: MedicationSchedule,
    daysAgo: number,
    time: string,
    status: MedicationAdherence['status'] = 'taken',
  ) => {
    const [h, m] = time.split(':').map(Number);
    doses.push({
      id: `d${id++}`,
      scheduleId: s.id,
      medicationName: s.medicationName,
      scheduledTime: slot(daysAgo, time),
      ...(status === 'taken' ? { takenTime: at(daysAgo, h, m + 5).toISOString() } : {}),
      status,
    });
  };
  const [levo, lisi, sert, metf, ibu, vitd, iron, long] = schedules;
  for (let d = 120; d >= 1; d--) {
    if (rnd() < 0.95) dose(levo, d, '07:00');
    if (d > 3) for (const t of lisi.scheduleTimes) if (rnd() < 0.7) dose(lisi, d, t);
    if (d < 10 || d > 14) {
      if (rnd() < 0.9) dose(sert, d, '08:00');
      else if (rnd() < 0.5) dose(sert, d, '08:00', 'skipped');
    }
    if (d >= 10 && rnd() < 0.8) dose(metf, d, '08:00');
    if (d <= 40) for (const t of long.scheduleTimes) if (rnd() < 0.6) dose(long, d, t);
  }
  for (const d of [1, 2, 3, 4, 5]) dose(vitd, d, '08:00');
  dose(vitd, 6, '08:00');
  dose(levo, 0, '07:00');
  void iron;
  for (const d of [2, 9, 23]) {
    const when = at(d, 21, 30).toISOString();
    doses.push({
      id: `d${id++}`,
      scheduleId: ibu.id,
      medicationName: 'Ibuprofen',
      scheduledTime: when,
      takenTime: when,
      status: 'taken',
    });
  }
  return { symptoms, factors, schedules, doses };
}
