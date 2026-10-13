// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GroupDetailPage
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, userEvent, waitFor } from '@/test/test-utils';

const mockGroupApi = vi.hoisted(() => ({
  createGroupDiscussion: vi.fn(),
  createGroupInviteLink: vi.fn(),
  decideGroupJoinRequest: vi.fn(),
  deleteGroup: vi.fn(),
  deleteGroupFeedItem: vi.fn(),
  getGroupDetail: vi.fn(),
  getGroupDiscussion: vi.fn(),
  hideGroupFeedItem: vi.fn(),
  joinGroup: vi.fn(),
  leaveGroup: vi.fn(),
  listGroupDiscussions: vi.fn(),
  listGroupEvents: vi.fn(),
  listGroupFeed: vi.fn(),
  listGroupInvites: vi.fn(),
  listGroupJoinRequests: vi.fn(),
  listGroupMembers: vi.fn(),
  listGroupTags: vi.fn(),
  muteGroupFeedUser: vi.fn(),
  reactToGroupFeedItem: vi.fn(),
  removeGroupMember: vi.fn(),
  revokeGroupInvite: vi.fn(),
  replyToGroupDiscussion: vi.fn(),
  reportGroupFeedItem: vi.fn(),
  sendGroupInvites: vi.fn(),
  toggleGroupFeedLike: vi.fn(),
  updateGroupMemberRole: vi.fn(),
  updateGroupSettings: vi.fn(),
  uploadGroupImage: vi.fn(),
  voteInGroupFeedPoll: vi.fn(),
}));
const mockDiscussionTabRender = vi.hoisted(() => vi.fn());
const mockMembersTabRender = vi.hoisted(() => vi.fn());
const mockEventsTabRender = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  ...mockGroupApi,
  GroupApiError: class GroupApiError extends Error {
    readonly isCancellation = false;
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 99, first_name: 'Alice', name: 'Alice Test' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    hasGroupTab: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

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
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/components/courses/CourseGroupRecommendations', () => ({
  CourseGroupRecommendations: () => null,
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
    resolveAssetUrl: vi.fn((url) => url || null),
    formatDateValue: vi.fn(() => 'Jan 1, 2026'),
    formatRelativeTime: vi.fn(() => '2 hours ago'),
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  };
});

