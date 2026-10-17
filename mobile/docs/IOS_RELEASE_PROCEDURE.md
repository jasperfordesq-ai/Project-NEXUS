<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Releasing to the Apple App Store — the procedure, and everything that bites

Last reviewed: 2026-10-17

Status: **Maintained — written from the first iPhone release, 1.10.0 (build 8), set up and
submitted to App Review on 16–17 October 2026.** The Google Play equivalent is
[`PLAY_RELEASE_PROCEDURE.md`](PLAY_RELEASE_PROCEDURE.md). Store copy, privacy answers, age
rating and review notes live in [`../store-listing/apple/`](../store-listing/apple/).

## Where things stand

| Item | Value |
| --- | --- |
| Apple Developer Program | Organisation enrolment, HOUR TIMEBANK COMPANY LIMITED BY GUARANTEE, Team ID `UUQ2A2KD52`, renews 17 Oct 2027 (fee waived) |
| App Store Connect app | "Timebank Global", Apple ID `6823712395`, bundle `ie.project.nexus`, SKU `ie.project.nexus`, primary language English (U.K.) |
| Seller name shown on the App Store | **hOUR Timebank** (owner's choice; Apple says it cannot be changed later) |
| First submission | 1.10.0 build 8, EAS build `96307fd4-9356-4475-afac-7602a440aadf`, source commit `fcd2f46ab`; submitted to App Review 17 Oct 2026, **manual release** |
| Price / availability | Free, all 175 countries |
| Age rating | 18+ developer override (Apple calculated 13+; Brazil and Korea show 19+) |
| EU Digital Services Act | Declared **not a trader** (owner decision, 16 Oct 2026) |
| Over-the-air updates | Build 8 was built with updates OFF and can never take one. Updates are ON again from the next build (owner decision 17 Oct 2026, security finding F-201 risk accepted) |

## Credentials — where they are, and what needs no Apple password

All of these are outside git. Nothing here needs the owner's Apple ID password, which no
agent should ever type.

| Credential | Where | Used for |
| --- | --- | --- |
| App Store Connect API key "EAS build and submit" (Admin role) | `.secrets.local/apple/` (`.p8` plus `apple.env` with key ID and issuer ID). Apple never re-issues the `.p8` | EAS creating certificates and profiles, `eas submit`, `eas metadata:push`. `eas.json` → `submit.production.ios` names the key path |
| Distribution certificate and App Store provisioning profile | Managed by EAS (expo.dev → project → Credentials → `ie.project.nexus`). Both expire 16 Oct 2027 | Signing every production build |
| Apple push key "Timebank Global push" (Sandbox & Production, team scoped) | `.p8` in `.secrets.local/apple/`; uploaded to EAS through expo.dev | Expo's push service delivering to iPhones |
| Reviewer account | `.secrets.local/demo-login.env` and GitHub secrets `IOS_SCREENSHOT_TEST_EMAIL` / `_PASSWORD` | App Review sign-in and the screenshot workflow |

🔴 **The reviewer account is the ordinary Partner Demo member Maya Rivers, not the
Partner Demo admin.** The admin account has an authenticator app enrolled, which neither
App Review nor the screenshot job can answer. Do not enrol two-factor sign-in on the
reviewer account. Its password is typed into App Store Connect by the owner.

## The release, in order

1. **Bump the version** in all four places (`mobile/package.json`, `mobile/app.json`,
   `config/mobile.php`, and the Android version code) — see the Play procedure. The iOS
   build number is EAS's remote counter and increments by itself; failed attempts burn
   numbers, which is harmless.
2. **Run the gates**: `npm run verify:release` and `npm run verify:ios-release` from
   `mobile/`. Both must pass.
3. **Build on EAS** with the API key in the environment (values from `apple.env`):
   `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `EXPO_APPLE_TEAM_ID`,
   `EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION`, then
   `node scripts/eas-build.js --platform ios --profile production --no-wait`. About ten
   minutes on the Free plan's queue. iPhone builds cannot be made on this Windows machine.
4. **Submit to TestFlight**:
   `node scripts/eas-submit-ios.js --build-id <uuid> --confirm-testflight`. Apple processes
   it in roughly ten minutes; the build then shows "Ready to Submit" in TestFlight.
5. **Try it on a real iPhone** through TestFlight (owner is in the "Team (Expo)" internal
   group). Check sign-in, notifications and one exchange before going further.
6. **Push the listing text**: `npx eas-cli metadata:push --profile production` (reads
   `store.config.js` and `store-listing/apple/en-GB.json`). It does not set the age
   rating, review details or screenshots.
7. **Screenshots** (only when the screens changed): run the "iOS Simulator Screenshots"
   workflow, then upload at the **medium** size — see below.
8. **App Store Connect → the version page**: attach the build, check the review notes,
   then **Add for Review → Submit for Review**. Review took "up to 48 hours" per Apple.
9. **After approval**, the version waits for a manual **Release**. Then record the build
   in `live-store-build.json` (add an `ios` entry — it currently records Android only, and
   the over-the-air publish script must check both platforms).

## Traps that cost real time

- **`eas` is not on the Git Bash PATH.** Use `npx eas-cli`.
- **`--non-interactive` refuses to create first-time credentials** ("run this command
  again in interactive mode"), even with the API key set. An agent can drive the
  interactive prompts only through a real console:
  `winpty -Xallow-non-tty -Xplain npx.cmd eas-cli@latest …` under Desktop Commander's
  `start_process`, answering with `interact_with_process`. Select lists take `j`/`k`;
  arrow keys do not arrive. A text prompt that has a pre-filled value (the Apple Team ID
  prompt) never accepts input this way — use expo.dev for that step instead.
- **EAS can only generate a push key with an Apple ID password.** Answer "no", create the
  key at developer.apple.com → Keys, and upload it at expo.dev → Credentials → Push key.
- **`eas submit` needs `ascApiKeyPath`, `ascApiKeyIssuerId` and `ascApiKeyId` in
  `eas.json`'s submit profile.** Environment variables alone fail with "App Store Connect
  API Keys cannot be set up in --non-interactive mode".
- **App Store Connect forms ignore programmatic input.** Click the field and type. Native
  drop-downs accept an option *value* (`en-GB`, `EIGHTEEN_PLUS`, `ie.project.nexus`).
- **The App Privacy questionnaire is 21 small dialogs.** Each is purposes → linked to
  identity? → two information pages → used for tracking? → Save. Read the summary back
  after saving: one data type once saved with the wrong purpose ticked.
- **Apple signs you out overnight.** A morning session starts at the sign-in page; only
  the owner can sign in.
- **A stray `app.json` containing `{"expo":{}}` appears at the repository root** after EAS
  runs from a temporary context. Delete it.

## Screenshots

The "iOS Simulator Screenshots" workflow builds the app on a GitHub Mac, signs in to
Partner Demo as the reviewer account, and captures Feed, Listings, Messages and Events at
1320 × 2868. Four fixes were needed on 16 October 2026; all are commented in the workflow
and in `.maestro/screens/apple-store-screens.yaml`:

1. **Xcode 26.2 must be selected** — Expo SDK 55 no longer compiles with `macos-15`'s
   default Xcode.
2. **The app must be ad-hoc signed by Xcode** (`CODE_SIGN_IDENTITY=-`). Unsigned, it has
   no Keychain entitlement, cannot save the sign-in it was just given, and shows "Unable
   to sign in" although the server answered 200. Signing the finished app with `codesign`
   afterwards was refused at launch.
3. **A signed app triggers iOS's "Save Password?" sheet** a few seconds after sign-in.
   Maestro cannot see it; the tour waits and taps "Not Now" by position.
4. **The Keychain survives an uninstall**, so each retry resets it.

A fresh compile is about 40 minutes (the job limit is now two hours); a re-run reuses the
cached app and takes about ten.

🔴 **App Store Connect now requires the medium iPhone size (1206 × 2622) and treats the
6.9-inch size as optional.** Scale the 1320 × 2868 captures down (the aspect ratio differs
by 0.07%) and upload through **Media Manager** on the version page. Apple reuses the
medium set for every iPhone size.

On 17 October 2026 only Feed, Listings and Messages were used. The Events screenshot was
left out because Partner Demo had no upcoming events. The Partner Demo header shows the
Timebank Ireland logo — that is the community's own setting, and it appears on the store
page.

## Notifications on iPhone

- Build 8 carries `aps-environment: production`, the right value for TestFlight and the
  App Store. The push key lives at Expo, not in the app, so it was uploaded after build 8
  without a rebuild.
- An iPhone receives nothing until it registers. In build 8 the app asked iOS only when
  the member tapped "Turn on notifications" (Home card or Settings). From the next build
  it asks straight after sign-in, as Android already does (`44a990f16`).
- Check registration on production in `fcm_device_tokens` (`platform = 'ios'`).

## What has not been verified

- No end-to-end notification test on an iPhone yet — the owner's iPhone registered on
  17 Oct 2026, but no test message has been sent.
- Certificate pinning on a signed iPhone build (security finding F-200) is not yet proven.
- Universal links: the association file with the real Team ID is generated, but whether
  an `app.project-nexus.ie` link opens the app depends on the React frontend being
  deployed and is untested on a device.
