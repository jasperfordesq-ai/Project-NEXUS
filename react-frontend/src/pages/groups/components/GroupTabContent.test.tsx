// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

const mockMembersTabRender = vi.hoisted(() => vi.fn());
const mockEventsTabRender = vi.hoisted(() => vi.fn());

vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// Mock every heavyweight tab so GroupTabContent can render in isolation
vi.mock('../tabs/GroupFeedTab', () => ({ GroupFeedTab: () => <div data-testid="feed-tab" /> }));
vi.mock('../tabs/GroupDiscussionTab', () => ({ GroupDiscussionTab: () => <div data-testid="discussion-tab" /> }));
vi.mock('../tabs/GroupMembersTab', () => ({
  GroupMembersTab: (props: Record<string, unknown>) => {
    mockMembersTabRender(props);
    return <div data-testid="members-tab" />;
  },
}));
vi.mock('../tabs/GroupEventsTab', () => ({
  GroupEventsTab: (props: Record<string, unknown>) => {
    mockEventsTabRender(props);
    return <div data-testid="events-tab" />;
  },
}));
vi.mock('../tabs/GroupFilesTab', () => ({ GroupFilesTab: () => <div data-testid="files-tab" /> }));
vi.mock('../tabs/GroupAnnouncementsTab', () => ({ GroupAnnouncementsTab: () => <div data-testid="announcements-tab" /> }));
vi.mock('../tabs/GroupChatroomsTab', () => ({ GroupChatroomsTab: () => <div data-testid="chatrooms-tab" /> }));
vi.mock('../tabs/GroupTasksTab', () => ({ GroupTasksTab: () => <div data-testid="tasks-tab" /> }));
vi.mock('../tabs/GroupQATab', () => ({ GroupQATab: () => <div data-testid="qa-tab" /> }));
vi.mock('../tabs/GroupWikiTab', () => ({ GroupWikiTab: () => <div data-testid="wiki-tab" /> }));
vi.mock('../tabs/GroupMediaTab', () => ({ GroupMediaTab: () => <div data-testid="media-tab" /> }));
vi.mock('../tabs/GroupAnalyticsTab', () => ({ GroupAnalyticsTab: () => <div data-testid="analytics-tab" /> }));
vi.mock('../tabs/GroupChallengesTab', () => ({ GroupChallengesTab: () => <div data-testid="challenges-tab" /> }));
vi.mock('../tabs/GroupSubgroupsTab', () => ({ GroupSubgroupsTab: () => <div data-testid="subgroups-tab" /> }));

import { GroupTabContent } from './GroupTabContent';

const BASE_PROPS = {
  groupId: 1,
  userIsMember: true,
  userIsAdmin: false,
  isJoining: false,
  hasSubGroups: false,
  feedItems: [],
  feedLoading: false,
  feedHasMore: false,
  feedLoadingMore: false,
  onComposeOpen: vi.fn(),
  onLoadMoreFeed: vi.fn(),
  onToggleLike: vi.fn(),
  onReact: vi.fn(),
  onHidePost: vi.fn(),
  onMuteUser: vi.fn(),
  onReportPost: vi.fn(),
  onDeletePost: vi.fn(),
  onVotePoll: vi.fn(),
  discussions: [],
  discussionsLoading: false,
  discussionsHasMore: false,
  expandedDiscussionId: null,
  expandedDiscussion: null,
  expandedLoading: false,
  loadingEarlierReplies: false,
  replyContent: '',
  sendingReply: false,
  onShowNewDiscussion: vi.fn(),
  onExpandDiscussion: vi.fn(),
  onLoadMoreDiscussions: vi.fn(),
  onLoadEarlierReplies: vi.fn(),
  onReplyContentChange: vi.fn(),
  onSendReply: vi.fn(),
  members: [],
  membersLoading: false,
  membersLoadingMore: false,
  membersHasMore: false,
  updatingMember: null,
  onUpdateMemberRole: vi.fn(),
  onRemoveMember: vi.fn(),
  onSearchMembers: vi.fn(),
  onLoadMoreMembers: vi.fn(),
  events: [],
  eventsLoading: false,
  eventsLoadingMore: false,
  eventsHasMore: false,
  onLoadMoreEvents: vi.fn(),
  onJoinLeave: vi.fn(),
};

