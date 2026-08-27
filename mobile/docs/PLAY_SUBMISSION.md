# Google Play submission — everything prepared, and the parts only the owner can do

Last reviewed: 2026-08-26

The developer identity is verified and Timebank Global is publicly installable from Google
Play as of 2026-08-26. This page is now the evidence source for the next Android release:
signing, policy answers, listing copy, reviewer access, screenshots and the checks that must
be repeated before another build is uploaded.

Nothing here is a claim that the *next working-tree state* is ready to upload. Read
[the store-readiness row in CURRENT_MOBILE_PRODUCTION_STATUS.md](CURRENT_MOBILE_PRODUCTION_STATUS.md)
for the score, and the checklist at the end of this page for what is genuinely outstanding.

---

## The payments question — decided and implemented

**Decided by the owner on 2026-08-25: identity verification is hidden in the app.** What
follows is the record of why, and what was actually changed, because the decision has to be
re-made — not merely re-read — before it is ever reversed.

**The risk.** `verify-identity` took a card payment inside the app, through Stripe, and
unlocked an "ID verified" badge in the app. Google Play requires **Google Play Billing** for
digital content or services consumed inside an app. A badge is exactly that. The penalty for
guessing wrong is not a rejection letter before launch — it is removal after launch, with
members already using the app.

**What was changed.** One switch, `IDENTITY_VERIFICATION_AVAILABLE_IN_APP` in
`lib/constants.ts`, currently `false`:

- The Settings → Account row is **absent**, not disabled. A row leading to "you cannot do
  this here" still advertises a paid feature the app may not sell.
- The screen keeps its **status** — a member who is already verified still sees that, and
  someone mid-verification can still refresh — and replaces the start/date-of-birth/fee
  steps with "Not available in the app". Hiding the sale must not hide what someone already
  paid for.
- The **"Open web verification flow" button is deleted, not hidden.** Play's anti-steering
  rule is a separate violation from the billing one: an in-app button that sends someone out
  to buy the same thing elsewhere breaks it on its own. `native-config.test.js` now fails if
  any screen links to that path again.
- Both handlers return early when the switch is off, so a future refactor cannot reach a
  paid flow through a button that stopped being conditional.

**What was deliberately NOT changed.**

- **The marketplace keeps taking payments.** It sells second-hand *physical* goods with
  pickup or shipping (`delivery_method: pickup | shipping | both | community_delivery`), and
  physical goods are explicitly exempt from Play Billing — this is how every classifieds app
  works. Hiding it would have cost a working feature for no reason.
- **Time-credit donations** are unaffected: donating hours to a community fund or another
  member moves no money.

**Re-enabling.** Flip the constant to `true`. Everything underneath is untouched and still
tested — the test suites cover both states deliberately. Before flipping it, the billing
question has to be answered, not assumed: either Play Billing, or verification becomes free
in the app, or Play's policy has changed in a way that covers this.

**Consequence for the store forms:** the app now takes money in exactly one place, the
marketplace, for physical goods between members. Answer the payments and content questions
from that, not from the code's Stripe imports.

## What was verified on 2026-08-25, with evidence

