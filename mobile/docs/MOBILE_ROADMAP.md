<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Roadmap to Production

Last reviewed: 2026-08-21

Status: **Maintained — the plan. Phases are ordered; do not reorder them without a reason
written here.**

Current position: **455 / 1000 on rubric M1** — see
[`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md). Work list:
[`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md).

## Why this order

The phases are ordered by **what unblocks the most measurement**, not by what looks most
finished. Two rules produced the order:

1. **A blocker that makes journeys unwalkable comes before the journeys.** This is what put
   bottom sheets — dead across sixteen screens — in Phase 1 ahead of everything social. That
   phase is now DONE (2026-08-21) and the rule stands: the next blocker, the unwalked
   timebanking exchange, is Phase 3.
2. **Automating what is already proven is cheaper than proving something new, and it stops
   the score sliding backwards.** Fifteen volunteering rows are PROVEN with no test. That is
   a day's harness work for 15 rows of durable credit, and every later journey inherits the
   harness. So it is Phase 2, before any new walking.

🔴 **The lesson this plan exists to avoid.** The ASP.NET workstream lost time because its
documentation recorded activity instead of state: two different test counts in one file, a
coverage table below its own passing floors, a workflow described as "never run" that had
run and failed. The mobile equivalent was worse — the readiness document scored code
carefully and the product hardly at all, so the app could reach 302 green test files while
three controls on the first screen a member sees were unreachable. Every phase below
therefore ends in a **ledger status change**, not in a description of effort.

## Phase 0 — Settle the sheet question — **DONE 2026-08-21**

Kept for the record. The question was to be settled by the owner tapping "Comment" on their
own phone before anyone spent a day on it. It was instead settled on the emulator by
burst-capturing frames immediately after the tap, which showed the sheet sliding INTO view
and then closing itself — an outcome neither row of the original table anticipated, because
both assumed a screenshot a second later told the truth.

It still has not been confirmed on the owner's phone, and the fix is not in any installed
build. That is now a Phase 7 (distribution) item, not a diagnosis step.

## Phase 1 — Make bottom sheets work — **DONE 2026-08-21**

