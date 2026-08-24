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
<!-- doc-consistency: MOBILE_M1_CURRENT_SCORE=611/1000 -->
<!-- doc-consistency: MOBILE_BANKED_FLOOR=611 -->
<!-- doc-consistency: MOBILE_RUBRIC_CATEGORY_COUNT=10 -->

Read this first, then [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) for what to do next and
[`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) for the work list. Do not publish a
competing score anywhere.

## The headline

**611 / 1000 on rubric M1.** The app is well-built code around a largely unproven product.

It builds, signs, installs on a real phone, and the volunteering journey works end to end
with the credits reconciling in both ledgers. **Bottom sheets now open** — fixed and walked
on 2026-08-21, with a comment and a threaded reply written from the app and found in the
database — which returns comments, card menus, the reactor list and every other sheet across
sixteen screens to service. **The core timebanking exchange now works end to end** — request,
accept, start, complete, both confirm, credits move — walked across two phones on 2026-08-21,
with the balances and the transaction row checked in the database. Half of it had to be built
first: the app could send a request and could do nothing else with it.

Against that: a member still cannot write a post to the community feed, because no such
capability exists; a member's own wallet statement does not reconcile with their balance when
they fund an organisation; and of the 140 journeys in the ledger, 31 have still never been
attempted. Member-to-member messaging was walked on 2026-08-21 too — sent, received with the
unread badge, read receipt, and replied to.

🔴 **Why the score is not higher, given 306 green test files and 2,057 passing tests.**
Those tests run in Node against mocks. They have never demonstrated that a member can
complete anything. Rubric M1 exists because the previous readiness document scored code
thoroughly and the product barely at all, and the app reached that state of green while
three separate controls sat unreachable on the first screen a member sees.

## Banked score

Rubric **M1**. Fixed denominator, ten fixed-weight categories. Every figure re-measured on
2026-08-20/21; none is inherited from the previous readiness document.

| Category | Weight | Banked | Maximum | Basis |
| --- | ---: | ---: | ---: | --- |
| Journey certification | 300 | 196 | 300 | Ledger overall credit **0.654** × 300 = 196.2. 52 CERTIFIED, 53 PROVEN, 11 RENDERS, 10 PARTIAL of 137 scoring rows — thirteen screens that had only ever been looked at were walked on a device on 2026-08-24, and one of them (resources) turned out never to re-read its own list — 137, not 138, because Arabic is now an excluded owner decision rather than an open gap. 🔴 The printed formula on this line and in the ledger had been stale since 2026-08-21 — it named 23 CERTIFIED and 26 RENDERS and its own arithmetic came to 55.30, which does not produce the quoted 0.520. The result was right; the shown working was not. Both are now restated from the ledger's summary row |
| Capability parity with the website | 120 | 72 | 120 | 🔴 The hand-comparison of ten capabilities missed TWO whole capabilities that were absent from the app: the exchange workflow (accept/decline/start/complete/confirm plus any list of your exchanges) and feed moderation (hide, not-interested, mute, report — a safeguarding capability the website has had since the V2 feed). Both have now been built and walked. Raised by 8 for the two builds. Raised a further 4 on 2026-08-23 for writing a feed post, which this table had itself recorded as absent since 2026-08-22 — so that credit is for closing a known gap, not for the comparison getting better. The figure stays well short of full because the comparison is still only eleven capabilities deep and has twice proved incomplete |
| Interaction integrity | 100 | 74 | 100 | Posting a listing, an event or a group used to leave the member on the filled form with no confirmation — a duplicate-post trap — now fixed for all three. Sheets open, stay open, and close when the screen under them goes away — a sheet renders through a portal, so one was found sitting on top of an unrelated screen after a deep link. Walked on four sheet families plus swipe-to-dismiss. Deep links fixed three times over: parameter names, `?tab=`, and `/exchanges/:id`, which answered "Listing not found". Error messages are no longer among the gaps: all 165 sites that reported a failure without the server's reason now pass it on, walked on a device against a real 409. Still unmeasured: touch-target sizes beyond the five audited screens |
| Layout across device sizes | 80 | 52 | 80 | Two widths exercised (411dp, 360dp); 5 defects found and guarded on 2026-08-20, and on 2026-08-22 **every text field in the app** was found sized to its own content rather than its container — the wallet's recipient search and the group discussion title shipped as pills. Fixed once in `components/ui/Input.tsx`; guarded. Still only two widths, still no tablet |
| Accessibility | 60 | 34 | 60 | Contrast gated. 🔴 **First screen-reader audit ever run, 2026-08-23**, with TalkBack over five screens: every control now carries a meaningful name, no accessible name contains an icon glyph, informational chips are no longer announced as buttons, and touch targets were measured at the real device density with the nine below the WCAG 2.2 AA 24dp minimum fixed. Raised by 14 for that. Still short of full: it was an audit rather than a journey driven end to end through the screen reader, five screens of roughly 137, a large group of controls sits at 40dp (above the AA floor, below Android's 48dp guidance), 91 files still take `Chip` straight from heroui-native, and there is no RTL |
| Internationalisation | 70 | 25 | 70 | 7 of the platform's 11 locales; ≥3,232 multi-word phrases still English across six — now IN scope by owner decision (2026-08-24) rather than parked. 🔴 Arabic and right-to-left are OUT of scope for the native app entirely, by the same decision: Arabic speakers are served by the web app and the accessible frontend, so the seven-locale set is deliberate and `ar` is not a gap to be counted |
| Automated test depth | 100 | 74 | 100 | 321 suites / 2,228 tests (`npm test`, 2026-08-24), 0 skipped, 0 quarantined, 28 coverage floors, 14 source-scanning guards — and the nine nightly Maestro device flows, which now all pass for the first time. 🔴 Raised by 4 for that, and the reason is worth reading: **six of the nine were failing, and none of them was a defect in the app.** A LogBox error banner sits over the bottom of the screen, on top of the tab bar, and swallows the tap — so every flow that taps a tab failed an assertion afterwards. Two had been red for days and four went red on 2026-08-24, while `npm test` was green and the whole CI pipeline was green. The banner came from a missing theme variable (`--border-strong`), now carried into the generated community themes; LogBox is also suppressed for the device-test build, because a suite an unrelated warning can break cannot report on the app. Still short of full: nine flows is a thin slice of 137 screens, and a suite that stayed green through the sheet outage and a missing half of the core exchange has not earned more than this. Unchanged from 70: the new tests are real, but a suite that stayed green through the sheet outage AND through a missing half of the core exchange has not earned more credit |
| Observability and operations | 70 | 40 | 70 | Crash reports reach our own API as well as Sentry, so no account is needed; never verified from a real crash; no mobile Sentry project |
| Distribution and update lever | 60 | 40 | 60 | Local APK build, verified byte-for-byte through the public link; force-update, rollback and update-ready all exist. Nothing has been distributed to a member |
| Store readiness | 40 | 4 | 40 | No listing, screenshots, public privacy URL or Data Safety answers; signing keystore still a decision |
| **Total** | **1000** | **611** | **1000** | — |

**Provenance.** Evidence SHAs `edcee0ba9` (push fix), `38a0c65a8` (mobile fixes) and `b3e9047c6` (findings), on a
dirty tree with this documentation restructure in flight. Laravel API at the same commit.
Two emulators, `nexus_test` (411dp) and `nexus_test_b`, against the local Laravel API and —
for the release build — the live API. The bottom-sheet fix and the two categories it moved
were measured on `nexus_test` on 2026-08-21 against the local Laravel API.

🔴 **The floor is 611 and it ratchets.** A published total may never fall. If scope is
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

### Blocker 2 — The core timebanking exchange has never been walked — **CLEARED 2026-08-21**

Walked end to end across two emulators: UserB requested UserA's listing, UserA accepted,
started and marked it done, both confirmed 1.00 hour, and the credits moved — UserA
85.00 → **86.00**, UserB 27.00 → **26.00**, `transactions` row 269, and the requester's own
wallet on the device shows "Exchange #61 … −1h".

🔴 **Half of the journey did not exist and had to be built.** This blocker was recorded as
"never walked", which implied the app could do it and nobody had tried. It could not.
`lib/api/exchanges.ts` called three of the server's twelve exchange endpoints — `config`,
`check` and `store` — so a member could send a request and then nothing at all: no accept, no
decline, no start, no complete, no confirm, no list of their own exchanges, no detail screen.
The provider's only route in was a notification whose link opened the LISTING screen with the
exchange's id and answered "Listing not found", because `/exchanges/:id` and `/listings/:id`
are different records and the app treated them as one.

Built: `lib/api/exchangeRequests.ts`, `(modals)/exchange-requests.tsx`,
`(modals)/exchange-request-detail.tsx`, the link split in `+native-intent.ts` and
`navigateToLink.ts`, and 62 translation keys in each of the seven mobile locales.

🔴 **Two things found while walking it, both worth keeping:**

1. **The exchange workflow is OFF by default.** With it off — the state of a fresh community —
   "Request exchange" reads "Request this service" and opens a message thread instead. That is
   the app correctly following `exchanges/config`, not a defect, but it means this journey
   cannot be walked on a default tenant. The local fixture switch is in the harness document.
2. **A two-party screen needs to re-read when it regains focus.** After the requester
   confirmed on the second emulator, the provider's already-open screen still said "Awaiting
   confirmation" and "Not confirmed yet" while the API said completed — deep-linking to the
   same id does not remount, so nothing refetched. The two new screens now refetch on focus.
   **No other screen in the app does**: there was no `useFocusEffect` anywhere before these
   two, so every screen showing shared state has the same property. Not swept.

Still open in Tier 3: declining and cancelling have never been walked, nor messaging the
other party about an exchange, nor skills-driven matching. Seven of twenty rows.

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
