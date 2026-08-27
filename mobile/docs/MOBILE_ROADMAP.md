<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Roadmap to Production

Last reviewed: 2026-08-26

Status: **Maintained — the plan. Phases are ordered; do not reorder them without a reason
written here.**

Current position: **708 / 1000 local candidate on rubric M1** (629 remains the
committed/CI-backed floor until this candidate is pushed and green) — see
[`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md). Work list:
[`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md). Session hand-off, including what this
plan is missing: [`MOBILE_HANDOFF.md`](MOBILE_HANDOFF.md).

The score is owned and enforced by the status document; this line is only a pointer. The
short current backlog is now also maintained there under “Ordered backlog before another
Play build”. The phases below retain the history and exit criteria that explain how the app
got here; where a phase's old plan differs from measured reality, the measured result wins.

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

## Phase 3 — Walk and certify the core exchange — **MOSTLY DONE 2026-08-21**

**The plan was wrong about the problem.** It said the journey had "never been walked on a
device", which assumes the app could do it. It could not: `lib/api/exchanges.ts` called three
of the server's twelve exchange endpoints, so there was no accept, decline, start, complete or
confirm anywhere in the app, and no screen that listed your exchanges. The phase therefore
became a build, then a walk.

**Built:** `lib/api/exchangeRequests.ts` (the whole workflow plus a pure
`exchangeRequestActions` that mirrors the server's guards), `(modals)/exchange-requests.tsx`,
`(modals)/exchange-request-detail.tsx`, the `/exchanges/:id` vs `/listings/:id` link split in
both deep-link paths, and 62 translation keys in each of the seven mobile locales.

**Walked across two emulators, verified in the database at every step:** request (row 61) →
accept → start → mark done → provider confirms 1.00 h → requester confirms 1.00 h → status
`completed`, `transactions` row 269, UserA 85.00 → 86.00, UserB 27.00 → 26.00, and the
requester's own wallet on the device showing "Exchange #61 … −1h".

**Exit criteria, against what was achieved:**

| Planned | Result |
| --- | --- |
| Rows 3.6–3.12 at PROVEN or better | Achieved. 3.8 decline is PROVEN and 3.9 messaging is CERTIFIED; the later device walks are recorded in the ledger rather than retrofitted into the original 2026-08-21 plan |
| Credits demonstrably move, both ledgers checked | ✅ balances, `transactions`, `exchange_requests.transaction_id`, both members' wallet views |
| Any dead end found is fixed or recorded | ✅ the notification link dead end ("Listing not found") is fixed; two findings recorded in the status document — the workflow being off by default, and stale two-party screens |

**Ledger movement achieved:** Tier 3 credit 0.150 → **0.350** (planned ≥ 0.60; the gap is
3.8, 3.9 and the six rows that were never in this phase — search, editing, withdrawing,
group exchanges, skills matching, reporting). Journey certification 86 → **94** (planned
≥ 130, which assumed all of Tier 3).

**Current state:** every in-scope Tier 3 row is at least PROVEN; eight are CERTIFIED and
eleven are PROVEN. The next movement is automation that converts repeatable PROVEN walks to
CERTIFIED, not rediscovery of the old missing workflow.

## Phase 4 — The remaining two-party journeys (Tier 5) — **STARTED 2026-08-21**

**Messaging is done and CERTIFIED.** Walked across the two emulators: UserB sent "Hi"
(`messages` 545), the recipient's device showed **1 unread**, opening the thread flipped
`is_read` to 1, and the reply came back as row 546. Rows 5.12, 5.13 and 5.14 are CERTIFIED —
the send path is guarded by `app/(modals)/thread.test.tsx` and the badge by
`app/(tabs)/messages.test.tsx`.

🔴 Note for whoever picks this up: `(modals)/chat.tsx` is the **AI assistant**, not member
messaging. Member threads are `(modals)/thread.tsx`, and the `messages` table's body column is
`body`, not `content`.

**Connections and groups are done too (2026-08-22).** Connection request sent and accepted
across the two devices (`connections` row 160), and — because tenant 2 had **no groups at
all** — a group was created, joined from the second device, and a discussion started in it
(`groups` 974, `group_members`, `group_discussions` 49 + `group_posts` 48). Two defects on the
connections screen were fixed on the way: a raw translation key on screen, and a pending
request labelled "Connected".

**Money moved a second way (2026-08-22):** sending credits member-to-member from the wallet,
86.00 → 85.00 and 26.00 → 27.00, `transactions` row 270. That walk found every text field in
the app being sized by its own content — fixed once in `components/ui/Input.tsx`.

**Events are done too (2026-08-22):** an event was created, published behind a confirmation
that names what publishing triggers, and RSVP'd by the second member (`events` 162,
`event_rsvps` 1009).

