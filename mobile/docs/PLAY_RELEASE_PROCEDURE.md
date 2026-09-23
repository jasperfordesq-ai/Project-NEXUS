<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Releasing to Google Play — the procedure, and everything that bites

Last reviewed: 2026-09-23

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
moves with the browser profile's sign-in order — measured `u/1` on 2026-09-10,
`u/2` on 2026-09-12, `u/0` on 2026-09-13 and again on 2026-09-15, `u/2` on 2026-09-23. **Never memorise the slot; try each and
read the page title** — "Production | Timebank Global" is the right one. The wrong
slots are not merely empty: on 2026-09-12 `u/1` opened a *different, closed*
developer account, and on 2026-09-13 both `u/1` and `u/2` opened a **"New Play
Console Terms of Service" page for a different signed-in account**. Do not accept
those terms — accepting them on the wrong account is not what anyone asked for;
just move to the next slot. On 2026-09-23 `u/0` opened that terms page for the owner's
`jasper.ford.esq` sign-in and `u/1` a different Google account ("Timebank Ireland"); `u/2` was right.

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

Output, filed automatically once every guard below has passed:
`mobile/releases/android/play/timebank-global-<version>-build<code>.aab`. **Upload that
file.** Gradle's own copy at `mobile/android/app/build/outputs/bundle/release/app-release.aab`
is overwritten by the next build.
(~91 MB minified; the build itself took **1m 45s** unminified, **2m 14s** with R8
on a warm cache, and **5m 44s** with R8 from a cold clean checkout — 2026-09-13,
version code 11. Version code 13 took **5m 55s** and version code 14 took
**2m 41s** with R8 on 2026-09-15. No EAS quota spent.)

Do not add Gradle's optional `--clean` step after Expo prebuild on this Windows
checkout. On version code 13 it reached `externalNativeBuildCleanDebug` before
React Native had regenerated dependency codegen folders, then failed because the
autolinking CMake file referenced folders that did not exist. Running the guarded
command above without `--clean` generated codegen first and completed normally.

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

#### `verify:network-security` can refuse for a reason that is not a fault

It inspects the **generated** `android/` project, not just the two committed source
files. If `android/` is missing or stale — after a clean-up, or a fresh clone — it
reports the debug config as MISSING and refuses to certify, which reads alarmingly
like a pinning regression. Seen on 2026-09-13. Run `npx expo prebuild --platform
android` and re-run it before investigating anything else; the committed
`android-network-security-config*.xml` pair is the actual source of truth, and
`build-aab-play.sh` prebuilds on every run anyway.

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

### Where every build lives

🔴 **One folder: `mobile/releases/android/`** (git-ignored — the bundles are ~96 MB each).

| Path | What |
| --- | --- |
| `play/timebank-global-<version>-build<code>.aab` (+ `.sha256`) | Every Play bundle, one per version code |
| `sideload/timebank-global-<version>-<live|local>-<yyyymmdd-hhmm>.apk` (+ `.sha256`) | Every APK from `npm run build:apk` |
| `INDEX.tsv` | One line per build: when, kind, version, code, **source commit**, SHA-256, size, file, API host |

`scripts/build-aab-play.sh` and `scripts/build-apk-local.sh` call
`scripts/archive-android-build.sh` as their last step, so nothing needs copying by hand.
It refuses to file a second, different bundle under a version code that is already filed —
Play would refuse the repeat anyway, and two files with one number is how "which one did we
upload?" starts.

Until 2026-09-23 bundles were copied by hand into the root of `mobile/` under two naming
styles, with no record of the commit. Those thirteen files were moved into this folder that
day. The SHA-256s of builds 14–17 matched the ones recorded below, which is the proof they
are the uploaded artefacts; builds 4–13 carry commit `unknown` except 12 (`5241fa23f`,
from `live-store-build.json`), because nothing recorded them.

## 3. Publish to internal testing

**Test and release → Testing → Internal testing → Create new release.**