| Check | Result |
| --- | --- |
| Target API level | **36** (Android 16), read from a built artefact with `aapt2 dump badging`. Play's floor for new apps is 35, so this is clear |
| Package / label / version | `ie.project.nexus`, "Timebank Global", `versionName 1.2.0`, `versionCode 2` |
| App bundle builds | `:app:bundleRelease` produced `app-release.aab` (94 MB — Play splits this per device, so the member download is far smaller) |
| No dev host in the shipped JS | `10.0.2.2` and `localhost:8090` appear **0** times in the release bundle; `api.project-nexus.ie` is present |
| Certificate pinning | 2 pins in the generated `network_security_config.xml`; the release config is fail-closed |
| Deep links | `autoVerify` intent filter for `app.project-nexus.ie` plus the `nexus://` scheme |
| Public privacy policy | `https://timebank.global/privacy` → 200 and names Timebank Global, its operator, registered address, GDPR rights, retention periods, and adult-only audience |
| Public account deletion | `https://timebank.global/account-deletion` is implemented in the release candidate; deploy it before changing the Play Console URL. It gives the in-app steps, a prefilled public request form, and exact deletion/retention disclosures |
| Public child-safety standards | `https://timebank.global/child-safety` is implemented in the release candidate; deploy it before completing Play's child-safety declaration. It explicitly prohibits CSAE/CSAM and publishes reporting, enforcement, authority escalation, and the designated contact |
| In-app account deletion | Built and walked on a device today — Play's hard requirement is met (ledger row 8.3) |
| Third-party analytics SDKs | **None.** No Firebase Analytics, PostHog, Facebook, Amplitude or attribution SDK. This makes the Data Safety form much simpler than usual |

### What Play will show under "Permissions"

The release manifest requests **38** permissions, which sounds alarming and mostly is not.
Read from the merged release manifest on 2026-08-25:

- **Asked for, and used by a feature the member chooses:** camera, record audio, approximate
  and precise location, biometrics/fingerprint (the device unlock), post notifications.
- **Housekeeping the platform requires:** internet, network and wifi state, vibrate, wake
  lock, boot completed, modify audio settings, write external storage, and the app's own
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
- **Twenty-two launcher badge permissions** (`com.sec.android…`, `com.huawei.android…`,
  `com.oppo.launcher…`, `me.everything.badger…` and so on). These come from the notification
  library's unread-count support and are how a number gets onto the app icon on Samsung,
  Huawei, Oppo and others. They are vendor-specific and Play lists them under "Other".
- `com.google.android.c2dm.permission.RECEIVE` — push delivery.
  `…BIND_GET_INSTALL_REFERRER_SERVICE` — Play's own install-referrer service.

None of these needs a Play declaration form. The two that do — *All files access* and
*background location* — are **not** requested. Anything alarming in that list should be
traced with the manifest merger blame report before assuming it is ours:
`android/app/build/intermediates/manifest_merge_blame_file/release/.../manifest-merger-blame-release-report.txt`
attributes every line to the library that added it. That is how `android.permission.DUMP`
turned out to be a *receiver guard* inside Google's own `androidx.profileinstaller`, not a
permission this app asks for.

### Two faults found by doing this, and fixed

- **The app declared `SYSTEM_ALERT_WINDOW` ("display over other apps") in the shipping
  manifest.** It is React Native's development overlay: `expo-dev-client` puts it in the
  debug manifest, where it belongs, but it was also in `main`, which ships. Nothing in the
  app draws an overlay. It is now blocked in `app.json`
  (`android.blockedPermissions`), which makes Expo emit it with `tools:node="remove"` so the
  manifest merger strips it. **Proven, not assumed**: the native project was regenerated and
  a release bundle rebuilt, and the permission is absent from
  `build/intermediates/merged_manifests/release/.../AndroidManifest.xml` — the manifest that
  actually ships. Guarded in `native-config.test.js`, whose first version asserted the wrong
  thing (that the string was gone from the source manifest) and would have been "fixed" by
  deleting the guard.
- **A release build fails outright unless Sentry's source-map upload is switched off.**
  Running `:app:bundleRelease` without `SENTRY_DISABLE_AUTO_UPLOAD=true` fails at
  `createBundleReleaseJsAndAssets_SentryUpload` — the generated `android/sentry.properties`
  had no org and no project and fell back to environment variables that do not exist. That
  is why every EAS profile sets that variable, **production included** — which means a
  release would ship with unreadable, minified crash reports even if crash reporting were
  on. See the Sentry section below.

---

## Signing and the AAB — plain English

