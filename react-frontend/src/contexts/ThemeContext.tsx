// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS Theme Context
 *
 * Provides light/dark mode toggle with:
 * - System preference detection
 * - localStorage persistence
 * - Backend sync for authenticated users
 * - Smooth theme transitions
 * - Accent color, font size, density, and accessibility preferences
 */

import {
  createContext,
  use,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { api, tokenManager } from '@/lib/api';
import { logWarn } from '@/lib/logger';
import { safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageSetJSON } from '@/lib/safeStorage';
import { getAccessibleForegroundColor } from '@/lib/colorContrast';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type FontSize = 'small' | 'medium' | 'large';
export type Density = 'compact' | 'comfortable' | 'spacious';

export interface ThemePreferences {
  accentColor: string;
  fontSize: FontSize;
  density: Density;
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  simplifiedLayout: boolean;
}

interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  isInitialized: boolean;
}

interface ThemeContextValue extends ThemeState, ThemePreferences {
  setTheme: (theme: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
  setAccentColor: (color: string) => void;
  setFontSize: (size: FontSize) => void;
  setDensity: (density: Density) => void;
  setLargeText: (enabled: boolean) => void;
  setHighContrast: (enabled: boolean) => void;
  setReducedMotion: (enabled: boolean) => void;
  setSimplifiedLayout: (enabled: boolean) => void;
  isLoading: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const THEME_STORAGE_KEY = 'nexus_theme';
const THEME_PREFS_STORAGE_KEY = 'nexus_theme_preferences';
// Light by default. Changed 2026-08-11 on owner instruction after feedback from
// a coordinator that dark mode is hard on older eyes — a first impression that
// members shouldn't have to go and fix. An explicit choice still wins: it is
// stored under `nexus_theme` and mirrored to `users.preferred_theme`.
const DEFAULT_THEME: ThemeMode = 'light';

const DEFAULT_PREFERENCES: ThemePreferences = {
  accentColor: '#6366f1',
  fontSize: 'medium',
  density: 'comfortable',
  largeText: false,
  highContrast: false,
  reducedMotion: false,
  simplifiedLayout: false,
};

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '14px',
  medium: '16px',
  large: '18px',
};

const SPACING_MULTIPLIER_MAP: Record<Density, string> = {
  compact: '0.75',
  comfortable: '1',
  spacious: '1.25',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getSystemTheme(): ResolvedTheme {
  // No window (SSR/prerender) — fall back to the platform default rather than
  // dark, so 'system' resolves consistently with DEFAULT_THEME.
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
}

function applyThemeToDOM(resolvedTheme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;

  const html = document.documentElement;

  // Set data-theme attribute
  html.setAttribute('data-theme', resolvedTheme);

  // Update class for compatibility
  html.classList.remove('light', 'dark');
  html.classList.add(resolvedTheme);

  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute(
      'content',
      resolvedTheme === 'dark' ? '#0a0a0f' : '#f8fafc'
    );
  }
}

function applyPreferencesToDOM(prefs: ThemePreferences): void {
  if (typeof document === 'undefined') return;

  const html = document.documentElement;

  const accentForeground = getAccessibleForegroundColor(prefs.accentColor);

  // Keep NEXUS and HeroUI v3 on one runtime accent source. HeroUI consumes
  // the canonical --accent/--focus/--link variables; legacy NEXUS utilities
  // consume --accent-color and the derived variables in tokens.css.
  html.style.setProperty('--accent-color', prefs.accentColor);
  html.style.setProperty('--accent', prefs.accentColor);
  html.style.setProperty('--accent-foreground', accentForeground);
  html.style.setProperty('--focus', prefs.accentColor);
  html.style.setProperty('--link', prefs.accentColor);
  html.style.setProperty(
    '--border-focus',
    `color-mix(in srgb, ${prefs.accentColor} 70%, transparent)`
  );
  html.style.setProperty(
    '--input-focus-border',
    `color-mix(in srgb, ${prefs.accentColor} 70%, transparent)`
  );
  html.style.setProperty(
    '--font-size-base',
    FONT_SIZE_MAP[prefs.largeText ? 'large' : prefs.fontSize]
  );
  html.style.setProperty('--spacing-multiplier', SPACING_MULTIPLIER_MAP[prefs.density]);
  html.setAttribute('data-density', prefs.density);
  html.setAttribute('data-large-text', String(prefs.largeText));
  html.setAttribute('data-high-contrast', String(prefs.highContrast));
  html.setAttribute('data-reduced-motion', String(prefs.reducedMotion));
  html.setAttribute('data-simplified-layout', String(prefs.simplifiedLayout));
}

function getStoredTheme(): ThemeMode | null {
  if (typeof localStorage === 'undefined') return null;
  const stored = safeLocalStorageGet(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return null;
}

function storeTheme(theme: ThemeMode): void {
  if (typeof localStorage === 'undefined') return;
  safeLocalStorageSet(THEME_STORAGE_KEY, theme);
}

function getStoredPreferences(): ThemePreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const stored = safeLocalStorageGet(THEME_PREFS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        accentColor: parsed.accentColor ?? DEFAULT_PREFERENCES.accentColor,
        fontSize: parsed.fontSize ?? DEFAULT_PREFERENCES.fontSize,
        density: parsed.density ?? DEFAULT_PREFERENCES.density,
        largeText: parsed.largeText ?? DEFAULT_PREFERENCES.largeText,
        highContrast: parsed.highContrast ?? DEFAULT_PREFERENCES.highContrast,
        reducedMotion: parsed.reducedMotion ?? DEFAULT_PREFERENCES.reducedMotion,
        simplifiedLayout: parsed.simplifiedLayout ?? DEFAULT_PREFERENCES.simplifiedLayout,
      };
    }
  } catch {
    // Ignore malformed JSON
  }
  return null;
}