If the bundle is already uploaded (e.g. it was uploaded to another track), use
**Add from library** — no second upload of 90 MB.

The final button on this track is **"Save and publish"**, and it means it: there
is no review. The Console says changes "usually appear on Google Play within
1 hour". Measured 2026-09-09: published at 7:47 PM, available to the 11-member
internal tester list. Measured again 2026-09-12 (version code 10, 11:48 AM),
2026-09-13 (**version code 11, 11:40 AM**, same 11-member list) and 2026-09-15
(**version code 12 / 1.6.0, 6:41 AM** Console time; device table Phone 12,405 /
Tablet 6,408 / TV 3 / Chromebook 10 / Android XR 1, 0 lost on every row; 32.6 MB
new install, +97.1 KB on build 11; 3.96 MB update). Version code 13 / 1.7.0 was
published at **9:21 PM** the same day; the device counts were unchanged with 0
lost on every row, the new-install size remained 32.6 MB, and the update was
13.8 MB. Version code 14 / 1.7.1 was published at **10:17 PM** the same day and
Play reported it as **Available to internal testers**. It was built from source
commit `3a858535c`; the 95,971,048-byte AAB had SHA-256
`3028E34896A5F359E8A2A630EB91BE7BF6AE70AC519D610A9A8BB7D824B609FA`. All six
exact-commit GitHub workflow groups completed successfully before upload. This
candidate supersedes build 13 and fixes the Android keyboard collapse in shared
bottom-sheet forms; production remains on build 12 / 1.6.0 pending a physical
Android walkthrough of the Request exchange form.

Version code 15 / 1.7.2 was published at **10:21 AM on 2026-09-16** and Play
reported it as **Available to internal testers**. It was built from source commit
`211592587bef36de05207830cdc3f3c5c78dd3d6`; the 95,970,834-byte AAB had
SHA-256 `339A70FE2299895323FDEA3B45217DE12DB1049D25C5D48ABFF96A3423411418`.
All six exact-commit GitHub workflow groups completed successfully before the
bundle was built. Play verified API level 24+, target SDK 36, four screen layouts,
four ABIs and six required features. Its review table reported 0 devices lost in
every category (Phone 12,405 / Tablet 6,408 / TV 3 / Chromebook 10 / Android XR
1), a 32.6 MB new install and a 13.8 MB update. Build 15 supersedes build 14 on
Internal testing and keeps the Request exchange Cancel and Send request actions
above the scrollable fields while the keyboard is open. Production remains on
build 12 / 1.6.0 pending a physical Android walkthrough of this exact artefact.

Version code 16 / 1.7.3 was published at **11:34 AM on 2026-09-16** and Play
reported it as **Available to internal testers**. The build checkout was
`33fc7030ac06c0f90c814ed5e66f504acd9d62cb`; its mobile source is unchanged from
release commit `9c60fd1a544b044d823b1ed780ac9ab941f3048c`. All six workflow
groups on that release commit passed before upload. The Android gate needed a
rerun after one connection readback test timed out; the rerun passed. The signed
build completed in 2m 36s. The 95,972,059-byte AAB has SHA-256
`37CE5A3A8A31E0849078AB6B186FA51A8685B7F817C6CBFA22672D5B1F8308EC`.
Play verified API level 24+, target SDK 36, four screen layouts, four ABIs,
six required features, and attached mapping/native debug symbols. The review
reported 0 devices lost in every category, a 32.6 MB new install and a 13.8 MB
update. It showed **Ready to release**, with no quick-checks bar or blocking
issue. The en-GB notes describe keyboard-aware form scrolling, internally
scrolling long notes and clearer Request exchange labels. This is an internal
candidate for physical-device verification; production was not promoted.

