# Apple App Store submission handoff

Last reviewed: 2026-08-30

This is the maintained source of truth for preparing the Expo/React Native app for
TestFlight and the Apple App Store. It records evidence and gates; it is not authority
to submit for review or release publicly.

The detailed current status, ordered critical path and Apple-source matrix are maintained in
[`store-listing/apple/readiness-audit.md`](../store-listing/apple/readiness-audit.md).
Owner-only declarations are isolated in
[`store-listing/apple/owner-legal-answers.md`](../store-listing/apple/owner-legal-answers.md),
and the exact signed candidate will be recorded in
[`store-listing/apple/release-candidate-freeze.md`](../store-listing/apple/release-candidate-freeze.md).

## Current position

| Item | Status |
|------|--------|
| App | Timebank Global |
| iOS bundle ID | `ie.project.nexus` |
| Shared mobile source | Expo SDK 54 / React Native app in `mobile/` |
| Apple Developer Program | Nonprofit enrollment submitted; approval pending |
| App Store Connect app | Not created or verified |
| Numeric App Store Connect Apple ID | Missing; placeholder remains in `eas.json` |
| Apple Team ID | Not yet recorded; required for the AASA app identifier |
| Apple signing and APNs credentials | Not configured or verified |
| iOS cloud build | Unsigned simulator build succeeded and was inspected; signed device build not run |
| Partner Demo review account | Live login and protected startup endpoints re-verified in run `33286909272`; credentials remain outside Git |
| Planned signed candidate | Version `1.2.0`, iOS build `3`; EAS remote counter was read as `2` before build |
| Real-iPhone journey walk | Never run |
| TestFlight upload | Not performed |
| App Review submission | Not authorized or performed |

The enrollment reference is private operational information and is held in the
gitignored local enrollment record, not this public repository.

## What is shared and what is separate

Android and iOS use the same TypeScript application, screens, translations and API
contract. Apple still requires its own native compilation, signing, privacy metadata,
permissions, credentials, store record, screenshots and device testing. An Android pass
does not certify the iOS binary.

The Windows workstation does not need to rent a persistent Mac. EAS Build can compile
and sign iOS in the cloud after the Apple account is active. Windows cannot run Xcode or
the iOS Simulator, so final runtime evidence must come from a real iPhone running the
signed build (or separately arranged access to macOS).

An unsigned EAS Simulator build can compile before Apple enrollment completes and does
not require an Apple Developer account. It is compile evidence only: the resulting `.app`
cannot run on this Windows PC or replace a signed real-iPhone/TestFlight walk.

The manual `iOS Simulator Screenshots` GitHub Actions workflow closes part of that runtime
gap without a Mac rental: a standard hosted macOS runner compiles the selected Git commit in
unsigned Expo Release mode, boots Apple's iPhone 16 Pro Max Simulator, runs the protected
Partner Demo Maestro tour and uploads four accepted draft screenshots plus checksums. It deliberately
does not run on pushes or pull requests, never receives credentials as workflow inputs and
does not claim signing, APNs, TestFlight or physical-device proof. See
[`store-listing/apple/screenshots.md`](../store-listing/apple/screenshots.md).

That compile and the current four-page Simulator tour have now succeeded. The checked
evidence, artifact hashes, native metadata and
remaining limitations are recorded in
[`store-listing/apple/build-evidence.md`](../store-listing/apple/build-evidence.md).

## Source-level configuration already present

- Bundle identifier `ie.project.nexus` and build number in `app.json`.
- EAS `preview` and `production` iOS build profiles.
- Localized native permission strings for camera, photos, microphone, location and
  Face ID in English, German, Spanish, French, Irish, Italian and Portuguese.
- Location is foreground-only: generated iOS metadata omits the two `Always` permission
  descriptions and no background-location mode is enabled. The app selects existing
  photos but does not claim unused photo-library write access.
- `ITSAppUsesNonExemptEncryption` configured as false for the standard encryption used
  by the app, avoiding an unnecessary export-compliance prompt.
- Associated-domain declaration for `applinks:app.project-nexus.ie`.
- OTA production channel and an app-version runtime policy.
- A 1024-by-1024 app icon encoded without an alpha channel.
- Stripe's public production key is present in the EAS `production` and `preview`
  environments, and the PaymentSheet integration supplies the registered `nexus`
  scheme separately from its complete return URL for iOS 3-D Secure/bank redirects.
- The mobile-only EAS wrapper builds a platform-aware upload context: iOS archives omit
  the checked-in Android native tree, native build products, device screenshots and local
  secrets while retaining every source/config file the macOS builder needs.
- The deployment target is explicitly iOS 15.1, matching Expo SDK 54's documented
  minimum and exceeding Stripe's iOS 13 minimum. The old `useFrameworks: static`
  override is removed because this app has no iOS dependency that requires it and the
  installed React Native 0.81 / Stripe 0.50.3 combination has a reported static-framework
  header failure. The first cloud build has since succeeded with that override absent.
