// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Typed as a plain string, not 'light' | 'dark': the store now also passes generated
// per-community theme names such as `t-agoris-dark`.
const mockSetTheme = jest.fn<void, [string]>();
const mockSetColorScheme = jest.fn<void, ['light' | 'dark' | null]>();
const mockGetColorScheme = jest.fn<'light' | 'dark', []>(() => 'dark');
const mockAddChangeListener = jest.fn<
  { remove: jest.Mock },
  [(p: { colorScheme: 'light' | 'dark' | null }) => void]
>(() => ({ remove: jest.fn() }));
const mockStorageGet = jest.fn<Promise<string | null>, [string]>(async () => null);
const mockStorageSet = jest.fn<Promise<void>, [string, string]>(async () => undefined);

jest.mock('react-native', () => ({
  Appearance: {
    getColorScheme: () => mockGetColorScheme(),
    setColorScheme: (scheme: 'light' | 'dark' | null) => mockSetColorScheme(scheme),
    addChangeListener: (cb: (p: { colorScheme: 'light' | 'dark' | null }) => void) => mockAddChangeListener(cb),
  },
}));

jest.mock('uniwind', () => ({
  Uniwind: {
    setTheme: (theme: string) => mockSetTheme(theme),
    // The store checks membership before switching, so the mock has to advertise which
    // themes exist. Deliberately includes ONE tenant theme and omits another, so the
    // fallback path is exercised rather than assumed.
    themes: ['light', 'dark', 't-agoris-light', 't-agoris-dark'],
  },
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    get: (...args: [string]) => mockStorageGet(...args),
    set: (...args: [string, string]) => mockStorageSet(...args),
  },
}));

// Mock constants so the store doesn't pull in expo-constants (which needs the
// real react-native Platform that we replace above).
jest.mock('@/lib/constants', () => ({
  STORAGE_KEYS: { THEME_MODE: 'nexus_theme_mode' },
}));

import { themeStore } from './themeStore';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('themeStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetColorScheme.mockReturnValue('dark');
    mockStorageGet.mockResolvedValue(null);
    themeStore.__resetForTests();
  });

  it('defaults to dark before any wiring (preserves dark-only behaviour)', () => {
    expect(themeStore.getSnapshot()).toBe('dark');
    expect(themeStore.getMode()).toBe('system');
  });

  it('init() adopts the OS scheme and pushes it to Uniwind + Appearance', () => {
    mockGetColorScheme.mockReturnValue('light');
    themeStore.init();

    expect(themeStore.getSnapshot()).toBe('light');
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    // 'system' mode hands colour-scheme control back to the OS.
    expect(mockSetColorScheme).toHaveBeenCalledWith(null);
  });

  it('setMode() forces a scheme, applies it, and persists the choice', () => {
    themeStore.setMode('light');

    expect(themeStore.getSnapshot()).toBe('light');
    expect(themeStore.getMode()).toBe('light');
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    expect(mockSetColorScheme).toHaveBeenCalledWith('light');
    expect(mockStorageSet).toHaveBeenCalledWith('nexus_theme_mode', 'light');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = themeStore.subscribe(listener);

    themeStore.setMode('light');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    themeStore.setMode('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a no-op setMode to the current mode', () => {
    themeStore.setMode('system');
    expect(mockSetTheme).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('follows OS appearance changes while on system mode', () => {
    themeStore.init();
    const handler = mockAddChangeListener.mock.calls[0][0] as (p: {
      colorScheme: 'light' | 'dark' | null;
    }) => void;

    handler({ colorScheme: 'light' });
    expect(themeStore.getSnapshot()).toBe('light');

    handler({ colorScheme: 'dark' });
    expect(themeStore.getSnapshot()).toBe('dark');
  });

  it('does not follow the OS once the user pins a mode', () => {
    themeStore.setMode('dark');
    themeStore.init();
    const handler = mockAddChangeListener.mock.calls[0][0] as (p: {
      colorScheme: 'light' | 'dark' | null;
    }) => void;

    handler({ colorScheme: 'light' });
    expect(themeStore.getSnapshot()).toBe('dark');
  });

  it('init() restores a persisted preference over the OS scheme', async () => {
    mockGetColorScheme.mockReturnValue('dark');
    mockStorageGet.mockResolvedValue('light');

    themeStore.init();
    await flush();

    expect(themeStore.getMode()).toBe('light');
    expect(themeStore.getSnapshot()).toBe('light');
  });
});

describe('per-community accent', () => {
  beforeEach(() => {
    themeStore.__resetForTests();
    mockSetTheme.mockClear();
  });

  it('switches to the community theme when this bundle carries one', () => {
    themeStore.setTenant('agoris');

    // Default scheme in tests is dark, so the dark variant is the expected pick.
    expect(mockSetTheme).toHaveBeenCalledWith('t-agoris-dark');
    expect(themeStore.getTenantSlug()).toBe('agoris');
  });

  it('🔴 falls back to the platform theme for a community with no palette', () => {
    // The branch that stops a crash. `Uniwind.setTheme` THROWS on an unregistered name,
    // so a community that signed up after this build shipped would take the app down on
    // launch. Falling back means they see consistent default colours instead.
    themeStore.setTenant('a-community-added-after-this-build');

    expect(mockSetTheme).toHaveBeenCalledWith('dark');
    expect(mockSetTheme).not.toHaveBeenCalledWith(expect.stringContaining('a-community-added'));
  });

  it('reports whether a community has a palette in this bundle', () => {
    // Lets the app notice a stale build rather than quietly looking generic.
    expect(themeStore.hasThemeFor('agoris')).toBe(true);
    expect(themeStore.hasThemeFor('not-shipped-yet')).toBe(false);
  });

  it('keeps the community accent across a light/dark change', () => {
    themeStore.setTenant('agoris');
    mockSetTheme.mockClear();

    themeStore.setMode('light');

    expect(mockSetTheme).toHaveBeenCalledWith('t-agoris-light');
  });

  it('returns to the platform accent when the community is cleared', () => {
    themeStore.setTenant('agoris');
    mockSetTheme.mockClear();

    themeStore.setTenant(null);

    expect(mockSetTheme).toHaveBeenCalledWith('dark');
    expect(themeStore.getTenantSlug()).toBeNull();
  });

  it('normalises the slug and ignores a repeat of the same one', () => {
    themeStore.setTenant('  AGORIS  ');
    expect(themeStore.getTenantSlug()).toBe('agoris');

    mockSetTheme.mockClear();
    themeStore.setTenant('agoris');
    expect(mockSetTheme).not.toHaveBeenCalled();
  });
});
