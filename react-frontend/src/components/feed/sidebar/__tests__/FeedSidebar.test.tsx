// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FeedSidebar orchestrator component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { api } from '@/lib/api';

// Stable mock references to prevent infinite render loops
const mockTenantReturn = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

const mockToastReturn = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

const mockAuthReturn = {
  isAuthenticated: true,
  user: { id: 1, first_name: 'Alice', last_name: 'Smith', username: 'asmith', avatar: '/alice.png' },
};

const mockAuthUnauthReturn = {
  isAuthenticated: false,
  user: null,
};

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
  useTenant: vi.fn(() => mockTenantReturn),
  useAuth: vi.fn(() => mockAuthReturn),
  useToast: vi.fn(() => mockToastReturn),
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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string | undefined) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url: string | undefined) => url || ''),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// Mock child widgets to isolate FeedSidebar orchestrator logic
vi.mock('../ProfileCardWidget', () => ({
  ProfileCardWidget: () => <div data-testid="profile-card-widget">ProfileCardWidget</div>,
}));

vi.mock('../QuickActionsWidget', () => ({
  QuickActionsWidget: () => <div data-testid="quick-actions-widget">QuickActionsWidget</div>,
}));

vi.mock('../FriendsWidget', () => ({
  FriendsWidget: ({ friends }: { friends: unknown[] }) => (
    <div data-testid="friends-widget">FriendsWidget ({friends.length})</div>
  ),
}));

vi.mock('../CommunityPulseWidget', () => ({
  CommunityPulseWidget: () => <div data-testid="community-pulse-widget">CommunityPulseWidget</div>,
}));

vi.mock('../SuggestedListingsWidget', () => ({
  SuggestedListingsWidget: ({ listings }: { listings: unknown[] }) => (
    <div data-testid="suggested-listings-widget">SuggestedListingsWidget ({listings.length})</div>
  ),
}));

vi.mock('../TopCategoriesWidget', () => ({
  TopCategoriesWidget: ({ categories }: { categories: unknown[] }) => (
    <div data-testid="top-categories-widget">TopCategoriesWidget ({categories.length})</div>
  ),
}));

vi.mock('../PeopleYouMayKnowWidget', () => ({
  PeopleYouMayKnowWidget: ({ members }: { members: unknown[] }) => (
    <div data-testid="people-widget">PeopleYouMayKnowWidget ({members.length})</div>
  ),
}));

vi.mock('../UpcomingEventsWidget', () => ({
  UpcomingEventsWidget: ({ events }: { events: unknown[] }) => (
    <div data-testid="upcoming-events-widget">UpcomingEventsWidget ({events.length})</div>
  ),
}));

vi.mock('../PopularGroupsWidget', () => ({
  PopularGroupsWidget: ({ groups }: { groups: unknown[] }) => (
    <div data-testid="popular-groups-widget">PopularGroupsWidget ({groups.length})</div>
  ),
}));

vi.mock('@/components/hashtags/TrendingHashtags', () => ({
  TrendingHashtags: () => <div data-testid="trending-hashtags">TrendingHashtags</div>,
}));

vi.mock('@/components/endorsements/TopEndorsedWidget', () => ({
  TopEndorsedWidget: () => <div data-testid="top-endorsed-widget">TopEndorsedWidget</div>,
}));

vi.mock('@/components/feed/ConnectionSuggestionsWidget', () => ({
  ConnectionSuggestionsWidget: () => <div data-testid="connection-suggestions-widget">ConnectionSuggestionsWidget</div>,
}));

vi.mock('../WidgetSkeleton', () => ({
  WidgetSkeleton: ({ lines }: { lines?: number }) => (
    <div data-testid="widget-skeleton">WidgetSkeleton (lines={lines ?? 3})</div>
  ),
}));

import { FeedSidebar } from '../FeedSidebar';

const fullSidebarData = {
  friends: [{ id: 5, name: 'Dave', avatar_url: '/dave.png', is_online: true }],
  community_stats: { members: 100, listings: 50, events: 10, groups: 5 },
  suggested_listings: [{ id: 10, title: 'Help', type: 'offer', owner_name: 'Bob' }],
  top_categories: [{ id: 1, name: 'Gardening', slug: 'gardening', count: 30 }],
  suggested_members: [{ id: 7, name: 'Frank', avatar_url: '/frank.png', is_online: true }],
  upcoming_events: [{ id: 1, title: 'Meetup', start_date: '2026-04-15' }],
  popular_groups: [{ id: 1, name: 'Gardeners', member_count: 42 }],
};

