# Timebank Global mobile distribution

Last reviewed: 2026-07-14

This file records the release identity and distribution decisions for the native mobile app.

## App identity

| Item | Value |
|------|-------|
| Store listing title | Timebank Global |
| Installed app name | Timebank Global |
| Publisher / developer | Jasper Ford - Project NEXUS |
| Android package ID | ie.project.nexus |
| iOS bundle ID | ie.project.nexus |
| Download site | https://mobile.project-nexus.ie |

The package and bundle IDs are permanent release identifiers. Do not change them after public distribution unless intentionally shipping a separate app.

## Domain roles

| Domain | Purpose |
|--------|---------|
| https://mobile.project-nexus.ie | Public mobile download landing page only |
| https://app.project-nexus.ie | Web app and app/deep-link target |
| https://api.project-nexus.ie | Production API |

The mobile download domain is not an app-link domain and does not need API interaction.

## Android packaging

Use both Android package formats:

| Channel | Format | EAS profile |
|---------|--------|-------------|
| Website download | Signed APK | `website` |
| Google Play | Android App Bundle (AAB) | `production` |

Commands:

```bash
cd mobile
npm run build:android:website
npm run build:android:play
```

The profile name describes the distribution channel, not the target device. The `website` profile is still an Android build; it produces a signed APK because website/direct Android installs need APK files. The `production` profile produces an AAB because Google Play expects Android App Bundles.

## EAS project and credentials

| Item | Value |
|------|-------|
| Expo/EAS account | `timebank-global` |
| EAS project | `@timebank-global/nexus-mobile` |
| EAS project ID | `90f411f3-b6b4-4251-85ad-00937bb0513d` |
| Android application identifier | `ie.project.nexus` |
| EAS build credential | `b8UXpzut1O` |
| Keystore type | EAS-managed JKS |
| Keystore SHA1 | `29:86:3A:4E:69:B4:8E:D2:2B:41:E1:F0:69:F8:22:88:D3:16:48:13` |
| Keystore SHA256 | `F5:0D:87:55:56:B8:01:76:3D:89:B2:54:47:E7:CD:96:58:06:FE:43:96:1C:0B:46:12:2D:42:4E:0B:40:D9:7B` |

The table records the current production upload key, re-verified from the ignored local JKS
and `credentials.json` on 2026-08-27. The previous `02:F5:0F:55...` certificate is not the
current production upload credential. The EAS-managed keystore is shared by Android builds
for `ie.project.nexus`; it is not specific to the `website` profile. Both the direct-download
APK and the Google Play AAB use the same Android application identifier and signing identity.

Configured EAS credentials:

- Android keystore: configured and EAS-managed.
- Push Notifications (FCM V1): Google Service Account Key assigned to `ie.project.nexus`.
- Push Notifications (FCM Legacy): intentionally empty.
- Play Store submissions Google Service Account: not configured yet. Configure this later when submitting directly from EAS to Google Play.

EAS environment variables:

| Environment | Variable | Purpose |
|-------------|----------|---------|
| `preview` | `GOOGLE_SERVICES_JSON` secret file | Supplies Firebase config for `website` APK builds |
| `production` | `GOOGLE_SERVICES_JSON` secret file | Supplies Firebase config for Play Store AAB builds |

Credential setup commands used:

```bash
cd mobile
npx eas-cli@latest credentials -p android
npx eas-cli@latest env:create --environment production --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
npx eas-cli@latest env:create --environment preview --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
```

## Push notification prerequisites

Before release builds:

1. Create or update the Firebase Android app for package `ie.project.nexus`.
2. Download the matching `google-services.json`.
3. Place it at `mobile/google-services.json` for local/EAS builds.
4. Configure EAS Android FCM credentials.
5. Confirm the EAS project ID is available through `EAS_PROJECT_ID` or `EXPO_PUBLIC_EAS_PROJECT_ID`.
6. Build a new native binary; push, camera, and location changes cannot be delivered by OTA alone.

## Where a built APK can be put on the live server

🔴 **The real download folder is `uploads/downloads/`**, served at
`https://api.project-nexus.ie/uploads/downloads/<name>.apk`. Builds have been distributed
from there since at least June 2026 (`timebank-global-2026-06-12-v8.apk`), and that is
where the owner's phone downloads from.

🔴 **`config/mobile.php` advertises a DIFFERENT path that 404s.** Checked 2026-08-20:
`https://api.project-nexus.ie/downloads/nexus-latest.apk` returns **404** — the folder is
under `uploads/`, not at the web root. That dead URL is what the CAPACITOR client's
force-update prompt sends people to (`AppController::checkVersion`), so pulling that lever
today would send them nowhere. Left as a recorded finding rather than silently repointed,
because changing it changes what that app tells people to download — a decision, not a
chore.

