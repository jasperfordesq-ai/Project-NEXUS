<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Production Readiness Rubric

Last reviewed: 2026-08-18

First edition. Every figure below was measured on that date by running the
check, not by reading a document.

The scoring rubric for the Expo client, and its honest current score.

This exists because the mobile app was the one platform surface with no readiness
standard. The React frontend has a sharded blocking suite and a quarantine
budget; `web-uk` has a route matrix, an API ledger and a frozen inventory; the
Laravel API has PHPStan, a migration-safety gate and a deploy verifier. Mobile
had a strong unit-test suite and prose parity notes, and nothing that could
report a regression in what it actually ships.

**How to read a score.** Each dimension is scored against stated criteria, not
against a feeling. A dimension is only `Strong` when something automated would
fail if it regressed. "It works when I try it" is `Unmeasured` — that is a
statement about attention, not about the app.

| Score | Meaning |
| --- | --- |
| **Strong** | Automated, blocking, and it would go red on a regression. |
| **Adequate** | Automated and honest about its limits; gaps are recorded and bounded. |
| **Weak** | Partially covered; a real regression could ship unnoticed. |
| **Unmeasured** | No mechanism at all. Not the same as broken — but not evidence of working either. |

---

## Scorecard — 2026-08-18

| # | Dimension | Score | One-line basis |
| --- | --- | --- | --- |
| 1 | Automated test suite | **Strong** | 263 suites / 1,563 tests, 0 skipped, 0 quarantined, 87s, blocking in CI |
| 2 | Code coverage | **Adequate** | 71.68% lines with a per-area shrink-only ratchet; specific 0% seams named below |
| 3 | API contract drift | **Adequate** | 402 of 403 endpoints verified against Laravel's real routes; 1 confirmed defect open |
| 4 | Route parity drift | **Adequate** | All 254 React member routes classified; 33 gaps, 31 awaiting review, budget shrink-only |
| 5 | Type safety | **Strong** | `tsc --noEmit` strict, blocking in CI |
| 6 | Release & native policy | **Strong** | `verify:release` plus generated-manifest inspection, both blocking |
| 7 | Crash reporting | **Adequate** | Sentry React Native wired; no release-health gate after a rollout |
| 8 | End-to-end journeys | **Weak** | 9 Maestro flows exist but are operator-run; nothing runs them in CI |
| 9 | Visual correctness | **Unmeasured** | No snapshot, screenshot or visual-diff testing of any kind |
| 10 | iOS | **Unmeasured** | Never built or run in CI or locally; App Store Connect ID is still a placeholder |
| 11 | Accessibility | **Weak** | 683 a11y props over 119 of 189 screens (63%); no automated a11y assertion gate |
| 12 | Internationalisation | **Weak** | 7 locales against the platform's 11; namespace content is test-enforced |
| 13 | Offline & flaky-network behaviour | **Weak** | Offline check-in store exists at 33% coverage; no systematic offline testing |
| 14 | Performance | **Unmeasured** | No startup-time, bundle-size or list-scroll budget |

**Overall: not production-ready as a flagship, genuinely ready as an Android
companion app.** The logic layer is in good shape and now has drift alarms. What
is missing is everything that proves the app *looks and feels* right on a real
device — which is exactly where the reported bugs live.

---

## 1. Automated test suite — Strong

**Criteria:** the whole suite runs in CI, blocks the release gate, has no skipped
or quarantined tests, and completes fast enough to run on every change.

**Measured:** 263 suites, 1,563 tests, all passing, 87 seconds with
`--runInBand`. Zero `it.skip` / `describe.skip` / `it.todo` in the tree, and no
quarantine list — so a green run means every test ran. The React frontend cannot
say that (55 of its 1,283 suites are quarantined); mobile can.

Blocking in `ci.yml` via `mobile-release` → `release-gate`.

This is the strongest thing about the mobile app and it deserves saying plainly.

---

## 2. Code coverage — Adequate

**Criteria:** coverage is measured over *all* source files, is enforced per area
rather than as one global average, and can only improve.

**Measured (2026-08-18):**

| Metric | Value |
| --- | --- |
| Lines | 71.68% (11,510 / 16,057) |
| Statements | 68.61% |
| Branches | 61.97% |
| Functions | 65.91% |

🔴 **The previously reported figure was 74.08%, and it was flattering.** Jest was
not given `collectCoverageFrom`, so it only instrumented files some test
imported. 37 source files were absent from the denominator entirely, including
the 759-line root layout and the whole `lib/payments/` directory. A file with no
test did not lower the percentage — it left the report. That is now fixed
(`jest.config.js`), which is why the honest number is lower than the old one.

Enforced by `scripts/check-coverage-ratchet.mjs` against `coverage-baseline.json`
— per-area line floors, shrink-only. A single global percentage would not work
here: `app/(modals)/` is 10,343 of 16,057 instrumented lines, so it swamps the
average, and every seam listed below could go to zero while the global figure
moved under two points.

### The seams at or near zero