**Cause.** `useDeferredBottomSheetState` bounced the sheet closed→open 220 ms after opening
it. That bounce made the library close the sheet for real. Full account, including the two
wrong turns, in [`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md)
§Blocker 1.

**None of the three planned approaches was used, and that is worth noting.** The plan
proposed replacing the animated sheet with a plain `Modal` for menu-like uses, driving gorhom
directly for the composer, or changing the library version. All three assumed the library was
at fault. The fix was to delete a workaround of our own — 40 lines removed, no dependency
touched, no component rewritten. A plan that assumes the third-party code is wrong will
usually cost more than one that measures first.

**Exit criteria, against what was actually achieved:**

| Planned | Result |
| --- | --- |
| Comment sheet, card menu and reactor list each open on a device | All three ✅, plus a form sheet inside an Android modal screen and swipe-to-dismiss. A comment AND a threaded reply were written from the app and found in the database (`comments` 168, and 169 with `parent_id = 168`) |
| A guard test that fails if a sheet stops opening, asserting non-zero height | Guard exists and is mutation-verified, but it is a **source** check, not a height assertion. The behavioural version cannot fail: jest's fake timers collapse the bounce, so it reports the fix and the defect identically |
| Ledger rows 2.5–2.8 move from BROKEN to at least PROVEN | All four ✅ — 2.5 and 2.6 CERTIFIED, 2.7 and 2.8 PROVEN |
| The 16 dependent files use the new path or are recorded as unchanged | All 16 are unchanged **by design** — the fix is inside the shared hook, so every sheet in the app was repaired at once |

**Ledger movement achieved:** Tier 2 credit 0.336 → **0.564** (planned ≥ 0.55).
Interaction integrity 25 → **65** (planned ≥ 60).

## Phase 2 — Automate what is already proven (PROVEN → CERTIFIED)

**Problem.** 25 rows are PROVEN: walked by hand, verified in the database, guarded by
nothing. They can regress silently, and re-walking them by hand every time is the slowest
possible way to keep them.

**Approach.** One Maestro flow per tier, run against the local Laravel API on the
two-emulator harness in [`MOBILE_TEST_HARNESS.md`](MOBILE_TEST_HARNESS.md). Assert the
**effect**, not the screen: read the database or the API after each step, exactly as the
volunteering walk did. Start with volunteering because it is fully mapped already.

**Exit criteria:**

- A committed flow that drives register organisation → publish → apply → approve → log
  hours → verify → credit, asserting the ledger rows at the end.
- The flow runs in CI, or — if the runner cannot host an emulator — is wired into the
  existing nightly device workflow with its result recorded.
- Ledger rows 4.1–4.15 move PROVEN → CERTIFIED.

**Ledger movement:** Tier 4 credit 0.536 → 0.93. Journey certification 86 → ≥ 112.

## Phase 3 — Walk and certify the core exchange (Tier 3)

**Problem.** Request → accept → complete → credits move → both parties see it has **never
been walked on a device**. Twelve Tier 3 rows are OPEN. This is the reason the platform
exists.

**Approach.** Two accounts, exactly as volunteering was done. Verify at each step in
`listings`, the request/acceptance tables, `transactions`, and both members' balances. Where
a step is blocked by a sheet, it waits on Phase 1 — which is why this is Phase 3.

**Exit criteria:**

- Rows 3.6–3.12 at PROVEN or better, each with a named database effect.
- Credits demonstrably move between two members on a device, with both ledgers checked.
- Any dead end found is fixed or recorded as BROKEN with a cause.

**Ledger movement:** Tier 3 credit 0.150 → ≥ 0.60. Journey certification ≥ 130.

## Phase 4 — The remaining two-party journeys (Tier 5)

Messages first — row 5.12 is a core journey that has never been walked. Then connections,
event RSVP, group join and post, poll voting.

**Exit criteria:** rows 5.12, 5.13, 5.14, 5.18, 5.19, 5.3, 5.8, 5.9, 5.21 at PROVEN or
better. Tier 5 credit 0.176 → ≥ 0.45.

## Phase 5 — Money integrity

**Problem (Blocker 3).** A member's balance moves with nothing in their own history to
explain it. Measured: 90.00 → 85.00 while the wallet reported `transaction_count: 1`.

**Approach.** Decide first whether the member-side ledger row is written by the deposit
endpoint or derived for display. Then fix `total_earned`, which reports 0 after a paid
credit — the arithmetic wants review before anything writes to it. A regression test per
movement type: volunteer payment, organisation deposit, member-to-member transfer.

**Exit criteria:** every balance movement produces a member-visible row; a test fails if a
balance changes without one; row 6.2 moves PARTIAL → CERTIFIED.

## Phase 6 — Width, accessibility and language

- **Width.** Sweep the remaining screens at 360dp (31 of ~137 done). The sweep flow and the
  density recipe are in the harness document. Expect more finds: five defects came out of
  the first two screens looked at.
- **Accessibility.** A screen-reader pass over one certified journey end to end; a
  touch-target audit; label the 2 remaining unlabelled controls.
- **Error messages.** 186 sites across 57 files discard the server's explanation.
  `lib/api/describeApiError.ts` exists and is applied on walked paths. Sweep deliberately,
  a module at a time, judging each site's wording — not with a blind replacement.
- **Language.** See the owner decision below.

**Exit criteria:** Layout 45 → ≥ 65; Accessibility 20 → ≥ 40; Interaction integrity ≥ 80.

## Phase 7 — Distribution and the store

Only after Phases 1–3. Shipping an app whose core exchange is unproven is the one thing
this plan will not do.

- Real signing keystore (owner decision below) and the backup of it.
- Public privacy-policy URL; store listing copy; screenshots; Data Safety answers.
- Play Families policy analysis — child sub-accounts likely trigger it; flag early.
- Narrow `ACCESS_FINE_LOCATION` or justify it in writing.
- iOS: never built or run. A separate decision, not a task.

**Exit criteria:** Store readiness 4 → ≥ 30; Distribution 40 → 55; a first install by
someone who is not the owner.

## Owner decisions to schedule

These are not engineering tasks and no phase depends on guessing them.

| Decision | Why it needs you | Cost of deciding late |
| --- | --- | --- |
| **Write a post from the phone?** The website has a composer; the app has none | New feature, product scope | Members will ask for it the day the app ships |
| **Translations: 3,232 phrases across five languages** | Machine translation is cheap and imperfect; a person is slower and better | Every new string added meanwhile widens the gap |
| **Signing keystore** | Losing the file means never updating the app again | Blocks any store submission; the debug key cannot be used |
| **Mobile Sentry project** | An external account | Crash reports currently land in our own API with no grouping |
| **iOS at all?** | Doubles the surface | Nothing in this plan assumes it |
| **Review composer on mobile** | Currently a recorded "read-only on mobile" decision | Fine to leave; just don't rediscover it as a gap |

## How to do the work

Read [`MOBILE_TEST_HARNESS.md`](MOBILE_TEST_HARNESS.md) before touching a device. The
short version:

1. Two emulators, `nexus_test` and `nexus_test_b`, ports 5554/5556. Two accounts.
2. A debug APK loads its JavaScript from Metro, so install once and both devices run
   current source.
3. Assert the **effect** — a row, a balance, an API response. A toast is not proof.
4. Walk at 411dp *and* 360dp. Three of five width defects were broken at every width and
   only looked like width bugs.
5. Update the ledger row in the same commit as the fix.

**Do not** press Android back to leave a screen (it exits the app), and **do not** edit
source mid-walk (Metro reloads and wipes the form). Both cost time in this session.

## What "production value" means here

A defensible answer to a single question: *if a member installs this, can they do the thing
the platform is for, and will we know when they cannot?*

That is reached when:

- Tier 3 — the core exchange — is CERTIFIED, not merely proven.
- No BROKEN row remains in Tiers 1–3.
- Every CERTIFIED row has a test that goes red on regression, and those tests run without a
  human present.
- Crash reports from a real device have been seen arriving.
- The rubric total is **≥ 700 / 1000** with Journey certification ≥ 200 / 300.

455 today. The gap is mostly Tiers 3 and 5, and most of it is walking journeys rather than
writing features.
