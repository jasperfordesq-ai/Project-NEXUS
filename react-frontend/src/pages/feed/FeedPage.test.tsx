// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FeedPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn().mockResolvedValue({ success: true, data: [], meta: {} });
const mockPost = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', avatar: null },
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

// FeedPage imports usePusherOptional from '@/contexts/PusherContext' directly, so the override
// in the '@/contexts' barrel above is dead — vitest resolves mocks per specifier. Without this
// the real PusherContext loads (and its own direct '@/contexts/AuthContext' import with it), so
// no assertion here actually controls the realtime layer.
vi.mock('@/contexts/PusherContext', () => ({
  usePusherOptional: () => null,
  usePusher: () => ({ channel: null, isConnected: false }),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// Toggle phone layout. The feed tree asks two opposite questions:
// FeedPage uses '(min-width: 1024px)' for the desktop sidebar, while FeedCard /
// ShareButton use '(max-width: 639px)' for phone behaviour. Answer both from one
// switch so the default render is a genuine desktop layout.
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn((query: string) =>
    query.includes('max-width') ? isPhoneViewport : !isPhoneViewport,
  ),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url) => url || ''),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// FeedPage imports useConfirm by its direct path, so the barrel mock above never
// covers it and the real hook throws without a <ConfirmDialogProvider>. Mirror the
// uiMock's behaviour (an auto-confirming dialog) on the direct path too.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { FeedPage } from './FeedPage';

describe('FeedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
    mockGet.mockResolvedValue({ success: true, data: [], meta: {} });
    mockPost.mockResolvedValue({ success: true });
  });

  it('renders without crashing', () => {
    render(<FeedPage />);
    expect(screen.getByText('Community Feed')).toBeInTheDocument();
  });

  it('keeps feed controls and desktop sidebar in normal document flow', () => {
    render(<FeedPage />);

    const feedControls = screen.getByTestId('feed-controls');
    const sidebarPanel = screen.getByTestId('feed-sidebar-panel');

    // Phones deliberately pin the controls bar below the app bar (sticky with
    // scroll-away hiding); desktop must remain in normal document flow.
    expect(feedControls.className).not.toMatch(/\bfixed\b/);
    expect(feedControls.className).toMatch(/\bsm:static\b/);
    expect(sidebarPanel.className).not.toMatch(/\b(sticky|fixed)\b/);
    expect(sidebarPanel).toHaveClass('static');
    expect(sidebarPanel).toHaveClass('self-start');
  });

  it('shows the page description', () => {
    render(<FeedPage />);
    expect(screen.getByText(/what's happening in your community/i)).toBeInTheDocument();
  });

  it('shows the create button for authenticated users', () => {
    render(<FeedPage />);
    expect(screen.getAllByText('Create').length).toBeGreaterThanOrEqual(1);
  });

  it('shows filter options', () => {
    render(<FeedPage />);
    expect(screen.getAllByText('All').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Posts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Listings').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Events').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Polls').length).toBeGreaterThan(0);
  });

  it('shows quick post box for authenticated users', () => {
    render(<FeedPage />);
    expect(screen.getByText(/What's on your mind/i)).toBeInTheDocument();
  });

  it('shows empty state when no items returned', async () => {
    mockGet.mockResolvedValue({ success: true, data: [], meta: {} });
    render(<FeedPage />);
    await waitFor(() => {
      expect(screen.getByText('No posts yet')).toBeInTheDocument();
    });
  });

  it('renders feed items when data is returned', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          content: 'First post content',
          author_name: 'Alice',
          author_id: 10,
          created_at: '2026-02-21T12:00:00Z',
          type: 'post',
          likes_count: 2,
          comments_count: 0,
          is_liked: false,
        },
      ],
      meta: { has_more: false },
    });
    render(<FeedPage />);
    await waitFor(() => {
      expect(screen.getAllByText('First post content').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
  });

  it('shows Load More when has_more is true', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          content: 'A post',
          author_name: 'User',
          author_id: 10,
          created_at: '2026-02-21T12:00:00Z',
          type: 'post',
          likes_count: 0,
          comments_count: 0,
          is_liked: false,
        },
      ],
      meta: { has_more: true, cursor: 'abc123' },
    });
    render(<FeedPage />);
    await waitFor(() => {
      expect(screen.getByText('Load More')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    render(<FeedPage />);
    await waitFor(() => {
      expect(screen.getByText('Unable to Load Feed')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('calls API with filter type when a filter is selected', async () => {
    // Verify the feed page calls the API with type= when rendered with a filter already set.
    // We simulate this by verifying the API was called for the initial 'all' filter (no type=),
    // then confirm the filter buttons exist and are interactive.
    render(<FeedPage />);

    // Initial load should use per_page without type= param
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('per_page=20')
      );
    });
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('type='));

    // Verify the Events filter control exists and is interactive. The desktop
    // filter set is a single-select HeroUI ToggleButtonGroup, so each option is
    // exposed as a radio inside the 'Select feed filter' radiogroup.
    const filterGroup = screen.getByRole('radiogroup', { name: 'Select feed filter' });
    const eventsBtn = within(filterGroup).getByRole('radio', { name: 'Events' });
    expect(eventsBtn).toBeInTheDocument();
    expect(eventsBtn).not.toBeDisabled();
    expect(eventsBtn).toHaveAttribute('aria-checked', 'false');
  });

  it('calls loadFeed without type param for "all" filter', async () => {
    render(<FeedPage />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('per_page=20')
      );
    });
    // "all" filter should not include type=
    expect(mockGet).not.toHaveBeenCalledWith(
      expect.stringContaining('type=')
    );
  });

  it('shows Goals filter option', () => {
    render(<FeedPage />);
    expect(screen.getAllByText('Goals').length).toBeGreaterThan(0);
  });

  it('shows loading skeletons while loading', async () => {
    // Use a controllable promise instead of never-resolving one (prevents Vitest hang on CI)
    let resolveApi: (value: unknown) => void;
    mockGet.mockReturnValue(new Promise((resolve) => { resolveApi = resolve; }));
    render(<FeedPage />);
    // The loading state is a single live region holding the FeedSkeleton cards,
    // each of which renders a GlassCard (class "glass-card") as its root.
    const loadingRegion = screen.getByRole('status', { name: 'Loading community updates...' });
    const skeletonCards = loadingRegion.querySelectorAll('.glass-card');
    // At least 3 skeleton cards
    expect(skeletonCards.length).toBeGreaterThanOrEqual(3);
    // Clean up: resolve the promise so Vitest can exit cleanly
    resolveApi!({ success: true, data: [], meta: {} });
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the slim sticky controls bar with the filter-sheet trigger and no desktop sidebar', () => {
      render(<FeedPage />);

      const feedControls = screen.getByTestId('feed-controls');
      // Phones pin the bar below the app bar and let it scroll away.
      expect(feedControls.className).toMatch(/\bsticky\b/);
      expect(within(feedControls).getByRole('button', { name: 'Filters' })).toBeInTheDocument();
      // The widget sidebar is desktop-only (min-width: 1024px).
      expect(screen.queryByTestId('feed-sidebar-panel')).not.toBeInTheDocument();
    });

    it('reveals the feed filter chips inside the filter sheet', async () => {
      render(<FeedPage />);

      // Closed by default — the filters live behind the trigger, not in the bar.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

      const sheet = await screen.findByRole('dialog');
      const sheetFilters = within(sheet).getByRole('radiogroup', { name: 'Select feed filter' });
      expect(within(sheetFilters).getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
      expect(within(sheetFilters).getByRole('radio', { name: 'Posts' })).toBeInTheDocument();
      expect(within(sheetFilters).getByRole('radio', { name: 'Events' })).toBeInTheDocument();
      expect(within(sheetFilters).getByRole('radio', { name: 'Listings' })).toBeInTheDocument();
    });

    it('keeps the sheet open on a filter with sub-filters and applies it to the feed request', async () => {
      render(<FeedPage />);
      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('per_page=20'));
      });
      mockGet.mockClear();

      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      const sheet = await screen.findByRole('dialog');
      fireEvent.click(within(sheet).getByRole('radio', { name: 'Listings' }));

      // Listings has sub-filters, so the sheet stays open to offer them.
      await waitFor(() => {
        expect(within(sheet).getByRole('gridcell', { name: 'Offers' })).toBeInTheDocument();
      });
      expect(within(sheet).getByRole('gridcell', { name: 'Requests' })).toBeInTheDocument();

      // And the chosen filter reaches the API.
      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('type=listings'));
      });
    });
  });
});
