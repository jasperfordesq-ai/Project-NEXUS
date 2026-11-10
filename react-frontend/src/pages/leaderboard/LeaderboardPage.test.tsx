// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LeaderboardPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

// Mock API module
// Default mock: returns null data for seasons (SeasonCard) and empty array for leaderboard
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockImplementation((url: string) => {
      if (url.includes('/leaderboard')) {
        return Promise.resolve({ success: true, data: [], meta: {} });
      }
      // seasons, community-dashboard, etc. — non-array endpoints return null
      return Promise.resolve({ success: true, data: null, meta: {} });
    }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// Mock contexts - must include ToastProvider since test-utils.tsx uses it
vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User' },
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
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,  };});

import { LeaderboardPage } from './LeaderboardPage';

describe('LeaderboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title and description', () => {
    render(<LeaderboardPage />);
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('See how our community is growing together')).toBeInTheDocument();
  });

  it('shows type selector with XP as default', () => {
    render(<LeaderboardPage />);
    expect(screen.getByLabelText('Leaderboard type')).toBeInTheDocument();
  });

  it('shows period selector', () => {
    render(<LeaderboardPage />);
    expect(screen.getByLabelText('Leaderboard period')).toBeInTheDocument();
  });

  it('shows loading skeleton initially', () => {
    render(<LeaderboardPage />);
    // HeroUI Skeleton does not use animate-pulse; the loading GlassCards expose role="status"
    const loadingContainers = document.querySelectorAll('[role="status"]');
    expect(loadingContainers.length).toBeGreaterThan(0);
  });

  it('shows empty state when no entries are loaded', async () => {
    // Default mock already returns [] for leaderboard and null for seasons
    render(<LeaderboardPage />);

    // Other tabs (e.g. Member Spotlight) also render EmptyState in the eager
    // test mock, so scope the assertion to the leaderboard's own empty state.
    await waitFor(() => {
      expect(screen.getByText('No rankings yet')).toBeInTheDocument();
    });
    expect(
      screen.getAllByTestId('empty-state').length,
    ).toBeGreaterThan(0);
  });

  it('displays leaderboard entries when loaded', async () => {
    const { api } = await import('@/lib/api');
    const mockEntries = [
      {
        position: 1,
        user: { id: 10, name: 'Alice Champion', avatar_url: null },
        xp: 5000,
        score: 5000,
        level: 15,
        is_current_user: false,
      },
      {
        position: 2,
        user: { id: 1, name: 'Test User', avatar_url: null },
        xp: 3500,
        score: 3500,
        level: 12,
        is_current_user: true,
      },
      {
        position: 3,
        user: { id: 20, name: 'Bob Runner', avatar_url: null },
        xp: 2000,
        score: 2000,
        level: 8,
        is_current_user: false,
      },
    ];

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/leaderboard')) {
        return Promise.resolve({
          success: true,
          data: mockEntries,
          meta: {
            period: 'all',
            type: 'xp',
            your_position: 2,
            total_entries: 50,
          },
        });
      }
      return Promise.resolve({ success: true, data: null, meta: {} });
    });

    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Alice Champion').length).toBeGreaterThan(0);
    });
    // Each of the top three is named in the list and again on the podium.
    expect(screen.getAllByText('Test User').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob Runner').length).toBeGreaterThan(0);

    // The podium is a picture of the list's top three: hidden from screen
    // readers, nothing to click, first place in the middle.
    const podium = screen.getByTestId('leaderboard-podium');
    expect(podium).toHaveAttribute('aria-hidden', 'true');
    expect(podium.querySelector('a, button')).toBeNull();
    const steps = [...podium.children].map((column) => column.lastElementChild?.textContent);
    expect(steps).toEqual(['2', '1', '3']);
    // Every name is still a link in the list itself.
    expect(screen.getByRole('link', { name: /Alice Champion/ })).toBeInTheDocument();
    // Check XP scores are displayed
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('3,500')).toBeInTheDocument();
    // Check levels
    expect(screen.getByText('Level 15')).toBeInTheDocument();
    expect(screen.getByText('Level 12')).toBeInTheDocument();
  });

  it('does not crash when an entry is missing both score and xp (degraded backend)', async () => {
    // Regression: formatScore did `(entry.score ?? entry.xp).toLocaleString()`. If a
    // degraded entry has both score and xp null/missing, that value is undefined and
    // .toLocaleString() threw during render — blanking the WHOLE Leaderboard page via
    // the error boundary. It must now coerce to 0 and render the row.
    const { api } = await import('@/lib/api');
    const mockEntries = [
      {
        position: 1,
        user: { id: 1, name: 'Degraded User', avatar_url: null },
        xp: null,
        score: null,
        level: 7,
        is_current_user: true,
      },
    ];

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/leaderboard')) {
        return Promise.resolve({
          success: true,
          data: mockEntries,
          meta: { period: 'all', type: 'xp', your_position: 1, total_entries: 1 },
        });
      }
      return Promise.resolve({ success: true, data: null, meta: {} });
    });

    render(<LeaderboardPage />);

    // If formatScore threw, the row (and the whole page) would be replaced by the
    // error boundary and this name would never appear.
    await waitFor(() => {
      expect(screen.getByText('Degraded User')).toBeInTheDocument();
    });
    expect(screen.getByText('Level 7')).toBeInTheDocument();
  });

  it('highlights current user entry', async () => {
    const { api } = await import('@/lib/api');
    const mockEntries = [
      {
        position: 1,
        user: { id: 1, name: 'Test User', avatar_url: null },
        xp: 5000,
        score: 5000,
        level: 15,
        is_current_user: true,
      },
    ];

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/leaderboard')) {
        return Promise.resolve({
          success: true,
          data: mockEntries,
          meta: {
            period: 'all',
            type: 'xp',
            your_position: 1,
            total_entries: 50,
          },
        });
      }
      return Promise.resolve({ success: true, data: null, meta: {} });
    });

    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByText('(You)')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/seasons')) {
        return Promise.resolve({ success: true, data: null, meta: {} });
      }
      return Promise.reject(new Error('Network error'));
    });

    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Leaderboard')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });
});
