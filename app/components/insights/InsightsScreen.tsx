'use client';

import * as React from 'react';
import { Lock } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui/card';
import { useHealthData } from '@/lib/hooks/useHealthData';
import { describeFinding, describeBaseline, type TriggerFinding } from '@/lib/analysis/triggers';
import { useTriggerAnalysis } from '@/lib/hooks/useTriggerAnalysis';
import { dailySeries, getPatterns, getReadiness, summarizeSymptoms, RECOMMENDED_DAYS } from '@/lib/analysis/patterns';
import { dosesAsFactors } from '@/lib/medication/doses';
import { usePro } from '@/lib/pro/client';
import { config } from '@/lib/config';
import { UpgradeCard } from '../pro/Upgrade';
import { cn, severityColor, severityLabel } from '@/lib/utils';

const STRENGTH_LABEL = {
  strong: { text: 'Strong signal', cls: 'bg-danger-soft text-danger' },
  moderate: { text: 'Moderate signal', cls: 'bg-warn-soft text-warn' },
  early: { text: 'Worth watching', cls: 'bg-surface-2 text-muted' },
} as const;

export function InsightsScreen() {
  const { symptoms, factors, doses, loading } = useHealthData();
  const { isPro, enabled: proEnabled } = usePro();

  const allFactors = React.useMemo(() => [...factors, ...dosesAsFactors(doses)], [factors, doses]);
  const triggers = useTriggerAnalysis(symptoms, allFactors);
  const analysis = React.useMemo(() => {
    return {
      readiness: getReadiness(symptoms, factors),
      patterns: getPatterns(symptoms, factors),
      series: dailySeries(symptoms, 30),
      summary: summarizeSymptoms(symptoms.filter(s => Date.parse(s.timestamp) > Date.now() - 30 * 86_400_000)),
    };
  }, [symptoms, factors]);

  if (loading || !triggers) {
    return (
      <div aria-busy="true" aria-label="Analyzing your logs">
        <h1 className="text-2xl font-bold text-fg mb-4">Insights</h1>
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-28 rounded-2xl bg-surface border border-line animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const { readiness, patterns, series, summary } = analysis;
  const shown = isPro ? triggers.findings : triggers.findings.slice(0, config.freeTriggerFindings);
  const hidden = triggers.findings.length - shown.length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-4">Insights</h1>

      <ReadinessCard readiness={readiness} />

      <SectionTitle>Possible triggers</SectionTitle>
      {shown.length === 0 ? (
        <Card className="p-5 text-[15px] text-muted">
          {readiness.stage === 'ready'
            ? 'Nothing you logged stands out yet. That is a real result: none of your logged foods or activities is clearly followed by more symptoms than usual. Keep logging and this updates automatically.'
            : 'The app compares how often each symptom starts in the hours and days after things you log against how often it starts at other times. Log symptoms and what you eat or do for a couple of weeks to see results here.'}
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map(f => (
            <FindingCard key={`${f.factor}|${f.symptom}`} f={f} />
          ))}
          {hidden > 0 && (
            <>
              <Card className="p-4 flex items-center gap-3 text-muted">
                <Lock className="size-5 shrink-0" aria-hidden />
                <span className="text-[15px]">
                  {hidden === 1 ? '1 more possible trigger was found.' : `${hidden} more possible triggers were found.`}
                </span>
              </Card>
              <UpgradeCard title="See every possible trigger" />
            </>
          )}
        </div>
      )}
      {triggers.findings.length > 0 && (
        <p className="text-[13px] text-subtle mt-3">
          These are links in your own logs, checked for chance across {triggers.testsRun} comparisons. They are not a
          diagnosis. Try removing a suspected trigger for a while and see whether the link holds, and talk it over with
          your clinician.
        </p>
      )}

      {patterns.length > 0 && (
        <>
          <SectionTitle>Patterns</SectionTitle>
          <Card className="divide-y divide-line">
            {patterns.map(p => (
              <div key={p.id} className="px-4 py-3">
                <p className="font-semibold text-fg">{p.title}</p>
                <p className="text-sm text-muted mt-0.5">{p.detail}</p>
              </div>
            ))}
          </Card>
        </>
      )}

      {symptoms.length > 0 && (
        <>
          <SectionTitle>Last 30 days</SectionTitle>
          <SeverityChart series={series} />
          {summary.length > 0 && (
            <Card className="mt-3 divide-y divide-line">
              {summary.slice(0, 8).map(s => (
                <div key={s.name} className="px-4 py-3 flex items-center gap-3">
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: severityColor(s.avgSeverity) }}
                    aria-hidden
                  />
                  <span className="font-medium text-fg truncate">{s.name}</span>
                  <span className="ml-auto text-sm text-muted text-right shrink-0">
                    {s.days} {s.days === 1 ? 'day' : 'days'}, usually {severityLabel(s.avgSeverity).toLowerCase()}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {!proEnabled
        ? null
        : !isPro &&
          triggers.findings.length <= config.freeTriggerFindings &&
          symptoms.length > 0 && (
            <div className="mt-6">
              <UpgradeCard />
            </div>
          )}
    </div>
  );
}

function ReadinessCard({ readiness }: { readiness: ReturnType<typeof getReadiness> }) {
  const pct = Math.min(100, Math.round((readiness.trackedDays / RECOMMENDED_DAYS) * 100));
  if (readiness.stage === 'ready') return null;
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <p className="font-semibold text-fg">
          {readiness.trackedDays} of {RECOMMENDED_DAYS} days tracked
        </p>
        <p className="text-sm text-subtle">
          {readiness.symptomCount} symptoms, {readiness.factorCount} other logs
        </p>
      </div>
      <div
        className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={RECOMMENDED_DAYS}
        aria-valuenow={readiness.trackedDays}
        aria-label="Days tracked"
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted mt-3">{readiness.message}</p>
    </Card>
  );
}

function FindingCard({ f }: { f: TriggerFinding }) {
  const label = STRENGTH_LABEL[f.strength];
  const pct = Math.round((f.exposuresFollowed / f.exposures) * 100);
  const base = Math.round(f.baselineChance * 100);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[17px] font-bold text-fg">
          {f.factor} and {f.symptom.toLowerCase()}
        </h3>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', label.cls)}>{label.text}</span>
      </div>
      <p className="text-[15px] text-fg mt-2">{describeFinding(f)}</p>
      <p className="text-sm text-muted mt-1">{describeBaseline(f)}</p>
      <div className="mt-4 space-y-2" aria-hidden>
        <Bar label={`After ${f.factor.toLowerCase()}`} pct={pct} strong />
        <Bar label="Other days" pct={base} />
      </div>
      {f.category === 'medication' && (
        <p className="text-[13px] text-subtle mt-3">
          If you take {f.factor} because of {f.symptom.toLowerCase()}, this link is expected and does not mean the
          medication causes it.
        </p>
      )}
    </Card>
  );
}

function Bar({ label, pct, strong }: { label: string; pct: number; strong?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-28 shrink-0 text-muted truncate">{label}</span>
      <span className="flex-1 h-2.5 rounded-full bg-surface-2 overflow-hidden">
        <span
          className={cn('block h-full rounded-full', strong ? 'bg-accent' : 'bg-line-strong')}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </span>
      <span className="w-10 text-right tabular-nums text-fg font-semibold">{pct}%</span>
    </div>
  );
}

function SeverityChart({ series }: { series: ReturnType<typeof dailySeries> }) {
  const daysWith = series.filter(d => d.count > 0).length;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-fg">Worst severity each day</p>
        <p className="text-[13px] text-subtle">{daysWith} days with symptoms</p>
      </div>
      <div
        className="flex items-end gap-[3px] h-28"
        role="img"
        aria-label={`Daily worst severity for the last 30 days. Symptoms on ${daysWith} days.`}
      >
        {series.map(d => (
          <div
            key={d.date}
            className="flex-1 h-full flex items-end"
            title={
              d.count
                ? `${d.label}: ${severityLabel(d.maxSeverity ?? 0)} (${d.count} logged)`
                : `${d.label}: none logged`
            }
          >
            <div
              className="w-full rounded-t-[3px]"
              style={{
                height: d.maxSeverity ? `${(d.maxSeverity / 10) * 100}%` : '3px',
                backgroundColor: d.maxSeverity ? severityColor(d.maxSeverity) : 'var(--line)',
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-subtle mt-2">
        <span>{series[0]?.label}</span>
        <span>Today</span>
      </div>
    </Card>
  );
}
