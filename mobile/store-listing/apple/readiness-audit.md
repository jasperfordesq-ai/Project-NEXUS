# iOS App Store readiness audit

Last reviewed: 2026-08-27

Audit date: 2026-08-27
Product: Timebank Global
Bundle identifier: `ie.project.nexus`
Target: first public iPhone release through Apple App Store

## Decision

The shared Expo / React Native application is materially prepared for Apple, but it is
not yet submission-ready. Source, store-copy and unsigned Apple-toolchain compile evidence
can be completed from Windows with EAS. Enrollment is needed for signing, APNs credentials,
the Apple Team ID, the App Store Connect record and TestFlight. A real iPhone is still
required to certify runtime behaviour; an iOS Simulator build is compile evidence only.

No Mac purchase is required for the current EAS workflow. Apple-hosted build, signing and
submission services replace the local Xcode build step. A Mac would be useful for interactive
Xcode debugging and the Simulator, but is not a release prerequisite for this project.

## Ordered critical path

### 1. Complete before enrollment approval

- Keep the configuration gate red while the Team ID, AASA file and numeric App Store
  Connect Apple ID are absent.
- Confirm the revised paid promotional-push disclosure during the final owner/legal review.
- Finish source checks, backend notification tests and the complete mobile test suite.
- Maintain the conservative App Privacy, age-rating and review-note worksheets.
- Complete the prepared owner/legal answer sheet: DSA trader status, copyright/developer
  name, review contact, availability and territory-specific compliance. The content-rights
  answer is evidence-backed but still needs owner approval.

### 2. Immediately after enrollment approval

- Register or verify the explicit App ID for `ie.project.nexus`.
- Record the 10-character Apple Team ID privately.
- Create the App Store Connect app, select English (UK) as the primary localization and
  put its numeric Apple ID into the local/release configuration.
- Allow EAS to create or reuse the Apple distribution certificate, App Store provisioning
  profile and APNs authentication key. Inspect the credential summary before building.
- Generate the AASA file with `npm run prepare:ios:aasa`; publish it only with separate
  deployment approval, then prove the extensionless HTTPS endpoint returns JSON without
  a redirect.
- Complete App Store Connect agreements, DSA trader self-assessment, export-compliance
  answers and any tax/banking fields Apple requires.

### 3. Signed build and device certification

- Run the fail-closed release gate and request a signed preview build.
- Install on a physical iPhone. Test both a fresh install and an upgrade.
- Walk login, registration, tenant selection, logout, session restore, Face ID, all tabs,
  report/mute/block, account deletion, Stripe physical-goods payment and redirect return,
  camera QR scanning, photo selection, microphone, foreground location, denied permissions,
  dark mode, Dynamic Type, VoiceOver, reduced motion, offline/error states and legal links.
- Test APNs from permission opt-in through token registration, foreground delivery,
  background delivery, terminated-app tap routing, logout token removal, disabled permission,
  promotional opt-in/out and invalid-token receipt cleanup.
- Test Universal Links from an external source, including cold start, authenticated routing,
  logged-out routing and excluded staff/authentication paths.
- Inspect the signed archive's entitlements, `Info.plist`, embedded provisioning profile,
  privacy manifests and SDK privacy report. Confirm the build still uses Apple's required SDK.
- Capture genuine iPhone screenshots only after the signed build passes the walk.

### 4. TestFlight and review

- Create one production EAS build and name its exact build UUID in the guarded submission
  command. Never submit `--latest`.
- Upload to TestFlight only after explicit owner approval. Resolve processing warnings and
  run internal beta testing before any external-test or review submission.
- Complete App Privacy, age rating, content-rights, export-compliance, review contact,
  reviewer credentials, support/privacy URLs, release notes, screenshots and availability.
- Submit to App Review only after a separate explicit approval. Keep first release mode
  manual and require another decision before public release.

## Readiness matrix

