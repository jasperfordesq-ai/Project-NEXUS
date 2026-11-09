// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GoalsPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

// Mock API module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// Mock contexts
vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User', last_name: 'User' },
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
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,

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

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url || null),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  ),
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

import { GoalsPage } from './GoalsPage';

describe('GoalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title and description', () => {
    render(<GoalsPage />);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Set goals and track your progress')).toBeInTheDocument();
  });

  it('shows New Goal button for authenticated users', () => {
    render(<GoalsPage />);
    expect(screen.getByText('New Goal')).toBeInTheDocument();
  });

  it('renders My Goals and Discover tab buttons', () => {
    render(<GoalsPage />);
    expect(screen.getByText('My Goals')).toBeInTheDocument();
    expect(screen.getByText('Discover')).toBeInTheDocument();
  });

  it('shows loading skeleton initially', () => {
    render(<GoalsPage />);
    // HeroUI Skeleton does not use animate-pulse; check for aria-busy loading containers instead
    const loadingContainers = document.querySelectorAll('[aria-busy="true"]');
    expect(loadingContainers.length).toBeGreaterThan(0);
  });

  it('shows empty state when no goals are loaded', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [], meta: {} });

    render(<GoalsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('No goals yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first goal to start tracking progress')).toBeInTheDocument();
  });

  it('shows Create Goal button in empty state', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [], meta: {} });

    render(<GoalsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Create Goal').length).toBeGreaterThan(0);
  });

  it('displays goals with progress when loaded', async () => {
    const { api } = await import('@/lib/api');
    const mockGoals = [
      {
        id: 1,
        user_id: 1,
        title: 'Give 10 hours this month',
        description: 'Helping the community',
        target_value: 10,
        current_value: 4,
        deadline: '2026-03-01T00:00:00Z',
        is_public: true,
        status: 'active',
        created_at: '2026-01-15T10:00:00Z',
        updated_at: '2026-01-20T10:00:00Z',
        user_name: 'Test User',
        user_avatar: null,
        progress_percentage: 40,
        is_owner: true,
        buddy_id: null,
        buddy_name: null,
        buddy_avatar: null,
        likes_count: 3,
        comments_count: 1,
      },
    ];

    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: mockGoals,
      meta: { has_more: false },
    });

    render(<GoalsPage />);

    await waitFor(() => {
      expect(screen.getByText('Give 10 hours this month')).toBeInTheDocument();
    });
    expect(screen.getByText('Helping the community')).toBeInTheDocument();
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    // Each goal carries its own colour — the same as its goal page.
    const { colourForSeed, paletteFor } = await import('@/lib/categoryColours');
    const { coverSeed } = await import('@/lib/coverSeeds');
    expect(screen.getByTestId('goal-card-tile').getAttribute('data-colour'))
      .toBe(colourForSeed(coverSeed.goal(1), paletteFor(null)));
  });

  it('shows error state on API failure', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    render(<GoalsPage />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Goals')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  describe('Load more re-entry guard', () => {
    // Use a non-owner goal so GoalCard renders no GoalReminderToggle (which
    // would fire its own api.get calls and pollute the call-count assertions).
    const baseGoal = {
      user_id: 999,
      description: '',
      target_value: 10,
      current_value: 4,
      deadline: null,
      is_public: true,
      status: 'active' as const,
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-01-20T10:00:00Z',
      user_name: 'Someone Else',
      user_avatar: null,
      progress_percentage: 40,
      is_owner: false,
      buddy_id: null,
      buddy_name: null,
      buddy_avatar: null,
    };

    it('does not append the same page twice when Load More is double-clicked', async () => {
      const { api } = await import('@/lib/api');
      const goalA = { ...baseGoal, id: 1, title: 'First page goal' };
      const goalB = { ...baseGoal, id: 2, title: 'Second page goal' };

      let resolveSecond!: (v: unknown) => void;
      const secondPage = new Promise((res) => { resolveSecond = res; });

      vi.mocked(api.get)
        .mockResolvedValueOnce({ success: true, data: [goalA], meta: { has_more: true, cursor: 'c1' } })
        .mockImplementation(() => secondPage as Promise<never>);

      render(<GoalsPage />);
      await screen.findByText('First page goal');

      const loadMore = screen.getByRole('button', { name: /load more/i });
      // Double-click before the request settles — the second press must be a no-op.
      fireEvent.click(loadMore);
      fireEvent.click(loadMore);

      resolveSecond({ success: true, data: [goalB], meta: { has_more: false } });

      await screen.findByText('Second page goal');
      // Regression: the un-guarded handler appended the same page twice,
      // producing duplicate cards with colliding React keys.
      expect(screen.getAllByText('Second page goal')).toHaveLength(1);

      const goalCalls = vi.mocked(api.get).mock.calls
        .filter(([url]) => typeof url === 'string' && url.startsWith('/v2/goals?'));
      expect(goalCalls).toHaveLength(2); // initial load + ONE load-more
      expect(String(goalCalls[1]?.[0])).toContain('cursor=c1');
    });

    it('disables the Load More button while the next page is in flight', async () => {
      const { api } = await import('@/lib/api');
      const goalA = { ...baseGoal, id: 1, title: 'First page goal' };

      let resolveSecond!: (v: unknown) => void;
      const secondPage = new Promise((res) => { resolveSecond = res; });

      vi.mocked(api.get)
        .mockResolvedValueOnce({ success: true, data: [goalA], meta: { has_more: true, cursor: 'c1' } })
        .mockImplementation(() => secondPage as Promise<never>);

      render(<GoalsPage />);
      await screen.findByText('First page goal');

      const loadMore = screen.getByRole('button', { name: /load more/i });
      fireEvent.click(loadMore);

      await waitFor(() => {
        const inert =
          loadMore.hasAttribute('disabled') ||
          loadMore.getAttribute('aria-disabled') === 'true' ||
          loadMore.getAttribute('data-pending') === 'true';
        expect(inert).toBe(true);
      });

      resolveSecond({ success: true, data: [], meta: { has_more: false } });
      // Button disappears once has_more is false.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
      });
    });
  });
});
