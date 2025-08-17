// lib/rules/timing-rules.ts
export type TimingHint = {
  ruleId: string;
  confidence: 'High' | 'Medium' | 'Low';
  message: string;
  window?: string;
};

export function evaluateTimingHints(params: {
  currentMed?: string;
  currentTags?: string[];
  recentMeds?: Array<{ name: string; timestamp: string; dosage?: string }>;
  max?: number;
}): TimingHint[] {
  const results: TimingHint[] = [];
  const { currentMed = '', currentTags = [], recentMeds = [], max = 2 } = params;
  
  if (!currentMed && recentMeds.length === 0) {
    return results;
  }

  const medLower = currentMed.toLowerCase();
  const tagsLower = currentTags.map(t => t.toLowerCase());

  // Tetracycline-dairy rule
  if ((medLower.includes('doxycycline') || medLower.includes('tetracycline')) && 
      tagsLower.some(t => t.includes('dairy') || t.includes('calcium'))) {
    results.push({
      ruleId: 'tetracycline-dairy',
      confidence: 'High',
      message: 'Space tetracycline and dairy by 2+ hours for better absorption',
      window: '2+ hours'
    });
  }

  // Iron-coffee/tea rule
  if (medLower.includes('iron') && 
      tagsLower.some(t => t.includes('coffee') || t.includes('tea'))) {
    results.push({
      ruleId: 'iron-coffee',
      confidence: 'High',
      message: 'Space iron and coffee/tea by 1-2 hours for better absorption',
      window: '1-2 hours'
    });
  }

  // Levothyroxine-food rule
  if ((medLower.includes('levothyroxine') || medLower.includes('synthroid')) && 
      tagsLower.some(t => t.includes('meal') || t.includes('food') || t.includes('breakfast'))) {
    results.push({
      ruleId: 'levothyroxine-food',
      confidence: 'High',
      message: 'Take levothyroxine 30-60 min before food for best absorption',
      window: '30-60 min before'
    });
  }

  // Iron-dairy rule
  if (medLower.includes('iron') && 
      tagsLower.some(t => t.includes('dairy') || t.includes('calcium'))) {
    results.push({
      ruleId: 'iron-calcium',
      confidence: 'High',
      message: 'Space iron and calcium/dairy by 1-2 hours',
      window: '1-2 hours'
    });
  }

  // PPI-meal timing
  if ((medLower.includes('omeprazole') || medLower.includes('ppi') || 
       medLower.includes('pantoprazole') || medLower.includes('lansoprazole')) && 
      tagsLower.some(t => t.includes('meal'))) {
    results.push({
      ruleId: 'ppi-meal',
      confidence: 'Medium',
      message: 'Take PPI 30-60 min before meal for best effect',
      window: '30-60 min before'
    });
  }

  // NSAIDs with food
  if ((medLower.includes('ibuprofen') || medLower.includes('naproxen') || 
       medLower.includes('nsaid')) && 
      !tagsLower.some(t => t.includes('meal') || t.includes('food'))) {
    results.push({
      ruleId: 'nsaid-food',
      confidence: 'Medium',
      message: 'Take NSAIDs with food to reduce stomach irritation',
      window: 'with food'
    });
  }

  // Return max number of hints
  return results.slice(0, max);
}

// Keep this for backward compatibility with tests
export const evaluateTimingRules = (medication: string, contexts: string[]) => {
  return evaluateTimingHints({
    currentMed: medication,
    currentTags: contexts
  });
};

// Compatibility alias for LogTab imports
export { evaluateTimingRules as evaluateTiming };
