# iOS build evidence

Last reviewed: 2026-08-29

This record captures the first successful macOS cloud compile of the checked Expo iOS
configuration. It is compile and artifact-inspection evidence only; it does not certify a
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

GitHub Actions run [33246391310](https://github.com/jasperfordesq-ai/Project-NEXUS/actions/runs/33246391310)
compiled source commit `ad2029ba7fc1473cc8c7816a3c9344650a851597` as an unsigned
iOS Release build, installed it on an iPhone 16 Pro Max Simulator running iOS 26.2, and
completed the protected Partner Demo login and eight-screen Maestro tour. Its artifact
contains eight opaque 1320 x 2868 PNGs plus a manifest whose source SHA and SHA-256 image
checksums were independently verified after download. Four clean primary-tab images are
selected as the draft App Store set; four modal captures are quarantined for the visual
reasons recorded in [`screenshots.md`](screenshots.md).

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
