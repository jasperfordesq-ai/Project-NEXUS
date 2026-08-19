<!--
Copyright © 2024–2026 Jasper Ford
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile Visual Audit

Last reviewed: 2026-08-19

Findings from looking at the Expo client on an emulator, screen by screen. This
exists because the app was reported as having "quite a lot of visual bugs" and
nothing had ever actually looked: before this, 6 of roughly 137 screens had ever
been photographed, and 3 of those are pixel-compared.

**How the screens were collected.** `npm run screenshot:sweep` drives
`.maestro/screens/sweep-screens.yaml` and drops images in
`screenshots/sweep/<scheme>/`. It is deliberately NOT the pixel-comparison tour
(`capture-screens.yaml` → `screenshots/current/`): the tour needs every screen to
reproduce to 0px and is therefore tiny, while the sweep visits as many screens as it
can and accepts live data, because a person is going to look at the images. Mixing
them would either flood the comparison with false regressions or hold the sweep down
to six screens and find nothing.

Coverage: **31 screens in light, 31 in dark, and 31 at 1.3x text size** — 93 images,
of 33 screens attempted. The first pass reached only 16 of 26; see
[How the sweep was made reliable](#how-the-sweep-was-made-reliable) for what was
wrong with it. Still not a complete audit — see
[Gaps in this pass](#gaps-in-this-pass).

Run a large-text pass with
`adb shell settings put system font_scale 1.3` before `npm run screenshot:sweep`,
and put it back to `1.0` afterwards.

---

## 1. FIXED — an empty grey circle on every listing card

**Severity: real, visible on the most-used list in the app.**

Every card in the Listings tab showed a blank grey circle under the heart. It was
supposed to be a forward arrow.

**Root cause.** HeroUI Native's `Surface` carries `p-4` in its **base** class
(`node_modules/heroui-native/src/components/surface/surface.styles.ts`:
`'p-4 rounded-3xl shadow-surface overflow-hidden'`). Giving a Surface a size does
not reset that padding, so:

```text
size-9  = 36dp
p-4     = 16dp on each side
content = 36 - 32 = 4dp
```

The 18dp arrow was drawn into a 4dp box. It did not error, warn, or vanish — it drew
a few pixels wide, which on a device reads as an empty circle.

**Measured, not guessed.** From the emulator's own view hierarchy
(`maestro hierarchy`), on the same card:

| Icon | Container | Rendered size |
|---|---|---|
| Heart, `size={18}` | `HeroButton` | 45 × 47 px ✓ |
| Arrow, `size={18}` | `Surface` | **10 × 12 px** ✗ |

4dp × 2.625 device density ≈ 10.5px, which matches the measurement exactly and is
what confirmed the diagnosis rather than a plausible-sounding theory.

**Fix.** `p-0` added to the className at `components/ExchangeCard.tsx`. Verified on
the device afterwards: the arrow now measures **48 × 50 px** and is visible in the
screenshot.

**Guarded.** `components/surfacePadding.test.ts` scans `app/` and `components/` for
a `Surface` with a small fixed size (≤ 64dp), children, and no padding declared, and
prints the offending file, line and fix. It was verified to go red when the fix is
reverted.

🔴 **A component test cannot catch this class of bug.** The child renders, the tree
is correct, and Jest has no layout engine to notice the box is 4dp wide. It was
found by looking at a picture. That is the argument for keeping the sweep.

---

## 1a. FIXED — a rounding value that was never defined (and a corrected count)

🔴 **This entry exists partly to correct an earlier overstatement of my own.** The
first report of this said "632 square corners". That number was wrong, and the way it
was wrong matters more than the fix.

**The fault was real.** `rounded-panel` (391 uses) and `rounded-panel-inner` (241) —
625 class-attribute uses across 99 files — were defined **nowhere**: not in
`global.css`, not in `tailwind.config.js` (which contains only a `content` array), not
in `heroui-native`, not in `react-frontend`, and not at any point in this repository's
git history. The classes were written against a convention that was never created, and
Tailwind v4 emits nothing for an unknown utility without warning.

**But the damage was much smaller than the usage count**, because HeroUI's `Surface`,
`Card` and `Button` all carry `rounded-3xl` (24px) in their own base classes. An inert
class on one of those still leaves a rounded corner. Measured by classifying every use
by the element it sits on:

| Uses | Element | Actual effect |
|---|---|---|
| 382 | Surface / Card / Button asking for `panel` | **No defect** — wanted 24px, already had 24px |
| 171 | Surface / Card / Button asking for `panel-inner` | 8px too round — wanted ~16px, got 24px |
| **69** | plain `View` / `Image` / `NativePressable` | **Genuinely square** |

So the honest scale is **69 square corners and 171 wrong ones**, not 625. The
inflated figure is worth recording because it would invite someone to rip the whole
convention out rather than define it — and because "the class is used 625 times and
resolves to nothing" is a true sentence that leads to a false conclusion about impact.

**Fix.** `--radius-panel: 1.5rem` and `--radius-panel-inner: 1rem` in the `@theme`
block of `global.css`. `panel` deliberately matches HeroUI's own 24px surface radius,
so the 382 accidentally-correct uses render exactly as before and the change is
confined to the 240 that were wrong.

**A third finding came out of the guard.** `rounded-button`, used once in
`exchange-detail.tsx`, was also undefined. Removed rather than turned into a
single-use token: `HeroButton size="sm"` already applies `rounded-3xl`, which is what
it was reaching for.

**Guarded** by `lib/theme/panelRadius.test.ts`, which scans class attributes across
`app/` and `components/` and fails when any `rounded-*` utility is not defined in
`global.css`, naming it and the file it appears in. It also asserts `panel-inner`
stays smaller than `panel`, and that `panel` stays at HeroUI's 24px.

🔴 Two flaws in the first version of that guard, both worth knowing because both are
the same trap as the bug it protects against — **a check that appears to pass while
examining the wrong thing**:

1. It scanned raw file text, so it matched `rounded-button` inside the code comment
   explaining why that utility had been removed, and reported a utility the app no
   longer uses. Now restricted to class-attribute values, which is the accurate scope.
2. `rounded-t-[30px]` stripped to an empty string and was reported as a phantom
   utility named `''`. Empty and arbitrary values are now skipped.

---

## 1b. FIXED — colours that had already failed a contrast check were still in use

Five colour values were replaced on 2026-08-18 for failing WCAG AA. The literals were
left behind in six places, three of them filling a 72×72 tile behind a white icon on
the **password-recovery screens** — exactly where a member who is already locked out
has to read something:

- `app/(auth)/forgot-password.tsx`, `app/(auth)/reset-password.tsx`,
  `app/(auth)/verify-email.tsx` — `#16A34A` / `#DC2626` tile backgrounds, replaced with
  `theme.success` / `theme.error`. White-on-token measures 5.8:1 and 6.5:1.
- `app/(modals)/edit-exchange.tsx`, `app/(modals)/new-exchange.tsx`,
  `app/(modals)/notifications.tsx` — dead `theme.warning ?? '#d97706'` and
  `theme.info ?? '#3b82f6'` fallbacks, now just the token.

**Every field on the `useTheme()` object is required**, so *every* `theme.X ?? literal`
in this app is dead code that can never execute — there are roughly a dozen more of
them (`job-analytics.tsx`, `job-detail.tsx`, `jobs.tsx`, `support.tsx`,
`settings.tsx`, `blog-post.tsx`, …). The remainder are harmless but misleading, and
are folded into the colour-token cleanup rather than done piecemeal here.

Two decorative uses are deliberately **left alone**: `quick-create.tsx` (`#16a34a`)
and `(tabs)/profile.tsx` (`#3b82f6`) are per-item icon tints in a menu, part of the
~160-value decorative palette that needs a named token group and a design decision,
not a mechanical swap.

---

## 2. FIXED — the app showed two different brand colours at once

**This section said OPEN, "needs an owner decision", and "do not fix the 128 split
controls before that decision is made". All three are now out of date: the decision was
taken and the work is done. The original analysis is summarised rather than deleted,
because the reasoning behind the chosen option still governs how new controls are built.**

### What was wrong

The client had two primary colours by construction, and both appeared on the same screen:

| Source | Value then | Used by |
|---|---|---|
| `--accent` in `global.css` | indigo/violet, `oklch(0.55 0.20 280)` | every HeroUI `Button`, tab indicator, chip |
| `usePrimaryColor()` | the tenant's brand colour, falling back to `#006FEE` | 115 files that colour something themselves |

The sharpest example was inside a *single* control: on the Wallet screen the Back
button's arrow was blue while the word "Back" was purple. **128 controls across 48 files**
paired a tenant-coloured icon with a HeroUI-coloured label. App code never wrote
`bg-accent` — the indigo came from inside HeroUI Native's own components resolving
`--accent` from the compiled stylesheet, with nothing overriding it.

### Why the obvious fix was impossible, and still is

The web app solves this by setting `--accent` at runtime from the tenant's colour
(`react-frontend/src/contexts/ThemeContext.tsx`). Mobile cannot: `uniwind` exports only a
*reader* for CSS variables plus `ScopedTheme`, which swaps between **named** themes, and
`heroui-native`'s provider accepts no colour override at all. There is no runtime setter
for an arbitrary colour. That constraint is unchanged and is why the solution took the
shape it did.

### What was actually done

1. **The default `--accent` was aligned to the NEXUS brand blue** in both schemes, so a
   default-branded community has one accent rather than two. `global.css` now carries a
   comment tying it to `FALLBACK_PRIMARY`, and `lib/theme/defaultAccent.test.ts` fails if
   the two drift apart.
2. **Per-community accents are real, via generated named themes.** `config/tenant-palettes.json`
   feeds `scripts/generate-tenant-themes.mjs`, which emits one uniwind theme per community
   per scheme; `themeStore.setTenant()` switches to it. An unregistered community falls
   back to the default rather than throwing, so a community that signs up after a build
   shipped looks deliberately plain instead of crashing.
3. **Icons now follow their label** rather than being coloured independently.
   `components/ui/AccentIcon.tsx` is used in **38 files**, and
   `components/accentIconColour.test.ts` holds the rule.
4. **~170 redundant accent overrides were swept**, and the dark-mode lift question was
   settled — see commits `5252ab413` and `cff1c30de`.

### What the owner still has to decide

🔴 **`config/tenant-palettes.json` holds a palette for `agoris` only — 1 of 11
communities.** The other ten therefore render in the default NEXUS blue. That is not a
bug and will not fail a gate; it is simply missing information that only the owner can
supply. Adding a palette needs a rebuild or an over-the-air update, not a store release.

### What is still open here

A residual ~160 decorative colour values (ambers, greens, slate greys) are unrelated to
the accent clash and are recorded in "Gaps in this pass" below.

---

## 3. FIXED — scrolled content slid under the clock

On every scrollable screen, content scrolled up behind the status bar with nothing
between them, so a member's own typing collided with the clock and battery icons and
both became hard to read. Worst on the registration form, where the surname field and
the time overlapped.

Systemic, not one screen's mistake. The app draws edge-to-edge — the default on Expo
SDK 54 and required by Android 15 — so the status bar is transparent and the window
extends underneath it. `<StatusBar style={…} />` only chooses whether the system icons
are drawn light or dark; it paints no background. Screens do set
`paddingTop: insets.top`, which positions content correctly **at rest** but cannot
stop it scrolling up underneath.

**Fix.** An opaque strip the height of `insets.top`, painted in `theme.bg`, added to
`ThemedShell` in `app/_layout.tsx`. It sits after `<RootNavigator>` so it paints on
top, and carries `pointerEvents="none"` so it never swallows a tap. Its height is the
real inset, so it collapses to nothing on a device without one.

**Verified that it does not hide anything.** The concern with painting over the top of
the app is that it covers content which was previously visible — particularly on
`app/(tabs)/create.tsx`, the one tab screen that applies no top inset of its own. Both
were checked on the device: the Create screen has empty background there, and the More
screen after the fix is pixel-for-pixel the same as the capture taken before it, with
the card's accent bar and "YOUR TIMEBANK SPACE" eyebrow fully visible.

---

## 4. FIXED — the feed's filter row was clipped mid-word

On the Community Feed the horizontal filter chips (`All`, `Following`, `Saved`,
`Posts`, `Exchanges`, …) were cut off mid-word — "Exchan" — with empty space after
them and no hint that the row scrolls. It read as broken text rather than as more
content to the right.

**Fix.** `-mx-4` on the `ScrollView` cancels the Surface's base `p-4` so the row
bleeds to the card's own edge, with `px-4` on the content container keeping the first
chip aligned with the heading above it. A chip cut at the card boundary is the
conventional "scroll for more" cue. Confirmed on the device: the row now runs to the
card edge and the last chip is clipped by the card's rounded boundary rather than
sliced mid-word with a gap behind it.

🔴 **A gradient fade would be better, and `heroui-native` ships `ScrollShadow` for
exactly this** — but it requires a `LinearGradientComponent`, and
`expo-linear-gradient` is not a dependency of this app. Adding a native module and a
rebuild for a fade was not justified; worth revisiting if that dependency arrives for
another reason.

---

## 5. OPEN — signed-out links do not look like links

On the login screen, "Forgot password?" and "Switch community" are bold, near-black
text with no colour, underline or button shape. "Forgot password?" in particular
reads as a heading. "Create account" at least has an outline.

Lower priority than the above, and arguably a design preference rather than a
defect — recorded so it is a decision rather than an oversight.

---

## 6. OPEN — a feed card states the same fact three times

The level-up card renders "E2E UserA reached 3", then "Level 3", then "Reached
Level 3!" — the same information three times in one card, and the first phrasing is
missing the word "Level". A copy fix, in the gamification feed card.

---

## Large text (1.3x): better than expected, one thing to confirm

Large text is where clipped labels usually appear, so this was the most likely source
of further findings. It largely was not:

- **The registration form holds up well.** Every label and field is readable, and "I
  agree to the platform terms and privacy notice." wraps onto two lines instead of
  being truncated.
- **The More menu truncates properly** rather than clipping — long descriptions end
  in an ellipsis ("…members, …") inside their row.
- **The Create screen wraps cleanly**, all six action descriptions onto two lines.
- **Tab-bar labels still fit** at 1.3x — "Messages" and "Listings" are not truncated.

🔴 **One observation, NOT yet confirmed as a defect.** At 1.3x the More screen's
"YOUR TIMEBANK SPACE" eyebrow appeared sliced at the top on a screen that had not been
scrolled. It is *not* caused by the new status-bar strip — that was checked directly,
and at normal text size the same screen is unchanged from before the fix. It may be a
mid-layout capture rather than a real clip. Recorded as something to reproduce
deliberately rather than asserted as a bug.

Not covered: 1.5x and 2.0x, which Android also offers and where wrapping usually gives
out.

---

## How the sweep was made reliable

The first pass reached 16 of 26 screens. Both failures were in the sweep, not the
app, and both are now written into the flow as rules:

1. **Never press `back` to leave a screen.** On Android a `back` with nothing to
   dismiss navigates, and enough of them exit the app. The first version lost 22
   screens that way and photographed the phone's home screen as "the register page".
   Every block now returns to a known state with `launchApp` instead.
2. **Never chain one screen off another.** The first version tapped "More" to reach
   each destination, which worked until the Groups screen — that opens *over* the tab
   bar, so every later `tapOn: "More"` failed and ten screens vanished at once. Each
   block is now independent: relaunch, land on the feed, navigate once, photograph.
   Slower, and it cannot cascade.
3. **Partial text does not match.** Maestro matches the whole text, so "Forgot" never
   matched "Forgot password?" — it warned and did nothing, which reads as success.

Result: 31 of 33 screens, in both schemes. Only "Notifications" is still unreachable
from the More menu.

---

## Not a bug: a light strip down the right edge in dark mode

Worth recording because it looks alarming and is not real. Five dark screenshots show
a pale vertical strip at the right edge. Sampling the same column across all 62
images showed it on the *same five* screens in both schemes — darker than the content
in light mode, lighter in dark. That is the Android scrollbar, which contrasts against
whatever is behind it. Those five are simply the screens that were scrollable at
capture time. The pixel-comparison mode already crops that column for this reason.

---

## Not a bug: the blank More screen

The sweep's `sweep-10-more.png` came out completely blank, which looked like a
serious rendering fault. **It was the sweep's own fault, not the app's.** The
preceding step pressed `back` to leave the Create screen, and on Android a `back`
with nothing to dismiss navigates instead. Reached directly from the feed, the More
screen renders correctly — verified with a separate probe that captured it three
times over 28 seconds.

Recorded because a blank screenshot is exactly the kind of evidence that gets
reported as a P1, and because it is the second time in this codebase that a stray
`back` has produced a convincing false finding (see
`.maestro/09-registration-flow.yaml`).

---

## Gaps in this pass

Honest coverage, so nobody reads this as "the app has been audited":

- **~106 screens still have no picture of any kind.** 31 of roughly 137 are covered.
- **"Notifications" could not be reached** from the More menu and remains
  unphotographed.
- **Only one device size.** No small phone and no tablet. Large text has now been
  swept at 1.3x (see above) but not at 1.5x or 2.0x, where wrapping usually gives out.
- **Nothing was checked against a real phone.** This is an emulator throughout.
- **Screens behind an action are untouched** — anything reached by submitting a form,
  opening a member's profile, or entering a conversation. The sweep only walks
  navigation.
- **No screen was checked for a broken or slow network**, which is where loading and
  error states live.

---

## Worth saying: most screens are fine

This document lists problems, so it reads worse than the app looks. For balance: of
31 screens photographed, most had nothing wrong with them. Polls is a good example —
a clear header, a correctly blue "Create poll" button, and a proper empty state
("No polls yet — when members create polls, they will appear here") rather than a
blank area. The registration form's password hint correctly says "At least 12
characters", matching the real rule.

**Both systemic findings from this sweep are now fixed** — content sliding under the
clock, and the brand-colour split (see section 2, which was rewritten on 2026-08-19 when
the work landed). What remains from the colour work is not a defect but missing
information: ten of the eleven communities have no brand palette recorded, so they render
in the default NEXUS blue until the owner supplies one.

🔴 One finding from a later pass is still open and is not in this sweep's numbering: the
rewards/leaderboard screen paints a blank body despite having its data and no error. It is
recorded as row 9.1 of [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), with the
evidence and what has been ruled out.
