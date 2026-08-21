# ASP.NET Edition — Plain-English Roadmap

Status: **Canonical current - owner-facing summary** (technical detail lives in
[CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md); the work
list is [JOURNEY_CERTIFICATION_LEDGER.md](JOURNEY_CERTIFICATION_LEDGER.md))

Last updated: 2026-08-21

## Where we are, in three lines

Every status report from here uses exactly this format. Both numbers can only ever
go up, and the build enforces it.

- **Score: 270/1000** (rubric R5 — final denominator, frozen 2026-08-21, never re-cut)
- **Journeys certified: 0 of 250**
- **Movement since last report: baseline set**

Zero certified is not a typo, and it is the most useful fact on this page — see
"Why nothing is certified yet".

## What this is, and why we are building it

Project NEXUS ships as **two editions of the same product**. One runs on Laravel
(PHP). One runs on ASP.NET (.NET). Both run the same four clients — the main app,
the admin panel, the accessible site and the mobile app — and you switch between
them with a setting, not a rewrite.

The reason is commercial: **some public-sector buyers require a .NET application
stack as a condition of procurement.** Many will accept the Laravel platform. Some
will not, and for those the ASP.NET edition is the difference between winning the
contract and not being allowed to bid. That is now a formal decision
([ADR-0003](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md)) so no future
session treats this as a side experiment again.

## The number moved again today. This is the last time, and here is the mechanism

The score has now been re-cut four times: 712, 598, 653, 353, and today 270. You
were right to be angry about that and right to demand it be checked.

| | What changed | Was the software worse? |
|---|---|---|
| 712 → 598 | We built the first tool that could actually compare the two backends' answers. It found far less agreement than counting addresses had implied. | No |
| 598 → 653 | Five days of real work finally got formally banked. | No — better |
| 653 → 353 | The question changed: from "do the addresses look right" to "is the product proved to work". | No |
| 353 → 270 | **Your scope decision today**: the mobile app joined the plan (331 addresses, ~138,000 lines, previously in no plan at all) and the admin surface grew from 25 tracked journeys to 72. | No |

Today's is the only one caused by a decision rather than a measurement
correction, and you made it knowing the cost. **Three mechanisms now make another
one impossible**, each checked by the build rather than promised on a page:

1. **Spare slots.** Every section of the work list carries pre-counted spare
   slots. A journey discovered next month fills a slot instead of making the list
   longer. If a section runs out of spares, that comes to you as a decision — it
   can never quietly change the total.
2. **A floor.** The published score cannot go below its recorded floor; the build
   fails if anyone tries. If we discover something we thought worked doesn't, the
   work list records that immediately and honestly, and the headline waits until
   the net is positive again.
3. **The score is calculated, not typed.** The build recomputes it from the work
   list every run and fails if the two disagree. Not theoretical: yesterday's 353
   was arithmetically wrong — the summary said 20 items where the list held 19 —
   and this check catches exactly that. It was deliberately broken twelve
   different ways to confirm it fails before being trusted.

## Why nothing is certified yet — and today's good news

"Certified" has a strict meaning here: a real member action, driven through the
app's own screens against .NET, **and** the identical run passing against Laravel
side by side, so a difference in test data can never be mistaken for a broken
backend.

Until today the main app's test never ran that comparison. It does now — **and the
first full run found zero failures unique to ASP.NET.** 31 of 37 steps matched on
both engines; ASP.NET passed 35 of 37 with nothing failing. The six non-matches
are all on the *Laravel* side: its throwaway test database holds only one
community, so its sign-in screen has nothing to choose and the sign-up step can't
finish.

That is a test-data gap, not a product fault — and without the comparison arm we
would have read it as a product fault. Fixing that fixture is the next job, and it
is what converts journeys to certified in bulk.

## What works today, proved by using it

A member can sign up, verify their email, accept the legal agreement, sign in, use
the dashboard, browse and scroll the feed, filter it, post, comment, browse and
create listings, browse events, RSVP, send a message, transfer credits, see their
wallet history, browse members, view their profile, change theme and have it
stick, and clear notifications — all through the app's own screens against the
.NET engine.

That test can now **fail**. Until today it caught every error and exited
successfully anyway, so a green run proved nothing at all. It was fixed and then
proved red: pointed at a dead address, it correctly reported 36 of 37 steps broken.

The accessible site signs in against .NET and 20 of its pages render the same as
against Laravel, checked side by side in the same run.

