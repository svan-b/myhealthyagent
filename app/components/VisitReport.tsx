// app/c// app/components/VisitReport.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import { db } from '@/lib/db/client';
import { calculateTrend, getTopSymptoms, detectPatterns } from '@/lib/report/insights';
import { evaluateTimingHints, type TimingHint } from '@/lib/rules/timing-rules';
import { toast } from 'sonner';
import { subDays, format, addHours } from 'date-fns';
import jsPDF from 'jspdf';
import type { Symptom, MedLog, MedicationSchedule } from '@/lib/db/schema';
import { detectMedicationPatterns } from '@/lib/report/insights';
import { calculateAdherence } from '@/lib/medication/adherence';

export function VisitReport() {
  const [generating, setGenerating] = useState(false);

  const generatePDF = async () => {
    setGenerating(true);
    const startTime = Date.now();
    try {
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 30);
      
      // Fetch data (local-first, no cloud)
      const allSymptoms: Symptom[] = await db.getAllSymptoms();
      const symptoms = allSymptoms.filter(s => new Date(s.timestamp) >= thirtyDaysAgo);
      const meds: MedLog[] = await db.getMedsInRange(thirtyDaysAgo, now);
      
      // Fetch medication schedules and adherence
      const schedules = await db.getMedicationSchedules();
      const medicationPatterns = await detectMedicationPatterns(30);
      
      // Calculate adherence for each active schedule
      const adherenceMetrics = [];
      for (const schedule of schedules) {
        const adherenceRecords = await db.getAdherenceBySchedule(schedule.id, 30);
        if (adherenceRecords.length > 0) {
          const metrics = calculateAdherence(schedule, adherenceRecords, 30);
          adherenceMetrics.push({
            schedule,
            metrics
          });
        }
      }
      
      // Get recent tags from last 4 hours for timing evaluation
      const fourHoursAgo = addHours(now, -4);
      const recentTagSet = new Set<string>();
      symptoms
        .filter(s => new Date(s.timestamp) >= fourHoursAgo)
        .forEach(s => (s.tags || []).forEach(tag => recentTagSet.add(String(tag))));
      const recentTags = Array.from(recentTagSet);
      
      // Generate insights
      const trend = calculateTrend(symptoms, { days: 30, now });
      const topSymptoms = getTopSymptoms(symptoms, 5);
      const patterns = detectPatterns(symptoms, { now });
      
      // Get unique medications (most recent occurrence of each)
      const medsByName = new Map<string, MedLog>();
      meds
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .forEach(m => {
          if (!medsByName.has(m.name)) medsByName.set(m.name, m);
        });
      const uniqueMeds = Array.from(medsByName.values()).slice(0, 5);
      
      // Evaluate timing hints for recent meds
      const hintPool: TimingHint[] = [];
      const medsForHints = uniqueMeds.slice(0, 2); // Top 2 recent meds
      for (const med of medsForHints) {
        const hints = evaluateTimingHints(
          {
            recentSymptoms: symptoms,
            recentMeds: meds,
            currentTags: recentTags,
            currentMed: med.name,
            now,
          },
          2 // max 2 hints per med
        );
        hintPool.push(...hints);
      }
      
      // De-duplicate timing hints by ruleId, keep highest confidence
      const order = { High: 3, Medium: 2, Low: 1 } as const;
      const uniqueHints = new Map<string, TimingHint>();
      for (const hint of hintPool) {
        const key = hint.meta?.ruleId ?? hint.title;
        const existing = uniqueHints.get(key);
        if (!existing || order[hint.confidence] > order[existing.confidence]) {
          uniqueHints.set(key, hint);
        }
      }
      const timingHints = Array.from(uniqueHints.values())
        .sort((a, b) => order[b.confidence] - order[a.confidence])
        .slice(0, 2);
      
      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      let y = margin;

      // Color scheme
      const brandBlue = { r: 59, g: 130, b: 246 }; // Tailwind blue-500
      const getConfidenceColor = (c: 'High' | 'Medium' | 'Low'): [number, number, number] =>
        c === 'High' ? [0, 150, 0] : c === 'Medium' ? [200, 150, 0] : [150, 150, 150];

      // Helper: ensure space on page or add new page
      const ensureSpace = (needed = 12) => {
        if (y + needed > pageHeight - margin - 12) {
          pdf.addPage();
          y = margin;
          addFooter(); // Add footer on every page
        }
      };

      // Helper: add footer with disclaimer
      const addFooter = () => {
        pdf.setFontSize(8);
        pdf.setTextColor(100);
        const disclaimer = 'Informational only. "Commonly reported" language. Confirm observations with a clinician/pharmacist.';
        pdf.text(disclaimer, pageWidth / 2, pageHeight - 10, { align: 'center' });
        pdf.setTextColor(0);
      };

      // === HEADER ===
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('myHealthyAgent — Visit Report', margin, y);
      y += 8;

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100);
      pdf.text(`Generated: ${format(now, 'PPP')}`, margin, y);
      pdf.text(`Period: ${format(thirtyDaysAgo, 'MMM d')} – ${format(now, 'MMM d, yyyy')}`, margin, y + 5);
      pdf.text(`Ruleset: v0.1.0 • App: MVP`, pageWidth - margin, y + 5, { align: 'right' });
      pdf.setTextColor(0);
      y += 15;

      // === 30-DAY SEVERITY TREND ===
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('30-Day Severity Trend', margin, y);
      y += 6;

      if (trend.length > 0) {
        ensureSpace(28);
        const sparkWidth = pageWidth - margin * 2;
        const sparkHeight = 20;
        const nonZeroValues = trend.map(t => t.avgSeverity).filter(v => v > 0);
        const maxSeverity = Math.max(1, ...nonZeroValues);
        const xStep = sparkWidth / Math.max(1, trend.length - 1);

        // Draw baseline
        pdf.setDrawColor(220);
        pdf.line(margin, y + sparkHeight, margin + sparkWidth, y + sparkHeight);

        // Draw sparkline
        pdf.setDrawColor(brandBlue.r, brandBlue.g, brandBlue.b);
        pdf.setLineWidth(0.5);
        for (let i = 0; i < trend.length - 1; i++) {
          const x1 = margin + i * xStep;
          const x2 = margin + (i + 1) * xStep;
          const y1 = y + sparkHeight - (trend[i].avgSeverity / maxSeverity) * sparkHeight;
          const y2 = y + sparkHeight - (trend[i + 1].avgSeverity / maxSeverity) * sparkHeight;
          pdf.line(x1, y1, x2, y2);
        }

        // Summary statistics
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(100);
        const avgOnLoggedDays = nonZeroValues.length > 0
          ? nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length
          : 0;
        const loggedDays = trend.filter(t => t.avgSeverity > 0).length;
        pdf.text(
          `Average on logged days: ${avgOnLoggedDays.toFixed(1)}/10 • Logged days: ${loggedDays}/30`,
          margin,
          y + sparkHeight + 6
        );
        pdf.setTextColor(0);
        y += sparkHeight + 12;
      } else {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.text('No symptom data for this period.', margin, y + 5);
        y += 12;
      }

      // === TOP SYMPTOMS ===
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Most Frequent Symptoms', margin, y);
      y += 6;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      if (topSymptoms.length > 0) {
        ensureSpace(18);
        topSymptoms.slice(0, 3).forEach((symptom, i) => {
          pdf.text(
            `${i + 1}. ${symptom.name}: ${symptom.count}× (avg ${symptom.avgSeverity.toFixed(1)}/10)`,
            margin + 2,
            y + i * 5 + 3
          );
        });
        y += 3 * 5 + 5;
      } else {
        pdf.text('No frequent symptoms yet.', margin + 2, y + 3);
        y += 10;
      }

      // === PATTERN OBSERVATIONS ===
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Pattern Observations', margin, y);
      y += 6;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      patterns.forEach((pattern) => {
        ensureSpace(10);
        const color = getConfidenceColor(pattern.confidence);
        pdf.setTextColor(...color);
        pdf.text(`[${pattern.confidence}]`, margin + 2, y + 3);
        pdf.setTextColor(0);
        const lines = pdf.splitTextToSize(pattern.text, pageWidth - margin * 2 - 22);
        lines.forEach((line: string, j: number) => {
          pdf.text(line, margin + 22, y + 3 + j * 4);
        });
        y += Math.max(8, lines.length * 4 + 4);
      });

      // === CURRENT MEDICATIONS ===
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      ensureSpace(12);
      pdf.text('Current Medications', margin, y);
      y += 6;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      if (uniqueMeds.length > 0) {
        uniqueMeds.forEach((med) => {
          ensureSpace(6);
          const label = `• ${med.name}${med.dose ? ` (${med.dose})` : ''}`;
          const lines = pdf.splitTextToSize(label, pageWidth - margin * 2 - 4);
          lines.forEach((line: string, j: number) => {
            pdf.text(line, margin + 2, y + 3 + j * 4);
          });
          y += Math.max(6, lines.length * 4 + 2);
        });
      } else {
        pdf.text('No recent medications recorded.', margin + 2, y + 3);
        y += 8;
      }

      // === MEDICATION ADHERENCE ===
      if (adherenceMetrics.length > 0) {
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        ensureSpace(12);
        pdf.text('Medication Adherence (30 days)', margin, y);
        y += 6;
        
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        adherenceMetrics.forEach((item: any) => {
          ensureSpace(12);
          const { schedule, metrics } = item;
          
          // Medication name and adherence percentage
          pdf.setFont('helvetica', 'bold');
          pdf.text(`${schedule.medicationName} - ${schedule.dosage}`, margin + 2, y + 3);
          
          // Adherence percentage with color coding
          const adherenceColor: [number, number, number] = metrics.adherencePercentage >= 80 ? [0, 150, 0] : 
                                 metrics.adherencePercentage >= 60 ? [200, 150, 0] : 
                                 [200, 0, 0];
          pdf.setTextColor(...adherenceColor);
          pdf.text(`${metrics.adherencePercentage}%`, pageWidth - margin - 20, y + 3, { align: 'right' });
          pdf.setTextColor(0);
          
          // Details
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          pdf.text(
            `Taken: ${metrics.takenDoses}/${metrics.totalDoses} • Missed: ${metrics.missedDoses} • Skipped: ${metrics.skippedDoses}`,
            margin + 4,
            y + 8
          );
          
          // Timing consistency if available
          if (metrics.timingConsistencyMinutes !== null && metrics.takenDoses >= 3) {
            const consistency = metrics.timingConsistencyMinutes <= 30 ? 'Excellent timing' :
                               metrics.timingConsistencyMinutes <= 60 ? 'Good timing' :
                               'Variable timing';
            pdf.text(
              `${consistency} (±${metrics.timingConsistencyMinutes} min)`,
              margin + 4,
              y + 12
            );
            y += 4;
          }
          
          y += 12;
        });
      }

      // === TIMING COMPATIBILITY HINTS ===
      if (timingHints.length > 0) {
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        ensureSpace(12);
        pdf.text('Timing & Compatibility Notes', margin, y);
        y += 6;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        timingHints.forEach((hint) => {
          ensureSpace(14);
          const color = getConfidenceColor(hint.confidence);
          pdf.setTextColor(...color);
          pdf.text(`[${hint.confidence}]`, margin + 2, y + 3);
          pdf.setTextColor(0);
          
          const titleLines = pdf.splitTextToSize(hint.title, pageWidth - margin * 2 - 22);
          pdf.setFont('helvetica', 'bold');
          titleLines.forEach((line: string, j: number) => {
            pdf.text(line, margin + 22, y + 3 + j * 4);
          });
          y += titleLines.length * 4 + 1;

          const msgLines = pdf.splitTextToSize(hint.message, pageWidth - margin * 2 - 22);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          msgLines.forEach((line: string, j: number) => {
            pdf.text(line, margin + 22, y + 3 + j * 3.5);
          });
          y += msgLines.length * 3.5 + 4;
        });
      }

      // === QUESTIONS FOR CLINICIAN ===
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      ensureSpace(12);
      pdf.text('Questions for Your Clinician', margin, y);
      y += 6;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const questions = [
        adherenceMetrics.some((m: any) => m.metrics.adherencePercentage < 80) 
          ? 'Should we adjust medication timing for better adherence?'
          : 'Is my current medication schedule optimal?',
        patterns.some(p => p.confidence === 'High') 
          ? 'Could the observed patterns indicate a specific trigger?'
          : 'What additional tracking might reveal patterns?',
        timingHints.length > 0 
          ? 'Should we review medication-food timing interactions?'
          : 'Are there any timing considerations I should know about?'
      ];

      questions.forEach((q, i) => {
        ensureSpace(6);
        pdf.text(`${i + 1}. ${q}`, margin + 2, y + 3);
        y += 6;
      });

      // Add footer to last page
      addFooter();

      // Save PDF
      const filename = `myHealthyAgent-Report-${format(now, 'yyyy-MM-dd')}.pdf`;
      pdf.save(filename);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      toast.success(`Report generated in ${elapsed}s`, {
        description: filename
      });
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button onClick={generatePDF} disabled={generating} className="gap-2">
      <FileText className="h-4 w-4" />
      {generating ? 'Generating...' : 'Generate Visit Report'}
    </Button>
  );
}
