// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for feed sidebar widgets:
 * CommunityPulseWidget, UpcomingEventsWidget, SuggestedListingsWidget,
 * FriendsWidget, PopularGroupsWidget, QuickActionsWidget,
 * PeopleYouMayKnowWidget, TopCategoriesWidget, WidgetSkeleton
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

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
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn((feature: string) => ['events', 'polls', 'goals', 'groups'].includes(feature)),
    hasModule: vi.fn(() => true),
  })),
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: {
      id: 1,
      first_name: 'Alice',
      last_name: 'Smith',
      username: 'asmith',
      avatar: '/alice.png',
    },
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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string | undefined) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url: string | undefined) => url || ''),
  formatMonthShort: vi.fn(() => 'Apr'),
  formatDayOfMonth: vi.fn(() => '15'),
  formatTime: vi.fn((time: string) => time),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { CommunityPulseWidget } from '../CommunityPulseWidget';
import { UpcomingEventsWidget } from '../UpcomingEventsWidget';
import { SuggestedListingsWidget } from '../SuggestedListingsWidget';
import { FriendsWidget } from '../FriendsWidget';
import { PopularGroupsWidget } from '../PopularGroupsWidget';
import { QuickActionsWidget } from '../QuickActionsWidget';
import { PeopleYouMayKnowWidget } from '../PeopleYouMayKnowWidget';
import { TopCategoriesWidget } from '../TopCategoriesWidget';
import { WidgetSkeleton } from '../WidgetSkeleton';

