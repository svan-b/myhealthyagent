// app/components/DiscoveryMode.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { detectPatterns } from '@/lib/report/insights';
import { db } from '@/lib/db/client';

interface Discovery {
  pattern: string;
  confidence: number;
  occurrences: string;
  timeWindow: string;
  firstSeen: Date;
  type: string;
}

export function DiscoveryMode() {
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPremium] = useState(false); // TODO: Add payment gate later
  const FREE_DISCOVERIES = 1;

  useEffect(() => {
    loadDiscoveries();
  }, []);

  async function loadDiscoveries() {
    try {
      const symptoms = await db.getAllSymptoms();
      const patterns = await detectPatterns(symptoms, {
        lookbackDays: 14
      });

      // Transform patterns into discoveries
      const discoveryList: Discovery[] = patterns.map(p => ({
        pattern: p.text,
        confidence: p.confidence === 'High' ? 0.85 : p.confidence === 'Medium' ? 0.65 : 0.45,
        occurrences: `${(p.metadata?.occurrences as number) || 'Multiple'} times`,
        timeWindow: (p.metadata?.timeWindow as string) || 'Varies',
        firstSeen: new Date((p.metadata?.firstOccurrence as string) || Date.now()),
        type: p.type
      }));

      setDiscoveries(discoveryList);
    } catch (error) {
      console.error('Error loading discoveries:', error);
    } finally {
      setLoading(false);
    }
  }

  function shareDiscovery(discovery: Discovery) {
    const text = `Pattern Discovered: ${discovery.pattern}\nConfidence: ${Math.round(discovery.confidence * 100)}%\nOccurs: ${discovery.timeWindow}`;
    
    if (navigator.share) {
      navigator.share({ text });
    } else {
      navigator.clipboard.writeText(text);
      alert('Discovery copied to clipboard');
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-sm border border-gray-200 dark:border-gray-700 animate-pulse">
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
            </div>
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3"></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (discoveries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] px-4 py-8">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            Insufficient Data for Pattern Analysis
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
            Pattern detection requires at least 14 days of consistent symptom tracking. Continue logging daily to enable comprehensive analysis.
          </p>
          <div className="mt-6 inline-flex items-center px-4 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <span className="text-sm text-blue-900 dark:text-blue-300">
              Data collection in progress
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Pattern Analysis
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          AI-detected patterns from your symptom data
        </p>
      </div>

      <div className="space-y-4">
        {discoveries.slice(0, isPremium ? 100 : FREE_DISCOVERIES).map((discovery, idx) => (
          <div 
            key={idx}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300">
                {discovery.type}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {Math.round(discovery.confidence * 100)}% confidence
                </span>
              </div>
            </div>
            
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">
              {discovery.pattern}
            </h3>
            
            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Frequency</p>
                <p className="font-medium text-gray-900 dark:text-white">{discovery.occurrences}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Time Pattern</p>
                <p className="font-medium text-gray-900 dark:text-white">{discovery.timeWindow}</p>
              </div>
            </div>
            
            <button
              onClick={() => shareDiscovery(discovery)}
              className="w-full px-4 py-2 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-medium text-sm transition-colors"
            >
              Share Discovery
            </button>
          </div>
        ))}

        {!isPremium && discoveries.length > FREE_DISCOVERIES && (
          <div className="mt-6 p-5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {discoveries.length - FREE_DISCOVERIES} Additional Patterns Available
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Unlock comprehensive pattern analysis with premium access
              </p>
              <div className="space-y-2 mb-4 max-w-xs mx-auto text-left">
                <div className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="text-green-600 dark:text-green-400 mt-0.5">✓</span>
                  <span>Unlimited pattern detection</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="text-green-600 dark:text-green-400 mt-0.5">✓</span>
                  <span>Weekly re-analysis</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="text-green-600 dark:text-green-400 mt-0.5">✓</span>
                  <span>PDF export for healthcare providers</span>
                </div>
              </div>
              <button className="px-6 py-2.5 bg-blue-900 hover:bg-blue-800 text-white rounded-lg font-medium text-sm shadow-sm hover:shadow-md transition-all">
                Upgrade for $2.99/month
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                Cancel anytime • Secure payment
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}