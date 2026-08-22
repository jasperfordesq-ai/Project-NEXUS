<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
Author: Jasper Ford
See NOTICE file for attribution and acknowledgements.
-->

# Mobile Hand-off — start here

Last reviewed: 2026-08-22

Status: **Maintained — the first document a new session on the mobile app should read.**

## The goal

Take the Expo / React Native app in `mobile/` — HeroUI-native (`heroui-native` + uniwind),
not the Capacitor wrapper around the website — to the point where it can be **put in front of
real members**.

That is not the same as "the code is good". The code is largely good. What is missing is
**evidence that the product works**, and the operational machinery to ship it and hear about
it when it breaks.

🔴 **There is no agreed definition of "ready", and that is the single most important thing to
settle.** The score below is a measurement, not a gate; without a stated bar, "production
ready" recedes for ever. **Proposed bar — needs the owner's yes or no:**

1. Every Tier 1 journey (getting in: register, sign in, password reset, legal gate,
   onboarding, force-update) **CERTIFIED**. A member who cannot get in has no opinion about
   anything else.
2. **Zero BROKEN rows**, or each remaining one explicitly accepted in writing by the owner.
3. Crash reporting **on** in the profile that gets distributed, and one crash seen arriving.
4. ~~The force-update lever proven end to end.~~ **Done 2026-08-22** — fired for the first
   time by raising the server floor locally: the API refused the build with 426 and the app
   replaced itself with an undismissable screen. What remains for a release is that the update
   it demands must actually be downloadable, which is item 5.
5. The distribution path **exercised once**: a build published, installed from that channel,
   and opened.
6. A **screen-reader pass** over one complete journey. The platform's other frontend is
   GOV.UK-based and accessibility-led; shipping a native app with none is inconsistent with
   the platform's own values.

Nothing in that list is a score. A total of 549 or 700 is not the point.

## Where the truth lives, and the rule about keeping it there

| Document | What it is |
| --- | --- |
| [`MOBILE_JOURNEY_LEDGER.md`](MOBILE_JOURNEY_LEDGER.md) | **The work list.** 140 fixed rows, one per member journey, each with a status and the evidence for it |
| [`CURRENT_MOBILE_PRODUCTION_STATUS.md`](CURRENT_MOBILE_PRODUCTION_STATUS.md) | The rubric and the score, recomputed from the ledger and machine-enforced |
| [`MOBILE_ROADMAP.md`](MOBILE_ROADMAP.md) | The plan, in phases, ordered by what unblocks the most measurement |
| [`MOBILE_TEST_HARNESS.md`](MOBILE_TEST_HARNESS.md) | How to walk a journey on a device, and every trap that has cost real time |
| [`TESTING.md`](TESTING.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`SECURITY.md`](SECURITY.md) | Suites and gates; release and update path; transport and storage |
| [`NATIVE_UI_CONTRACT.md`](NATIVE_UI_CONTRACT.md), [`WRAPPER_POLICY.md`](WRAPPER_POLICY.md) | What "HeroUI-native" means here, and when a wrapper is allowed |

🔴 **Every change updates the ledger row it affects, in the same commit.** A journey is not
"done" because work happened on it; it moves status because its **effect was verified**. The
score is recomputed from the ledger by `node scripts/check-doc-scores.mjs`, which fails the
build when the summary counts, the arithmetic and the rows disagree — so a wrong number
cannot be published quietly. The status document also carries a **banked floor**: a published
total may never fall. A demotion is recorded in the ledger and the headline waits for the
next net gain.

## What proving a journey means

Walk it on a device, verify the **effect** in the database or the API, then say whether a test
guards it. Three standards that came out of getting this wrong:

- 🔴 **Mutation-verify every guard.** Break the fix, watch the test go red, restore it. Several
  tests written here could never have failed; they are worse than no test, because they read
  as coverage.
