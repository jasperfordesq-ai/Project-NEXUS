# Play Store screenshots

Captured 2026-08-25 at 1080×2400 — the real release build, running on an emulator against
the **live Partner Demo community**, not mockups. Google accepts 320–3840 px on a side, so
these sit comfortably inside the range and need no processing before upload.

Two complete sets. **Light usually reads better as a small thumbnail in the store grid**;
dark is the more striking image if the listing is being viewed full size. Pick one and stay
with it — a listing that mixes themes looks like two different apps.

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

Every person shown is fictional. Partner Demo contains no real members — its 43 accounts are
seeded, and their photographs were generated (owner-confirmed as cleared for commercial use
on 2026-08-25). The community logo is Timebank Ireland's, used with the directors'
agreement.

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

🔴 **One known imperfection.** Dates render US-style (8/17/2026) because the emulator would
not accept a region change, and the app correctly follows the device. On an Irish or UK
phone the same screens show 17/8/2026. If that matters for the listing, recapture on a real
phone; it is the emulator, not the app.