Version code 17 / 1.7.4 was published at **1:05 PM on 2026-09-16** and Play
reported **Available to internal testers**. Source commit:
`21795d156c2eee03079ce9f7e8f59c32ed514985`. The 95,972,614-byte AAB has SHA-256
`D7FF1F380A4F4EFB91716C601D6EF16EAE8937BB0ABCD7AEA70A2F4EA2E8E02A`.
The guarded local build took **2m 49s**. All six source-commit workflow groups
(and the deploy drift watchdog) passed before publication, including the full CI
Pipeline and its final Docker verification. Play showed **Ready to release**
without a quick-checks bar, 0 devices lost in every category, a 32.6 MB new
install and a 13.8 MB update. The en-GB notes describe keyboard-visible long-note
scrolling and shared drawer improvements. The actual shared controls were
verified in an isolated Android emulator reproduction at normal and 200% text
size; physical Samsung and iOS verification remain outstanding. Production
remains build 12 / 1.6.0; this release was not promoted.

**The browser upload route works for the full bundle.** Measured on version codes
13 and 14, the file-chooser bridge uploaded the 96 MB AAB, then Play optimized it
before showing the expected version in the artifact table. This replaces the
earlier 10 MB bridge limit. `mobile/google-play-key.json` — the service-account
key `eas.json` points at — still has never been created, so browser upload remains
the available route. Two Chrome-driving traps from the earlier run:

- **Clicking "Create new release" through its accessibility reference did nothing
  useful** — the page scrolled sideways and the form never opened. A click on the
  button's screen position opened it first time. If the URL still ends in
  `/tracks/internal-testing` after the click, it did not work.
- **A positional click into "Release name" missed silently after the browser window
  was resized mid-session**; the field stayed at `0 / 50` while the notes went in
  fine. Read the counter back after typing — do not trust that the click landed.

🔴 **No quick-checks bar appeared on this track on 2026-09-13, nor on 2026-09-15.** The review step
showed "Ready to release" with no "Running quick checks" progress bar anywhere,
and "Save and publish" → the confirm dialog published immediately. That bar
belongs to the **Publishing overview** used by the Production submission flow. The
rule below still stands — *if* a bar is showing, wait for it — but do not go
hunting for one here and conclude something is wrong when there is none.

🔴 **The review step before "Save and publish" is worth reading, not clicking
past.** It carries the **"Changes to your supported devices"** table, which is the
same check the production promote page shows: the **"Devices no longer supported"
column must be 0 on every row**. On version code 11 it read Phone 12,405 / Tablet
6,408 / TV 3 with 0 lost on each — the proof that the single-architecture trap did
not happen, available here *before* production is involved at all.

🔴 **Uploading is where a release most easily goes wrong in practice.** The file
is ~90 MB and takes a minute or two. **Do not navigate, reload or interact with
the page while it transfers** — the upload aborts silently and the release page
simply shows no new version, with no error. This happened on 2026-09-09 and cost
a full re-upload. Verify success by reading the page afterwards, not by reloading it.

## 4. Promote to production

**Internal testing → Promote release → Production**, then review and submit.

Measured on version code 12 (2026-09-15): "Promote release → Production" was
enabled (no stale Production draft); the promote flow carried the name `12 (1.6.0)`,
the bundle and the en-GB notes across unchanged, listed build 11 under "Not
included" and "No app bundles from your previous release will be included"; the
review step read "Ready to release", roll-out **100.0 %**, "Available in all
targeted countries", 5 installs on active devices, and the device table matched
the internal-testing one exactly (0 lost on every row). **Save** → a dialog
"Go to Publishing overview? Your change has been saved" → "Go to overview".

On **2026-09-16**, build **17 / 1.7.4** was promoted from Internal testing
to Production at the owner's request. The review screen confirmed **100.0%**
rollout, **all targeted countries**, unchanged release notes and **0 devices
lost** in every category. The pre-submit quick checks cleared with "Your changes
can now be sent for review" before submission. A second quick-check pass after
submission also cleared with "Your changes are now in review". Submission
activity records **submission 12**, submitted **September 16, 2026, 1:22 PM**,
**Production — In review**. Managed publishing remains off, so approval will
publish automatically. This records submission, not a confirmed live release;
`live-store-build.json` remains on build 12 until publication is verified.
(It then stayed on 12 after build 17 went live. The next release, on 2026-09-23, found it that way.
The file guards over-the-air updates, so update it the moment a release is confirmed live.)

