# Autonomous Mobile Release Readiness Checklist

## Active goal — 2026-08-30

Complete every release-readiness task that can be performed autonomously with code, local
Laravel fixtures, Android emulators, GitHub-hosted iOS Simulator jobs, Chrome or computer use.
Do not mutate Apple or Google store state, deploy, publish OTA/AASA, make legal decisions or
claim human-only physical-device certification.

- [x] **18 — Messaging effect:** reset a disposable conversation, send through the real app,
  and independently verify the persisted message and recipient relationship.
- [x] **19 — Volunteering/event effects:** choose deterministic reversible member actions and
  verify their server state independently of UI confirmations.
- [x] **20 — Marketplace effect:** exercise a safe non-payment action and verify its persisted
  ownership/status effect.
- [x] **21 — Contract baseline:** save reproducible per-getter classification and risk order.
- [x] **22 — Contract fixtures:** populate and authorise the highest-risk empty/blocked/id gaps.
- [x] **23 — Mapping contracts:** guard high-risk mapped responses using real Laravel shapes.
- [x] **24 — Accessibility breadth:** expand beyond 34 authenticated routes and repair every
  measured WCAG 24dp failure without overstating Android 48dp guidance.
- [x] **25 — TalkBack feasibility:** prove one focus-driven journey or record a minimal,
  reproducible platform limitation.
- [x] **26 — OTA prompt:** observe the update-ready restart path without publishing an update.
- [x] **27 — Pixel/store images:** widen deterministic light/dark coverage and replace the
  weak Play frame only when the replacement is populated, safe and materially better.
- [x] **28 — iOS Simulator breadth:** revalidate the unsigned tour and select additions only
  when they improve evidence or artwork, without claiming signing, APNs or hardware proof.
- [x] **29 — Full gates:** bundle, dependencies, release config, assets, audience, security,
  documentation and all mobile tests are green or carry a precise external residual risk.
- [x] **30 — Bank evidence:** update maintained records and changelog, review secrets/diff,
  commit and push scoped work, and confirm required CI/device workflows.

### Active-extension evidence

- Flows 11 and 12 now reset and independently verify seven Laravel effects: offer creation,
  saved listing, connection request, exact-recipient message, volunteering application,
  confirmed event registration and saved marketplace listing. The repeat run exposed and
  fixed missing RSVP idempotency; all seven assertions passed together on emulator-5554.
- The field audit classifies all 201 typed getters with a bounded fetch and reports 101 live
  checks, 19 empty, 17 blocked/error responses, 18 unresolved and 46 client-mapped, with zero
  checked required fields missing. The three-role verifier accepts 15 populated contracts,
  including five owner-only organisation views.
- TalkBack is installed and enabled. UIAutomator can observe keyboard focus, but cannot capture
  speech or prove TalkBack swipe/double-tap operation; that is the recorded instrumentation
  boundary. The crawler now defines 37 routes and ignores changing decorative geometry while
  still requiring the actionable node set to repeat. Its first 37-route run found Federation's
  informational status exposed as a 20dp no-op button; the status-chip migration removed it and
  the final full rerun verified 37/37 screens and 279 targets with zero WCAG-minimum failures;
  147 targets below Android's non-blocking 48dp guidance remain explicitly reported.
- The update-ready component rehearsal proves pending/downloaded, once-only, dismissable,
  restart and failure-reporting paths. A debug build has `expo-updates.isEnabled=false`; a real
  on-device prompt requires publishing a signed update channel, which this goal forbids.
- Fresh light/dark tours match stable baselines. New Courses/Clubs/Venues frames remain empty
  regression evidence, so the stronger populated Play set and stable four-screen Apple tour
  are retained. Expanding store artwork merely to include empty new modules was rejected as a
  quality regression; the hosted Apple workflow will still be rerun at exact source.
