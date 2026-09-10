---
name: play-release
description: "Shipping the Expo/React Native app (mobile/) to Google Play or publishing an over-the-air update. Use for ANY request touching the Play Console, a version code, an .aab, internal testing, promotion to production, submission for review, or `eas update`. Keywords: Play Console, internal testing, promote, submit for review, version code, AAB, OTA, EAS update."
metadata:
  author: Project NEXUS
  version: "1.0.0"
---

# Play release — the order of operations, and the waits

The authoritative, measured record is `mobile/docs/PLAY_RELEASE_PROCEDURE.md`. Read it
before every release. This skill is the checklist distilled from the mistakes that have
actually been made, so the same one is not made a third time.

## The rule this skill exists for

🔴 **On Publishing overview, let "Running quick checks for commonly found issues" FINISH
before pressing "Submit N changes for review".** The bar says "up to 14 minutes remaining";
the Submit button is **enabled while it runs**, and that is the trap. Pressing it early
queues the release before Google's own policy and crash-surface scan has reported, so a
problem the scan would have shown you on this page is found in review instead. Done wrong
on submissions 7 (2026-09-09) and 8 (2026-09-10); the owner's instruction is explicit.

Procedure when the bar is showing: **do not click anything.** Re-read the page every few
minutes (screenshot or page text). When the bar is gone, read what it found. Only then
submit. The same wait applies to "Save and publish" on internal testing.

**General form:** an enabled button is not permission. Read the page before pressing it.

## Order of operations (never skip a step)

1. **Version code** comes from **Play Console → Production → Latest release**, not from
   `app.json` and not from EAS's remote counter (it was 4 while Play was on 7). Must be
   higher than what is live. Bump `android.versionCode` in `mobile/app.json` to match.
2. **Build locally**: `bash mobile/scripts/build-aab-play.sh --version-code N`. It refuses
   a debug-signed bundle, an emulator API host, a single CPU architecture, and (since
   2026-09-10) a bundle with no update channel or a stale runtime version. If it refuses,
   fix the cause — never hand-edit the bundle or skip the guard.
3. **Copy** the result to `mobile/timebank-global-<version>-build<N>.aab` and tell the owner
   the path. **The upload is the owner's.** The file is ~94 MB; the agent cannot send it,
   and navigating the page during a human upload silently aborts it.
4. **Internal testing** first: Test and release → Testing → Internal testing → Create new
   release → drop the bundle → release notes → Next → *wait for quick checks* → Save and
   publish. No review; reaches the tester list within the hour.
5. **Promote**: Internal testing → Promote release → Production. On the review page check
   **"Changes to your supported devices"** — the "no longer supported" column must be **0**
   on every row (this is what proves the architecture trap did not happen). Check roll-out
   is 100% and all targeted countries. "Save" only STAGES it.
6. **Publishing overview**: *wait for the quick checks to finish* (see the rule above), then
   "Submit N changes for review", confirm. Verify in **Submission activity**.
7. Review is measured in minutes, not days: submission 7 took 33 minutes, submission 8
   took 27 (11:57 AM → 12:24 PM, 2026-09-10). The exact "Released on" time is on the
   Production track's Releases tab. With managed publishing off, submitting is the
   decision to go live.

## Over-the-air updates

- Only builds from **version code 9 onward** can receive one. Earlier bundles carried no
  update channel and a stale runtime version (see `mobile/docs/DISTRIBUTION.md`).
- Play installs listen to channel **`production`**. "Publish to internal testing" therefore
  means `NEXUS_APPROVE_PRODUCTION_OTA=yes npm run update:production` from `mobile/`, from a
  **clean `main` worktree** (the script refuses otherwise — commit first).
- The update applies on the member's next cold start; it is not instant.
- Rollback: `NEXUS_APPROVE_PRODUCTION_ROLLBACK=yes npm run rollback:production`.

## Play Console traps

- The Console lives under the **jasper@hour-timebank.ie** Google account
  (`play.google.com/console/u/1/…`). The `u/0` account (funding@) has no developer account
  and shows a **sign-up page — never create an account there.**
- Direct URL for the app's internal testing track:
  `https://play.google.com/console/u/1/developers/7594317311280776590/app/4976285384640999912/tracks/internal-testing`
- "Create new release" greyed out = a draft already exists; resume it.
- The recurring "no deobfuscation file" warning is benign; it is not a blocker.
- In Claude-in-Chrome a **horizontal scroll is a swipe-back** and leaves the form.

## Before saying "done"

State exactly what the Console shows (track, version, status, time) — read from the page,
not inferred. Say what you did not check. Update `PLAY_RELEASE_PROCEDURE.md` with any
measured timing or new trap in the same session.
