// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GroupsPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { api } from '@/lib/api';

// src/test/setup.ts stubs window.matchMedia to matches:false for EVERY query, so
// without this mock `isPhone` is permanently false and the phone branch would ship
// with zero coverage. Query-aware so a max-width and a min-width consumer can never
// both answer "true" and describe an impossible viewport.
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn((query: string) =>
    query.includes('min-width') ? !isPhoneViewport : isPhoneViewport,
  ),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Tenant' },
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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Tenant' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAssetUrl: vi.fn((url) => url || ''),
    resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
    resolveThumbnailUrl: vi.fn((url) => url || ''),
  };
});
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
// RecommendedGroups makes its own independent api.get('/v2/matches/all...') call in a
// useEffect that fires before GroupsPage's own loadGroups effect (child effects commit
// before the parent's). Left unmocked, it silently consumes any mockResolvedValueOnce()
// queued for the groups list call below. It has its own dedicated test coverage.
vi.mock('./components/RecommendedGroups', () => ({
  RecommendedGroups: () => null,
}));
vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { GroupsPage } from './GroupsPage';

describe('GroupsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
    window.history.replaceState({}, '', '/groups');
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [], meta: {} });
  });

  it('renders without crashing', () => {
    render(<GroupsPage />);
    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('shows Create Group button for authenticated users', () => {
    render(<GroupsPage />);
    expect(screen.getByText('Create Group')).toBeInTheDocument();
  });

  it('shows search input', () => {
    render(<GroupsPage />);
    expect(screen.getByPlaceholderText(/Search groups/i)).toBeInTheDocument();
  });

  it('restores shared search and visibility state from the URL', async () => {
    window.history.replaceState({}, '', '/groups?q=garden&visibility=private');

    render(<GroupsPage />);

    expect(screen.getByRole('searchbox', { name: /Search groups/i })).toHaveValue('garden');
    expect(screen.getByRole('radio', { name: /Private/i })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      const request = vi.mocked(api.get).mock.calls.at(-1)?.[0] ?? '';
      expect(request).toContain('q=garden');
      expect(request).toContain('visibility=private');
    });
  });

  it('writes ownership and visibility filters to mutually exclusive URL params', async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    await user.click(screen.getByRole('radio', { name: /Public/i }));
    expect(new URLSearchParams(window.location.search).get('visibility')).toBe('public');
    expect(new URLSearchParams(window.location.search).has('scope')).toBe(false);

    await user.click(screen.getByRole('radio', { name: /My Groups/i }));
    expect(new URLSearchParams(window.location.search).get('scope')).toBe('joined');
    expect(new URLSearchParams(window.location.search).has('visibility')).toBe(false);
  });

  it('restores filter state when browser history navigation changes the URL', async () => {
    render(<GroupsPage />);

    act(() => {
      window.history.pushState({}, '', '/groups?scope=joined');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByRole('radio', { name: /My Groups/i })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('user_id=1'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    act(() => {
      window.history.pushState({}, '', '/groups?visibility=private');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('radio', { name: /Private/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('hides the clear-search action until a query exists', async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: /Search groups/i }), 'garden');
    expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument();
  });

  it('navigates from the empty-state create link with pointer input', async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    const links = await screen.findAllByRole('link', { name: 'Create Group' });
    await user.click(links.at(-1)!);

    await waitFor(() => expect(window.location.pathname).toBe('/test/groups/create'));
  });

  it('navigates from the empty-state create link with the keyboard', async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    const links = await screen.findAllByRole('link', { name: 'Create Group' });
    const emptyStateLink = links.at(-1)!;
    emptyStateLink.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(window.location.pathname).toBe('/test/groups/create'));
  });

  it('loads public groups when the public filter is selected', async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    // The visibility filter is a HeroUI ToggleButtonGroup — items expose role="radio"
    await user.click(screen.getByRole('radio', { name: /Public/i }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('visibility=public'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(screen.getByText('Showing')).toBeInTheDocument();
    expect(screen.getAllByText('Public').length).toBeGreaterThan(0);
  });

  it('loads joined groups through the membership user filter', async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    await user.click(screen.getByRole('radio', { name: /My Groups/i }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('user_id=1'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('renders the error state when the API resolves with success:false', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: false,
      code: 'HTTP_500',
      error: 'Raw server copy must not be rendered',
    });

    render(<GroupsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to Load Groups');
    expect(screen.getByText('Failed to load groups. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('No groups found')).not.toBeInTheDocument();
    expect(screen.queryByText('Raw server copy must not be rendered')).not.toBeInTheDocument();
  });

  it('renders polished group cards with imagery and accessible stats', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 42,
          name: 'Garden Crew',
          description: 'A group for growing food together.',
          image_url: '/uploads/groups/garden.jpg',
          member_count: 12,
          members_count: 12,
          posts_count: 5,
          visibility: 'public',
          is_featured: true,
          tags: [{ id: 1, name: 'Outdoors' }],
          recent_members: [],
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      meta: { has_more: false, total_items: 1 },
    });

    const { container } = render(<GroupsPage />);

    expect(await screen.findByText('Garden Crew')).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/\/uploads\/groups\/garden\.jpg$/);
    expect(screen.getByRole('link', { name: /Garden Crew - Public Group - 12 members/i })).toBeInTheDocument();
    expect(screen.getByLabelText('12 members')).toBeInTheDocument();
    expect(screen.getByLabelText('5 posts')).toBeInTheDocument();
    expect(screen.getByText('Featured')).toBeInTheDocument();
  });

  it('deduplicates appended IDs and ignores a second in-flight load-more request', async () => {
    let resolveSecondPage!: (value: {
      success: boolean;
      data: Array<Record<string, unknown>>;
      meta: { has_more: boolean; cursor: string | null; total_items: number };
    }) => void;
    const secondPage = new Promise<{
      success: boolean;
      data: Array<Record<string, unknown>>;
      meta: { has_more: boolean; cursor: string | null; total_items: number };
    }>((resolve) => { resolveSecondPage = resolve; });
    const firstGroup = {
      id: 1,
      name: 'Garden Crew',
      description: 'Grow together',
      member_count: 3,
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
    };
    const secondGroup = {
      ...firstGroup,
      id: 2,
      name: 'Repair Circle',
    };
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        success: true,
        data: [firstGroup],
        meta: { has_more: true, cursor: 'next-page', total_items: 2 },
      })
      .mockReturnValueOnce(secondPage);

    render(<GroupsPage />);
    expect(await screen.findByText('Garden Crew')).toBeInTheDocument();

    const loadMore = screen.getByRole('button', { name: /Load/i });
    loadMore.click();
    loadMore.click();
    expect(api.get).toHaveBeenCalledTimes(2);

    resolveSecondPage({
      success: true,
      data: [firstGroup, secondGroup],
      meta: { has_more: false, cursor: null, total_items: 2 },
    });

    expect(await screen.findByText('Repair Circle')).toBeInTheDocument();
    expect(screen.getAllByText('Garden Crew')).toHaveLength(1);
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the sticky bar and drops the desktop hero, quick filters and search card', () => {
      render(<GroupsPage />);

      // Sticky bar: search pill (text, not an input) + Filters button.
      expect(screen.getByTestId('groups-filter-bar')).toBeInTheDocument();
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search groups...')).toBeInTheDocument();

      // Desktop chrome is gone: hero <h1>, the quick-filter radios and the
      // GlassCard SearchField (a real input with that placeholder).
      expect(screen.queryByText('Groups')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/Search groups/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Public' })).not.toBeInTheDocument();
      expect(screen.queryByText('Join groups to connect with like-minded community members'))
        .not.toBeInTheDocument();
    });

    it('re-homes the Create Group action into the sticky bar', () => {
      render(<GroupsPage />);

      const bar = screen.getByTestId('groups-filter-bar');
      const create = within(bar).getByRole('link', { name: 'Create Group' });
      expect(create).toHaveAttribute('href', '/test/groups/create');
    });

    it('opens the filter sheet with the scope and visibility chips', async () => {
      const user = userEvent.setup();
      render(<GroupsPage />);

      await user.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByRole('radiogroup', { name: 'Group filters' })).toBeInTheDocument();
      });
      expect(screen.getByRole('radio', { name: 'All Groups' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'My Groups' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Public' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Private' })).toBeInTheDocument();
      // Simple archetype: no draft, therefore no apply footer.
      expect(screen.queryByText(/^Show results$/)).not.toBeInTheDocument();
    });

    it('applies a sheet chip immediately and closes the sheet', async () => {
      const user = userEvent.setup();
      render(<GroupsPage />);
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      vi.mocked(api.get).mockClear();

      await user.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Public' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('radio', { name: 'Public' }));

      // Immediate-apply: the tap itself refetches the list (no Apply button exists).
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(
          expect.stringContaining('visibility=public'),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
      await waitFor(() => {
        expect(screen.queryByRole('radiogroup', { name: 'Group filters' })).not.toBeInTheDocument();
      });
    });

    it('shows the applied filter as a removable chip and clears it on tap', async () => {
      const user = userEvent.setup();
      window.history.replaceState({}, '', '/groups?visibility=public');
      render(<GroupsPage />);

      const bar = screen.getByTestId('groups-filter-bar');
      const remove = within(bar).getByRole('button', { name: 'Remove filter: Public' });
      await user.click(remove);

      expect(new URLSearchParams(window.location.search).has('visibility')).toBe(false);
      await waitFor(() => {
        expect(
          within(screen.getByTestId('groups-filter-bar'))
            .queryByRole('button', { name: 'Remove filter: Public' }),
        ).not.toBeInTheDocument();
      });
    });

    it('clears the query and the filter together from Clear all', async () => {
      const user = userEvent.setup();
      window.history.replaceState({}, '', '/groups?q=garden&visibility=private');
      render(<GroupsPage />);

      const bar = screen.getByTestId('groups-filter-bar');
      expect(within(bar).getByText('garden')).toBeInTheDocument();

      await user.click(within(bar).getByText('Clear all'));

      const params = new URLSearchParams(window.location.search);
      expect(params.has('q')).toBe(false);
      expect(params.has('visibility')).toBe(false);
    });
  });
});
