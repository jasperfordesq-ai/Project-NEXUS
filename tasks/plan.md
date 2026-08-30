# Implementation Plan: Autonomous Mobile Release Readiness

## Active extension — 2026-08-30

The original five pre-approval workstreams reached their bounded checkpoint at commit
`a5bb93add`. This extension completes every further task that can be proved without Apple or
Google approval, store-console mutation, production deployment, an owner/legal judgement or
human-only physical-device certification.

### Phase 7: Effect-verifying journey breadth

- [x] Task 18: Add deterministic reset/action/effect proof for a real messaging journey.
- [x] Task 19: Add deterministic reset/action/effect proof for selected volunteering and
  event journeys.
- [x] Task 20: Add deterministic reset/action/effect proof for a selected marketplace
  journey without real payment or destructive production state.

### Checkpoint G: Device effects

- [x] Each journey fails before the action, passes afterwards, runs independently from reset
  fixtures and is exercised by the maintained Android device workflow.

### Phase 8: API contract breadth

- [x] Task 21: Capture a machine-readable baseline for all empty, blocked, unresolved and
  client-mapped typed getters and rank them by money, access, messaging and core-module risk.
- [x] Task 22: Add idempotent fixture records and authorised roles for the highest-risk gaps.
- [x] Task 23: Add real-shape mapping tests for high-risk client-reshaped responses and make
  the live contract gate fail on regressions.

### Checkpoint H: Contract evidence

- [x] Checked live coverage is classified honestly, zero checked required fields are missing,
  and every remaining gap retains an explicit reason.

### Phase 9: Remaining autonomous device and visual work

- [x] Task 24: Expand authenticated touch-target coverage and fix every genuine sub-24dp
  defect found; keep Android 48dp guidance debt separately visible.
- [x] Task 25: Complete a bounded Espresso/TalkBack focus feasibility spike and add genuine
  focus-driven evidence if the platform exposes it.
- [x] Task 26: Exercise the update-ready restart prompt in a non-production rehearsal.
- [x] Task 27: Make additional high-value screens deterministic, widen the light/dark pixel
  gate and replace the weak Play screenshot only if a materially better safe frame exists.

### Phase 10: iOS Simulator and release controls

- [x] Task 28: Revalidate the unsigned iOS Simulator tour, add only materially useful screens
  and retain explicit signing/hardware limitations.
- [x] Task 29: Re-run bundle, dependency, release configuration, store asset, audience,
  documentation, security and full mobile gates; remediate only safe in-scope findings.
- [x] Task 30: Refresh the ledger, readiness documents and changelog; commit and push only
  scoped paths, then bank the required CI and device-workflow evidence.

### Checkpoint I: Autonomous boundary complete

- [x] Every remaining item is named as approval-, legal-, production-, store-console- or
  genuinely human/physical-device-gated; no autonomous coding or emulator task is left open.

## Overview

Complete the five remaining mobile workstreams that can be proved from the Windows
workstation, local Laravel fixtures, Android emulators and existing GitHub-hosted device
automation. The work must improve evidence rather than inflate scores: a mocked component
test is not a device journey, an accessibility-tree inspection is not spoken TalkBack proof,
and a valid screenshot is not automatically good store artwork.

## Current checkpoint — 2026-08-30

Items 1–5 are locally implemented and verified. The screenshot decision is to retain seven
strong Partner Demo frames and replace the empty Messages slot only after a genuinely
populated Courses (or better module) capture exists; the recipe is prepared and all current
assets pass, so manufacturing an empty replacement is not remaining work. The detailed
evidence and the resolved ancestry check are kept at the top of `tasks/todo.md` so a resumed
session cannot mistake local proof for banked CI or repository preparation for a store upload.

## Protected Boundaries

- Do not open or mutate Google Play Console, its listing, review, tracks, artifacts or rollout.
- Do not publish a production/staging OTA update, deploy services or publish Apple AASA.
- Do not create signed Apple builds, configure credentials, upload to TestFlight or submit.
- Preserve the adults-only native boundary and all unrelated work.
- The unrelated Sentry commit `d885dee60` was initially local-only and therefore blocked a
  mobile push. During final verification `origin/main` advanced to the same commit; record
  that resolution and still stage only the explicit mobile/readiness paths below.

## Architecture and Evidence Decisions

- Device automation must assert an external effect through Laravel/API/database evidence,
  not merely the presence of a screen or successful tap.
- Accessibility audits fail closed when a requested route cannot be authenticated,
  fingerprinted or measured. TalkBack remains PARTIAL unless speech/focus-driven operation
  is genuinely observed; an Espresso feasibility result must not be overstated.
- Response-contract coverage counts only non-empty comparable responses. Empty, forbidden,
  unresolved and client-mapped getters remain named gaps until separately proved.
- Pixel baselines are accepted only after two independent captures reproduce within the
  existing 0.1% threshold in each colour scheme.
- Repository screenshot replacement is allowed; store upload is not. Originals and exact-run
  artifacts remain traceable.

## Dependency Order

