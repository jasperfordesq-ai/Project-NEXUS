<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Current Mobile Production Status

Last reviewed: 2026-08-30

Status: **Maintained — the only document that states the mobile app's current score**

<!-- doc-consistency: MOBILE_M1_RUBRIC=M1 -->
<!-- doc-consistency: MOBILE_M1_CURRENT_SCORE=708/1000 -->
<!-- doc-consistency: MOBILE_BANKED_FLOOR=708 -->
<!-- doc-consistency: MOBILE_RUBRIC_CATEGORY_COUNT=10 -->

Read this first, then [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) for what to do next and
[`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) for the work list. Do not publish a
competing score anywhere.

## The headline

**708 / 1000 banked on rubric M1.** Commit `4c38d229a` is pushed and all six workflows are
green, including the 28-job CI pipeline, Android release gate, CodeQL and security scan. The
Android app is publicly installable from Google Play and
its core timebanking, messaging, volunteering and marketplace journeys have been walked on
devices. The public listing, Data Safety panel, content rating, policy URLs, production
signing, Sentry project and source-map path now exist. Genuine 7-inch and 10-inch emulator
captures also prove that three high-value screens render at tablet sizes.

Apple preparation has moved ledger row 7.18 from OPEN to PARTIAL. The app compiled in EAS's
macOS iOS Simulator toolchain, its final `.app` was inspected, and the exact-source unsigned
Release app for commit `58654079a` completed the four-screen iPhone 16 Pro Max Simulator tour
in green workflow run `33286909272`. The working ledger recomputes to 0.728 while the
published M1 floor remains 708/1000. This is genuine Simulator runtime evidence, but it is
not signing, TestFlight, APNs, universal-link or physical-iPhone evidence.

This is not a claim that the next build is ready to upload. The public build predates the
fresh-install community-picker correction in the working tree; the exact next signed Play
artefact still needs a clean-install and upgrade walk on a physical phone. The live store
description also says that no money changes hands anywhere, while the app supports purchases
of physical marketplace goods. That wording must be corrected before another release is
submitted. Internationalisation, signed-distribution evidence and human-operated
accessibility remain material gaps. Local effect automation, response-contract coverage and
accessibility breadth were materially expanded on 2026-08-30 and await exact-commit CI.

🔴 **Why the score is not higher, given 377 green test suites and 2,611 passing tests.**
Most tests still run in Node against mocks. The ledger deliberately gives journey credit
only when a device walk verifies the effect, and only gives full credit when an automated
guard can fail on regression. Rubric M1 measures demonstrated product behaviour, not the
size of the test suite or the fact that the app has reached production distribution.

## Source-only critical-journey audit — 2026-08-27

Eight release-critical paths were re-read against their API calls and focused tests without
running Expo or producing an artefact: fresh install/community selection and login;
returning-session routing; home/feed; listings and the exchange workflow; wallet; messages;
notifications; and account deletion. The review found four repair areas:

1. A slower initial paginated request could overwrite a newer completed refresh, and a filter
   change during an in-flight request could fail to start its replacement. The shared hook now
   rejects superseded responses and releases the old fetch lock, protecting feed, listings,
   messages and every other consumer.
2. A community load failure could still be remembered and followed by navigation, while one
   signed-in switch failure escaped without member feedback. Selection now restores the last
   usable community (or the neutral first-install state), stays on the picker and explains the
   failure.
3. Wallet refresh omitted the separate pending-transactions request.
4. Notifications pull-to-refresh omitted the authoritative unread-count request.

Each behaviour has a regression test that was observed failing before the source fix. Login,
cached-session restoration, message send/recovery and deletion were inspected and already
had the required guarded failure behaviour; no speculative change was made to them. This is
stronger source evidence, not device evidence, so the banked M1 score remains **708/1000** and
the public/reviewed Play artefact is untouched. The exact next artefact still needs the
physical-phone walk already listed below. The two lower-severity observations from this audit
are now fixed in source and guarded: the wallet pull indicator follows request completion, and
a failed listing save rolls back and gives visible translated feedback. They remain explicitly
unverified on a distributed device until the next-artifact walk.

A follow-up non-build sweep removed the last two fixed-duration pull-to-refresh indicators:
Explore no longer stops after 650 ms, and Exchange Detail no longer stops after 1.2 seconds or
replaces already-loaded content with a full-page spinner. The same sweep found the sole
remaining error-haptic-only mutation path: failed comment reactions now reload authoritative
state and show a translated danger toast. All three guards were observed RED before the source
fix and GREEN afterwards. They remain source evidence, not distributed-device evidence.

## Banked score

Rubric **M1**. Fixed denominator, ten fixed-weight categories. Every category was reconciled
against current evidence on 2026-08-26; journey credit remains formula-driven from the
ledger, while non-journey increases below name the new evidence that earned them.
The table keeps the rubric's historical `Banked` column name because the score checker reads
that contract; its 708 total is now committed and CI-backed.

| Category | Weight | Banked | Maximum | Basis |
| --- | ---: | ---: | ---: | --- |
| Journey certification | 300 | 214 | 300 | The banked source remains the previous floor pending exact-commit CI. The working ledger is **0.728**: 62 CERTIFIED, 58 PROVEN, 0 RENDERS and 10 PARTIAL over 137 scoring rows, which would round to 218/300 after banking. Four PROVEN rows moved only because resettable Android journeys now verify their Laravel effects independently: offer creation, volunteering application, event RSVP and connection request. Messaging and marketplace-save effects are also guarded but do not create new ledger rows. |
| Capability parity with the website | 120 | 72 | 120 | 🔴 The hand-comparison of ten capabilities missed TWO whole capabilities that were absent from the app: the exchange workflow (accept/decline/start/complete/confirm plus any list of your exchanges) and feed moderation (hide, not-interested, mute, report — a safeguarding capability the website has had since the V2 feed). Both have now been built and walked. Raised by 8 for the two builds. Raised a further 4 on 2026-08-23 for writing a feed post, which this table had itself recorded as absent since 2026-08-22 — so that credit is for closing a known gap, not for the comparison getting better. The figure stays well short of full because the comparison is still only eleven capabilities deep and has twice proved incomplete |
| Interaction integrity | 100 | 74 | 100 | Posting a listing, an event or a group used to leave the member on the filled form with no confirmation — a duplicate-post trap — now fixed for all three. Sheets open, stay open, and close when the screen under them goes away. Deep links were fixed across parameter names, query strings and exchange/listing identity. All 165 sites that reported a failure without the server's reason now pass it on, walked against a real 409. The score remains conservative because shared-state refresh, offline/error states and destructive-action recovery have not been swept across the full app |
| Layout across device sizes | 80 | 60 | 80 | The 411dp and 360dp phone widths remain guarded. Genuine Android emulator captures now cover Listings, Wallet and Volunteering on both a 7-inch portrait device (1080×1920) and a 10-inch landscape device (2560×1440), and the Play validator enforces their dimensions and ratios. With only three tablet screens and no comprehensive tablet interaction sweep, the remaining 20 points are withheld |
| Accessibility | 60 | 38 | 60 | Contrast is gated. The authenticated current-source crawler verified all **37/37** fingerprint-gated routes and 279 targets at the emulator's actual 420dpi: zero below the WCAG 24dp floor, 147 above that floor but below Android's 48dp guidance, and five clipped viewport fragments excluded from sizing failures. Dynamic text, images and transient geometry are excluded from settlement, while a changing actionable/scrollable node set still prevents a pass; exact bounds come from the accepted final tree. TalkBack is installed and enabled, and keyboard focus is visible in UIAutomator, but spoken output and a full swipe/double-tap journey remain genuinely human/instrumentation-gated. |
| Internationalisation | 70 | 25 | 70 | Seven locales ship, and the shrink-only gate now reports **zero** multi-word phrases still identical to English: ga 0, de 0, fr 0, it 0, pt 0 and es 0. All 4,531 original guarded entries were translated or narrowly allowlisted as registered product names, international units, machine-readable formats or genuinely shared words. The work covers coherent member journeys rather than scattered labels, including authentication, discovery, messaging, home, gamification, goals, exchanges, marketplace, federation, events, groups, profile/legal summaries, settings, volunteering, jobs, member collections and appreciations. This is automated catalogue integrity plus a reviewed AI translation pass—not native-speaker certification for any language. Arabic and right-to-left remain excluded from the native app by owner decision. |
| Automated test depth | 100 | 74 | 100 | `npm run test:ci` passed **377 suites / 2,611 tests** on 2026-08-30; the ratchet reports 76.40% global lines across 336 files, with type checking, zero-warning lint, 28 area floors and source guards. Two maintained Android flows now finish with seven independent Laravel effect assertions. The score does not rise for raw test count: the device flows remain a thin slice of 140 ledger journeys. |
| Observability and operations | 70 | 60 | 70 | The `nexus-mobile` Sentry project exists in the EU region, accepted a test event that was read back, production builds carry the DSN and upload source maps, and the nightly triage sweep includes it. JavaScript errors also reach the server-side app log. Ten points remain withheld until a real crash and cold-start trace from a Play-distributed build are observed end to end |
| Distribution and update lever | 60 | 55 | 60 | The app is publicly installable from Google Play, after internal testing, and the production listing was visibly live on 2026-08-26. Signed local AAB creation, Play App Signing, force-update, OTA update and rollback paths exist. Five points remain withheld because the exact next Play-signed artefact has not had the required clean-install plus upgrade walk on a physical phone |
| Store readiness | 40 | 36 | 40 | The public listing is live with 24 screenshot entries, a parental-guidance rating, Data Safety disclosures, deletion support and a signed production release. The privacy, terms, account-deletion, child-safety and contact URLs all returned HTTP 200 on 2026-08-26. Four points are withheld because the live description incorrectly claims that no money changes hands anywhere although physical marketplace purchases are supported; the prepared truthful copy already contains the required distinction |
| **Total** | **1000** | **708** | **1000** | — |

**Provenance.** Journey status comes only from the 140-row ledger below. The isolated Android
candidate now contains 377 Jest suites and 2,611 tests; its non-build Jest, TypeScript and lint
checks were re-run on 2026-08-30. The pre-review release baseline separately passed Expo Doctor
18/18, release policy, route/API/theme drift, production dependency acceptance, startup
budget, asset validation, network policy and the live TLS certificate chain. The public Play
listing was inspected directly while signed in and the five public policy/support routes were
requested independently. Tablet evidence is the genuine emulator output under
`store-listing/screenshots/tablet-{7,10}/`. The 2026-08-30 field audit classified all 201
typed getters: 101 live non-empty checks, 19 empty, 17 permission/error-blocked, 18 unresolved
and 46 explicitly client-mapped, with zero required fields missing from a checked response. A
separate three-role verifier accepted 15 populated high-risk contracts, including five
organisation-owner views that a primary-member-only probe correctly receives as 403. The
same day's submitted-artefact accessibility pass found additional informational chips in
Goals, Organisations and Settings; their source fixes are tested but cannot become device
evidence until the next build. Commit `4c38d229a` and all six workflows were green on
2026-08-27, so the source/test evidence above is banked; it is still not device evidence for
a build that does not yet exist.

🔴 **The banked floor ratcheted to 708 on 2026-08-27.** A published total may never fall. If scope is
rediscovered, record it in the ledger's RESERVE rows and show the delta; do not lower a
banked headline. A new rubric id legitimately resets the floor — M1 → M2 would.

## Ordered backlog before another Play build

1. **Correct the live Play description.** Replace the absolute “No money changes hands and
   nothing is ever put behind a payment” claim with the prepared distinction: time-credit
   exchanges use no money; optional marketplace purchases are physical goods and may use
   Stripe. This is a Console wording change, not an app build.
2. ~~**Close the organisation-deposit ledger gap.**~~ **Fixed and regression-tested
   2026-08-27.** `depositFromUser()` now writes the member's personal `transactions` row and
   the organisation ledger inside the same database transaction; the 19-test service suite
   (107 assertions) checks wallet visibility and idempotent replay. A device walk of the next
   artefact remains part of release acceptance below, not a reason to leave the defect.
3. ~~**Bank the current release candidate.**~~ **Done 2026-08-27.** Commit `4c38d229a` is
   pushed and all six workflows are green. No version code was changed and no artefact was
   built.
4. **Walk the exact next Play artefact on a physical phone.** Prove clean install → neutral
   picker → community login, upgrade from the public build → remembered community, signed-in
   return → home, messaging, one exchange, push arrival and disposable account deletion. On
   that same exact artefact, throttle the connection and prove Wallet pull-to-refresh stays
   active until the last balance/history/fund/pending request settles, then force both a listing
   save and unsave request to fail and prove the optimistic icon rolls back while a visible
   translated error is announced. Also throttle Explore and Exchange Detail independently and
   prove each refresh indicator follows its request without blanking loaded detail content;
   force a comment reaction to fail and prove authoritative state returns with a visible
   translated error. Do not mark any of these checks complete from Jest or an emulator.
5. **Increase response-contract evidence.** The 2026-08-30 read-only run classified all 201
   typed getters and found zero missing required fields across 101 live non-empty checks. It
   honestly left 19 empty, 17 permission/error-blocked, 18 without a resolvable record id and
   46 deliberately reshaped in the client. A three-role gate separately accepts 15 populated
   high-risk contracts, including the five organisation-owner views the generic member audit
   correctly cannot access. Remaining work is deeper real-shape validation for mapped money,
   authentication, messaging and exchange boundaries—not relabelling explicit gaps as proof.
6. **Reduce member-facing quality debt.** The guarded translation baseline is now zero across
   all six non-English shipped locales, but every language still needs native-speaker
   certification. TalkBack has not driven a complete spoken journey. The current-source target
   audit now defines 37 authenticated routes and reports the WCAG 24dp floor separately from
   Android's 48dp guidance; pixel assertions still cover only a small stable subset. Repeated public-entry
   captures are pixel-identical on a phone, 7-inch portrait tablet and 10-inch landscape
   tablet, but they exercise the older submitted APK. The new 720dp tablet width caps and
   accessibility fix must be rechecked in the exact next build. An attempted protected-route
   crawl on the submitted APK could not create an authenticated fixture session: that
   installed artefact rejected the local-only E2E account, while the local Laravel contract
   probe authenticated successfully. No protected-screen result was inferred from that
   failed login.
7. **Pay down engineering headroom.** The 529-warning lint backlog was cleared on
   2026-08-27: Jest/CommonJS false positives are scoped to test and configuration files,
   real warnings were fixed, and `eslint .` now passes with zero warnings. The latest recorded
   Android Hermes startup bundle is 14.87 MB, leaving 1.48 MB below its 16.35 MB blocking
   ceiling. This is an internal JavaScript regression budget, not an App Store download-size
   limit; no Play artefact was built or uploaded while the release is under review.

## The blockers, in the order they hurt

Four were listed on 2026-08-21. **All four are now cleared; Blocker 3 was fixed on
2026-08-27.** The
numbering and historical accounts are kept so references from the ledger still resolve.

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

The later walks closed the old Tier 3 list: decline is PROVEN, messaging and skills-driven
matching are CERTIFIED, and the ledger now records 8 CERTIFIED plus 11 PROVEN of 19 in-scope
rows. The text above remains the diagnosis of the original blocker, not the current backlog.

### Blocker 3 — A member's wallet statement does not reconcile — **CLEARED 2026-08-27**

Funding an organisation wallet debits the organiser correctly (measured 90.00 → 85.00) and
the organisation records receiving it, but **no row is written to the member's own
history** — their wallet still reported `transaction_count: 1`. Nothing was lost or minted,
but the member statement was incomplete. The endpoint now writes both ledger entries inside
the same database transaction. The focused 19-test / 107-assertion service suite checks the
personal debit returned by wallet history and prevents idempotent replay from duplicating it.
The separate `total_earned` observation remains future investigation rather than being
silently mixed into this repair.

### Blocker 4 — You cannot write a post from the phone — **CLEARED 2026-08-23**

The native composer was built and walked: `POST /v2/feed/posts` returned 201, the post opened
on its detail screen and the feed re-read it on focus. Ledger row 2.9 is CERTIFIED. Images,
polls and a visibility picker remain deliberate parity boundaries, not evidence that the
basic post journey is absent.

## What a green pipeline actually proves

| Gate | Command | What it proves | What it does not |
| --- | --- | --- | --- |
| Unit/component suite | `npm run coverage:check` | 376 suites / 2,600 tests on 2026-08-30 | Runs primarily in Node against mocks; the emulator walk, not Jest, proved startup |
| Coverage ratchet | `npm run coverage:check` | 28 area floors plus a global floor, shrink-only | Nothing about whether covered code is reachable |
| Types | `npm run type-check` | `tsc --noEmit` strict, clean | Nothing about layout or runtime |
| Lint | `npm run lint` | 0 errors under a warning cap | — |
| API contract | `npm run api:check` | **462 endpoints, 0 missing or method-mismatched** across 551 call sites | Reachability does not prove every response shape |
| Route parity | `npm run drift:check` | 256 React routes vs 162 mobile; every route has a recorded decision | 🔴 Compares **routes**. A capability without a URL can remain invisible |
| Release policy | `npm run verify:release` | 11 assertions incl. channel pinning | — |
| Network policy | `npm run verify:network-security` | certificate pins present and not expiring | — |
| Certificate pins | `npm run check:cert-pins` | pins match what the server presents | — |
| Themes | `npm run themes:check` | generated tenant palettes match source | — |
| Play asset gate | `npm run store:assets:check` | Icon, feature graphic, 16 phone and 6 tablet files meet Play's format/dimension rules | It does not prove the screenshots are attractive or that every app screen fits a tablet |
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
