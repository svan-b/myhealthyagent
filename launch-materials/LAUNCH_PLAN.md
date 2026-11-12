# Launch plan

## The pitch

A private symptom diary that finds delayed triggers. Log how you feel and what you ate or did, and after two weeks it shows what is followed by symptoms more than usual, even a day later. No account, nothing uploaded, and a clean report for your doctor.

Three things set it apart from general trackers.

1. **Delayed trigger testing that is honest.** It compares against the same hours on days without the trigger, corrects for testing many things at once, and says "nothing stands out" when that is the truth. Most trackers show raw correlations that mislead.
2. **Real privacy.** Health data never leaves the phone. This is a selling point, not a footnote, especially after years of health app data scandals.
3. **The doctor report.** People pay most readily the week before an appointment.

## Who to start with

Pick one community first instead of "chronic illness" in general. The best fit is **food related gut symptoms (IBS, bloating, reflux, histamine intolerance)**. Delayed food reactions are exactly what the analysis is built for, people are already told to keep food diaries, and dietitians are a natural referral channel. Migraine is a strong second.

Other trackers already serve these people (Bearable, Migraine Buddy, mySymptoms, Cara Care, Flaredown). Win on the honest delayed trigger analysis, the privacy promise and how fast logging is.

## Pricing

The app works fully for free when Pro is off, which is the right way to launch: get users and feedback first, then turn on Pro.

When charging, keep these facts in mind.

- **Value arrives after about two weeks of logging.** A 7 day trial ends before anyone sees a result, so skip short trials. The free plan already shows the strongest trigger, which is the moment people decide it works. Pro adds every finding and the doctor report.
- **There is almost no server cost per user**, and the promise is "no account, no tracking". A one time unlock fits that story well and avoids churn from people who track around a flare and then stop.

Recommendation: launch Pro as a **one time purchase around $19** (`STRIPE_MODE=payment`, `NEXT_PUBLIC_PRO_PRICE_LABEL="$19 once"`). Move to a subscription when you ship features with ongoing cost, like encrypted sync or reminders. The code supports both.

Costs to plan for:

- Hosting. Vercel's free Hobby plan is for non commercial use only, so once you charge, budget for a paid plan (around $20 a month at the time of writing) or use a host whose free tier allows commercial use.
- Stripe fees, roughly 3% plus 30 cents per card payment in the US.
- A domain and a support email.

## Getting the first users

1. **Reddit, done honestly.** Founder posts asking for feedback in r/ibs, r/migraine, r/ChronicIllness and similar, after checking each community's rules and asking the moderators. Drafts are in `reddit-posts.md`.
2. **Dietitians and GI or migraine clinics.** Email a short note with a sample PDF report. If a clinician recommends the app, every patient they see is a lead. This is the most durable channel.
3. **Show HN and privacy communities.** The local first design and the statistical method are interesting to technical audiences, who also share widely.
4. **Search.** Write a few genuinely useful pages, like how long after eating food intolerance symptoms appear, or how to keep a migraine diary that is actually useful. These keep bringing people in long after launch posts fade.

## How to know it is working

The app has no analytics by design, so measure what you can without breaking the privacy promise.

- **Stripe** shows checkouts, conversion from checkout to paid, refunds and revenue.
- **Talk to users.** Ask early users for a 15 minute call. Ask what they log, when they stopped and what the report did for them.
- If you want visitor counts, a cookieless page analytics tool is reasonable, but update the privacy page and the Content Security Policy before adding it, and never send health data.

Signals that it is working: people come back for 14 days (they need to for results), people mention bringing the PDF to an appointment, and people tell you a finding matched what they suspected or surprised them.

## Before charging money

- Have a lawyer review the privacy notice and terms for where you sell. Things to raise: the FDA's general wellness policy (keep marketing to tracking and patterns, never diagnosis or treatment), the FTC Health Breach Notification Rule, Washington's My Health My Data Act, and GDPR for EU users.
- Never claim the app diagnoses, treats or cures anything, in the app, the store listing, ads or posts.
- Only use real testimonials, with permission, and do not present unusual results as typical.
- Set `NEXT_PUBLIC_SUPPORT_EMAIL` and answer it. Refund anyone who asks in the first weeks.
- Run a full test purchase with Stripe test keys, then one real purchase with live keys, and refund yourself.

## What to build next

In order of impact on keeping and converting users:

1. **Reminders.** A gentle daily nudge to log, and dose reminders. Web push works for installed apps on iPhone and Android but needs a small server component.
2. **Elimination experiments.** "Cut dairy for two weeks and compare." This turns a possible trigger into an answer and is a natural Pro feature.
3. **Encrypted backup and sync.** Removes the fear of losing a phone and justifies a subscription.
4. **Condition starter packs.** Ready made lists for low FODMAP, migraine triggers and histamine.
5. **App store presence** through a native wrapper, for discovery and more durable storage on iPhone.