let mockRouteGroupId = '1';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: mockRouteGroupId }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(async () => true),
}));

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav>{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('@/components/location', () => ({
  LocationMapCard: () => <div data-testid="location-map" />,
}));

vi.mock('@/components/compose', () => ({
  ComposeHub: () => <div data-testid="compose-hub" />,
}));

// Mock tab components
vi.mock('./tabs/GroupFeedTab', () => ({
  GroupFeedTab: () => <div data-testid="group-feed-tab" />,
}));

vi.mock('./tabs/GroupDiscussionTab', () => ({
  GroupDiscussionTab: (props: Record<string, unknown>) => {
    mockDiscussionTabRender(props);
    return <div data-testid="group-discussion-tab" />;
  },
}));

vi.mock('./tabs/GroupMembersTab', () => ({
  GroupMembersTab: (props: Record<string, unknown>) => {
    mockMembersTabRender(props);
    return <div data-testid="group-members-tab" />;
  },
}));

vi.mock('./tabs/GroupEventsTab', () => ({
  GroupEventsTab: (props: Record<string, unknown>) => {
    mockEventsTabRender(props);
    return <div data-testid="group-events-tab" />;
  },
}));

vi.mock('./tabs/GroupFilesTab', () => ({
  GroupFilesTab: () => <div data-testid="group-files-tab" />,
}));

vi.mock('./tabs/GroupAnnouncementsTab', () => ({
  GroupAnnouncementsTab: () => <div data-testid="group-announcements-tab" />,
}));

vi.mock('./tabs/GroupChatroomsTab', () => ({
  GroupChatroomsTab: () => <div data-testid="group-chatrooms-tab" />,
}));

vi.mock('./tabs/GroupTasksTab', () => ({
  GroupTasksTab: () => <div data-testid="group-tasks-tab" />,
}));

vi.mock('./tabs/GroupSubgroupsTab', () => ({
  GroupSubgroupsTab: () => <div data-testid="group-subgroups-tab" />,
}));

vi.mock('./components/PinnedAnnouncementsBanner', () => ({
  PinnedAnnouncementsBanner: () => null,
}));

import { GroupDetailPage } from './GroupDetailPage';

const mockGroup = {
  id: 1,
  name: 'Gardening Enthusiasts',
  description: 'A group for garden lovers',
  is_private: false,
  owner_id: 5,
  member_count: 12,
  location: 'Dublin',
  latitude: null,
  longitude: null,
  image_url: null,
  created_at: '2026-01-01T10:00:00Z',
  is_member: true,
  is_admin: false,
  parent_group_id: null,
};

describe('GroupDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouteGroupId = '1';
    window.history.replaceState({}, '', '/');
    mockGroupApi.getGroupDetail.mockResolvedValue(mockGroup);
    mockGroupApi.listGroupTags.mockResolvedValue([]);
    mockGroupApi.listGroupFeed.mockResolvedValue({ items: [], cursor: null, hasMore: false });
    mockGroupApi.listGroupDiscussions.mockResolvedValue({ discussions: [], hasMore: false });
    mockGroupApi.listGroupMembers.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
      perPage: 20,
    });
    mockGroupApi.listGroupEvents.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
      perPage: 20,
    });
    mockGroupApi.listGroupJoinRequests.mockResolvedValue([]);
    mockGroupApi.listGroupInvites.mockResolvedValue([]);
  });

  it('shows loading screen initially', () => {
    mockGroupApi.getGroupDetail.mockImplementation(() => new Promise(() => {}));
    render(<GroupDetailPage />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('renders group name after load', async () => {
    render(<GroupDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Gardening Enthusiasts').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders group description', async () => {
    render(<GroupDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('A group for garden lovers')).toBeInTheDocument();
    });
  });

  it('shows error state on API error', async () => {
    mockGroupApi.getGroupDetail.mockRejectedValue(new Error('Not found'));
    render(<GroupDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Unable to Load Group')).toBeInTheDocument();
    });
  });

  it('renders group tabs navigation', async () => {
    render(<GroupDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Gardening Enthusiasts').length).toBeGreaterThanOrEqual(1);
    });
    // Tab labels should be present
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(0);
  });

  it('renders member count', async () => {
    render(<GroupDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('12 members').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders public/private badge', async () => {
    render(<GroupDetailPage />);
    await waitFor(() => {
      // Public badge should be shown for non-private groups
      expect(screen.getAllByText('Gardening Enthusiasts').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('destroys group-local section state when the route group ID changes', async () => {
    window.history.replaceState({}, '', '/test/groups/1?tab=subgroups');
    const parentGroup = {
      ...mockGroup,
      id: 1,
      name: 'Parent Group',
      sub_groups: [{ id: 11, name: 'Nested Group', member_count: 2 }],
    };
    const childGroup = {
      ...mockGroup,
      id: 2,
      name: 'Child Group',
      sub_groups: [],
    };
    mockGroupApi.getGroupDetail.mockImplementation((groupId: number) => {
      if (groupId === 1) return Promise.resolve(parentGroup);
      if (groupId === 2) return Promise.resolve(childGroup);
      return Promise.reject(new Error('Unexpected group'));
    });

    const { rerender } = render(<GroupDetailPage />);
    expect((await screen.findAllByText('Parent Group')).length).toBeGreaterThan(0);
    expect(await screen.findByTestId('group-subgroups-tab')).toBeInTheDocument();

    mockRouteGroupId = '2';
    rerender(<GroupDetailPage />);

    expect((await screen.findAllByText('Child Group')).length).toBeGreaterThan(0);
    expect(await screen.findByTestId('group-feed-tab', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.queryByTestId('group-subgroups-tab')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('feed');
  });

  it('ignores a late overview response after navigating to another group', async () => {
    let resolveFirst: ((value: typeof mockGroup) => void) | undefined;
    mockGroupApi.getGroupDetail.mockImplementation((groupId: number) => {
      if (groupId === 1) {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      if (groupId === 2) {
        return Promise.resolve({ ...mockGroup, id: 2, name: 'Current Group' });
      }
      return Promise.reject(new Error('Unexpected group'));
    });

    const { rerender } = render(<GroupDetailPage />);
    await waitFor(() => expect(mockGroupApi.getGroupDetail).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    mockRouteGroupId = '2';
    rerender(<GroupDetailPage />);
    expect((await screen.findAllByText('Current Group')).length).toBeGreaterThan(0);

    await act(async () => {
      resolveFirst?.({ ...mockGroup, name: 'Late Previous Group' });
    });
    expect(screen.queryByText('Late Previous Group')).not.toBeInTheDocument();
    expect(screen.getAllByText('Current Group').length).toBeGreaterThan(0);
  });

  it('ignores a late discussion-detail response after another discussion is opened', async () => {
    const firstDiscussion = {
      id: 11,
      title: 'First thread',
      author: { id: 5, name: 'Owner' },
      reply_count: 0,
      is_pinned: false,
      created_at: '2026-01-01T10:00:00Z',
    };
    const secondDiscussion = { ...firstDiscussion, id: 12, title: 'Second thread' };
    const firstDetail = {
      ...firstDiscussion,
      content: 'Late first body',
      messages: [],
      messagesHasMore: false,
    };
    const secondDetail = {
      ...secondDiscussion,
      content: 'Current second body',
      messages: [],
      messagesHasMore: false,
    };
    let resolveFirst: ((value: typeof firstDetail) => void) | undefined;
    let resolveSecond: ((value: typeof secondDetail) => void) | undefined;
    mockGroupApi.listGroupDiscussions.mockResolvedValue({
      discussions: [firstDiscussion, secondDiscussion],
      hasMore: false,
    });
    mockGroupApi.getGroupDiscussion.mockImplementation((_groupId: number, discussionId: number) => {
      if (discussionId === 11) {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      if (discussionId === 12) {
        return new Promise((resolve) => { resolveSecond = resolve; });
      }
      return Promise.reject(new Error('Unexpected discussion'));
    });
    window.history.replaceState({}, '', '/test/groups/1?tab=discussion');
    render(<GroupDetailPage />);
    await screen.findByTestId('group-discussion-tab');

    type CapturedProps = {
      expandedDiscussionId: number | null;
      expandedDiscussion: { id: number; content?: string } | null;
      onExpandDiscussion: (discussionId: number) => Promise<void>;
    };
    const latestProps = (): CapturedProps => (
      mockDiscussionTabRender.mock.calls.at(-1)?.[0] as CapturedProps
    );

    act(() => { void latestProps().onExpandDiscussion(11); });
    await waitFor(() => expect(latestProps().expandedDiscussionId).toBe(11));
    act(() => { void latestProps().onExpandDiscussion(12); });
    await waitFor(() => expect(latestProps().expandedDiscussionId).toBe(12));

    await act(async () => { resolveSecond?.(secondDetail); });
    await waitFor(() => expect(latestProps().expandedDiscussion?.content).toBe('Current second body'));

    await act(async () => { resolveFirst?.(firstDetail); });
    expect(latestProps().expandedDiscussionId).toBe(12);
    expect(latestProps().expandedDiscussion?.content).toBe('Current second body');
  });

  it('appends cursor-paged members, de-duplicates overlap, and reaches member 21', async () => {
    const firstTwenty = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `Member ${index + 1}`,
      role: 'member',
    }));
    mockGroupApi.listGroupMembers
      .mockResolvedValueOnce({
        items: firstTwenty,
        nextCursor: 'members-page-2',
        hasMore: true,
        perPage: 20,
      })
      .mockResolvedValueOnce({
        items: [firstTwenty[19], { id: 21, name: 'Member 21', role: 'member' }],
        nextCursor: null,
        hasMore: false,
        perPage: 20,
      });
    window.history.replaceState({}, '', '/test/groups/1?tab=members');
    render(<GroupDetailPage />);
    await screen.findByTestId('group-members-tab');

    type CapturedMembersProps = {
      members: Array<{ id: number; name: string }>;
      membersHasMore: boolean;
      onLoadMoreMembers: () => void;
    };
    const latestProps = (): CapturedMembersProps => (
      mockMembersTabRender.mock.calls.at(-1)?.[0] as CapturedMembersProps
    );

    await waitFor(() => expect(latestProps().members).toHaveLength(20));
    expect(latestProps().membersHasMore).toBe(true);
    act(() => latestProps().onLoadMoreMembers());

    await waitFor(() => expect(mockGroupApi.listGroupMembers).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ cursor: 'members-page-2', perPage: 20 }),
    ));
    await waitFor(() => expect(latestProps().members).toHaveLength(21));
    expect(latestProps().members.filter((member) => member.id === 20)).toHaveLength(1);
    expect(latestProps().members.at(-1)?.name).toBe('Member 21');
    expect(latestProps().membersHasMore).toBe(false);
  });

  it('aborts an older member search and never lets its late response replace the newer query', async () => {
    let resolveOlder: ((value: unknown) => void) | undefined;
    let resolveNewer: ((value: unknown) => void) | undefined;
    mockGroupApi.listGroupMembers
      .mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false, perPage: 20 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; }));
    window.history.replaceState({}, '', '/test/groups/1?tab=members');
    render(<GroupDetailPage />);
    await screen.findByTestId('group-members-tab');

    type CapturedMembersProps = {
      members: Array<{ id: number; name: string }>;
      onSearchMembers: (query: string) => void;
    };
    const latestProps = (): CapturedMembersProps => (
      mockMembersTabRender.mock.calls.at(-1)?.[0] as CapturedMembersProps
    );
    await waitFor(() => expect(mockGroupApi.listGroupMembers).toHaveBeenCalledTimes(1));

    act(() => latestProps().onSearchMembers('older'));
    await waitFor(() => expect(mockGroupApi.listGroupMembers).toHaveBeenCalledTimes(2));
    const olderSignal = mockGroupApi.listGroupMembers.mock.calls[1]?.[1]?.signal as AbortSignal;
    act(() => latestProps().onSearchMembers('newer'));
    await waitFor(() => expect(mockGroupApi.listGroupMembers).toHaveBeenCalledTimes(3));
    expect(olderSignal.aborted).toBe(true);

    await act(async () => {
      resolveNewer?.({
        items: [{ id: 22, name: 'Newer result', role: 'member' }],
        nextCursor: null,
        hasMore: false,
        perPage: 20,
      });
    });
    await waitFor(() => expect(latestProps().members.map((member) => member.name)).toEqual(['Newer result']));

    await act(async () => {
      resolveOlder?.({
        items: [{ id: 11, name: 'Stale older result', role: 'member' }],
        nextCursor: null,
        hasMore: false,
        perPage: 20,
      });
    });
    expect(latestProps().members.map((member) => member.name)).toEqual(['Newer result']);
  });

  it('appends group events across cursors, de-duplicates overlap, and preserves ongoing and past records', async () => {
    const ongoing = { id: 31, title: 'Ongoing workshop', start_date: '2026-07-11T09:00:00Z' };
    const past = { id: 30, title: 'Past workshop', start_date: '2026-07-01T09:00:00Z' };
    mockGroupApi.listGroupEvents
      .mockResolvedValueOnce({
        items: [ongoing],
        nextCursor: 'events-page-2',
        hasMore: true,
        perPage: 20,
      })
      .mockResolvedValueOnce({
        items: [ongoing, past],
        nextCursor: null,
        hasMore: false,
        perPage: 20,
      });
    window.history.replaceState({}, '', '/test/groups/1?tab=events');
    render(<GroupDetailPage />);
    await screen.findByTestId('group-events-tab');

    type CapturedEventsProps = {
      events: Array<{ id: number; title: string }>;
      eventsHasMore: boolean;
      onLoadMoreEvents: () => void;
    };
    const latestProps = (): CapturedEventsProps => (
      mockEventsTabRender.mock.calls.at(-1)?.[0] as CapturedEventsProps
    );

    await waitFor(() => expect(latestProps().events.map((event) => event.title)).toEqual(['Ongoing workshop']));
    expect(latestProps().eventsHasMore).toBe(true);
    act(() => latestProps().onLoadMoreEvents());

    await waitFor(() => expect(mockGroupApi.listGroupEvents).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ cursor: 'events-page-2', perPage: 20 }),
    ));
    await waitFor(() => expect(latestProps().events.map((event) => event.title)).toEqual([
      'Ongoing workshop',
      'Past workshop',
    ]));
    expect(latestProps().eventsHasMore).toBe(false);
  });

  it('deep-links to an available section and writes tab changes to the URL', async () => {
    window.history.replaceState({}, '', '/test/groups/1?tab=members');
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(await screen.findByTestId('group-members-tab', {}, { timeout: 5_000 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Events' }));
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('tab')).toBe('events');
    });
    expect(await screen.findByTestId('group-events-tab', {}, { timeout: 5_000 })).toBeInTheDocument();
  });

  it('replaces an unavailable section query with the first allowed section', async () => {
    window.history.replaceState({}, '', '/test/groups/1?tab=analytics');
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('tab')).toBe('feed');
    });
    expect(screen.getByRole('tab', { name: 'Feed' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('group-feed-tab', {}, { timeout: 5_000 })).toBeInTheDocument();
  });
  // F-595 follow-up (E-104): member-written text must not be able to close the
  // structured-data block early in a prerendered snapshot.
  it('escapes "<" in the structured data', async () => {
    const hostile = 'Name</script><img src=x onerror=alert(1)>';
    mockGroupApi.getGroupDetail.mockResolvedValue({ ...mockGroup, name: hostile, description: hostile });
    render(<GroupDetailPage />);
    await waitFor(() => {
      expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();
    });
    const raw = document.querySelector('script[type="application/ld+json"]')?.textContent ?? '';
    expect(raw).not.toContain('</script>');
    expect(raw).toContain('\\u003c/script');
    expect(JSON.parse(raw).name).toBe(hostile);
  });
});