🔴 **How this folder was missed, because the mistake is repeatable.** A first pass reported
"there is no downloads folder" after checking `/downloads/` and `httpdocs/downloads`, then
listing the uploads volume with `ls | head -8`. The volume's entries are tenant-id
directories, so the listing began `1, 11, 2, 4, 5, 6, 7, 8` — and `downloads` sorted just
past the cutoff. **A truncated listing was read as absence.** Never conclude "not there"
from a `head`-limited listing; grep for the name instead.

**Where a file CAN live durably.** The container's web root is baked into the image, so
anything written into `httpdocs/` is lost on the next deploy. `httpdocs/uploads` is
different: it is the `nexus-php-uploads` Docker volume, mounted by BOTH colours, so it
survives deploys and colour switches — and it is already served as static files.

```bash
# from the repo root, with .secrets.local/deploy.env loaded as in the deploy docs
scp -i "$PROD_SSH_KEY" mobile/android/app/build/outputs/apk/release/app-release.apk     "$PROD_SSH_HOST:/tmp/nexus-<version>-<random>.apk"
ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST"   "sudo mkdir -p /var/lib/docker/volumes/nexus-php-uploads/_data/builds &&    sudo mv /tmp/nexus-<version>-<random>.apk /var/lib/docker/volumes/nexus-php-uploads/_data/builds/ &&    sudo chown www-data:www-data /var/lib/docker/volumes/nexus-php-uploads/_data/builds/nexus-<version>-<random>.apk"
```

Served at `https://api.project-nexus.ie/uploads/builds/<name>.apk`, with content type
`application/vnd.android.package-archive`, so a phone offers to install it. Always verify
the served bytes against the local file (`sha256sum`) before installing — a truncated
upload installs as a corrupt app.

🔴 **Use a RANDOM filename, not a guessable one, while builds are debug-signed.** The debug
keystore's private key ships with Android Studio and is public, so anyone can sign a
different APK with the same key and a phone will accept it as an update over this one. An
unguessable path is what keeps a convenience link from being an attack surface. A guessable
public download waits on a real upload keystore — see the signing note below.

## Building an APK on this machine, without paying for a cloud build

```bash
cd mobile
npm run build:apk                                   # points at the live API
API_URL=http://192.168.1.36:8090 npm run build:apk  # or at this machine over the LAN
npm run build:apk -- --clean                        # wipe caches first
```

→ `android/app/build/outputs/apk/release/app-release.apk`

EAS cloud builds are billed per build, and for "put it on my phone and try it" there is
nothing a paid build does that Gradle here does not. Measured 2026-08-20: **1 m 36 s** for
an incremental release build, producing a **50 MB** APK with the 9.6 MB JavaScript bundle
embedded — so it runs standalone, with no Metro and no laptop attached. Verified by
installing it on the emulator with the dev server killed and every `adb reverse` rule
removed: it reached the production API and returned a real "Invalid credentials".

The paid service still earns its keep for **store submissions**, for builds from a clean
machine, and for anything needing a managed signing identity.

### 🔴 Signing — read before sharing an APK with anyone

The Expo/React Native template signs `release` with the **debug keystore**
(`android/app/build.gradle`: `release { signingConfig signingConfigs.debug }`). That is why
this needs no setup, and it is fine for sideloading onto your own phone.

It is not fine for anything else:

- Google Play will not accept a debug-signed upload.
- A device refuses to install a differently-signed build **over** it. Anyone given this APK
  must uninstall before moving to a properly signed one.
- 🔴 Generating a real upload keystore is a **one-way decision**: the signing identity can
  never change afterwards, and losing the file means never being able to update the app
  again. It needs a deliberate backup plan, so it is not done automatically here.

### Two traps this route has already hit

1. **The emulator's address in a real build.** `.env.local` normally holds
   `http://10.0.2.2:8090` — the emulator's name for this machine, meaningless on a phone.
   On 2026-06-12 that value was baked into a real build and every request timed out.
   `lib/constants.ts` now refuses a loopback URL when `__DEV__` is false, and the build
   script writes `.env.production.local`, which Expo loads ABOVE `.env.local`. Verified in
   the artefact: `api.project-nexus.ie` present, `10.0.2.2` absent.