describe('FeedSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeletons while fetching data', () => {
    // Never resolves, so stays in loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    render(<FeedSidebar />);
    const skeletons = screen.getAllByTestId('widget-skeleton');
    expect(skeletons.length).toBe(3);
  });

  it('renders all widgets when API returns full data', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: fullSidebarData });

    render(<FeedSidebar />);

    await waitFor(() => {
      expect(screen.getByTestId('profile-card-widget')).toBeInTheDocument();
    });

    expect(screen.getByTestId('quick-actions-widget')).toBeInTheDocument();
    expect(screen.getByTestId('friends-widget')).toBeInTheDocument();
    expect(screen.getByTestId('community-pulse-widget')).toBeInTheDocument();
    expect(screen.getByTestId('suggested-listings-widget')).toBeInTheDocument();
    expect(screen.getByTestId('top-categories-widget')).toBeInTheDocument();
    expect(screen.getByTestId('connection-suggestions-widget')).toBeInTheDocument();
    expect(screen.getByTestId('upcoming-events-widget')).toBeInTheDocument();
    expect(screen.getByTestId('popular-groups-widget')).toBeInTheDocument();
    expect(screen.getByTestId('trending-hashtags')).toBeInTheDocument();
    expect(screen.getByTestId('top-endorsed-widget')).toBeInTheDocument();
  });

  it('hides ProfileCardWidget and QuickActionsWidget when not authenticated', async () => {
    const { useAuth } = await import('@/contexts');
    vi.mocked(useAuth).mockReturnValue(mockAuthUnauthReturn as ReturnType<typeof useAuth>);

    vi.mocked(api.get).mockResolvedValue({ success: true, data: fullSidebarData });

    render(<FeedSidebar />);

    await waitFor(() => {
      expect(screen.getByTestId('friends-widget')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('profile-card-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-actions-widget')).not.toBeInTheDocument();
  });

  it('hides FriendsWidget when friends array is empty', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...fullSidebarData, friends: [] },
    });

    render(<FeedSidebar />);

    await waitFor(() => {
      expect(screen.getByTestId('community-pulse-widget')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('friends-widget')).not.toBeInTheDocument();
  });

  it('hides PopularGroupsWidget when popular_groups is empty', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { ...fullSidebarData, popular_groups: [] },
    });

    render(<FeedSidebar />);

    await waitFor(() => {
      expect(screen.getByTestId('community-pulse-widget')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('popular-groups-widget')).not.toBeInTheDocument();
  });

  it('handles API failure gracefully without crashing', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    render(<FeedSidebar />);

    await waitFor(() => {
      // After error, loading should be false and skeletons should be gone
      expect(screen.queryByTestId('widget-skeleton')).not.toBeInTheDocument();
    });

    // TrendingHashtags and TopEndorsedWidget always render
    expect(screen.getByTestId('trending-hashtags')).toBeInTheDocument();
    expect(screen.getByTestId('top-endorsed-widget')).toBeInTheDocument();
  });

  it('handles API returning success: false', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, data: null });

    render(<FeedSidebar />);

    await waitFor(() => {
      expect(screen.queryByTestId('widget-skeleton')).not.toBeInTheDocument();
    });

    // No sidebar data widgets should render since data is null
    expect(screen.queryByTestId('friends-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('community-pulse-widget')).not.toBeInTheDocument();
  });

  it('hides connection-related widgets when connections feature is disabled', async () => {
    const { useFeature } = await import('@/contexts');
    vi.mocked(useFeature).mockImplementation((feature: string) => feature !== 'connections');
    vi.mocked(api.get).mockResolvedValue({ success: true, data: fullSidebarData });

    render(<FeedSidebar />);

    await waitFor(() => {
      expect(screen.getByTestId('suggested-listings-widget')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('community-pulse-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connection-suggestions-widget')).not.toBeInTheDocument();
  });

  it('handles empty sidebar data (all fields undefined)', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: {} });

    render(<FeedSidebar />);

    await waitFor(() => {
      expect(screen.queryByTestId('widget-skeleton')).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId('friends-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('community-pulse-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggested-listings-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('popular-groups-widget')).not.toBeInTheDocument();
  });
});
