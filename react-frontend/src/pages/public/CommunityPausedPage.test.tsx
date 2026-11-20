// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The page members see when their community is paused for non-payment.
 *
 * It names the community and never says why: the reason is for the
 * community's admins, in the admin panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

const mockUseAuth = vi.fn();

vi.mock('@/contexts', () => ({
  useAuth: () => mockUseAuth(),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Riverside Timebank', slug: 'riverside', billing_paused: true },
    tenantPath: (p: string) => `/riverside${p}`,
  })),
  useToast: vi.fn(() => ({ showToast: vi.fn() })),
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
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

import { CommunityPausedPage } from './CommunityPausedPage';

describe('CommunityPausedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false });
  });

  it('names the community and says nothing about payment', () => {
    const { container } = render(<CommunityPausedPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Riverside Timebank is paused');
    expect(container.textContent ?? '').not.toMatch(/pay|bill|invoice|owe|debt|subscription/i);
  });

  it('offers organiser sign-in to a signed-out visitor', () => {
    render(<CommunityPausedPage />);

    const link = screen.getByRole('link', { name: 'Organiser sign-in' });
    expect(link).toHaveAttribute('href', '/riverside/login');
    expect(screen.queryByRole('link', { name: 'Go to the admin panel' })).not.toBeInTheDocument();
  });

  it('offers the admin panel to an admin whose level is a flag', () => {
    mockUseAuth.mockReturnValue({ user: { id: 7, role: 'member', is_tenant_super_admin: true }, isAuthenticated: true });
    render(<CommunityPausedPage />);

    expect(screen.getByRole('link', { name: 'Go to the admin panel' })).toHaveAttribute('href', '/riverside/admin');
    expect(screen.queryByRole('link', { name: 'Organiser sign-in' })).not.toBeInTheDocument();
  });

  it('offers a signed-in member neither link', () => {
    mockUseAuth.mockReturnValue({ user: { id: 8, role: 'member' }, isAuthenticated: true });
    render(<CommunityPausedPage />);

    expect(screen.queryByRole('link', { name: 'Go to the admin panel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Organiser sign-in' })).not.toBeInTheDocument();
  });

  it('offers a broker neither link: the broker panel is closed too', () => {
    mockUseAuth.mockReturnValue({ user: { id: 9, role: 'broker' }, isAuthenticated: true });
    render(<CommunityPausedPage />);

    expect(screen.queryByRole('link', { name: 'Go to the admin panel' })).not.toBeInTheDocument();
  });
});
