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

## 2. OPEN — the app shows two different brand colours at once

**Severity: this is the reason the app "looks off". Needs an owner decision.**

The client has two primary colours by construction, and both appear on the same
screen:

| Source | Value | Used by |
|---|---|---|
| `--accent` in `global.css` | indigo/violet, `oklch(0.55 0.20 280)` | every HeroUI `Button`, tab indicator, chip |
| `usePrimaryColor()` | **the tenant's own brand colour** (blue for `hour-timebank`), falling back to `#006FEE` | 115 files that colour something themselves |

### It happens INSIDE single controls, 128 times

The second pass found the sharpest example of this, and it is worse than "different
components disagree". On the Wallet screen:

> **The Back button's arrow is blue and the word "Back" is purple.** One button.

The cause is a pattern repeated throughout the app:

```tsx
<HeroButton variant="secondary" onPress={onBack}>
  <Ionicons name="arrow-back-outline" size={16} color={primary} />  {/* tenant blue */}
  <HeroButton.Label>{t('…')}</HeroButton.Label>                     {/* HeroUI indigo */}
</HeroButton>
```

The icon is explicitly given the tenant's colour; the label is left to HeroUI and
gets the indigo accent. **Counted across `app/` and `components/`: 128 controls in
48 files** pair a tenant-coloured icon with a HeroUI-coloured label. Worst offenders:

| Controls | File |
|---|---|
| 10 | `components/federation/FederationDirectoryScreen.tsx` |
| 9 | `app/(modals)/event-detail.tsx` |
| 8 | `app/(modals)/group-detail.tsx` |
| 7 | `app/(modals)/marketplace-detail.tsx` |
| 6 | `app/(modals)/job-detail.tsx` |
| 6 | `app/(modals)/wallet.tsx` |

### And it is inconsistent even between neighbours

Also seen:

- **Login:** the logo tile is blue, the "Sign in" button is indigo.
- **More:** the card's top bar is blue, "Edit profile" is a blue button, "View
  wallet" has indigo text, the avatar initials are indigo — four brand colours in
  one card.
- **Listings:** "Recommended" is a blue pill, "Newest" is indigo text, "Near me" and
  "Filters" are indigo, the "All" tab underline is indigo while its icon is blue.
- **Wallet:** "Send credits" is a blue button, "Donate" beside it has an indigo
  label and a blue heart.
- **Feed:** icons blue, the "For You" underline indigo, "View post" indigo.

Some buttons *are* forced to the tenant colour with an explicit
`style={{ backgroundColor: primary }}` — Polls' "Create poll" and Listings' "+" are
correctly blue. That workaround exists in some places and not others, which is what
makes the result look careless rather than merely purple.

**Dark mode has the same split**, with the indigo lightened: the Sign in button is
light violet against the same blue logo.

**Why it happens.** App code never writes `bg-accent` — only 2 files reference those
tokens. The indigo comes from inside HeroUI Native's own components, which resolve
`--accent` from the compiled stylesheet. Nothing ever overrides it with the tenant's
colour.

**The web app fixed exactly this**, deliberately.
`react-frontend/src/contexts/ThemeContext.tsx` sets `--accent` at runtime from the
tenant's colour, commented *"Keep NEXUS and HeroUI v3 on one runtime accent
source."* Mobile has the same two sources and no such bridge.

🔴 **Mobile cannot currently do the same thing.** Checked, rather than assumed:

- `uniwind@1.7.0` exports `useCSSVariable` (a reader) and `ScopedTheme`, which only
  swaps between *named* themes. There is no runtime setter for an arbitrary colour.
- `heroui-native@1.0.4`'s `HeroUINativeProvider` accepts `animation`, `toast`,
  `devInfo` and text props — **no colours or theme override** (its own type
  definitions say "Additional configuration options can be added in future
  versions").

**This matters more than it looks for a white-label platform.** For
`hour-timebank` the clash is blue-versus-indigo, which reads as sloppy. For a
community whose brand is green or orange it would be worse, and the tenant's
branding — a core selling point — is silently ignored on mobile.

**Options, none of them free:**

1. **Align the hardcoded `--accent` to the NEXUS brand blue.** One place, removes the
   visible clash for default-branded tenants. Still ignores per-tenant branding, so
   it treats the symptom.
2. **Drop `usePrimaryColor()` from the chrome and let indigo be the only accent.**
   Consistent immediately, but removes per-tenant branding from mobile — a product
   regression on a multi-tenant platform.
3. **Build a per-tenant accent properly** — either a small accent context that
   wrapped components consume explicitly, or wait for runtime CSS-variable support
   in uniwind. The correct answer, and the largest.

Deliberately **not** changed here: any of these repaints every screen in the app,
and choosing between "consistent" and "per-tenant branded" is a product call.

🔴 **Do not fix the 128 split controls before that decision is made.** The repair for
a split control is to put its icon and its label on the same colour source — but
*which* source is exactly what is undecided. Doing it now means either touching 128
sites twice or guessing on the owner's behalf.

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

Of the two systemic findings, **content sliding under the clock is now fixed**. The
brand-colour split is the one that remains, and it is a single decision rather than a
long list of repairs — 128 controls become consistent the moment it is made.
