// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTranslation } from 'react-i18next';import Lock from 'lucide-react/icons/lock';
import { EmptyState } from '@/components/feedback';
import { useAuth } from '@/contexts';
import type { Event } from '@/types/api';
import type { FeedItem } from '@/components/feed/types';

// Tab components
import { GroupFeedTab } from '../tabs/GroupFeedTab';
import { GroupDiscussionTab } from '../tabs/GroupDiscussionTab';
import type { Discussion, DiscussionDetail } from '../tabs/GroupDiscussionTab';
import { GroupMembersTab } from '../tabs/GroupMembersTab';
import type { GroupMember } from '../tabs/GroupMembersTab';
import type { ReactionType } from '@/components/social';
import { GroupEventsTab } from '../tabs/GroupEventsTab';
import { GroupFilesTab } from '../tabs/GroupFilesTab';
import { GroupAnnouncementsTab } from '../tabs/GroupAnnouncementsTab';
import { GroupChatroomsTab } from '../tabs/GroupChatroomsTab';
import { GroupTasksTab } from '../tabs/GroupTasksTab';
import { GroupSubgroupsTab } from '../tabs/GroupSubgroupsTab';
import { GroupQATab } from '../tabs/GroupQATab';
import { GroupWikiTab } from '../tabs/GroupWikiTab';
import { GroupMediaTab } from '../tabs/GroupMediaTab';
import { GroupAnalyticsTab } from '../tabs/GroupAnalyticsTab';
import { GroupChallengesTab } from '../tabs/GroupChallengesTab';
import { GroupAutomationTab } from '../tabs/GroupAutomationTab';

interface GroupTabContentProps {
  activeTab: string;
  groupId: number;
  userIsMember: boolean;
  userIsAdmin: boolean;
  isJoining: boolean;
  currentUserId?: number;
  groupOwnerId?: number;
  groupAdminIds?: number[];
  hasSubGroups: boolean;
  subGroups?: Array<{ id: number; name: string; member_count: number }>;

  // Feed
  feedItems: FeedItem[];
  feedLoading: boolean;
  feedError?: boolean;
  feedHasMore: boolean;
  feedLoadingMore: boolean;
  onComposeOpen: () => void;
  onLoadMoreFeed: () => void;
  onRefreshFeed?: () => void | Promise<void>;
  onToggleLike: (item: FeedItem) => void;
  onReact: (item: FeedItem, reactionType: ReactionType) => void;
  onHidePost: (item: FeedItem) => void;
  onMuteUser: (userId: number) => void;
  onReportPost: (postId: number) => void;
  onDeletePost: (item: FeedItem) => void;
  onVotePoll: (pollId: number, optionId: number) => void;

  // Discussions
  discussions: Discussion[];
  discussionsLoading: boolean;
  discussionsError?: boolean;
  discussionsHasMore: boolean;
  expandedDiscussionId: number | null;
  expandedDiscussion: DiscussionDetail | null;
  expandedLoading: boolean;
  loadingEarlierReplies: boolean;
  replyContent: string;
  sendingReply: boolean;
  onShowNewDiscussion: () => void;
  onExpandDiscussion: (id: number) => void;
  onLoadMoreDiscussions: () => void;
  onLoadEarlierReplies: () => void;
  onRetryDiscussions?: () => void;
  onReplyContentChange: (value: string) => void;
  onSendReply: () => void;

  // Members
  members: GroupMember[];
  membersLoading: boolean;
  membersLoadingMore: boolean;
  membersHasMore: boolean;
  membersError?: boolean;
  updatingMember: number | null;
  onUpdateMemberRole: (userId: number, role: 'member' | 'admin') => void;
  onRemoveMember: (userId: number) => void;
  onSearchMembers: (query: string) => void;
  onLoadMoreMembers: () => void;
  onRetryMembers?: () => void;

