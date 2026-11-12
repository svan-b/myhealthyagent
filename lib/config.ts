// lib/config.ts
// Public, build time configuration. Every value here is safe to ship to the browser.

export const config = {
  appName: 'myHealthyAgent',
  /** Turn on paid features. When false, everything is free and no upgrade prompts appear. */
  proEnabled: process.env.NEXT_PUBLIC_PRO_ENABLED === 'true',
  /** Shown on upgrade buttons. Leave empty to show no price (Stripe Checkout always shows the real one). */
  proPriceLabel: process.env.NEXT_PUBLIC_PRO_PRICE_LABEL || '',
  /** Where feedback and support email goes. Hidden in the UI when empty. */
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '',
  /** Number of trigger findings shown on the free plan when Pro is enabled. */
  freeTriggerFindings: 1,
} as const;
