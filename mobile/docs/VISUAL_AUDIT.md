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

Coverage of this pass: **16 screens reached of 26 attempted**, light scheme only.
Not a complete audit — see [Gaps in this pass](#gaps-in-this-pass).

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

Seen in this pass:

- **Login:** the logo tile is blue, the "Sign in" button is indigo.
- **More:** the card's top bar is blue, "Edit profile" is a blue button, "View
  wallet" has indigo text, the avatar initials are indigo — four brand colours in
  one card.
- **Listings:** "Recommended" is a blue pill, "Newest" is indigo text, "Near me" and
  "Filters" are indigo, the "All" tab underline is indigo while its icon is blue.
- **Feed:** icons blue, the "For You" underline indigo, "View post" indigo.

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

---

## 3. OPEN — the feed's filter row is clipped mid-word

On the Community Feed the horizontal filter chips (`All`, `Following`, `Saved`,
`Posts`, `Exchanges`, …) run past the card's right edge and are cut off mid-word —
"Exchan" — with no fade, shadow or partial-chip hint that the row scrolls. It reads
as broken text rather than as scrollable content.

The platform has a `ScrollShadow` pattern for exactly this on the web side. Not
fixed here because it needs a look at the card's padding and the scroller's
`contentContainerStyle` together, rather than a one-line change.

---

## 4. OPEN — signed-out links do not look like links

On the login screen, "Forgot password?" and "Switch community" are bold, near-black
text with no colour, underline or button shape. "Forgot password?" in particular
reads as a heading. "Create account" at least has an outline.

Lower priority than the above, and arguably a design preference rather than a
defect — recorded so it is a decision rather than an oversight.

---

## 5. OPEN — a feed card states the same fact three times

The level-up card renders "E2E UserA reached 3", then "Level 3", then "Reached
Level 3!" — the same information three times in one card, and the first phrasing is
missing the word "Level". A copy fix, in the gamification feed card.

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

- **10 of 26 attempted screens were not reached.** After the Groups screen the tab
  bar was no longer tappable — that screen opens over it — so Exchanges, Explore,
  Volunteering, Notifications, Settings, Profile and the listing-detail screens were
  never photographed. The wallet block also failed. The sweep flow needs a reliable
  way back to the tab bar before those can be covered.
- **Dark mode has not been swept at all.** Every finding above is light scheme.
- **Only one device size.** No small phone, no tablet, no large font setting — and
  large text is where clipped labels usually appear.
- **~121 screens still have no picture of any kind.**
- Nothing here was checked against a real phone; this is an emulator.
