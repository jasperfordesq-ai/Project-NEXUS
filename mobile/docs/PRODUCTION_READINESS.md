<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Production Readiness Rubric

Last reviewed: 2026-08-19

Third edition. The rubric and the four-point scale are unchanged; the scorecard has
grown from 14 rows to 17, because the second edition scored the **code** thoroughly and
never scored the **operations** at all — and that is now where readiness actually fails.

**The headline: the engine is in good order, and the app is still not distributable.**
Nothing has ever been shipped to a member. Crash reporting is off in every build
profile. There is no way to require an update, which is the one thing that cannot be
retrofitted onto binaries already in people's hands.

## Why the second edition could not simply be patched

It had drifted into self-contradiction, which is worth recording because the mechanism
will recur:

- Two different test counts appeared in the same document.
- The coverage table sat **below** the ratchet floors that were passing, so the floors
  were the truth and the table was stale.
- Row 8 said the nightly device workflow "has never run". It had run, on 2026-08-19,
  and failed.
- The gate inventory covered roughly half the gates that actually exist.
- Row 9 claimed screens were "pixel-gated at 0px" while the pixel gate was blind to the
  change it was meant to catch.

Each figure was true when written. None was re-measured. Hence the rule now stated at
the bottom of this document: **no number without its measurement command, and no figure
copied forward from a previous edition.**

## How to read a score

Each dimension is scored against stated criteria, not against a feeling. A dimension is
only `Strong` when something automated would fail if it regressed. "It works when I try
it" is `Unmeasured` — that is a statement about attention, not about the app.

| Score | Meaning |
| --- | --- |
| **Strong** | Automated, blocking, and it would go red on a regression. |
| **Adequate** | Automated and honest about its limits; gaps are recorded and bounded. |
| **Weak** | Partially covered; a real regression could ship unnoticed. |
| **Unmeasured** | No mechanism at all. Not the same as broken — but not evidence of working either. |

---

## Scorecard — 2026-08-19

Every figure re-measured this session. The command that produced it is in that
dimension's own section; none is inherited from an earlier edition.

| # | Dimension | Score | One-line basis |
| --- | --- | --- | --- |
| 1 | Automated test suite | **Strong** | 290 suites / 1,907 tests, 0 skipped, 0 quarantined, blocking in CI (was 274 / 1,779) |
| 2 | Code coverage | **Adequate** | 74.09% lines / 71.06% statements / 63.91% branches, over 284 files, against 28 shrink-only area floors + a global floor |
| 3 | API contract drift | **Adequate** | 403 endpoints over 492 call sites; 402 verified against Laravel's real routes, 1 known drift awaiting a product decision |
| 4 | Route parity drift | **Adequate** | 254 React routes vs 137 mobile; 125 native, 65 out-of-scope, 33 gaps, 31 needs-review — and the review budget is at 31/31, i.e. full |
| 5 | Type safety | **Strong** | `tsc --noEmit` strict, clean, blocking in CI |
| 6 | Release & native policy | **Strong** | `verify:release` + `verify:network-security`, both blocking, both passing |
| 7 | Lint & code style | **Adequate (newly scored)** | 0 errors, 508 warnings under a cap. 🔴 It caught a real conditional-hook bug that had already shipped in a commit reported as verified — see below |
| 8 | End-to-end journeys | **Weak (was Adequate)** | 9 Maestro flows exist and pass locally. The nightly CI workflow ran for the first time on 2026-08-19 and **failed**; cause now diagnosed and fixed, but unproven until the next push |
| 9 | Visual correctness | **Weak** | Contrast gated; 3 screens pixel-gated; 93 images over 31 screens photographed; ~106 never photographed. 🔴 Two blank screens FIXED 2026-08-20 and the cause was systemic — `className` is inert on this app's SafeAreaView, so 112 files carry a dead one (row 9.1) |
| 10 | iOS | **Unmeasured** | Never built or run, locally or in CI. App Store Connect ID still a placeholder |
| 11 | Accessibility | **Adequate** | 2 of 44 interactive elements lack a label (one has visible text, one is dead code). Contrast checked. Touch-target size and real screen-reader use still unchecked |
| 12 | Internationalisation | **Weak** | 7 locales (`de en es fr ga it pt`) against the platform's 11. `nl` `pl` `ja` are ordinary work; **`ar` is blocked** — no right-to-left support exists |
| 13 | Offline & flaky network | **Adequate for check-in, Weak elsewhere** | Offline check-in store 94.97% covered incl. the double-credit guard; a dropped connection no longer signs a member out (fixed this session) |
| 14 | Performance | **Unmeasured** | No startup-time, bundle-size or scroll budget of any kind |
| 15 | Observability & ops | **Adequate (was Weak, same day)** | Sentry is still off in all six profiles, but every report now ALSO goes to our own API and is logged at `error`, so a crash reaches the owner with no account, no DSN and no owner action. 13 report sites redirected; a credential leak in one of them fixed |
| 16 | Distribution & update lever | **Adequate** | Force-update lever complete and proven on a device. Rollback wrapper and the "update ready — restart" prompt both added 2026-08-20, so all three update controls now exist. Still true: **nothing has ever been distributed** |
| 17 | Store readiness | **Unmeasured (new row)** | No listing, screenshots, public privacy URL or Data Safety answers. `versionCode` is 2 and `autoIncrement` never exercised. Two policy risks flagged below |

