// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// THEMING CONVENTION (read me)
//
// HeroUI Native does NOT theme through a provider prop — its tokens are uniwind
// CSS variables, overridden in `mobile/global.css` (the indigo-glow palette
// that mirrors the web app's `react-frontend/src/styles/tokens.css`). So the
// single source of truth for colours is global.css.
//
// PREFER HeroUI / Tailwind className tokens in components — they resolve to the
// values below automatically and support light/dark out of the box:
//   bg-background, bg-surface, text-foreground, text-muted-foreground,
//   border-border, and the <Surface> component for elevated panels.
//
// This `useTheme()` hex hook is the bridge for code that still needs a literal
// colour (e.g. a third-party `style={{ backgroundColor }}` such as gorhom's
// BottomSheetFlatList, or a chart). Its values are kept IN SYNC with global.css
// so token-based and inline-styled UI render identically — no more clashing
// neutral-grey vs indigo surfaces. Reserve genuinely dynamic per-tenant colours
// (the brand primary) for `usePrimaryColor()` from `@/lib/hooks/useTenant`.
//
// When touching a component, migrate its inline `theme.*` to className tokens
// where one exists; this hook is the fallback, not the default.
//
// The hook is reactive: it reads the resolved scheme from `themeStore` via
// `useSyncExternalStore`, so flipping light/dark in Settings re-renders every
// consumer alongside the Uniwind className tokens. With no startup wiring (e.g.
// in unit tests) the store defaults to 'dark', preserving prior behaviour.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';

import { themeStore, type ThemeMode } from '@/lib/theme/themeStore';

// 🔴 LIGHT-MODE TEXT COLOURS ARE CONTRAST-COMPUTED, NOT PICKED BY EYE (2026-08-18).
// Five of these failed WCAG AA before that date, measured against the very
// surfaces they are drawn on — textMuted was 2.45:1, barely half the 4.5
// requirement, on every muted label in the app. The replacements are the same
// values the web frontend derived in 6307b7dda: the lightest shade of each hue
// that still clears 4.5:1 on the DARKEST surface it appears on, so the platform
// keeps as much colour as the requirement allows and the two surfaces agree.
//   textMuted 2.45 → 4.55   error 3.95 → 5.30   success 2.91 → 5.13
//   info      4.24 → 4.99   warning 3.04 → 5.36
// `lib/hooks/useTheme.contrast.test.ts` recomputes every pair and FAILS below
// 4.5:1. Do not restore a lighter shade to "match a design" without changing
// that test — and if you change it, you are choosing to ship unreadable text.
export const LIGHT = {
  bg: '#F8FAFC',           // --background (web light)
  surface: '#FFFFFF',      // --surface-solid
  border: '#E2E8F0',       // --border-default ≈ rgba(0,0,0,0.08) on white (slate-200)
  borderSubtle: '#F1F5F9', // slate-100
  text: '#1E293B',         // --foreground (slate-800)
  textSecondary: '#475569',// --foreground-muted (slate-600)
  textMuted: '#64748B',    // slate-500 — was slate-400 #94A3B8 at 2.45:1 (FAILED)
  onPrimary: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.5)',
  error: '#bf0025',        // web light --text-danger — was #DC2626, 3.95 on errorBg
  errorBg: '#FEE2E2',
  success: '#00753c',      // web light --text-success — was #16A34A, 2.91 on successBg
  successBg: '#D1FAE5',
  info: '#0059db',         // web light --text-info — was #2563EB, 4.24 on infoBg
  infoBg: '#DBEAFE',
  warning: '#aa4c00',      // web light --text-warning — was #D97706, 3.04 on bg
} as const;

// Dark mode was already in good shape and is deliberately left almost alone —
// eleven of its thirteen text pairs passed comfortably. Only the two that
// actually failed were touched (2026-08-18):
//   textMuted on surface 4.32 → 5.22   info on infoBg 3.13 → 4.91
export const DARK = {
  bg: '#0A0A0F',           // --background (web dark) — matches global.css --background
  surface: '#16162A',      // --surface-dropdown (solid elevated indigo-dark)
  border: '#24242E',       // --border-default ≈ rgba(255,255,255,0.10) on bg
  borderSubtle: '#1A1A24',
  text: '#EDEDED',         // --foreground (web dark)
  textSecondary: '#A8A8B4',// --foreground-muted ≈ rgba(237,237,237,0.7)
  textMuted: '#8A8A99',    // was #7C7C8A — 4.32:1 on surface (FAILED)
  onPrimary: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.6)',
  error: '#FF453A',
  errorBg: '#2D1B1B',
  success: '#22C55E',      // web dark --color-success
  successBg: '#052E16',
  info: '#51a2ff',         // web dark --text-info — was #3B82F6, 3.13 on infoBg
  infoBg: '#1A3252',       // darkened from #1E3A5F so info clears 4.5:1 on it
  warning: '#F59E0B',      // web dark --color-warning
} as const;

export type Theme = { [K in keyof typeof LIGHT]: string };

export function useTheme(): Theme {
  const scheme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getSnapshot,
  );
  return (scheme === 'light' ? LIGHT : DARK) as Theme;
}

/**
 * Theme controller for settings UI: the user's chosen `mode`, the resolved
 * `scheme` that is currently painting, and a `setMode` setter. Reactive via
 * `useSyncExternalStore`, so the selector reflects external/system changes too.
 */
export function useThemeController(): {
  mode: ThemeMode;
  scheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
} {
  const scheme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getSnapshot,
  );
  const mode = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getMode,
    themeStore.getMode,
  );
  return { mode, scheme, setMode: themeStore.setMode };
}
