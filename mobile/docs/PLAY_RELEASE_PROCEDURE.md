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
🔴 The Console belongs to the owner's Google account, and its `u/N` slot in the URL
moves with the browser profile's sign-in order (`u/1` on 2026-09-10, `u/2` on
2026-09-12). Read the page title — "Production | Timebank Global" — before trusting
a page; on 2026-09-12 `u/1` opened a *different, closed* developer account.

Then record what you read in `mobile/live-store-build.json` once the new build is
released (commit it was built from, version code, version name = runtime version,
"Released on" time). Since 2026-09-12 that file is what `npm run verify:release` uses
to refuse a version code below the live one, and what `scripts/publish-update.mjs`
uses to refuse an over-the-air update whose native dependencies differ from the
binary members have — the near-miss that made this necessary is in
[`DISTRIBUTION.md`](DISTRIBUTION.md), "What an over-the-air update cannot do".
🔴 Bump `expo.version` whenever `package.json` dependencies or `app.json` plugins
change, not only for user-visible changes: the runtime version is derived from it,
and it is the only thing that stops an old binary from taking an update it cannot run.

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
(~91 MB minified; the build itself took **1m 45s** unminified and **2m 14s** with
R8 on a warm cache, no EAS quota spent).

That script exists because five separate failures here are silent, and each
produces a normal-looking `app-release.aab`. It refuses rather than warns:

