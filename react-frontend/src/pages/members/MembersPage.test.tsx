// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MembersPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';

const { mockApiGet, mockToastError, mockUseAuth } = vi.hoisted(() => ({
  mockApiGet: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
  mockToastError: vi.fn(),
  mockUseAuth: vi.fn(() => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null })),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: mockApiGet,
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: mockToastError,
    info: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
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
  useAuth: mockUseAuth,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
}));
vi.mock('@/lib/map-config', () => ({ MAPS_ENABLED: false }));
// Toggle phone layout. src/test/setup.ts stubs matchMedia to matches:false for every
// query, so without this the phone branch would get zero coverage. MembersPage and
// Drawer both ask '(max-width: 639px)', so one boolean answers both correctly.
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => isPhoneViewport),
}));
// MembersPage lazy-imports '@/components/location/EntityMapView' by its direct path, so a stub
// registered only on the '@/components/location' barrel never applies — the real map component
// (and its own direct '@/contexts/TenantContext' import) would load instead. Mock both: the
// barrel for anything importing through it, the direct path for the lazy import.
vi.mock('@/components/location', () => ({
  EntityMapView: () => <div data-testid="map-view">Map</div>,
}));
vi.mock('@/components/location/EntityMapView', () => ({
  EntityMapView: () => <div data-testid="map-view">Map</div>,
}));

