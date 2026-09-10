<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Releasing to Google Play — the procedure, and everything that bites

Last reviewed: 2026-09-09

Status: **Maintained — written from an end-to-end release of version code 8 on
2026-09-09, every timing and fingerprint in it measured rather than assumed.**

[`PLAY_SUBMISSION.md`](PLAY_SUBMISSION.md) owns signing keys, store listing copy,
Data Safety, reviewer access and asset evidence. This document owns the **act of
shipping a build**: what to run, in what order, and the traps that produce a file
which looks perfect and is broken.

---

## The order of operations

🔴 **Internal testing first, then promote. Not production first.**

1. Build the signed bundle locally.
2. Publish it to **internal testing** — instant, no review.
3. Install on a real phone and walk the changes.
4. **Promote** internal → production.

On 2026-09-09 this was done backwards — straight to production, with internal
testing added afterwards — because the agent doing it had no record of the
established process and did not ask. It worked, but it inverted the safety net:
the build reached the public queue before anyone had run it on a handset.

---

## 1. Choose the version code

🔴 **Play's live version code is the only source of truth. Not `app.json`, and
emphatically not EAS's remote counter.**

Check it at **Play Console → Production → Track summary → Latest release**.

Measured on 2026-09-09: Play was live on **7**, while `eas build:version:get`
reported the remote counter as **4**. The `production` EAS profile has
`autoIncrement: true` with `appVersionSource: "remote"`, so an EAS build that day
would have produced version code **5** and Play would have rejected it outright.
The counter is stale because releases are built locally, which never touches it.

- The version **code** must always increase. Play refuses a repeat.
- The version **name** may repeat. 7 and 8 were both `1.4.0`, which Play accepts —
  but users see the same number for two different builds, so bump it when the
  changes are user-visible.
- `eas build:version:set` cannot be scripted: it prompts, and refuses piped stdin.
  Changing the counter means the interactive command, or moving
  `appVersionSource` to `local`.

## 2. Build

```bash
bash mobile/scripts/build-aab-play.sh --version-code 8
```

Output: `mobile/android/app/build/outputs/bundle/release/app-release.aab`
(~90 MB; the build itself took **1m 45s** on the dev machine, no EAS quota spent).

That script exists because four separate failures here are silent, and each
produces a normal-looking `app-release.aab`. It refuses rather than warns:

