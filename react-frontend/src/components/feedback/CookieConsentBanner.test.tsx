// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CookieConsentBanner component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CookieConsentBanner } from './CookieConsentBanner';

// Mock consent context
const mockAcceptAll = vi.fn();
const mockAcceptEssentialOnly = vi.fn();
const mockSavePreferences = vi.fn();
let mockShowBanner = true;

vi.mock('@/contexts/CookieConsentContext', () => ({
  useCookieConsent: () => ({
    consent: mockShowBanner ? null : { essential: true, analytics: true, preferences: true, timestamp: new Date().toISOString() },
    showBanner: mockShowBanner,
    acceptAll: mockAcceptAll,
    acceptEssentialOnly: mockAcceptEssentialOnly,
    savePreferences: mockSavePreferences,
    hasConsent: () => false,
    resetConsent: vi.fn(),
  }),
  readStoredConsent: () => null,
}));

// Mock tenant context
vi.mock('@/contexts', () => ({
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => `/test-tenant${path}`,
    branding: { name: 'Test Community' },
    tenant: { id: 1, slug: 'test-tenant' },
  }),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => `/test-tenant${path}`,
    branding: { name: 'Test Community' },
    tenant: { id: 1, slug: 'test-tenant' },
  }),
}));

vi.mock('@/lib/cookieConsentStorage', () => ({
  readStoredConsent: () => null,
}));

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'cookie_consent.banner_label': 'Cookie consent',
        'cookie_consent.title': 'We use cookies',
        'cookie_consent.description': 'We use cookies to improve your experience.',
        'cookie_consent.learn_more': 'Learn more',
        'cookie_consent.manage': 'Manage preferences',
        'cookie_consent.hide_details': 'Hide details',
        'cookie_consent.save': 'Save preferences',
        'cookie_consent.essential_only': 'Essential only',
        'cookie_consent.accept_all': 'Accept all',
      };
      return fallback ?? translations[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

function renderBanner() {
  return render(
    <>
      <BrowserRouter>
        <CookieConsentBanner />
      </BrowserRouter>
    </>
  );
}

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    mockShowBanner = true;
    mockAcceptAll.mockClear();
    mockAcceptEssentialOnly.mockClear();
    mockSavePreferences.mockClear();
    localStorage.clear();
  });

  it('renders when showBanner is true', () => {
    renderBanner();

    expect(screen.getByRole('dialog', { name: 'Cookie consent' })).toBeInTheDocument();
    expect(screen.getByText('We use cookies')).toBeInTheDocument();
  });

  it('does not render when showBanner is false', () => {
    mockShowBanner = false;
    renderBanner();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows Accept All and Essential Only buttons', () => {
    renderBanner();

    expect(screen.getByRole('button', { name: 'Accept all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Essential only' })).toBeInTheDocument();
  });

  it('calls acceptAll when Accept All is clicked', () => {
    renderBanner();

    act(() => {
      screen.getByRole('button', { name: 'Accept all' }).click();
    });

    expect(mockAcceptAll).toHaveBeenCalledOnce();
  });

  it('calls acceptEssentialOnly when Essential Only is clicked', () => {
    renderBanner();

    act(() => {
      screen.getByRole('button', { name: 'Essential only' }).click();
    });

    expect(mockAcceptEssentialOnly).toHaveBeenCalledOnce();
  });

  it('shows Manage Preferences button', () => {
    renderBanner();

    expect(screen.getByRole('button', { name: /Manage preferences/i })).toBeInTheDocument();
  });

  it('shows cookie policy link', () => {
    renderBanner();

    expect(screen.getByText('Learn more')).toBeInTheDocument();
  });

  it('has proper ARIA attributes', () => {
    renderBanner();

    const dialog = screen.getByRole('dialog', { name: 'Cookie consent' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(dialog).toHaveAttribute('data-mobile-tabbar-cover');
  });

  it('uses full-size mobile touch targets', () => {
    renderBanner();

    expect(screen.getByRole('button', { name: 'Accept all' })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Essential only' })).toHaveClass('min-h-[44px]');
  });
});