// MembersPage imports usePresenceOptional from '@/contexts/PresenceContext' directly, so the
// barrel override is dead and the real PresenceContext would load, pulling in its own direct
// '@/contexts/AuthContext' import.
vi.mock('@/contexts/PresenceContext', () => ({
  usePresenceOptional: () => null,
  usePresence: () => null,
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(["variants", "initial", "animate", "transition", "whileInView", "viewport", "layout", "exit", "whileHover", "whileTap"]);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MembersPage } from './MembersPage';

const algorithmsResponse = {
  success: true,
  data: {
    feed: { name: 'Chronological', key: 'chronological', description: 'Newest first' },
    listings: { name: 'Newest First', key: 'newest', description: 'Newest listings first' },
    members: { name: 'CommunityRank', key: 'communityrank', description: 'Ranked by activity, contributions, reputation, and connections' },
    matching: { name: 'Disabled', key: 'disabled', description: 'Disabled' },
  },
};

describe('MembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
    // test-utils renders a BrowserRouter over the real window.history, and the page
    // syncs ?q=/?sort= into it — so without this reset one test's search query leaks
    // into every test that follows.
    window.history.replaceState({}, '', '/');
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/config/algorithms')) {
        return Promise.resolve({
          success: true,
          data: {
            feed: { name: 'Chronological', key: 'chronological', description: 'Newest first' },
            listings: { name: 'Newest First', key: 'newest', description: 'Newest listings first' },
            members: { name: 'CommunityRank', key: 'communityrank', description: 'Ranked by activity, contributions, reputation, and connections' },
            matching: { name: 'Disabled', key: 'disabled', description: 'Disabled' },
          },
        });
      }

      return Promise.resolve({ success: true, data: [], meta: {} });
    });
    mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null });
  });

  it('renders without crashing', () => {
    render(<MembersPage />);
    expect(screen.getByText('Members')).toBeInTheDocument();
  });

  it('shows search input', () => {
    render(<MembersPage />);
    expect(screen.getByPlaceholderText(/Search members/i)).toBeInTheDocument();
  });

  it('shows view mode buttons', () => {
    render(<MembersPage />);
    expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
    expect(screen.getByLabelText('List view')).toBeInTheDocument();
  });

  it('defaults the directory to Community Rank when the algorithm is enabled', async () => {
    render(<MembersPage />);

    await waitFor(() =>
      expect(mockApiGet).toHaveBeenCalledWith(
        expect.stringContaining('/v2/users?sort=communityrank'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );

    expect(await screen.findByText('CommunityRank')).toBeInTheDocument();
  });

  it('allows Near me when a user has zero coordinates', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 7, latitude: 0, longitude: 0 },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle',
      error: null,
    });

    render(<MembersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Near me' }));

    await waitFor(() =>
      expect(mockApiGet).toHaveBeenLastCalledWith(
        expect.stringContaining('/v2/members/nearby?'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    expect(mockApiGet).toHaveBeenLastCalledWith(
      expect.stringContaining('lat=0'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mockApiGet).toHaveBeenLastCalledWith(
      expect.stringContaining('lon=0'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('keeps search active in Near me mode without sending unsupported sort params', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 7, latitude: 0, longitude: 0 },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle',
      error: null,
    });

    render(<MembersPage />);

    fireEvent.change(screen.getByPlaceholderText(/Search members/i), { target: { value: 'alex' } });
    await waitFor(() =>
      expect(mockApiGet).toHaveBeenLastCalledWith(
        expect.stringContaining('/v2/users?q=alex&sort=communityrank'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Near me' }));

    await waitFor(() =>
      expect(mockApiGet).toHaveBeenLastCalledWith(
        expect.stringContaining('/v2/members/nearby?q=alex'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    const [lastUrl] = mockApiGet.mock.lastCall ?? [''];
    expect(lastUrl).not.toContain('sort=');
    expect(lastUrl).not.toContain('order=');
  });

  it('uses translation keys without inline fallback text on the page shell', () => {
    render(<MembersPage />);

    expect(screen.getByRole('button', { name: 'Near me' })).toBeInTheDocument();
    expect(screen.queryByText('members.near_me')).not.toBeInTheDocument();
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the sticky bar instead of the hero and desktop filter card', () => {
      render(<MembersPage />);

      // Sticky bar: search pill + Filters button + view-mode toggle in `trailing`.
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search members...')).toBeInTheDocument();
      expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
      expect(screen.getByLabelText('List view')).toBeInTheDocument();

      // Hero, quick-filter row and desktop filter card are all phone-hidden.
      // The VISIBLE hero is gone, but an <h1> deliberately remains and is
      // screen-reader-only: on phones the title moves into the app bar as plain
      // text, which is not a heading, so without this a phone user has nothing
      // to orient by. Asserted as sr-only rather than absent.
      expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toHaveClass('sr-only');
      expect(screen.queryByText('All Members')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/Search members/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Near me' })).not.toBeInTheDocument();
    });

    it('opens the filter sheet with the sort and distance chip groups', async () => {
      render(<MembersPage />);

      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByRole('radiogroup', { name: 'Sort by' })).toBeInTheDocument();
      });
      expect(screen.getByRole('radiogroup', { name: 'Near me' })).toBeInTheDocument();

      // One combined sort group — the desktop "Quick filters" row is a facade over
      // sortBy, so "Newest"/"Most Active" are its re-homed equivalents.
      expect(screen.getByRole('radio', { name: 'Community Rank' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Name' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Newest' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Highest Rated' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Most Active' })).toBeInTheDocument();

      // Distance group collapses the desktop "Near me" toggle + radius Select.
      expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: '25 km' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '100 km' })).toBeInTheDocument();
    });

    it('applies draft filters only when the footer button is pressed', async () => {
      render(<MembersPage />);
      await waitFor(() =>
        expect(mockApiGet).toHaveBeenCalledWith(
          expect.stringContaining('/v2/users?sort=communityrank'),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        ),
      );
      mockApiGet.mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Newest' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('radio', { name: 'Newest' }));

      // Tapping a chip probes a limit=1 count but must NOT refetch the grid.
      await waitFor(
        () =>
          expect(mockApiGet).toHaveBeenCalledWith(
            expect.stringMatching(/limit=1$/),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
          ),
        { timeout: 3000 },
      );
      expect(mockApiGet).not.toHaveBeenCalledWith(
        expect.stringContaining('limit=24'),
        expect.anything(),
      );

      fireEvent.click(screen.getByText('Show results'));

      await waitFor(() =>
        expect(mockApiGet).toHaveBeenCalledWith(
          expect.stringContaining('sort=joined&order=desc&limit=24'),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        ),
      );

      // The applied, non-default sort surfaces as a removable chip in the bar.
      expect(await screen.findByLabelText('Remove filter: Newest')).toBeInTheDocument();
    });

    it('labels the apply button with the live result count', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/v2/config/algorithms')) {
          return Promise.resolve(algorithmsResponse);
        }
        return Promise.resolve({ success: true, data: [], meta: { total_items: 42 } });
      });

      render(<MembersPage />);
      await waitFor(() =>
        expect(mockApiGet).toHaveBeenCalledWith(
          expect.stringContaining('/v2/users?sort=communityrank'),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        ),
      );

      fireEvent.click(screen.getByLabelText('More filters'));

      expect(await screen.findByText('Show 42 results', {}, { timeout: 3000 })).toBeInTheDocument();
    });
  });

  describe('directory coverage note', () => {
    /** Serves the directory with `listed` members out of a `joined` community. */
    function withCoverage(meta: Record<string, unknown>) {
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/v2/config/algorithms')) {
          return Promise.resolve(algorithmsResponse);
        }
        return Promise.resolve({
          success: true,
          data: [{ id: 1, name: 'Ada', first_name: 'Ada' }],
          meta,
        });
      });
    }

    it('explains the shortfall when the community is larger than the directory', async () => {
      withCoverage({
        total_items: 12,
        community_total: 369,
        directory_criteria: ['directory_opt_in'],
      });

      render(<MembersPage />);

      expect(
        await screen.findByText('You are seeing 12 of the 369 people who have joined'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/anyone can turn this off in their privacy settings/),
      ).toBeInTheDocument();
    });

    it('stays silent when every member is listed', async () => {
      withCoverage({
        total_items: 369,
        community_total: 369,
        directory_criteria: ['directory_opt_in'],
      });

      render(<MembersPage />);

      await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
      expect(screen.queryByText(/people who have joined/)).not.toBeInTheDocument();
    });

    it('lists only the visibility rules this community actually applies', async () => {
      withCoverage({
        total_items: 12,
        community_total: 369,
        directory_criteria: ['directory_opt_in', 'avatar'],
      });

      render(<MembersPage />);

      expect(await screen.findByText('they have added a profile photo')).toBeInTheDocument();
      expect(
        screen.queryByText('they have written a short introduction'),
      ).not.toBeInTheDocument();
    });
  });
});