---

## 1. Automated test suite — Strong

```bash
cd mobile && npx jest --ci
```

→ `Test Suites: 290 passed, 290 total` / `Tests: 1907 passed, 1907 total`

Nothing skipped, nothing quarantined. This is the one dimension that has been strong
throughout. Note what it does **not** prove: every test here runs in Node against mocks.
A green suite has never once demonstrated that the app starts on a device.

## 2. Code coverage — Adequate

```bash
cd mobile && npm run test:coverage && npm run coverage:ratchet
```

→ `lines 74.09%, statements 71.06%, branches 63.91%, functions 67.97% over 284 files`
→ `coverage ratchet: OK — every area is at or above its floor.`

28 per-area floors plus a global floor (`mobile/coverage-baseline.json`), shrink-only.
The ratchet also reports *improvements* worth banking — this run flagged `app` at 96.04%
against a 78.72% floor, which should be raised.

## 3. API contract drift — Adequate

```bash
cd mobile && npm run api:check
```

→ `403 distinct endpoints across 46 modules (492 call sites)`
→ `verified 402, missing 1, method mismatch 0, dynamic 74, inline fetch 0`

The single known drift is `PUT /api/v2/volunteering/organisations/{id}/wallet/auto-pay`:
React deliberately removed the toggle (under auto-mint, approving hours always pays),
mobile kept it, and Laravel never had the route. It needs a product decision, so it is
recorded rather than silently patched.

## 4. Route parity drift — Adequate

```bash
cd mobile && npm run drift:check
```

→ `254 React routes vs 137 mobile routes — native 125, out-of-scope 65, gap 33, needs-review 31/31, undeclared 0`

🔴 **`needs-review 31/31` means the budget is full, not that 31 reviews are progressing.**
The next route added without a decision fails the gate. That is the intended design, but
it means this dimension has no slack left.

## 5. Type safety — Strong

```bash
cd mobile && npx tsc --noEmit
```

→ clean.

## 6. Release and native policy — Strong

```bash
cd mobile && npm run verify:release && npm run verify:network-security
```

→ both pass.

`verify:release` gained an assertion on 2026-08-19: every channel that is pinned must
also have a publish path, derived from the publisher's own source so the two cannot
drift.

🔴 **Certificate pinning: the 2026-10-03 deadline is CLOSED, and refreshing it found a
live problem the deadline was hiding.** Handled 2026-08-20 — see 6.1.

### 6.1 🔴 The pinned certificate was already stale, and no gate could see it

Refreshing the pins ahead of the October deadline found a live problem rather than a
routine date change.

```bash
bash scripts/get-cert-pins.sh api.project-nexus.ie
```

→ live leaf `Qk4GkShf/CuASLSvDeBlIeHwQ8obPwOyh0sGZ+cOZ1M=`, while the config pinned
`Owkg3TiAdb9cU+XKSXkJfvD2tCx+supL5btxtXNJaJE=` under the comment *"Pins last verified:
2026-07-14"*. **The pinned leaf matched nothing in the live chain** — about five weeks
out of date, with every gate green throughout.

Why: the leaf has a **90-day lifetime** (measured `notBefore 2026-08-10`,
`notAfter 2026-11-08`) and rotates automatically, so pinning it guarantees staleness
roughly four times a year.