| Area | Status | Audit result / evidence | Next gate |
|---|---|---|---|
| Shared application | Ready in source | Android and iOS use the same Expo / React Native screens and API, with platform-specific configuration and permissions. | Signed iPhone walk |
| Bundle identity | Ready in source | `ie.project.nexus`; app version/build number are explicit. | Register App ID and create App Store record |
| Apple build toolchain | Compile-proved | EAS Simulator build `868c99ee-da53-416e-9117-2f1193fe3acf` succeeded with Xcode 26.0 and was inspected. | Signed distribution build |
| Current SDK rule | Compile-proved | The inspected cloud build used Xcode 26 / iOS 26 SDK-era tooling, meeting Apple's requirement current on the audit date. | Reconfirm for final upload |
| Signing/provisioning | Enrollment-blocked | No distribution certificate or App Store provisioning profile can be certified yet. | Enrollment and EAS credential setup |
| APNs credentials | Enrollment-blocked | Expo notification code is present; Apple APNs key is not yet configured. | Enrollment, APNs key, physical-iPhone proof |
| Notification consent | Ready in source | Login no longer triggers the system prompt. Permission is requested only when the member enables device push in Settings. | iPhone permission walk |
| Promotional notifications | Ready in source; disclosure revised | Separate preference defaults off, filters campaign recipients and offers in-app opt-out. The public policy now explains local targeting, no advertiser data disclosure and withdrawal. | Owner/legal confirmation; end-to-end iPhone proof |
| Push delivery lifecycle | Ready in source | Token register/unregister, stored-token logout cleanup, Expo ticket handling and delayed receipt cleanup are implemented. | Queue/production credentials and iPhone proof |
| Notification navigation | Ready in source | Live taps and last-response cold starts normalize `link`, `url` and `cta_url`. | Terminated-app iPhone proof |
| Lock-screen privacy | Ready in source | The native delivery boundary replaces every non-promotional title/body with generic localized copy and replaces its data with one generic authenticated notification-centre link. Full detail and even the original destination stay behind authentication. Separately opted-in paid campaign copy is the explicit exception. | Inspect exact APNs payloads on iPhone |
| Background mechanisms | Intentionally not declared | Visible APNs notifications do not require background fetch or silent remote-notification mode. No background location is declared. | Do not add unless a real feature requires it |
| Universal Links | Enrollment-blocked | Associated-domain entitlement is declared; AASA generator fails closed without real Team ID. Public AASA is absent. | Team ID, deploy approval and public proof |
| Custom URL scheme | Ready in source | `nexus` supports app deep links and Stripe return routing. | Signed Stripe redirect test |
| Payments | Ready in source for physical goods | Stripe PaymentSheet is for second-hand physical goods/services outside the app. Digital identity-badge payment remains unavailable on mobile. No StoreKit entitlement is required for current scope. | Signed payment/review-note proof |
| Sign in with Apple | Not required by current feature set | Native app uses first-party email/password and does not offer third-party social login. | Reassess if Google/Facebook login is added |
| Account deletion | Ready in source | In-app deletion path and public deletion URL exist. | Signed destructive-action walk and rendered URL check |
| User-generated content | Ready in source, device proof open | Report, mute, block and support/safeguarding routes exist. | Exact iPhone walk and reviewer explanation |
| Permissions | Ready in source | Camera is QR-only, photo library is read-only, microphone is user-triggered, location is foreground-only and Face ID unlocks an existing device session. | Grant/deny/revoke iPhone matrix |
| Privacy manifest | Ready in source, archive proof open | Tracking is false; collected-data purposes and SDK manifest aggregation are declared. Inspected Simulator app contained 21 manifests. | Signed archive privacy report |
| App Privacy answers | Drafted conservatively | Worksheet includes Stripe, Expo/APNs, Sentry and developer marketing; it does not claim card data is collected by NEXUS. | Owner/legal confirmation and ASC entry |
| Required-reason APIs | Compile-inspected | Aggregated Expo, React Native, Stripe and Sentry manifests use declared reasons in the inspected app. | Reinspect exact signed archive |
| ATT/tracking | Not required by current design | No cross-app tracking or advertising identifier use is declared. | Reassess if SDKs or tracking change |
| Encryption/export | Ready in source | `usesNonExemptEncryption` is false for standard exempt encryption. | Confirm answer in App Store Connect |
| Age rating | Drafted | Worksheet records social/UGC/messaging, 18+ membership, gamification and paid promotional campaigns. | Complete Apple's live questionnaire |
| Store metadata | Drafted and machine-checked | English (UK) copy and EAS metadata mapping exist; release is manual. | Legal fields, ASC ID, screenshots and live entry |
| Screenshots | Current draft ready from genuine iOS Simulator | Run `33281688048` produced four visually accepted native-resolution iPhone Simulator captures from commit `fc496aedd`; preparation, checksum, opacity, dimensions and page-content OCR gates passed, followed by independent visual inspection. Android or mock images are never represented as iPhone screenshots. | Compare with signed TestFlight candidate |
| Accessibility | Source coverage only | Automated checks do not certify VoiceOver, Dynamic Type or iOS contrast/gestures. | Physical-device accessibility walk |
| Localization | Source-ready | Seven native permission-localization files are configured. Store localizations should be added only when maintainable. | Signed permission-dialog check |
| OTA updates | Configured with control required | Production uses app-version runtime compatibility. Updates must remain JavaScript/assets-only and must not materially change reviewed native functionality. | Document release approval procedure |
| Crash diagnostics | Configured | Sentry data is disclosed without tracking. | Verify production DSN, symbol upload and consent/policy alignment |
| Security dependencies | Residual risk accepted for now | `npm audit --omit=dev` reports 10 high, 0 critical advisories in Expo/Metro/React Native build tooling; the automated fix requires an unsafe major Expo/RN jump. | Monitor patched Expo line; do not major-upgrade during submission prep |
| App Store Connect compliance | Answer sheet prepared; owner sign-off blocked | Third-party content is identified and supported by the platform licence; DSA trader status, territories, public contact and seller/copyright fields cannot be inferred safely. | Complete `owner-legal-answers.md` |

