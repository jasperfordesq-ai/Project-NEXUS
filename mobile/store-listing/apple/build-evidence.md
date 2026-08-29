# iOS build evidence

Last reviewed: 2026-08-29

This record captures the checked macOS cloud compile and current Simulator runtime evidence
for the Expo iOS configuration. It does not certify a
signed device build, TestFlight, App Review or any runtime journey on an iPhone.

## EAS build

| Field | Evidence |
| --- | --- |
| Result | Finished successfully |
| EAS build ID | `868c99ee-da53-416e-9117-2f1193fe3acf` |
| Build page | <https://expo.dev/accounts/timebank-global/projects/nexus-mobile/builds/868c99ee-da53-416e-9117-2f1193fe3acf> |
| Platform/profile | iOS / `ios-simulator` |
| Signing | Unsigned iOS Simulator build; no Apple credentials used |
| Expo SDK | 54 |
| App/runtime version | `1.2.0` |
| iOS build number | `2` |
| Bundle identifier | `ie.project.nexus` |
| Source fingerprint | `c63629f79a0ae86fc15065bb3469554e7d591314` |
| Cloud upload size | 7.6 MB |

The downloaded `TimebankGlobal.app` archive was 51,653,257 bytes (49.26 MB), with
SHA-256 `1b59165021b0b65c879fb9e23368bd2e89dcd52c9b609e64ef3f9a8b0aa229a6`.
It is held only in a local temporary directory and is not a distributable App Store
artifact.

## Simulator runtime evidence

GitHub Actions run [33281688048](https://github.com/jasperfordesq-ai/Project-NEXUS/actions/runs/33281688048)
restored the exact-source unsigned Release app for commit
`fc496aedddd6793835f49d80a6c7abc4ffbf7771`, installed it on an iPhone 16 Pro Max
Simulator running iOS 26.2, authenticated to the protected Partner Demo tenant and completed
the four-screen public tour. The workflow's preparation and Apple Vision OCR gates passed.
The downloaded artifact was then independently inspected: all four files are opaque native
1320 x 2868 PNGs showing the intended Feed, Listings, Messages and Events pages with no
system sheet, credential, keyboard or debug overlay.

| Screenshot | SHA-256 |
| --- | --- |
| `01-feed.png` | `5abe170fd5b63aca08f9d934bb1178b5f6509289dd25c0f8860473892d26fd27` |
| `02-listings.png` | `93389c0fcd7f0d89e4062de3aa07b376828c3092d745f4a47a56d24aa11bb770` |
| `04-messages.png` | `7ed293436302dcee66c85cd0fbdba33f44b545cb7338b2718f308d34cc8709c1` |
| `05-events.png` | `8533a97ab120c72251a33cb86ec8e8a320f1b7bcfcc21064665975fc40f815df` |

## Final app inspection

Inspection of the generated `.app`, rather than source configuration alone, established:

- installed name `Timebank Global`, version `1.2.0`, build `2`, and bundle
  `ie.project.nexus`;
- iPhone Simulator platform with a minimum iOS version of 15.1;
- URL schemes `nexus` and `ie.project.nexus`;
- `ITSAppUsesNonExemptEncryption` is false;
- usage descriptions for camera, Face ID, foreground location, microphone and reading
  existing photos only;
- no `Always` location usage description and no photo-library add/write description;
- localized native resources for `de`, `en`, `es`, `fr`, `ga`, `it` and `pt`, with all
  five required usage descriptions in every locale;
- no embedded provisioning profile, as expected for an unsigned simulator build; and
- 21 bundled privacy manifests, including the app, Sentry and Stripe SDK manifests.

The root app manifest declares 18 Project NEXUS data types, no tracking and no tracking
domains. Its required-reason API entries cover file timestamps, user defaults, system
boot time and disk space. The resolved Sentry manifest declares unlinked crash,
performance and other diagnostic data for App Functionality, without tracking. The
resolved Stripe manifests declare Product Interaction and Payment Info where applicable,
for Analytics and/or App Functionality, without tracking. These findings align with the
conservative App Privacy worksheet.

## What remains unproved

- Apple Developer Program approval, Team ID, signing certificate, provisioning profile
  and APNs credentials;
- a signed physical-device archive and installation on a real iPhone;
- universal links, because the Team-ID-specific AASA file is not yet publishable;
- push delivery, camera/photos, microphone, location, Face ID and payment redirects on
  actual Apple hardware;
- accessibility, dark mode, offline/error handling and all member journeys on iOS;
- App Store Connect record, TestFlight processing, owner-approved final screenshot upload,
  reviewer access, App Review acceptance and public release.
