<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Testing the Mobile App

Last reviewed: 2026-08-18

How to verify a change to the Expo client, what each check actually proves, and
which parts genuinely cannot be tested on this workstation.

The mobile app *is* harder to test than the rest of the platform, and it is worth
being precise about why, because two of the three reasons are fixable and one is
not:

1. **There is no browser.** Every other surface can be opened, poked and
   inspected in seconds. A native app needs a device or an emulator, a build, and
   a running API — so the loop is minutes, not seconds. *Not fixable; only
   shortened.*
2. **Jest mocks exactly the parts that break.** Storage, sockets, payments, push
   and navigation are all replaced with stubs, so the suite is strongest where
   the risk is lowest. *Fixable — see the missing layers below.*
3. **iOS cannot be built here at all.** The workstation is Windows. *Not fixable
   without a Mac or a cloud build.*

Reason 1 is now much less painful than it was: the Android toolchain is installed
and an emulator boots headless in about a minute (see below). It was previously
impossible here.

---

## The fast loop — run this on every change

From `mobile/`. Nothing here needs a device, an emulator or a running API.

```bash
npm run type-check                  # tsc --noEmit, strict
npm test                            # 271 suites / 1,694 tests
npm run lint                        # expo lint
```

**Run it in parallel locally. It is 4x faster and the results are identical.**
Measured on this workstation (Ryzen 9 9950X3D, 16c/32t) on 2026-08-18:

| Mode | Wall clock | Result |
| --- | --- | --- |
| `npx jest` (parallel, the default) | **16s** | 263 suites / 1,563 tests passed |
| `npx jest --runInBand` | 71s | 263 suites / 1,563 tests passed |

(Measured at 263/1,563; the suite is now 271/1,694 and the ratio holds.)

Same pass counts both ways, so nothing is being skipped to get the speed. This
matches the platform-wide retirement of the old "never run more than one heavy
suite" rule — that rule existed for a 16 GB machine that no longer exists.

🔴 **CI runs `--runInBand`** (`ubuntu-latest` is 4 vCPU, where parallel buys
little). So when you are *reproducing a CI failure*, reproduce it the way CI
produced it — a test that only fails serially is a real ordering bug, not noise.

To run one screen while iterating:

```bash
npx jest app/\(modals\)/wallet.test.tsx
npx jest lib/api/events.test.ts
```

---

## The drift checks — run before a release, and after any API change

These are the new anti-drift layer. They catch the class of bug the unit suite
structurally cannot: the API moved, or the web app grew a feature.

```bash
npm run coverage:check              # coverage + per-area shrink-only ratchet
npm run parity:check                # every React member route has a mobile decision
npm run api:check                   # every endpoint mobile calls still exists
npm run drift:check                 # parity + api together
```

### Refreshing the route inventory

`api:check` verifies against a committed snapshot of Laravel's real routes,
because the mobile CI runner has no PHP. When the API's routes change, refresh it:

```bash
npm run api:routes                  # needs the local app container running
```

If the snapshot is stale, `api:check` prints **UNVERIFIED**, names the route files
that moved, and exits `2`. It never reports a pass on data it could not check.
That is deliberate — a stale drift checker that reports safety is worse than no
drift checker.

### What these prove, and what they do not

| Check | Proves | Does not prove |
| --- | --- | --- |
| `api:check` | The path and verb exist in Laravel | That the response *shape* matches — 74 call sites also build their endpoint at runtime and are reported as unverifiable |
| `parity:check` | Every React member route has a recorded decision | That a `native` screen is any good, only that it exists |
| `coverage:ratchet` | No area went backwards | That the covered lines assert anything useful |

---

## The full release baseline

```bash
npm run verify:release              # OTA policy — BLOCKING in CI
npm run type-check
npm run coverage:check              # runs the suite WITH coverage, then the ratchet
npx expo-doctor
npm run drift:check
```

`coverage:check` runs the suite itself, so there is no need to run `npm test`
separately before it — that is why CI runs it instead of the plain suite.

A timeout, a non-zero exit, an open-handle failure or a generated-native-policy
mismatch is **not** a pass. Say "it could not run" rather than reporting green.

