// lib/report/pdf.ts
// Clinician report. Generated entirely in the browser; nothing is uploaded.
//
// The overview, symptom table, chart, medications and entries cover the chosen period. Possible
// triggers and other patterns use the same data as the Insights screen, so the person and their
// clinician see the same findings, and each says which dates it is based on.
import type { Factor, MedicationAdherence, MedicationSchedule, Symptom } from '@/lib/db/schema';
import { findTriggers } from '@/lib/analysis/triggers';
import { dailySeries, getPatterns, summarizeSymptoms, type PatternInsight } from '@/lib/analysis/patterns';
import { dosesAsFactors } from '@/lib/medication/doses';
import { CATEGORY_LABELS } from '@/lib/catalog';
import { formatDuration, severityLabel } from '@/lib/utils';
import { createPrinter, REPLACEMENT } from './printable';
import { doseSummary, fmtClock, fmtDate, fmtDay, fmtDayTime, fmtRange, methodNote, triggerText } from './text';

export interface ReportInput {
  symptoms: Symptom[];
  factors: Factor[];
  schedules: MedicationSchedule[];
  doses: MedicationAdherence[];
  days: number;
  patientName?: string;
  now?: Date;
}

export interface Report {
  blob: Blob;
  /** True when some characters, such as emoji, could not be printed and show as a replacement mark. */
  replacedCharacters: boolean;
}

/**
 * Everything the report loads on demand. preloadReportLibs loads the same list, so once the app has
 * been open online the service worker has all of it and reports also work offline.
 */
const loadReportLibs = () => Promise.all([import('jspdf'), import('jspdf-autotable'), import('./noto-sans')]);

/** Loads the report libraries and fonts without making a report, so the service worker caches them for offline use. */
export const preloadReportLibs = () => loadReportLibs();

/** How far back trigger finding looks. The Insights screen uses the same default. */
const TRIGGER_LOOKBACK_DAYS = 180;
/** Days back from today, today included, that the weekday and together patterns use (see patterns.ts). */
const PATTERN_DAYS = 60;
/** Days back from today, today included, that the trend patterns compare (see patterns.ts). */
const TREND_DAYS = 28;
/** At most this many entries are listed. */
const MAX_LOG_ROWS = 400;

type RGB = [number, number, number];
const INK: RGB = [15, 28, 42];
const MUTED: RGB = [90, 104, 118];
const ACCENT: RGB = [14, 116, 144];
const LINE: RGB = [220, 226, 232];
const SEV: RGB[] = [
  [61, 154, 139],
  [211, 155, 29],
  [224, 108, 43],
  [196, 48, 43],
];
const sevRGB = (v: number): RGB => (v <= 3 ? SEV[0] : v <= 6 ? SEV[1] : v <= 8 ? SEV[2] : SEV[3]);

const FONT = 'NotoSans';
const key = (name: string) => name.trim().toLowerCase();
const categoryLabel = (c: Factor['category']) => (CATEGORY_LABELS[c] ?? CATEGORY_LABELS.other).toLowerCase();