- `npm run verify:ios-release`, which checks the high-risk release settings without
  weakening the existing shared/Android release gate.
- The production EAS wrapper refuses a dirty `mobile/` tree, prints the full source commit
  and embeds it in the temporary build configuration as `expo.extra.releaseCommit`, so the
  archive can be tied back to the reviewed commit even though the upload context is isolated.

## Known blockers and evidence still required

1. Wait for Apple Developer Program enrollment approval and record the Team ID privately.
2. Set `APPLE_TEAM_ID` to the real 10-character ID and run
   `npm run prepare:ios:aasa`. Deploy the generated extensionless file with the React
   frontend only after the owner gives separate deployment approval, then prove the
   public URL returns JSON without a redirect.
3. Create the App Store Connect app for bundle ID `ie.project.nexus`; replace
   `APPLE_APP_STORE_CONNECT_APP_ID` with its numeric Apple ID.
4. Configure the EAS Apple distribution certificate, provisioning profile and APNs key.
5. Publish the generated `apple-app-site-association` file for
   `app.project-nexus.ie`. The required `appID` is `<Apple Team ID>.ie.project.nexus`.
   On 2026-08-27 `/.well-known/apple-app-site-association` returned 404, so universal
   links are not currently proved.
6. Run `npm run verify:ios-release` and `npm run prepackage`. Windows Expo prebuild was
   attempted on 2026-08-27 and correctly refused to generate an iOS project because
   native iOS generation requires macOS; inspect the EAS-generated project or build
   artifacts for permissions, entitlements and `PrivacyInfo.xcprivacy` instead.
7. Request a signed EAS preview or production build. A successful cloud job proves the
   project compiles; it does not prove runtime behaviour.
8. Install the signed build on a real iPhone and walk authentication, tenant selection,
   navigation, payments, camera/photos, microphone, location, biometrics, deep links,
   push notifications, accessibility, dark mode, offline/error states and account
   deletion. Record defects against the mobile journey ledger.
9. Prepare App Store privacy answers, age rating, support/privacy URLs, review notes,
   reviewer access, descriptions, keywords and screenshots from the genuine iOS build.
10. Upload to TestFlight only with owner approval. Resolve TestFlight processing and
   tester findings before requesting App Review.
11. Obtain separate explicit owner approval before App Review submission and again
    before public release if Apple presents a manual release control.

## Initial App Review policy audit

Checked against Apple's current App Review Guidelines on 2026-08-27:

- The app currently offers first-party email/password authentication, not Google,
  Facebook or another third-party primary login. The requirement to offer an equivalent
  privacy-preserving login option therefore does not currently trigger a Sign in with
  Apple implementation.
- The in-app Stripe marketplace is for second-hand physical goods collected or delivered
  outside the app. Apple guideline 3.1.3(e) permits non-IAP payment methods for physical
  goods and services consumed outside the app. Review notes must describe this plainly.
- Paid identity verification unlocks an in-app badge and remains deliberately unavailable
  in the mobile app. Do not re-enable it without a new Apple and Google billing decision.
- The user-generated-content surface has in-app report, mute and block controls plus
  published contact/safeguarding routes. These controls still need to be walked in the
  exact iOS build and explained to the reviewer.
- Account deletion is reachable within native settings. The public privacy, account
  deletion and contact URLs each returned HTTP 200 on 2026-08-27, but their rendered
  content and actions must be rechecked immediately before submission.
- App privacy answers must include the platform and its integrated processors, including
  Stripe payment processing, Expo/APNs push identifiers, and Sentry diagnostics. Do not
  answer "no data collected" merely because card numbers do not reach Project NEXUS.
- Paid community-local promotional notifications are separately opted in and can be disabled
  in-app. The public platform policy now accurately explains the targeting inputs and that
  advertisers do not receive member attributes, device tokens or recipient lists. Keep the
  conservative Advertising and Developer's Advertising or Marketing answers unless the
  feature is actually removed.
- Native push delivery generically presents every non-promotional notification and replaces
  its data with a generic authenticated notification-centre link, so private messages, GDPR,
  safeguarding, verification, moderation, employment and financial detail — including the
  original destination category — remain behind authentication.

These are source-and-policy findings, not an Apple decision. Recheck the live guidelines
before submission because store rules can change.

The non-negotiable 18+ audience, guardian-consent exclusion, Care in Community exclusion
and cross-store declarations are maintained in
[STORE_AUDIENCE_POLICY.md](STORE_AUDIENCE_POLICY.md). The release check must run
`npm run check:store-audience`; the app is not Made for Kids, and no guardian capability
may be presented as a way for a child to join either native app.

## Store record still to prepare

The App Store Connect record will need at least the app name/subtitle, primary and
secondary categories, description, keywords, support URL, privacy-policy URL, age-rating
answers, app-privacy declarations, copyright, review contact, reviewer notes and working
review credentials. Screenshots are required; Apple currently accepts one to ten per
device class, and the final set must come from the genuine iOS build without transparency.