An **AAB** is the Android App Bundle uploaded to Play. A **signed build** has a cryptographic
identity stamp proving that future updates come from the same publisher. The production EAS
profile now uses EAS-managed Android keystore `ElecXcPY2S` as its default. Its certificate
SHA-256 begins `F5:0D:87:55` and is valid until 2054. A quota-free local Gradle build completed
on 2026-08-26 as app version `1.2.0`, version code `5`; `jarsigner` verified the resulting
`Timebank-Global-1.2.0-build-5.aab` and its signing certificate matches the EAS default.

Enable Play App Signing in the Console when prompted. Google then protects the permanent
app-signing key; the existing EAS keystore is the credential used to sign uploads. Keep the
verified offline and encrypted backups described below before relying on it for future
updates. A debug-signed local APK may need
to be uninstalled before installing the differently signed Play-distributed build.

Two ways to hold the key, and the choice matters more than the commands:

**A. Keep the existing EAS-managed key (current and recommended).**

```bash
cd mobile
npx eas-cli@latest credentials          # Android → production → download existing keystore
```

EAS stores the existing upload keystore. Download an encrypted/offline backup of the
`.jks` and its passwords. Under Play App Signing this upload key is important but replaceable;
it is not the permanent app-signing key held by Google.

**Verified local state (2026-08-27).** The downloaded JKS is present at
`C:\platforms\htdocs\staging\mobile\@timebank-global__nexus-mobile.jks` and `*.jks` is
ignored by Git. Disaster-recovery copies were completed and verified on 2026-08-27: an
unencrypted offline JKS/credentials pair and matching password-protected, header-encrypted
archives on offline and cloud storage. Raw copies byte-match the ignored source, the two
encrypted archives byte-match each other, a passworded integrity test succeeds, and archive
headers cannot be listed without the password. Each location includes a password-free
recovery README. Keep the archive password in a separate password manager and delete nothing.
Never attach the JKS or its passwords to an issue, commit, chat or public repository.

**B. Generate it locally and upload it.**

```bash
keytool -genkeypair -v -storetype JKS -keystore nexus-upload.jks \
  -alias nexus-upload -keyalg RSA -keysize 4096 -validity 10000
```

Then attach it in `eas credentials`. Choose this if you want the key never to exist only on
someone else's servers.

Use the local-generation route only if there is a reason not to let EAS create the upload key.
For this one-maintainer project, option A plus an offline backup is the recommended route.

## Decision 2 (owner): the Play service account, for automated submission

`eas.json` already points at a key file that does not exist:

```json
"submit": { "production": { "android": {
  "serviceAccountKeyPath": "./google-play-key.json", "track": "internal" } } }
```

This key is **not needed for the first manual upload** and can wait. After the developer
account is verified, either upload the AAB by hand or create a narrowly permissioned service
account for automation and save its JSON as `mobile/google-play-key.json`. That path is
gitignored because the repository is public. Until it exists, `eas submit` cannot run; local
builds and phone testing are unaffected.

---

## Crash reporting — set up and verified on 2026-08-25

**Done, and verified rather than configured:**

- The **`nexus-mobile` Sentry project exists** in `hour-timebank-clg` (EU region), created
  2026-08-25. Project id `4511972962336848`.
- **It receives events.** A test event was sent to its DSN and read back through the API as a
  real issue, then resolved. "Set up" here means an event arrived, not that a DSN was pasted
  somewhere.
- **The DSN and project slug are recorded** in `.secrets.local/sentry.env` as
  `SENTRY_DSN_MOBILE` and `SENTRY_PROJECT_MOBILE` — gitignored, because this repository is
  public.
- **The nightly triage sweep now covers it.** `scripts/sentry-triage.mjs` already had the
  slot; it had nothing to read. It ran clean with the project in place.
- **Local release builds carry crash reporting.** `scripts/build-apk-local.sh` reads the DSN
  from the secrets file and prints `Crash reporting: ON (nexus-mobile)` — or says plainly
  that it is off, on a machine without the file, rather than building silently blind.