The app kept working only because Android trusts a chain when ANY certificate matches ANY
pin, so the intermediate backup carried it alone. That is the backup doing its job — and
it left the app **one pin deep with no spare**, which is the state that bricks an app the
moment a CA rotates. A date-based gate could never have caught it: the expiry was fine.

**What changed.** The leaf pin was removed and the config now pins the GTS WE1
intermediate (`notAfter 2029-02-20`) plus the GTS Root R4 — two pins at *different chain
depths*, so an intermediate rotation cannot lock anyone out. Expiry moved to
**2027-09-01**, which keeps `verify:release` green until about 2027-06-03. The leaf pin
was buying nothing anyway: with the intermediate pinned, the effective constraint is
already "issued by GTS WE1".

**The gap that let it happen is now covered.**

```bash
npm run check:cert-pins
```

→ `2 declared, 3 served` · both PINNED · `OK — 2 pins match, at different chain depths`

Run against yesterday's config it reports the exact diagnosis and exits 1:
`STALE Owkg3Ti…` then *"only ONE declared pin matches the live chain — the app works
today, but a single CA rotation would brick it"*. Deliberately **not** in the blocking CI
path (it makes a real TLS connection; a network blip reddening a release gate teaches
people to ignore gates), and it exits **2** for "could not check" so an unreachable host
can never read as a pass. `lib/security/certificatePinning.test.ts` covers the offline
half — the retired leaf cannot be re-added, at least two pins must exist, and the expiry
keeps its headroom.

🔴 Which file is authoritative, since getting it backwards sends someone hunting for a
file that is not in the repository: `mobile/android/` is **gitignored**
(`mobile/.gitignore:8`, 0 tracked files), like the Capacitor project. The committed
**source** — `mobile/android-network-security-config.xml` — is the single source of truth,
and the Expo plugin copies it into the native project at prebuild on whichever machine
builds. Editing the source alone is correct and sufficient; git refuses the generated
copy. The test's byte-for-byte assertion guards the opposite hazard — a **stale local
prebuild**, where a build from this machine would carry old pins while the repository
looks right.

---

## 7. Lint and code style — Adequate (newly scored)

```bash
cd mobile && npm run lint
```

→ `✖ 508 problems (0 errors, 508 warnings)`

🔴 **This row exists because skipping this one command let a real bug ship.** A
session-expiry fix was committed and reported as verified on the strength of typecheck,
the full jest suite, coverage, and four other gates — but not lint. Lint was the only
gate that failed, and what it caught was not cosmetic: `react-hooks/rules-of-hooks` on a
`useAppToast()` call wrapped in try/catch. Because heroui-native's `useToast` throws from
*inside*, the hooks after the throw never run, so the hook **count** differed between a
tree with a toast provider and one without. It happened to work only because provider
presence never changes for a given component instance.

The fix inverted the dependency (`lib/notices/sessionNoticeStore.ts` publishes;
`components/ui/SessionNoticeHost.tsx` shows), and both wrong versions are now blocked by
mutation-verified tests rather than by lint alone — because a gate that is sometimes
skipped cannot be the only thing standing between a latent bug and `main`.

The 508 warnings sit under a cap and are mostly `require()` style in tests.

## 8. End-to-end journeys — Weak (was Adequate)

Nine Maestro flows in `mobile/.maestro/` (`01-auth-login` … `09-registration-flow`).
They pass against a local API. The second edition scored this Adequate partly because a
nightly CI workflow existed. It has now run, and the honest score is lower.

### The first run of the nightly device workflow failed, and destroyed its own evidence

Run `32218116959`, 2026-08-19 05:05 UTC, failed before the emulator started. Diagnosed
this session, and the diagnosis is worth keeping because the failure mode is nasty:

**Cause.** A CI runner has no `.env` — it is gitignored — so neither `JWT_SECRET` nor
`APP_KEY` was set. `TokenService::getSecretKey()` signs the mobile access token and falls
back `JWT_SECRET` → `APP_KEY` → throw:

> `RuntimeException: Security configuration error: JWT_SECRET or APP_KEY must be set`

So login returned 500 **at the moment it issued a token**, while bad credentials still
returned a clean 401. Probing the login endpoint the obvious way therefore reported a
healthy API. Reproduced against the real login route in the app container: both secrets
cleared → 500 with that message; `APP_KEY` alone → `200 {"success":true}`.