The first release is intentionally iPhone-only (`supportsTablet: false`), so do not reuse
the Android tablet artwork or claim iPad support. Localize store text only where it can be
maintained accurately; the seven in-app languages do not by themselves certify seven
App Store listings.

App Store Connect does not offer an English (Ireland) metadata locale. The checked English
(UK) metadata draft is
[`store-listing/apple/en-GB.json`](../store-listing/apple/en-GB.json), and
[`store.config.js`](../store.config.js) maps it into Expo's official EAS Metadata schema.
The conservative
privacy worksheet is [`store-listing/apple/app-privacy.md`](../store-listing/apple/app-privacy.md),
the current-questionnaire age-rating worksheet is
[`store-listing/apple/age-rating.md`](../store-listing/apple/age-rating.md),
the real-iPhone capture storyboard is
[`store-listing/apple/screenshots.md`](../store-listing/apple/screenshots.md),
and reviewer instructions without credentials are
[`store-listing/apple/review-notes.md`](../store-listing/apple/review-notes.md). The
live-checked Partner Demo routes and sample records are in
[`store-listing/apple/reviewer-journey-evidence.md`](../store-listing/apple/reviewer-journey-evidence.md).
`verify:ios-release` enforces Apple's current name, subtitle, promotional-text,
description and UTF-8 keyword limits and keeps first release mode manual.

EAS Metadata is beta and its published age-advisory schema still represents Apple's older
questionnaire. The metadata file therefore does not automate age answers. Complete the
current App Store Connect questionnaire manually from the checked worksheet: the app has
social media, user-generated content, direct messaging, a self-declared 18+ membership rule
and gamification challenges/leaderboards, paid promotional push campaigns, no gambling and
no unrestricted embedded web browser. Advertising is Yes because a campaign can be paid,
even though there is no ad SDK or cross-app tracking and the campaign preference is default-off.
Apple's July 2026 definition says Social Media is Yes for a feed that
redistributes or amplifies UGC. Do not answer "social media disabled under 13": Apple
requires at least its Declared Age Range API for that answer, which this app does not call.

## Privacy-manifest evidence

The app config now declares the Project NEXUS-collected data types, linkage, purposes and
no-tracking status in the generated app privacy manifest. It deliberately does not claim
that Stripe-held card details are collected by Project NEXUS. The installed Expo and React
Native modules contain privacy manifests declaring approved
reasons for file timestamps, user defaults, system boot time and disk space. The installed
`expo-build-properties` plugin has manifest aggregation explicitly enabled. Windows cannot
generate an Xcode privacy report, but the successful EAS Simulator build resolved CocoaPods
and the downloaded final `.app` was inspected. It contains 21 privacy manifests. The root
manifest has 18 app-collected data types, no tracking and no tracking domains; Sentry
declares unlinked crash, performance and other diagnostic data; and Stripe declares Product
Interaction and Payment Info where applicable. All inspected SDK entries disable tracking.
Repeat this inspection against the signed release archive before submission.

The wrapper podspecs and official upstream manifests were also checked at their requested
versions: Stripe React Native requests Stripe iOS `~> 24.19.0`, whose `24.19.0` manifests
declare linked Payment Info and Product Interaction without tracking; Sentry React Native
pins Sentry Cocoa `8.56.1`, whose manifest declares unlinked crash, performance and other
diagnostic data without tracking. The inspected build is authoritative for this simulator
compile; repeat the comparison against the signed release because Stripe's compatible-version
range can resolve a later patch release.

## Commands

```bash
cd mobile
npm run verify:ios-release
npm run prepackage
npm run build:ios:simulator
npm run build:ios:preview
npm run build:ios:production
npm run submit:ios:testflight -- --build-id <EAS build UUID>
npm run submit:ios:testflight -- --build-id <EAS build UUID> --confirm-testflight
```

The final command uploads the named build and must be run only after explicit owner
approval. Without `--confirm-testflight`, the wrapper performs read-only validation and
stops. It refuses simulator, preview, internal, unfinished, wrong-bundle and wrong-version
builds, so an earlier simulator build can never be submitted merely because it is “latest”.
The production build commands also create external builds and must not be run merely because
the source checks pass. App Review submission and public release remain separate owner
decisions.

## Push notifications

Android uses Firebase/FCM credentials and a gitignored `google-services.json`. iOS push
uses Apple Push Notification service credentials managed through EAS for this app; a
Firebase `GoogleService-Info.plist` is not required by the current Expo notification
path. Push must be tested on a physical iPhone.

## Release gate meaning

`npm run verify:ios-release` is deliberately narrower than a runtime certification. A
green result means the checked configuration is internally consistent. It cannot prove
that Apple accepted credentials, that the project compiled, that App Store metadata is
accurate, or that any journey works on iOS. Those remain separate evidence gates.
