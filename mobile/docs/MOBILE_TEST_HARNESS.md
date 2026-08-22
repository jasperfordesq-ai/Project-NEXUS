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

## 🔴 The exchange workflow is OFF by default — switch it on to walk Tier 3

A fresh community has no broker configuration, so `exchange_workflow_enabled` is **false**.
With it off the app is behaving correctly and confusingly: the listing's main button reads
"Request this service" and opens a **message thread**. Nothing is broken; there is simply no
exchange workflow to enter. Turn it on for the local fixture:

```bash
docker exec nexus-php-db mysql -unexus -pnexus_secret nexus -e "
INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, created_at, updated_at)
VALUES (2, 'broker_config', '{\"exchange_workflow_enabled\":true}', NOW(), NOW())
ON DUPLICATE KEY UPDATE setting_value = '{\"exchange_workflow_enabled\":true}';"

# Confirm, and restart the app — the flag is read once per launch:
curl -s http://127.0.0.1:8090/api/v2/exchanges/config -H "X-Tenant-Slug: hour-timebank"   -H "Authorization: Bearer $TOKEN"
```

The button then reads "Request exchange" — that label change is the cheapest proof the app
picked the setting up. **Local database only. Never on production**: whether a community runs
the formal workflow is that community's decision.

Useful column names for checking the result:

| Table | Note |
| --- | --- |
| `exchange_requests` | 🔴 The live table. There is **no** `exchanges` table. No `message` column either — the requester's note is `requester_notes` |
| `exchange_history` | one row per step; `action` is one of `request_created`, `status_changed`, `provider_confirmed`, `requester_confirmed` |
| `transactions` | 🔴 `giver_id` is **NULL** on an exchange transaction. Reading the table alone suggests the debit was never recorded against the payer; the API derives it from the exchange, and the member's own statement is correct. Check the API before filing a money defect |

## Column names and fixtures for the Tier 5 and 6 walks (2026-08-22)

| Table | Note |
| --- | --- |
| `groups` | 🔴 Tenant 2 had **zero** groups. Joining or posting cannot be walked without creating one first — the create form needs a description of **20–2000 characters** and says so |
| `group_posts` | 🔴 Where a discussion's FIRST MESSAGE lives. `group_discussion_messages` exists with two columns (`id`, `created_at`), is empty, and reading it first nearly produced a false "the message vanished" finding |
| `group_discussions` | `user_id` (not `created_by`), no body column — the body is the `group_posts` row |
| `connections` | `requester_id` / `receiver_id` / `status` (`pending` \| `accepted`). No `user_id` |
| `messages` | the text column is **`body`**, not `content` |
| `transactions` | a member-to-member transfer has description "Time credit transfer"; `giver_id` is NULL, as with exchanges |
| `events` | 🔴 The date is **`start_time`**. `events.start_date` exists and is always NULL — reading it first produced a false "the date was not saved" finding. A new event is a `draft`; publishing is a separate action behind a confirmation |
| `event_rsvps` | 🔴 Where an RSVP lands. `event_attendance` is a different thing (check-in), and `event_attendees` does not exist |
| `exchange_requests` | a provider DECLINE sets status `cancelled` — there is no `declined` state in the machine |
| `marketplace_listings` | 🔴 Moderation is ON by default, so a newly published listing is `moderation_status = 'pending'` and invisible to everyone but its seller. There is no `currency` column (it is `price_currency`), `condition` is a reserved word (backtick it), and a marketplace that forbids combined pricing refuses any listing carrying BOTH a cash price and a `time_credit_price` — at ORDER time, not at create time |
| `marketplace_orders` | the listing column is **`marketplace_listing_id`**, not `listing_id`. A time-credit purchase has `total_price = 0` and the real cost in `time_credits_used` |
| `challenge_ideas` / `challenge_idea_votes` | 🔴 **no `tenant_id`** on either — they are scoped through `challenge_id`. `ideation_challenges.ideas_count` is a denormalised column that stays 0; the API counts rows |
| `users` | the balance column is **`balance`**, not `time_balance` |
| `polls` / `poll_options` / `poll_votes` | a vote lands in **`poll_votes`**. 🔴 `poll_options.votes` is a denormalised column that is **always 0** — nothing in `app/` reads it and nothing increments it; every tally is a `COUNT(*)` over `poll_votes`. Reading it as evidence produces a false "the vote was not counted" finding. `polls` has no `status` column: use `is_active` |

🔴 **`(modals)/chat.tsx` is the AI assistant, not member messaging.** Member conversations are
`(modals)/thread.tsx`. Walking "send a message" through chat.tsx proves nothing about it.