## Push-notification mechanism audit

The iOS path is Expo Push Service to APNs. It does not require a Firebase
`GoogleService-Info.plist`. The backend sends Expo tokens, records provider outcomes and
queries Expo receipts after the ticket delay. A `DeviceNotRegistered` receipt removes the
dead token so repeated sends do not accumulate invalid endpoints.

Member control has two independent layers:

1. Device notifications are enabled by an explicit Settings action. Session restoration
   may refresh a previously granted token but cannot present Apple's system prompt.
2. Paid promotional campaigns require `push_campaigns_opted_in` to be exactly true.
   Missing, false and malformed preferences fail closed. Members can turn it off in-app.

The app listens for foreground arrivals to refresh unread state and response/tap events to
navigate. It reads and clears the last notification response on startup, covering a tap that
launches a terminated app. Deep-link payloads support all three keys emitted by producers.

There is deliberately no silent-push/background-fetch claim. Apple does not require the
`remote-notification` background mode for ordinary visible notifications or tap handling.
Adding it without a real background task would widen review and energy-use risk.

## Verification recorded on 27 August 2026

- Mobile TypeScript and ESLint passed.
- The complete post-freeze mobile Jest suite passed: **337 suites, 2,433 tests**.
- Expo Doctor passed **18/18** checks.
- The combined notification, promotional-consent, group-message and Expo-receipt backend
  regression passed **62 tests, 138 assertions**. After the native payload was tightened to
  the single generic destination, its focused suite passed again: **12 tests, 29 assertions**.
- The React privacy-policy file passed ESLint and the React TypeScript project check; public
  prerender tests passed **2/2**.
- Documentation hygiene, version consistency and `git diff --check` passed.
- `npm run verify:ios-release` fails only for the two intentional enrollment-dependent
  inputs: the real AASA/Team ID and the numeric App Store Connect Apple ID.
- The Partner Demo credentials in the protected secrets file completed a live production
  mobile login, and that temporary verification session was logged out.

This is source and service evidence. It is not a substitute for the signed-build,
TestFlight or real-iPhone evidence listed above.

## Policy decisions that cannot be automated

### Paid promotional push resolution

The platform retains separately opted-in, community-local promotional notifications. The
public policy now explains that the Platform processes the member's promotional preference
and, where requested, stored location, interests or trust tier on the Community Operator's
behalf; advertisers do not receive those attributes, the device token or the member list.
Members can withdraw the separate choice without losing ordinary notifications or app use.

The conservative App Store drafts continue to answer Advertising = Yes and declare
Developer's Advertising or Marketing purposes. This resolves the factual contradiction in
source and disclosure; the owner or legal reviewer must still approve the final legal wording
before App Store submission.

### DSA trader status

Apple requires developers distributing in the EU to self-identify as a trader or non-trader.
Charitable status does not by itself answer whether distribution is connected to a trade,
business, craft or profession. The owner must make and evidence that assessment. A trader
must complete Apple's contact verification, and verified details can appear on the EU product
page.

### Content rights and territories

Because members upload posts, photos, messages and listings, the App Store content-rights
answer must acknowledge third-party content and be supported by the terms and moderation
process. Territory availability also needs an owner decision; enabling every territory can
trigger additional local compliance declarations.

## Official source baseline

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- [Registering with APNs](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)
- [Supported iOS capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/)
- [Associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- [Universal Links](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)
- [App Store required properties](https://developer.apple.com/help/app-store-connect/reference/app-information/required-localizable-and-editable-properties)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)
- [Export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)
- [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)
- [Submit for review](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)
- [EU DSA trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)
- [Current Apple SDK requirements](https://developer.apple.com/app-store/submitting/)
- [Expo iOS builds](https://docs.expo.dev/build-reference/ios-builds/)
- [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo push receipts](https://docs.expo.dev/push-notifications/sending-notifications/)
- [EAS iOS submission](https://docs.expo.dev/submit/ios/)

Recheck the live sources before final upload because Apple requirements, questionnaires and
required SDK versions change.
