// lib/report/pdf.ts
// Clinician report. Generated entirely in the browser; nothing is uploaded.
import type { Factor, MedicationAdherence, MedicationSchedule, Symptom } from '@/lib/db/schema';
import { findTriggers } from '@/lib/analysis/triggers';
import { dailySeries, getPatterns, summarizeSymptoms } from '@/lib/analysis/patterns';
import { adherenceFor, dosesAsFactors } from '@/lib/medication/doses';
import { CATEGORY_LABELS } from '@/lib/catalog';
import { formatDuration, severityLabel } from '@/lib/utils';

export interface ReportInput {
  symptoms: Symptom[];
  factors: Factor[];
  schedules: MedicationSchedule[];
  doses: MedicationAdherence[];
  days: number;
  patientName?: string;
  now?: Date;
}

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

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export async function buildReport(input: ReportInput): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const now = input.now ?? new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (input.days - 1));
  const inPeriod = <T extends { timestamp: string }>(rows: T[]) =>
    rows.filter(r => {
      const t = Date.parse(r.timestamp);
      return t >= from.getTime() && t <= now.getTime();
    });

  const symptoms = inPeriod(input.symptoms);
  const factors = inPeriod(input.factors);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;

  const ensure = (space: number) => {
    if (y + space > H - 60) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (text: string) => {
    ensure(40);
    y += 10;
    doc
      .setFont('helvetica', 'bold')
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
  const para = (text: string, size = 10, color: RGB = INK) => {
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(size)
      .setTextColor(...color);
    const lines = doc.splitTextToSize(text, W - 2 * M) as string[];
    for (const line of lines) {
      ensure(size + 4);
      doc.text(line, M, y);
      y += size + 4;
    }
  };
  const tableDefaults = {
    margin: { left: M, right: M, bottom: 60 },
    styles: {
      font: 'helvetica',
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
  const afterTable = () => {
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 18;
  };

  // Title block
  doc.setFillColor(...ACCENT).rect(0, 0, W, 6, 'F');
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(20)
    .setTextColor(...INK)
    .text('Symptom summary', M, y + 10);
  y += 30;
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(10)
    .setTextColor(...MUTED);
  const meta = [
    input.patientName ? `Patient: ${input.patientName}` : null,
    `Period: ${fmtDate(from)} to ${fmtDate(now)} (${input.days} days)`,
    `Prepared: ${fmtDate(now)}`,
  ].filter(Boolean) as string[];
  meta.forEach(line => {
    doc.text(line, M, y);
    y += 14;
  });
  y += 4;
  para(
    'Recorded by the patient in the myHealthyAgent app. Severity is self-rated (mild, moderate, severe, very severe). Possible triggers are statistical associations in this person’s own logs, not diagnoses.',
    9,
    MUTED,
  );

  // Overview
  const activeDays = new Set([...symptoms, ...factors].map(r => new Date(r.timestamp).toDateString())).size;
  const symptomDays = new Set(symptoms.map(s => new Date(s.timestamp).toDateString())).size;
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
  heading('Symptoms');
  const summary = summarizeSymptoms(symptoms);
  if (!summary.length) {
    para('No symptoms were logged in this period.');
  } else {
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [['Symptom', 'Days', 'Entries', 'Typical severity', 'Worst', 'Typical duration']],
      body: summary.map(s => {
        const durations = symptoms
          .filter(x => x.name.toLowerCase() === s.name.toLowerCase() && x.duration_minutes)
          .map(x => x.duration_minutes as number)
          .sort((a, b) => a - b);
        const median = durations.length ? durations[Math.floor(durations.length / 2)] : undefined;
        return [
          s.name,
          String(s.days),
          String(s.count),
          severityLabel(s.avgSeverity),
          severityLabel(s.maxSeverity),
          formatDuration(median) ?? 'Not recorded',
        ];
      }),
    });
    afterTable();

    // Daily chart
    const series = dailySeries(symptoms, input.days, now);
    ensure(140);
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(10)
      .setTextColor(...INK)
      .text('Worst severity each day', M, y);
    y += 10;
    const chartH = 80;
    const chartW = W - 2 * M;
    const barW = chartW / series.length;
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
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(...MUTED);
    doc.text(series[0].label, M, y);
    doc.text(series[series.length - 1].label, W - M, y, { align: 'right' });
    y += 10;
    let lx = M;
    ['Mild', 'Moderate', 'Severe', 'Very severe'].forEach((label, i) => {
      doc.setFillColor(...SEV[i]).rect(lx, y - 6, 8, 8, 'F');
      doc.text(label, lx + 12, y + 1);
      lx += doc.getTextWidth(label) + 28;
    });
    y += 16;
  }

  // Triggers
  heading('Possible triggers');
  const triggers = findTriggers(input.symptoms, [...input.factors, ...dosesAsFactors(input.doses)], { now });
  if (!triggers.findings.length) {
    para(
      triggers.trackedDays < 14
        ? 'Not enough logging yet to look for triggers (about two weeks of symptoms plus food, drink and activity logs are needed).'
        : 'No logged food, drink, activity or medication was followed by a clear rise in any symptom.',
    );
  } else {
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [['Logged item', 'Symptom', 'Delay', 'Followed by symptom', 'Same hours, other days', 'Signal']],
      body: triggers.findings.map(f => [
        `${f.factor} (${CATEGORY_LABELS[f.category].toLowerCase()})`,
        f.symptom,
        f.window.label,
        `${f.exposuresFollowed} of ${f.exposures} times (${Math.round((f.exposuresFollowed / f.exposures) * 100)}%)`,
        `${Math.round(f.baselineChance * 100)}%`,
        f.strength === 'strong' ? 'Strong' : f.strength === 'moderate' ? 'Moderate' : 'Weak',
      ]),
    });
    afterTable();
    para(
      `Method: symptom start times in each delay window after a logged item were compared with the same hours of the day when the item was not logged (exact test stratified by hour of day), with Benjamini–Hochberg correction across ${triggers.testsRun} comparisons. "Same hours, other days" is how often the symptom appeared in the matching window on nearby days without the item. Medications taken for a symptom will naturally appear linked to it.`,
      8,
      MUTED,
    );
  }

  const patterns = getPatterns(input.symptoms, input.factors, now);
  if (patterns.length) {
    heading('Other patterns');
    patterns.forEach(p => para(`${p.title}. ${p.detail}`));
  }

  // Medications
  const meds = input.schedules;
  if (meds.length) {
    heading('Medications');
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [['Medication', 'Dose', 'Schedule', `Doses taken (last ${Math.min(input.days, 90)} days)`]],
      body: meds.map(m => {
        const a = adherenceFor(m, input.doses, Math.min(input.days, 90), now);
        const asNeeded = input.doses.filter(
          d => d.scheduleId === m.id && d.status === 'taken' && Date.parse(d.takenTime ?? '') >= from.getTime(),
        ).length;
        return [
          m.medicationName + (m.isActive ? '' : ' (paused)'),
          m.dosage || '',
          m.frequency === 'as-needed' ? 'As needed' : m.scheduleTimes.join(', '),
          m.frequency === 'as-needed'
            ? `${asNeeded} doses logged`
            : !m.isActive
              ? 'Paused'
              : a.percent == null
                ? 'No doses due yet'
                : `${a.taken} of ${a.expected} (${a.percent}%)`,
        ];
      }),
    });
    afterTable();
  }

  // Log
  heading('Entries');
  const log = [
    ...symptoms.map(s => ({
      t: s.timestamp,
      row: [
        fmtDateTime(s.timestamp),
        s.name,
        severityLabel(s.severity),
        formatDuration(s.duration_minutes, s.ongoing) ?? '',
        s.notes ?? '',
      ],
    })),
    ...factors.map(f => ({
      t: f.timestamp,
      row: [
        fmtDateTime(f.timestamp),
        `${f.name} (${CATEGORY_LABELS[f.category].toLowerCase()})`,
        '',
        '',
        f.notes ?? '',
      ],
    })),
  ].sort((a, b) => b.t.localeCompare(a.t));
  if (!log.length) {
    para('No entries in this period.');
  } else {
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [['When', 'Entry', 'Severity', 'Duration', 'Note']],
      body: log.slice(0, 400).map(l => l.row),
      columnStyles: { 0: { cellWidth: 90 }, 2: { cellWidth: 68 }, 3: { cellWidth: 60 } },
    });
    afterTable();
    if (log.length > 400) para(`Showing the 400 most recent of ${log.length} entries.`, 9, MUTED);
  }

  // Footer on every page
  const pages = doc.internal.pages.length - 1;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(...MUTED);
    doc.text('Patient-recorded data from myHealthyAgent. Not a medical record or diagnosis.', M, H - 28);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 28, { align: 'right' });
  }

  return doc.output('blob');
}

/** Loads the PDF libraries without making a report, so the service worker can cache them for offline use. */
export const preloadReportLibs = () => Promise.all([import('jspdf'), import('jspdf-autotable')]);
