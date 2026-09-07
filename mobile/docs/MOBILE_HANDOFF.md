<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile hand-off — start here

Last reviewed: 2026-09-07

Status: **Maintained — short entry point; detailed evidence lives in the linked sources.**

## What this app is

`mobile/` is the Expo / React Native client built with HeroUI Native and Uniwind. It is not
the Capacitor wrapper. Android package `ie.project.nexus` is publicly installable from Google
Play.

🔴 **"iOS remains unbuilt" was true until 2026-09-07 and is now wrong.** iOS compiles and
runs: EAS built it on 2026-08-27 (`ios-simulator`, FINISHED), and since 2026-09-07 CI builds
it from source every night, boots a simulator and confirms the app reaches its first screen.
What iOS still lacks is a SIGNED build and a store presence, both of which need the owner's
Apple developer account — see "iOS App Store readiness" below.

## Current truth

- [`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md) owns the one
  current M1 score and the risk-ordered backlog. Do not copy its number into a new report.
- [`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) owns the fixed 140-row work list and
  the evidence for every CERTIFIED, PROVEN, PARTIAL, OPEN and N/A status.
- [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) retains the phased history and current release
  handoff. It is not a second scorecard.
- [`PLAY_SUBMISSION.md`](PLAY_SUBMISSION.md) owns signing, listing copy, Data Safety,
  reviewer-access and Play asset evidence.

The app's core journeys are real, not only mocked: community selection, authentication,
feed posting/moderation, the complete timebanking exchange, member messaging, volunteering,
wallet transfers, events, groups, polls, jobs and marketplace activity have all been walked
on devices with their effects checked. Public distribution, Sentry, policy pages, signing,
phone artwork and tablet artwork exist.

## 🔴 Nothing in the app links to the website (2026-09-06)

The owner's instruction is that the member app is finished and self-contained. Two rounds
of work closed the gaps, and three tests now hold the line — read them before adding any
`Linking.openURL`:

- `app/quickCreateRoutesAreNative.test.ts` — every "+" Create option opens a screen that
  exists on disk, and the file may not contain `Linking` or `buildWebUrl` at all.
- `app/+native-intent.coverage.test.ts` — a route with a native screen that no deep link
  can reach is a failure. It caught three (`faq`, `acceptable-use`, `community-guidelines`)
  that would otherwise have shipped unreachable.
- `app/modalDeclarations.test.ts` — every modal file is declared in `_layout.tsx`.

What changed: course authoring, the podcast studio, course grading and analytics are now
native (`parity-map.json` had all four recorded `out-of-scope`, which is what made a browser
hand-off look correct); the support screen's nine items open real native screens fed by real
server content instead of a browser, and its invented three-section policy summaries are
gone; event templates can be captured in the app; and `components/FeatureGate.tsx` now gates
module screens the way React's route gates do, because hiding a menu entry never was a gate.

🔴 `Linking.openURL` is still correct, and still present, for genuinely external
destinations: a member's or organisation's own website, Stripe checkout and onboarding,
Stripe Identity, a meeting link on an event, an attachment, the Play Store, the AGPL source
repository, and `+not-found.tsx`'s escape for a path this build has no screen for. Sharing a
listing or an event still shares a **web** URL on purpose — the recipient may not have the
app. Do not "fix" those.

🔴 One gap is deliberately NOT fixed here and needs an owner decision. `courses` and
`podcasts` default to `false` in `TenantFeatureConfig::FEATURE_DEFAULTS`, and both
`CourseController` and `PodcastController` carry doc comments claiming they are "gated by
the per-tenant feature flag" — but neither the routes nor the controllers check it. The API
therefore serves both modules to communities that never switched them on. Queries stay
tenant-scoped, so this is a gating bypass rather than a cross-tenant leak. The fix is
`->middleware('feature:courses')` / `feature:podcasts` on those route blocks, which would
immediately 403 every community with the flag unset — a production authorisation change,
not a mobile release change.

The current source is **not yet the public build**. The working tree contains the neutral
first-install community picker, tablet captures, asset validator and this audit. Existing
installs keep their stored community; a clean install now starts unselected. These changes
must be committed, pass CI and become a new signed version before a Play user receives them.

## 🔴 CI now proves the app STARTS, on both platforms (2026-09-07)

`.github/workflows/mobile-emulator.yml` is the only thing in this repository that answers
whether the app launches at all. Both jobs — `Android Launch Smoke` and `iOS Launch Smoke` —
build the native app from source, boot a real device, install it, launch it and assert it
reaches one of its two legitimate first screens (`.maestro/00-launch-smoke.yaml`). Green on
both as of `8d19d4fd1`: Android 20 min, iOS 24 min.

🔴 **Why this exists.** The 413-suite Jest run mocks the HTTP client, the native modules and
heroui-native — and that mock drops `testID`/`accessibilityLabel`. A broken native module, a
construct Hermes will not run, a bad root-layout change or a missing polyfill passes every
other gate and then crashes on launch. Nothing else can see that.