  // Events
  events: Event[];
  eventsLoading: boolean;
  eventsLoadingMore: boolean;
  eventsHasMore: boolean;
  eventsError?: boolean;
  onLoadMoreEvents: () => void;
  onRetryEvents?: () => void;

  // Join/leave
  onJoinLeave: () => void;
}

export function GroupTabContent({
  activeTab,
  groupId,
  userIsMember,
  userIsAdmin,
  isJoining,
  currentUserId,
  groupOwnerId,
  groupAdminIds,
  hasSubGroups,
  subGroups,
  feedItems,
  feedLoading,
  feedError = false,
  feedHasMore,
  feedLoadingMore,
  onComposeOpen,
  onLoadMoreFeed,
  onRefreshFeed,
  onToggleLike,
  onReact,
  onHidePost,
  onMuteUser,
  onReportPost,
  onDeletePost,
  onVotePoll,
  discussions,
  discussionsLoading,
  discussionsError = false,
  discussionsHasMore,
  expandedDiscussionId,
  expandedDiscussion,
  expandedLoading,
  loadingEarlierReplies,
  replyContent,
  sendingReply,
  onShowNewDiscussion,
  onExpandDiscussion,
  onLoadMoreDiscussions,
  onLoadEarlierReplies,
  onRetryDiscussions,
  onReplyContentChange,
  onSendReply,
  members,
  membersLoading,
  membersLoadingMore,
  membersHasMore,
  membersError = false,
  updatingMember,
  onUpdateMemberRole,
  onRemoveMember,
  onSearchMembers,
  onLoadMoreMembers,
  onRetryMembers,
  events,
  eventsLoading,
  eventsLoadingMore,
  eventsHasMore,
  eventsError = false,
  onLoadMoreEvents,
  onRetryEvents,
  onJoinLeave,
}: GroupTabContentProps) {
  const { t } = useTranslation('groups');
  const { isAuthenticated } = useAuth();

  const loadError = (message: string, onRetry?: () => void | Promise<void>) => (
    <GlassCard className="p-6">
      <div role="alert" className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-danger">{message}</p>
        {onRetry && (
          <Button variant="flat" onPress={() => void onRetry()}>
            {t('try_again')}
          </Button>
        )}
      </div>
    </GlassCard>
  );

  const MembersOnlyFallback = (
    <GlassCard className="p-6">
      <EmptyState
        icon={<Lock className="w-12 h-12" aria-hidden="true" />}
        title={t('detail.join_to_access_title')}
        description={t('detail.join_to_access_desc')}
        action={
          isAuthenticated ? (
            <Button
              className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              onPress={onJoinLeave}
              isLoading={isJoining}
            >
              {t('detail.join_group')}
            </Button>
          ) : undefined
        }
      />
    </GlassCard>
  );

  return (
    <div>
      {activeTab === 'feed' && (feedError ? loadError(t('toast.feed_load_failed'), onRefreshFeed) : (
        <GroupFeedTab
          isMember={userIsMember}
          isJoining={isJoining}
          feedItems={feedItems}
          feedLoading={feedLoading}
          feedHasMore={feedHasMore}
          feedLoadingMore={feedLoadingMore}
          onJoinLeave={onJoinLeave}
          onComposeOpen={onComposeOpen}
          onLoadMore={onLoadMoreFeed}
          onRefresh={onRefreshFeed}
          onToggleLike={onToggleLike}
          onReact={onReact}
          onHidePost={onHidePost}
          onMuteUser={onMuteUser}
          onReportPost={onReportPost}
          onDeletePost={onDeletePost}
          onVotePoll={onVotePoll}
        />
      ))}

      {activeTab === 'discussion' && (discussionsError ? loadError(t('toast.discussions_load_failed'), onRetryDiscussions) : (
        <GroupDiscussionTab
          isMember={userIsMember}
          isJoining={isJoining}
          discussions={discussions}
          discussionsLoading={discussionsLoading}
          discussionsHasMore={discussionsHasMore}
          expandedDiscussionId={expandedDiscussionId}
          expandedDiscussion={expandedDiscussion}
          expandedLoading={expandedLoading}
          loadingEarlierReplies={loadingEarlierReplies}
          replyContent={replyContent}
          sendingReply={sendingReply}
          onJoinLeave={onJoinLeave}
          onShowNewDiscussion={onShowNewDiscussion}
          onExpandDiscussion={onExpandDiscussion}
          onLoadMoreDiscussions={onLoadMoreDiscussions}
          onLoadEarlierReplies={onLoadEarlierReplies}
          onReplyContentChange={onReplyContentChange}
          onSendReply={onSendReply}
        />
      ))}

      {activeTab === 'members' && (membersError ? loadError(t('toast.something_wrong'), onRetryMembers) : (
        <GroupMembersTab
          members={members}
          membersLoading={membersLoading}
          membersLoadingMore={membersLoadingMore}
          membersHasMore={membersHasMore}
          userIsAdmin={userIsAdmin}
          currentUserId={currentUserId}
          groupOwnerId={groupOwnerId}
          groupAdminIds={groupAdminIds}
          updatingMember={updatingMember}
          onUpdateMemberRole={onUpdateMemberRole}
          onRemoveMember={onRemoveMember}
          onSearchMembers={onSearchMembers}
          onLoadMoreMembers={onLoadMoreMembers}
        />
      ))}

      {activeTab === 'events' && (eventsError ? loadError(t('toast.something_wrong'), onRetryEvents) : (
        <GroupEventsTab
          groupId={groupId}
          events={events}
          eventsLoading={eventsLoading}
          eventsLoadingMore={eventsLoadingMore}
          eventsHasMore={eventsHasMore}
          isMember={userIsMember}
          onLoadMoreEvents={onLoadMoreEvents}
        />
      ))}

      {activeTab === 'files' && (userIsMember ? (
        <GroupFilesTab
          groupId={groupId}
          isAdmin={userIsAdmin}
          isMember={userIsMember}
          currentUserId={currentUserId}
        />
      ) : MembersOnlyFallback)}

      {activeTab === 'announcements' && (userIsMember ? (
        <GroupAnnouncementsTab
          groupId={groupId}
          isAdmin={userIsAdmin}
          isMember={userIsMember}
        />
      ) : MembersOnlyFallback)}

      {activeTab === 'chatrooms' && (userIsMember ? (
        <GroupChatroomsTab
          groupId={groupId}
          isGroupAdmin={userIsAdmin}
        />
      ) : MembersOnlyFallback)}

      {activeTab === 'tasks' && (userIsMember ? (
        <GroupTasksTab
          groupId={groupId}
          isGroupAdmin={userIsAdmin}
          members={members}
        />
      ) : MembersOnlyFallback)}

      {activeTab === 'qa' && (
        <GroupQATab groupId={groupId} isAdmin={userIsAdmin} isMember={userIsMember} />
      )}

      {activeTab === 'wiki' && (
        <GroupWikiTab groupId={groupId} isAdmin={userIsAdmin} isMember={userIsMember} />
      )}

      {activeTab === 'media' && (
        <GroupMediaTab groupId={groupId} isAdmin={userIsAdmin} isMember={userIsMember} />
      )}

      {activeTab === 'challenges' && (
        <GroupChallengesTab groupId={groupId} isAdmin={userIsAdmin} isMember={userIsMember} />
      )}

      {activeTab === 'analytics' && userIsAdmin && (
        <GroupAnalyticsTab groupId={groupId} isAdmin={userIsAdmin} />
      )}

      {activeTab === 'automation' && userIsAdmin && (
        <GroupAutomationTab groupId={groupId} isAdmin={userIsAdmin} />
      )}

      {activeTab === 'subgroups' && hasSubGroups && subGroups && (
        <GroupSubgroupsTab subGroups={subGroups} />
      )}
    </div>
  );
}
