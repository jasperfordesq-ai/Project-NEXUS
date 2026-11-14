// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MatchesPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import React from 'react';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url || '/default-avatar.png',
  resolveThumbnailUrl: (url: string | null) => url || null,
  formatRelativeTime: (d: string) => d,
}));

const stableToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  isLoading: false,
};

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => stableTenant),
  useAuth: vi.fn(() => ({ user: { id: 1, first_name: 'Test' }, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null })),
  useToast: vi.fn(() => stableToast),
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn(), useMediaQuery: vi.fn(() => true) }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/navigation', () => ({
  Breadcrumbs: () => <nav aria-label="breadcrumb" />,
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/lib/motion', () => {
  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
  const filterMotion = (props: Record<string, unknown>) => {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) { if (!motionProps.has(k)) filtered[k] = v; }
    return filtered;
  };
  return {
    motion: {
      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { MatchesPage } from './MatchesPage';

const emptyResponse = { success: true, data: { matches: [], meta: { total: 0, modules: [], min_score: 0, needs_location: false, degraded: false, degraded_reason: null, has_active_listings: null, paused: false } } };

describe('MatchesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing and shows content after loading', async () => {
    mockApiGet.mockResolvedValue(emptyResponse);
    render(<MatchesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders the four stats cards', async () => {
    // The page imports GlassCard from '@/components/ui/GlassCard' (not the
    // mocked barrel), so assert on the rendered stat labels rather than the
    // uiMock's data-testid.
    mockApiGet.mockResolvedValue(emptyResponse);
    render(<MatchesPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Matches')).toBeInTheDocument();
    });
    expect(screen.getByText('Avg Score')).toBeInTheDocument();
    expect(screen.getByText('Hot Matches')).toBeInTheDocument();
    expect(screen.getByText('Mutual Matches')).toBeInTheDocument();
  });

  it('renders match items when API returns data', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [
          {
            module: 'listing',
            listing_id: 10,
            match_score: 85,
            title: 'Gardening Help',
            match_reasons: ['Skill match'],
            created_at: '2026-01-01',
            user_id: 5,
            user_name: 'Jane Doe',
          },
        ],
        meta: { total: 1, modules: ['listing'], min_score: 0, needs_location: false, degraded: false, degraded_reason: null, has_active_listings: true, paused: false },
      },
    });
    render(<MatchesPage />);
    await waitFor(() => {
      expect(screen.getByText('Gardening Help')).toBeInTheDocument();
    });
  });

  it('renders breadcrumb navigation', async () => {
    mockApiGet.mockResolvedValue(emptyResponse);
    render(<MatchesPage />);
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
  });

  it('shows the no-coordinates degraded banner when the backend reports it', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [],
        meta: { total: 0, modules: [], min_score: 0, needs_location: true, degraded: true, degraded_reason: 'no_coordinates', has_active_listings: null, paused: false },
      },
    });
    render(<MatchesPage />);
    await waitFor(() => {
      expect(screen.getByText('Add your location to see nearby matches')).toBeInTheDocument();
    });
  });

  it('shows an error state with retry — not the empty state — when the load returns success:false', async () => {
    // Regression: api.get resolves { success:false } on a 4xx WITHOUT throwing;
    // the page used to render the "no matches yet" empty state on failure.
    mockApiGet.mockResolvedValue({ success: false, error: 'Server error' });
    render(<MatchesPage />);

    expect(await screen.findByText("We couldn't load your matches")).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('recovers via retry after a failed load', async () => {
    mockApiGet
      .mockResolvedValueOnce({ success: false, error: 'Server error' })
      .mockResolvedValue(emptyResponse);
    render(<MatchesPage />);

    fireEvent.click(await screen.findByText('Try again'));

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByText("We couldn't load your matches")).not.toBeInTheDocument();
  });

  it('shows the paused banner when matching is paused', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        matches: [],
        meta: { total: 0, modules: [], min_score: 0, needs_location: false, degraded: false, degraded_reason: null, has_active_listings: null, paused: true },
      },
    });
    render(<MatchesPage />);
    await waitFor(() => {
      expect(screen.getByText('Matching is paused')).toBeInTheDocument();
    });
  });
});
