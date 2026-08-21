<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Current Mobile Production Status

Last reviewed: 2026-08-21

Status: **Maintained — the only document that states the mobile app's current score**

<!-- doc-consistency: MOBILE_M1_RUBRIC=M1 -->
<!-- doc-consistency: MOBILE_M1_CURRENT_SCORE=408/1000 -->
<!-- doc-consistency: MOBILE_BANKED_FLOOR=408 -->
<!-- doc-consistency: MOBILE_RUBRIC_CATEGORY_COUNT=10 -->

Read this first, then [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) for what to do next and
[`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) for the work list. Do not publish a
competing score anywhere.

## The headline

**408 / 1000 on rubric M1.** The app is well-built code around a largely unproven product.

It builds, signs, installs on a real phone, and the volunteering journey works end to end
with the credits reconciling in both ledgers. Against that: **bottom sheets do not open at
all**, which takes comments, card menus and reactor lists out of sixteen screens; a member
cannot write a post to the community feed because no such capability exists; the core
timebanking exchange — request, accept, complete, credit — **has never been walked on a
device**; and a member's own wallet statement does not reconcile with their balance.

🔴 **Why the score is not higher, given 302 green test files and 2,027 passing tests.**
Those tests run in Node against mocks. They have never demonstrated that a member can
complete anything. Rubric M1 exists because the previous readiness document scored code
thoroughly and the product barely at all, and the app reached that state of green while
three separate controls sat unreachable on the first screen a member sees.

## Banked score

Rubric **M1**. Fixed denominator, ten fixed-weight categories. Every figure re-measured on
2026-08-20/21; none is inherited from the previous readiness document.

| Category | Weight | Banked | Maximum | Basis |
| --- | ---: | ---: | ---: | --- |
| Journey certification | 300 | 79 | 300 | Ledger overall credit **0.264** × 300 = 79.2. 14 CERTIFIED, 24 PROVEN, 26 RENDERS, 5 PARTIAL of 138 scoring rows |
| Capability parity with the website | 120 | 60 | 120 | 10 capabilities compared by hand: 8 matched, 1 absent (feed post), 1 an owner decision. The remaining surface is uncompared, and the route-based gate cannot see it |
| Interaction integrity | 100 | 25 | 100 | Bottom sheets dead across 16 screens; 3 deep links were handing screens the wrong parameter; `?tab=` honoured only on a fresh open |
| Layout across device sizes | 80 | 45 | 80 | Two widths exercised (411dp, 360dp); 5 defects found and all guarded. Only one width ever tested before 2026-08-20 |
| Accessibility | 60 | 20 | 60 | Contrast gated; 2 of 44 controls unlabelled; no screen-reader pass, no touch-target audit, no RTL |
| Internationalisation | 70 | 25 | 70 | 7 of the platform's 11 locales; ≥3,232 multi-word phrases still English across six; `ar` blocked for want of RTL |
| Automated test depth | 100 | 70 | 100 | 302 suites / 2,027 tests, 0 skipped, 0 quarantined, 28 coverage floors, 11 source-scanning guards — and **zero automated device journeys** |
| Observability and operations | 70 | 40 | 70 | Crash reports reach our own API as well as Sentry, so no account is needed; never verified from a real crash; no mobile Sentry project |
| Distribution and update lever | 60 | 40 | 60 | Local APK build, verified byte-for-byte through the public link; force-update, rollback and update-ready all exist. Nothing has been distributed to a member |
| Store readiness | 40 | 4 | 40 | No listing, screenshots, public privacy URL or Data Safety answers; signing keystore still a decision |
| **Total** | **1000** | **408** | **1000** | — |

**Provenance.** Evidence SHAs `edcee0ba9` (push fix), `38a0c65a8` (mobile fixes) and `b3e9047c6` (findings), on a
dirty tree with this documentation restructure in flight. Laravel API at the same commit.
Two emulators, `nexus_test` (411dp) and `nexus_test_b`, against the local Laravel API and —
for the release build — the live API.

🔴 **The floor is 408 and it ratchets.** A published total may never fall. If scope is
rediscovered, record it in the ledger's RESERVE rows and show the delta; do not lower the
headline. A new rubric id legitimately resets the floor — M1 → M2 would.

## The four blockers, in the order they hurt

### Blocker 1 — Bottom sheets never open

Tapping "Comment" on a feed card fetches the comments
(`GET /api/v2/comments?target_type=listing&target_id=515`, confirmed in the API log) and
**nothing renders**. The card "…" menu behaves identically. Three consecutive taps changed
nothing but the status-bar clock.

**Sixteen files** import `components/ui/BottomSheet`: comments, the card overflow menu, the
reactor list, chat, exchange detail, goals, group detail, job detail, reviews, and five
marketplace screens. Everything behind a sheet is unreachable.

Ruled out by measurement, so do not re-litigate these: animation scales (all 1 on both
devices); root providers (`GestureHandlerRootView` flex 1 → `HeroUINativeProvider` →
`SafeAreaProvider`, correct order); library drift (`heroui-native` 1.0.4 installed *and*
lockfile-pinned, `@gorhom/bottom-sheet` 5.2.14); this session's own changes (fails
identically without them); the documented "tap 2–3 times" flakiness; and the inert-className
SafeAreaView on home (fixed in `38a0c65a8`, sheet still dead).

The sheet **mounts** — it runs its fetch — and never animates in. That is the exact failure
`components/ui/useDeferredBottomSheetState.tsx` was written to defeat; its own comments call
it "the dead comment sheet bug" where "sheets never appeared", and `git log` shows four
prior repair attempts on the component.

**Not confirmed on a real phone.** The owner has the app installed and can settle it in
seconds by tapping "Comment" under any feed post. Do that before spending a day on it.

### Blocker 2 — The core timebanking exchange has never been walked

Request → accept → complete → credits move → both parties see it. Twelve rows of Tier 3 are
OPEN. This is the reason the platform exists and it is the least proven tier in the ledger.
The volunteering tier proves the *pattern* works; it does not prove this journey does.

### Blocker 3 — A member's wallet statement does not reconcile

Funding an organisation wallet debits the organiser correctly (measured 90.00 → 85.00) and
the organisation records receiving it, but **no row is written to the member's own
history** — their wallet still reports `transaction_count: 1`. Nothing is lost or minted and
an admin can trace it, but a member watching their balance fall has nothing to explain it.
Not patched: it is a money path, and `total_earned` already reports 0 after a paid credit,
so the arithmetic wants review before anyone writes to it.

### Blocker 4 — You cannot write a post from the phone

No `createPost` in the client, no composer screen, and none of the Create sheet's eight
entries. The server has `POST /v2/feed/posts`; the website has a full composer. An owner
decision, not a repair — see the roadmap.

## What a green pipeline actually proves

| Gate | Command | What it proves | What it does not |
| --- | --- | --- | --- |
| Unit/component suite | `npm run test:ci` | 302 suites / 2,027 tests, 0 skipped, 0 quarantined | Runs in Node against mocks. Has never shown the app starts |
| Coverage ratchet | `npm run coverage:check` | 28 area floors plus a global floor, shrink-only | Nothing about whether covered code is reachable |
| Types | `npm run type-check` | `tsc --noEmit` strict, clean | Nothing about layout or runtime |
| Lint | `npm run lint` | 0 errors under a warning cap | — |
| API contract | `npm run api:check` | **402 endpoints, 0 missing** — every statically resolvable call exists in Laravel's routes | Dynamic calls; response shapes |
| Route parity | `npm run drift:check` | 254 React routes vs 137 mobile, every gap carries a decision | 🔴 Compares **routes**. A capability without a URL — the website's composer — is invisible |
| Release policy | `npm run verify:release` | 11 assertions incl. channel pinning | — |
| Network policy | `npm run verify:network-security` | certificate pins present and not expiring | — |
| Certificate pins | `npm run check:cert-pins` | pins match what the server presents | — |
| Themes | `npm run themes:check` | generated tenant palettes match source | — |
| Pixel gate | `node scripts/screenshots.mjs compare` | 3 screens, one fixed size, threshold 0.02 | 🔴 134 screens ungated, and one size only |
| Doc scores | `node scripts/check-doc-scores.mjs` | this rubric's arithmetic, its floor, and the ledger's own row counts | Nothing about the product |

🔴 **Two ways a suite goes green while the product is broken**, both observed here: a test
can assert the defect (the blog deep-link test pinned the wrong parameter name for months),
and jsdom has no layout engine, so nothing in the suite can see a control that has fallen
off the screen.

## Where the evidence lives

| Question | Document |
| --- | --- |
| How much is proved to work, and what to pick up | [`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) |
| The plan to production, in phases with exit criteria | [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) |
| How to run two accounts on two emulators | [`MOBILE_TEST_HARNESS.md`](MOBILE_TEST_HARNESS.md) |
| Everything measured before this restructure | [`HISTORY/PRODUCTION_READINESS_2026-08-21.md`](HISTORY/PRODUCTION_READINESS_2026-08-21.md) |
| Distribution mechanics | [`DISTRIBUTION.md`](DISTRIBUTION.md) |

## Rules for maintaining this document

1. **One score, here.** Never publish a competing total in a changelog, commit message or
   another document.
2. **No number without its command.** Every figure in the rubric table names how it was
   measured, inline. A figure copied forward from a previous edition is a defect.
3. **Move a category only from the ledger.** Journey certification is
   `round(300 × overall credit)` and nothing else.
4. **Never lower the headline.** A demotion is recorded in the ledger; the headline stays at
   the floor and republishes when the next net-non-negative banking happens.
5. **A new rubric id resets the floor and is not comparable to the old one.** State the id
   with every score. M1 measures how much of the product is proved to work; earlier mobile
   scores measured code quality and are not the same question.
6. **Verify before writing.** `node scripts/check-doc-scores.mjs` recomputes this table,
   asserts the floor, and recounts every ledger row. Run it before committing documentation.
