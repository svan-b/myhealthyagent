// lib/config.ts
// Public, build time configuration. Every value here is safe to ship to the browser.

// A backslash before $ is how .env files keep the price. Pasted into a hosting dashboard it would show.
const priceLabel = (process.env.NEXT_PUBLIC_PRO_PRICE_LABEL || '').replace(/\\(?=\$)/g, '').trim();
const portalUrl = (process.env.NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL || '').trim();

export const config = {
  appName: 'myHealthyAgent',
  /** Turn on paid features. When false, everything is free and no upgrade prompts appear. */
  proEnabled: process.env.NEXT_PUBLIC_PRO_ENABLED === 'true',
  /**
   * Shown on upgrade buttons. Leave empty to show no price (Stripe Checkout always shows the real one).
   * A label with no digit, or one that starts with a dot, comma or slash, is what is left when a .env
   * file reads "$19" as a variable. It is not shown, so the button never offers Pro without a price.
   */
  proPriceLabel: /\d/.test(priceLabel) && !/^[.,/]/.test(priceLabel) ? priceLabel : '',
  /** Where feedback and support email goes. Hidden in the UI when empty. */
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '',
  /**
   * Stripe's customer portal login link. People sign in with a code Stripe emails them, so managing
   * billing never depends on the license key. Hidden in the UI when empty.
   */
  billingPortalUrl: /^https:\/\//.test(portalUrl) ? portalUrl : '',
  /** Number of trigger findings shown on the free plan when Pro is enabled. */
  freeTriggerFindings: 1,
} as const;

/** A Pro setup that works but leaves buyers with no way to manage billing or ask for help. */
export function proSetupWarning(c: Pick<typeof config, 'proEnabled' | 'supportEmail' | 'billingPortalUrl'> = config) {
  if (!c.proEnabled || c.supportEmail || c.billingPortalUrl) return null;
  return (
    'NEXT_PUBLIC_PRO_ENABLED is true, but neither NEXT_PUBLIC_SUPPORT_EMAIL nor NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL ' +
    'is set. Buyers have no way to cancel, manage billing or ask for help. See "Turning on Pro" in the README.'
  );
}

/** Logs the setup warning on the server, once per process. Runs at build time and when the API routes load. */
export function logProSetupWarning() {
  if (typeof window !== 'undefined') return;
  const flags = globalThis as { __mhaProSetupWarned?: boolean };
  const warning = proSetupWarning();
  if (!warning || flags.__mhaProSetupWarned) return;
  flags.__mhaProSetupWarned = true;
  console.warn(`[pro] ${warning}`);
}

logProSetupWarning();