🔴 **Schedule and manual dispatch only, never on push, and that is the design.** An emulator
is the slowest and flakiest tier available; a `main` that goes red for reasons nobody caused
teaches everyone to ignore CI. It also sits in its own workflow because
`scripts/predeploy-ci-verify.mjs` reads `ci.yml` and `platform-contracts.yml` only, so
nothing here can trip the unknown-job rule or hold a deploy hostage. Promoting it into
`ci.yml` means adding it to `REQUIRED_JOBS` in the same commit.

🔴 **What a green tick here does NOT mean.** It does not run the 01-13 journey flows (they
need a live API and an account; `compose.ci.yml` publishes no port for the app service). It
checks nothing visual — emulator screenshots are not stable enough across API levels to gate
on, which is why `scripts/screenshots.mjs` stays a local tool. It does not run TalkBack or
VoiceOver, and it proves nothing about a SIGNED build.

**Four traps cost seven attempts to get this working. All four are commented in the workflow
and the script; read them before editing either.**

- `reactivecircus/android-emulator-runner` runs each LINE of its `script:` input in its own
  `sh -c`. A `cd` does not persist and a trailing `\` is passed through as an argument, not
  as a line continuation. The whole sequence therefore lives in
  `scripts/ci-launch-smoke-android.sh` and the action calls it in one line.
- `adb logcat` must be captured from a trap INSIDE that script. Collected in a later
  workflow step it has no device, hangs, and burns the job timeout losing the very
  diagnostics the step existed to gather.
- `xcodebuild -version | head -1` **aborts xcodebuild** — `head` closes the pipe, xcodebuild
  throws on it and dies with exit 134. Xcode versions are read from the directory names.
- Metro serves on demand and this app is ~660 modules, so the first bundle after a cold
  start takes minutes. The app gives up first and shows "Could not connect to development
  server", which is not a network fault. Both jobs pre-warm the bundle with the exact URL
  the app itself requests.

## 🔴 Xcode 26 cannot compile this app, and it is Expo SDK 54's own pin (2026-09-07)

`@stripe/stripe-react-native@0.50.3` contradicts itself: its Swift-generated header
forward-declares `STPPaymentStatus` as `NSInteger` while its hand-written
`StripeSwiftInterop.h` declares the same type as `NSUInteger`. Earlier compilers tolerated
the conflicting redeclaration; Xcode 26 treats it as an error and the build fails inside
`node_modules`. GitHub's `macos-latest` image now carries twelve Xcodes and **every one is
26.x** — measured, not assumed — so the iOS job is pinned at the runner label (`macos-15`).

🔴 **0.50.3 is NOT stale and must not be "fixed" on its own.** `npx expo install --check`
reports dependencies up to date: it is the version Expo SDK 54 specifies. Upgrading it alone
(0.76.0 is upstream) moves the app off Expo's supported matrix, on the library that handles
payments, for no benefit. The Xcode-26 pairing belongs to an Expo SDK upgrade, and Stripe
must move in the same step. Dropping the iOS job back to `macos-latest` and deleting its
Xcode-selector step is the signal that the two have realigned.

🔴 **This is not a release blocker.** EAS builds what gets submitted to Apple and it builds
this app fine. The mismatch is GitHub's runner image having moved ahead of Expo 54's
toolchain.

## 🔴 iOS App Store readiness (2026-09-07)

The owner's stated goal is publishing to the App Store once their developer account is
approved. **No engineering work blocks that.** Everything outstanding flows from the account:

| Step | Blocked on |
| --- | --- |
| Apple Team ID → generate and host the association file | the account |
| App Store Connect app record → its numeric ID into `eas.json` | the account |
| A signed production build (every iOS build so far is unsigned simulator) | the account |
| `eas submit` | all of the above |

`npm run verify:ios-release` names exactly two blockers and both are those identifiers. The
generator already exists **with tests** — `scripts/generate-apple-app-site-association.js`,
exposed as `npm run check:ios:aasa`; do not write a second one. With the Team ID:

```bash
APPLE_TEAM_ID=XXXXXXXXXX node scripts/generate-apple-app-site-association.js
npm run verify:ios-release
```

🔴 Nothing offline can tell a real Team ID from a plausible one — the gate matches
`[A-Z0-9]{10}`. Never invent one to turn the gate green; leave it red and say so. The real
verification is functional: a universal link opening the app on a signed device.

## 🔴 Android App Links never verified until 2026-09-07

`app.json` has declared `autoVerify: true` for `app.project-nexus.ie` all along, but the file
Android actually fetches — `react-frontend/public/.well-known/assetlinks.json` — named package
`com.nexus.timebank` (this app is `ie.project.nexus`) with a literal `REPLACE_WITH…`
fingerprint. Every `https://` deep link therefore opened the browser or a chooser while the
`app.json` half looked correct. Package corrected, the release upload key's real SHA-256
inserted, and `npm run verify:release` now fails on a placeholder, a package that disagrees
with `app.json`, or a malformed fingerprint.

