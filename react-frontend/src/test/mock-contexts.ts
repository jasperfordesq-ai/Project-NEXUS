// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared mock factory for @/contexts
 *
 * Replaces the ~25-line vi.mock('@/contexts', ...) block duplicated across
 * hundreds of test files. Usage:
 *
 *   import { createMockContexts } from '@/test/mock-contexts';
 *   vi.mock('@/contexts', () => createMockContexts());
 *
 * Override individual hooks via the overrides parameter:
 *
 *   vi.mock('@/contexts', () => createMockContexts({
 *     useAuth: () => ({ user: ADMIN_USER, isAuthenticated: true }),
 *   }));
 */

import { vi } from 'vitest';
import type { User } from '@/types/api';

/** Default return values for every hook exported from @/contexts */
const DEFAULTS = {
  // AuthContext
  useAuth: () => ({
    // Typed `User | null`, not the inferred literal `null`: a test overriding
    // useAuth to supply a signed-in user is the normal case, and inferring
    // `null` made every one of those a TS2322 error.
    user: null as User | null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  // Non-throwing variant used by components that may render outside AuthProvider
  // (e.g. the ErrorBoundary fallback). Defaults to unauthenticated; the factory
  // mirrors an overridden useAuth into it so per-test auth state carries over.
  useAuthOptional: () => ({
    user: null as User | null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),

  // TenantContext
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),

  // ToastContext
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),

  // ThemeContext
  useTheme: () => ({
    resolvedTheme: 'light' as const,
    theme: 'system' as const,
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  }),

  // NotificationsContext
  useNotifications: () => ({
    unreadCount: 0,
    counts: {},
    notifications: [],
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    hasMore: false,
    loadMore: vi.fn(),
    isLoading: false,
    refresh: vi.fn(),
  }),

  // PusherContext
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,

  // CookieConsentContext
  useCookieConsent: () => ({
    consent: null,
    showBanner: false,
    openPreferences: vi.fn(),
    resetConsent: vi.fn(),
    saveConsent: vi.fn(),
    hasConsent: vi.fn(() => true),
    updateConsent: vi.fn(),
  }),
  readStoredConsent: () => null,

  // MenuContext
  useMenuContext: () => ({
    headerMenus: [],
    mobileMenus: [],
    hasCustomMenus: false,
  }),

  // PresenceContext
  usePresence: () => ({
    status: 'offline' as const,
    setStatus: vi.fn(),
    getPresence: vi.fn(),
    isOnline: vi.fn(() => false),
  }),
  usePresenceOptional: () => null,
};

type ContextOverrides = Partial<typeof DEFAULTS>;

/**
 * Creates a mock module object for vi.mock('@/contexts', () => ...).
 * Any hook not explicitly overridden gets the safe default above.
 */
export function createMockContexts(overrides: ContextOverrides = {}) {
  const merged = { ...DEFAULTS, ...overrides };
  // Keep the non-throwing auth variant in sync: a test that overrides useAuth to
  // set a specific auth state should see the same state through useAuthOptional
  // unless it deliberately overrides that too.
  if (overrides.useAuth && !overrides.useAuthOptional) {
    merged.useAuthOptional = overrides.useAuth;
  }
  return merged;
}