**Two separate evidence-destroying faults in the same step.** `tail -40` on the server
log named the cause **0 times** (measured) because a Laravel trace is ~70 lines, so the
tail showed frames #34 onwards and cut off the message. And the readiness poll sent no
`Accept: application/json`, so the recorded response was 600 bytes of app-shell HTML
instead of the error. Both fixed; the poll now asks for JSON, which alone would have made
the run self-diagnosing.

🔴 **Unproven until the next push.** This workflow runs only on a schedule or on demand,
so the fix cannot be verified locally. Treat row 8 as unresolved until a green run exists.

### What was verified on a device this session, and what was not

An emulator run with a freshly built dev client (`npx expo run:android`, Adoptium JDK 17)
confirmed: the app starts and signs in; the feed renders; the Create tab redirects to a
correctly rendered chooser; a `/leaderboard` link opens as a modal; and three unmappable
links land on the "Link not opened" screen with its two exits.

Not verified on a device: the marketplace-orders chips (unit test only), and the profile
failure state (needs a forced network failure). Say so rather than implying otherwise.

## 9. Visual correctness — Weak

Contrast is gated (`lib/hooks/useTheme.contrast.test.ts`). Three screens are
pixel-gated, at the sensitivity corrected on 2026-08-19 — `threshold: 0.02,
includeAA: true`, after the previous `0.1` reported 40px for a real 9,168px
light-grey-on-white change. 93 images over 31 screens have been photographed;
roughly 106 screens never have. See [VISUAL_AUDIT.md](VISUAL_AUDIT.md).

### 9.1 ✅ FIXED — and the cause was systemic, not one screen

Two screens were showing a title bar above an entirely blank body: the rewards/leaderboard
screen and **Goals**. Both are fixed, and the cause turned out to affect a whole class of
screens.

**`className` does nothing on the SafeAreaView this app uses.** Every screen imports it
from `react-native-safe-area-context`. uniwind patches className onto React Native's OWN
components — its resolver list does include `SafeAreaView`, but that is the one exported by
`react-native` — and it does not touch third-party packages. Nothing registers this one and
uniwind exposes no `cssInterop`-style API to do so.

Measured: **112 files** write `className="flex-1 bg-background"` on it and **zero** import
it from `react-native`. So on all of them neither the flex nor the background is applied.

Most screens survive that, which is why it went unnoticed for so long: content with an
intrinsic height still lays out. A screen breaks only when a child needs the PARENT to have
height — a `flex-1` ScrollView or FlatList, or the `flex-1 items-center justify-center`
pattern. Then the SafeAreaView sizes to its content and the child collapses to zero height.

### How it was isolated, since three plausible theories were wrong first

Each rejected by a single-variable test on the device:

| Theory | Test | Result |
| --- | --- | --- |
| The `RefreshControl`'s colours were invalid | logged `primary` | `#006FEE` — valid. Rejected |
| `contentContainerClassName` unsupported | removed it | no change. Rejected |
| The ScrollView's own `className="flex-1"` | replaced with an inline style | no change. Rejected |
| **The parent had no height** | fixed-height probe as a SIBLING vs INSIDE the ScrollView | sibling rendered, inside did not — **confirmed** |

Adding `style={{ flex: 1 }}` to the SafeAreaView then made **1,753,102 pixels** appear.

🔴 **This also closes an older mystery.** The comment at the top of `app/+not-found.tsx`
records content wrapped in `flex-1 items-center justify-center` rendering "at zero size",
and says "the centring container is the likely culprit but that was not isolated". Same
root cause, now isolated.

### What was changed, and how the scope was chosen

**19 screens** got an explicit `style={{ flex: 1 }}` — those whose SafeAreaView relies on
className for flex AND whose next element needs the parent's height. The predicate was
validated against the device rather than trusted: it flags `goals` (confirmed blank before,
rendering after) and does not flag `jobs` or `activity` (confirmed rendering both times,
byte-identical screenshots after the change, so no regression).

The other ~93 files keep their inert className deliberately. Rewriting them would risk
changing layouts that currently look right, for no observable gain — measured, not assumed:
of three flagged screens walked on the device, two rendered perfectly well. If that number
ever grows, a wrapper component becomes worth the churn; `components/safeAreaFlex.test.ts`
keeps it visible and blocks any NEW screen from arriving blank.

