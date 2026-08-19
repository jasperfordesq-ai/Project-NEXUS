// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// THEME STORE
//
// A tiny framework-agnostic store that owns the app's colour scheme. It is the
// single source of truth that `useTheme()` (hex bridge) and Uniwind className
// tokens both read from, so token-based and inline-styled UI always agree.
//
// Why a module store instead of React context: `useTheme()` is called by ~200
// components and by tests that render those components WITHOUT any provider.
// Backing it with `useSyncExternalStore` keeps it provider-free — it simply
// returns the current scheme (defaulting to 'dark', preserving the previous
// dark-only behaviour in tests) and re-renders when the scheme changes.
//
// `mode` is the user's choice ('system' | 'light' | 'dark'); `scheme` is the
// resolved 'light' | 'dark' that actually paints. When mode is 'system' the
// scheme follows the OS appearance.
// ---------------------------------------------------------------------------

import { Appearance } from 'react-native';
import { Uniwind, type ThemeName } from 'uniwind';

import { storage } from '@/lib/storage';
import { STORAGE_KEYS } from '@/lib/constants';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

const VALID_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

// Default to dark so the synchronous first render (and every test that renders
// a component using useTheme without calling configureNativeTheme) matches the
// app's historical dark-only appearance. configureNativeTheme() overrides this
// with the real system/persisted scheme at startup.
let mode: ThemeMode = 'system';
let systemScheme: ColorScheme = 'dark';

/**
 * The community whose accent colour should paint, or null for the platform default.
 *
 * Set once the tenant is known (see TenantContext). It exists because HeroUI Native
 * resolves its accent from a CSS variable that uniwind compiles at BUILD time, and
 * neither library can change an arbitrary colour at runtime — so the only lever is
 * switching to a theme that was registered when the bundle was built.
 */
let tenantSlug: string | null = null;

const listeners = new Set<() => void>();

function resolve(): ColorScheme {
  return mode === 'system' ? systemScheme : mode;
}

// Cached snapshot so getSnapshot() returns a referentially-stable value between
// changes — required by useSyncExternalStore to avoid render loops.
let snapshot: ColorScheme = resolve();

function recompute(): void {
  const next = resolve();
  if (next !== snapshot) {
    snapshot = next;
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Push the resolved scheme into Uniwind (className tokens) and React Native
 * Appearance (so useColorScheme()/native controls follow). When the user picks
 * 'system' we hand control back to the OS by clearing the JS override.
 */
/**
 * The uniwind theme to apply: a community-specific one when that community's colours
 * were built into this bundle, otherwise the platform default.
 *
 * 🔴 The membership check is the whole safety story. A community that signs up after
 * this build shipped has no theme registered, and `Uniwind.setTheme()` THROWS on an
 * unregistered name (`node_modules/uniwind/src/core/config/config.common.ts`). Falling
 * back to the platform default means a new community sees consistent default colours —
 * which reads as deliberate — instead of a crash on launch. The fix for them is a
 * palette entry plus an over-the-air update, not an app-store release.
 */
/**
 * Narrows an arbitrary string to a theme uniwind actually has.
 *
 * uniwind generates a union of registered theme names into `uniwind-types.d.ts`, so
 * `setTheme` will not accept a computed string. That type is genuinely useful — it is
 * why a typo in a theme name fails the build rather than at launch — so this guard
 * checks membership against the runtime list and confines the assertion to one place
 * where the check has just been performed.
 */
function isRegisteredTheme(name: string): name is ThemeName {
  return (Uniwind.themes as readonly string[]).includes(name);
}

function resolveThemeName(scheme: ColorScheme): ThemeName {
  if (!tenantSlug) return scheme;
  const candidate = `t-${tenantSlug}-${scheme}`;
  return isRegisteredTheme(candidate) ? candidate : scheme;
}

function applyScheme(): void {
  const scheme = resolve();
  Uniwind.setTheme(resolveThemeName(scheme));

  // 🔴 Order matters, and this line must stay AFTER setTheme. Switching to a theme
  // whose name is not 'light'/'dark' makes uniwind write `unspecified` to Appearance
  // to leave adaptive mode; re-asserting here keeps useColorScheme() and native
  // controls on the scheme this store actually resolved.
  Appearance.setColorScheme(mode === 'system' ? null : scheme);
}

export const themeStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Resolved scheme that should paint right now. Stable between changes. */
  getSnapshot(): ColorScheme {
    return snapshot;
  },

  getMode(): ThemeMode {
    return mode;
  },

  /**
   * Point the accent at a community's own brand colour.
   *
   * Called when the tenant resolves (and again with null on sign-out / community
   * switch). Safe to call with an unknown slug: `resolveThemeName` falls back to the
   * platform default rather than throwing, so a community that signed up after this
   * bundle shipped simply gets default colours until an over-the-air update carries
   * its palette.
   */
  setTenant(slug: string | null): void {
    const next = slug && slug.trim() ? slug.trim().toLowerCase() : null;
    if (next === tenantSlug) return;
    tenantSlug = next;
    applyScheme();
    emit();
  },

  /** The community slug currently driving the accent, or null for the default. */
  getTenantSlug(): string | null {
    return tenantSlug;
  },

  /**
   * Whether this bundle actually carries a theme for a community. Exposed so the app
   * can report a missing palette (a stale build) rather than silently looking generic.
   */
  hasThemeFor(slug: string): boolean {
    return isRegisteredTheme(`t-${slug.trim().toLowerCase()}-light`);
  },

  /** Change the user's preference, persist it, and apply immediately. */
  setMode(nextMode: ThemeMode): void {
    if (!VALID_MODES.includes(nextMode) || nextMode === mode) return;
    mode = nextMode;
    recompute();
    applyScheme();
    emit();
    void storage.set(STORAGE_KEYS.THEME_MODE, nextMode);
  },

  /**
   * Startup wiring. Reads the OS scheme synchronously (no flash), applies it,
   * then asynchronously loads the persisted preference and subscribes to OS
   * appearance changes. Safe to call once from the app shell.
   */
  init(): void {
    systemScheme = Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
    recompute();
    applyScheme();
    emit();

    Appearance.addChangeListener(({ colorScheme }) => {
      systemScheme = colorScheme === 'light' ? 'light' : 'dark';
      if (mode === 'system') {
        recompute();
        applyScheme();
        emit();
      }
    });

    void storage.get(STORAGE_KEYS.THEME_MODE).then((stored) => {
      if (stored && VALID_MODES.includes(stored as ThemeMode) && stored !== mode) {
        themeStore.setMode(stored as ThemeMode);
      }
    });
  },

  /** Test-only reset so suites don't leak scheme state into one another. */
  __resetForTests(): void {
    mode = 'system';
    systemScheme = 'dark';
    snapshot = 'dark';
    tenantSlug = null;
    listeners.clear();
  },
};
