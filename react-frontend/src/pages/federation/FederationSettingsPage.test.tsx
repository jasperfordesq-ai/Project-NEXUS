// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { FederationSettingsPage } from './FederationSettingsPage';

const mockSettings = {
  profile_visible_federated: true,
  appear_in_federated_search: true,
  show_skills_federated: true,
  show_location_federated: false,
  show_reviews_federated: true,
  messaging_enabled_federated: true,
  transactions_enabled_federated: true,
  email_notifications: true,
  service_reach: 'local_only' as const,
  travel_radius_km: 0,
  federation_optin: true,
};

const mockSettingsResponse = {
  success: true,
  data: {
    settings: mockSettings,
    enabled: true,
  },
};

describe('FederationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders settings page title on load', async () => {
    vi.mocked(api.get).mockResolvedValue(mockSettingsResponse);
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.heading')).toBeInTheDocument();
    });
  });

  it('renders privacy settings section', async () => {
    vi.mocked(api.get).mockResolvedValue(mockSettingsResponse);
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.profile_visibility')).toBeInTheDocument();
    });
  });

  it('renders communication settings section', async () => {
    vi.mocked(api.get).mockResolvedValue(mockSettingsResponse);
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.communication')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails to load settings', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.load_error_retry')).toBeInTheDocument();
    });
  });

  it('shows federation opt-out button when opted in', async () => {
    vi.mocked(api.get).mockResolvedValue(mockSettingsResponse);
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.disable_federation')).toBeInTheDocument();
    });
  });

  it('shows federation opt-in button when opted out', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { settings: { ...mockSettings, federation_optin: false }, enabled: false },
    });
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.enable_federation')).toBeInTheDocument();
    });
  });

  it('save button is disabled when settings are unchanged (not dirty)', async () => {
    vi.mocked(api.get).mockResolvedValue(mockSettingsResponse);
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.save_settings')).toBeInTheDocument();
    });
    const saveBtn = screen.getByText('settings.save_settings');
    expect(saveBtn.closest('button')).toBeDisabled();
  });

  it('calls the correct API endpoint on mount', async () => {
    vi.mocked(api.get).mockResolvedValue(mockSettingsResponse);
    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/federation/settings');
    });
  });

  it('shows a specific pending debit and sends only its approval decision', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(mockSettingsResponse)
      .mockResolvedValueOnce({
        success: true,
        data: { approvals: [{
          id: 42,
          protocol: 'credit_commons',
          amount: '3.0000',
          description: 'Community exchange',
          expires_at: '2026-09-29T12:00:00Z',
          payee_label: 'partner/alex',
        }] },
      });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { status: 'approved' } });

    render(<FederationSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('settings.debit_approvals_heading')).toBeInTheDocument();
      expect(screen.getByText('Community exchange')).toBeInTheDocument();
    });
    screen.getByText('settings.debit_approve').click();
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/federation/debit-approvals/42/decision', { decision: 'approve' });
    });
  });
});