- 🔴 **Read the API access log before believing a screen.** Two of three "defects" in the last
  sweep were screenshot timing — a toast caught mid-animation, a list photographed before its
  filtered response arrived. One command settles it:
  `docker logs --since 30s nexus-php-app | grep -oE '"(GET|POST) [^"]+"'`
- 🔴 **Confirm the layer before fixing it.** The voice-duration bug looked like a client
  omission; the duration handling a few methods up in the same controller made the server look
  correct. The actual cause was `sendVoice()` passing a literal `0`. Fixing the first plausible
  layer would have shipped a client change that did nothing.

## Where it stands, 2026-08-22

**549 / 1000 on rubric M1.** Of 140 journeys: 40 CERTIFIED, 41 PROVEN, 24 RENDERS, 4 PARTIAL,
2 BROKEN, 27 never attempted, 2 not applicable.

Green: the engine. 309 test suites / 2,106 tests, TypeScript strict and clean, one blocking
source-scan guard per failure family that has actually happened here, translations in seven
languages, and a native release gate that passes in CI.

Not green: the product has only recently begun to be walked at all, nothing has ever been
distributed to anybody, crash reporting is off in every build profile, and the force-update
lever has never been fired.

### Walked and certified in the last two sessions

Feed moderation (hide / not interested / mute / report — the capability did not exist), the
whole exchange workflow (it was half missing), polls (create and vote), idea challenges
(create, submit, vote), marketplace (list an item and buy it with time credits), job alerts,
connections, listing search and filter, taking a listing down, messaging the other party about
an exchange (also missing), voice messages, and notification counts.

Defects found by walking, all fixed and guarded — the pattern is worth internalising:

| What the member saw | What it actually was |
| --- | --- |
| "Listing not found. This item may have been sold, removed, or moved." — about the item they had just created | Moderation is on by default, so a new listing is `pending`; **both** frontends then navigated to a public read that hides it. Fixed in the shared API, so the website was repaired too |
| "1 votes", "1 members", "1 spots left" | 129 count labels had no singular form in any of the seven languages. 903 singulars written; a shrink-only guard now blocks new ones |
| A poll result of 0% and 0% | The server withholds tallies while a poll is open and says so in two different shapes; the app handled neither, and `null + 1` is `1` |
| A job alert that could not be seen, paused or deleted | The list rendered below the bottom of the screen with nothing to scroll — `className` is inert on `SafeAreaView`, so 86 roots across 56 screens had no flex at all |
| Notification cards with no heading, no timestamp, and text cut mid-word | The whole card sat inside a button, and a button caps its own height |
| "10 unread" against 26 unread | The header counted the page it had loaded. The correct total was already served by an endpoint nothing called |
| A 38-second voice note stored as one second, shown as "0:00" | `sendVoice()` passed a literal `0` for the duration. Every voice message ever sent from either frontend was one second long |

🔴 **Read that table as a method, not a list.** Every one was invisible to a green test suite,
and most were invisible to reading the code — they needed a device, a real second account, and
a look at the database afterwards.

### Still to walk — 29 rows, grouped by what they need

**Tier 1, getting in (2 rows) — do these first.** Passkey sign-in, and the "update ready —
restart" prompt. Both are blocked on things this environment cannot supply: a platform
authenticator on the emulator, and a published over-the-air update. Say so rather than
guessing.

🔴 The legal-acceptance gate is CERTIFIED, and how it is wired is worth knowing before
walking anything else: it is attached **per write route**, never to a group. So an unaccepted
member reads the app perfectly and is refused the moment they try to do something. Landing on
the feed unblocked is correct, not a hole.

🔴 Password reset is CERTIFIED, and the local seam is worth knowing: **the mail leg cannot
complete here, and that is correct behaviour.** The reset token is stored only AFTER the mailer
accepts the message, deliberately, so a mail outage cannot silently invalidate a link the
member already has. With no SMTP in the container the send returns false, no token is written,
and a warning is logged. To walk the reset screen anyway, insert a `password_resets` row whose
stored token column holds the SHA-256 of a plaintext you keep, then open the reset deep link
carrying that plaintext.