One thing now visible that the blank page was hiding: on the rewards screen the six tab
labels wrap onto two lines ("Bad ges", "Ch alle"). Cosmetic, recorded, not fixed.

### 9.2 A withdrawn finding, recorded so it is not "rediscovered"

An alleged critical deep-link dead end was measured and then **withdrawn**. Three
unmappable links (an https path, `/me`, an unknown custom scheme) appeared to strand the
app on a blank spinner. That reading came from `adb shell uiautomator dump`, which
returns **zero nodes for this app even when a full screen is rendered**. Screenshots show
all three landing correctly on the "Link not opened" screen; two pixel-match to 132px of
2,592,000 (the clock).

🔴 **For anyone measuring this app on a device: `uiautomator dump` is not evidence here.
Use screenshots.** The only genuine stranding case is the dev client's own bootstrap URL
(`nexus://expo-development-client/?url=…`), which no member can receive — it costs
developer time, not member time.

## 10. iOS — Unmeasured

Never built, never run, locally or in CI. The App Store Connect ID is a placeholder.
Everything in this document describes Android.

## 11. Accessibility — Adequate

2 of 44 interactive elements lack an accessible label; one already exposes visible text
and the other is in unused code. WCAG AA contrast is gated. Touch-target size and
behaviour under a real screen reader remain unchecked — and both need a device, so they
are blocked behind the same gap as row 8.

## 12. Internationalisation — Weak

```bash
ls mobile/locales
```

→ `de en es fr ga it pt` — **7**, against the platform's 11.

`nl`, `pl` and `ja` are ordinary translation work. **`ar` is blocked**: the app has no
right-to-left support, so adding Arabic strings would produce a broken layout in a
language that reads the wrong way — worse than not offering it.

## 13. Offline and flaky-network behaviour — Adequate for check-in, Weak elsewhere

The offline event check-in store is 94.97% covered, including the sync-retry batch-id
reuse that prevents a double credit.

Fixed this session: **any** token-refresh failure — including a dropped connection —
used to sign the member out *and* purge that queue, so an organiser on a bad connection
could lose a hall's worth of attendance with no explanation. Refresh now distinguishes
refused (real expiry → sign out, with a message) from unreachable (keep the session and
the queue, let the next request retry). Mid-request connection loss elsewhere in the app
is still untested.

## 14. Performance — Unmeasured

No startup-time budget, no bundle-size ceiling, no scroll measurement. The web platform
has Lighthouse in CI; mobile has no equivalent number, so "the app feels slow" cannot be
answered with evidence.

## 15. Observability and ops — Adequate (was Weak, same day)

```bash
grep -n "SENTRY" mobile/eas.json
```

→ six occurrences, all `SENTRY_DISABLE_AUTO_UPLOAD: "true"`, and
**`EXPO_PUBLIC_SENTRY_DSN` appears in no build profile at all.**

That is unchanged, and confirmed from the device log at launch:

> `[env] NOTE: EXPO_PUBLIC_SENTRY_DSN is not set. Crash reporting (Sentry) is disabled.`

### What was actually wrong, which was worse than a missing account

The app produced **13 kinds of diagnostic** — the crash boundary, push-registration
failures, an unexpected feed shape, a security-integrity warning, storage write failures,
the unhandled-deep-link warning, and ten API "contract drift" detectors — and every single
one reported to Sentry alone. With no DSN anywhere, all thirteen went nowhere.

Two compounding details:

- **The warning about the missing warnings was itself suppressed.** `lib/env.ts` announced
  "crash reporting is disabled" through a helper that is silent unless `__DEV__`. So the
  only audience who could ever see it was someone already running a development build.
- **One of the reports leaked a credential.** `navigateToLink` sent
  `[DeepLink] Unhandled link: ${link}` with the whole URL — and one of the links this app
  handles is a password reset, whose token is in the URL. A member tapping a slightly
  wrong reset link would have shipped a live credential to a third-party service.

### What now happens instead

`mobile/lib/observability/report.ts` sends every report to **two** destinations: Sentry
(a harmless no-op without a DSN) **and** `POST /api/app/log`, which already existed, is
rate-limited, and writes into the Laravel log. Crashes are logged at `error`, which is the
level the `sentry` log channel captures — so a mobile crash reaches the PHP project and
the nightly triage that already exists.

