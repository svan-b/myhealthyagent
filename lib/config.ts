// lib/config.ts
// Public, build time configuration. Every value here is safe to ship to the browser.

// A backslash before $ is how .env files keep the price. Pasted into a hosting dashboard it would show.
const rawPriceLabel = (process.env.NEXT_PUBLIC_PRO_PRICE_LABEL || '').replace(/\\(?=\$)/g, '');
const portalUrl = (process.env.NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL || '').trim();

/**
 * True when a price label lost its amount in a .env file. Next.js reads "$19" there as a variable and
 * puts nothing in its place, $ included: "$19 once" arrives as " once", "$4.99/month" as ".99/month"
 * and "CA$19.99" as "CA.99". What is left has no digit, starts with a dot, comma or slash, or has a
 * decimal part with no whole number in front of it. Values do not normally start or end with a space,
 * so when no currency sign is left, a space at either end or two in a row also show where the amount
 * was ("$19 for 12 months" arrives as " for 12 months"). A stray space next to a currency sign, typed
 * into a hosting dashboard say, is fine. This cannot catch every case, so .env files still need \$.
 */
export function priceLabelLost(label: string): boolean {
  if (!/\d/.test(label) || /^[.,/]/.test(label.trim()) || /(^|\D)[.,]\d/.test(label)) return true;
  return !CURRENCY_SIGN.test(label) && /^\s|\s$|\s\s/.test(label);
}

/** $, ¢, £, ¤, ¥, ฿ and the Unicode currency block, which has € ₹ ₩ ₽ and the rest. */
const CURRENCY_SIGN = /[$\u00a2-\u00a5\u0e3f\u20a0-\u20cf]/;

export const config = {
  appName: 'myHealthyAgent',
  /** Turn on paid features. When false, everything is free and no upgrade prompts appear. */
  proEnabled: process.env.NEXT_PUBLIC_PRO_ENABLED === 'true',
  /**
   * Shown on upgrade buttons. Leave empty to show no price (Stripe Checkout always shows the real one).
   * A label that lost its amount in a .env file is not shown, so the button never offers Pro at a
   * wrong price or with no price. See priceLabelLost.
   */
  proPriceLabel: priceLabelLost(rawPriceLabel) ? '' : rawPriceLabel.trim(),
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

/** A price label that is not shown because it lost its amount, so the operator knows why. */
export function priceLabelWarning(label = rawPriceLabel, proEnabled: boolean = config.proEnabled) {
  if (!proEnabled || !label.trim() || !priceLabelLost(label)) return null;
  return (
    `NEXT_PUBLIC_PRO_PRICE_LABEL is ${JSON.stringify(label)}, which looks like a .env file read a $ amount as a ` +
    'variable and dropped it, so no price is shown. In .env files write \\$, for example \\$19 once.'
  );
}

/** Logs the setup warnings on the server, once per process. Runs at build time and when the API routes load. */
export function logProSetupWarning() {
  if (typeof window !== 'undefined') return;
  const flags = globalThis as { __mhaProSetupWarned?: boolean };
  const warnings = [proSetupWarning(), priceLabelWarning()].filter(w => w !== null);
  if (!warnings.length || flags.__mhaProSetupWarned) return;
  flags.__mhaProSetupWarned = true;
  for (const warning of warnings) console.warn(`[pro] ${warning}`);
}

logProSetupWarning();