// ─────────────────────────────────────────────────────────────────────────────
// CommunityPulseWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('CommunityPulseWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Community Pulse heading', () => {
    render(<CommunityPulseWidget stats={{ members: 120, listings: 45, events: 8, groups: 12 }} />);
    expect(screen.getByText('Community Pulse')).toBeInTheDocument();
  });

  it('displays all four stat counts', () => {
    render(<CommunityPulseWidget stats={{ members: 120, listings: 45, events: 8, groups: 12 }} />);
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders links to members, listings, events, groups', () => {
    render(<CommunityPulseWidget stats={{ members: 10, listings: 5, events: 2, groups: 3 }} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/members');
    expect(hrefs).toContain('/test/listings');
    expect(hrefs).toContain('/test/events');
    expect(hrefs).toContain('/test/groups');
  });

  it('formats large numbers with locale separators', () => {
    render(<CommunityPulseWidget stats={{ members: 1000, listings: 500, events: 50, groups: 20 }} />);
    // 1000 should be formatted with toLocaleString, which typically renders as "1,000"
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UpcomingEventsWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('UpcomingEventsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleEvents = [
    { id: 1, title: 'Community Meetup', start_date: '2026-04-15', start_time: '10:00', location: 'Dublin' },
    { id: 2, title: 'Skill Swap', start_date: '2026-04-20', start_time: undefined, location: undefined },
  ];

  it('renders nothing when events array is empty', () => {
    render(<UpcomingEventsWidget events={[]} />);
    expect(screen.queryByText('Upcoming Events')).not.toBeInTheDocument();
  });

  it('renders the Upcoming Events heading when events exist', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(screen.getByText('Upcoming Events')).toBeInTheDocument();
  });

  it('renders event titles', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(screen.getByText('Community Meetup')).toBeInTheDocument();
    expect(screen.getByText('Skill Swap')).toBeInTheDocument();
  });

  it('shows time and location when provided', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('Dublin')).toBeInTheDocument();
  });

  it('renders See All link pointing to /events', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    const seeAll = screen.getByText('See All');
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/events');
  });

  it('renders individual event links', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/events/1');
    expect(hrefs).toContain('/test/events/2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SuggestedListingsWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('SuggestedListingsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleListings = [
    { id: 10, title: 'Gardening Help', type: 'offer' as const, owner_name: 'Bob' },
    { id: 20, title: 'Piano Lessons', type: 'request' as const, owner_name: 'Carol' },
  ];

  it('renders nothing when listings array is empty', () => {
    render(<SuggestedListingsWidget listings={[]} />);
    expect(screen.queryByText('Suggested For You')).not.toBeInTheDocument();
  });

  it('renders the Suggested For You heading when listings exist', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    expect(screen.getByText('Suggested For You')).toBeInTheDocument();
  });

  it('displays listing titles and owner names', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    expect(screen.getByText('Gardening Help')).toBeInTheDocument();
    expect(screen.getByText('Piano Lessons')).toBeInTheDocument();
  });

  it('renders offer and request type chips', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    expect(screen.getByText('Offer')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
  });

  it('links to individual listing pages', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/listings/10');
    expect(hrefs).toContain('/test/listings/20');
  });

  it('renders See All link pointing to /listings', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    const seeAll = screen.getByText('See All');
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/listings');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FriendsWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('FriendsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleFriends = [
    { id: 5, name: 'Dave Green', avatar_url: '/dave.png', is_online: true },
    { id: 6, name: 'Eve Blue', avatar_url: undefined, is_recent: true, location: 'Cork' },
  ];

  it('renders nothing when friends array is empty', () => {
    render(<FriendsWidget friends={[]} />);
    expect(screen.queryByText('Friends')).not.toBeInTheDocument();
  });

  it('renders the Friends heading when friends exist', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByText('Friends')).toBeInTheDocument();
  });

  it('displays friend names', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByText('Dave Green')).toBeInTheDocument();
    expect(screen.getByText('Eve Blue')).toBeInTheDocument();
  });

  it('shows online indicator for online friends', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByLabelText('Online now')).toBeInTheDocument();
  });

  it('shows recently active indicator for recent friends', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByLabelText('Active today')).toBeInTheDocument();
  });

  it('displays location when provided', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByText('Cork')).toBeInTheDocument();
  });

  it('links to friend profile pages', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/profile/5');
    expect(hrefs).toContain('/test/profile/6');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PopularGroupsWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('PopularGroupsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleGroups = [
    { id: 1, name: 'Gardeners', image_url: undefined, member_count: 42 },
    { id: 2, name: 'Tech Skills', image_url: '/tech.jpg', member_count: 18 },
  ];

  it('renders nothing when groups array is empty', () => {
    render(<PopularGroupsWidget groups={[]} />);
    expect(screen.queryByText('Popular Groups')).not.toBeInTheDocument();
  });

  it('renders the Popular Groups heading when groups exist', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    expect(screen.getByText('Popular Groups')).toBeInTheDocument();
  });

  it('displays group names', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    expect(screen.getByText('Gardeners')).toBeInTheDocument();
    expect(screen.getByText('Tech Skills')).toBeInTheDocument();
  });

  it('shows member counts', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    expect(screen.getByText(/42 members/i)).toBeInTheDocument();
    expect(screen.getByText(/18 members/i)).toBeInTheDocument();
  });

  it('renders group image when image_url is provided', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    const img = screen.getByRole('img', { name: 'Tech Skills' });
    expect(img).toBeInTheDocument();
  });

  it('links to individual group pages', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/groups/1');
    expect(hrefs).toContain('/test/groups/2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QuickActionsWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('QuickActionsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when user is not authenticated', async () => {
    const { useAuth } = await import('@/contexts');
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: false,
      user: null,
    } as ReturnType<typeof useAuth>);

    render(<QuickActionsWidget />);
    expect(screen.queryByText('Create New Listing')).not.toBeInTheDocument();
  });

  it('renders Create New Listing primary CTA when authenticated', () => {
    render(<QuickActionsWidget />);
    expect(screen.getByText('Create New Listing')).toBeInTheDocument();
  });

  it('primary CTA links to /listings/create', () => {
    render(<QuickActionsWidget />);
    const btn = screen.getByText('Create New Listing').closest('a');
    expect(btn).toHaveAttribute('href', '/test/listings/create');
  });

  it('renders secondary action links for enabled features', () => {
    render(<QuickActionsWidget />);
    expect(screen.getByText('Host Event')).toBeInTheDocument();
    expect(screen.getByText('Create Poll')).toBeInTheDocument();
    expect(screen.getByText('Set Goal')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('hides secondary actions for features that are disabled', async () => {
    const { useTenant } = await import('@/contexts');
    vi.mocked(useTenant).mockReturnValueOnce({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => false),
      hasModule: vi.fn(() => false),
    } as ReturnType<typeof useTenant>);

    render(<QuickActionsWidget />);
    expect(screen.queryByText('Host Event')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PeopleYouMayKnowWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('PeopleYouMayKnowWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleMembers = [
    { id: 7, name: 'Frank Red', avatar_url: '/frank.png', location: 'Galway', is_online: true },
    { id: 8, name: 'Grace White', avatar_url: undefined, is_online: false },
  ];

  it('renders nothing when members array is empty', () => {
    render(<PeopleYouMayKnowWidget members={[]} />);
    expect(screen.queryByText('People You May Know')).not.toBeInTheDocument();
  });

  it('renders People You May Know heading when members exist', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByText('People You May Know')).toBeInTheDocument();
  });

  it('displays member names', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByText('Frank Red')).toBeInTheDocument();
    expect(screen.getByText('Grace White')).toBeInTheDocument();
  });

  it('shows location when provided', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByText('Galway')).toBeInTheDocument();
  });

  it('renders online indicator for online members', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByLabelText('Online now')).toBeInTheDocument();
  });

  it('renders View buttons for each member', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    const viewButtons = screen.getAllByText('View');
    expect(viewButtons).toHaveLength(sampleMembers.length);
  });

  it('See All link points to /members', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    const seeAll = screen.getByText('See All');
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/members');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TopCategoriesWidget
// ─────────────────────────────────────────────────────────────────────────────

describe('TopCategoriesWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleCategories = [
    { id: 1, name: 'Gardening', slug: 'gardening', count: 30 },
    { id: 2, name: 'Tech', slug: 'tech', count: 15 },
    { id: 3, name: 'Music', slug: 'music', count: 8 },
  ];

  it('renders nothing when categories array is empty', () => {
    render(<TopCategoriesWidget categories={[]} />);
    expect(screen.queryByText('Top Categories')).not.toBeInTheDocument();
  });

  it('renders the Top Categories heading when categories exist', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    expect(screen.getByText('Top Categories')).toBeInTheDocument();
  });

  it('displays all category names and counts', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    expect(screen.getByText(/Gardening/)).toBeInTheDocument();
    expect(screen.getByText(/Tech/)).toBeInTheDocument();
    expect(screen.getByText(/Music/)).toBeInTheDocument();
    expect(screen.getByText(/\(30\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(15\)/)).toBeInTheDocument();
  });

  it('renders category links with correct href', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/listings?category=gardening');
    expect(hrefs).toContain('/test/listings?category=tech');
  });

  it('renders All Listings link', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    const allListings = screen.getByText('All Listings');
    expect(allListings.closest('a')).toHaveAttribute('href', '/test/listings');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WidgetSkeleton
// ─────────────────────────────────────────────────────────────────────────────

describe('WidgetSkeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<WidgetSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders default 3 skeleton rows', () => {
    const { container } = render(<WidgetSkeleton />);
    // Check for multiple skeleton placeholders in the DOM
    const skeletonItems = container.querySelectorAll('[class*="flex items-center gap-3"]');
    expect(skeletonItems.length).toBe(3);
  });

  it('renders custom number of rows via lines prop', () => {
    const { container } = render(<WidgetSkeleton lines={5} />);
    const skeletonItems = container.querySelectorAll('[class*="flex items-center gap-3"]');
    expect(skeletonItems.length).toBe(5);
  });
});
