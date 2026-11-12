# myHealthyAgent

A private symptom diary that finds delayed triggers.

People log how they feel and what they ate, drank or did. After about two weeks the app checks whether any of those things are followed by a symptom more often than usual, including delays of a day or more that are almost impossible to notice on your own. Everything stays on the device. There is no account and no server that holds health data.

## What it does

- **Log in seconds.** Pick a symptom, tap how bad it is, save. Foods, drinks, sleep, stress and activities are quick multi-select taps. Anything can be backdated.
- **Possible triggers.** For every logged item and symptom, the app compares four delay windows (within 3 hours, 3 to 12 hours, 12 to 24 hours, 1 to 2 days) against the same hours of the day when the item was not logged. Results come with plain numbers ("bloating followed dairy 12 to 24 hours later 10 of 11 times, compared with 0% on nearby days without dairy").
- **Patterns.** Time of day, weekday versus weekend, symptoms that show up together, and whether things are getting better or worse.
- **Medications.** Schedules, a daily checklist with take and skip, as-needed doses, and 30 day adherence. Doses taken also feed the trigger finder so possible side effects can show up.
- **Doctor report.** A clean multi-page PDF with an overview, symptom table, daily severity chart, possible triggers, medication adherence and the full log.
- **Your data, your files.** Backup and restore (JSON), spreadsheet export (CSV), and delete everything. Deleting also removes the Pro license key from the device unless the person ticks "Keep my Pro license key on this device".
- **Works offline** as an installable app (PWA).

## How trigger finding works

The method lives in [`lib/analysis/triggers.ts`](lib/analysis/triggers.ts) and is documented at the top of that file. In short:

1. Time is split into 15 minute bins over the days the person actually logged something, so gaps in tracking never count as symptom free time.
2. For each item and delay window, the test asks whether symptoms start inside the window more often than they start in the same hours of the day when the window is not active. Stratifying by hour of day matters. Without it, a daily habit like morning coffee looks like a trigger simply because symptoms happen during the day.
3. The count is tested exactly against a Poisson binomial distribution, then every p value is corrected with Benjamini–Hochberg across all comparisons.
4. Only findings that survive correction, show at least a 1.5x rise and happened at least 3 times are shown. Items logged at the same time every day cannot be separated from time of day, so they are not tested.

On simulated random data with no real relationships, about 2% of datasets produce any finding and none are rated strong. On a planted 15 hour delayed reaction, the right item and delay window are found. Both cases are covered by tests.

Findings are associations in one person's data, not diagnoses, and the app says so wherever they appear.

## Privacy model

- All entries live in IndexedDB in the browser. Analysis and PDF generation run on the device (analysis in a Web Worker).
- The server only serves the app and, if Pro is enabled, talks to Stripe. License keys identify a Stripe customer and purchase and contain no health data. A license key never opens billing. "Manage billing" goes to Stripe's customer portal, where Stripe emails a one time sign in code.
- No analytics, cookies, ads or third party scripts. A strict Content Security Policy blocks connections to any other origin.
- The app asks the browser for persistent storage after the first log, reminds people to back up, and suggests installing to the home screen because Safari can clear data for sites that are not visited for a while.

See [`app/privacy/page.tsx`](app/privacy/page.tsx) and [`app/terms/page.tsx`](app/terms/page.tsx) for the user facing privacy notice and terms. Have them reviewed by a lawyer for your jurisdiction before charging money.

## Running it

Requires Node 20.11 or newer.

```bash
npm ci
```

```bash
npm run dev
```

Open http://localhost:3000.

## Checks

```bash
npm run check
```

That runs the type check, lint, unit tests and the format check. End to end tests run against a production build in a real browser (logging, editing, medications, backup and restore, PDF and CSV export, offline mode, security headers, returning from checkout):

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

A GitHub Actions workflow that runs all of this on every push, plus `npm audit` on production dependencies, is in [`ci/github-actions.yml`](ci/github-actions.yml). It lives outside `.github/workflows` only because the automation that built this could not write workflow files. To turn it on, move it into place and commit:

```bash
mkdir -p .github/workflows && git mv ci/github-actions.yml .github/workflows/ci.yml
```

## Deploying

Any Node host works. On Vercel, import the repository and deploy; no configuration is required for the free version. Set these environment variables as needed:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public URL, for example `https://myhealthyagent.com`. Used for Stripe redirects and link previews. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Shown for feedback, for help with purchases and in the legal pages. Hidden when empty. |
| `NEXT_PUBLIC_PRO_ENABLED` | `true` to turn on paid features. When unset, everything is free and no upgrade prompts appear. |
| `NEXT_PUBLIC_PRO_PRICE_LABEL` | Optional price shown on buttons, for example `$19 once`. Must match the Stripe price exactly. When empty the button just says Get Pro and Stripe shows the price. In a `.env` file write `\$19 once`, see below. |
| `NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL` | Stripe's customer portal login link. "Manage billing" in the app opens it. Hidden when empty. |
| `STRIPE_SECRET_KEY` | Stripe secret key. Server only. |
| `STRIPE_PRICE_ID` | The Stripe price to sell. |
| `STRIPE_MODE` | `subscription` (default) or `payment` for a one time purchase. |
| `STRIPE_TRIAL_DAYS` | Optional free trial length for subscriptions. |
| `LICENSE_SECRET` | 32+ random characters that sign license keys. Generate with `openssl rand -base64 48`. Changing it invalidates every key already issued. Payments stay off while it is shorter than 32 characters. |
| `LICENSE_VALID_FROM` | Optional. Keys issued before this time stop working, for example `2026-12-01T00:00:00Z`. |
| `LICENSE_REVOKED` | Optional. Comma separated customer (`cus_`), subscription (`sub_`) or checkout session (`cs_`) ids whose keys stop working. |
| `TRUSTED_PROXY_HOPS` | Optional. How many of your own proxies add to `X-Forwarded-For`. Default 1. See rate limits below. |