These are not the biggest files. They are the ones where a failure is invisible
to a unit test and obvious to a member.

| Area | Lines | Coverage | Why it matters |
| --- | --- | --- | --- |
| `app/_layout.tsx` | 67 | **0%** | Root providers, the auth redirect, deep-link handling, push registration. Everything starts here. |
| `lib/payments/` (5 files) | 29 | **0%** | Stripe identity and marketplace payment entry points. |
| `lib/realtime.ts` | 25 | **0%** | Pusher connection lifecycle — subscribe on login, tear down on logout. |
| `lib/storage.ts` | 35 | **25.2%** | The secure store holding access and refresh tokens. |
| `lib/eventOfflineCheckinStore.ts` | 199 | **32.7%** | Offline event check-in queue; the largest under-tested unit. |
| `components/events/EventOfflineCheckinCard.tsx` | 146 | **0%** | Its UI. |
| `lib/api/jobs.ts` | 58 | **0%** | The only one of 46 API modules with no test at all. |
| `lib/env.ts` | 20 | **0%** | Environment resolution — decides which API the app talks to. |
| `components/ErrorBoundary.tsx` | 15 | **0%** | What a member sees when something else fails. |
| `components/VoiceMessageBubble.tsx` | 52 | **0%** | Voice message playback. |

The pattern is worth naming: **the untested code is the native-integration
layer.** Screens are well covered because they are ordinary React. Storage,
sockets, payments, push, offline and the root layout are exactly what a Jest
environment mocks away, and exactly what breaks on a device.

---

## 3. API contract drift — Adequate

**Criteria:** every endpoint the client calls is checked against what the API
actually serves, and the check cannot pass vacuously.

**Measured:** 403 distinct method+endpoint pairs across 46 API modules (492 call
sites). 402 verified. 74 call sites build their endpoint at runtime and are
reported as unverifiable rather than counted as passing. No inline `fetch()`
bypasses the client.

Enforced by `npm run api:check`.

🔴 **One confirmed live defect** — the first thing the ledger found:

> `PUT /api/v2/volunteering/organisations/{id}/wallet/auto-pay`
> (`lib/api/volunteering.ts:542`, surfaced as a toggle in
> `app/(modals)/volunteering-org-dashboard.tsx:410`)
>
> Laravel registers no such route. The React frontend **deliberately removed**
> this toggle — `OrgWalletTab.test.tsx` states that under auto-mint, approving
> hours always pays, so the control was meaningless. Mobile kept it. A member
> tapping it gets a failure, and `lib/api/volunteering.test.ts:305` asserts the
> call against a mock, so CI is green.
>
> This is a product decision, not a mechanical fix: mirror React and remove the
> toggle, or add the endpoint. It is left open deliberately.

It verifies against `docs/generated/laravel-api-route-inventory.json`, taken from
`php artisan route:list`, **not** against `openapi.json`. Laravel registers 2,232
distinct API paths; `openapi.json` documents 862. Verifying against the partial
contract produced 179 false findings out of 404, including `POST /api/auth/login`.
A checker that cries wolf gets ignored, so it is not an acceptable source here.

The inventory is a committed snapshot because the mobile CI runner has no PHP.
It records a fingerprint of every route-defining source file, and the ledger
reports UNVERIFIED and exits non-zero when that fingerprint no longer matches —
so a snapshot nobody refreshed can never read as a pass.

---

## 4. Route parity drift — Adequate

**Criteria:** every React member route has a recorded mobile decision, and a new
one cannot land silently.

**Measured:** 254 React member routes against 137 Expo Router screens.

| Status | Count |
| --- | --- |
| Covered natively | 125 |
| Deliberately out of scope | 65 |
| Known gaps | 33 |
| Awaiting review | 31 |
| Undeclared | 0 |

Enforced by `npm run parity:check`, declarations in `parity-map.json`, full
matrix at [generated/mobile-parity-matrix.md](generated/mobile-parity-matrix.md).

An undeclared route fails the check. That is the anti-drift mechanism: when React
gains a member route, someone must write down what mobile will do about it.
"Out of scope" is a fine answer; silence is not. This is the failure mode `web-uk`
paid for — 18 routes landed during a pause and the deficit went from 1 to 19 with
nothing reporting it for a week.

`needs-review` (31) is a shrink-only queue, capped in `parity-map.json`. It exists
so the gate could be switched on honestly today rather than "once everything is
classified": a confidently wrong `out-of-scope` closes a question that should
stay open. Most of it is the Caring Community member surfaces and five
token-based deep links.

The 33 gaps are genuine absences, not oversights — courses, podcasts, premium
donations, ideation campaigns, clubs, venues, What's On, and per-member
application lists. [HEROUI_NATIVE_PARITY_AUDIT.md](HEROUI_NATIVE_PARITY_AUDIT.md)
remains the place for product judgement per area; this matrix is the falsifiable
companion to it.

---

## 5. Type safety — Strong

`tsc --noEmit` with TypeScript strict, blocking in CI. Zod schemas validate API
responses at runtime in the API layer.

