// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The colour that sits ON the accent — for icons, in JavaScript.
 *
 * 🔴 Why this exists. HeroUI Native resolves a button's label colour from the
 * `--accent-foreground` CSS variable, which `scripts/generate-tenant-themes.mjs` computes
 * per community: white on a dark brand colour, near-black ink on a pale one. Icons cannot
 * read that variable. `lib/theme/nativeVectorIconStyling.test.ts` requires Ionicons to use
 * the native `color` prop rather than a className, so an icon inside a primary button had
 * no way to follow its own label and 62 of them simply hardcoded `#fff`.
 *
 * That was already wrong before any theming work: a community whose brand colour is
 * yellow, mint or pale blue gets an INK label — and a white icon beside it, at about 1.4:1
 * against the fill. Invisible, on the primary action of every screen. It only became
 * obvious while considering whether to lighten the accent for dark mode, but it was never
 * a consequence of that.
 *
 * The arithmetic here is deliberately the same as the generator's `foregroundFor()`: the
 * same two candidate colours, the same "take the larger ratio" rule. Two implementations of
 * one decision is a drift risk, so `lib/theme/accentForegroundParity.test.ts` asserts they
 * agree across a spread of brand colours rather than trusting the comment.
 */

import { useSyncExternalStore } from 'react';

import { useOptionalPrimaryColor } from '@/lib/context/TenantContext';
import { themeStore } from '@/lib/theme/themeStore';

/** White, for a dark accent. Matches `oklch(1 0 0)` in the generated CSS. */
export const ACCENT_FOREGROUND_LIGHT = '#ffffff';

/** Near-black ink, for a pale accent. Matches `oklch(0.21 0.03 256)` — slate-900. */
export const ACCENT_FOREGROUND_DARK = '#0f172a';

/**
 * How far a dark-mode accent moves towards white. MUST equal `DARK_LIFT` in
 * scripts/generate-tenant-themes.mjs — the generator lifts the accent before choosing the
 * label, so an icon computing from the UN-lifted colour would pick the opposite one. That is
 * exactly the mismatch that made the lift unsafe before; `accentForegroundParity.test.ts`
 * pins the two together.
 */
export const DARK_LIFT = 0.3;

/** Mix towards white, matching `shift()` in the generator. */
export function liftForDark(hex: string): string {
  const clean = hex.replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return '#' + [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16))
    .map((c) => Math.round(c + (255 - c) * DARK_LIFT).toString(16).padStart(2, '0'))
    .join('');
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/**
 * Resolve the readable foreground for an arbitrary accent colour.
 *
 * Exported separately from the hook so the parity test can compare it against the
 * generator without rendering anything.
 */
export function accentForegroundFor(accentHex: string): string {
  // Guard a malformed value rather than throwing inside a render: an unparseable colour
  // yields luminance NaN, and NaN comparisons would silently pick ink on everything.
  if (!/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accentHex)) return ACCENT_FOREGROUND_LIGHT;

  const onWhite = contrastRatio(accentHex, ACCENT_FOREGROUND_LIGHT);
  const onInk = contrastRatio(accentHex, ACCENT_FOREGROUND_DARK);

  // The larger ratio wins. Not "white unless it fails 4.5" — at the crossover a colour can
  // miss 4.5 on both, and then the better of the two is the only sensible answer.
  return onWhite >= onInk ? ACCENT_FOREGROUND_LIGHT : ACCENT_FOREGROUND_DARK;
}

/**
 * The colour an icon should use inside a primary (accent-filled) button, so it matches the
 * label beside it.
 *
 * Use this instead of `color="#fff"`. Guarded by
 * `components/accentIconColour.test.ts`.
 */
export function useAccentForeground(): string {
  // The NON-throwing reader on purpose. An icon must not make its screen require a
  // TenantProvider — see useOptionalPrimaryColor for what happened when it did.
  const accent = useOptionalPrimaryColor();

  // 🔴 Subscribed to the store DIRECTLY rather than through `useThemeController`. Four test
  // suites mock `@/lib/hooks/useTheme` with only the exports they happen to use, so reaching
  // for another one from that module broke them with "useThemeController is not a function".
  // An icon should not be that easy to knock over: the store is the source of truth and has
  // no mock surface.
  const scheme = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getSnapshot);

  // 🔴 Lift FIRST, exactly as the generator does, then choose. The fill in dark mode is the
  // lifted colour, so computing from the raw brand colour would pick the opposite label —
  // a white icon beside dark text, which is the precise mismatch that made the dark-mode
  // lift unsafe until now.
  const onFill = scheme === 'dark' && /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent)
    ? liftForDark(accent)
    : accent;

  return accentForegroundFor(onFill);
}
