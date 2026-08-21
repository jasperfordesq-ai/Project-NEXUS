<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Test Harness — how to walk a journey

Last reviewed: 2026-08-21

Status: **Maintained — the operating manual for proving a mobile journey**

Read this before touching a device. Everything here was learned by getting it wrong first,
and each 🔴 marks a trap that cost real time.

## Cold start — two accounts on two emulators

```bash
cd mobile
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"

# 1. Two emulators. The SAME AVD cannot run twice, so a second one exists.
"$ANDROID_HOME/emulator/emulator.exe" -avd nexus_test   -port 5554 -no-snapshot-load -no-boot-anim &
"$ANDROID_HOME/emulator/emulator.exe" -avd nexus_test_b -port 5556 -no-snapshot-load -no-boot-anim &
# Serials become emulator-5554 and emulator-5556; drive each with `adb -s <serial>`.

# 2. Point both at the local Laravel API.
for s in emulator-5554 emulator-5556; do
  adb -s $s reverse tcp:8090 tcp:8090
  adb -s $s reverse tcp:8081 tcp:8081
done
cat > .env.local <<'EOF'
EXPO_PUBLIC_API_URL=http://localhost:8090
EXPO_PUBLIC_APP_URL=http://localhost:5173
EXPO_PUBLIC_DEFAULT_TENANT=hour-timebank
EOF

# 3. Install the existing debug APK on both, then start Metro ONCE.
for s in emulator-5554 emulator-5556; do
  adb -s $s install -r android/app/build/outputs/apk/debug/app-debug.apk
done
npx expo start --port 8081

# 4. Launch each into the dev client.
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d "nexus://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

🔴 **A debug APK loads its JavaScript from Metro at runtime.** So the *native* APK can be
weeks old and both devices still run the source you are editing. Do not rebuild natively to
test a JavaScript change.

If `nexus_test_b` is missing:

```bash
echo "no" | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager.bat" create avd \
  --name nexus_test_b --package "system-images;android-36;google_apis;x86_64" --device pixel_7 --force
echo "hw.ramSize = 4096" >> "$HOME/.android/avd/nexus_test_b.avd/config.ini"
```

Two emulators need roughly 8 GB; this machine has 94 GB with ~17 GB free while Docker runs.

## Fixture accounts

| Account | id | Role | Password |
| --- | ---: | --- | --- |
| `e2e.user.a@project-nexus.local` | 674 | member (and owner of org 109) | `TestPassword123!` |
| `e2e.user.b@project-nexus.local` | 675 | member | `TestPassword123!` |
| `e2e.admin@project-nexus.local` | 676 | admin | `TestPassword123!` |

All in tenant 2 (`hour-timebank`). If a password fails, set one:

```bash
HASH=$(docker exec nexus-php-app php -r 'echo password_hash("TestPassword123!", PASSWORD_BCRYPT);')
docker exec nexus-php-db mysql -unexus -pnexus_secret nexus \
  -e "UPDATE users SET password_hash='$HASH' WHERE id=675 AND tenant_id=2;"
```

🔴 **The column is `password_hash`, not `password`** — both exist on `users`.
🔴 **Login needs `X-Tenant-Slug`, not `X-Tenant`.** With the wrong header the API answers
`AUTH_INVALID_CREDENTIALS`, which reads exactly like a wrong password and cost a diagnosis.
🔴 **The mobile login route is `/api/auth/login`**, not `/api/v2/auth/login`.

## Proving a journey

The standard is in [`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md): walk it on a
device, verify the **effect**, then say whether a test guards it.

```bash
# Watch what the app actually asks the API while you tap.
LOGSTART=$(date -u +%Y-%m-%dT%H:%M:%S)
# …tap…
docker logs --since "$LOGSTART" nexus-php-app 2>&1 | grep -oE '"(GET|POST|PUT) [^"]+"' | sort | uniq -c
```

🔴 **This is the single most useful instrument here.** It distinguished "the button does
nothing" from "the button works and the sheet does not render", and it caught a re-fetch
loop (`bootstrap` ×7, `users/me` ×8, `notifications/counts` ×16 in 40 seconds) that looked
like a hang.

Then confirm the effect in the database. Column names differ from the obvious guesses:

| Table | Note |
| --- | --- |
| `vol_organizations` | 🔴 The live table. `volunteering_organizations` exists, is empty and is dead — a code comment says so |
| `vol_org_transactions` | organisation ledger; the FK is `vol_organization_id`, not `organization_id` |
| `transactions` | member ledger; columns are `giver_id` / `receiver_id`, **not** `from_user_id` / `to_user_id`; no `hours` column — it is `amount` |
| `vol_certificates` | has `generated_at`, **not** `created_at` |
| `vol_expenses` | the category column is `expense_type`, not `category` |

## Testing screen width

```bash
adb -s emulator-5554 shell wm size 720x1600   # then
adb -s emulator-5554 shell wm density 320     # → 360dp wide
# undo, always:
adb -s emulator-5554 shell wm size reset; adb -s emulator-5554 shell wm density reset
```

🔴 **`wm density` alone silently stops working.** On a freshly booted emulator it reported
the override and the app kept rendering at 411dp — a reboot did not help. Setting **size and
density together** works. Verify by comparing two screenshots: if they differ only in the
status-bar clock, the override did not apply and any conclusion you draw is worthless.

