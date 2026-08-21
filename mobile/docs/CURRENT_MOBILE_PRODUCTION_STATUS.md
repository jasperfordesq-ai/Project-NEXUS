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
<!-- doc-consistency: MOBILE_M1_CURRENT_SCORE=455/1000 -->
<!-- doc-consistency: MOBILE_BANKED_FLOOR=455 -->
<!-- doc-consistency: MOBILE_RUBRIC_CATEGORY_COUNT=10 -->

Read this first, then [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) for what to do next and
[`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) for the work list. Do not publish a
competing score anywhere.

## The headline

**455 / 1000 on rubric M1.** The app is well-built code around a largely unproven product.

It builds, signs, installs on a real phone, and the volunteering journey works end to end
with the credits reconciling in both ledgers. **Bottom sheets now open** — fixed and walked
on 2026-08-21, with a comment and a threaded reply written from the app and found in the
database — which returns comments, card menus, the reactor list and every other sheet across
sixteen screens to service. Against that: a
member still cannot write a post to the community feed because no such capability exists; the
core timebanking exchange — request, accept, complete, credit — **has never been walked on a
device**; and a member's own wallet statement does not reconcile with their balance.

🔴 **Why the score is not higher, given 303 green test files and 2,031 passing tests.**
Those tests run in Node against mocks. They have never demonstrated that a member can
complete anything. Rubric M1 exists because the previous readiness document scored code
thoroughly and the product barely at all, and the app reached that state of green while
three separate controls sat unreachable on the first screen a member sees.

## Banked score

Rubric **M1**. Fixed denominator, ten fixed-weight categories. Every figure re-measured on
2026-08-20/21; none is inherited from the previous readiness document.

| Category | Weight | Banked | Maximum | Basis |
| --- | ---: | ---: | ---: | --- |
| Journey certification | 300 | 86 | 300 | Ledger overall credit **0.287** × 300 = 86.1. 16 CERTIFIED, 26 PROVEN, 26 RENDERS, 5 PARTIAL of 138 scoring rows |
| Capability parity with the website | 120 | 60 | 120 | 10 capabilities compared by hand: 8 matched, 1 absent (feed post), 1 an owner decision. The remaining surface is uncompared, and the route-based gate cannot see it |
| Interaction integrity | 100 | 65 | 100 | Sheets open and stay open — walked on four families (card menu, comments incl. reply, the reactor list, and a form sheet inside a modal screen), plus swipe-to-dismiss, and guarded. Deep-link parameters and `?tab=` fixed. Still unmeasured: 186 error-message sites and touch-target sizes |
| Layout across device sizes | 80 | 45 | 80 | Two widths exercised (411dp, 360dp); 5 defects found and all guarded. Only one width ever tested before 2026-08-20 |
| Accessibility | 60 | 20 | 60 | Contrast gated; 2 of 44 controls unlabelled; no screen-reader pass, no touch-target audit, no RTL |
| Internationalisation | 70 | 25 | 70 | 7 of the platform's 11 locales; ≥3,232 multi-word phrases still English across six; `ar` blocked for want of RTL |
| Automated test depth | 100 | 70 | 100 | 303 suites / 2,031 tests, 0 skipped, 0 quarantined, 28 coverage floors, 12 source-scanning guards — and **zero automated device journeys**. Unchanged from 70: the sheet guard is real, but a suite that stayed green through the sheet outage has not earned more credit |
| Observability and operations | 70 | 40 | 70 | Crash reports reach our own API as well as Sentry, so no account is needed; never verified from a real crash; no mobile Sentry project |
| Distribution and update lever | 60 | 40 | 60 | Local APK build, verified byte-for-byte through the public link; force-update, rollback and update-ready all exist. Nothing has been distributed to a member |
| Store readiness | 40 | 4 | 40 | No listing, screenshots, public privacy URL or Data Safety answers; signing keystore still a decision |
| **Total** | **1000** | **455** | **1000** | — |

**Provenance.** Evidence SHAs `edcee0ba9` (push fix), `38a0c65a8` (mobile fixes) and `b3e9047c6` (findings), on a
dirty tree with this documentation restructure in flight. Laravel API at the same commit.
Two emulators, `nexus_test` (411dp) and `nexus_test_b`, against the local Laravel API and —
for the release build — the live API. The bottom-sheet fix and the two categories it moved
were measured on `nexus_test` on 2026-08-21 against the local Laravel API.

🔴 **The floor is 455 and it ratchets.** A published total may never fall. If scope is
rediscovered, record it in the ledger's RESERVE rows and show the delta; do not lower the
headline. A new rubric id legitimately resets the floor — M1 → M2 would.

## The blockers, in the order they hurt

Four were listed on 2026-08-21. **Blocker 1 is cleared**; three remain. The numbering is kept
so that references from other documents and from the roadmap still resolve.

### Blocker 1 — Bottom sheets never open — **CLEARED 2026-08-21**

Kept rather than deleted, because the cause is the most instructive thing in this document
and because four earlier repair attempts failed on a wrong diagnosis that this section
repeated.

**The cause was a workaround, not the library.** `useDeferredBottomSheetState` flipped the
sheet open and then bounced it closed→open again 220 ms later, on the theory that the first
`snapToIndex` could be swallowed by a sheet that had not measured yet. Flipping back to
closed makes HeroUI Native call `close()`, and its own swipe-close detector reads the
resulting animation as a pan-down dismissal — so the workaround manufactured a real
dismissal. Removing the bounce fixed every sheet.

**Why it read as a dead button.** The sheet *did* open. It slid into view and closed itself
inside about a third of a second, so a screenshot taken one or two seconds after the tap
showed nothing at all — which is what "nothing renders" in the earlier version of this
section actually was. Frame-by-frame capture immediately after the tap caught it mid-slide;
that single measurement changed the whole diagnosis.

**Two wrong turns, recorded so they are not repeated.** The working hypothesis was that the
library's portal host has no layout and the sheet was landing in a zero-height container. It
is not: `BottomSheet.Portal` already wraps its children in an absolutely-filled view, and a
debug marker placed inside the portal appeared on screen. A custom portal host was built and
then removed. That experiment also produced a lesson worth keeping: an overlay view given
`pointerEvents="box-none"` **as a prop** swallowed every tap in the app — the feed rendered
and neither a card menu nor the Listings tab responded. In this React Native version it is
the style form that is applied.

**Verified on 2026-08-21, emulator `nexus_test`, local Laravel API:**

- Card "…" menu: opens and stays open, 3 of 3 open/close rounds. Mutation-checked — with the
  bounce restored it is closed at +3 s in 3 of 3 rounds.
- Comment sheet: opens, a comment was typed and sent, `comments` row 168 written and the
  comment rendered back in the sheet.
- Threaded reply: "Replying to E2E UserA" pill, sent, `comments` row 169 written with
  `parent_id = 168`. The card's own count went 1 → 2 comments without a refresh.
- Reactor list: reacted to the post, tapped the reaction summary, `ReactorsSheet` opened and
  listed the right member (`GET /api/v2/reactions/post/183/users/like`).
- A form sheet inside an Android `presentation: 'modal'` screen (Goals → "Add goal"): opens
  with its keyboard and focused field, and swipe-down dismisses it.
- Guard: `components/ui/bottomSheetOpenFlip.test.ts`, red with the bounce restored.

🔴 The guard is a **source** check, and says so in its own comment. The behavioural version
cannot fail: under jest's fake timers React collapses the bounce, so the rendered sequence is
`[false, true]` either way. A test that reports the fix and the defect identically is worse
than no test.

**Still not confirmed on the owner's own phone**, and the fix is not in any installed build —
it needs a new APK.

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
