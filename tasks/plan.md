# Implementation Plan: Native Mobile Production Readiness

## Overview

Bring the Expo / React Native application in `mobile/` to the strongest production-ready
state that can be proved before Apple Developer approval, without changing or uploading
anything to the Google Play release currently under review. Work is limited to source,
tests, local and CI automation, release documentation, generated local evidence, and
store assets already held in the repository.

## Protected Boundaries

- Do not alter the Google Play Console listing, release, review, tracks, screenshots, copy,
  AABs, APKs, or rollout state.
- Do not create signed Apple builds, configure Apple credentials, upload to TestFlight, or
  submit to App Review before Apple Developer Program approval.
- Do not deploy production services or publish the Apple AASA file.
- Preserve the adults-only native product boundary and all unrelated concurrent work.

## Architecture Decisions

- Treat Laravel as the production/default API contract and the Expo app in `mobile/` as the
  native client. The removed Capacitor project is not part of this work.
- Separate source readiness, automated emulator evidence, signed-artifact readiness, and
  physical-device certification in every status claim.
- Prefer release-critical journey automation and fail-closed release gates over new features.
- Keep store mutations behind explicit owner approval even when copy or assets are prepared.

## Task List

### Phase 1: Baseline and release boundaries

- [x] Record the exact source revision, working-tree ownership, current workflow evidence,
  maintained journey totals, bundle headroom, API drift, and store-asset state.
- [x] Identify stale or contradictory readiness documents and every actionable OPEN/PARTIAL
  item that does not require Apple approval, a store mutation, or an unavailable real device.

### Checkpoint: Baseline

- [x] Protected Apple and Google boundaries are documented and no external state changed.
- [x] Every proposed task has a reproducible verification command or named evidence limit.

### Phase 2: Automated release gates

- [x] Run mobile tests with coverage ratchets, TypeScript, lint, translation integrity,
  route/API/theme drift, release configuration, security, startup budget, and asset checks.
- [x] Run repository documentation, SPDX, version, semantic-version, and applicable preflight
  checks without building or uploading a new store artifact.
- [x] Investigate every failure or warning that can affect a production binary; add a
  regression guard for each source defect fixed.

### Checkpoint: Automated gates

- [x] All applicable non-enrollment gates pass at the same source revision.
- [x] Expected Apple identifier failures are reported as external blockers, not patched with
  invented values.

### Phase 3: Actionable production-readiness debt

- [x] Audit the ledger's OPEN and PARTIAL rows and close every source, fixture, automation,
  accessibility, privacy, security, error-handling, or observability issue that can be closed
  without touching protected store state.
- [x] Strengthen automated device workflows and critical-journey checks where existing
  emulator evidence can provide a reliable regression gate.
- [x] Recheck app-size headroom, production dependencies, sensitive notification boundaries,
  deep links, account deletion, offline/error recovery, and store-audience enforcement.

### Checkpoint: Production candidate

- [x] No actionable source blocker remains outside the protected external gates.
- [x] Remaining limitations require Apple approval, owner/legal input, protected Play action,
  or physical-device evidence and are named precisely.

### Phase 4: Handoff and banked evidence

- [x] Refresh the authoritative mobile status, Apple freeze checklist, roadmap, and release
  handoff so they reference current evidence and do not overclaim simulator proof.
- [x] Record rollback, monitoring, staged-release, reviewer-access, and exact-candidate steps.
- [x] Update `CHANGELOG.md` under the correct Unreleased subsection and refresh its bundled
  frontend copy for all release-relevant changes.

### Phase 5: Final verification and delivery

- [x] Run focused tests, full applicable gates, diff review, secret scan, and working-tree
  ownership check.
- [x] Commit and push only scoped files directly to `main`.
- [x] Confirm required GitHub workflows are green and produce a final external-gate handoff.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Accidentally disturbing the Play review | Review delay or rejection | No Console access, upload, build submission, or listing mutation |
| Treating Simulator success as iPhone proof | False Apple readiness claim | Preserve signed/TestFlight/physical-device gates explicitly |
| Concurrent work enters the mobile commit | Unreviewed release content | Explicit path staging and final ownership review |
| Broad test count hides broken journeys | Public defects | Prioritise runtime effects and device-level regression guards |
| Dependency remediation forces an unsafe Expo upgrade | New release instability | Triage reachability; reject unsafe major upgrades during freeze |
| Documentation drifts from evidence | Wrong release decisions | One authoritative status and exact run/commit references |

## Open External Gates

- Apple Developer Program approval, Team ID, App Store Connect numeric ID, signing, APNs,
  AASA publication, signed EAS build, TestFlight, and real-iPhone certification.
- Google Play release/listing changes and the exact next Play-distributed physical-phone walk.
- Owner/legal App Store declarations and explicit authorization at submission/release gates.
