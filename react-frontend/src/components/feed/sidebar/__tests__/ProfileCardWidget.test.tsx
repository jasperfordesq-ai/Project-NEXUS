// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ProfileCardWidget
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { api } from '@/lib/api';

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
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: {
      id: 1,
      first_name: 'Alice',
      last_name: 'Smith',
      username: 'asmith',
      avatar: '/alice.png',
    },
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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string | undefined) => url || '/default-avatar.png'),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { ProfileCardWidget } from '../ProfileCardWidget';

const mockStats = {
  listings_count: 5,
  given_count: 12,
  received_count: 8,
  offers_count: 3,
  requests_count: 2,
  wallet_balance: 24.5,
};

describe('ProfileCardWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when user is not authenticated', async () => {
    const { useAuth } = await import('@/contexts');
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: false,
      user: null,
    } as ReturnType<typeof useAuth>);

    render(<ProfileCardWidget />);
    // Component returns null, but HeroUI provider wrapper still renders.
    // Verify no meaningful profile content is present.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the user display name', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    render(<ProfileCardWidget />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('renders the username handle', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    render(<ProfileCardWidget />);
    expect(screen.getByText('@asmith')).toBeInTheDocument();
  });

  it('links to /profile from the avatar area', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    render(<ProfileCardWidget />);
    const profileLink = screen.getByRole('link', { name: /alice smith/i });
    expect(profileLink).toHaveAttribute('href', '/test/profile');
  });

  it('shows stats (listings, given, received) after API load', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
    });
  });

  it('shows offers and requests counts after API load', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('renders Listings, Given, Received labels after API load', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('Listings')).toBeInTheDocument();
      expect(screen.getByText('Given')).toBeInTheDocument();
      expect(screen.getByText('Received')).toBeInTheDocument();
    });
  });

  it('handles API failure gracefully without crashing', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

    render(<ProfileCardWidget />);
    await waitFor(() => {
      // Should still show user name even if stats fail
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('uses first_name only when last_name is absent', async () => {
    const { useAuth } = await import('@/contexts');
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: true,
      user: {
        id: 2,
        first_name: 'Bob',
        last_name: undefined,
        username: 'bob99',
        avatar: undefined,
      },
    } as ReturnType<typeof useAuth>);

    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: mockStats });

    render(<ProfileCardWidget />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
