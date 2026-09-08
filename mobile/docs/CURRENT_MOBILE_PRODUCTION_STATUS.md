<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Current Mobile Production Status

Last reviewed: 2026-09-07

Status: **Maintained — the only document that states the mobile app's current score**

<!-- doc-consistency: MOBILE_M1_RUBRIC=M1 -->
<!-- doc-consistency: MOBILE_M1_CURRENT_SCORE=714/1000 -->
<!-- doc-consistency: MOBILE_BANKED_FLOOR=714 -->
<!-- doc-consistency: MOBILE_RUBRIC_CATEGORY_COUNT=10 -->

Read this first, then [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) for what to do next and
[`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) for the work list. Do not publish a
competing score anywhere.

## The headline

**714 / 1000 banked on rubric M1.** Exact-source Android workflow `33332261410` built mobile
commit `ee8b9e345`, completed all thirteen journeys and three independent effect suites, and
uploaded twelve inspected opaque 1080 x 2400 screenshots. The later blog-contract correction
is pushed as `f1081c195`; its CI, E2E, platform-contract, Docs, Security and CodeQL workflows
are all green. The
Android app is publicly installable from Google Play and
its core timebanking, messaging, volunteering and marketplace journeys have been walked on
devices. The public listing, Data Safety panel, content rating, policy URLs, production
signing, Sentry project and source-map path now exist. Genuine 7-inch and 10-inch emulator
captures also prove that three high-value screens render at tablet sizes.

**31 August push-routing correction and exhaustive producer audit.** The owner's report was
correct and systemic: the backend discarded every ordinary push destination and replaced it with
`/notifications`, while the tap path used a second route mapper that lagged behind native modules.
A generated fail-closed inventory now classifies all **239 direct and indirect Laravel producer
call sites**. The corrected candidate carries a versioned string-only internal destination, keeps
detailed content inside the authenticated app, displays a privacy-safe title and generic body in
the recipient's locale, and sends foreground/background/terminated responses through the
canonical mapper after authentication. Unsupported, sensitive, staff/browser-only, story and
all Care in Community and group-chat targets fall back or are suppressed; disabled modules and
deleted poll/feed resources degrade safely. Exact links were corrected for federated activity,
volunteer-organisation decisions, matches, settings and marketplace listings/orders/payouts. A
shared buyer/seller order route fetches and highlights the referenced order even when pagination
would otherwise hide it. Thirteen duplicate job send paths were removed. Ordinary Android alerts
use the translated default-importance channel; supported non-Caring emergencies select the translated
maximum-importance safeguarding channel and request high-priority FCM/APNs delivery. Paid campaign taps use the sole reviewed public-HTTPS exception
and defer tenant-scoped open analytics until authentication. The expanded focused backend set
passes **190 tests / 538 assertions** and the complete native suite now passes **380 suites / 2,735
tests** with 76.94% global line coverage. The exact route inventory, 462-endpoint API ledger and
256-route native parity matrix are green. A release APK from the central lifecycle repair built
and installed and a killed Android launch reached its deferred Events destination. The current
Metro source was then cold-launched at deterministic seller order 35: it resolved to Sales and
placed the exact `MKT-01M0MMJ6RJTQDRMCBBMNBPWGWV` paid order first with seller actions. This adds
exact producer/route proof without fabricating remote delivery. Row 7.14 and the
score remain PARTIAL/714 until this backend is deployed and a provider-delivered tap of the
corrected payload is observed on physical Android or iPhone. The final audited source is commit
`ec801add8`: full CI `33400565282`, CodeQL `33400564297`, Security Scan `33400565235`, E2E
`33400565189`, platform contracts `33400565213`, Docs Lint `33400565208`, the thirteen-flow Android
device run `33400589987`, and unsigned iOS Simulator run `33400593135` are green. The iOS run
compiled, installed, toured and content-verified the four current public App Store frames; it does
not prove APNs delivery, signing, TestFlight or physical-iPhone behaviour.

**Deeper final-wire audit, 31 August.** The first producer audit did not pass each route
through the backend privacy sanitizer, which still removed benign fragments after the producer
tests had gone green. The corrected contract now preserves only reviewed application, comment
and discussion fragments; opens supported comment notifications with their native comment
sheet, scrolls to the named comment and highlights it; and keeps every Care in Community route outside the native apps. Expo delivery is
chunked to 100 messages, retries transient failures, supports authenticated send and receipt
requests, retries receipts that are not ready, applies bounded lifetimes and does not delete
member tokens for server credential or project errors. Permission revocation, iOS provisional
permission, token rotation, input validation, launcher-badge reconciliation and the integer
campaign-consent form are covered. Safeguarding/emergency categorisation now takes precedence
over generic module words, so a volunteer emergency can no longer appear as an ordinary
Opportunity alert. This materially improves the source candidate but does not
add M1 points without a provider-delivered tap on the exact signed artefact; the sole official
score remains **714/1000**.

Apple preparation has moved ledger row 7.18 from OPEN to PARTIAL. The app compiled in EAS's
macOS iOS Simulator toolchain, its final `.app` was inspected, and the exact-source unsigned
Release app for commit `4c19c5576` completed the four-screen iPhone 16 Pro Max Simulator tour
in green workflow run `33328237409`. The changed source forced a clean native rebuild rather
than reuse of the prior app cache. The ledger recomputes to 0.736 and its 220/300 journey
credit is now banked. This is genuine Simulator runtime evidence, but it is
not signing, TestFlight, APNs, universal-link or physical-iPhone evidence.

This is not a claim that the next build is ready to upload. The public build predates the
fresh-install community-picker correction in the working tree; the exact next signed Play
artefact still needs a clean-install and upgrade walk on a physical phone. The live store
description also says that no money changes hands anywhere, while the app supports purchases
of physical marketplace goods. That wording must be corrected before another release is
submitted. Internationalisation, signed-distribution evidence and human-operated
accessibility remain material gaps. The expanded effect automation, response-contract
coverage and accessibility breadth passed exact-source CI and Android workflow run
`33332261410` on 2026-08-30.

🔴 **Why the score is not higher, given 380 green test suites and 2,725 passing tests.**
Most tests still run in Node against mocks. The ledger deliberately gives journey credit
only when a device walk verifies the effect, and only gives full credit when an automated
guard can fail on regression. Rubric M1 measures demonstrated product behaviour, not the
size of the test suite or the fact that the app has reached production distribution.

## Source audit — 2026-09-07

A second full pass the day after the emulator audit, source-only, recorded in
[`HISTORY/AUDIT_2026-09-07.md`](HISTORY/AUDIT_2026-09-07.md). Three areas were read in
full by independent auditors (tabs and auth; messaging, wallet, exchanges and account;
events and groups), and the marketplace was audited separately after the first attempt was
killed by the session usage limit — about 90 screens and 45 supporting files in all. The
volunteering/jobs and gamification clusters were not read. Around seventy member-visible
defects were fixed, each with a Jest test observed failing first; the full list is in
`CHANGELOG.md` under `[Unreleased]`.

The one structural finding: **the app gated its menus, not its screens.** React wraps ~150
routes in a feature gate; the native app wrapped five. Every screen now goes through
`withRouteGate`, driven by one table in `lib/navigation/routeRequirements.ts` that the tab
bar and the deep-link store read too, and a test fails when a new screen has no recorded
decision. The findings that mattered most for money: a time-credit transfer went through on
one tap with a recipient name taken from the URL; a donation retry after a timeout donated
twice (server now replays on a key); confirming exchange hours pre-filled the wrong figure
and could send an agreed exchange to dispute; completing a group exchange moved credits on
one tap. For trust: the GDPR data export never delivered a file; a private-group join
request showed "Joined" and silently reverted; a 403 during offline check-in sync destroyed
never-synced check-ins.

**The marketplace was the worst of it**, because it moves real money as well as credits.
Checkout never showed a total anywhere before the member paid. A time-credit purchase spent
the wallet on one tap. A payment that Stripe had taken could be reported as "Payment
failed", inviting a second one. "Confirm delivery" — which releases the seller's money and
ends buyer protection — fired on one untitled tap next to "Dispute". And "Free" was printed
on any listing with an empty price, including "contact seller" and time-credit-only items.
All six are fixed and tested.

**The owner also asked for the community strip at the top of the feed to be the logo alone.**
The name and tagline beside it are gone and the logo is twice the size.

This is source evidence only. Nothing was walked on a device, so the banked M1 score is
unchanged. The open findings are listed in the backlog below.

## Emulator and source audit — 2026-09-05/06

The 5 September source audit had no device attached. This pass walked the app on the
`nexus_test` emulator (light and dark, 411dp and a 360dp control, TalkBack found switched on
from an earlier session and disabled) and then covered the source module by module. It found
and fixed more than sixty member-visible defects; the full list, with the test that guards
each, is in `CHANGELOG.md` under `[Unreleased]`. The two that mattered most for money were a
marketplace price or offer typed with a comma decimal being sent with the comma *stripped*
(`12,50` became `1250`), and nine other decimal fields rejecting `1,5` outright or sending
`null` with no warning. The two that mattered most for trust were exchange decline/cancel
leaving the screen as if it had worked when the server refused, and every modal route's
error boundary swallowing crashes without reporting them.

### Follow-up, later on 2026-09-06

The audit's first push failed the Android release gate three times, each on something that
passes on the development machine, and the work is only complete because those were chased
down rather than retried:

1. **The per-area coverage ratchet.** Three areas had gained code faster than tests. Fixed by
   writing the missing tests — the community banner's logo sizing, the trust-badge row's
   failed-check path, the listings category retry and focus refetch, and all fourteen Explore
   sections. `app/(tabs)` went 70.45% to 76.06%. 🔴 The banner had no test at all because
   `jest-setup.ts` mocks that component away for every suite; a file testing it must unmock it.
2. **A flaky suite.** `BiometricLockGate` failed at two different waits while passing here
   every time. The cause was the testing library's one-second wall-clock default against a
   single-threaded instrumented run on a four-processor runner, not a product fault; ruled out
   first were missing React flushes (the suite logs none) and a re-render race (a fix was
   written, failed to reproduce the fault, and was reverted rather than shipped unproven into
   a security gate).
3. **Steps that had never run.** A job stops at its first failing step, so while the ratchet
   was red the date-locale, translation-ratchet, drift and bundle-budget steps never ran at
   all. The date-locale gate then caught a real fault: a duplicated time-zone probe formatting
   with no locale. All later steps were run locally afterwards and pass.

The same follow-up closed the modules the audit had left outstanding — podcasts, courses and
federation — finding that a paid course enrolled and spent time credits on a single tap with
no confirmation, that enrolment and lesson refusals discarded the server's reason, and that a
failed member search rendered as "No federated members found." It also confirmed the 1.3x
text-clipping observation as a real arithmetic defect on ten screens (see `VISUAL_AUDIT.md`
§7) and fixed a failed hashtag search reading as "no hashtags match".

This is source and emulator evidence, not distributed-device evidence: the fixes have not
been walked on the Play-distributed artefact, so the banked M1 score is unchanged. **Larger
text sizes above 1.3x (Android offers 1.5x and 2.0x) remain untested.** Two design findings
from the 5 September audit — the More screen's long directory and hero cards repeating the
top-bar title on roughly forty screens — are deliberately left for an owner decision rather
than restyled.

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
that contract; its 714 total is now evidence-backed.

| Category | Weight | Banked | Maximum | Basis |
| --- | ---: | ---: | ---: | --- |
| Journey certification | 300 | 220 | 300 | The banked ledger is **0.736**: 63 CERTIFIED, 58 PROVEN, 0 RENDERS and 10 PARTIAL over 137 scoring rows. Exact-source Android workflow `33332261410` completed thirteen journeys and independently asserted eight persisted Laravel effects, including the new personal saved-collection creation/reopen journey. |
| Capability parity with the website | 120 | 72 | 120 | 🔴 The hand-comparison of ten capabilities missed TWO whole capabilities that were absent from the app: the exchange workflow (accept/decline/start/complete/confirm plus any list of your exchanges) and feed moderation (hide, not-interested, mute, report — a safeguarding capability the website has had since the V2 feed). Both have now been built and walked. Raised by 8 for the two builds. Raised a further 4 on 2026-08-23 for writing a feed post, which this table had itself recorded as absent since 2026-08-22 — so that credit is for closing a known gap, not for the comparison getting better. The figure stays well short of full because the comparison is still only eleven capabilities deep and has twice proved incomplete |
| Interaction integrity | 100 | 74 | 100 | Posting a listing, an event or a group used to leave the member on the filled form with no confirmation — a duplicate-post trap — now fixed for all three. Sheets open, stay open, and close when the screen under them goes away. Deep links were fixed across parameter names, query strings and exchange/listing identity. All 165 sites that reported a failure without the server's reason now pass it on, walked against a real 409. The score remains conservative because shared-state refresh, offline/error states and destructive-action recovery have not been swept across the full app |
| Layout across device sizes | 80 | 60 | 80 | The 411dp and 360dp phone widths remain guarded. Genuine Android emulator captures now cover Listings, Wallet and Volunteering on both a 7-inch portrait device (1080×1920) and a 10-inch landscape device (2560×1440), and the Play validator enforces their dimensions and ratios. With only three tablet screens and no comprehensive tablet interaction sweep, the remaining 20 points are withheld |
| Accessibility | 60 | 38 | 60 | Contrast is gated. The authenticated current-source crawler verified all **37/37** fingerprint-gated routes and 281 targets at the emulator's actual 420dpi: zero below the WCAG 24dp floor, 148 above that floor but below Android's 48dp guidance, and five clipped viewport fragments excluded from sizing failures. The first populated-blog pass found two 20dp no-op metadata buttons; migrating both blog screens to the accessibility-aware informational chip removed them, and the exhaustive rerun stayed green. Dynamic text, images and transient geometry are excluded from settlement, while a changing actionable/scrollable node set still prevents a pass; exact bounds come from the accepted final tree. TalkBack is installed and enabled, and keyboard focus is visible in UIAutomator, but spoken output and a full swipe/double-tap journey remain genuinely human/instrumentation-gated. |
| Internationalisation | 70 | 25 | 70 | Seven locales ship, and the shrink-only gate now reports **zero** multi-word phrases still identical to English: ga 0, de 0, fr 0, it 0, pt 0 and es 0. All 4,531 original guarded entries were translated or narrowly allowlisted as registered product names, international units, machine-readable formats or genuinely shared words. The work covers coherent member journeys rather than scattered labels, including authentication, discovery, messaging, home, gamification, goals, exchanges, marketplace, federation, events, groups, profile/legal summaries, settings, volunteering, jobs, member collections and appreciations. This is automated catalogue integrity plus a reviewed AI translation pass—not native-speaker certification for any language. Arabic and right-to-left remain excluded from the native app by owner decision. |
| Automated test depth | 100 | 74 | 100 | `npm run coverage:check` passed **380 suites / 2,725 tests** on 2026-08-31; the ratchet reports 76.83% global lines across 339 files, with type checking, zero-warning lint, 28 area floors and source guards. Notification coverage now guards all 239 direct/indirect producers, the versioned server payload, exact native hrefs, privacy and localisation fallbacks, response lifecycle, authentication deferral, every tenant-capability route family, stale targets, paid-tap isolation and the canonical destination mapper. Three maintained effect suites finish with eight independent Laravel assertions. The score does not rise for raw test count: the device flows remain a thin slice of 140 ledger journeys. |
| Observability and operations | 70 | 60 | 70 | The `nexus-mobile` Sentry project exists in the EU region, accepted a test event that was read back, production builds carry the DSN and upload source maps, and the nightly triage sweep includes it. JavaScript errors also reach the server-side app log. Ten points remain withheld until a real crash and cold-start trace from a Play-distributed build are observed end to end |
| Distribution and update lever | 60 | 55 | 60 | The app is publicly installable from Google Play, after internal testing, and the production listing was visibly live on 2026-08-26. Signed local AAB creation, Play App Signing, force-update, OTA update and rollback paths exist. Five points remain withheld because the exact next Play-signed artefact has not had the required clean-install plus upgrade walk on a physical phone |
| Store readiness | 40 | 36 | 40 | The public listing is live with 24 screenshot entries, a parental-guidance rating, Data Safety disclosures, deletion support and a signed production release. The privacy, terms, account-deletion, child-safety and contact URLs all returned HTTP 200 on 2026-08-26. Four points are withheld because the live description incorrectly claims that no money changes hands anywhere although physical marketplace purchases are supported; the prepared truthful copy already contains the required distinction |
| **Total** | **1000** | **714** | **1000** | — |

**Provenance.** Journey status comes only from the 140-row ledger below. The isolated Android
candidate now contains 380 Jest suites and 2,725 tests; its Jest, TypeScript and lint checks
were re-run on 2026-08-31. The pre-review release baseline separately passed Expo Doctor
18/18, release policy, route/API/theme drift, production dependency acceptance, startup
budget, asset validation, network policy and the live TLS certificate chain. The public Play
listing was inspected directly while signed in and the five public policy/support routes were
requested independently. Tablet evidence is the genuine emulator output under
`store-listing/screenshots/tablet-{7,10}/`. The 2026-08-30 field audit classified all 201
typed getters: 104 live non-empty checks, 20 empty, 17 permission/error-blocked, 16 unresolved
and 44 explicitly client-mapped, with zero required fields missing from a checked response. A
separate three-role verifier accepted 15 populated high-risk contracts, including five
organisation-owner views that a primary-member-only probe correctly receives as 403. The
same day's submitted-artefact accessibility pass found additional informational chips in
Goals, Organisations and Settings. The final current-source touch crawl verified 37/37 routes,
281 targets, zero below the AA floor, 148 below Android's 48dp guidance and five clipped
viewport fragments. Mobile source `ee8b9e345` passed Android device run
`33332261410`; it built the APK, checked 15 live role-aware contracts, completed thirteen
journeys, asserted eight persisted effects across three suites and uploaded twelve inspected
opaque 1080 x 2400 screenshots. Unsigned iOS run `33328237409` clean-built
and installed source `4c19c5576`, completed the four-page tour and passed Apple Vision OCR;
the downloaded four-image artifact matched its manifest and passed independent visual review.
This is not evidence for a signed distributed build or physical device.

🔴 **The banked floor ratcheted to 714 on 2026-08-30.** A published total may never fall. If scope is
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
   typed getters and found zero missing required fields across 104 live non-empty checks. It
   honestly left 20 empty, 17 permission/error-blocked, 16 without a resolvable record id and
   44 deliberately reshaped in the client. Two marketplace getters previously misclassified
   a conditional choice between direct requests as response reshaping; the guarded classifier
   now attempts both, finding one populated and one honestly empty. A deterministic populated
   saved collection now makes all three collection getters live-checkable. A deterministic
   published post also exposed four invented required blog fields; the native type and screens
   now consume Laravel's privacy-preserving public shape, and blog detail is live-checkable.
   A three-role gate separately accepts 15 populated
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
   Android Hermes startup bundle is 14.87 MB, leaving 1.49 MB below its 16.35 MB blocking
   ceiling. This is an internal JavaScript regression budget, not an App Store download-size
   limit; no Play artefact was built or uploaded while the release is under review.
8. **Finish the 2026-09-07 audit.** Three passes ran on 2026-09-07 and **every module of
   the app has now been read.** The first fixed 48 findings; the second read
   volunteering/jobs/organisations and the gamification cluster; the third read the last
   three — courses, podcasts and federation — and closed the biggest gaps left over.
   Full record: [`HISTORY/AUDIT_2026-09-07.md`](HISTORY/AUDIT_2026-09-07.md).

   **Closed in the third pass:** members can now endorse a skill and send a thank-you
   (both features existed on the server and could never be used from the app); a
   cross-community credit transfer of up to 100 hours now confirms; a grade typed as
   "82,5" is no longer recorded as 0%; the federation hub no longer draws a failed load
   as "0 partners, 0 messages, 0 exchanges"; a video nobody played is no longer reported
   as fully watched; the federation setup wizard no longer switches a member’s privacy
   choices back on; unpublishing a course asks first; the instructor dashboard refetches;
   three more screens stop showing a refusal as a Retry loop; two live searches are
   debounced.

   🔴 **A test can hide a one-tap money path.** `member-profile.test.tsx` mocked
   `useConfirm` so that asking to confirm ran the action immediately, which made every
   confirmation on that screen unobservable — and is why the cross-community transfer
   went unnoticed. Do not write a confirm mock that auto-confirms.

   **Closed in the second pass:** group discussions are now reachable and answerable; an
   organisation wallet deposit can no longer be taken twice; four decimal fields accept a
   comma; the hiring pipeline can reach every stage; the "Given" reviews tab works; a
   declined organisation says so; volunteer hours can be dated and confirm what happens
   next; the XP shop and three destructive taps now ask first; appreciation cards no
   longer print raw translation keys; badge dates and the locked count are right; three
   owner-only screens say "not yours" instead of offering an endless Retry; seven
   gamification loads surface their failure instead of reading as "you have nothing".

   **Closed in a fourth pass, 2026-09-08.** No new reading — these are named items from
   the list below, worked to completion with a regression test each and a control run
   proving the test fails against the old code.

   - The federated directory decided whether it had been refused by matching English
     words in the server's reply, so members in the other six languages got a Try again
     button that could never work. It now reads the machine code, which is the same in
     every language. A member who simply has not joined federation is told how to join
     rather than that the feature is off. `usePaginatedApi` now exposes
     `errorStatus`/`errorCode`, which is what had blocked this. The directory's two
     free-text filters are debounced.
   - A stray tap on a course quiz could spend one of a limited number of attempts on a
     blank answer sheet. Nothing answered is refused; a partly finished quiz asks first
     and says what it costs.
   - Switching community signed the member out and only then found out whether the new
     community could be loaded, so a failure cost them their session for nothing. The
     target is now checked first, and the sign-out still runs before the switch, which is
     separately load-bearing.
   - Nine screens showed a refusal as a failure with a dead Retry: the five organiser-only
     event screens (attendance, tickets, communications, lifecycle history, recurrence
     blueprints) plus a wallet transaction, a donation receipt, a marketplace order and a
     group invite that are not the member's. `lib/api/refusal.ts` names the distinction
     once — 401/403/404 mean "no", 5xx and a dropped connection mean "try again".

   **Also closed in the fourth pass, later on 2026-09-08.**

   - A member whose verification email never arrived was locked out of the app: the
     sign-up screen offered only Sign in, which cannot work until the address is
     verified, and an expired link advised them to sign in and use account settings.
     Both now offer to send the email again. The endpoint had no caller.
   - A community with registration closed no longer offers Create account. Fails open:
     unknown or unreachable keeps the button, because hiding the only way into a
     community that IS open is the worse mistake.
   - Editing a course was outside the unsaved-changes guard, so a rewritten description
     was lost to a stray Back. It now compares against what was loaded rather than
     against empty, which is why it had been excluded.
   - Two taps on Add cohort made two cohorts.
   - **Group admins can now work the join queue from the phone**, and promote, demote
     or remove a member. All four endpoints existed with no caller: requests sat in the
     queue until somebody opened the website. Removal and declining both confirm first.
     Never offered against the group's owner or against yourself.

   🔴 **Two more tests were pinning the fault.** `donation-receipt.test.tsx` and
   `group-invite.test.tsx` each asserted that a 404 offers a Retry, and passed. Three
   `LessonQuiz` cases pressed Submit on a blank quiz and passed for the same reason.
   Assume a green suite proves the behaviour it describes, not that the behaviour is right.

   **Still open:**
   - Every group-detail tab shows its first page only. (Approving join requests and
     managing members was closed in the fourth pass above.)
   - Message attachments upload with no progress and no cancel (`uploadWithProgress`
     exists and is unused there).
   - Message attachments still upload with no progress and no cancel.
   - Registration validation still arrives as one sentence, never on the field it
     belongs to — the server sends only the first error, so this one needs a server
     change as well as a client one.
   - Marketplace remainder: pickup-slot and coupon dates are typed by hand; collections,
     saved searches and pickup slots delete with no confirmation; the Stripe payments
     screen shows 0.00 balances when its request failed; an accepted offer never says
     "pay now".
   - Volunteering remainder: the apply sheet never mentions the saved CV; six lists stop
     at twenty rows; registering an organisation lands on a hub that may not show it; an
     organisation website link can reject unhandled; a failed load in job edit mode leaves
     a permanently dead form.
   - Gamification remainder: a member can never endorse anyone and can never send an
     appreciation (both endpoints exist, neither is called); six more lists stop at their
     first page; the leaderboard only ever shows the top 20; roughly a dozen more record
     screens still show a 4xx refusal as a failure with a Retry — `lib/api/refusal.ts`
     and the sweep in the fourth-pass commit list them; two live searches fire a request per
     keystroke; knowledge-base search only filters what is already on screen; logged goal
     progress can only go up; voting on a poll discards every page loaded; four screens
     have no pull-to-refresh; a member cannot withdraw an idea or delete their own
     comment; a failed refresh is silent whenever the list already has rows.
   - Courses and podcasts remainder: the **podcast player has no background audio** (the
     phone locking stops a 45-minute episode) and **no resume or seek** — the strings for
     both already exist, unused, in all seven languages; this one needs `app.json`
     changes and therefore a new store build. The catalogues stop at 20; the player always
     opens at lesson 1; `expo-av` is deprecated for SDK 54 and removed in SDK 55, so both
     media players will need porting.
   - Federation remainder: nothing from the third-pass list. The English-only refusal
     check and the per-keystroke search were both closed in the fourth pass above.
   - **Nothing is unread now.** Run one auditor at a time; two concurrent exhausted the
     session limit.
   - 🔴 **Nothing from any of the four passes has been walked on a device.** That has not
     changed and is the reason the readiness score has not moved.

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