```bash
curl -X POST http://127.0.0.1:8090/api/app/log -H 'Content-Type: application/json'   -d '{"event":"mobile_error","version":"1.2.0","platform":"mobile","data":{"message":"probe"}}'
```

→ `200`, and in the container log:
`development.ERROR: [APP LOG] Event: mobile_error | Version: 1.2.0 …` with `tenant_id` and
`request_id` attached. Measured, not assumed.

**The point: this needs no account, no DSN and no owner action.** Crash reporting for
mobile is working today.

Guards, because "reports into a void" is invisible to any behavioural test:
`lib/observability/reportingWiring.test.ts` fails if anything reports to Sentry directly,
if the crash boundary stops using the reporter, if the deep-link report regains the whole
URL, or if reporting is put behind a dynamic import again.

### Still outstanding, and still owner-only

A **Sentry project for mobile** would add grouping, release health and stack symbolication,
none of which the server log gives. `scripts/sentry-triage.mjs` now has a `mobile` slot
waiting for `SENTRY_PROJECT_MOBILE`. Two commands from the owner: create the project, set
the DSN as an EAS environment variable. Deliberately not done here — it is an account
action, and this session does not touch the owner's external accounts.

🔴 One dependency worth stating: routing mobile crashes into Sentry relies on production
setting `LOG_STACK=daily,stderr,sentry` (see `.env.example`). Without it they still land in
the log file, which is where they landed before — so the change cannot make things worse,
but it is worth confirming.

## 16. Distribution and update lever — Adequate (was Weak, same day)

```bash
node -e "const e=require('./mobile/eas.json'); for(const [n,p] of Object.entries(e.build)) console.log(n, p.channel, p.distribution, p.autoIncrement)"
```

→ `development/local-emulator` have no channel; `preview`, `staging`, `website`,
`production` do; only `production` sets `autoIncrement`.

### 🔴 The force-update lever is complete, and proven on a device

This was the one item on the whole scorecard that **could not be retrofitted**: a binary
already on someone's phone can only be told "you must update" if that copy already knows
how to ask. It now exists on both sides, and it was verified end to end rather than
reasoned about.

- **Server:** `App\Http\Middleware\EnforceMobileMinimumVersion` reads
  `X-Nexus-Mobile-Version` on every request and refuses anything below
  `config('mobile.expo.minimum_version')` with **426 Upgrade Required**, carrying the
  minimum, the current version and the update URL.
- **Client:** `lib/api/client.ts` turns a 426 into a record in
  `lib/updates/updateRequiredStore.ts`, and `UpdateRequiredGate` — mounted above the
  tenant, auth and error-boundary providers — **replaces the entire app** with
  `UpdateRequiredScreen`, translated into all 7 locales.

Proof, 2026-08-19, on emulator `nexus_test` with the server minimum temporarily raised to
`99.0.0`:

```bash
curl -s -o - -w '%{http_code}' http://127.0.0.1:8090/api/v2/feed   -H 'X-Nexus-Mobile-Version: 1.2.0' -H 'X-Tenant-Slug: hour-timebank'
```

→ `426` with `"code":"APP_UPDATE_REQUIRED"`, while the same request **without** the header
returned a normal `401` — i.e. the web frontend is untouched. On the device the app showed
"Time to update" with the server-supplied button, and reverting the minimum restored normal
service on the next launch, so the block is not sticky.

Design decisions that are load-bearing (all pinned by tests, several mutation-verified):

- **An absent header is allowed.** Everything without it is the web app, the Capacitor
  wrapper (which polls `/api/app/check-version` instead), or a server-to-server caller.
  Refusing unknown callers would take the website down.
- **It fails open.** Any error while deciding is logged and the request proceeds.
- **`/api/app/*` is exempt**, so a locked-out copy can still ask what version it needs —
  otherwise "please update" becomes a dead end.
- **426, not 403.** The client treats 401/403 as a session decision and would sign the
  member out instead of asking them to update.
- **The update URL comes from the server**, because the copies that need it are exactly
  the ones that cannot be updated any other way.
- **There is no dismiss.** The API refuses every request from this build, so a "continue
  anyway" would lead to a wall of unexplained failures.

The registration is tested separately from the logic
(`MobileVersionGateRegistrationTest`), because a unit test of `handle()` passes just as
happily when the middleware is not wired into `bootstrap/app.php` at all — verified by
mutation: removing the registration turns that test red.

