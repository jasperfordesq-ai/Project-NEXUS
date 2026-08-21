# ASP.NET Edition — Plain-English Roadmap

Status: **Canonical current - owner-facing summary** (technical detail lives in
[CURRENT_ASPNET_CONTRACT_STATUS.md](CURRENT_ASPNET_CONTRACT_STATUS.md); the work
list is [JOURNEY_CERTIFICATION_LEDGER.md](JOURNEY_CERTIFICATION_LEDGER.md))

Last updated: 2026-08-21

## What this is, and why we are building it

Project NEXUS will ship as **two editions of the same product**. One runs on
Laravel (PHP). One runs on ASP.NET (.NET). Both run the same two websites — the
main app and the accessible site — and you switch between them with a setting,
not a rewrite.

The reason is commercial, and until 2026-08-21 it was written down nowhere: **some
public-sector buyers require a .NET application stack as a condition of
procurement.** Many will accept the Laravel platform. Some will not, and for
those the ASP.NET edition is the difference between winning the contract and not
being allowed to bid.

That reason is now recorded as a formal decision
([ADR-0003](decisions/ADR-0003-aspnet-is-a-committed-deliverable.md)) so no
future agent treats this work as a side experiment again.

## What was wrong with how this was written down

You asked for this to be put right. Here is what was actually wrong, plainly.

**1. Every guide told agents this work was optional.** A decision record written
on 15 August called ASP.NET "an optional future alternative" and said "do not
promise that ASP.NET will be deployed." That wording spread into the main agent
guide, the frontend guide, and the documentation policy. Agents reading their
mandatory first-read instructions learned this was speculative. Two things
followed: nobody was allowed to shrink the goal, because shrinking a goal is a
delivery decision and this was not framed as a delivery; and the workstream got
treated as background work.

**2. The finish line was the biggest possible one.** The goal was measured by
comparing whole API responses between the two engines. Laravel often returns raw
database rows, so a single listing carries about 76 fields — including internal
columns no screen ever reads, and at least one that should never have been sent
at all. Under that comparison, copying those columns counted as required work.
That is what I meant by "byte-for-byte", and it was never what you asked for.

**3. The score punished looking closely.** Points were deducted simply because
some part of the system had not been measured yet. So the more thoroughly we
audited, the lower the score went, while the software was improving. That is why
it fell from 712 to 598 in August. It was an honest audit and a useless progress
signal.

**4. I asked you the deciding question on 19 August and got no answer.** I asked
whether copying those raw fields was actually the goal, recommended that it was
not, and carried on under the strict reading because nothing on record permitted
the looser one. That was my error to escalate more clearly, and it cost weeks.

**All four are now fixed in the documents themselves**, not just described here.
The goal is [journey equivalence](decisions/ADR-0004-journey-equivalence-is-the-target.md):
for everything a real person does, both editions must behave the same — same
result, same data, same errors, same permissions. A field no screen reads is
explicitly **not** part of the job.

## The new score, and why it is lower

**355 out of 1,000.** The old score was 653.

Nothing got worse. The question changed. The old score answered *"how much of
Laravel's API has a .NET counterpart that looks about right?"* — and the answer
is genuinely most of it. The new score answers *"how much of the product has
been proved to work on .NET?"* — and that is the part that has barely started.

The new score is the one worth having, for three reasons:

- It can only go up by making the product work. It cannot go down because we
  looked harder.
- It is built from a **finite list of 130 real journeys** — sign up, post to the
  feed, transfer credits, run an admin report — not from 2,650 API endpoints. A
  list of journeys can be scheduled, split up, and finished. An endpoint count
  cannot.
- A procurement auditor would recognise it. "We have certified these 130
  journeys on both engines" is an answer. "Our response bodies are 96% similar"
  is not.

## Where we actually are

**Working now, proved by using it:** a member can sign up, verify, accept the
legal agreement, sign in, use the dashboard, browse and scroll the feed, filter
it, post, comment, browse and create listings, browse events, RSVP, send a
message, transfer credits, see their wallet history, browse members, view their
profile, change theme and have it stick, and clear notifications — all through
the app's own screens against the .NET engine. An automated browser test walks 37
steps of that on every run.

The accessible site signs in against .NET and 20 of its pages render the same as
against Laravel, checked side by side in the same run.

**The honest gaps:**

- **Nothing is fully "certified" yet**, because the main app's test does not run
  the same steps against Laravel in the same pass. So we cannot yet prove the two
  engines agree — only that .NET works. Fixing that is a half-day job on the test
  itself and it is now first in the queue.