`NEXT_PUBLIC_` values are baked in at build time, so redeploy after changing them. A template is in [`.env.example`](.env.example).

Next.js expands `$NAME` in `.env` files, so a price written as `$19 once` in `.env`, `.env.local` or `.env.production` loses the `$19`, with or without quotes. Write `\$19 once` there. Values typed into a hosting dashboard such as Vercel's are not expanded, so type `$19 once` there, without the backslash. A backslash left in front of the `$` is dropped, and a label with no digit in it is not shown at all, so the button never offers Pro without a price.

### Rate limits and request size

The payment routes allow 10 checkouts and 30 license checks a minute per address. The address is read from `X-Forwarded-For`, counting `TRUSTED_PROXY_HOPS` entries from the right, because everything to the left of what your own proxies added was written by the client. Vercel replaces the header and one nginx, Caddy or load balancer appends to it, so the default of 1 fits both. With two proxies, for example Cloudflare in front of nginx, set it to 2. IPv6 addresses count per /64.

`next start` with no proxy in front keeps whatever the client sends in that header, so per address limits cannot work there. Put a proxy in front that sets the header (in nginx, `proxy_set_header X-Forwarded-For $remote_addr;`). Bodies are capped at 4 KB while they are read, and a body size limit at the proxy (nginx `client_max_body_size 8k;` for `/api/`) adds a second guard.

## Turning on Pro

Pro unlocks every possible trigger (the free plan shows the strongest one) and the doctor report. There are no accounts: a purchase produces a signed license key that is stored on the device and included in backups, and can be pasted on another device.

1. In Stripe, create a product and a price (recurring for a subscription, one time for a lifetime unlock).
2. In Stripe settings, turn on the customer portal (Settings, Billing, Customer portal) so people can cancel, change cards and download invoices, and turn on its login link. Put that link in `NEXT_PUBLIC_STRIPE_PORTAL_LOGIN_URL`. Stripe emails people a one time code to sign in, so it works for anyone who lost their key, and nobody who only has a key can see billing.
3. Set `NEXT_PUBLIC_SUPPORT_EMAIL`. Buyers see it when a purchase cannot be confirmed, with a reference to quote. Pro works without it, but then people who need help have nowhere to go. With neither a support email nor a portal link, the server logs a warning at build and start up.
4. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `LICENSE_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PRO_PRICE_LABEL` and `NEXT_PUBLIC_PRO_ENABLED=true`, then redeploy.
5. Test end to end with Stripe test keys and the card `4242 4242 4242 4242` before switching to live keys. Keys from test purchases do not work with live Stripe keys. To be sure, use a different `LICENSE_SECRET` while testing, or set `LICENSE_VALID_FROM` to the time you switch to live keys.

How it fits together:

- `POST /api/checkout` creates a Stripe Checkout session and returns its URL.
- After payment Stripe redirects back with a session id. The app saves it on the device first, then `POST /api/license` confirms the session is paid and for this product and returns a signed key. If that fails because of the network, a server error or a payment that is still processing (bank debits can take days), the app keeps the session id, says so, and tries again when it starts, when it comes back online and on a timer, until it gets the key or a final answer. While it waits there is no buy button, so nobody pays twice. After two weeks without an answer the timer stops and the person can dismiss the purchase and buy again. If it fails for good, the app shows why, the support email and the reference to quote. Support can also send someone their checkout reference (`cs_...`), and pasting it in the license key box finishes the purchase.
- About once a day the app sends the key to `POST /api/license`. Subscriptions are checked by their status. One time purchases are checked for a full refund or a lost dispute, so either turns Pro off within about a day. Keys issued before purchases were recorded in them stay valid while their Stripe customer exists. `LICENSE_REVOKED` and `LICENSE_VALID_FROM` turn off keys by hand. Only a definite answer from Stripe turns Pro off. If the device is offline or Stripe cannot be reached, Pro keeps working for up to 30 days since the last successful check, and the app checks again when it is back online.
- "Manage billing" in the app is a plain link to the portal login page. The license key is never used to open billing.

## Project layout

```
app/
  components/        Screens (log, history, insights, meds, settings) and shared pieces
  api/               Stripe checkout and license routes
  privacy/, terms/   Legal pages
lib/
  analysis/          Trigger finder, statistics, descriptive patterns, worker
  db/                IndexedDB schema, migrations, data access, backup and CSV
  medication/        Dose schedules and adherence
  report/            PDF report
  pro/               License signing, Stripe client, client side entitlement
components/ui/       Buttons, chips, fields, sheets
__tests__/           Unit tests (Jest) and end to end tests (Playwright)
public/sw.js         Service worker for offline use
```

## Known limits

- No sync between devices. Moving devices means a backup file (and the license key, which is inside it).
- No reminders or push notifications for doses.
- Backup files are not encrypted.
- Trigger finding needs both symptoms and the things that might cause them to be logged. It can only find what people log.
- Data written by browsers in private mode may not survive closing the window.