- Local gates: 377 suites / 2,611 tests, 76.40% line coverage, type check, zero-warning lint,
  Expo Doctor 18/18, release/network/certificate/drift/translation/audience/dependency/store
  checks and a 14.87 MB bundle with 1.48 MB internal headroom. `verify:ios-release` has exactly
  the two enrollment-gated failures: Team-ID AASA and numeric App Store app ID.

### Completion rule

- [x] Every remaining item requires approval, store-console access, production authority,
  an owner/legal answer or genuine human/physical-device observation.

### Final banking evidence

- Mobile source `dbed8f427` passed CI Pipeline `33320133086`, E2E `33320133074`, Docs Lint
  `33320133099`, CodeQL `33320132636` and Security Scan `33320133031`.
- Android device run `33320137825` passed 15 live role-aware contracts, built the APK,
  completed twelve Maestro journeys, independently asserted seven persisted Laravel effects
  and uploaded twelve inspected 1080 x 2400 PNGs.
- Unsigned iOS Simulator run `33319960815` built and installed source `87bb70990` on an iPhone
  16 Pro Max Simulator running iOS 26.2, completed the four-screen public tour after one
  bounded XCTest-session retry, passed Apple Vision OCR and uploaded four inspected opaque
  1320 x 2868 PNGs whose hashes match the manifest.
- The formula-backed journey credit is now banked at 218/300, raising rubric M1 by four
  points. The authoritative total remains solely in the maintained mobile status document.
  No Play/App Store, deployment, OTA, AASA, signing or production state changed.

## Progress record — 2026-08-30

This is the durable handoff for the active five-item goal. It deliberately separates local
proof from banked CI and store-console work.

- [x] **1 — Effect-verifying Android automation:** E2E fixtures now contain three members
  and two addressable listings. Maestro flow `11-effect-verifying-member-actions.yaml`
  creates a listing, saves another member's listing and sends that member a connection
  request. `mobile/scripts/mobile-device-effects.php` resets and independently checks all
  three database effects. A clean local `nexus_test` run passed all three assertions; the
  verifier also exited non-zero before the actions existed. CI integration is written but
  cannot be banked until the scoped commit can be pushed safely.
- [x] **2 — Authenticated accessibility breadth:** the crawler was expanded from 29 to 34
  routes and made fail-closed when the routed fingerprint has not replaced the splash or
  previous tree. Its first expanded run verified 33/34 routes and found genuine sub-24dp
  phantom controls in group exchanges, activity, reviews and ideation plus one invalid
  off-screen bound. The harness now ignores invalid bounds, the informational chips are
  non-pressable surfaces, and focused reruns report zero AA failures. TalkBack is installed,
  enabled and detectable on the emulator, but spoken order and swipe/double-tap operation
  remain unproved and must not be described as complete screen-reader certification.
- [x] **3 — Live response contracts:** three deterministic roles (member A, member B and
  admin) now authenticate against local Laravel. Five populated contracts cover listing
  search, member search, connection status in both directions and the admin member
  directory. Validator unit tests and the live check pass; this expands evidence without
  reclassifying the remaining empty, forbidden, unresolved or client-mapped typed getters.
- [x] **4 — Pixel breadth:** Courses, Clubs and Partner Venues were added to the light/dark
  tour. The first Courses attempt exposed a spinner race, so the workflow now waits for the
  deterministic `No courses found.` result. Two settled light captures of all three new
  screens reproduced at 0 pixels and were visually reviewed. The same three reproduced at
  0 pixels in dark; the reviewed Wallet/Settings baseline updates also reproduced exactly.
  The final gates are green at eight stable light screens and seven stable dark screens.
- [x] **5 — Play screenshot preparation:** GitHub Android artifact run `33305596994` was
  downloaded into `.local-docs-archive/mobile-preapproval-2026-08-30/` and compared with
  all eight maintained light phone images. The committed marketing set is materially richer
  than the sparse local-fixture artifact. Keep Feed, Listings, Wallet, Events, Groups,
  Members and Volunteering. Messages is the weak empty frame; the capture recipe now targets
  Courses for slot 3, but no repository image will be replaced unless Partner Demo produces
  a populated, visually better capture. All 24 maintained screenshots plus icon and feature
  graphic pass their format/dimension gate. No Play Console state has been opened or changed.

