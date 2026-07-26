// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AchievementsPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      success: true,
      data: [],
      meta: { available_types: [] },
    }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
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

// AchievementsPage imports useToast from '@/contexts/ToastContext' directly at five call sites,
// so the override in the '@/contexts' barrel above is dead — vitest resolves mocks per specifier.
// It has been passing only because test-utils wraps a real ToastProvider, which means toasts were
// being swallowed by the real provider rather than observed here.
vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { AchievementsPage } from './AchievementsPage';
import { api } from '@/lib/api';

describe('AchievementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks for profile and badges
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/gamification/profile')) {
        return Promise.resolve({
          success: true,
          data: {
            user: { id: 1, name: 'Test User', avatar_url: null },
            xp: 1200,
            level: 5,
            level_progress: {
              current_xp: 200,
              xp_for_current_level: 1000,
              xp_for_next_level: 1500,
              progress_percentage: 40,
            },
            badges_count: 3,
            showcased_badges: [],
            is_own_profile: true,
          },
        });
      }
      if (url.includes('/v2/gamification/badges')) {
        return Promise.resolve({
          success: true,
          data: [
            {
              badge_key: 'first_post',
              name: 'First Post',
              description: 'Made your first post',
              icon: '',
              type: 'social',
              created_at: '2026-01-01',
              is_showcased: false,
              earned: true,
              earned_at: '2026-01-01',
            },
            {
              badge_key: 'helper',
              name: 'Helper',
              description: 'Helped 5 people',
              icon: '',
              type: 'community',
              created_at: '2026-01-05',
              is_showcased: true,
              earned: true,
              earned_at: '2026-01-05',
            },
            {
              badge_key: 'locked_badge',
              name: 'Locked Badge',
              description: 'This is locked',
              icon: '',
              type: 'special',
              created_at: '2026-01-10',
              is_showcased: false,
              earned: false,
              earned_at: null,
            },
          ],
          meta: { total: 3, available_types: ['social', 'community', 'special'] },
        });
      }
      if (url.includes('/v2/gamification/daily-reward')) {
        return Promise.resolve({
          success: true,
          data: {
            claimed_today: false,
            current_streak: 3,
            reward_xp: 25,
            next_reward_xp: 30,
            next_claim_at: null,
          },
        });
      }
      if (url.includes('/v2/gamification/challenges')) {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url.includes('/v2/gamification/collections')) {
        return Promise.resolve({ success: true, data: [] });
      }
      if (url.includes('/v2/gamification/shop')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true, data: [], meta: {} });
    });
  });

  it('renders the page heading and description', async () => {
    render(<AchievementsPage />);
    expect(screen.getByText('Achievements')).toBeInTheDocument();
    expect(screen.getByText('Track your badges, XP, and progress')).toBeInTheDocument();
  });

  it('displays badges after loading', async () => {
    render(<AchievementsPage />);
    // "First Post" can surface in more than one section (e.g. grid + recent),
    // so assert at least one instance is displayed.
    await waitFor(() => {
      expect(screen.getAllByText('First Post').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Helper').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Locked Badge').length).toBeGreaterThan(0);
  });

  it('shows XP profile card with level and XP info', async () => {
    render(<AchievementsPage />);
    await waitFor(() => {
      expect(screen.getByText('Level 5')).toBeInTheDocument();
    });
    expect(screen.getByText('1,200 XP total')).toBeInTheDocument();
  });

  it('does not crash the page when the profile is missing xp / level_progress (degraded backend)', async () => {
    // Regression: the XP profile card did `profile.xp.toLocaleString()` and
    // `profile.level_progress.progress_percentage` directly. The profile is set from a
    // blind cast (`as unknown as GamificationProfile`), so a degraded response
    // (success:true but missing xp / level_progress — e.g. a backend catch-fallback)
    // threw during render and blanked the WHOLE Achievements page via the error
    // boundary. The card must now coerce those to 0 and render.
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/gamification/profile')) {
        return Promise.resolve({
          success: true,
          data: {
            user: { id: 1, name: 'Test User', avatar_url: null },
            level: 5,
            badges_count: 3,
            showcased_badges: [],
            is_own_profile: true,
            // xp and level_progress deliberately omitted
          },
        });
      }
      return Promise.resolve({ success: true, data: [], meta: { available_types: [] } });
    });
    render(<AchievementsPage />);
    await waitFor(() => {
      expect(screen.getByText('Level 5')).toBeInTheDocument();
    });
    // Renders the card with a coerced 0 instead of crashing to the error boundary.
    expect(screen.getByText('0 XP total')).toBeInTheDocument();
    expect(screen.getByText('Achievements')).toBeInTheDocument();
  });

  it('shows badge type filter when types are available', async () => {
    render(<AchievementsPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Filter badges by type')).toBeInTheDocument();
    });
  });

  it('shows Manage Showcase button', async () => {
    render(<AchievementsPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage Showcase')).toBeInTheDocument();
    });
  });

  it('shows tab navigation with Badges, Challenges, Journeys, Engagement, XP Shop', async () => {
    render(<AchievementsPage />);
    await waitFor(() => {
      // "Badges" appears in profile card ("3 Badges") and tab, use getAllByText
      expect(screen.getAllByText('Badges').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Challenges')).toBeInTheDocument();
    expect(screen.getByText('Journeys')).toBeInTheDocument();
    expect(screen.getByText('Engagement')).toBeInTheDocument();
    expect(screen.getByText('XP Shop')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<AchievementsPage />);
    await waitFor(() => {
      expect(screen.getByText('Unable to Load Achievements')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('shows showcased chip on showcased badges', async () => {
    render(<AchievementsPage />);
    await waitFor(() => {
      expect(screen.getByText('Showcased')).toBeInTheDocument();
    });
  });
});
