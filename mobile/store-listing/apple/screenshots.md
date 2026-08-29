# Apple screenshot capture plan

Last reviewed: 2026-08-29

The first release is iPhone-only. The manually dispatched
[`iOS Simulator Screenshots`](../../../.github/workflows/ios-simulator-screenshots.yml)
workflow first compiles the exact Git commit in unsigned iOS Release mode on a standard
GitHub-hosted Mac, boots an iPhone 16 Pro Max Simulator and captures the eight-screen set.
It uploads native-resolution, opaque PNGs and a checksum manifest as a private workflow
artifact; generated screenshots are not committed automatically.

That set is genuine iOS Simulator runtime evidence and is suitable for layout review and
draft App Store artwork. It is not a signed-build or physical-device result. Once Apple
enrollment is active, repeat the critical journeys from the signed build installed through
TestFlight on a real iPhone and replace any draft screenshot whose signed runtime differs.
Android screenshots and browser mock-ups must never be presented as though they came from
iOS.

## Accepted source set

Prepare one English (UK) portrait set of eight screenshots for the 6.9-inch display class.
Apple currently accepts these portrait pixel sizes for that class:

- 1260 x 2736
- 1290 x 2796
- 1320 x 2868

Use the exact native size produced by the chosen supported iPhone; do not stretch or crop
one device capture into another accepted size. App Store Connect accepts one to ten images
per device class in PNG or JPEG, and screenshots cannot contain transparency or an alpha
channel. A valid 6.9-inch set is the primary first-release requirement; App Store Connect
can scale it for smaller iPhone classes where Apple permits.

Authoritative specification:
<https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/>

## Eight-screen story

| Order | Genuine iOS screen | What the image must prove |
|---|---|---|
| 1 | Community feed | Real member activity, clear navigation and the core community proposition. |
| 2 | Offers and requests | Skills and help can be discovered without money being the primary exchange. |
| 3 | Member directory or profile | Trusted local people, verification wording and community identity. Do not expose real personal data. |
| 4 | Messages | Private coordination exists; use fictional names and content. |
| 5 | Events | Community events, accessible date information and a meaningful participation action. |
| 6 | Time-credit wallet | Hours earned and spent; no currency symbol or suggestion that credits are cash. |
| 7 | Volunteering | Organisation opportunities and shifts alongside member-to-member exchange. |
| 8 | Settings/privacy or a dark-mode core screen | Account control, accessibility and polished native appearance. |

Capture the feed overflow and member-profile Safety section separately as review evidence,
even if they are not selected for the public eight. Those images prove Report, Mute and
Block reachability for Guideline 1.2.

## Capture conditions

- Use only the Partner Demo review account and fictional seeded records.
- Remove real names, addresses, messages, email addresses, phone numbers, avatars, precise
  locations, notification previews and payment details before capture.
- Use a clean status bar with a plausible time, full signal and battery; do not edit app
  content after capture in a way that misrepresents the experience.
- Close permission prompts, keyboards, toasts, debug menus, TestFlight feedback overlays and
  loading/error states unless the image deliberately documents one for internal evidence.
- Keep the same light/dark scheme, locale, text size and tenant branding across the public
  set unless a deliberate accessibility image explains the change.
- Do not include Android navigation bars, Google Play branding, Apple device frames copied
  from unlicensed templates, or claims that are not visible in the build.
- Preserve the untouched originals. If captions are later added, create separate derived
  files and keep all text within safe margins.

## Evidence record

For each final image record the TestFlight build number, iPhone model, iOS version, capture
time, route, demo fixture and SHA-256 checksum. Verify pixel dimensions, RGB/RGBA handling
and absence of transparency before upload. Store screenshots only after checking that they
contain no secrets or real-member personal data.

The Simulator workflow creates the first version of this record automatically. Its manifest
labels the unsigned evidence boundary explicitly so it cannot be mistaken for TestFlight.

## 2026-08-29 Simulator capture

Workflow run [33246391310](https://github.com/jasperfordesq-ai/Project-NEXUS/actions/runs/33246391310)
completed against source commit `ad2029ba7fc1473cc8c7816a3c9344650a851597`. The
unsigned Release build ran on an iPhone 16 Pro Max Simulator with iOS 26.2 and produced
eight opaque 1320 x 2868 PNGs. The downloaded files matched every SHA-256 value in the
artifact manifest.

Visual inspection, not workflow success alone, determines the public selection:

- `01-feed.png`, `02-listings.png`, `04-messages.png` and `05-events.png` form the
  accepted four-image draft set. Apple permits one to ten screenshots, so four is a valid
  submission count.
- `03-members.png`, `06-wallet.png`, `07-volunteering.png` and `08-settings.png` are
  quarantined from the public set. Their modal presentation leaves a large black top
  backdrop; Volunteering also clips the third tab label and wraps “Opportunities” badly
  inside its narrow statistic card.
- The quarantined images are byte-identical to run 33216232144 where comparable, proving
  these are pre-existing modal/capture-layout issues and not regressions from the bundle
  optimisation in `ad2029ba7`.

This is a genuine iOS Simulator draft set, not signed TestFlight or physical-device
evidence. Recheck the selected images against the signed candidate before upload and
replace any whose signed runtime differs.

## When the owner does not have an iPhone

Do not make the public release the first device test. Use this release ladder:

1. Run and visually inspect the eight Simulator captures and diagnostic evidence.
2. After enrollment, build and submit the signed candidate to TestFlight from Windows with
   EAS. Simulator success does not replace this signing gate.
3. Invite at least one trusted external TestFlight volunteer who owns a supported iPhone.
   They need only the TestFlight invitation and an Apple Account; they do not need repository,
   Expo or App Store Connect administration access. Give them the critical-journey checklist
   and require model, iOS version, screenshots and pass/fail notes.
4. Keep App Store release manual until that evidence is reviewed. If no trusted tester can be
   found, record the missing physical-device evidence as an explicit release risk rather than
   describing the app as device-certified.

Paid device farms or a rented Mac remain optional fallbacks, not prerequisites for this
pipeline.