- **The core transaction is unproven**: request an exchange, accept it, complete
  it, credits move. That is the heart of a timebank and it has never been driven
  end to end on .NET.
- **The admin panel is untouched** — 243 admin screens' worth of endpoints never
  compared. Public-sector buyers evaluate the admin panel, so this is not
  optional.
- **319 endpoints still answer "success" while doing nothing.** None of them sits
  on a screen we have proved, which is exactly why our tests pass. Most are in
  the admin area.
- **Two known broken things**: posts with several photos show one photo (no
  database table for the rest), and event check-in by code needs a signed-token
  subsystem that .NET does not have at all.
- **Behind the scenes**: 26 of 69 scheduled tasks exist; search indexing, push
  notifications and payment webhooks are not connected; language handling has no
  per-request locale at all and only 7 of 11 languages seeded. A Welsh- or
  Irish-language buyer would fail us on that today.
- **The hard stop, unchanged**: the live .NET database has had no successful
  backup since 8 March, while the app rewrites its own schema every start. That
  is infrastructure and it is yours. No score substitutes for it, and nothing goes
  near production until it is fixed.

## Time frames — for you and a large fleet of agents

These are working days, not calendar days: days on which you actually run
sessions. They assume heavy parallel agent use and a rule that every batch ends
green in CI before the next starts.

| Phase | Work | Days |
| ---: | --- | ---: |
| 1 | Add the Laravel side-by-side arm to the main app's test | 0.5 |
| 2 | Teach the response comparison to ignore fields no screen reads | 0.5–1 |
| 3 | The 13 remaining core member journeys, incl. the exchange transaction | 3–5 |
| 4 | Measure all 243 admin endpoints in one pass, before building anything | 1–2 |
| 5 | Accessible site: make its test submit forms, then certify its journeys | 3–4 |
| 6 | Community modules — groups, volunteering, goals, polls, skills, reviews | 5–7 |
| 7 | Admin, super-admin and broker journeys | 6–9 |
| 8 | Scheduled tasks 26→69, search, push, payments, languages, database tail | 4–6 |
| 9 | Operations: deploy path, monitoring, load comparison (backups are yours) | 2–4 |
| | **Total** | **26–39** |

**Milestones:**

- **Procurement demo grade (~600 points): 13–19 working days.** Phases 1–5 plus
  part of 6. You can put the product in front of a buyer running on .NET and
  answer questions about coverage with evidence.
- **First-customer grade (~800 points): 26–39 working days.** Phases 1–8. One
  .NET-required customer tenant could be operated — *provided* the backup and
  deployment work is done.
- **Full equivalence (~950): add 8–12 days** for the extended modules
  (marketplace, jobs, courses, podcasts, clubs and so on), and only if you decide
  they must be in the .NET edition. That is an open decision.

At roughly four substantive sessions a week, procurement grade lands in about
**four to six weeks**, first-customer grade in about **seven to ten weeks**.

### Why more agents will not make this much faster

Worth understanding, because it sets the realistic ceiling. Agents make the
*finding and fixing* nearly free. Four things do not parallelise:

1. **Verification.** The full test suite takes about 40 minutes and CI another
   20–35. Every batch must end green. That caps useful batches per day at
   roughly six to ten regardless of how many agents ran.
2. **Database migrations.** The .NET migration chain is linear and a test pins
   its end. Two agents adding migrations at once conflict. Schema work has to go
   through one agent at a time.
3. **One test environment.** There is a single disposable Laravel and a single
   Postgres for side-by-side comparison. Journeys that write data contend.
4. **Your decisions.** Six specific rows are blocked on you, listed at the bottom
   of the journey ledger. The one worth doing now is a tiny frontend change (a
   test hook on the feed card) that unblocks two feed journeys.

### What could make these estimates wrong

I have been wrong on this project before, so here is what I am watching:

- **Every journey certified so far has uncovered one to three real defects
  behind it.** If that rate holds in the admin area — where the do-nothing
  endpoints are concentrated — phase 7 is the one that could double.
- **215 Laravel database tables have no .NET counterpart.** We only build the
  ones journeys need, but we do not yet know which journeys need which, and
  schema work serialises.
- **Live payment, push and identity providers cannot be simulated.** Those need
  real credentials against real services and are gated on you.

## The plan in one line

Certify journeys, in order, from the finite list; bank the score at every phase;
fix the backups. Nothing else is on the critical path.
