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
| 1 | Automated test suite | **Strong** | 274 suites / 1,779 tests, 0 skipped, 0 quarantined, blocking in CI (was 263 / 1,563) |
| 2 | Code coverage | **Adequate** | 73.73% lines, up from 71.68%; every named 0% seam covered, the start-up routing decision pinned, and the offline check-in queue taken from 33% to 95% |
| 3 | API contract drift | **Adequate** | 402 of 403 endpoints verified against Laravel's real routes; 1 confirmed defect open |
| 4 | Route parity drift | **Adequate** | All 254 React member routes classified; 33 gaps, 31 awaiting review, budget shrink-only |
| 5 | Type safety | **Strong** | `tsc --noEmit` strict, blocking in CI |
| 6 | Release & native policy | **Strong** | `verify:release` plus generated-manifest inspection, both blocking |
| 7 | Crash reporting | **Adequate** | Sentry React Native wired; no release-health gate after a rollout |
| 8 | End-to-end journeys | **Adequate** | All 9 Maestro flows PASS against the local API (they had never been run); a nightly CI workflow exists but has never run |
| 9 | Visual correctness | **Weak** | Contrast gated (37 assertions, found 7 real failures); 3 screens pixel-gated at 0px. Visual sweep 2026-08-19: 93 images over 31 screens (light, dark, 1.3x text). Three bugs found and fixed — an invisible icon on every listing card, content scrolling under the clock app-wide, and a clipped filter row. One systemic finding open: two clashing brand colours in 128 controls, awaiting an owner decision. See [VISUAL_AUDIT.md](VISUAL_AUDIT.md). ~106 screens still unphotographed |
| 10 | iOS | **Unmeasured** | Never built or run in CI or locally; App Store Connect ID is still a placeholder |
| 11 | Accessibility | **Adequate** | Re-measured: 2 of 44 interactive elements lack a label — one already exposes visible text, the other is in unused code. WCAG AA contrast is checked. Touch-target size and on-device screen-reader behaviour still unchecked |
| 12 | Internationalisation | **Weak** | 7 locales against the platform's 11. `nl` `pl` `ja` are ~17,200 strings of ordinary work; **`ar` is blocked** — the app has no right-to-left support at all |
| 13 | Offline & flaky-network behaviour | **Adequate for check-in, Weak elsewhere** | Offline check-in store now 94.97% covered, incl. the retry that stops a double-credit; mid-request connection loss still untested elsewhere |
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
| `app/_layout.tsx` | 62 | 0% | Still 0%, but the *risk* has moved out of it. The start-up routing decision and the Sentry credential scrubbing were extracted to `lib/navigation/authRedirect.ts` and `lib/observability/sentryScrubbing.ts`, both now at **100%** across 49 tests. What remains in the file is provider wiring and ~90 `Stack.Screen` declarations — worth far less to test, and covered from the outside by the Maestro flows. |
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

## 8. End-to-end journeys — Adequate (was Weak)

Nine Maestro flows (`.maestro/01`–`09`): login, logout, browse listings, browse
groups, view events, messages, profile/explore, search, registration. **All nine
pass** against the local API as of 2026-08-18 — they had never been run before.

`.github/workflows/mobile-device-tests.yml` runs them nightly on an emulator against
a real Laravel API. 🔴 **That workflow has never executed on a runner**, so until it
has a green run these flows are still effectively operator-run, and the dimension
cannot move above Adequate. Checking it against reality already corrected two real
errors (`artisan serve` serves the wrong directory in this repo; `/health.php` 404s
under the built-in server), which is a fair indication that the first run will need
iteration.

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
| Screens toured | 6 (login, feed, listings, messages, profile, wallet) |
| Screens **compared** | **3** — login, profile, wallet |
| Repeatability | **0 pixels** across repeated runs, both schemes |
| Sensitivity | Dark render vs light baseline → **94–97%** changed, exit 1 |
| Baselines committed | `screenshots/baseline/{light,dark}/` — 6 files |

🔴 **Half the toured screens cannot be compared, and that is a real limit on this
dimension.** The feed is algorithmically ordered (18% difference between identical
runs), and listings and messages animate their content in on a stagger that no
settle wait resolved (8–9%). All three also carry relative timestamps that drift
daily. They are captured for eyeballing and excluded from the comparison, which the
output states on every run. Fixing them needs fixed-date seed data and a
deterministic sort — worth doing, not done.

The tour signs in and visits six screens, so signed-in coverage now exists — the
Maestro work made that possible. Three of the six are gated. The honest state is
"three screens are genuinely protected, including the wallet", not "the app is
visually tested": 137 Expo Router screens exist and 3 have baselines.

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

## 11. Accessibility — Adequate