🔴 One inherited trap: a `.strict()` Zod schema throws at runtime on an unexpected
field, and the mobile agenda schema sat broken for weeks in 2026-08 because
`contracts/**` woke no mobile CI filter. It does now (`.github/ci-paths.yml`).

---

## 6. Release and native policy — Strong

Both blocking in CI:

- `npm run verify:release` — OTA update policy (`updates.enabled`, `ON_LOAD`).
- Generated-manifest inspection — `expo prebuild` then assert the network
  security config is referenced, pins `api.project-nexus.ie`, and uses SHA-256
  certificate digests.

Certificate pinning, token handling and OTA policy are documented in
[SECURITY.md](SECURITY.md). Store identity is fixed in
[DISTRIBUTION.md](DISTRIBUTION.md). Launcher, splash, adaptive and notification
icons are all real assets — the README's warning about placeholders is stale.

---

## 7. Crash reporting — Adequate

`@sentry/react-native` is wired. What is missing is the loop the web platform
has: `scripts/postdeploy-watch.mjs` watches Sentry for 30 minutes after a web
deploy and alarms on a spike. A mobile rollout has no equivalent, so a crash
introduced by an OTA update or a store release is noticed by a member first.

🔴 Relevant precedent: web crash reporting was consent-gated for a period, so
Sentry saw nothing for members who declined analytics cookies. Confirm the mobile
client does not carry the same gate before trusting a quiet dashboard.

---

## 8. End-to-end journeys — Weak

Nine Maestro flows exist (`.maestro/01`–`09`): login, logout, browse listings,
browse groups, view events, messages, profile/explore, search, registration.
They are well written and handle the tenant-selection screen and expired sessions.

**Nothing runs them.** `.maestro/README.md` states plainly that Maestro is an
operator-run device test, and no workflow launches an emulator or a device farm.
So the only automated proof that the app starts at all is a Jest render.

🔴 `.maestro/config.yaml` points at `.github/workflows/mobile-eas-build.yml` for
CI configuration. That file does not exist. See [TESTING.md](TESTING.md).

---

## 9. Visual correctness — Unmeasured

There is no snapshot testing, no screenshot capture, no visual diffing, no
Storybook. Not one mechanism anywhere in `mobile/` that would notice a layout
breaking.

This is the single biggest gap, and it matches the reported symptom: the app has
visual bugs, and the test suite is structurally incapable of seeing them.
`web-uk` has `visual:journey` screenshot capture; mobile has nothing comparable.

---

## 10. iOS — Unmeasured

- CI builds and inspects **Android only** (`expo prebuild --platform android`).
- `package.json` has no iOS build or submit script.
- `eas.json` defines iOS resource classes, but `submit.production.ios.ascAppId`
  is still the literal string `APPLE_APP_STORE_CONNECT_APP_ID`.
- [DISTRIBUTION.md](DISTRIBUTION.md) documents Android channels only; the iOS
  bundle ID is reserved, not shipped.
- The development workstation is Windows, so no iOS simulator can run locally.

The Jest suite is platform-agnostic and does exercise `.native.ts` variants, so
the logic is not untested — but no iOS binary has ever been built or run by any
automated process. Treat every iOS claim as unverified.

---

## 11. Accessibility — Weak

683 accessibility props across 119 of 189 screens and components (63%), and 241
`getByLabelText` assertions in tests — so a11y is being written, and the tests
lean on it. What is missing is a gate: nothing fails when a new screen ships with
no labels, and there is no automated audit like the web platform's
`accessibility-check` job.

---

## 12. Internationalisation — Weak

**7 locales** (`en de es fr ga it pt`) against the platform's **11** (missing
`nl pl ja ar`). 34 namespaces per locale, and locale content is genuinely
test-enforced — 40 `locales/*-content.test.ts` files assert real keys, which is
better discipline than most of the platform.

The gap is coverage of languages, not of process. A member whose tenant runs in
Polish gets an English app.

---

## 13. Offline and flaky-network behaviour — Weak

`@react-native-community/netinfo` is present, `OfflineBanner` exists (at 0%
coverage), and there is a real offline check-in queue
(`lib/eventOfflineCheckinStore.ts`, 199 lines, 32.7% covered). No systematic
testing of connection loss mid-request, token refresh on a flaky connection, or
queue replay. On a phone this is not an edge case; it is Tuesday.

---

## 14. Performance — Unmeasured

No startup-time budget, no bundle-size ceiling, no list-scroll measurement. The
web platform has Lighthouse in CI; mobile has no equivalent number, so "the app
feels slow" cannot currently be answered with evidence.

---

## Keeping this honest

- Re-measure and update the scorecard whenever a dimension changes. A score that
  drifts from the code is worse than no score.
- A dimension moves to `Strong` only when something automated would fail on a
  regression. Adding effort does not raise a score; adding a gate does.
- Every figure here is reproducible from the commands in [TESTING.md](TESTING.md).
  If a number cannot be reproduced, treat it as wrong and re-measure.