function storePreferences(prefs: ThemePreferences): void {
  if (typeof localStorage === 'undefined') return;
  safeLocalStorageSetJSON(THEME_PREFS_STORAGE_KEY, prefs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: ThemeMode;
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    // Try to get stored theme, fall back to default
    return getStoredTheme() ?? defaultTheme;
  });
  const [preferences, setPreferences] = useState<ThemePreferences>(() => {
    const stored = getStoredPreferences();
    if (stored) return stored;
    // Seed reducedMotion from OS prefers-reduced-motion on first session
    const osReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { ...DEFAULT_PREFERENCES, reducedMotion: osReducedMotion };
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Debounce timer for backend sync
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the actual theme (handles 'system' mode)
  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    return resolveTheme(theme);
  }, [theme]);

  // Apply theme to DOM on mount and when theme changes
  useEffect(() => {
    applyThemeToDOM(resolvedTheme);
    setIsInitialized(true);
  }, [resolvedTheme]);

  // Apply preferences to DOM when they change
  useEffect(() => {
    applyPreferencesToDOM(preferences);
  }, [preferences]);

  // Load preferences from backend on mount (if authenticated)
  useEffect(() => {
    if (!tokenManager.getAccessToken()) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await api.get('/v2/users/me');
        if (cancelled) return;
        const data = response.data as Record<string, unknown> | undefined;
        const themePrefs = data?.theme_preferences as Record<string, unknown> | undefined;
        if (themePrefs) {
          const serverPrefs: ThemePreferences = {
            accentColor: (themePrefs.accent_color as string) ?? DEFAULT_PREFERENCES.accentColor,
            fontSize: (themePrefs.font_size as FontSize) ?? DEFAULT_PREFERENCES.fontSize,
            density: (themePrefs.density as Density) ?? DEFAULT_PREFERENCES.density,
            largeText: (themePrefs.large_text as boolean) ?? DEFAULT_PREFERENCES.largeText,
            highContrast: (themePrefs.high_contrast as boolean) ?? DEFAULT_PREFERENCES.highContrast,
            reducedMotion: (themePrefs.reduced_motion as boolean) ?? DEFAULT_PREFERENCES.reducedMotion,
            simplifiedLayout: (themePrefs.simplified_layout as boolean) ?? DEFAULT_PREFERENCES.simplifiedLayout,
          };
          setPreferences(serverPrefs);
          storePreferences(serverPrefs);
          applyPreferencesToDOM(serverPrefs);
        }
      } catch {
        // Silently ignore — local preferences still apply
      }
    })();

    return () => { cancelled = true; };
  }, []); // load theme once on mount

  // Listen for system preference changes (only relevant when theme is 'system')
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      const newResolved = getSystemTheme();
      applyThemeToDOM(newResolved);
      // Force re-render to update resolvedTheme
      setThemeState((current) => current);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Mirror OS prefers-reduced-motion into the reducedMotion preference whenever
  // the user has NOT explicitly set their own preference (no stored value).
  // This fires once on mount and re-syncs if the OS setting changes at runtime.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasStoredPrefs = !!safeLocalStorageGet(THEME_PREFS_STORAGE_KEY);
    if (hasStoredPrefs) return; // user has an explicit preference — don't override

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setPreferences((prev) => {
        if (prev.reducedMotion === mq.matches) return prev;
        return { ...prev, reducedMotion: mq.matches };
      });
    };
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []); // run once; re-checks on every OS change

  // Sync preferences to backend (debounced)
  const syncPreferencesToBackend = useCallback((prefs: ThemePreferences) => {
    if (!tokenManager.getAccessToken()) return;

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = setTimeout(async () => {
      try {
        await api.put('/v2/users/me/theme-preferences', {
          accent_color: prefs.accentColor,
          font_size: prefs.fontSize,
          density: prefs.density,
          large_text: prefs.largeText,
          high_contrast: prefs.highContrast,
          reduced_motion: prefs.reducedMotion,
          simplified_layout: prefs.simplifiedLayout,
        });
      } catch (error) {
        logWarn('Failed to persist theme preferences to backend:', error);
      }
    }, 500);
  }, []);

  // Set theme with persistence
  const setTheme = useCallback(async (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    storeTheme(newTheme);

    // Sync to backend if authenticated
    if (tokenManager.getAccessToken()) {
      setIsLoading(true);
      try {
        await api.put('/v2/users/me/theme', { theme: newTheme });
      } catch (error) {
        logWarn('Failed to persist theme preference to backend:', error);
        // Don't throw - theme still works locally
      } finally {
        setIsLoading(false);
      }
    }
  }, []);

  // Toggle between light and dark (ignores system)
  const toggleTheme = useCallback(async () => {
    const nextTheme: ThemeMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    await setTheme(nextTheme);
  }, [resolvedTheme, setTheme]);

  // Preference setters
  const setAccentColor = useCallback((color: string) => {
    setPreferences((prev) => {
      const next = { ...prev, accentColor: color };
      storePreferences(next);
      syncPreferencesToBackend(next);
      return next;
    });
  }, [syncPreferencesToBackend]);

  const setFontSize = useCallback((size: FontSize) => {
    setPreferences((prev) => {
      const next = { ...prev, fontSize: size };
      storePreferences(next);
      syncPreferencesToBackend(next);
      return next;
    });
  }, [syncPreferencesToBackend]);

  const setDensity = useCallback((density: Density) => {
    setPreferences((prev) => {
      const next = { ...prev, density };
      storePreferences(next);
      syncPreferencesToBackend(next);
      return next;
    });
  }, [syncPreferencesToBackend]);

  const setHighContrast = useCallback((enabled: boolean) => {
    setPreferences((prev) => {
      const next = { ...prev, highContrast: enabled };
      storePreferences(next);
      syncPreferencesToBackend(next);
      return next;
    });
  }, [syncPreferencesToBackend]);

  const setLargeText = useCallback((enabled: boolean) => {
    setPreferences((prev) => {
      const next = { ...prev, largeText: enabled };
      storePreferences(next);
      syncPreferencesToBackend(next);
      return next;
    });
  }, [syncPreferencesToBackend]);

  const setReducedMotion = useCallback((enabled: boolean) => {
    setPreferences((prev) => {
      const next = { ...prev, reducedMotion: enabled };
      storePreferences(next);
      syncPreferencesToBackend(next);
      return next;
    });
  }, [syncPreferencesToBackend]);

  const setSimplifiedLayout = useCallback((enabled: boolean) => {
    setPreferences((prev) => {
      const next = { ...prev, simplifiedLayout: enabled };
      storePreferences(next);
      syncPreferencesToBackend(next);
      return next;
    });
  }, [syncPreferencesToBackend]);

  // Context value
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      isInitialized,
      setTheme,
      toggleTheme,
      isLoading,
      accentColor: preferences.accentColor,
      fontSize: preferences.fontSize,
      density: preferences.density,
      largeText: preferences.largeText,
      highContrast: preferences.highContrast,
      reducedMotion: preferences.reducedMotion,
      simplifiedLayout: preferences.simplifiedLayout,
      setAccentColor,
      setFontSize,
      setDensity,
      setLargeText,
      setHighContrast,
      setReducedMotion,
      setSimplifiedLayout,
    }),
    [theme, resolvedTheme, isInitialized, setTheme, toggleTheme, isLoading,
     preferences, setAccentColor, setFontSize, setDensity, setLargeText,
     setHighContrast, setReducedMotion, setSimplifiedLayout]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeContext;
