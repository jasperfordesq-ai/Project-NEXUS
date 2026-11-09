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
    t: (key: string, opts?: string | Record<string, unknown>) =>
      typeof opts === 'string'
        ? opts
        : (opts?.fallbackValue as string | undefined) ?? key,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAssetUrl: (url: string | null) => url ?? '',
  resolveThumbnailUrl: (url: string | null) => url ?? '',
}));

import { CampaignsPage } from './CampaignsPage';

const mockCampaigns = [
  {
    id: 1,
    title: 'Green Cities Initiative',
    description: 'A campaign to improve urban greenery.',
    cover_image: null,
    challenges_count: 4,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    title: 'Digital Inclusion Drive',
    description: null,
    cover_image: null,
    challenges_count: 2,
    status: 'active',
    created_at: '2026-02-01T00:00:00Z',
  },
];

describe('CampaignsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders campaign titles on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaigns });
    render(<CampaignsPage />);
    await waitFor(() => {
      expect(screen.getByText('Green Cities Initiative')).toBeInTheDocument();
    });
    expect(screen.getByText('Digital Inclusion Drive')).toBeInTheDocument();
  });

  // Campaigns without a picture had no cover; each now has one in its own
  // colour — the same as its page.
  it('gives a campaign without a picture a cover in the same colour as its page', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaigns });
    render(<CampaignsPage />);
    const covers = await screen.findAllByTestId('campaign-card-cover');
    const { colourForSeed, paletteFor } = await import('@/lib/categoryColours');
    const { coverSeed } = await import('@/lib/coverSeeds');
    expect(covers.map((cover) => cover.getAttribute('data-colour'))).toEqual([
      colourForSeed(coverSeed.campaign(1), paletteFor(null)),
      colourForSeed(coverSeed.campaign(2), paletteFor(null)),
    ]);
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<CampaignsPage />);
    await waitFor(() => {
      expect(screen.getByText('challenges.load_error')).toBeInTheDocument();
    });
  });

  it('shows empty state when no campaigns exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<CampaignsPage />);
    await waitFor(() => {
      expect(screen.queryByText('Green Cities Initiative')).not.toBeInTheDocument();
    });
    // Page title should still render
    expect(screen.getByText('campaigns.title')).toBeInTheDocument();
  });

  it('shows Create Campaign button for admin users', async () => {
    const { useAuth } = await import('@/contexts');
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, first_name: 'Admin', name: 'Admin User', role: 'admin' },
      isAuthenticated: true,
    } as ReturnType<typeof useAuth>);

    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaigns });
    render(<CampaignsPage />);
    await waitFor(() => {
      expect(screen.getByText('campaigns.create')).toBeInTheDocument();
    });
  });

  it('does not show Create Campaign button for regular members', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaigns });
    render(<CampaignsPage />);
    await waitFor(() => {
      expect(screen.getByText('Green Cities Initiative')).toBeInTheDocument();
    });
    // The modal footer always renders a button with 'campaigns.create' text,
    // but the header-level "Create Campaign" button should not be present for non-admins.
    // For admins there are 2 instances (header + modal), for members only 1 (modal footer).
    const createButtons = screen.queryAllByText('campaigns.create');
    expect(createButtons.length).toBeLessThanOrEqual(1);
  });

  it('shows feature-not-available message when feature is disabled', async () => {
    const { useTenant } = await import('@/contexts');
    vi.mocked(useTenant).mockReturnValue({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => false),
      hasModule: vi.fn(() => true),
    } as ReturnType<typeof useTenant>);

    render(<CampaignsPage />);
    await waitFor(() => {
      expect(screen.getByText('campaigns.feature_not_available')).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoint on mount', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<CampaignsPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/ideation-campaigns');
    });
  });
});