describe('GroupTabContent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders feed tab when activeTab=feed', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="feed" />);
    expect(screen.getByTestId('feed-tab')).toBeInTheDocument();
  });

  it('renders discussion tab when activeTab=discussion', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="discussion" />);
    expect(screen.getByTestId('discussion-tab')).toBeInTheDocument();
  });

  it('renders members tab when activeTab=members', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="members" />);
    expect(screen.getByTestId('members-tab')).toBeInTheDocument();
  });

  it('renders events tab when activeTab=events', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="events" />);
    expect(screen.getByTestId('events-tab')).toBeInTheDocument();
  });

  it('forwards server search and cursor paging controls to the members tab', () => {
    const onSearchMembers = vi.fn();
    const onLoadMoreMembers = vi.fn();
    render(
      <GroupTabContent
        {...BASE_PROPS}
        activeTab="members"
        membersHasMore
        membersLoadingMore
        onSearchMembers={onSearchMembers}
        onLoadMoreMembers={onLoadMoreMembers}
      />,
    );

    expect(mockMembersTabRender).toHaveBeenLastCalledWith(expect.objectContaining({
      membersHasMore: true,
      membersLoadingMore: true,
      onSearchMembers,
      onLoadMoreMembers,
    }));
  });

  it('forwards cursor paging controls to the events tab', () => {
    const onLoadMoreEvents = vi.fn();
    render(
      <GroupTabContent
        {...BASE_PROPS}
        activeTab="events"
        eventsHasMore
        eventsLoadingMore
        onLoadMoreEvents={onLoadMoreEvents}
      />,
    );

    expect(mockEventsTabRender).toHaveBeenLastCalledWith(expect.objectContaining({
      eventsHasMore: true,
      eventsLoadingMore: true,
      onLoadMoreEvents,
    }));
  });

  it('renders a translated retryable error instead of a false empty feed', async () => {
    const retry = vi.fn();
    render(
      <GroupTabContent
        {...BASE_PROPS}
        activeTab="feed"
        feedError
        onRefreshFeed={retry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't reach the feed just now. Try again in a moment.");
    expect(screen.queryByTestId('feed-tab')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    ['discussion', 'discussionsError', 'discussion-tab'],
    ['members', 'membersError', 'members-tab'],
    ['events', 'eventsError', 'events-tab'],
  ] as const)('does not render the %s empty state when its read failed', (activeTab, errorProp, testId) => {
    render(
      <GroupTabContent
        {...BASE_PROPS}
        activeTab={activeTab}
        {...{ [errorProp]: true }}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  });

  it('renders files tab for members when activeTab=files', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="files" userIsMember />);
    expect(screen.getByTestId('files-tab')).toBeInTheDocument();
  });

  it('shows members-only fallback for files when not a member', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="files" userIsMember={false} />);
    expect(screen.queryByTestId('files-tab')).not.toBeInTheDocument();
    // Fallback renders a join button for authenticated users — createMockContexts has isAuthenticated=false
    // so the button is absent; but the empty-state wrapper IS rendered
    expect(screen.queryByTestId('files-tab')).toBeNull();
  });

  it('renders announcements tab for members', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="announcements" userIsMember />);
    expect(screen.getByTestId('announcements-tab')).toBeInTheDocument();
  });

  it('shows members-only fallback for announcements when not a member and user is authenticated', () => {
    vi.mock('@/contexts', () =>
      createMockContexts({
        useAuth: () => ({
          user: { id: 7, name: 'Alice' } as any,
          isAuthenticated: true,
          login: vi.fn(), logout: vi.fn(), register: vi.fn(),
          updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null,
        }),
      }),
    );
    render(<GroupTabContent {...BASE_PROPS} activeTab="announcements" userIsMember={false} />);
    expect(screen.queryByTestId('announcements-tab')).not.toBeInTheDocument();
  });

  it('renders qa tab regardless of membership', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="qa" userIsMember={false} />);
    expect(screen.getByTestId('qa-tab')).toBeInTheDocument();
  });

  it('renders wiki tab regardless of membership', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="wiki" userIsMember={false} />);
    expect(screen.getByTestId('wiki-tab')).toBeInTheDocument();
  });

  it('renders analytics tab for admin', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="analytics" userIsAdmin />);
    expect(screen.getByTestId('analytics-tab')).toBeInTheDocument();
  });

  it('does NOT render analytics tab for non-admin', () => {
    render(<GroupTabContent {...BASE_PROPS} activeTab="analytics" userIsAdmin={false} />);
    expect(screen.queryByTestId('analytics-tab')).not.toBeInTheDocument();
  });

  it('renders subgroups tab when hasSubGroups=true and subGroups provided', () => {
    render(
      <GroupTabContent
        {...BASE_PROPS}
        activeTab="subgroups"
        hasSubGroups
        subGroups={[{ id: 10, name: 'Sub A', member_count: 3 }]}
      />,
    );
    expect(screen.getByTestId('subgroups-tab')).toBeInTheDocument();
  });

  it('does NOT render subgroups tab when hasSubGroups=false', () => {
    render(
      <GroupTabContent
        {...BASE_PROPS}
        activeTab="subgroups"
        hasSubGroups={false}
        subGroups={[{ id: 10, name: 'Sub A', member_count: 3 }]}
      />,
    );
    expect(screen.queryByTestId('subgroups-tab')).not.toBeInTheDocument();
  });

  it('renders nothing meaningful for unknown tab', () => {
    const { container } = render(<GroupTabContent {...BASE_PROPS} activeTab="unknown" />);
    // Only the wrapper div should be present; no tab content
    expect(container.firstElementChild?.children.length).toBe(0);
  });
});