| Trap | What happens without the guard |
| --- | --- |
| **Debug signing** | `android/app/build.gradle` falls back to `signingConfigs.debug` when the signing values are absent. No error. Play rejects the upload, and if it did not, the signature could never update the installed app. |
| **Wrong API host** | Expo bakes `EXPO_PUBLIC_API_URL` into the bundle permanently. On 2026-09-09 `.env.production.local` still held `http://10.0.2.2:8090` — the emulator's alias for the build machine — left behind by `build-apk-local.sh` during testing. That build works flawlessly on an emulator and is dead in every real user's hand. |
| **One CPU architecture** | `expo run:android` writes `reactNativeArchitectures=<one abi>` into `android/gradle.properties`; a later release build inherits it. On 2026-08-20 that shipped an x86_64-only artefact: perfect on the emulator, "App not installed" on a real phone. |
| **A build no update can reach** | Found 2026-09-10 by opening the version code 8 bundle: it had **no update channel** (EAS writes one into cloud builds; a local build gets it only from `app.json`'s `updates.requestHeaders`, which nothing set) and a **runtime version of 1.2.0** inside a 1.4.0 app (the script only ran `expo prebuild` when `android/` was missing, so an August value survived). Either alone means the update service serves that build nothing, ever. The script now regenerates the native project on every build and reads both values back out of the finished bundle. Version code 9 is the first build that can receive an over-the-air update. |

The script also verifies the finished bundle's certificate against the upload key
before reporting success.

### Where the signing material lives

🔴 **`mobile/credentials.json`** — EAS's local credentials file. It holds
`keystorePath`, `keystorePassword`, `keyAlias` and `keyPassword`; the keystore
itself is `mobile/credentials/android/keystore.jks`. It is **not** in
`gradle.properties`, **not** in `~/.gradle/`, and **not** in `.secrets.local/`.
Anyone concluding the passwords are missing has looked in the wrong place.

### The two certificates, which are not interchangeable

| Key | SHA-256 | What it is for |
| --- | --- | --- |
| **Upload key** | `F5:0D:87:55:…` | Signs what we send to Google. The local keystore. |
| **App signing key** | `79:38:E8:06:…` | Google re-signs with this. What a phone actually verifies. |

🔴 `react-frontend/public/.well-known/assetlinks.json` must publish the **app
signing key**. It carried only the upload key until 2026-09-09, which is why
Android App Links never verified for anyone who installed from Play — every
`https://app.project-nexus.ie/…` link opened a browser instead of the app, while
`app.json`'s `autoVerify: true` made the other half look correct. Play Console
generates the correct snippet for you at **App integrity → App signing**.

## 3. Publish to internal testing

**Test and release → Testing → Internal testing → Create new release.**

If the bundle is already uploaded (e.g. it was uploaded to another track), use
**Add from library** — no second upload of 90 MB.

The final button on this track is **"Save and publish"**, and it means it: there
is no review. The Console says changes "usually appear on Google Play within
1 hour". Measured 2026-09-09: published at 7:47 PM, available to the 11-member
internal tester list.

🔴 **Uploading is where a release most easily goes wrong in practice.** The file
is ~90 MB and takes a minute or two. **Do not navigate, reload or interact with
the page while it transfers** — the upload aborts silently and the release page
simply shows no new version, with no error. This happened on 2026-09-09 and cost
a full re-upload. Verify success by reading the page afterwards, not by reloading it.

## 4. Promote to production

**Internal testing → Promote release → Production**, then review and submit.

Two Console behaviours worth knowing before you click:

- On the production review step the button is **"Save"**, and it does *not*
  publish. It stages the release into **Publishing overview**. The actual
  decision is **"Submit N changes for review"** there.
- **"Create new release" is greyed out on a track that already holds a draft.**
  That is the signal a draft exists, not a permissions problem — resume the draft
  instead of trying to make another.

### Managed publishing changes what "submit" means

| Setting | What happens on approval |
| --- | --- |
| **Off** (current) | Goes live automatically. Submitting for review **is** the publish decision. |
| **On** | Google approves, then it waits for you to press publish. |

## 5. How long the review actually takes

Measured for submission 7 on 2026-09-09:

| Event | Time |
| --- | --- |
| Submitted for review | 7:32 PM |
| Published | 8:05 PM |

**33 minutes.** The confirmation dialog's "typically completed within 7 days" is
a worst case; an established app making a routine update is reviewed largely
automatically. Plan for hours, not days — and with managed publishing off, treat
submission as going live the same evening.

The authoritative record is **Publishing overview → Submission activity**, which
lists every submission with its status and exact publish time.

## Can internal testing and a production review run at once?

**Yes — verified on 2026-09-09.** Version code 8 was submitted to production at
7:32 PM, added to internal testing from the library and published at 7:47 PM,
and the production submission published normally at 8:05 PM. The same version
code is offered in the library for a lower track while it sits in production
review, and neither disturbed the other.

That said, the ordinary order (internal first, then promote) remains the right
one, because it puts the build on a phone before it reaches the public queue.

## What a green Play submission does not prove

- Nothing about behaviour on a real device. Test the exact artefact by hand.
- The pre-launch "quick checks" (up to ~14 minutes) are policy and crash-surface
  checks, not a functional test.
- The recurring **"no deobfuscation file associated with this App Bundle"**
  warning is benign — it only makes crash reports less readable, and matches the
  standing "obfuscation 2%" advisory on the dashboard. It is not a blocker.
- **Check "Changes to your supported devices" on the review page.** Zero in the
  "no longer supported" column is what proves the architecture trap did not
  happen. For version 8: 12,405 phones and 6,408 tablets, none lost.

## Related

- [`PLAY_SUBMISSION.md`](PLAY_SUBMISSION.md) — signing decisions, listing copy, Data Safety, assets
- [`DISTRIBUTION.md`](DISTRIBUTION.md) — build, OTA and rollback mechanics
- [`APPLE_SUBMISSION.md`](APPLE_SUBMISSION.md) — the iOS equivalent
- `mobile/scripts/build-aab-play.sh` — the build, with its guards commented inline