🔴 Registration is now CERTIFIED and it was the worst offender found all day: **the account
was created and the app said the request had timed out.** Registration does an MX lookup and a
breach-database check before it can answer, so the ordinary 15-second mutation timeout fired on
a request the server completed. A member who believes that message and tries again is told the
address is taken. Expect more of this shape wherever the server does slow external work.
🔴 Also worth knowing before walking any auth journey: **a `.local` email address cannot
register**, because the MX check correctly refuses it. Every fixture account was seeded
directly, which is why nobody had hit this.

🔴 Journey 1.8 was the top of this list and is now CERTIFIED — reproduced deliberately by
deleting the member's refresh sessions, and it behaves correctly: sign-in screen, "your session
has expired", no request loop. **The BROKEN status predated the fix; the repair had landed and
nobody had checked it.** Worth expecting more of that: a status recorded before a rewrite is a
claim about the past, not the present.

**Volunteering (2 rows).** Shift sign-up, shift swap request and response.

**Events (1 row).** Attendance / check-in.

**Community modules (3 rows).** Apply for a job (needs a vacancy created first — the local
fixture has none), poll and ideation edge cases.

**Money (2 rows).** Pending in / out, and the transaction detail view — which **does not
exist on any frontend**, so the row is a question for the owner: build it, or drop the row and
remove the tap target that implies it.

**Cross-cutting (7 rows).** Screen reader, touch-target sizes, right-to-left, the offline
check-in queue on a real dropped connection, start-up budget, and **iOS, which has never been
built or run**.

**Known-missing capabilities (2 BROKEN rows), both owner decisions:**

- **2.9 Write a post to the community feed.** No composer exists. The server route and the
  website composer both do.
- **3.20 Report a problem with an exchange.** Not possible anywhere on the platform — the only
  dispute route is a broker *resolving* one, and the general support report cannot name an
  exchange. Needs an endpoint, a structured target, moderation routing and notifications, with
  safeguarding implications.
- **6.12 Transaction detail view.** See Money above.

## What I would add to the plan — chief-engineer view

These are not journeys. They are the things I think will decide whether this ships well, and
none of them is currently on any list.

### 1. A server-side change can break the app with no mobile check running

🔴 **Correcting my own first draft of this document, which said CI does not run the mobile
suite at all. It does** — the `Android Native Release Gate` job runs `type-check`,
`test:coverage --runInBand`, the coverage ratchet, `expo-doctor` and `drift:check`, and it
passed on the commits from this session. The job's name says nothing about tests, which is how
I misread it. Do not repeat that mistake: read the steps, not the job name.

The real gap is narrower and worth fixing. That job only runs when `.github/ci-paths.yml`
says a change touched `mobile/**`, `contracts/**`, `react-frontend/src/routes/**`, `routes/**`
or the CI files themselves. **A change to shared PHP that the app depends on does not wake
it.** This session's voice-duration fix is the proof: the defect lived in
`app/Http/Controllers/Api/MessagesController.php`, a path that is deliberately not on the
mobile watch list — so a one-line server change silently decided what every voice message on
every phone was worth, and no mobile check would ever have run on the commit that introduced
it.

The path filter is right to be narrow; dragging the mobile job into every PHP commit would be
worse. The proportionate answers are (a) add the specific API controllers the app depends on
most to the mobile watch list, or (b) rely on the nightly sweep and accept the lag, but say so
explicitly. Either way it should be a decision, not an accident. The same blind spot has
already cost this platform once — `.github/ci-paths.yml` records the accessible frontend
running 19 routes behind for over a week for exactly this reason.

### 2. The local fixture is now dirty, and Phase 2 depends on it being clean

Walking forty journeys has permanently changed tenant 2: balances moved, listings and orders
and polls and challenges created, a listing deleted. Consequences already visible — the
committed pixel baseline for the wallet screen no longer matches, because it prints balances.
Phase 2 (automating the 41 PROVEN rows into a device flow) cannot be repeatable on a fixture
that drifts every time someone walks a journey. **Build a reset-and-seed script for tenant 2**,
re-capture the visual baselines against it, and treat "the fixture is a known state" as a
precondition of automation rather than an afterthought.

