// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen } from '@/test/test-utils';
import { FeatureGate } from './FeatureGate';
import { useTenant } from '@/contexts/TenantContext';

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    isLoading: false,
    tenantPath: vi.fn((p: string) => `/test${p}`),
  })),
}));

vi.mock('@/contexts', () => ({
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe('FeatureGate', () => {
  it('renders children when feature is enabled', () => {
    render(
      <FeatureGate feature="events">
        <div>Events Content</div>
      </FeatureGate>
    );
    expect(screen.getByText('Events Content')).toBeInTheDocument();
  });

  it('renders children when module is enabled', () => {
    render(
      <FeatureGate module="wallet">
        <div>Wallet Content</div>
      </FeatureGate>
    );
    expect(screen.getByText('Wallet Content')).toBeInTheDocument();
  });

  it('hides children when feature is disabled', () => {
    vi.mocked(useTenant).mockReturnValue({
      hasFeature: vi.fn(() => false),
      hasModule: vi.fn(() => true),
      isLoading: false,
      tenantPath: vi.fn((p: string) => `/test${p}`),
    } as ReturnType<typeof useTenant>);

    render(
      <FeatureGate feature="events">
        <div>Events Content</div>
      </FeatureGate>
    );
    expect(screen.queryByText('Events Content')).not.toBeInTheDocument();
  });

  it('renders fallback when feature is disabled', () => {
    vi.mocked(useTenant).mockReturnValue({
      hasFeature: vi.fn(() => false),
      hasModule: vi.fn(() => true),
      isLoading: false,
      tenantPath: vi.fn((p: string) => `/test${p}`),
    } as ReturnType<typeof useTenant>);

    render(
      <FeatureGate feature="events" fallback={<div>Feature unavailable</div>}>
        <div>Events Content</div>
      </FeatureGate>
    );
    expect(screen.queryByText('Events Content')).not.toBeInTheDocument();
    expect(screen.getByText('Feature unavailable')).toBeInTheDocument();
  });

  it('does not mount protected children or start effects while loading', () => {
    vi.mocked(useTenant).mockReturnValue({
      hasFeature: vi.fn(() => false),
      hasModule: vi.fn(() => false),
      isLoading: true,
      tenantPath: vi.fn((p: string) => `/test${p}`),
    } as ReturnType<typeof useTenant>);

    const effect = vi.fn();
    function ProtectedContent() {
      useEffect(effect, []);
      return <div>Events Content</div>;
    }
    render(
      <FeatureGate feature="events">
        <ProtectedContent />
      </FeatureGate>
    );
    expect(screen.queryByText('Events Content')).not.toBeInTheDocument();
    expect(effect).not.toHaveBeenCalled();
  });

  it.each([[true, false], [false, true], [false, false], [true, true]])(
    'requires both flags: feature=%s module=%s', (featureEnabled, moduleEnabled) => {
      vi.mocked(useTenant).mockReturnValue({
        hasFeature: () => featureEnabled, hasModule: () => moduleEnabled,
        isLoading: false, tenantPath: (p: string) => `/test${p}`,
      } as ReturnType<typeof useTenant>);
      render(<FeatureGate feature="direct_messaging" module="messages"><div>Protected content</div></FeatureGate>);
      expect(screen.queryByText('Protected content') !== null).toBe(featureEnabled && moduleEnabled);
    },
  );

  it('renders children when neither feature nor module specified', () => {
    vi.mocked(useTenant).mockReturnValue({
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      isLoading: false,
      tenantPath: vi.fn((p: string) => `/test${p}`),
    } as ReturnType<typeof useTenant>);

    render(
      <FeatureGate>
        <div>Always Visible</div>
      </FeatureGate>
    );
    expect(screen.getByText('Always Visible')).toBeInTheDocument();
  });
});
