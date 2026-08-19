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

Coverage: **31 screens in light and 31 in dark**, of 33 attempted (second pass,
2026-08-19). The first pass reached only 16 of 26 — see
[How the sweep was made reliable](#how-the-sweep-was-made-reliable) for what was
wrong with it. Still not a complete audit — see
[Gaps in this pass](#gaps-in-this-pass).

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

## 3. OPEN — scrolled content slides under the clock

On any scrollable screen, content scrolls up behind the status bar with nothing
behind it, so member-entered text collides with the clock and battery icons. Clearest
on the registration form, where the "Last name" field and the time overlap and both
become hard to read.

This is systemic rather than one screen's mistake. The app is edge-to-edge — the
default on Expo SDK 54, and required by Android 15 — so the status bar is transparent
and content draws behind it. `app/_layout.tsx` sets `<StatusBar style={…} />`, which
only chooses the icon colour; nothing paints a background. Screens do apply
`paddingTop: insets.top`, which correctly positions content at rest but does not
stop it scrolling underneath.

The usual fix is a small scrim or an opaque strip the height of the inset behind the
status bar. Not applied here because it belongs in the root layout and affects every
screen in the app — worth doing deliberately rather than as a side-effect of a bug
hunt.

---

## 4. OPEN — the feed's filter row is clipped mid-word

On the Community Feed the horizontal filter chips (`All`, `Following`, `Saved`,
`Posts`, `Exchanges`, …) run past the card's right edge and are cut off mid-word —
"Exchan" — with no fade, shadow or partial-chip hint that the row scrolls. It reads
as broken text rather than as scrollable content.

The platform has a `ScrollShadow` pattern for exactly this on the web side. Not
fixed here because it needs a look at the card's padding and the scroller's
`contentContainerStyle` together, rather than a one-line change.

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
- **Only one device size, and default font size.** No small phone, no tablet, no
  large-text setting — and large text is where clipped labels usually appear, so this
  is a likely source of further findings.
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

The two systemic findings above — the brand-colour split and content sliding under
the clock — account for most of what makes the app feel unfinished, and both are
single decisions rather than long lists of repairs.