### 3. A systematic audit for fields the client collects but never sends

The voice-duration bug has a shape worth hunting: the app measured the value, showed it to the
member, and dropped it on the way to the server, which then substituted a plausible default.
That is invisible to every kind of test we run. **Diff what each API endpoint accepts against
what the mobile client actually sends.** One look found a bug that made every voice message on
the platform one second long.

### 4. Assume a mobile defect is a platform defect until checked

Three of the defects above were in shared code or shared behaviour, and fixing the mobile
symptom alone would have left the website broken. The marketplace one was repaired for both
frontends by one change to the API. **When a walk finds a defect, check the website for the
same fault and say so in the commit.**

### 5. Accessibility is not a late polish item here

Three cross-cutting rows (screen reader, touch targets, right-to-left) have never been
attempted, and `ar` is blocked outright because no right-to-left support exists. This platform
runs a GOV.UK-based accessible frontend precisely because accessibility is a stated value.
Shipping a native app with no screen-reader pass would be inconsistent with that, and
retrofitting is much more expensive than building it in. **Move at least the screen-reader and
touch-target rows ahead of the remaining feature journeys.**

### 6. iOS is a scope decision, not a journey

"The app runs on iOS" sits in the ledger as one row worth the same as "vote in a poll". It is
not one row of work: it is a second platform, a second store account, a second review process
and a second set of layout bugs. **The owner should decide explicitly whether iOS is in scope
for the first release.** If it is, the estimate roughly doubles and a Mac build path is needed.
If it is not, say so in the ledger and stop counting it.

### 7. Plural rules beyond one and other

The 903 singulars added cover `_one` and `_other`. Irish genuinely has five plural categories
and Arabic six. Irish currently falls back to the bare key for 2 and above, which is
acceptable but not correct. Worth recording as known debt rather than discovering it from a
member.

### 8. The 43 remaining plural exemptions and the quarantine list are both ratchets

Both shrink only, and both are enforced. Do not add to either without lowering the budget in
the same commit — the mechanism exists precisely because a tolerance that can grow is not a
gate.

## Getting started in a new session

Read [`MOBILE_TEST_HARNESS.md`](MOBILE_TEST_HARNESS.md) before touching a device — it has the
two-emulator cold start, the fixture accounts, and the traps. The short version:

```bash
cd mobile
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
# Two emulators: nexus_test (5554) and nexus_test_b (5556) — two accounts, two devices.
for s in emulator-5554 emulator-5556; do
  adb -s $s reverse tcp:8090 tcp:8090   # Laravel API
  adb -s $s reverse tcp:8081 tcp:8081   # Metro
done
npx expo start --port 8081
```

The debug APK loads its JavaScript from Metro at runtime, so the native build can be weeks old
and both devices still run the source being edited. 🔴 After editing, **force-stop and relaunch**
before believing a device result — a fast refresh does not always land, and a stale bundle
looks exactly like a fix that did not work.

Before committing: `npx tsc --noEmit`, `npx jest`, `node scripts/check-doc-scores.mjs` and
`npx --yes markdownlint-cli2@0.23.0` from the repository root. The last one is the only thing
that checks Markdown structure and is not part of preflight — a missing table pipe failed CI
once already.

## Standing constraints

- Never deploy, and never push to the `backup` remote, without being told to.
- Ask before every `git push`. Plan approval is not push approval.
- Stage only the files for the task in hand; never `git add -A` or `git add -u`. Another
  session shares this checkout and has uncommitted work in it.
- Owner-external actions — creating a Sentry project, EAS environment variables, a Play
  service account — are **recommended, never performed**.
- Local fixture data may be changed freely; production never.
- Write to the owner in plain English. Lead with the answer. Never let "it passed" stand in
  for "it ran".