🔴 **Still incomplete and owner-held:** if Play App Signing is enabled — mandatory for apps
published since 2021 — Google re-signs with its own certificate and *that* SHA-256 (Play
Console → Test and release → App integrity → App signing key certificate) must be listed
here too, or links stay unverified for everyone who installed from Play.

## Before another Play build

Follow the ordered backlog in the status document. The first four release gates are:

1. Correct the live Play description's false absolute no-money claim; time-credit exchanges
   use no money, while optional physical marketplace purchases may use Stripe.
2. ~~Close the organisation-deposit money-integrity gap.~~ Fixed 2026-08-27: both ledgers
   now commit atomically and the service regression suite checks wallet visibility and replay.
3. ~~Commit and push the current candidate.~~ Done as `4c38d229a`; all six workflows are
   green. No version code was changed.
4. Walk the exact next Play-distributed artefact on a physical phone as both a clean install
   and an upgrade, including push, one exchange and disposable account deletion.

Do not spend an Expo cloud build merely to test JavaScript routing or artwork. The emulator
and local Gradle path cover those; use a new Play artefact only after the candidate is banked.

## Required verification baseline

Run from `mobile/` unless the command says otherwise:

```powershell
npm.cmd run type-check
npm.cmd test -- --runInBand
npm.cmd run lint
npm.cmd run doctor
npm.cmd run verify:release
npm.cmd run verify:network-security
npm.cmd run check:cert-pins
npm.cmd run drift:check
npm.cmd run audit:production
npm.cmd run budget:check
npm.cmd run check:untranslated
npm.cmd run store:assets:check
node ..\scripts\check-doc-scores.mjs
```

The launch smoke cannot be run locally — it needs a macOS runner for iOS and a development
server this machine is not permitted to start. Exercise it on demand instead:

```bash
gh workflow run mobile-emulator.yml --ref main
```

`check:cert-pins` needs OpenSSL. On this Windows machine prepend
`C:\Program Files\Git\usr\bin` to `PATH`; an unavailable tool is not a security pass.

The current known non-failing debt is explicit: lint has warnings but no errors; the
untranslated-phrase counts are shrink-only (0 against a ceiling of 0 as of 2026-09-07); and
the startup bundle is below a blocking ceiling with limited headroom (15.27 MB of 16.35 MB).
Never describe those gates as clean in a stronger sense than their output supports.

🔴 `audit:production` accepts **two** reviewed exceptions as of 2026-09-07, not one. The
build-time `image-size` advisories, and `decode-uri-component` (GHSA-vcc3-ghjq-m6fr) via
`expo-router → @react-navigation → query-string@7`. The second one **ships and is deep-link
reachable**, and it is listed only because both remedies were tried and refused: npm's own
fix downgrades expo-router, and the patched release is ESM-only while its consumer is
CommonJS. What stands in for the patch is the length bound in `app/+native-intent.ts`, and
the gate now **asserts that bound still exists** — remove `MAX_DEEP_LINK_LENGTH` and
`audit:production` fails rather than waving the advisory through. Re-review by 2026-09-30.

## Evidence rules

- A rendered screen is not a completed journey. Verify the database row, API response,
  balance movement, notification or other durable effect.
- PROVEN means a device walk with an effect; CERTIFIED additionally requires a regression
  guard capable of going red.
- Preserve unrelated work in this shared checkout. Do not stash, reset, push, deploy or
  submit to Play without the owner's explicit instruction.
- Never commit `.env`, keystores, service-account JSON, reviewer credentials, Firebase
  credentials or Sentry tokens. The repository is public.
- Every release-relevant change updates `CHANGELOG.md`, refreshes the bundled changelog, and
  updates the affected ledger row in the same commit.

## Supporting guides

| Need | Source |
| --- | --- |
| Two-account emulator/device procedure | [`MOBILE_TEST_HARNESS.md`](MOBILE_TEST_HARNESS.md) |
| Automated suites and gates | [`TESTING.md`](TESTING.md) |
| Build, OTA and rollback mechanics | [`DISTRIBUTION.md`](DISTRIBUTION.md) |
| Native security boundary | [`SECURITY.md`](SECURITY.md) |
| Launch-smoke CI, and the four traps in it | [`../../.github/workflows/mobile-emulator.yml`](../../.github/workflows/mobile-emulator.yml), [`../scripts/ci-launch-smoke-android.sh`](../scripts/ci-launch-smoke-android.sh) |
| HeroUI Native composition rules | [`NATIVE_UI_CONTRACT.md`](NATIVE_UI_CONTRACT.md), [`WRAPPER_POLICY.md`](WRAPPER_POLICY.md) |
