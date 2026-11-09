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
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
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
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string | null) => url ?? '',
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

import { FederationListingsPage } from './FederationListingsPage';

const mockListing = {
  id: 50,
  title: 'Guitar Lessons',
  description: 'Offering beginner guitar lessons in Cork.',
  type: 'offer' as const,
  time_credits: 2,
  location: 'Cork City',
  is_remote: false,
  image_url: null,
  timebank: { id: 3, name: 'Cork Timebank' },
  author: { id: 20, name: 'Maria Green', avatar: null },
  created_at: '2026-02-15T10:00:00Z',
};

const mockPartner = {
  id: 3,
  name: 'Cork Timebank',
  slug: 'cork',
  description: null,
  logo_url: null,
  member_count: 80,
  is_connected: true,
  permissions: { can_view_members: true, can_message: true, can_transact: true },
};

function setupMocks() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/v2/federation/partners')) {
      return Promise.resolve({ success: true, data: [mockPartner] });
    }
    if (url.includes('/v2/federation/listings')) {
      return Promise.resolve({
        success: true,
        data: [mockListing], meta: { cursor: null, has_more: false },
      });
    }
    return Promise.resolve({ success: true, data: [] });
  });
}

describe('FederationListingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders listing title on success', async () => {
    setupMocks();
    render(<FederationListingsPage />);
    await waitFor(() => {
      expect(screen.getByText('Guitar Lessons')).toBeInTheDocument();
    });
  });

  // A partner community's offer without a photo had a plain tinted box (shorter
  // than a photo, so the grid was uneven); it now has a cover with its theme's
  // picture, like the offers page. Its offer/request label is readable.
  it('gives an offer without a photo a theme cover and a readable label', async () => {
    setupMocks();
    render(<FederationListingsPage />);
    const cover = await screen.findByTestId('federated-listing-cover');
    expect(cover).toHaveAttribute('aria-hidden', 'true');
    expect(cover.getAttribute('data-colour')).toBeTruthy();
    const label = screen.getAllByText(/^(Offer|listings\.offer)$/).find((el) => el.closest('[data-slot="chip"]'))!.closest('[data-slot="chip"]')!;
    expect(label.className).toContain('text-emerald-800');
  });

  it('shows partner name on listing card', async () => {
    setupMocks();
    render(<FederationListingsPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Cork Timebank').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/federation/listings')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<FederationListingsPage />);
    await waitFor(() => {
      expect(screen.getByText('listings.unable_to_load')).toBeInTheDocument();
    });
  });

  it('shows empty state when no listings exist', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/federation/listings')) {
        return Promise.resolve({
          success: true,
          data: [], meta: { cursor: null, has_more: false },
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<FederationListingsPage />);
    await waitFor(() => {
      expect(screen.queryByText('Guitar Lessons')).not.toBeInTheDocument();
      expect(screen.getByText('listings.no_listings_found')).toBeInTheDocument();
    });
  });

  it('shows Load More button when has_more is true', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/federation/listings')) {
        return Promise.resolve({
          success: true,
          data: [mockListing], meta: { cursor: 'cursor-abc', has_more: true },
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<FederationListingsPage />);
    await waitFor(() => {
      expect(screen.getByText('listings.load_more')).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoints on mount', async () => {
    setupMocks();
    render(<FederationListingsPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/federation/listings'),
        expect.any(Object),
      );
    });
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/v2/federation/partners'),
    );
  });
});
