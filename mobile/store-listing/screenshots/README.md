# Play Store screenshots

Last reviewed: 2026-08-26

Captured 2026-08-25 at 1080×2400 from a locally built release APK, running on an emulator
against the **live Partner Demo community**, not mockups. The original captures were too tall
for Google's 2:1 maximum screenshot ratio and retained an alpha channel. On 2026-08-26 they
were prepared as opaque 24-bit 1080×1920 PNGs: the complete screen is proportionally reduced
to 864×1920 and centred on narrow, colour-matched side gutters. Nothing is cropped, stretched,
invented or hidden.

Two complete sets. **Light usually reads better as a small thumbnail in the store grid**;
dark is the more striking image if the listing is being viewed full size. Pick one and stay
with it — a listing that mixes themes looks like two different apps.

The `tablet-7/` and `tablet-10/` folders contain a separate curated set captured from genuine
Nexus 7 and Pixel Tablet Android emulators on 2026-08-26. They show Listings, Wallet and
Volunteering—the three strongest screens that contain no internal QA fixture wording. The
complete native tablet frame is retained: 7-inch captures are proportionally contained in
1080×1920, while the naturally landscape Pixel Tablet captures are contained in
2560×1440. Nothing is cropped or stretched.

| | |
| --- | --- |
| `01-feed` | the community feed |
| `02-listings` | browsing offers and requests |
| `03-listing-detail` | one listing, with the time cost and the request button |
| `04-wallet` | the time-credit balance, giving and spending |
| `05-messages` | conversations |
| `06-events` | what's on |
| `07-members` | the member directory |
| `08-groups` | groups |

## Why these are safe to publish

Every person shown is fictional. Partner Demo contains no real members — the directory has
43 seeded fictional members in addition to the dedicated reviewer account, and their
photographs were generated (owner-confirmed as cleared for commercial use on 2026-08-25).
The community logo is Timebank Ireland's, used with the directors' agreement.

The privacy risk that had to be ruled out first was **cross-community content**: this
platform can share listings between communities, which could have put a real member's post
into a screenshot. It cannot happen here — sharing needs an active partnership *and* the
listing's owner to opt that listing in, and the member directory is scoped to one community
with no federation path at all. Checked on the day: zero federated listings, zero
unresolvable members.

## Reproducing them

The status bar is Android's demo mode — a pinned 9:30 clock, full battery, no notification
icons. Without it you get a real clock and whatever notifications the emulator has
collected, which is the difference between a screenshot that looks made and one that looks
leaked:

```bash
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0930
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
```

Build the app pointed at production first — `TENANT=partner-demo bash scripts/build-apk-local.sh` —
because a development build carries a debug strip across the bottom of every screen.

After recapturing, prepare and validate the complete Play asset set:

```bash
npm run store:screenshots:prepare
npm run store:tablets:prepare -- --device 7-inch --source <maestro-takeScreenshot-dir>
npm run store:tablets:prepare -- --device 10-inch --source <maestro-takeScreenshot-dir>
npm run store:assets:check
```

The preparation commands perform only the documented proportional conversion. The validator
rejects wrong dimensions, anything other than the listing editor's exact 9:16 or 16:9 ratio,
alpha-channel screenshots, and incorrect Play icon or feature-graphic formats.

🔴 **One known imperfection.** Dates render US-style (8/17/2026) because the emulator would
not accept a region change, and the app correctly follows the device. On an Irish or UK
phone the same screens show 17/8/2026. If that matters for the listing, recapture on a real
phone; it is the emulator, not the app.
