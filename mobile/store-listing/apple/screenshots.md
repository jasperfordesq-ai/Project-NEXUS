# Apple screenshot capture plan

Last reviewed: 2026-08-27

The first release is iPhone-only. Capture these images from the signed iOS build installed
through TestFlight on a real iPhone. Android screenshots, browser mock-ups and resized
artwork are not runtime evidence and must not be presented as though they came from iOS.

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
