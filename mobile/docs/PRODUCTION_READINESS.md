<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Production Readiness Rubric

Last reviewed: 2026-08-18

Second edition, same day. Every figure below was measured by running the check,
not by reading a document. The first edition's figures are kept where they moved,
so the direction of travel stays visible.

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
| 1 | Automated test suite | **Strong** | 271 suites / 1,694 tests, 0 skipped, 0 quarantined, blocking in CI (was 263 / 1,563) |
| 2 | Code coverage | **Adequate** | 72.83% lines, up from 71.68%; every named 0% seam now covered |
| 3 | API contract drift | **Adequate** | 402 of 403 endpoints verified against Laravel's real routes; 1 confirmed defect open |
| 4 | Route parity drift | **Adequate** | All 254 React member routes classified; 33 gaps, 31 awaiting review, budget shrink-only |
| 5 | Type safety | **Strong** | `tsc --noEmit` strict, blocking in CI |
| 6 | Release & native policy | **Strong** | `verify:release` plus generated-manifest inspection, both blocking |
| 7 | Crash reporting | **Adequate** | Sentry React Native wired; no release-health gate after a rollout |
| 8 | End-to-end journeys | **Weak** | 9 Maestro flows exist but are operator-run; nothing runs them in CI |
| 9 | Visual correctness | **Weak** | Contrast gated (37 assertions, found 7 real failures) AND screenshot diffing now works (0px repeatable, 97.4% sensitive) — but only 1 screen has a baseline |
| 10 | iOS | **Unmeasured** | Never built or run in CI or locally; App Store Connect ID is still a placeholder |
| 11 | Accessibility | **Weak** | 683 a11y props over 119 of 189 screens (63%); WCAG AA contrast now gated, but no label-coverage gate |
| 12 | Internationalisation | **Weak** | 7 locales against the platform's 11; namespace content is test-enforced |
| 13 | Offline & flaky-network behaviour | **Weak** | Offline check-in store exists at 33% coverage; no systematic offline testing |
| 14 | Performance | **Unmeasured** | No startup-time, bundle-size or list-scroll budget |

**Overall: not production-ready as a flagship, genuinely ready as an Android
companion app.** The logic layer is in good shape and now has drift alarms. What
is still missing is everything that proves the app *looks* right on a real
device — which is exactly where the reported bugs live.

🔴 **One class of visual bug has now been found and fixed rather than described.**
The theme's light-mode text colours failed WCAG AA on five of seventeen rendered
pairs, `textMuted` worst at **2.45:1** against a 4.5 minimum — barely half, on
every muted label in the app. Two dark-mode pairs failed marginally. All seven
are fixed and gated (§9). Nothing in a 1,563-test suite could see them, because a
unit test renders a colour just as happily whether or not a human can read it.

---

## 1. Automated test suite — Strong

**Criteria:** the whole suite runs in CI, blocks the release gate, has no skipped
or quarantined tests, and completes fast enough to run on every change.

**Measured:** 271 suites, 1,694 tests, all passing. Zero `it.skip` /
`describe.skip` / `it.todo` in the tree, and no quarantine list — so a green run
means every test ran. The React frontend cannot say that (55 of its 1,283 suites
are quarantined); mobile can.

Timing, measured on the dev workstation (Ryzen 9 9950X3D, 16c/32t): **16s in
parallel, 71s with `--runInBand`**, identical pass counts both ways. CI uses
`--runInBand` because `ubuntu-latest` is 4 vCPU; locally, parallel is the sane
default and makes the app four times less tedious to work on.

Blocking in `ci.yml` via `mobile-release` → `release-gate`.

This is the strongest thing about the mobile app and it deserves saying plainly.

---

## 2. Code coverage — Adequate

**Criteria:** coverage is measured over *all* source files, is enforced per area
rather than as one global average, and can only improve.

**Measured (2026-08-18, after the seam work below):**

| Metric | Value | First edition |
| --- | --- | --- |
| Lines | **72.83%** (11,695 / 16,057) | 71.68% |
| Statements | 69.73% | 68.61% |
| Branches | 62.56% | 61.97% |
| Functions | 67.09% | 65.91% |

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

### The seams that were at or near zero — now covered

These were never the biggest files. They were the ones where a failure is
invisible to a unit test and obvious to a member. All of them were the
native-integration layer, which is exactly what a Jest environment mocks away.

| Area | Was | Now | Why it mattered |
| --- | --- | --- | --- |
| `lib/storage.ts` | 25.2% | **100%** | The store holding access and refresh tokens — the "random logouts" path |
| `lib/realtime.ts` | 0% | **100%** | Pusher lifecycle and the per-channel auth headers |
| `lib/payments/` (5 files) | 0% | **100%** | Stripe identity and marketplace payment entry points |
| `lib/env.ts` | 0% | **100%** | Decides which API the app talks to, including the live one |
| `lib/haptics.ts` | 0% | **100%** | Was unreachable — see the global-mock note below |
| `components/ErrorBoundary.tsx` | 0% | **100%** | What a member sees when something else fails |
| `lib/api/jobs.ts` | 0% | **100%** lines | The only one of 46 API modules with no test |

🔴 **Four of those files were not merely untested — they were unreachable.**
`jest-setup.ts` mocks `@/lib/haptics`, `@/components/OfflineBanner`,
`@/components/TenantBanner`, `@/components/ui/LoadingSpinner` and
`@/components/ui/Skeleton` GLOBALLY, for every test in the suite. That is a
sensible default, but it means no test could execute the real implementation, and
0% looked like neglect when it was really a mock. Reaching them needs
`jest.unmock()` — see `lib/haptics.test.ts`, the first use of it in this
codebase. `OfflineBanner`, `TenantBanner`, `LoadingSpinner` and `Skeleton` remain
uncovered for this reason and are the obvious next candidates.

