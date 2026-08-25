# Google Play submission — everything prepared, and the parts only the owner can do

Last reviewed: 2026-08-25

The owner's Play developer account is submitted and awaiting identity and phone verification
(2026-08-25). This page holds everything that could be prepared *without* that account, in
the order it will be needed, plus the exact commands and the two decisions that cannot be
made on someone else's behalf.

Nothing here is a claim that the app is ready to publish. Read
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
| Public privacy policy | `https://app.project-nexus.ie/privacy` → 200. 🔴 The page's text is drawn by JavaScript: a human reviewer in a browser sees it, a plain fetch sees an empty shell |
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

## Decision 1 (owner, one-way): the upload key

Release builds are currently signed with the **debug keystore** — the Expo template's
default (`release { signingConfig signingConfigs.debug }`). Play will not accept that.

This is the one genuinely irreversible step in the whole process:

- The signing identity can never be changed afterwards.
- Losing the key file means never being able to update the app again.
- A device refuses to install a differently-signed build over an existing one, so anyone
  holding a sideloaded APK must uninstall before moving to a store build.

Two ways to hold the key, and the choice matters more than the commands:

**A. Let EAS hold it (recommended for one maintainer).**

```bash
cd mobile
npx eas-cli@latest credentials          # Android → production → set up a new keystore
npx eas-cli@latest credentials          # then: download a backup copy and store it offline
```

EAS generates and stores the keystore; the backup download is the part people skip and
regret. Put the downloaded `.jks` **and** its passwords in the same place as the other
platform secrets, and treat it as unrecoverable-if-lost.

**B. Generate it locally and upload it.**

```bash
keytool -genkeypair -v -storetype JKS -keystore nexus-upload.jks \
  -alias nexus-upload -keyalg RSA -keysize 4096 -validity 10000
```

Then attach it in `eas credentials`. Choose this if you want the key never to exist only on
someone else's servers.

Either way, also switch on **Play App Signing** in the console (it is the default for new
apps): Google then holds the *app* signing key and your upload key can be replaced if it is
ever lost. That single setting removes most of the fear above — with it on, losing the upload
key is recoverable; without it, it is not.

## Decision 2 (owner): the Play service account, for automated submission

`eas.json` already points at a key file that does not exist:

```json
"submit": { "production": { "android": {
  "serviceAccountKeyPath": "./google-play-key.json", "track": "internal" } } }
```

Once the developer account is verified: Play Console → Users and permissions → invite a
service account created in Google Cloud, grant it release permissions, download its JSON
key to `mobile/google-play-key.json`. **That path is gitignored — confirm it before saving
the file, because the repository is public.** Until it exists, `eas submit` cannot run and
the first upload has to be done by hand in the console, which is perfectly fine for a first
release.

---

## Crash reporting — two secrets, and why the build depends on them

Right now: `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '', enabled: !!dsn })`,
and no build profile sets that variable — so crash reporting is **off in every build**.

The org exists (`hour-timebank-clg`, EU region) with PHP and React projects; there is **no
mobile project yet**. `app.json` now names the org, `nexus-mobile` as the project and the EU
host, so once that project is created nothing else needs editing:

```json
["@sentry/react-native/expo", {
  "organization": "hour-timebank-clg", "project": "nexus-mobile",
  "url": "https://de.sentry.io/"
}]
```

Owner steps, in order:

1. Create the `nexus-mobile` project in Sentry (Platform: React Native).
2. `npx eas-cli@latest secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "<the DSN>"`
3. `npx eas-cli@latest secret:create --scope project --name SENTRY_AUTH_TOKEN --value "<a token with project:releases>"`
4. Remove `"SENTRY_DISABLE_AUTO_UPLOAD": "true"` from the **production** profile in
   `eas.json` only. Keep it in development/local-emulator/preview/staging/website — those
   builds have nothing to upload to and would fail, as proven above.
5. Add `SENTRY_PROJECT_MOBILE=nexus-mobile` to `.secrets.local/sentry.env` so the nightly
   triage sweep picks the project up (`scripts/sentry-triage.mjs` already has the slot).