### Delivery ancestry check

The task began with unrelated Sentry commit `d885dee60` local-only, which correctly blocked
publishing any descendant. At final verification `origin/main` had advanced to that exact
commit (`origin/main...HEAD = 0/0`), so the ancestry blocker was independently resolved.
Continue to stage only the explicit mobile/readiness paths. Apple approval/signing/TestFlight,
production OTA/deployment and every Google Play listing/release mutation remain outside this
goal.

## Task 1: Establish exact baseline

**Acceptance criteria:**
- [ ] Record HEAD/origin ownership, active emulators, current workflow/artifact IDs and ledger totals.
- [ ] Confirm no store, OTA, deployment or Apple-signing action is in scope.

**Verification:**
- [ ] `git status --short`, `git rev-list --left-right --count origin/main...HEAD` and workflow evidence agree.

**Dependencies:** None. **Scope:** Small.

## Task 2: Select effect-verifiable journeys

**Acceptance criteria:**
- [ ] Rank PROVEN journeys by member/release risk.
- [ ] Select bounded journeys with reset, action and independent persisted-effect assertions.

**Verification:**
- [ ] Selection maps to real ledger rows and Laravel routes/models.

**Dependencies:** Task 1. **Scope:** Small.

## Task 3: Reusable fixture/effect verification

**Acceptance criteria:**
- [ ] Device flows can reset and verify semantic effects without fixed row IDs.
- [ ] Secrets remain outside Git and failed verification exits non-zero.

**Verification:**
- [ ] Focused harness tests pass and fail under a deliberate wrong-effect mutation.

**Dependencies:** Task 2. **Scope:** Medium.

## Task 4: Exchange and messaging automation

**Acceptance criteria:**
- [ ] Selected exchange and messaging flows execute independently on Android.
- [ ] Each asserts its persisted/API outcome, not only navigation.

**Verification:**
- [ ] Focused device run plus deliberate effect-assertion mutation.

**Dependencies:** Task 3. **Scope:** Medium per journey slice.

## Task 5: Volunteering, event and marketplace automation

**Acceptance criteria:**
- [ ] Selected flows execute from clean deterministic fixtures.
- [ ] Persisted status/ownership/transaction effects are independently verified.

**Verification:**
- [ ] Focused device runs and harness unit tests pass.

**Dependencies:** Task 3. **Scope:** Medium per journey slice.

## Checkpoint B

- [ ] New journeys fail on removed effects, pass independently and run in the maintained harness.

## Task 6: Authenticated touch-target breadth

**Acceptance criteria:**
- [ ] Authenticated current-source crawl covers more than the existing 24-screen evidence.
- [ ] Unverified, wrong-screen and unsettled routes fail closed.

**Verification:**
- [ ] `node mobile/scripts/audit-touch-targets.mjs --serial <serial> --json <local-output>`.

**Dependencies:** Task 3. **Scope:** Medium.

## Task 7: Repair measured accessibility defects

**Acceptance criteria:**
- [ ] Every genuine sub-24dp target in the expanded sample is fixed or precisely blocked.
- [ ] Source regression tests protect each repeated defect family.

**Verification:**
- [ ] Focused Jest tests and repeat live-tree measurement pass.

**Dependencies:** Task 6. **Scope:** Medium per defect family.

## Task 8: TalkBack/Espresso feasibility

**Acceptance criteria:**
- [ ] Establish whether emulator automation can drive and observe accessibility focus reliably.
- [ ] Add one genuine focus-driven journey or document the exact unsupported boundary.

**Verification:**
- [ ] Reproducible instrumentation command and captured focus/effect evidence, or a failing minimal proof.

**Dependencies:** Task 6. **Scope:** Medium.