> 🔴 **This section said "Weak" on the strength of a metric that measured the wrong
> thing.** The original figure — "683 accessibility props across 119 of 189 screens
> (63%)" — counted *files that mention any accessibility prop*. A file scores as a
> miss under that count if it is a pure layout wrapper with nothing interactive in
> it, which describes most of the 70 files it was counting against us. It says
> nothing about whether anything a member can actually press has a name.

**Re-measured 2026-08-19 against the question that matters** — how many interactive
elements a screen reader would announce with no name:

| | Count |
|---|---|
| Files containing a touchable (`Pressable`, `TouchableOpacity`, `NativePressable`) | 29 |
| Touchable elements in them | 44 |
| Files with a touchable and **no** `accessibilityLabel` | **2** |

Both of the two are benign:

- `app/(modals)/legal-document.tsx` — a retry button that already carries
  `accessibilityRole="button"` and whose only child is visible translated text. A
  screen reader reads the text; an added label would be a second, duplicate name.
- `components/ui/Card.tsx` — its pressable branch has no way to receive a label at
  all, which *would* be a real gap except that **nothing imports this file** (see
  §11.1). Fixing dead code would be theatre.

Most interaction goes through wrapped components that require or forward a label,
which is why the honest number is 2 and not 70. There are also 241
`getByLabelText` assertions in the tests, so labels are load-bearing in the suite —
removing one breaks tests.

**What is genuinely still unchecked**, and is the reason this is "Adequate" and not
"Strong":

- **Touch-target size.** Nothing measures the 44×44pt minimum.
- **A label-coverage check.** The 2-file state is good but unprotected; nothing
  fails if a new screen ships with an unlabelled icon button. A check was written
  and then not kept: at 2 findings, 1 of them a false positive and 1 in dead code,
  it would have spent most of its life reporting noise. Worth adding when the count
  of *real* findings justifies it, not before.
- **Screen-reader behaviour on a device.** No TalkBack or VoiceOver run has ever
  happened here. Labels existing is not the same as a screen reader making sense of
  the screen, and only §16's device work could establish the latter.

### 11.1 Three wrapper components are unused

`components/ui/Badge.tsx`, `components/ui/Card.tsx` and `components/ui/Divider.tsx`
have **no importers anywhere** in `app/`, `components/` or `lib/`. Screens import
`Badge`, `Card` and `Divider` from `heroui-native` directly instead.

They are not harmless. Each has a test file, so they contribute passing tests and
coverage percentage for code no member can reach, and their presence suggests a
house wrapper pattern that the app does not in fact follow — the next person to
add a card has two plausible imports and no way to tell which is right.

Deleting them is **an owner decision, not a cleanup**: a wrapper may be deliberate
groundwork for a later HeroUI version change, and this platform's standing rule is
not to remove working code to satisfy a metric. Recorded here so the choice is
made deliberately rather than by accident.

---

## 12. Internationalisation — Weak

**7 locales** (`en de es fr ga it pt`) against the platform's **11** (missing
`nl pl ja ar`). **5,732 English keys** across 34 namespaces, and locale content is
genuinely test-enforced — 40 `locales/*-content.test.ts` files assert real keys,
which is better discipline than most of the platform.

Two things here are better than expected and one is worse.

**Better:** the language picker cannot lie. `SUPPORTED_LANGUAGES` is derived from
`Object.keys(languageLoaders)` in `lib/i18n.ts`, so the app offers exactly the
languages it can actually load. A member is never shown a language that would leave
them on English — the usual form of this bug does not exist here.

**Better:** nothing about the pipeline is missing. `scripts/translate-mobile-i18n-gaps.mjs`
already exists and uses Google's unauthenticated translate endpoint, so **no API key
or spend is required**.

🔴 **Worse: the four missing languages are not one job, they are two, and one of
them cannot be done by translating anything.**

### Dutch, Polish, Japanese — ordinary work, ~17,200 strings

Mechanical but not free. Three things beyond the translation itself:

1. `scripts/translate-mobile-i18n-gaps.mjs --summary` currently reports
   `Total: 0 missing`. That is **not** evidence there is no gap — the tool only
   considers locale directories that already exist, and these four do not. Each
   needs `locales/<code>/` seeded with the 34 namespaces carrying **English**
   values first; the translator only fills keys that are already present.
2. `lib/i18n.ts` hand-registers every locale with an explicit `require()` block per
   namespace, so each new language needs its own ~34-line block. This is deliberate
   (it is what keeps unused languages out of memory), not something to refactor away
   in passing.
3. `native-locales/<code>.json` and `app.json`'s `expo-localization`
   `supportedLocales` both need the new codes, or the OS-level strings stay English.

Machine translation of this volume also carries a known cost on this platform: the
web side spent real effort clearing 99,139 machine-filled strings, and the recorded
failure modes — mangled URI schemes, capitalised literal field names — apply
identically here. Whoever does this should expect to review, not just to run.