| Trap | What happens without the guard |
| --- | --- |
| **Debug signing** | `android/app/build.gradle` falls back to `signingConfigs.debug` when the signing values are absent. No error. Play rejects the upload, and if it did not, the signature could never update the installed app. 🔴 Until 2026-09-12 the block that read `PLAY_STORE_FILE` and friends existed only in one checkout's git-ignored Gradle file; a prebuild wiped it and a clean copy never had it, so the first 1.5.0 bundle came out debug-signed and only this guard caught it. `plugins/with-android-play-signing.js` now regenerates the block on every prebuild. |
| **Wrong API host** | Expo bakes `EXPO_PUBLIC_API_URL` into the bundle permanently. On 2026-09-09 `.env.production.local` still held `http://10.0.2.2:8090` — the emulator's alias for the build machine — left behind by `build-apk-local.sh` during testing. That build works flawlessly on an emulator and is dead in every real user's hand. |
| **One CPU architecture** | `expo run:android` writes `reactNativeArchitectures=<one abi>` into `android/gradle.properties`; a later release build inherits it. On 2026-08-20 that shipped an x86_64-only artefact: perfect on the emulator, "App not installed" on a real phone. |
| **A build no update can reach** | Found 2026-09-10 by opening the version code 8 bundle: it had **no update channel** (EAS writes one into cloud builds; a local build gets it only from `app.json`'s `updates.requestHeaders`, which nothing set) and a **runtime version of 1.2.0** inside a 1.4.0 app (the script only ran `expo prebuild` when `android/` was missing, so an August value survived). Either alone means the update service serves that build nothing, ever. The script now regenerates the native project on every build and reads both values back out of the finished bundle. Version code 9 is the first build that can receive an over-the-air update. |
| **An unminified bundle** | Added 2026-09-12. Play measures "DEX code optimization" and warns below 25%; version code 10 measured **Obfuscation 2%**, with a February 2027 deadline. `app.json` now sets `enableMinifyInReleaseBuilds`, but that reaches Gradle through a git-ignored generated file, and generated values have gone missing before (the row above). So the guard reads the finished bundle for `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`, which exists if and only if R8 ran. See [Minification](#minification-r8) below. |

The script also verifies the finished bundle's certificate against the upload key
before reporting success.

### Minification (R8)

Release builds are minified and resource-shrunk. Two things follow that matter on
every release from version code 11 onward.

🔴 **A clean build proves nothing about a minified app.** R8 breaks React Native
at RUNTIME, never at build time, and the call sites it breaks are nearly all
wrapped in `try`/`catch` or `runCatching` upstream — so the symptom is a feature
quietly not working, with nothing logged at a level anyone reads. The keep rules
in `mobile/android-proguard-rules.pro` were derived by reading every dependency
for string-based class, field and method lookups; each rule names the call site
that requires it. That is evidence, not proof. **The first build after any
dependency upgrade must be walked on a real device**: sign-in including two-factor
enrolment, feed, listings, messages, wallet/exchange, volunteering, marketplace,
notifications and push, camera, QR scanning, image upload *and its crop screen*,
Stripe payment screens, audio and video playback.

**Where the rules live and why.** `android/` is git-ignored and regenerated by
`expo prebuild` on every build, so `android/app/proguard-rules.pro` cannot hold
anything. `plugins/with-android-proguard-rules.js` appends the checked-in file
into the generated one inside a replaceable fence. Never edit the generated copy.

**Play gets the deobfuscation file automatically** — R8 writes the mapping into
the bundle, which is what retires the recurring "no deobfuscation file associated
with this App Bundle" warning. There is no separate upload step. Sentry's Android
Gradle plugin is *not* configured here, so Java/Kotlin frames in Sentry are
obfuscated; JavaScript frames are unaffected because they use source maps, and
almost all of this app's crashes are JavaScript. `-keepattributes
SourceFile,LineNumberTable` is set so Play Console's own crash view stays
readable.

#### What it saved, measured

Version code 10 and version code 11 were built from the same application code —
the only difference is minification — so this is a like-for-like comparison, not
an estimate.

| | Build 10 (unminified) | Build 11 (R8) | Change |
| --- | --- | --- | --- |
| **DEX, uncompressed** | 72.07 MiB, 8 files | **27.54 MiB, 4 files** | **−61.8%** |
| Android resources (`base/res`) | 9.57 MiB, 1,693 entries | 9.51 MiB, 1,651 entries | −0.7% |
| Native libraries (4 ABIs) | 97.87 MiB | 97.87 MiB | unchanged |
| **Whole .aab on disk** | 101,120,261 bytes | **95,744,281 bytes** | **−5.1 MiB, −5.3%** |

🔴 **Do not quote the 5.3% as the win.** The `.aab` is dominated by native
libraries for four CPU architectures, which R8 does not touch and which Play
strips per-device on install anyway. The number that matters to the Play warning,
and to what a member downloads, is the **61.8% DEX reduction**.

Resource shrinking contributes almost nothing here, and that is expected rather
than a fault: the shrinker's own report opens with
`android.content.res.Resources#getIdentifier present: true`, so it ran in its
conservative mode — four Expo packages look resources up by name at runtime — and
most of this app's assets are bundled by Metro rather than being Android
resources at all. It is left on because it is free and correct, not because it
saves much.

Of the 42,619 classes in the mapping file, **40,661 (95.4%) were renamed**. Play
computes its own "Obfuscation" percentage its own way, so treat that as our
measurement of the mapping rather than a prediction of the Console's figure —
but it is the right order of magnitude against a 25% threshold and a 2% starting
point. Read the real number on **Production → Release dashboard** after the
release is live.

Build cost on the dev machine: `:app:minifyReleaseWithR8` adds roughly a minute,
and R8 needs far more memory than Expo's template allows — see
`plugins/with-android-gradle-memory.js`.

#### When R8 fails the build

Both of these happened on the first minified build (2026-09-12) and both are
loud, which makes them the easy half of this change.

**`ERROR: Missing classes detected while running R8`.** R8 checks the whole
reference graph, so a library that references an *optional* dependency you do not
have fails the build even though that code is never reached. Read
`android/app/build/outputs/mapping/release/missing_rules.txt`, which names the
exact classes and the rules to add. Here it was Stripe's Issuing push
provisioning. 🔴 Before pasting the generated `-dontwarn` lines in, confirm the
app really does not use that feature — the same message appears when a dependency
is genuinely missing, and silencing that would move a build failure to a runtime
crash.

**`ERROR: R8: java.lang.OutOfMemoryError: Java heap space`.** Expo's template
gives Gradle `-Xmx2048m`, which was enough while nothing minified. R8 holds the
app and every dependency in memory at once. `plugins/with-android-gradle-memory.js`
raises it to 4 GB; raise it there again if a future dependency exceeds that.
Gradle warns about metaspace shortly before this, which is the tell.

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
- 🔴 **On Publishing overview, LET THE QUICK CHECKS FINISH before you submit.**
  After Save, the page shows a progress bar — *"Running quick checks for
  commonly found issues … up to 14 minutes remaining … Changes will be sent for
  review as soon as checks complete successfully."* The **Submit button is
  enabled while that bar is still running**, and that is the trap: pressing it
  queues the release before Google's own policy and crash-surface scan has
  reported, so a problem the scan would have shown you is discovered in review
  instead of on this page where you could still fix it. This was done wrong
  twice, on submissions 7 (2026-09-09) and 8 (2026-09-10), and the owner's
  instruction is explicit: wait for the bar to disappear and read what it
  found, then submit. An enabled button is not permission. The same applies to
  "Save and publish" on internal testing if a quick-checks bar is showing.
- **"Create new release" is greyed out on a track that already holds a draft.**
  That is the signal a draft exists, not a permissions problem — resume the draft
  instead of trying to make another.

### Managed publishing changes what "submit" means

| Setting | What happens on approval |
| --- | --- |
| **Off** (current) | Goes live automatically. Submitting for review **is** the publish decision. |
| **On** | Google approves, then it waits for you to press publish. |

## 5. How long the review actually takes

Measured, three times:

| Submission | Submitted for review | Published | Review time |
| --- | --- | --- | --- |
| 7 (version code 8), 2026-09-09 | 7:32 PM | 8:05 PM | **33 minutes** |
| 8 (version code 9), 2026-09-10 | 11:57 AM | 12:24 PM | **27 minutes** |
| 9 (version code 10), 2026-09-12 | 12:05 PM | 12:36 PM | **31 minutes** |

Submission 9's quick checks on Publishing overview ran for about 13 minutes ("up to
14 minutes remaining" → "Your changes can now be sent for review") before Submit was
pressed; a second, ~2-minute quick-check pass then ran under "Changes in review".

The confirmation dialog's "typically completed within 7 days" is a worst case; an
established app making a routine update is reviewed largely automatically. Plan
for under an hour, not days — and with managed publishing off, treat submission
as going live within the hour. (Submission 8 was still "In review" at 12:15 and
"Published" by 12:30; the Production track's Releases tab gives the exact
"Released on" time.)

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