🔴 **Always run the 411dp control.** Three of the five "width" defects found on 2026-08-20
were broken at *every* width and merely looked like width bugs. Filing one of them as a
narrow-screen fault would have left the sign-in screen broken on every phone with the ticket
marked fixed.

## The screen sweep

```bash
node scripts/screenshots.mjs sweep          # 33 screens via Maestro, for looking at
node scripts/screenshots.mjs compare        # the 3-screen pixel gate
```

🔴 The sweep could not reach **Notifications** until 2026-08-21 because that item sits
inside the collapsed "MY SPACE" accordion; it reported 31 of 33 and nobody noticed the two
missing. If a sweep reports fewer screens than it declares, find out which.

## Traps that cost time in the walking sessions

| Trap | What happens | Do this instead |
| --- | --- | --- |
| 🔴 `input keyevent 4` (back) to leave a screen | With nothing to dismiss it **exits the app to the Android launcher** — and the sweep flow's own header warns about this | Tap a tab or fire a deep link |
| 🔴 Editing source mid-walk | Metro fast-refreshes and **wipes a half-filled form** | Finish the walk, then edit |
| 🔴 `input keyevent 111` (ESC) | Can trigger a dev-client reload | Tap a neutral area to dismiss the keyboard |
| 🔴 Fixed tap coordinates after typing | The keyboard shifts the layout, so the next tap lands on the previous field. Two strings ended up in one field this way | Screenshot, locate, tap once |
| 🔴 `uiautomator dump` | Returns **zero nodes** on this app. It once nearly produced a false critical defect | Screenshots only |
| 🔴 Reading a screenshot 8 seconds after a tap | Toasts have already gone. "No error appeared" was wrong twice | Capture at ~1–2s **and** later |
| 🔴 A stale session on a device | Sat on a bare spinner in a re-fetch loop | `adb shell pm clear ie.project.nexus` and sign in again |
| 🔴 Piping a long build through `\| tail` | Buffers everything; the log looks empty while it works | Redirect to a file and read it |
| 🔴 Launching via the dev-client URL, then wondering why the app sits on a spinner | `Linking.getInitialURL()` returns `nexus://expo-development-client/?url=…`, the auth redirect treats it as a pending deep link, and navigation goes nowhere. Cost 20 minutes and looked like a broken session | Launch the dev client ONCE to attach Metro, then restart with `adb shell monkey -p ie.project.nexus -c android.intent.category.LAUNCHER 1` |
| 🔴 `https://app.project-nexus.ie/...` deep links on a debug build | Open **Chrome**, not the app — app-link verification is not in place on the emulator | Use the custom scheme: `nexus://goals` |
| 🔴 `adb shell input text "..."` into a React Native field | Only the FIRST character commits. The rest sits in the keyboard's suggestion strip and never reaches the controlled input — visible as "heetWorksNow" offered as a suggestion while the field holds "S" | Type one short string, verify with a screenshot, and design the check so one character is enough |
| 🔴 Screenshotting 2–3 s after a tap to see whether a sheet opened | A sheet that opens and closes itself is invisible at that distance. This is exactly how a working-then-closing sheet was recorded as "nothing renders" for six days | Burst-capture immediately: `for i in 1 2 3 4; do adb exec-out screencap -p > f-$i.png; done` and scan the frames |

## Instruments that lie

Recorded because each one produced a confident wrong answer:

- **An edge-detector I wrote** flagged the scroll indicator, so I taught it to ignore long
  uniform-grey columns — after which it reported the screen *with the clipped button* as
  `ok`. Treat its flags as hints; never its silence as a pass.
- **A test's own mock** destructured a fixed prop list and dropped the rest, so a working
  `accessibilityState` looked broken and was nearly deleted. A mock that accepts fewer props
  than the real component reports defects that do not exist.
- **A geometry model** asserted the reaction row overflowed at 411dp, contradicting the
  screenshots. The model was wrong. Guard tests here assert the weakest form of an
  inequality for that reason.
- **A "not found" screen** proved nothing about a deep link: the slug belonged to another
  tenant *and* the feature was disabled for the test community, so that screen says "not
  found" regardless. Check tenant and feature flags before believing an empty screen.

## Known-fragile areas

| Area | Why |
| --- | --- |
| `components/ui/BottomSheet` + `useDeferredBottomSheetState` | Five repair attempts; working since 2026-08-21. 🔴 **Never add a second open flip** — the bounce that was meant to help is what closed every sheet. Guarded by `bottomSheetOpenFlip.test.ts` |
| `pointerEvents` as a View **prop** | Not applied in this React Native version. An `absoluteFill` overlay with the prop alone swallowed every tap in the app. Put it in `style` |
| `components/ui/Input` | Width classes must go on `containerClassName`; `className` reaches the inner field and cannot size it |
| `SafeAreaView` from `react-native-safe-area-context` | `className` is inert — uniwind does not patch it. 90 screens still rely on a class that does nothing; 93 carry the `style={{ flex: 1 }}` fix |
| `+native-intent.ts` | Parameter **names** must match what each screen reads. Guarded by `app/deepLinkParams.test.ts` |
| `flex-1` generally | Three distinct ways it silently does nothing in this app. The pattern is always the same: the class is on a different element from the one that decides the size |