---

## Running the app on a device

### Android emulator — installed and working

The full native toolchain is installed and verified (2026-08-18):

| Piece | Where | Verified by |
| --- | --- | --- |
| Android Studio | `C:\Program Files\Android\Android Studio` | was already installed |
| SDK | `%LOCALAPPDATA%\Android\Sdk` (~8.2 GB incl. NDK + CMake) | `sdkmanager --list` |
| Platform / build tools | API 36, build-tools 36.0.0 | `adb version` → 1.0.41 |
| Emulator + system image | `android-36;google_apis;x86_64` | booted to `sys.boot_completed=1` |
| AVD | `nexus_test` (Pixel 7, 4 GB RAM) | `emulator -list-avds` |
| Maestro | `~/.maestro/bin` | `maestro -v` → 2.8.0 |

🔴 **Android Studio was installed all along; the SDK had never been downloaded.**
`ANDROID_HOME` pointed at a directory that did not exist, and `platform-tools` was
already on PATH for that missing directory — so every path looked configured while
nothing was actually present. Check that the directory *exists*, not just that the
variable is set.

Start the emulator headless and wait for it properly:

```bash
emulator -avd nexus_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 5; done
adb devices          # emulator-5554  device
```

`-gpu swiftshader_indirect` renders on the CPU. That is slower than the host GPU
and **deliberate**: software rendering is deterministic, so a graphics-driver
update cannot shift pixels and produce phantom screenshot differences. The AVD
config pins the same setting.

### Screenshot testing

```bash
npm run emulator:start                     # boots and WAITS for sys.boot_completed
npm run screenshot:capture                 # writes screenshots/current/light/
npm run screenshot:capture -- --scheme dark
npm run screenshot:compare                 # fails if a screen changed
npm run screenshot:approve                 # promote current to baseline
```

🔴 **Use a RELEASE build, not a debug build.** A debug APK loads its JavaScript
from Metro at runtime. If the emulator cannot reach the dev server the app shows a
bare background colour and nothing else — and a capture of that will happily
become a baseline, at which point every later comparison is meaningless. A release
APK has the bundle inside it and needs no server:

```bash
SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew.bat app:assembleRelease -x lint -x test
adb install -r app/build/outputs/apk/release/app-release.apk
```

This is not a workaround — no dev server is the correct architecture for visual
testing, in CI or locally.

**Determinism is measured, not hoped for.** Two independent captures of the same
screen differ by **0 pixels** (verified 2026-08-18, both schemes). Three things buy
that, and all three matter:

| Pinned | Why |
| --- | --- |
| `swiftshader_indirect` (CPU rendering) | A host GPU driver update would otherwise shift pixels and produce phantom diffs |
| Animation scales set to 0 | Stops a capture landing mid-transition, which reads as an intermittent regression |
| Status bar cropped (top 96px) | Its clock changes every run. Cropping is honest; a loose global threshold would also hide real regressions |

**Sensitivity is measured too.** Comparing a dark-mode render against a light-mode
baseline reports **97.4% of pixels changed** and exits 1. A gate that cannot fail
is decoration, so both directions were checked.

🔴 **Never `approve` without looking at the image.** That is precisely how a visual
bug becomes the baseline and stops being reportable. The first baselines here were
each viewed before being promoted.

Raw capture, if you want one by hand:

```bash
adb exec-out screencap -p > shot.png
```

🔴 `expo run:android --device emulator-5554` fails with
`Could not find device with name`. Omit `--device` when one emulator is running.

🔴 **A local `assembleRelease` fails on the Sentry sourcemap upload** unless you
disable it:

```text
error: An organization ID or slug is required (provide with --org)
> Task :app:createBundleReleaseJsAndAssets_SentryUpload_... FAILED
```

The JS bundle itself builds fine — only the upload step fails, because there is no
Sentry org configured locally. Every profile in `eas.json` already sets
`SENTRY_DISABLE_AUTO_UPLOAD=true` for exactly this reason; do the same by hand:

```bash
SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew.bat app:assembleRelease -x lint -x test
```