## Checkpoint C

- [ ] Accessibility evidence records requested/verified routes, density, findings and honest limits.

## Task 9: Classify response-contract gaps

**Acceptance criteria:**
- [ ] All typed getters are classified reproducibly.
- [ ] Output distinguishes checked, empty, forbidden, unresolved and client-mapped cases.

**Verification:**
- [ ] Audit helper tests and stable machine-readable output pass.

**Dependencies:** Task 1. **Scope:** Medium.

## Task 10: Expand fixtures and roles

**Acceptance criteria:**
- [ ] Highest-risk empty/unresolved/forbidden getters receive deterministic addressable data or roles.
- [ ] Fixture creation is idempotent and does not alter production data.

**Verification:**
- [ ] Seed/reset tests and focused live getter audit pass.

**Dependencies:** Task 9. **Scope:** Medium per API module.

## Task 11: Protect client mappings

**Acceptance criteria:**
- [ ] High-risk reshaped money/auth/messaging/exchange getters have real-shape mapping tests.
- [ ] Live audit exits non-zero on any checked missing required field.

**Verification:**
- [ ] Focused API tests plus complete read-only field audit pass.

**Dependencies:** Tasks 9–10. **Scope:** Medium.

## Checkpoint D

- [ ] Checked coverage rises honestly and all discovered mismatches are fixed and regression-tested.

## Task 12: Make selected screens deterministic

**Acceptance criteria:**
- [ ] Selected high-value screen data, order and settle state reproduce.
- [ ] No production behavior is weakened merely to satisfy screenshots.

**Verification:**
- [ ] Two independent same-scheme captures stay within 0.1%.

**Dependencies:** Tasks 3 and 10. **Scope:** Medium per screen family.

## Task 13: Expand light/dark pixel gate

**Acceptance criteria:**
- [ ] Reproducible screens are added in both applicable schemes.
- [ ] Volatile exclusions remain explicit and scheme-specific.

**Verification:**
- [ ] `npm.cmd --prefix mobile run screenshot:compare -- --scheme light` and dark equivalent.

**Dependencies:** Task 12. **Scope:** Medium.

## Checkpoint E

- [ ] New pixel assertions reproduce and the sensitivity mutation guard still fails appropriately.

## Task 14: Inspect exact-head Android artifact

**Acceptance criteria:**
- [ ] Download, hash and visually inspect all nine current-head screenshots.
- [ ] Reject overlays, clipping, credentials, personal data and weak marketing frames.

**Verification:**
- [ ] Artifact manifest/hash record and image-by-image selection notes exist.

**Dependencies:** Task 1. **Scope:** Medium.

## Task 15: Prepare Google Play replacement set

**Acceptance criteria:**
- [ ] Compare current artifact with all maintained phone/tablet/light/dark assets.
- [ ] Replace repository images only when materially better; never upload them.

**Verification:**
- [ ] `npm.cmd --prefix mobile run store:assets:check` passes and sensitivity scan is clean.

**Dependencies:** Tasks 13–14. **Scope:** Medium.

## Checkpoint F

- [ ] Selection record explains every kept/replaced image and confirms zero store mutations.

## Task 16: Refresh maintained evidence

**Acceptance criteria:**
- [ ] Ledger/status/roadmap reflect only achieved evidence.
- [ ] Changelog records release-relevant source, automation and asset changes.

**Verification:**
- [ ] Docs, score, version and semantic-version gates pass.

**Dependencies:** Checkpoints B–F. **Scope:** Medium.

## Task 17: Final delivery

**Acceptance criteria:**
- [ ] Full mobile gates, diff review and secret scan pass.
- [ ] Only scoped paths are committed; push waits for unrelated ancestry ownership resolution.
- [ ] Required CI is green if a safe push becomes possible.

**Verification:**
- [ ] Clean scoped diff, exact commit identity and workflow links are recorded.

**Dependencies:** Task 16. **Scope:** Medium.