1. Baseline and fixture ownership.
2. Trustworthy effect-verification and authenticated emulator access.
3. Journey, accessibility and API coverage expansion.
4. Deterministic pixel capture.
5. Store-image comparison and release-ledger refresh.
6. Full verification, scoped commit and push only when unrelated ownership is resolved.

## Task List

### Phase 0: Baseline and selection

- [ ] Task 1: Reconcile the current ledger, device-flow inventory, fixture roles, screenshot
  artifact and local/remote Git ownership.
- [ ] Task 2: Select the first high-value PROVEN journeys by release risk and confirm the
  observable server/database effects available to each.

### Checkpoint A: Trustworthy scope

- [ ] Every selected journey has a state-reset method, runtime action and independent effect
  assertion; protected store and unrelated Git boundaries are recorded.

### Phase 1: Effect-verifying Android journeys

- [ ] Task 3: Add reusable fixture/effect verification for device flows without exposing
  credentials or coupling assertions to unstable row identifiers.
- [ ] Task 4: Automate the selected exchange and messaging effects on the emulator.
- [ ] Task 5: Automate the selected volunteering/event/marketplace effects on the emulator.

### Checkpoint B: Journey automation

- [ ] The new flows fail when their server effect is removed, pass independently from a clean
  fixture state and run through the maintained device harness.

### Phase 2: Accessibility breadth

- [ ] Task 6: Run the authenticated touch-target crawler against the current source build,
  extend route fingerprints where reliable and preserve fail-closed coverage reporting.
- [ ] Task 7: Fix and regression-test every genuine sub-24dp target or off-card layout defect
  found in the expanded sample; report 24–47dp guidance debt separately.
- [ ] Task 8: Perform a bounded Espresso/TalkBack feasibility spike and either add a genuine
  focus-driven core journey or document the precise physical/instrumentation blocker.

### Checkpoint C: Accessibility evidence

- [ ] Requested-versus-verified route counts, density, findings and evidence limits are saved;
  no screenshot or UI tree is described as spoken screen-reader proof.

### Phase 3: Response-contract breadth

- [ ] Task 9: Produce a machine-readable classification of all comparable, empty, forbidden,
  unresolved and client-mapped typed getters.
- [ ] Task 10: Add deterministic fixture records and authorised roles for the highest-risk
  empty/unresolved/forbidden money, authentication, messaging and exchange getters.
- [ ] Task 11: Add mapping-contract tests for high-risk client-reshaped responses and rerun the
  live read-only Laravel audit with a fail-closed result.

### Checkpoint D: API evidence

- [ ] Checked coverage rises without reclassifying unproved getters, zero checked required
  fields are missing, and any genuine mismatch has a failing regression test and source fix.

### Phase 4: Pixel-regression breadth

- [ ] Task 12: Remove controllable volatility from selected high-value screens using fixed
  fixtures, deterministic ordering and explicit settle conditions.
- [ ] Task 13: Capture twice in light and dark, approve only reproducible additions and keep
  irreducibly volatile screens inspection-only with reasons.

### Checkpoint E: Visual gate

- [ ] Every newly gated screen reproduces under 0.1% per scheme and the sensitivity mutation
  guard still detects a meaningful layout/colour change.

### Phase 5: Google Play screenshot assessment

- [ ] Task 14: Download and hash the exact-head Android screenshot artifact, inspect every
  image for current content, personal data, overlays, clipping and marketing usefulness.
- [ ] Task 15: Compare the artifact with the maintained 24-image Play set and prepare scoped
  repository replacements only where the current image is materially better.

### Checkpoint F: Store assets prepared, not uploaded

- [ ] Phone/tablet/light/dark dimensions and formats pass; a selection record explains every
  kept or replaced image; no Console or release state changed.

### Phase 6: Bank evidence and deliver

- [ ] Task 16: Refresh the journey ledger, authoritative status, roadmap and changelog without
  overstating emulator, tree, fixture or screenshot evidence.
- [ ] Task 17: Run focused mutation checks, full mobile/repository gates, diff/secret review,
  explicit staging and CI; commit/push only if unrelated Git ownership is safely resolved.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Flow passes after tapping but effect failed | False certification | Independent API/database assertion and mutation check |
| Fixture state makes flows order-dependent | Flaky CI | Idempotent reset and generated semantic identifiers |
| Accessibility route measures previous screen | False zero findings | Stable fingerprint plus fail-closed requested/verified count |
| TalkBack claim exceeds evidence | Misleading accessibility status | Separate tree, focus and spoken-operation evidence explicitly |
| Pixel baseline captures changing data | Noisy or ignored gate | Two independent captures before approval; fixed dates/order |
| Better-looking image contains member data | Privacy incident | Synthetic fixtures, visual inspection and sensitivity scan |
| Mobile push includes unrelated work | Unauthorized change | Recheck origin/HEAD and stage only the explicit mobile/readiness paths |

## Open External Gates

- Apple enrollment, identifiers, signing, APNs, AASA publication, TestFlight and iPhone proof.
- Google Play review/listing/release changes and exact distributed-artifact physical-phone walk.
- Qualified native-speaker certification and owner/legal store declarations.
