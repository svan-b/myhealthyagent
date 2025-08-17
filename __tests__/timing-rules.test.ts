import { evaluateTimingHints } from '@/lib/rules/timing-rules';
import { detectPatterns } from '@/lib/report/insights';
import type { Symptom } from '@/lib/db/schema';

describe('Timing Rules', () => {
  describe('evaluateTimingHints', () => {
    test('detects tetracycline-dairy interaction', () => {
      const hints = evaluateTimingHints({
        currentMed: 'doxycycline',
        currentTags: ['dairy'],
        recentMeds: []
      });
      
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].ruleId).toBe('tetracycline-dairy');
      expect(hints[0].confidence).toBe('High');
      expect(hints[0].message).toContain('tetracycline and dairy');
    });

    test('detects iron with coffee/tea', () => {
      const hints = evaluateTimingHints({
        currentMed: 'iron supplement',
        currentTags: ['coffee'],
        recentMeds: []
      });
      
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].ruleId).toBe('iron-coffee');
    });

    test('detects levothyroxine timing', () => {
      const hints = evaluateTimingHints({
        currentMed: 'synthroid',
        currentTags: ['meal'],
        recentMeds: []
      });
      
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].ruleId).toBe('levothyroxine-food');
    });

    test('detects PPI meal timing', () => {
      const hints = evaluateTimingHints({
        currentMed: 'omeprazole',
        currentTags: ['meal'],
        recentMeds: []
      });
      
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].ruleId).toBe('ppi-meal');
    });

    test('returns empty array when no interactions', () => {
      const hints = evaluateTimingHints({
        currentMed: 'acetaminophen',
        currentTags: ['water'],
        recentMeds: []
      });
      
      expect(hints).toEqual([]);
    });

    test('limits results to max parameter', () => {
      const hints = evaluateTimingHints({
        currentMed: 'doxycycline',
        currentTags: ['dairy', 'calcium'],
        recentMeds: [],
        max: 1
      });
      
      expect(hints.length).toBe(1);
    });
  });
});

describe('Pattern Detection', () => {
  const createSymptom = (name: string, severity: number, daysAgo: number): Symptom => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return {
      id: `test-${Date.now()}-${Math.random()}`,
      name,
      severity,
      timestamp: date.toISOString(),
      tags: []
    };
  };

  describe('detectPatterns', () => {
    test('detects severity trend', () => {
      const symptoms: Symptom[] = [];
      // Create worsening trend
      for (let i = 14; i >= 0; i--) {
        symptoms.push(createSymptom('headache', 10 - (i * 0.5), i));
      }
      
      const patterns = detectPatterns(symptoms);
      const trendPattern = patterns.find(p => p.type === 'statistical');
      
      expect(trendPattern).toBeDefined();
      expect(trendPattern?.text).toContain('trending');
    });

    test('detects symptom clusters', () => {
      const symptoms: Symptom[] = [];
      // Create cluster: headache + nausea often together
      for (let i = 10; i >= 0; i -= 2) {
        symptoms.push(createSymptom('headache', 7, i));
        symptoms.push(createSymptom('nausea', 6, i));
      }
      
      const patterns = detectPatterns(symptoms);
      const clusterPattern = patterns.find(p => p.type === 'cluster');
      
      expect(clusterPattern).toBeDefined();
      expect(clusterPattern?.text).toContain('occur together');
    });

    test('detects weekday vs weekend pattern', () => {
      const symptoms: Symptom[] = [];
      // Create weekday-heavy symptoms
      for (let i = 30; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        symptoms.push({
          id: `test-${i}`,
          name: 'stress',
          severity: isWeekend ? 3 : 8,
          timestamp: date.toISOString(),
          tags: []
        });
      }
      
      const patterns = detectPatterns(symptoms);
      const weekdayPattern = patterns.find(p => 
        p.text.includes('weekday') || p.text.includes('weekend')
      );
      
      expect(weekdayPattern).toBeDefined();
      expect(weekdayPattern?.confidence).toBe('High');
    });


    test('limits to top 3 patterns', () => {
      // Create data that would generate many patterns
      const symptoms: Symptom[] = [];
      for (let i = 30; i >= 0; i--) {
        symptoms.push(createSymptom('headache', 5 + (i % 3), i));
        symptoms.push(createSymptom('fatigue', 4 + (i % 3), i));
        symptoms.push(createSymptom('nausea', 6 + (i % 3), i));
      }
      
      const patterns = detectPatterns(symptoms);
      
      expect(patterns.length).toBeLessThanOrEqual(3);
    });
  });
});
