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
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: '5' }),
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

import { CampaignDetailPage } from './CampaignDetailPage';

const mockCampaign = {
  id: 5,
  title: 'Sustainable Futures Campaign',
  description: 'A campaign to explore sustainability ideas.',
  cover_image: null,
  challenges_count: 3,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  challenges: [
    {
      id: 10,
      title: 'Reduce Plastic Waste',
      description: 'Ideas to cut down plastic.',
      status: 'open',
      ideas_count: 5,
      views_count: 88,
      favorites_count: 3,
      cover_image: null,
      tags: ['plastic', 'environment'],
      submission_deadline: null,
      prize_description: null,
      is_featured: false,
    },
  ],
};

describe('CampaignDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders campaign title and description on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaign });
    render(<CampaignDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Sustainable Futures Campaign')).toBeInTheDocument();
    });
    expect(screen.getByText('A campaign to explore sustainability ideas.')).toBeInTheDocument();
  });

  it('renders linked challenge cards', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaign });
    render(<CampaignDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reduce Plastic Waste')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<CampaignDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('challenges.load_error')).toBeInTheDocument();
    });
  });

  it('shows admin edit and delete buttons for admin users', async () => {
    const { useAuth } = await import('@/contexts');
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, first_name: 'Admin', name: 'Admin User', role: 'admin' },
      isAuthenticated: true,
    } as ReturnType<typeof useAuth>);

    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaign });
    render(<CampaignDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Sustainable Futures Campaign')).toBeInTheDocument();
    });
    // Admin controls are icon-only buttons with aria-labels using i18n keys
    expect(screen.getByRole('button', { name: 'admin.edit_campaign' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'admin.delete_campaign' })).toBeInTheDocument();
  });

  it('does not show edit/delete buttons for regular members', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaign });
    render(<CampaignDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Sustainable Futures Campaign')).toBeInTheDocument();
    });
    expect(screen.queryByText('campaigns.edit')).not.toBeInTheDocument();
    expect(screen.queryByText('campaigns.delete')).not.toBeInTheDocument();
  });

  it('shows empty challenges message when no challenges linked', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...mockCampaign, challenges: [], challenges_count: 0 },
    });
    render(<CampaignDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Sustainable Futures Campaign')).toBeInTheDocument();
    });
    expect(screen.queryByText('Reduce Plastic Waste')).not.toBeInTheDocument();
  });

  it('calls the correct API endpoint on mount', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaign });
    render(<CampaignDetailPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/ideation-campaigns/5');
    });
  });

  // AWID: "attractive visuals". The page opened with plain text; it now opens
  // with a cover in the campaign's own colour.
  it('opens with a cover in the campaign\'s own colour when it has no image', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCampaign });
    render(<CampaignDetailPage />);
    const cover = await screen.findByTestId('campaign-detail-cover');
    const { colourForSeed, paletteFor } = await import('@/lib/categoryColours');
    const { coverSeed } = await import('@/lib/coverSeeds');
    expect(cover).toHaveAttribute('aria-hidden', 'true');
    expect(cover.getAttribute('data-colour')).toBe(colourForSeed(coverSeed.campaign(5), paletteFor(null)));
  });

  it('opens with the campaign\'s own cover image when it has one', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { ...mockCampaign, cover_image: '/uploads/campaign-5.jpg' } });
    const { container } = render(<CampaignDetailPage />);
    await screen.findByText('Sustainable Futures Campaign');
    expect(screen.queryByTestId('campaign-detail-cover')).not.toBeInTheDocument();
    expect(container.querySelector('img[src="/uploads/campaign-5.jpg"]')).not.toBeNull();
  });
});