On **2026-09-23**, build **18 / 1.8.0** went through both steps the same day, at the owner's
request, **without a physical-device walk of build 18**. It was built by `build-aab-play.sh
--version-code 18` from `5bb399868`, whose mobile source is `77e62cd50` plus the version bump.
All six workflow groups passed on `77e62cd50`. The 96,182,826-byte AAB has SHA-256
`00A4A32B449FBE2162B6DE0C9A4A27B9D4953A564AA9FE42EBF8AE5C897BC1FB` and is filed as
`releases/android/play/timebank-global-1.8.0-build18.aab`. The owner uploaded it: the agent's
browser upload was refused by its permission layer. The agent then entered the en-GB notes.

- **Internal testing:** "Ready to release", no quick-checks bar. 0 devices lost on every row
  (Phone 12,258, Tablet 6,433, TV 3, Chromebook 10, Android XR 1). New install 32.9 MB (+208 KB),
  update 12.6 MB. Published 12:53 PM.
- **Production:** promote carried the bundle, name and notes across, with build 17 under
  "Not included". 100.0% rollout, all targeted countries, 7 active installs.
- **Quick checks:** the pre-submit bar ran about 13 minutes ("up to 14 minutes" → "Your changes
  can now be sent for review") before submitting. A second pass then ended "Your changes are now in review".
- **Submission 13**, submitted September 23, 2026, 1:09 PM, **Production — In review**.

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

Measured, five times:

| Submission | Submitted for review | Published | Review time |
| --- | --- | --- | --- |
| 7 (version code 8), 2026-09-09 | 7:32 PM | 8:05 PM | **33 minutes** |
| 8 (version code 9), 2026-09-10 | 11:57 AM | 12:24 PM | **27 minutes** |
| 9 (version code 10), 2026-09-12 | 12:05 PM | 12:36 PM | **31 minutes** |
| 10 (version code 11), 2026-09-13 | 11:55 AM | 12:26 PM | **31 minutes** |
| 11 (version code 12), 2026-09-15 | 7:01 AM | 7:27 AM | **26 minutes** |

Submission 9's quick checks on Publishing overview ran for about 13 minutes ("up to
14 minutes remaining" → "Your changes can now be sent for review") before Submit was
pressed; a second, ~2-minute quick-check pass then ran under "Changes in review".

Submission 10 behaved the same way and is the confirmation that both waits are
routine, not one-offs: the pre-submit bar quoted "up to 14 minutes remaining",
counted down through 12, and cleared **well inside** the quoted time, ending with
**"Your changes can now be sent for review"**. The post-submit bar quoted "up to 8
minutes" and ended with **"Your changes are now in review"**. Neither reported an
issue. 🔴 Both sentences are the signal to act on — not the bar disappearing from
view, and never the Submit button becoming clickable, which it is throughout.

Submission 11 (2026-09-15): the pre-submit bar quoted "up to 14 minutes", counted
down 13 → 12 → 11 → 9 → 8 → 7 → 6 → 5 → 3 → 2 in roughly one-minute steps and
cleared after **about 12 minutes** with **"Your changes can now be sent for review"**
and no issues listed. 🔴 **This time there was NO second bar**: "Send changes for
review" went straight to **"Your changes are now in review"** with the Production
row already under "Changes in review". So the post-submit pass is not guaranteed
to be visible — do not wait for a bar that is not there; the sentence is the
signal either way. The submit dialog carried no warning about a review in flight
(build 11's had published on 2026-09-13), which is the check that trap 3 from the
1.3.0 run did not fire.

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