### Still under-covered

| Area | Lines | Coverage | Note |
| --- | --- | --- | --- |
| `app/_layout.tsx` | 67 | 0% | 759 source lines: root providers, auth redirect, deep links, push registration. The largest remaining risk. |
| `lib/eventOfflineCheckinStore.ts` | 199 | 32.7% | Offline check-in queue; the largest under-tested unit |
| `components/events/EventOfflineCheckinCard.tsx` | 146 | 0% | Its UI |
| `components/VoiceMessageBubble.tsx` | 52 | 0% | Voice message playback |
| `components/marketplace/` | 19 | 0% | — |

The pattern held throughout: **the untested code was the native-integration
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

## 9. Visual correctness — Weak (was Unmeasured)

**Criteria:** something automated fails when the app stops looking right.

### What now exists: a WCAG AA contrast gate on the theme

`lib/hooks/useTheme.contrast.test.ts` recomputes the contrast ratio of all 17
rendered foreground/background pairs in both schemes — 37 assertions — from the
WCAG sRGB formula. Ratios are **recomputed, never stored**: a stored number
passes forever once somebody updates it to match a regression.

This is the one class of visual bug catchable without a device, and it is worth
having because `LIGHT` and `DARK` are the single source of truth for literal
colour in the app. One bad token is not one bad screen; it is every label of that
kind, everywhere.

🔴 **It found seven real failures the moment it was written.**

| Pair | Was | Now |
| --- | --- | --- |
| light `textMuted` on `bg` | **2.45** | 4.55 |
| light `textMuted` on `surface` | **2.56** | 4.76 |
| light `success` on `successBg` | **2.91** | 5.13 |
| light `warning` on `bg` | 3.04 | 5.36 |
| light `error` on `errorBg` | 3.95 | 5.30 |
| light `info` on `infoBg` | 4.24 | 4.99 |
| dark `textMuted` on `surface` | 4.32 | 5.22 |
| dark `info` on `infoBg` | 3.13 | 4.91 |

`textMuted` at 2.45:1 was barely half the requirement, on every muted label in
the app. The replacement values were **computed, not chosen**: the lightest shade
of each hue that still clears 4.5:1 on the darkest surface it appears on, which is
the same method — and for four tokens the same hex values — the React frontend
derived in `6307b7dda`. So the two surfaces now agree rather than drifting apart.

Dark mode was left almost alone deliberately: eleven of its thirteen text pairs
already passed comfortably, so only the two that actually failed were touched.

### What still does not exist

No snapshot testing, no screenshot capture, no visual diffing, no Storybook.
The contrast gate proves the **palette** is legible; it proves nothing about
whether a screen uses the palette, and nothing at all about layout, text
truncation, overlap, or touch-target size.

🔴 Scale of that hole: **1,506 hardcoded hex colour literals across 95 files** in
`app/` and `components/`. Every one of them bypasses the theme, so it cannot adapt
between light and dark and is invisible to the gate above. A blanket check would
report 1,506 findings on day one, which is not a check anybody would act on —
triaging them is real work, and is listed in the plan rather than pretended away.

### Screenshot testing now exists and works

`scripts/screenshots.mjs` (capture / compare / approve) plus `scripts/emulator.mjs`.
Verified end to end on 2026-08-18: SDK installed, emulator booted headless, release
APK built (`BUILD SUCCESSFUL in 2m 50s`), installed, launched, and the login screen
captured in both light and dark.

| Property | Measured |
| --- | --- |
| Repeatability | **0 pixels** differ between two captures of the same screen, both schemes |
| Sensitivity | Dark render vs light baseline → **97.4%** changed, exit 1 |
| Baselines committed | `screenshots/baseline/{light,dark}/01-launch.png`, ~100 KB each |

🔴 **One screen, not a suite.** The login screen needs no credentials, which makes
it a reliable first baseline; every signed-in screen needs a Maestro flow to
navigate there and a seeded local API. So this is a working mechanism with almost
no coverage yet — the honest state is "the gate exists and fires", not "the app is
visually tested".

🔴 A debug APK is unusable for this: it fetches its JavaScript from Metro, and when
the emulator cannot reach the dev server the app renders a bare background colour.
That was captured first and would have become a baseline of a blank screen. Release
builds only.

Pixel-level testing needs an emulator, and **that blocker is now cleared**
(2026-08-18). The SDK, an API 36 system image, an AVD (`nexus_test`) and Maestro
2.8.0 are installed and verified: the emulator boots headless to
`sys.boot_completed=1`, `adb` sees it, and `adb exec-out screencap` returns a
valid 1080x2400 PNG. Setup and commands are in [TESTING.md](TESTING.md).

🔴 The earlier edition of this section said there was no Android SDK and implied
Android Studio was missing. Studio was installed all along — only its SDK had
never been downloaded, while `ANDROID_HOME` and a `platform-tools` PATH entry both
pointed confidently at the absent directory. The lesson generalises: test that a
tool's directory *exists* rather than that its variable is set.

So screenshot testing is built and verified on this machine. What is thin is the
coverage: one screen in two schemes.

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
lean on it.

**Colour contrast is now gated** (§9) — that is the one WCAG criterion with an
automated check, and it caught seven real failures. What is still missing is a
label-coverage gate: nothing fails when a new screen ships with no
`accessibilityLabel`, and there is no automated audit like the web platform's
`accessibility-check` job. Touch-target size is also unchecked.

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
