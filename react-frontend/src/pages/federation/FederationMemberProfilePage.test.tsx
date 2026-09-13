// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
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
  initReactI18next: { type: '3rdParty', init: vi.fn() },
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
    useParams: () => ({ id: '20' }),
    useSearchParams: () => [new URLSearchParams('tenant_id=5'), vi.fn()],
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

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
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
  useToast: vi.fn(() => toastMock),

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
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url ?? '',
}));

import { FederationMemberProfilePage } from './FederationMemberProfilePage';

const mockMember = {
  id: 20,
  first_name: 'Maria',
  last_name: 'Green',
  name: 'Maria Green',
  avatar_url: null,
  bio: 'Community volunteer and sustainability advocate.',
  skills: ['Gardening', 'Teaching'],
  location: 'Cork',
  service_reach: 'local_only',
  is_remote: false,
  travel_radius_km: 0,
  timebank: { id: 5, name: 'Cork Timebank', slug: 'cork' },
  average_rating: 4.8,
  total_exchanges: 22,
  messaging_enabled: true,
  transactions_enabled: true,
  show_skills_federated: true,
  show_location_federated: true,
  show_reviews_federated: true,
};

const mockConnectionStatus = { status: 'none', connection_id: null };

function setupMocks() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/v2/federation/status')) {
      return Promise.resolve({ success: true, data: { enabled: true, federation_optin: true } });
    }
    if (url.includes('/v2/federation/members/20/reviews')) {
      return Promise.resolve({ success: true, data: [] });
    }
    if (url.includes('/v2/federation/connections/status/')) {
      return Promise.resolve({ success: true, data: mockConnectionStatus });
    }
    return Promise.resolve({ success: true, data: mockMember });
  });
}

describe('FederationMemberProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders member name and bio on success', async () => {
    setupMocks();
    render(<FederationMemberProfilePage />);
    await waitFor(() => {
      expect(screen.getAllByText('Maria Green').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Community volunteer and sustainability advocate.')).toBeInTheDocument();
    });
  });

  it('shows partner timebank name', async () => {
    setupMocks();
    render(<FederationMemberProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('Cork Timebank')).toBeInTheDocument();
    });
  });

  it('shows error state when member not found', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null, error: 'Not found' });
    render(<FederationMemberProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('member_profile.not_found_heading')).toBeInTheDocument();
    });
  });

  it('shows error state when API throws', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<FederationMemberProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('member_profile.not_found_heading')).toBeInTheDocument();
    });
  });

  it('shows Connect button when connection status is none', async () => {
    setupMocks();
    render(<FederationMemberProfilePage />);
    await waitFor(() => {
      expect(screen.getAllByText('Maria Green').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('member_profile.connect')).toBeInTheDocument();
    });
  });

  it('shows member location when visible', async () => {
    setupMocks();
    render(<FederationMemberProfilePage />);
    await waitFor(() => {
      expect(screen.getByText('Cork')).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoint on mount', async () => {
    setupMocks();
    render(<FederationMemberProfilePage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/federation/members/20?tenant_id=5', expect.any(Object));
    });
  });

  it('posts federation transfers with an Idempotency-Key header', async () => {
    setupMocks();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { transaction_id: 123 } });

    render(<FederationMemberProfilePage />);

    await waitFor(() => {
      expect(screen.getAllByText('Maria Green').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'member_profile.send_credits' }));
    fireEvent.change(screen.getByLabelText('member_profile.amount_hours'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('member_profile.description'), { target: { value: '  Helped with setup  ' } });
    const sendButtons = screen.getAllByRole('button', { name: 'member_profile.send_credits' });
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/v2/federation/transactions',
      {
        receiver_id: 20,
        receiver_tenant_id: 5,
        amount: 2,
        description: 'Helped with setup',
      },
      { headers: { 'Idempotency-Key': expect.any(String) } },
    ));
  });

  it('shows a translated pending toast for external transfer reconciliation', async () => {
    setupMocks();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { transaction_id: 123, status: 'pending' } });

    render(<FederationMemberProfilePage />);

    await waitFor(() => {
      expect(screen.getAllByText('Maria Green').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'member_profile.send_credits' }));
    fireEvent.change(screen.getByLabelText('member_profile.amount_hours'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('member_profile.description'), { target: { value: 'Helped with setup' } });
    const sendButtons = screen.getAllByRole('button', { name: 'member_profile.send_credits' });
    fireEvent.click(sendButtons[sendButtons.length - 1]);

    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith(
      'member_profile.tx_pending',
      'member_profile.tx_pending_detail',
    ));
  });
  it('surfaces the server reason when a transfer is refused', async () => {
    setupMocks();
    vi.mocked(api.post).mockResolvedValue({
      success: false,
      error: 'This member has limited who can contact them.',
      code: 'SAFEGUARDING_CONTACT_RESTRICTED',
    });

    render(<FederationMemberProfilePage />);

    await waitFor(() => {
      expect(screen.getAllByText('Maria Green').length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'member_profile.send_credits' }));
    fireEvent.change(screen.getByLabelText('member_profile.amount_hours'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('member_profile.description'), { target: { value: 'Helped with setup' } });
    const sendButtons = screen.getAllByRole('button', { name: 'member_profile.send_credits' });
    const confirmButton = sendButtons[sendButtons.length - 1];
    if (!confirmButton) throw new Error('confirm button not rendered');
    fireEvent.click(confirmButton);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(
      'member_profile.tx_failed',
      'This member has limited who can contact them.',
    ));
  });
});
