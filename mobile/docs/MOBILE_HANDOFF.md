<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile hand-off — start here

Last reviewed: 2026-09-06

Status: **Maintained — short entry point; detailed evidence lives in the linked sources.**

## What this app is

`mobile/` is the Expo / React Native client built with HeroUI Native and Uniwind. It is not
the Capacitor wrapper. Android package `ie.project.nexus` is publicly installable from Google
Play. iOS remains unbuilt and is still an explicit ledger item.

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

`check:cert-pins` needs OpenSSL. On this Windows machine prepend
`C:\Program Files\Git\usr\bin` to `PATH`; an unavailable tool is not a security pass.

The current known non-failing debt is explicit: lint has warnings but no errors; the
production dependency gate accepts only the reviewed build-time `image-size` advisories;
the untranslated-phrase counts are shrink-only; and the startup bundle is below a blocking
ceiling with limited headroom. Never describe those gates as clean in a stronger sense than
their output supports.

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
| HeroUI Native composition rules | [`NATIVE_UI_CONTRACT.md`](NATIVE_UI_CONTRACT.md), [`WRAPPER_POLICY.md`](WRAPPER_POLICY.md) |