2. **Stale certificate pins.** `android/` is gitignored and regenerated by prebuild, so the
   pins live in the source file and are copied in by the config plugin. The build script
   copies them itself, because a native project generated before a pin change would ship the
   old ones. Verified in the artefact: both current pins present, the retired leaf absent.

## Sending an update, and taking one back

```bash
cd mobile
npm run update:staging                                          # internal testers
NEXUS_APPROVE_WEBSITE_OTA=yes    npm run update:website          # public download build
NEXUS_APPROVE_PRODUCTION_OTA=yes npm run update:production       # store build
```

Publishing requires a **clean worktree**, and the two public channels also require **main**
— it ships the code in your tree, so an unreviewed change must not be able to leave.

```bash
npm run rollback:staging
NEXUS_APPROVE_WEBSITE_ROLLBACK=yes    npm run rollback:website
NEXUS_APPROVE_PRODUCTION_ROLLBACK=yes npm run rollback:production
```

🔴 **Rollback deliberately does NOT require a clean worktree or main.** It ships nothing
from your machine — it re-points a channel at an update EAS already has — and whoever runs
it is by definition mid-emergency, quite possibly with a half-written fix in the tree. It
does still require the per-channel approval variable, because a rollback is itself a
publish: it changes what every member's app runs, and that is the guard that stops one
meant for staging landing on production while someone is under pressure.

**A rollback is not instant.** It does not delete the bad update; members receive the
previous one on their next check, applied on the next cold start — or immediately, if they
accept the "Update ready" prompt (`components/ui/UpdateReadyHost.tsx`).

`npm run verify:release` asserts that every channel a build can be pinned to has **both** a
publish path and a rollback path, and that the two scripts have not drifted apart. A channel
you can break and cannot unbreak is worse than one you cannot publish to at all, because the
damage is already live.

## What an over-the-air update cannot do

`updates.checkAutomatically` is `ON_LOAD` with `fallbackToCacheTimeout: 0`, so the app
fetches a published update in the background and applies it on the **next cold start**. It
is silent unless the member accepts the "Update ready" prompt, so do not assume a published
fix is in use the moment it is published.

Anything native — permissions, push, camera, location, the certificate pins in
`android-network-security-config.xml` — needs a new binary. An OTA update cannot replace
packaged native configuration.

## Sentry source maps

The EAS build profiles currently set `SENTRY_DISABLE_AUTO_UPLOAD=true` so Sentry source-map upload cannot block APK/AAB packaging while Sentry organization/project/token values are not configured. Runtime Sentry reporting can still be configured separately. Re-enable source-map upload only after setting `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` in EAS.

## Website download page contents

The page at `https://mobile.project-nexus.ie` should include:

- Android APK download link.
- Version number and release date.
- File size and SHA-256 checksum.
- Short install instructions for Android "install unknown apps".
- Link to the Google Play listing when available.
- Privacy policy, support contact, and source/license links.
- A clear note that direct website download is Android-only.

## Google Play declarations that are already decided

The Play Console asks questions whose answers must match what the app tells its users.
These two are settled, so nobody has to guess at submission time:

- **Target audience: adults only, 18 and over.** Sign-up requires confirming you are 18 or
  older, and since 2026-08-25 the app's own sign-up form says so in all seven of its
  languages, matching the web and accessible frontends. Google Play's **Families policy
  therefore does not apply**, and the app must not be declared as targeting children.
  `node ../scripts/check-age-declaration.mjs` runs in the mobile CI job and fails if any
  sign-up form stops stating a minimum age — the declaration and the product cannot drift
  apart silently. Background and the open gaps (social sign-up makes no age statement; two
  tenants' terms documents contain no age clause) are in
  [../../docs/PRODUCT-AUDIENCE.md](../../docs/PRODUCT-AUDIENCE.md).
- **In-app account deletion exists (built 2026-08-25), so the hardest of these
  requirements is met.** Play requires that an app which lets people create an account
  lets them request deletion *inside the app*, not only on a website, and until this date
  the app had no such path at all — a certain rejection. It is at Settings → Account →
  Delete account (`app/(modals)/settings-delete-account.tsx`), calls the same
  `DELETE /v2/users/me` the web app calls, and performs a full GDPR Article 17 erasure
  rather than a deactivation. The Data Safety form's deletion question can be answered
  "users can request that their data be deleted" without qualification.
- **Guardian consent is not a child-facing feature.** The app contains guardian-consent
  screens for volunteering. They are for communities running supervised activity with young
  people whose accounts a coordinator sets up, the tenant setting is off by default, and no
  consent has ever been recorded in production. Describe it that way in the listing; do not
  present the app as a service for under-18s.