### The other two update controls — added 2026-08-20

**Rollback.** Publishing had careful guards; *undoing* a publish had none, so the one
control you reach for while something is actively broken was the only one that could be
aimed at the wrong channel unchecked. `scripts/rollback-update.mjs` wraps
`eas update:rollback` with per-channel approval variables.

🔴 It deliberately does **not** require a clean worktree or main, unlike the publisher. A
rollback ships nothing from your machine — it re-points a channel at an update EAS already
has — and whoever runs it is by definition mid-emergency, possibly with a half-written fix
in the tree. Refusing them then is friction with no safety behind it. The approval variable
stays, because a rollback IS a publish: it changes what every member's app runs.

`verify:release` now asserts that every pinned channel has **both** a publish and a
rollback path and that the two scripts have not drifted — mutation-verified by removing
`website` from the rollback list, which fails both new assertions. Exercised for real:
unknown channel → exit 64; `production` without approval → exit 77 with nothing published;
`staging` reaches eas-cli. (Nothing was actually rolled back: `~/.expo/state.json` holds
only an anonymous install id, no auth session, so eas-cli had no credentials.)

**"Update ready" prompt.** `updates.checkAutomatically` is `ON_LOAD`, so the app already
fetched a published fix in the background and applied it on some later cold start —
silently. Nothing in the app code touched `expo-updates` at all, so a fix could sit
downloaded on a phone for days while the member kept hitting the bug it repaired.
`components/ui/UpdateReadyHost.tsx` now offers a restart when one is pending.

🔴 It is deliberately the OPPOSITE of `UpdateRequiredScreen`: a dismissable toast, never
blocking. Conflating the two would be the worst outcome — a blocking prompt for an optional
restart trains people to dismiss the one that matters. It also says nothing when
`Updates.isEnabled` is false (dev client, Expo Go), where "Restart" would do nothing, and
announces once per pending update rather than on every render. Nine tests cover exactly
those restraints.

### Still open here

- **Nothing has ever been distributed.** No artefact has reached a member. This is now the
  only thing between the app and a first install.
- Fixed earlier this session: the `website` channel — the profile behind the APK that
  `DISTRIBUTION.md` designates for public download, and the only current route to a
  member — had no publish path at all.

Certificate pinning is no longer a pending date — closed 2026-08-20, see 6.1. Two
corrections to what this document said about it: the 90-day check lives in
`verify-release-config.mjs:53` (i.e. `verify:release`), **not** in
`verify:network-security`; and the mechanism by which it blocks a web deploy is the
nightly full CI run plus the deploy verifier failing closed, not the push-triggered run
(where a mobile-untouched push skips the job entirely).

## 17. Store readiness — Unmeasured (new row)

```bash
node -e "const a=require('./mobile/app.json').expo; console.log(a.version, a.android.versionCode, a.android.permissions.join(','), a.privacy ?? '(no privacy URL)')"
```

→ `1.2.0`, `versionCode 2`, permissions `RECORD_AUDIO, ACCESS_COARSE_LOCATION,
ACCESS_FINE_LOCATION, CAMERA`, and **no privacy URL declared**.

Not started: listing copy, screenshots, a public privacy-policy URL, Data Safety answers.
`autoIncrement` has never been exercised and may refuse with a dynamic config.

Two policy risks worth flagging early rather than at submission:

1. **Play Families policy.** The platform supports child sub-accounts and guardian
   consent. An app that can be used by children attracts a stricter policy regime.
   Whether it applies needs deciding before a listing is written, not after a rejection.
2. **`ACCESS_FINE_LOCATION` is broader than the app's purpose.** Play requires a
   justification for precise location. Either narrow it to coarse or write the
   justification down.

`prepackage` currently **fails**, for a pre-existing tooling reason unrelated to the app:
`expo-doctor` errors on `npm explain @unimodules/core` and `npm explain expo-cli` for
packages that are correctly absent. Worth knowing before it is mistaken for a real defect
at submission time.

---

## What a green run actually proves

The second edition's gate inventory covered about half the real gates. This is the full
list, with what each one would catch.

