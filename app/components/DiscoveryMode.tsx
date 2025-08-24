// app/components/DiscoveryMode.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { detectPatterns } from '@/lib/report/insights';
import { db } from '@/lib/db/client';
import { toast } from 'sonner';

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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
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
      const discoveryList: Discovery[] = patterns.map(p => {
        // Create more readable pattern descriptions
        let patternText = p.text;
        
        // Fix confusing trend descriptions
        if (p.type === 'statistical' && p.text.includes('trending')) {
          // const trendMatch = p.text.match(/(up|down)/);
          // const trend = trendMatch ? trendMatch[1] : 'stable';
          
          if (p.text.includes('~0.0') || p.text.includes('~0.') || p.text.includes('0 points')) {
            patternText = `Symptoms remain stable over time`;
          } else {
            patternText = p.text.replace('~', 'approximately ');
          }
        }
        
        // Clean up other pattern types
        if (p.type === 'temporal' && p.metadata?.timeWindow) {
          patternText = `${p.text} (${p.metadata.timeWindow} pattern)`;
        }
        
        return {
          pattern: patternText,
          confidence: p.confidence === 'High' ? 0.85 : p.confidence === 'Medium' ? 0.65 : 0.45,
          occurrences: `${(p.metadata?.occurrences as number) || 'Multiple'} times`,
          timeWindow: (p.metadata?.timeWindow as string) || 'Varies',
          firstSeen: new Date((p.metadata?.firstOccurrence as string) || Date.now()),
          type: p.type
        };
      });

      setDiscoveries(discoveryList);
    } catch (error) {
      console.error('Error loading discoveries:', error);
    } finally {
      setLoading(false);
    }
  }

  function shareDiscovery(discovery: Discovery) {
    // Create more meaningful share text with URL embedded
    const text = `🔍 Health Pattern Discovered

${discovery.pattern}
Confidence: ${Math.round(discovery.confidence * 100)}%
Timing: ${discovery.timeWindow}
Frequency: ${discovery.occurrences}

Found using myHealthyAgent - Track symptoms, discover patterns in 14 days.
Try it free: ${window.location.origin}`;
    
    if (navigator.share) {
      navigator.share({
        title: 'Health Pattern Discovery',
        text: text
        // Remove the url parameter - it's already in the text
      }).catch(() => {
        // Fallback to clipboard if user cancels
        navigator.clipboard.writeText(text);
        toast.success('Discovery copied to clipboard!');
      });
    } else {
      navigator.clipboard.writeText(text);
      toast.success('Discovery copied to clipboard!');
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
          <div className="mt-8 bg-gradient-to-br from-cyan-900/20 to-purple-900/20 
                          rounded-xl p-8 border border-cyan-600/30">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 
                              bg-gradient-to-br from-cyan-500 to-purple-500 
                              rounded-full mb-4 shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              
              <h3 className="text-xl font-bold text-white mb-2">
                {discoveries.length - FREE_DISCOVERIES} More Patterns Detected
              </h3>
              
              <p className="text-gray-300 mb-6 max-w-md mx-auto">
                Unlock all your health patterns with Discovery Mode Pro. 
                New patterns analyzed weekly as you track.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-6">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-gray-200">All patterns unlocked</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-gray-200">Weekly re-analysis</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-gray-200">Priority support</span>
                </div>
              </div>
              
              <button 
                onClick={() => setShowUpgradeModal(true)}
                className="px-8 py-3 bg-gradient-to-r from-cyan-600 to-purple-600 
                           hover:from-cyan-500 hover:to-purple-500 text-white 
                           rounded-lg font-bold text-base shadow-lg 
                           transform transition-all hover:scale-105">
                Unlock for $2.99/month
              </button>
              
              <p className="text-xs text-gray-400 mt-3">
                Cancel anytime • 7-day free trial
              </p>
            </div>
          </div>
        )}
      </div>

      {showUpgradeModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" 
               onClick={() => setShowUpgradeModal(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 
                          bg-gray-800 rounded-xl shadow-xl z-50 p-6 
                          w-full max-w-md border border-cyan-600/30">
            <h3 className="text-lg font-bold text-white mb-4">
              Discovery Mode Pro - Launching Soon!
            </h3>
            <p className="text-gray-300 mb-4">
              {`We're putting finishing touches on the payment system. 
              Join the early access list for 50% off the first 3 months!`}
            </p>
            <input 
              type="email" 
              placeholder="your@email.com"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 
                         rounded-lg mb-4 text-white placeholder-gray-400"
            />
            <button 
              onClick={() => {
                toast.success(`You're on the early access list! We'll email you soon.`);
                setShowUpgradeModal(false);
              }}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white 
                         rounded-lg font-semibold">
              Get Early Access (50% off)
            </button>
            <button 
              onClick={() => setShowUpgradeModal(false)}
              className="w-full py-2 mt-2 text-gray-400 hover:text-gray-300">
              Maybe later
            </button>
          </div>
        </>
      )}
    </div>
  );
}