export async function buildReport(input: ReportInput): Promise<Report> {
  const [{ default: jsPDF }, { default: autoTable }, fonts] = await loadReportLibs();
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (input.days - 1));
  const fromMs = from.getTime();
  const daysBack = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1)).getTime();
  const at = (r: { timestamp: string }) => Date.parse(r.timestamp);
  const inPeriod = <T extends { timestamp: string }>(rows: T[]) => rows.filter(r => at(r) >= fromMs && at(r) <= nowMs);
  const upToNow = <T extends { timestamp: string }>(rows: T[]) => rows.filter(r => at(r) <= nowMs);

  // Every piece of text from the person's data goes through print() before it is drawn. Content is
  // worked out first, so the note about replaced characters near the top is known before drawing.
  const printer = createPrinter(fonts.COVERAGE);
  const print = (text: string) => printer.print(text);

  const symptoms = inPeriod(input.symptoms);
  const factors = inPeriod(input.factors);
  const doseFactors = dosesAsFactors(input.doses);

  /** "Based on logs from Jun 1 to Nov 12, 2026." for the logs at or after `start`, or null without any. */
  const basedOn = (times: number[], start = -Infinity) => {
    let first = Infinity;
    let last = -Infinity;
    for (const t of times) {
      if (!(t >= start && t <= nowMs)) continue;
      first = Math.min(first, t);
      last = Math.max(last, t);
    }
    return first <= last ? `Based on logs from ${fmtRange(new Date(first), new Date(last))}.` : null;
  };
  const logTimes = [...input.symptoms, ...input.factors].map(at);
  /**
   * Said under a finding or pattern about something last logged before the period, such as a food the
   * person has since stopped, so it is not read as current. Null when it was logged in the period.
   */
  const lastLoggedNote = (name: string, last: number) =>
    Number.isFinite(last) && last < fromMs
      ? print(`${name} was last logged on ${fmtDate(new Date(last))}, before this report’s period.`)
      : null;

  // Overview
  const activeDays = new Set([...symptoms, ...factors].map(r => new Date(r.timestamp).toDateString())).size;
  const symptomDays = new Set(symptoms.map(s => new Date(s.timestamp).toDateString())).size;

  // Symptoms
  const summaryRows = summarizeSymptoms(symptoms).map(s => {
    const durations = symptoms
      .filter(x => key(x.name) === key(s.name) && x.duration_minutes)
      .map(x => x.duration_minutes as number)
      .sort((a, b) => a - b);
    const median = durations.length ? durations[Math.floor(durations.length / 2)] : undefined;
    return [
      print(s.name),
      String(s.days),
      String(s.count),
      severityLabel(s.typicalSeverity),
      severityLabel(s.maxSeverity),
      formatDuration(median) ?? 'Not recorded',
    ];
  });

  // Possible triggers, from the same data as the Insights screen. Doses are tested as possible side
  // effects, but a day with only a ticked dose does not count as tracked.
  const triggers = findTriggers(input.symptoms, input.factors, {
    now,
    lookbackDays: TRIGGER_LOOKBACK_DAYS,
    exposureOnly: doseFactors,
  });
  const triggerBasis = basedOn(logTimes, nowMs - TRIGGER_LOOKBACK_DAYS * 86_400_000);
  const words = triggerText(triggers);
  const triggerRows = triggers.findings.map(f => [
    print(`${f.factor} (${categoryLabel(f.category)})`),
    print(f.symptom),
    f.window.label,
    `${f.exposuresFollowed} of ${f.exposures} times (${Math.round((f.exposuresFollowed / f.exposures) * 100)}%)`,
    `${Math.round(f.baselineChance * 100)}%`,
    f.strength === 'strong' ? 'Strong' : f.strength === 'moderate' ? 'Moderate' : 'Weak',
  ]);
  // A finding can come from before the period, such as a food the person has since stopped. Say so.
  const lastLogged = (rows: { name: string; timestamp: string }[], name: string) => {
    let last = -Infinity;
    for (const r of rows) if (key(r.name) === key(name) && at(r) <= nowMs) last = Math.max(last, at(r));
    return last;
  };
  const beforePeriod: string[] = [];
  const noted = new Set<string>();
  for (const f of triggers.findings) {
    for (const [name, last] of [
      [f.factor, lastLogged([...input.factors, ...doseFactors], f.factor)],
      [f.symptom, lastLogged(input.symptoms, f.symptom)],
    ] as const) {
      const note = noted.has(key(name)) ? null : lastLoggedNote(name, last);
      if (!note) continue;
      noted.add(key(name));
      beforePeriod.push(note);
    }
  }
  const triggerLead = words.lead && print(words.lead);
  const triggerChecked = words.checked.map(print);
  const triggerNotChecked = words.notChecked.map(print);

  // Other patterns, from the same data as the Insights screen. Each kind looks at its own days. Time of
  // day looks at every log of its symptom, weekday and together at the last 60 days, trend at the last
  // 4 weeks.
  const patternSymptoms = upToNow(input.symptoms);
  const sixtyDays = daysBack(PATTERN_DAYS);
  // getPatterns groups symptoms by their lowercased name, and a card's id is made from those names.
  const symptomKeys = [...new Set(patternSymptoms.map(s => s.name.toLowerCase()))];
  const logsOf = (k: string, start = -Infinity) =>
    patternSymptoms.filter(s => s.name.toLowerCase() === k && at(s) >= start);
  /** The logs of each symptom a time of day or together card is about, as that card counts them. */
  const cardSymptoms = (p: PatternInsight): Symptom[][] => {
    if (p.kind === 'time-of-day') return symptomKeys.filter(k => p.id === `tod-${k}`).map(k => logsOf(k));
    if (p.kind === 'together') {
      for (const a of symptomKeys) {
        for (const b of symptomKeys) {
          if (p.id === `together-${a}-${b}`) return [logsOf(a, sixtyDays), logsOf(b, sixtyDays)];
        }
      }
    }
    return [];
  };
  const patterns = getPatterns(patternSymptoms, upToNow(input.factors), now).map(p => {
    const about = cardSymptoms(p);
    const basis =
      p.kind === 'time-of-day'
        ? basedOn((about[0] ?? patternSymptoms).map(at))
        : basedOn(logTimes, daysBack(p.kind === 'trend' ? TREND_DAYS : PATTERN_DAYS));
    // A symptom that has stopped, such as bloating after an elimination diet, is not read as current.
    const notes = about.flatMap(logs => {
      const note = logs.length ? lastLoggedNote(logs[0].name, Math.max(...logs.map(at))) : null;
      return note ? [note] : [];
    });
    return { title: print(p.title), detail: print(p.detail), basis, notes };
  });

  // Medications, for the period. The longest period adherence covers is 90 days.
  const medDays = Math.min(input.days, 90);
  const medFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (medDays - 1));
  const medRows = input.schedules.map(m => [
    print(m.medicationName),
    print(m.dosage || ''),
    m.frequency === 'as-needed' ? 'As needed' : m.scheduleTimes.map(fmtClock).join(', '),
    doseSummary(m, input.doses, medDays, medFrom, now),
  ]);

  // Entries, newest first. Only the rows that are listed are printed.
  const log = [
    ...symptoms.map(s => ({
      t: at(s),
      row: () => [
        fmtDayTime(new Date(s.timestamp)),
        print(s.name),
        severityLabel(s.severity),
        formatDuration(s.duration_minutes, s.ongoing) ?? '',
        print(s.notes ?? ''),
      ],
    })),
    ...factors.map(f => ({
      t: at(f),
      row: () => [
        fmtDayTime(new Date(f.timestamp)),
        print(`${f.name} (${categoryLabel(f.category)})`),
        '',
        '',
        print(f.notes ?? ''),
      ],
    })),
  ].sort((a, b) => b.t - a.t);
  const logRows = log.slice(0, MAX_LOG_ROWS).map(l => l.row());
  const patientName = input.patientName ? print(input.patientName) : null;

  // Drawing
  // Compressed, because text in an embedded font takes four times the room of plain text.
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.addFileToVFS('NotoSans-Regular.ttf', fonts.NOTO_SANS_REGULAR);
  doc.addFont('NotoSans-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', fonts.NOTO_SANS_BOLD);
  doc.addFont('NotoSans-Bold.ttf', FONT, 'bold');
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const width = W - 2 * M;
  let y = M;

  const ensure = (space: number) => {
    if (y + space > H - 60) {
      doc.addPage();
      y = M;
    }
  };
  /** A section heading. `keep` is the room the start of the section needs, so a heading never ends a page. */
  const heading = (text: string, keep = 60) => {
    ensure(34 + keep);
    y += 10;
    doc
      .setFont(FONT, 'bold')
      .setFontSize(13)
      .setTextColor(...INK)
      .text(text, M, y);
    y += 8;
    doc
      .setDrawColor(...LINE)
      .setLineWidth(0.75)
      .line(M, y, W - M, y);
    y += 16;
  };
  /** The lines of a paragraph wrapped to the page, with the font set for drawing them. */
  const wrap = (text: string, { size = 10, bold = false, indent = 0 } = {}) => {
    doc.setFont(FONT, bold ? 'bold' : 'normal').setFontSize(size);
    return doc.splitTextToSize(print(text), width - indent) as string[];
  };
  /** A paragraph, wrapped to the page. `indent` moves it right, and `bullet` puts a dot before its first line. */
  const para = (text: string, { size = 10, color = INK, bold = false, indent = 0, bullet = false, after = 0 } = {}) => {
    const lines = wrap(text, { size, bold, indent });
    doc.setTextColor(...color);
    // A short paragraph stays on one page.
    if (lines.length <= 8) ensure(lines.length * (size + 4));
    lines.forEach((line, i) => {
      ensure(size + 4);
      if (bullet && i === 0) doc.text('•', M + indent - 9, y);
      doc.text(line, M + indent, y);
      y += size + 4;
    });
    y += after;
  };
  const tableDefaults = {
    margin: { left: M, right: M, bottom: 60 },
    styles: {
      font: FONT,
      fontSize: 9,
      cellPadding: 5,
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.5,
      overflow: 'linebreak' as const,
    },
    headStyles: { fillColor: [238, 242, 245] as RGB, textColor: INK, fontStyle: 'bold' as const },
    theme: 'grid' as const,
  };
  /**
   * A table where every column but `auto` has a fixed width. The one free column takes the rest, so a
   * long word in one cell can never squeeze another column down to a letter per line.
   */
  const table = (head: string[], body: string[][], widths: (number | 'auto')[]) => {
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [head],
      body: body.map(row => row.map(print)),
      columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }])),
    });
    afterTable();
  };
  const afterTable = () => {
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 18;
  };

  // Title block
  doc.setFillColor(...ACCENT).rect(0, 0, W, 6, 'F');
  doc
    .setFont(FONT, 'bold')
    .setFontSize(20)
    .setTextColor(...INK)
    .text('Symptom summary', M, y + 10);
  y += 30;
  const meta = [
    patientName ? `Patient: ${patientName}` : null,
    `Period: ${fmtRange(from, now)} (${input.days} days)`,
    `Prepared: ${fmtDate(now)}`,
  ].filter((line): line is string => line !== null);
  meta.forEach(line => para(line, { color: MUTED }));
  y += 4;
  para(
    `Recorded by the patient in the myHealthyAgent app. Severity is self-rated (mild, moderate, severe, very severe). Possible triggers are statistical associations in this person’s own logs, not diagnoses.${
      printer.replaced ? ` Characters that could not be printed, such as emoji, show as ${REPLACEMENT}.` : ''
    }`,
    { size: 9, color: MUTED },
  );

  // Overview
  heading('Overview');
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    theme: 'plain',
    styles: { ...tableDefaults.styles, lineWidth: 0, cellPadding: 3, fontSize: 10 },
    body: [
      ['Days with any log', `${activeDays} of ${input.days}`],
      ['Days with symptoms', `${symptomDays}`],
      ['Symptom entries', `${symptoms.length}`],
      ['Food, drink and activity entries', `${factors.length}`],
    ],
    columnStyles: { 0: { textColor: MUTED, cellWidth: 200 } },
  });
  afterTable();

  // Symptoms
  heading('Symptoms', 70);
  if (!summaryRows.length) {
    para('No symptoms were logged in this period.');
  } else {
    table(['Symptom', 'Days', 'Entries', 'Typical severity', 'Worst', 'Typical duration'], summaryRows, [
      'auto',
      44,
      52,
      76,
      70,
      76,
    ]);

    // Daily chart
    const series = dailySeries(symptoms, input.days, now);
    const label = (date: string) => {
      const [yy, mm, dd] = date.split('-').map(Number);
      return fmtDay(new Date(yy, mm - 1, dd));
    };
    ensure(140);
    doc
      .setFont(FONT, 'bold')
      .setFontSize(10)
      .setTextColor(...INK)
      .text('Worst severity each day', M, y);
    y += 10;
    const chartH = 80;
    const barW = width / series.length;
    doc
      .setDrawColor(...LINE)
      .setLineWidth(0.5)
      .line(M, y + chartH, W - M, y + chartH);
    series.forEach((d, i) => {
      if (!d.maxSeverity) return;
      const h = (d.maxSeverity / 10) * chartH;
      doc
        .setFillColor(...sevRGB(d.maxSeverity))
        .rect(M + i * barW + barW * 0.15, y + chartH - h, Math.max(1, barW * 0.7), h, 'F');
    });
    y += chartH + 12;
    doc
      .setFont(FONT, 'normal')
      .setFontSize(8)
      .setTextColor(...MUTED);
    doc.text(label(series[0].date), M, y);
    doc.text(label(series[series.length - 1].date), W - M, y, { align: 'right' });
    y += 10;
    let lx = M;
    ['Mild', 'Moderate', 'Severe', 'Very severe'].forEach((name, i) => {
      doc.setFillColor(...SEV[i]).rect(lx, y - 6, 8, 8, 'F');
      doc.text(name, lx + 12, y + 1);
      lx += doc.getTextWidth(name) + 28;
    });
    y += 16;
  }

  // Triggers
  heading('Possible triggers', 100);
  if (triggerBasis) para(triggerBasis, { size: 9, color: MUTED, after: 4 });
  if (triggerLead) para(triggerLead, { after: 2 });
  if (triggerRows.length) {
    table(['Logged item', 'Symptom', 'Delay', 'Followed by symptom', 'Same hours, other days', 'Signal'], triggerRows, [
      'auto',
      96,
      76,
      90,
      72,
      62,
    ]);
    y -= 2;
  }
  for (const line of beforePeriod) para(line, { size: 9 });
  for (const line of triggerChecked) para(line, { size: triggerRows.length ? 9 : 10 });
  if (triggerNotChecked.length) {
    y += 4;
    para('Not checked, so not ruled out', { size: 9, bold: true });
    for (const line of triggerNotChecked) para(line, { size: 9, indent: 10, bullet: true });
  }
  // The method explains the table or the negative result. "Not enough logging yet" has neither, even
  // when a few comparisons were made.
  if (triggerRows.length || triggerChecked.length) {
    y += 4;
    para(methodNote(triggers.testsRun), { size: 8, color: MUTED });
  }

  if (patterns.length) {
    const cards = patterns.map(p => {
      const parts: { text: string; size?: number; color?: RGB; bold?: boolean }[] = [
        { text: p.title, bold: true },
        { text: p.detail },
        ...(p.basis ? [{ text: p.basis, size: 9, color: MUTED }] : []),
        ...p.notes.map(text => ({ text, size: 9 })),
      ];
      return {
        parts,
        height: parts.reduce((h, part) => h + wrap(part.text, part).length * ((part.size ?? 10) + 4), 0),
      };
    });
    heading('Other patterns', cards[0].height);
    for (const { parts, height } of cards) {
      // A card stays on one page, so its dates and notes are never cut off from it.
      ensure(height);
      for (const { text, ...style } of parts) para(text, style);
      y += 6;
    }
  }

  // Medications
  if (medRows.length) {
    heading('Medications', 70);
    table(['Medication', 'Dose', 'Schedule', `Doses taken (last ${medDays} days)`], medRows, ['auto', 96, 104, 156]);
  }

  // Log
  heading('Entries', 70);
  if (!log.length) {
    para('No entries in this period.');
  } else {
    table(['When', 'Entry', 'Severity', 'Duration', 'Note'], logRows, [92, 130, 64, 58, 'auto']);
    if (log.length > MAX_LOG_ROWS) {
      para(`Showing the ${MAX_LOG_ROWS} most recent of ${log.length} entries.`, { size: 9, color: MUTED });
    }
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc
      .setFont(FONT, 'normal')
      .setFontSize(8)
      .setTextColor(...MUTED);
    doc.text('Patient-recorded data from myHealthyAgent. Not a medical record or diagnosis.', M, H - 28);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 28, { align: 'right' });
  }

  return { blob: doc.output('blob'), replacedCharacters: printer.replaced };
}
