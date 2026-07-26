// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ThemePicker.
 *
 * ThemePicker wraps a Popover — panel contents render in a portal.
 * We open it with userEvent.click on the trigger button.
 *
 * CRITICAL: the mock context objects are defined ONCE at module scope so
 * they are stable references; returning fresh objects from hook functions
 * causes infinite render loops.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { ThemePicker } from './ThemePicker';

// ─── Stable mock objects (MUST be module-scope, not per-call) ────────────────

const setThemeSpy = vi.fn(() => Promise.resolve());
const setAccentColorSpy = vi.fn();
const setDensitySpy = vi.fn();

const mockThemeValue = {
  resolvedTheme: 'light' as const,
  theme: 'system' as const,
  toggleTheme: vi.fn(() => Promise.resolve()),
  setTheme: setThemeSpy,
  accentColor: '#6366f1',
  setAccentColor: setAccentColorSpy,
  density: 'comfortable' as const,
  setDensity: setDensitySpy,
  fontSize: 'medium' as const,
  setFontSize: vi.fn(),
  largeText: false,
  setLargeText: vi.fn(),
  highContrast: false,
  setHighContrast: vi.fn(),
  reducedMotion: false,
  setReducedMotion: vi.fn(),
  simplifiedLayout: false,
  setSimplifiedLayout: vi.fn(),
  isLoading: false,
  isInitialized: true,
};

// ThemePicker imports useTheme from its DIRECT path ('@/contexts/ThemeContext'),
// so the stub has to live on that path. A '@/contexts' barrel mock is never
// consulted for a direct-path import, which is why every test in this file used
// to die on "useTheme must be used within a ThemeProvider". Partial mock so the
// module's other exports (ThemeProvider, types) stay real.
vi.mock('@/contexts/ThemeContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/ThemeContext')>()),
  useTheme: () => mockThemeValue,
}));

// ─── Popover sub-components come from @/components/ui — let them render real ─

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Trigger ─────────────────────────────────────────────────────────────────

describe('ThemePicker — trigger button', () => {
  it('renders a trigger button with aria-label', () => {
    render(<ThemePicker />);
    // common.theme_picker.open_label — real English copy from public/locales/en,
    // so a missing/blank/untranslated label now fails instead of passing on a
    // "some non-empty string" check.
    const trigger = screen.getByRole('button', { name: 'Open theme picker' });
    expect(trigger).toHaveAttribute('aria-label', 'Open theme picker');
  });
});

// ─── Popover opens and shows scheme buttons ───────────────────────────────────

describe('ThemePicker — popover content', () => {
  // src/test/setup.ts preloads public/locales/en, so every control below can be
  // addressed by the real accessible name a user would hear. That replaces the
  // previous filter-by-attribute + if/else fallbacks, which could pass without
  // ever locating the specific control under test.
  const TRIGGER = 'Open theme picker';

  async function openPicker() {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
    // Panel contents render in a portal — wait for the first control in it.
    await screen.findByRole('button', { name: 'Light' });
  }

  it('shows light / dark / system scheme buttons after opening', async () => {
    await openPicker();
    // All three schemes present, with pressed state reflecting theme: 'system'.
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls setTheme("light") when the light scheme button is pressed', async () => {
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(setThemeSpy).toHaveBeenCalledTimes(1);
    expect(setThemeSpy).toHaveBeenCalledWith('light');
  });

  it('calls setTheme("dark") when the dark scheme button is pressed', async () => {
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(setThemeSpy).toHaveBeenCalledTimes(1);
    expect(setThemeSpy).toHaveBeenCalledWith('dark');
  });

  it('calls setAccentColor when an accent swatch is clicked', async () => {
    await openPicker();
    // settings.appearance_prefs.select_color interpolates the preset name.
    // Purple is deliberately not the currently selected accent (#6366f1 indigo).
    fireEvent.click(screen.getByRole('button', { name: 'Select purple as accent color' }));
    expect(setAccentColorSpy).toHaveBeenCalledTimes(1);
    expect(setAccentColorSpy).toHaveBeenCalledWith('#a855f7');
  });

  it('calls setDensity when a density button is pressed', async () => {
    await openPicker();
    // settings.appearance_prefs.density_compact — 'comfortable' is the current
    // value, so pressing 'Compact' proves a real change is dispatched.
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(setDensitySpy).toHaveBeenCalledTimes(1);
    expect(setDensitySpy).toHaveBeenCalledWith('compact');
  });
});