Debug builds are unaffected — they do not upload sourcemaps, which is why
`expo run:android` succeeds and `assembleRelease` does not.

**Build only the architecture the emulator uses.** `expo run:android` defaults to
`x86_64,arm64-v8a`, which compiles the native C++ in reanimated, worklets and
expo-modules-core **twice**. An x86_64 emulator cannot run the arm64 slice, so on a
first build that is a large amount of wasted compilation — it roughly doubles the
long pole. Set it once in `android/gradle.properties`:

```properties
reactNativeArchitectures=x86_64
```

Keep both architectures for anything destined for a real device or a store build.
`android/` is generated and gitignored, so this is a local-only change that
`expo prebuild --clean` will discard.

🔴 **Build with JDK 17, NOT Android Studio's bundled JDK.** Studio ships JBR 25,
and Gradle 8.14.3 (what `expo prebuild` generates) rejects it outright:

```text
BUG! exception in phase 'semantic analysis' ... Unsupported class file major version 69
```

"Major version 69" is Java 25. Adoptium JDK 17 is installed at
`C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot` and is what the
persisted `JAVA_HOME` points at — so a fresh shell is correct by default. Only an
explicit `JAVA_HOME=...Android Studio\jbr` breaks it, which is an easy mistake to
make precisely because that JDK is the one sitting next to the SDK.

### Pointing the emulator at the local API

The emulator reaches the host through `10.0.2.2`, not `localhost`.

🔴 `.env.local` on this machine pointed at **port 8088**, where nothing listens.
The Docker API is on **8090**. Corrected 2026-08-18. `.env.local` is gitignored, so
each machine can carry its own stale copy of this mistake — check the port against
`docker ps` before concluding the app cannot reach the API.

```bash
cd mobile
cp .env.example .env.local
# EXPO_PUBLIC_API_URL=http://10.0.2.2:8090
npm start                           # then press `a`
```

The API must be up: `npm run dev:docker` from the repository root.

### Physical Android device on the LAN

Set `EXPO_PUBLIC_API_URL=http://<your-computer-ip>:8090` and scan the QR code
with Expo Go.

### Against production

`EXPO_PUBLIC_API_URL=https://api.project-nexus.ie`. Read-only exploration only —
this is the live members' database.

### iOS

🔴 **Not possible on this workstation.** iOS builds need macOS with Xcode. The
options are a Mac, or an EAS cloud build (`eas.json` has iOS resource classes
defined, though `submit.production.ios.ascAppId` is still a placeholder). Until
one of those happens, no iOS claim is verified by anything — see
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §10.

---

## Maestro end-to-end flows

Nine flows in `.maestro/` drive the real app on a real device or emulator: login,
logout, browse listings, browse groups, view events, messages, profile/explore,
search, registration. Flows `03`–`08` re-authenticate inline, so any of them can
run alone.

```bash
maestro test .maestro/
maestro test .maestro/01-auth-login.yaml
maestro test --env TEST_EMAIL=user@example.com --env TEST_PASSWORD=secret .maestro/
```

Credentials are always injected with `--env` and never written into a flow file.

**Maestro is installed and runs natively on Windows** — `~/.maestro/bin/maestro.bat`,
version 2.8.0, on the user PATH. Verified 2026-08-18.

🔴 This document previously said Windows needs WSL2, echoing Maestro's own install
page. That is **not true for the 2.x release**: the distributed archive ships a
working `maestro.bat`, it finds the system JDK, and `maestro -v` returns `2.8.0`
with no Linux subsystem involved. Do not install a second copy inside WSL2 on the
strength of the docs — check the `.bat` first.

🔴 **Nothing runs these flows automatically.** They are operator-run. A green CI
run is no evidence that the app launches on a device. What has changed is that
they *can* now be run here at all — see the emulator section below.

🔴 `.maestro/config.yaml` refers to `.github/workflows/mobile-eas-build.yml` for
CI configuration. **That workflow does not exist** and never has. The real mobile
CI job is `mobile-release` in `.github/workflows/ci.yml`. Do not go looking for
the other file.

---

## What CI actually runs

