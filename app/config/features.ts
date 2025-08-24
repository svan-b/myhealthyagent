// app/config/features.ts
/**
 * Feature flags for safe rollout of Day 10 changes
 * Set any flag to false to instantly revert that feature
 */

export const FEATURES = {
  // Master switch - set to false to revert everything
  DAY_10_MODE: true,
  
  // Individual feature toggles
  USE_PER_SYMPTOM_WIZARD: true,    // New wizard for individual ratings
  USE_DURATION_TRACKING: true,      // Add duration to symptoms
  USE_SAFE_PADDING: true,           // Fix bottom bar overlaps
  SCOPE_EXPORTS_TO_LOG: true,       // Only show exports on log tab
  
  // Simplified infrastructure mode
  SIMPLIFIED_PIVOT: true,           // Focus on temporal patterns
};

// Export individual flags for convenience
export const DAY_10_MODE = FEATURES.DAY_10_MODE;
export const USE_PER_SYMPTOM_WIZARD = FEATURES.USE_PER_SYMPTOM_WIZARD;
export const USE_DURATION_TRACKING = FEATURES.USE_DURATION_TRACKING;