- **Production builds now upload source maps.** `SENTRY_DISABLE_AUTO_UPLOAD` is gone from the
  production profile and kept on every other one. Proven on this machine: with the project
  and a token, `:app:bundleRelease` reports "Upload type: artifact bundle", and the bundle
  appears in Sentry against release `ie.project.nexus@1.2.0+2`, dist `2`, 2 files. Without a
  token the same build FAILS at `createBundleReleaseJsAndAssets_SentryUpload`. Both halves of
  that are asserted by `npm run verify:release`, mutation-verified.

**The EAS side is now done too** (owner signed in 2026-08-25, variables set from this
machine):

| Variable | Environments | Visibility |
| --- | --- | --- |
| `EXPO_PUBLIC_SENTRY_DSN` | production, preview | plaintext — it ships inside the app anyway |
| `SENTRY_AUTH_TOKEN` | production, preview | secret — readable only by the builder, never in any UI |

Confirmed with `eas config --platform android --profile <name>`, which resolves a build
without spending one: the `production` profile loads the DSN from the **production**
environment, and `website`, `staging` and `preview` all resolve the **preview** environment
and load it there.

🔴 **`website` uploads source maps as well as production, and that is deliberate.** It is
the APK on the download page, so it reaches real people *before* anything on Play does;
minified crash reports from the first build members actually install would be the worst
place to have them. `staging`, `preview`, `development` and `local-emulator` stay off —
throwaway builds uploading source maps is quota spent on nothing. `verify:release` asserts
both halves, mutation-verified in both directions.

While setting this up: `GOOGLE_SERVICES_JSON` is already present as a project secret, so the
Firebase credentials behind push notifications are in place.

Worth knowing for the period before any of this existed, and still true of any build made
without the DSN: `Sentry.init` runs with `enabled: false` and reports nothing. There is
partial cover regardless — the app posts JavaScript errors to
`POST /api/app/log`, which the PHP project's `sentry` log channel picks up, so they surface
in the nightly sweep under `php`. What is lost is anything that kills the app before
JavaScript can report: native crashes and startup failures, which is precisely what a first
public release produces.

## Store listing — draft copy, ready to paste

**App name** (30 chars max): `Timebank Global`

**Short description** (80 chars max, 74 used):
`Swap skills and time with your local community. Give an hour, earn an hour.`

**Full description** (4000 chars max):

> Timebank Global is where a community trades time instead of money. Give someone an hour of
> help and you earn an hour of credit — then spend it on help you need. Everyone's hour is
> worth the same, whatever the skill.
>
> **Offer and find help**
> Post what you can do — gardening, lifts, IT help, language practice, dog walking, a
> listening ear — or browse what your neighbours are offering. Ask for what you need, agree
> the details in a private message, and log the hours when it's done.
>
> **Your time, tracked properly**
> A wallet shows the hours you've earned and spent, with every exchange recorded on both
> sides. Time-credit exchanges do not involve money. An optional second-hand marketplace
> lets members arrange purchases of physical goods, with payments handled by Stripe.
>
> **A community, not a marketplace**
> Join local groups, come to events and workshops, follow a community feed, and get to know
> the people you're exchanging with. Volunteering opportunities from local organisations sit
> alongside member offers, with shifts you can sign up for and hours that count.
>
> **Built for everyone**
> Works with screen readers, respects your system text size and dark mode, and is available
> in English, Irish, German, French, Italian, Portuguese and Spanish. You choose who can see
> your profile, and you can delete your account and personal data from inside the app at any
> time.
>
> **Open and independent**
> Timebank Global is free software under the AGPL-3.0 licence — no advertising and no sale
> of personal data. Essential security, push-notification and crash-diagnostic services are
> disclosed in our Privacy Policy. The source code is public.
>
> Your community may need to approve your membership before you can sign in. You must be 18
> or over to join.