## The honest gaps

- **The core transaction is unproven.** Request an exchange, accept it, complete
  it, credits move. That is the heart of a timebank and it has never been driven
  end to end on .NET. It is first in the queue after the fixture fix.
- **The admin panel is barely touched** — 514 admin addresses never compared, and
  it holds almost all the do-nothing endpoints. Buyers evaluate the admin panel,
  which is why it now carries 150 of the 1,000 points.
- **The mobile app has not started** — 34 journeys, nothing attempted. Much of it
  reuses member functions certified elsewhere, so a measurement pass will tell us
  how much is real work instead of guessing.
- **317 endpoints still answer "success" while doing nothing.** Two were worse
  than that: a member's legal request to erase their data, and their request for a
  copy of it, both replied "queued" and did nothing. **Both fixed today** — they
  refuse honestly now. A third of the same kind is recorded and queued.
- **`/explore` has no .NET version at all**, against 2,257 lines of Laravel.
- **Push notifications cannot work.** The code uses a Google delivery address and
  login method both switched off in July 2024.
- **Languages: 7 of 11 seeded, and no per-request language handling at all.**
  Arabic is missing, so there is no right-to-left language. A Welsh- or
  Irish-language buyer would fail us on this today.
- **Background tasks: 26 of about 117.** Previously published as 26 of 69, which
  flattered us — one Laravel task fans out into 49 more.

## Two things I got wrong, corrected

**The backup emergency was overstated.** I told you the .NET database had "no
successful backup since 8 March, nothing to restore from". The *scheduled* job has
been broken since then — but a **restore-tested copy from 10 August exists off the
server** (all 265 tables, 49,958 rows, verified by actually restoring it), and the
database has been switched off since, so that copy is current. This was written
down on 16 August and I repeated the older claim in six places without reading it.
What genuinely remains: repair the scheduled job, copy the last few hours' dump,
and don't restart that container. Real work, yours to schedule — not the emergency
I described.

**Two problems were overstated the other way too.** Search indexing has a working
administrator rebuild (only the automatic updating is missing, so the index goes
stale until someone rebuilds it), and Stripe payment webhooks *are* properly
handled on two paths with correct signature checking — only one unused alias
isn't, and it refuses honestly.

## Time frames

Working days means days you actually run sessions. You said near-daily, so the
calendar column assumes 5–7 sessions a week.

| Milestone | Working days | Calendar |
|---|---:|---|
| Fixture fixed, first journeys certified | 2–4 | this week |
| **Procurement demo grade (~550)** — enough to put it in front of a buyer with evidence | 20–30 | **4–6 weeks** |
| **First-customer grade (~780)** — one .NET-required customer could be operated | 50–75 | **9–14 weeks** |
| Everything, including mobile (~950) | 85–120 | **15–22 weeks** |

Milestone levels are lower than the equivalents quoted yesterday because the
denominator grew: 550 now covers more certified product than 600 did then.

**Was 11 weeks unreasonable?** Partly. The platform is about 2.13 million lines of
product code across four clients and two backends — Laravel's business logic alone
is 521,000 lines. It is genuinely large. But your instinct that something was off
is right: **the porting is already done.** 2,655 of 2,667 addresses exist, and the
only gaps the main app cares about are five, all one social-login feature. What is
left is proving behaviour, one journey at a time.

**Why more agents will not compress this much.** The test suite takes 40 minutes
and the build another 20–35, and every batch must end green. That caps useful
batches at roughly 6–10 a day however many agents ran. Database migrations go one
at a time. There is one comparison environment. Agents make finding and fixing
nearly free; they do not make verification free.

**These estimates get replaced by measured ones.** After the accessible-site phase
there is a mandatory checkpoint that cannot pass without six real measurements —
including how many defects each admin journey actually turns up, the number the
whole back half depends on. That is the last time these figures are a guess.

## What needs you

1. **A test hook on the feed card** — a one-line frontend change that unblocks two
   feed journeys currently impossible to verify. The only frontend edit I'd ask
   for.
2. **The uncalled do-nothing endpoints** — 63 are called by nothing at all. Delete
   in both editions, or implement? You see the list first.
3. **Repair the scheduled backup** and copy the final dump. Infrastructure, and it
   gates any production use.
4. **Live provider credentials** (Stripe, push, identity checks) when we reach
   them — those cannot be simulated.
