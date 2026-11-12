# Launch posts

Written in the founder's own voice. Every claim here is something the app really does.

Before posting anywhere:

- Read each community's rules. Many health subreddits ban self promotion or require moderator approval first. Message the mods, explain what it is, and ask.
- Say plainly that you built it. Never post as a "user who found this app", never use other accounts to upvote or comment, and never invent results or doctor quotes. Fake testimonials break Reddit's rules and FTC rules on endorsements, and health communities spot them fast.
- Do not claim the app diagnoses, treats or cures anything.
- Reply to every comment for the first day. Feedback is the point of posting.

---

## r/ibs

**Title:** I made a free, private food and symptom diary that looks for delayed reactions. Would love feedback

I want to be upfront that I'm the developer and this is my project.

Everyone says to keep a food and symptom diary, but spotting patterns by eye is hard, especially when a reaction shows up the next day. So I built a diary that does the comparing for you. You log symptoms and what you ate, and after about two weeks it checks whether any food is followed by symptoms more often than on days you didn't have it, at delays from a few hours up to two days.

Things I cared about:

- No account. Everything stays on your phone and nothing is uploaded.
- It tells you how strong the evidence is, and says "nothing stands out yet" instead of inventing a pattern.
- It makes a PDF you can bring to your GI or dietitian.

It is not a diagnosis tool and it doesn't replace working with a dietitian. It just makes the diary part less painful.

It's free to use here: [LINK]

I'd really value feedback on what's missing, especially from anyone doing low FODMAP or an elimination diet.

---

## r/migraine

**Title:** Built a private migraine and trigger diary that checks for delays of up to two days. Looking for feedback

Developer here, sharing something I made.

Migraine triggers are hard to pin down because the attack can come a day or more after the trigger. This app lets you log attacks and possible triggers (sleep, stress, food, alcohol, weather, your cycle, anything you add) in a few taps. After a couple of weeks it compares how often an attack follows each trigger with how often one happens in the same hours on days without it.

- No account, data stays on your device
- Shows the actual numbers, like "followed 6 of 8 times, compared with 10% on other days"
- PDF report for your neurologist, including medication adherence

It can only find patterns in what you log, and it isn't medical advice. Free here: [LINK]

What would make this genuinely useful for you?

---

## r/ChronicIllness

**Title:** I built a symptom tracker that keeps your data on your phone and makes a report for appointments

Hi everyone. I'm the person who built this, so take it as a share rather than a recommendation.

It's a symptom diary with three goals. Logging should take seconds on a bad day. Your health data should never leave your device. And you should be able to hand your doctor something clear instead of trying to remember the last month.

You log symptoms and things that might affect them (food, sleep, stress, activity, meds). It tracks doses, shows trends, and looks for delayed links between what you log and how you feel. It tells you when there isn't enough data rather than guessing.

Free here: [LINK]. I'd love to hear what would make it work better for your condition.

---

## Show HN

**Title:** Show HN: A local-first symptom diary that tests for delayed triggers

No account, no backend for health data. Everything is in IndexedDB and the analysis runs in a Web Worker.

The interesting part is the trigger test. Naive correlation fails badly here because habits and symptoms both follow the clock: morning coffee looks like it causes afternoon headaches simply because both happen during the day. So for each item, symptom and delay window it compares symptom starts against the same hours of the day when the window isn't active (an exact Poisson binomial test stratified by hour), then applies Benjamini–Hochberg across every comparison. On random data about 2% of datasets show any finding at all.

Code and method: [REPO LINK]. App: [LINK]

Happy to hear where the method falls down.