**Category:** Social (alternative: Lifestyle). **Tags:** community, volunteering, local.
**Support email:** use the address recorded in the gitignored private Play Console values
file; it is the same address already published on the live contact page and was verified
2026-08-26. **Website:** `https://timebank.global/contact`
**Privacy policy URL:** `https://timebank.global/privacy`
**Account deletion URL:** `https://timebank.global/account-deletion` (after deployment)
**Child-safety standards URL:** `https://timebank.global/child-safety` (after deployment)

### Play graphics — ready

| Asset | Requirement | Status |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit | ✅ `store-listing/play-icon-512.png`. 🔴 `assets/icon.png` is 1024², which Play rejects — that is why this exists |
| Feature graphic | 1024×500, no transparency | ✅ `store-listing/play-feature-graphic-1024x500.png`, drafted and verified to have zero transparent pixels |
| Phone screenshots | 2–8, 320–3840 px, maximum 2:1 ratio, JPEG or opaque 24-bit PNG | ✅ **Two full sets of 8**, prepared as opaque 1080×1920 PNGs in `store-listing/screenshots/{light,dark}/` |
| 7-inch tablet screenshots | 2–8, 320–3840 px, 16:9 or 9:16 | ✅ **3 genuine emulator captures**, prepared as opaque 1080×1920 PNGs in `store-listing/screenshots/tablet-7/` |
| 10-inch tablet screenshots | 2–8, 1080–7680 px, 16:9 or 9:16 | ✅ **3 genuine emulator captures**, prepared as opaque 2560×1440 PNGs in `store-listing/screenshots/tablet-10/` |

Both graphics are generated, so they can be changed by anyone:

```bash
cd mobile
npm run store:screenshots:prepare  # make captures Play-safe without cropping or stretching
npm run store:tablets:prepare -- --device 7-inch --source <maestro-takeScreenshot-dir>
npm run store:tablets:prepare -- --device 10-inch --source <maestro-takeScreenshot-dir>
npm run store:assets                # regenerate icon + feature graphic, then validate everything
npm run store:assets:check          # validate all Play assets without rewriting them
```

The feature graphic's source is `store-listing/feature-graphic.html` — ordinary HTML, rendered
at 1024×500 by the Playwright chromium the repository already installs. Edit the HTML, re-run
the script. It is a **draft by a developer, not a designer**: it says the right things in the
brand colour, and it will not embarrass the listing, but a designer would do better.

`ios.supportsTablet: false` in `app.json` applies only to the future iOS build. It does not
disable Android tablets and is not a reason to omit Android tablet listing artwork.

### The screenshots, and why they can be published

Captured 2026-08-25 from the **real release build against the live Partner Demo community** —
not mockups, not a development build. Full detail in
[`store-listing/screenshots/README.md`](../store-listing/screenshots/README.md); the essentials:

- Every person shown is fictional. Partner Demo has no real members; its 43 accounts are
  seeded and their photographs were generated and cleared for commercial use.
- The logo is Timebank Ireland's, used with the directors' agreement.
- **The privacy risk that had to be ruled out first** was cross-community content: this
  platform can share listings between communities, which could have put a real member's post
  into a public screenshot. It cannot happen here — sharing needs an active partnership AND
  the listing's owner to opt in per listing, and the member directory has no federation path
  at all. Measured on the day: zero federated listings, zero unresolvable members.
- Light or dark, both complete. Pick one and stay with it.
- The original 1080×2400 captures exceeded Google's 2:1 ratio and contained an alpha
  channel. The upload files are now 1080×1920 opaque 24-bit PNGs. The full screen was scaled
  proportionally and centred on colour-matched gutters; no app content was cropped.

🔴 **The demo community was edited to make this possible**, and it is worth knowing what
changed in case a partner walkthrough depended on the old wording:

- **All 20 listings rewritten.** Every title had begun "Timebank request:" — which the card's
  own chip already says — and several described testing the software ("sanity-check the
  listings demo flow", "test three AI support questions"). Titles, descriptions and the
  "Partner Demo Hub" placeholder locations are now ordinary community wording set across West
  Cork.
- **Six requests became offers.** A board of 19 requests and 1 offer reads as a queue of
  people wanting things; half the point of a timebank is what people will give. Now 8 offers
  and 12 requests.
- **31 member locations fixed** — they had been "Data room", "Volunteer desk", "Access lab".
- **One listing deleted**: its owner was not a member of this community, so it rendered as
  "Unknown" whatever the app did.

Originals are archived in `.local-docs-archive/partner-demo-2026-08-25/` (gitignored) and
every field can be put back.

## App access / reviewer credentials — ready to enter

Choose **"All or some functionality is restricted"**. Enter:

> Open the app, choose **Partner Demo**, and sign in with the reviewer email and password
> supplied in the private reviewer-credentials record. No one-time code, two-factor prompt,
> payment, invitation or location restriction is required. The account contains fictional
> demonstration data and has access to the member experience.

The private source of truth is `.secrets.local/demo-login.env` (`DEMO_EMAIL` and
`DEMO_PASSWORD`); never paste those values into this public document or commit them. The
credentials were tested against the live production login endpoint on 2026-08-26, returned
the Partner Demo tenant and an admin role, and the temporary verification session was logged
out. Copy the values directly into Play Console when the form becomes available.

## Data Safety form — ready-to-enter answers

Answer "Yes" to data collection and "Yes" to encryption in transit (HTTPS everywhere, with
certificate pinning in release builds). Answer **"Yes"** to *"Do you provide a way for users
to request that their data be deleted?"* — as of 2026-08-25 that is true in the app itself.

| Data type | Collected | Required? | Purpose | Shared |
| --- | --- | --- | --- | --- |
| Name | Yes | Required | Account, appearing in the community | No |
| Email address | Yes | Required | Account, sign-in, notifications | No |
| Phone number | Yes | Optional | Contact between members, arranged exchanges | No |
| Address / approximate location | Yes | Optional | Finding nearby offers and requests | No |
| Precise location | Yes | Optional | Only when the member asks to search nearby | No |
| Photos | Yes | Optional | Profile photo, listing and marketplace images | No |
| Messages | Yes | Required for messaging | Member-to-member conversations | No |
| App activity | Yes | Required | Exchanges, events, groups, credits | No |
| Payment info | Yes | Optional | Marketplace purchases only — handled by Stripe; no card details reach our servers. Identity verification is hidden in the app (see above), so no fee is charged here | Processor only |
| Device ID (push token) | Yes | Optional | Sending push notifications | Processor only (Expo/FCM) |
| Crash logs / diagnostics | Yes | Optional | Diagnosing faults and app reliability | Processor only (Sentry) |

Declare **no data is shared for advertising or marketing**, because none is. Declare that
data is **not sold**. There is no third-party analytics SDK in the app, so nothing else needs
mentioning — but if that ever changes, this table has to change with it before the next
release. The public deletion route is `https://timebank.global/account-deletion`; it links
to a prefilled public request form and discloses what is deleted and retained. Account
deletion is also available inside the app.

## Child-safety declaration — ready after the public page is deployed

Because the app is in Play's Social category, complete this declaration even though the
target audience is adults only. Use `https://timebank.global/child-safety` as the published
standards URL and the verified Timebank Global contact address as the designated contact.

The certifications are supported by shipped behaviour and policy:

- in-app Report controls exist on profiles and user-generated content;
- the public standard explicitly prohibits CSAE and CSAM;
- reports are prioritised for human safeguarding review;
- confirmed content is removed and involved accounts can be suspended or removed; and
- apparent CSAM and credible exploitation concerns are escalated to competent authorities,
  including NCMEC where applicable or legally required.

## Content rating questionnaire (IARC) — ready-to-enter answers

- App or game: **App**. Target audience: **18 and over**. Ads: **No**.
- Violence, sexual content, profanity, drugs, gambling: **No** to all.
- **Users can interact:** Yes — messages, comments, posts, groups.
- **Users can share their location with other users:** Yes (approximate, and only if they
  choose to).
- **Users can share personal information:** Yes — a profile, and free-text messages.
- **User-generated content is present:** Yes, with reporting and blocking available.
- **Does the app contain purchases?** Yes — buying second-hand goods from other members in
  the marketplace, which is a physical-goods purchase between two people. There is no digital
  purchase and no identity-verification fee in the app (see the payments section above), and
  time-credit donations move no money.

The rating is assigned by IARC; do not promise a particular result. Answer these honestly
even if the interactive-element flags produce a stricter rating.

## Production dependency audit — reviewed exception, new findings fail the build gate

`npm audit --omit=dev` currently reports ten high-severity package entries, but they all
trace to two denial-of-service advisories in `image-size`, inherited through Expo's Metro
build tooling. There is no patched `image-size` release as of 2026-08-26. The affected parser
is used while Metro processes repository-controlled assets during a build; it is not shipped
as an app endpoint and cannot parse member-uploaded images at runtime. Forcing the suggested
Expo 57 / React Native upgrade would be a breaking framework migration, not a responsible
patch for this release.

Run `npm run audit:production`. The gate accepts only the two reviewed advisories and their
known Metro/Expo dependency chain; any new advisory, unexpected affected package, or critical
finding fails. Re-review by **2026-09-30**, on the next Expo SDK 54 maintenance update, or as
soon as a patched upstream version appears — whichever comes first. This is a documented
risk acceptance, not a claim that `npm audit` is clean.

---

## First-submission history and the next-release handoff

1. ~~Wait for Play to finish developer-identity verification~~ — **done 2026-08-26**.
2. ~~Create, download and back up the Play upload keystore~~ — **done 2026-08-27**. EAS default
   `ElecXcPY2S` and its local ignored credential backup match. The local JKS was re-verified
   at the ignored path above on 2026-08-27, then copied to verified unencrypted offline and
   encrypted offline/cloud recovery locations. Do not create another key.
3. ~~Decide the identity-payment question~~ — **done 2026-08-25**: hidden in the app.
4. ~~Sentry project and build credentials~~ — **done 2026-08-25**, verified end to end.
5. ~~Build a real signed bundle~~ — **done 2026-08-26**: version `1.2.0`, version code `5`,
   built locally without consuming EAS quota and verified against the new default key.
6. ~~Upload through Internal and Closed testing, then release to Production~~ — **done
   2026-08-26**. The public Play page shows an Install action, production listing, rating,
   Data Safety panel and 24 screenshot entries.
7. **Before the next upload:** bank the community-picker and tablet-asset work in green CI,
   produce a new signed version, then walk that exact Play-distributed artefact on a physical
   phone as both a clean install and an upgrade from the public version.
8. Add a submission service account only if automated uploads become useful; it is not needed
   for manual Play Console releases.

## What is still missing, plainly

- **A Play-distributed real-phone walk of the exact next release.** The public build predates
  the neutral first-install community picker. The next artefact must prove clean install,
  remembered-community upgrade, signed-in return, push, one exchange and disposable account
  deletion before rollout.
- ~~**An encrypted/offline copy of the local EAS credential backup.**~~ **Completed
  2026-08-27**, including an unencrypted offline recovery copy, matching header-encrypted
  offline/cloud archives, byte comparisons, a passworded integrity test and recovery notes.
- **Correct the live full description before another release.** It currently says “No money
  changes hands and nothing is ever put behind a payment”, which contradicts optional
  purchases of physical marketplace goods. Use the truthful prepared paragraph above:
  time-credit exchanges involve no money; physical-goods payments may use Stripe.
- ~~**Bank the current working tree and confirm CI.**~~ Done 2026-08-27 as `4c38d229a`;
  all six workflows are green. This banks source/test evidence, not a new Play artefact.
- Nothing on crash reporting. Project, DSN, cloud build variables, source-map upload and
  the nightly sweep are all in place and verified.
- iOS: entirely out of scope. No Apple developer account, no build, no walk.