| Gate | Command | Catches |
| --- | --- | --- |
| Unit + component suite | `npx jest --ci` | logic and rendering regressions (290 suites) |
| Coverage ratchet | `npm run coverage:ratchet` | a seam losing its tests (28 area floors + global) |
| Type safety | `npx tsc --noEmit` | contract drift inside the app |
| Lint | `npm run lint` | 🔴 conditional hooks and similar latent bugs. Skipping it once shipped one |
| Release policy | `npm run verify:release` | channel/pinning/version policy, incl. the 90-day pin time-bomb |
| Network security | `npm run verify:network-security` | cleartext traffic, pin expiry |
| API ledger | `npm run api:check` | an endpoint the app calls that Laravel does not serve |
| Route parity | `npm run drift:check` | a React route with no recorded mobile decision |
| Theme generation | `npm run themes:check` | committed tenant CSS drifting from the palette |
| Contrast | part of the suite | a theme change dropping below WCAG AA |
| Pixel comparison | `npm run screenshots -- compare` | unintended visual change on 3 screens |
| Source-scanning guards | part of the suite | 17 structural rules a rendering test cannot see |
| Device flows (nightly) | `mobile-device-tests.yml` | 🔴 has never passed. Fix unproven until the next push |
| Packaging | `npm run prepackage` | 🔴 currently fails on pre-existing expo-doctor tooling errors |

What no gate covers: iOS, real devices, screen readers, startup time, bundle size, and
whether the app works at all when Sentry, EAS or the store are involved.

🔴 One trap worth naming: in `e2e-tests.yml`, the projects called `mobile-chrome` and
`mobile-safari` are **Playwright browser emulations of the web app**. They have nothing
to do with this app. A green "mobile" job there is not evidence about the Expo client.

---

## The journey to production

Ordered by what blocks what, not by effort.

### P1 — before ANY distribution (target: mid-September)

1. ✅ **Force-update lever — DONE 2026-08-19**, both halves, proven on a device. See
   row 16. The remaining third of the update story is still open: `expo-updates` is
   unused, so a published fix is picked up only on a later cold start, silently, with no
   "update ready — restart" prompt.
2. ✅ **Crash reporting — DONE 2026-08-19** by a different route than planned. Rather
   than waiting on an owner account, all 13 report sites now also post to our own API and
   crashes are logged at `error`, so they reach the existing nightly triage. A Sentry
   project would add grouping and symbolication and remains an owner action;
   `scripts/sentry-triage.mjs` has the slot.
3. **Rollback runbook** — an `eas update:rollback` wrapper with `publish-update.mjs`'s
   guards. Pin `eas-cli` rather than resolving `@latest` at publish time.
4. **Close row 9.1** — the blank rewards/leaderboard screen.
5. Adopt `ErrorState` across the remaining modals that still have no failure branch.
6. Narrow `ACCESS_FINE_LOCATION` or write the justification.

### P2 — hard date: ✅ DONE 2026-08-20

Was "refresh the certificate pins by mid-September, the gate goes red around 2026-10-03
and blocks web deploys as well". Closed — and the refresh turned out to be a live fault
rather than a date change, because the pinned leaf was already five weeks stale. See 6.1.
The next deliberate review is around **2027-06-03**, when the new expiry comes inside the
gate's 90-day window.

### P3 — distribution

A download page for `mobile.project-nexus.ie`; the first `website`-channel publish (owner
go-ahead required); a `versionCode` autoIncrement dry run, which has never been exercised.

### P4 — store readiness (assess only, per the owner's decision)

Listing copy, screenshots, Data Safety draft, and a written Families-policy analysis.

### Parked, with reasons

iOS entirely; right-to-left support and therefore Arabic; `nl`/`pl`/`ja`; performance
budgets; deletion of the three unused wrapper components (Badge/Card/Divider — an owner
call, recorded); the ~160-value decorative colour palette.

---

## Keeping this honest

- **No number without its measurement command, inline.** Every figure in this edition was
  produced by running the command shown beside it, this session.
- **Never copy a figure forward from a previous edition.** That is exactly how the second
  edition came to contradict itself in four places.
- A dimension moves to `Strong` only when something automated would fail on a regression.
  Adding effort does not raise a score; adding a gate does.
- **"It passed" must never stand in for "it ran".** Two claims in this edition are
  explicitly *unproven* (the device-workflow fix, and anything involving EAS or Sentry),
  and they are labelled rather than rounded up.
- When a finding is withdrawn, record the withdrawal and the reason — see 9.2. An
  unrecorded false alarm gets rediscovered at full cost.