`mobile-release` in `.github/workflows/ci.yml`, feeding `release-gate`. It wakes
on the `mobile` filter in `.github/ci-paths.yml` — `mobile/**` *and*
`contracts/**`, the latter added because a shared contract change must reach every
consumer.

Steps, all blocking:

1. `npm ci`
2. `npm run verify:release`
3. `npm run type-check`, then the suite **with coverage** (`--runInBand`) followed
   by the coverage ratchet, then `npx expo-doctor`
4. `npm run drift:check` — route parity and API contract
5. `expo prebuild --platform android`, then assert the network security config is
   referenced, pins `api.project-nexus.ie`, and uses SHA-256 digests

The suite runs **once**, under coverage. Running it plain and then again for
coverage would have doubled the job for no extra signal.

🔴 **A green tick is not proof the mobile job ran.** `ci.yml` skips jobs whose
area looks untouched, and `release-gate` treats a *skipped* need as passing. The
nightly 03:30 UTC sweep forces every job, which is where full mobile evidence
usually comes from.

---

## The layers that do not exist yet

Being explicit, so nobody assumes coverage that isn't there:

| Missing layer | What ships unnoticed without it |
| --- | --- |
| Visual regression | Any layout break. No snapshot, screenshot or diff testing exists. |
| E2E in CI | The app failing to launch, or login breaking. |
| iOS build | Everything iOS-specific. |
| Contract-shape tests beyond Events | A response whose *fields* changed. Only `contracts/events/v2/` is shared and asserted. |
| Offline scenarios | Connection loss mid-request; queue replay. |
| Performance budget | Startup and scroll regressions. |
| Accessibility gate | A new screen with no labels. |
| Post-release crash watch | A crash introduced by an OTA update. |

---

## Traps worth knowing

- **Never run mobile Jest from the repository root.** It has its own
  `node_modules`, resolver and jest-expo preset. Always `cd mobile`.
- 🔴 **The mobile API client DOES throw — do not carry the React frontend's rule
  across.** `react-frontend`'s `api.ts` never throws, so a `catch` around a call
  there is usually dead code hiding a missing `res.success` check. `mobile/lib/api/client.ts`
  is a different implementation: it throws `ApiResponseError` on a non-2xx
  response, on a network failure, on a timeout, and on an unrecoverable 401
  (after one silent refresh attempt). So `try { await api.put(...) } catch { return false }`
  in a mobile API module is **working error handling, not dead code.** Deleting
  those blocks would convert a failed request into a reported success. Assert on
  a rejected promise in mobile tests, not on a falsy result field.
- **Coverage needs `collectCoverageFrom`.** Without it Jest only instruments what
  a test imported, so an entirely untested file leaves the report instead of
  lowering the number. It is configured now — do not remove it.
- **A `.strict()` Zod schema throws at runtime**, not at compile time. The agenda
  schema sat broken for weeks in 2026-08 because nothing woke the mobile job on a
  `contracts/**` change.
- **Mobile carries 7 locales, the platform 11.** A new key needs `en de es fr ga
  it pt` — do not copy the 11-locale process from the web side.
- **Do not add `Alert.alert`.** Use `useAppToast()` and `useConfirm()` — see
  [NATIVE_UI_CONTRACT.md](NATIVE_UI_CONTRACT.md).

---

## Related documents

| Guide | Purpose |
| --- | --- |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | The readiness rubric and current score |
| [HEROUI_NATIVE_PARITY_AUDIT.md](HEROUI_NATIVE_PARITY_AUDIT.md) | Product-area parity judgement |
| [generated/mobile-parity-matrix.md](generated/mobile-parity-matrix.md) | Route-level parity, machine-generated |
| [generated/mobile-api-consumer-ledger.md](generated/mobile-api-consumer-ledger.md) | Endpoints consumed, machine-verified |
| [WRAPPER_POLICY.md](WRAPPER_POLICY.md) | Wrapper-versus-primitive rules |
| [SECURITY.md](SECURITY.md) | Tokens, pinning, OTA policy |
| [DISTRIBUTION.md](DISTRIBUTION.md) | Store identity and release channels |
| [../.maestro/README.md](../.maestro/README.md) | Maestro setup and flow index |