**Current state:** all 34 Tier 5 rows are at least PROVEN; 18 are CERTIFIED and 16 are
PROVEN. Poll creation/voting, voice messaging, marketplace buy/sell, job application and
event check-in were all walked after this phase began. As in Phase 2, the remaining work is
to automate the 16 PROVEN effects so they can regress loudly.

**Exit criteria:** Tier 5 credit 0.400 → ≥ 0.50.

## Phase 5 — Money integrity

**Problem (Blocker 3) — FIXED 2026-08-27.** A member's balance moved with nothing in their
own history to explain it. Measured: 90.00 → 85.00 while the wallet reported
`transaction_count: 1`.

**Resolution.** The deposit endpoint now writes the personal `transactions` debit and the
organisation reconciliation row in the same database transaction. The focused service suite
passes 19 tests / 107 assertions and checks member wallet visibility plus idempotent replay.
The separate `total_earned` arithmetic observation remains a future investigation rather
than being silently bundled into this correction.

**Exit criteria:** every balance movement produces a member-visible row; a test fails if a
balance changes without one; row 6.2 moves PARTIAL → CERTIFIED.

## Phase 6 — Width, accessibility and language

- **Width.** The 360dp and 411dp phone checks remain; genuine 7-inch and 10-inch tablet
  captures now cover Listings, Wallet and Volunteering. Sweep the remaining screens and
  interact with forms/sheets at tablet sizes rather than treating listing captures as full
  layout certification.
- **Accessibility.** The live accessibility tree and touch targets have been audited across
  24 screens and all measured sub-24dp targets were fixed. A TalkBack-operated journey end
  to end and the remaining screen breadth are still open.
- **Error messages.** 186 sites across 57 files discard the server's explanation.
  `lib/api/describeApiError.ts` exists and is applied on walked paths. Sweep deliberately,
  a module at a time, judging each site's wording — not with a blind replacement.
- **Language.** The shrink-only gate currently records 4,638 phrases still identical to
  English across ga/de/fr/it/pt/es. Arabic remains deliberately out of native scope.

**Exit criteria:** Layout 45 → ≥ 65; Accessibility 20 → ≥ 40; Interaction integrity ≥ 80.

## Phase 7 — Distribution and the store — **PUBLIC 2026-08-26**

Only after Phases 1–3. Shipping an app whose core exchange is unproven is the one thing
this plan will not do.

- Google Play production distribution, Play App Signing, a real upload keystore, listing,
  screenshots, Data Safety, content rating and public policy pages are live.
- The remaining signing task is an encrypted offline copy of the verified upload-key backup.
- The live description must distinguish money-free time-credit exchanges from optional
  physical marketplace purchases; its current absolute no-money claim is false.
- The exact next Play-signed build needs a clean-install and upgrade walk on a physical
  phone. The public build does not contain the fresh-install picker correction in the
  working tree.
- iOS remains row 7.18 OPEN under the owner's explicit all-platform target.

**Exit criteria:** the numeric targets are achieved (Store readiness 36, Distribution 55).
The first-install-by-another-person and next-artefact physical-phone walk remain operational
release criteria, not grounds to pretend public distribution has not happened.

## Owner decisions to schedule

These are not engineering tasks and no phase depends on guessing them.

| Decision | Why it needs you | Cost of deciding late |
| --- | --- | --- |
| **Write a post from the phone?** The website has a composer; the app has none | New feature, product scope | Members will ask for it the day the app ships |
| **Translations: 3,232 phrases across five languages** | Machine translation is cheap and imperfect; a person is slower and better | Every new string added meanwhile widens the gap |
| **Signing keystore backup location** | The upload key exists and is verified; only the owner can choose encrypted offline custody | A lost upload key is replaceable under Play App Signing, but recovery causes avoidable release delay |
| **Mobile Sentry real-crash acceptance** | Project, DSN and source maps are configured; deliberately crashing a public build needs a controlled test | Without it, native-crash and cold-start observability are configured but not proved end to end |
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

708 today. The remaining gap is no longer “get into a store”; it is converting 62 PROVEN
journeys into durable certification, expanding response-shape/accessibility/visual evidence,
completing translations and proving
the exact next Play artefact before upload.