### Arabic — blocked, and translating it would make things worse

**The app has no right-to-left support whatsoever.** Verified 2026-08-19: a search
of `app/`, `components/` and `lib/` for `I18nManager`, `allowRTL`, `forceRTL`,
`isRTL` and `writingDirection` returns **nothing**, and no layout uses the
direction-aware `marginStart` / `paddingStart` in place of `marginLeft` /
`paddingLeft`.

So adding Arabic strings would produce Arabic text in a left-to-right layout: back
arrows pointing the wrong way, labels and values transposed, text pinned to the
wrong edge. That is worse for an Arabic-speaking member than English, because a
half-flipped app reads as broken software rather than as software that does not
speak your language — and it is worse for the platform, because it looks like RTL
was attempted and failed.

**Recommendation: add `nl`, `pl` and `ja`, and hold `ar` until RTL support exists.**
RTL is a layout project in its own right — `I18nManager.allowRTL`, an audit of every
directional style in 189 screens, and mirrored icons — not a translation task, and
it should be scoped separately rather than smuggled in behind a language.

🔴 This is a decision for the owner, not an assumption to act on, because "add the
4 missing languages" and "add 3 and open an RTL project" are different pieces of
work. Nothing has been created for either.

---

## 13. Offline and flaky-network behaviour — Adequate for check-in, Weak elsewhere

`@react-native-community/netinfo` is present and `OfflineBanner` exists (still 0%
covered).

### The offline event check-in queue is now properly tested

`lib/eventOfflineCheckinStore.ts` (503 lines, 199 instrumented) went from **32.67%
to 94.97%** line coverage on 2026-08-19 — 100% of its functions, 84.8% of branches.
41 tests across two suites; the shrink-only floor was raised to 94.47% in the same
commit, so it cannot quietly slide back.

This was the right place to spend the effort. The code decides who gets credited for
attending an event while the phone has no signal, and it fails in two directions that
both cost a member real money in time credits:

- **A dropped check-in is unpaid work.** Someone stood in the room and the platform
  has no record of it.
- **A double-applied check-in is credit nobody earned**, which is worse, because it
  has to be taken back off a member who did nothing wrong.

What is now pinned by test, and was not before:

| Guarantee | Why it matters at the door |
|---|---|
| Ed25519 signatures verified **for real** in the tests, not mocked | A forged pass would let anyone check anyone in. Mocking `verify` would have made this test pass while proving nothing |
| A pass from a **different occurrence** of a recurring event is refused | Last week's pass is correctly signed and unexpired; the occurrence digest is the only thing stopping it |
| An expired pass reports `credential_expired`, not `credential_invalid` | "This pass has expired" is something a steward can act on at the door; "invalid" sends them hunting a fault that is not there |
| The same pass scanned twice is refused, and so is a second check-in via a different pass | The double-scan, from both directions: one is a copied pass, the other is the state machine |
| Each queued operation claims the next attendance version | Get this count wrong and the server rejects the whole batch as conflicted — a hall full of check-ins goes in by hand |
| 🔴 **A failed send keeps the same batch id, and retries exactly the items that batch held** | The most consequential branch in the file. The send may have reached the server and only the reply been lost; retrying under a fresh id presents the same check-ins as new work and everyone gets credited twice |
| Items older than the replay window are rejected locally and never sent | The steward is told while they can still do something, instead of an item sitting "pending" for ever |
| A conflict is kept in the queue, not discarded | A conflict needs a human; dropping it loses the fact that someone was at the door |
| A rotated or revoked steward device cannot adopt a fresh roster | This is what stops a revoked device carrying on checking people in |
| An unreadable stored record is destroyed, not left on the phone | It is a roster of members' names, and if it will not decrypt it cannot be trusted or recovered |
| Member names and the device secret never appear in the written file | Confirmed by asserting their **absence** from the bytes on disk |

**These tests were verified to be capable of failing.** Four deliberate mutations
of the source — accepting a forged signature, forgetting the batch id on failure,
dropping the replay-window rejection, and dropping the reason requirement on undo —
each turned the intended test red and only that test, and the source was restored
from git afterwards. A passing suite that cannot fail is worse than no suite,
because it is believed.

### What is still weak

- **Connection loss mid-request everywhere else.** The check-in queue is the one
  place a lost response is handled deliberately and now tested. Ordinary screens are
  not covered for it.
- **Token refresh on a flaky connection.** Untested.
- **`OfflineBanner` at 0% coverage** — the component that tells a member they are
  offline has no test.
- **No device-level offline test.** Nothing has ever been run with aeroplane mode on
  a real or emulated phone; all of the above is proven in Jest, against mocked
  storage and a mocked network. That is a genuine limit: it proves the decisions are
  right, not that the phone behaves when the radio actually drops.

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