Until then, crash visibility is **not zero, but it is partial**: the app posts JavaScript
errors to `POST /api/app/log`, which logs at `error` level into the PHP Sentry project, so
they surface in the nightly sweep under `php`. What is lost is anything that kills the app
before JavaScript can report — native crashes, startup failures — which is exactly the class
a first public release produces.

---

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
> sides. No money changes hands and nothing is ever put behind a payment.
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
> Timebank Global is free software under the AGPL-3.0 licence — no ads, no tracking, and no
> selling of anyone's data. The source code is public.
>
> Your community may need to approve your membership before you can sign in. You must be 18
> or over to join.

**Category:** Social (alternative: Lifestyle). **Tags:** community, volunteering, local.
**Contact details:** support email and the website — owner to confirm which address.
**Privacy policy URL:** `https://app.project-nexus.ie/privacy`

### Graphics still needed

| Asset | Requirement | Status |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit | ✅ `store-listing/play-icon-512.png`. 🔴 `assets/icon.png` is 1024², which Play rejects — that is why this exists |
| Feature graphic | 1024×500, no transparency | ✅ `store-listing/play-feature-graphic-1024x500.png`, drafted and verified to have zero transparent pixels |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px | ❌ **Not produced, deliberately** — see below |
| Tablet screenshots | optional | ❌ Not captured; the app has never been walked at tablet width |

Both graphics are generated, so they can be changed by anyone:

```bash
cd mobile
npm run store:assets         # rewrite both from assets/icon.png + store-listing/feature-graphic.html
npm run store:assets:check   # size, format and transparency only — no rewrite
```

The feature graphic's source is `store-listing/feature-graphic.html` — ordinary HTML, rendered
at 1024×500 by the Playwright chromium the repository already installs. Edit the HTML, re-run
the script. It is a **draft by a developer, not a designer**: it says the right things in the
brand colour, and it will not embarrass the listing, but a designer would do better.

**Why no screenshots.** The only community on this machine is the development fixture, so
every screen shows test members and test listings ("E2E User", "Disposable Walker"). Those
are fine for judging layout and wrong for a public shop window — and a listing screenshot is
the single most-looked-at asset there is. Take them from a real community with real content,
with `npm run screenshot:tour` (the harness drives the emulator through the screens and
saves 1080×2400 PNGs, which Play accepts as-is).

🔴 The screenshot drafts were captured from the **development fixture community**, so they
show test members and test listings. Fine for judging layout, wrong for a public listing:
either populate a presentable community first or curate which screens are used.

---

## Data Safety form — drafted from the code, not from memory

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
| Crash logs / diagnostics | **Only once Sentry is switched on** | Optional | Diagnosing faults | Processor only |

Declare **no data is shared for advertising or marketing**, because none is. Declare that
data is **not sold**. There is no third-party analytics SDK in the app, so nothing else needs
mentioning — but if that ever changes, this table has to change with it before the next
release.

## Content rating questionnaire (IARC) — draft answers

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

Expect a rating around PEGI 3 / ESRB Everyone with "users interact" and "shares location"
interactive-element flags. Answer these honestly even though a stricter rating results:
a wrong answer here is grounds for removal later.

---

## The order of work once the account is verified

1. Owner: Play App Signing on, upload key created **and backed up** (Decision 1).
2. ~~Decide the identity-payment question~~ — **done 2026-08-25**: hidden in the app.
3. Owner: Sentry `nexus-mobile` project + the two EAS secrets, then production
   auto-upload back on.
4. Build a real signed bundle: `cd mobile && npm run build:android:play`
   (`eas build --platform android --profile production`, which already produces an AAB and
   increments the version code).
5. **Install that exact artefact on a real phone and walk it.** Nothing store-signed has
   ever been installed; every walk so far has used development or debug-signed builds. At a
   minimum: sign in, post something, delete a throwaway account, and confirm push arrives.
6. Listing, Data Safety, content rating, and the feature graphic.
7. Internal testing track first — `npm run submit:android:internal` once the service account
   key exists, or upload by hand — then closed testing, then production.

## What is still missing, plainly

- A signed build, and therefore any evidence that a store build works.
- A feature graphic, and screenshots that are not of test data.
- Crash reporting, until the Sentry project exists.
- iOS: entirely out of scope. No Apple developer account, no build, no walk.