🔴 **The wallet's send-credits panel does not scroll the focused field above the keyboard.**
Type into the recipient search and the field is hidden behind the keyboard, along with any
results. Recorded rather than fixed — dismiss the keyboard and scroll to read the result.

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
| 🔴 `pidof com.projectnexus.mobile` to check the app is alive | The package is **`ie.project.nexus`**. The wrong name answers "not running" for an app that is running perfectly, and the next move is a pointless restart | `adb -s <serial> shell pidof ie.project.nexus` |
| 🔴 Reading the screen after a long gap and treating it as live | Android keeps painting the last frame. A screen left mid-journey an hour ago looks exactly like a blank-screen defect, and one nearly got filed | Note the status-bar clock in two shots a minute apart; if it advances the screen is live |
| 🔴 Tapping a field that the keyboard is covering | The tap lands on the keyboard, and the text goes into the field that still has focus — three strings ended up in one Question field this way | Dismiss the keyboard between fields with the IME's own hide chevron (bottom-left, ~`161 2335` at 1080×2400), then re-screenshot before the next tap |
| 🔴 Clearing a field with repeated `keyevent 67` | 40 taps of backspace, and any miss leaves debris that reads as a save bug | `adb shell input keycombination 113 29` (Ctrl+A) then `input keyevent 67`. Verified working on this emulator image |

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
- **`npm run screenshot:compare` on its own proves nothing.** It compares the PNGs already
  sitting in `screenshots/current/` — it does not take new ones. Run against captures from an
  earlier session it happily reported "0 px — 3 screens match the baseline" for a change that
  touched two of those three screens. 🔴 Always `screenshot:tour` (or `capture`) first, and
  with two emulators attached set `ANDROID_SERIAL=emulator-5554`, because the script's adb
  helper passes no `-s` and every call dies with "more than one device".
  🔴 And once captured, expect `06-wallet.png` to differ for a reason that is not a
  regression: it prints balances, and walking any journey changes them. `VOLATILE_SCREENS`
  already excludes the feed, listings and messages for exactly this reason; wallet is just as
  data-dependent but is still gated, so its baseline is only meaningful against a pristine
  fixture. Compare the layout by eye before believing a percentage. This gate is local-only —
  no CI workflow runs it.
- **A working filter looked broken.** The listings Offer/Request tabs appeared to do nothing:
  the underline moved and the count stayed at 3 with a "Requesting" card under the Offer tab.
  They work perfectly. The screenshot was taken before the filtered response arrived, and a
  preceding tap had missed its target, so the screen was showing the previous state. What
  settled it in seconds was the API access log — `type=offer` was there all along — and a
  direct call to the endpoint (3 / 2 / 1 results for none / offer / request). 🔴 Two of the
  three "defects" I nearly filed in this sweep were screenshot timing. Read the request log
  before believing a screen.
- **A number on screen looked like proof the data was wrong.** A poll card read "1 votes"
  next to a correct database row. Nothing was wrong with the vote — the singular
  translation simply did not exist, so i18next fell back to the plural wording. The same
  card then showed "2 votes" beside 0% and 0%, which was the app failing to handle tallies
  the server deliberately withholds. Two different faults, both looking like bad data. When
  a figure looks wrong, separate "the value is wrong" from "the sentence around it is
  wrong" before filing anything.

## Known-fragile areas

| Area | Why |
| --- | --- |
| `components/ui/BottomSheet` + `useDeferredBottomSheetState` | Five repair attempts; working since 2026-08-21. 🔴 **Never add a second open flip** — the bounce that was meant to help is what closed every sheet. Guarded by `bottomSheetOpenFlip.test.ts` |
| `pointerEvents` as a View **prop** | Not applied in this React Native version. An `absoluteFill` overlay with the prop alone swallowed every tap in the app. Put it in `style` |
| `components/ui/Input` | Width classes must go on `containerClassName`; `className` reaches the inner field and cannot size it |
| `SafeAreaView` from `react-native-safe-area-context` | `className` is inert — uniwind does not patch it. 90 screens still rely on a class that does nothing; 93 carry the `style={{ flex: 1 }}` fix |
| `+native-intent.ts` | Parameter **names** must match what each screen reads. Guarded by `app/deepLinkParams.test.ts` |
| `flex-1` generally | Three distinct ways it silently does nothing in this app. The pattern is always the same: the class is on a different element from the one that decides the size |
| `<SafeAreaView className="flex-1">` with no `style` | 🔴 **Fixed everywhere on 2026-08-22** and now guarded at ZERO by `components/safeAreaFlex.test.ts`. `className` is inert on this component, so the root had no flex and sized to its content. On the Jobs Alerts tab that put the list BELOW the bottom of the screen with nothing to scroll — the alert the member had just created could not be reached at any scroll position. 🔴 Whether a screen breaks depends on rendered heights: `settings` scrolled perfectly with the same fault, `jobs` did not. That is why the guard is zero-tolerance rather than a cleverer rule |
| A card-sized tap target inside `HeroButton` | 🔴 A button caps its own height. Every notification card was cropped to about two and a half lines: the title, the category chip and the timestamp were **not rendered at all**, and the body was cut mid-word. `NativePressable` lets its content decide the height. Found 2026-08-22; the ActionSheet label clipping fixed earlier the same day is the same family |
| A count shown next to a paginated list | 🔴 The notifications header counted the loaded page — "10 unread" against 26 real ones. The correct total was already available at `/v2/notifications/counts` and its client function had never been called |
| Anything counted in a label | 129 keys were called with a `count` and had no singular form, so every "1 of something" read as a plural in all seven languages. Guarded by `locales/pluralForms.test.ts`, a shrink-only ratchet with 43 deliberate exemptions (a number that is not counting a noun) |
| Poll tallies | 🔴 Nullable by design. `FeedService` sends `total_votes: null` and null per-option counts to anyone but the poll's creator while the poll is open; `PollService` (the vote endpoint) sends a real `total_votes` plus `results_visible: false`. **Two shapes for the same idea** — a client must handle both, and `null + 1` is `1`, so getting it wrong looks plausible rather than broken |
