// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { useConfirm } from '@/components/ui/ConfirmDialog';
/**
 * Group Detail Page - Single group view
 * Full discussions UI, admin features, events tab, member management
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';import AlertCircle from 'lucide-react/icons/circle-alert';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { PageMeta } from '@/components/seo/PageMeta';
import { Breadcrumbs } from '@/components/navigation';
import { ComposeHub } from '@/components/compose';
import { LoadingScreen } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { logError } from '@/lib/logger';
import { applyFeedSyncToItem, dispatchFeedSync, FEED_SYNC_EVENT, type FeedSyncPayload } from '@/lib/feedSync';
import type { FeedItem } from '@/components/feed/types';
import type { ReactionType } from '@/components/social/reactions';
import type { Event } from '@/types/api';

// Sub-components
import { GroupHeader } from './components/GroupHeader';
import { GroupTabNav } from './components/GroupTabNav';
import { GroupTabContent } from './components/GroupTabContent';
import { PinnedAnnouncementsBanner } from './components/PinnedAnnouncementsBanner';
import { getAvailableGroupSections, isGroupSectionKey, type GroupSectionKey } from './groupSections';
import {
  createGroupDiscussion,
  createGroupInviteLink,
  decideGroupJoinRequest,
  deleteGroup,
  deleteGroupFeedItem,
  getGroupDetail,
  getGroupDiscussion,
  GroupApiError,
  hideGroupFeedItem,
  joinGroup,
  leaveGroup,
  listGroupDiscussions,
  listGroupEvents,
  listGroupFeed,
  listGroupInvites,
  listGroupJoinRequests,
  listGroupMembers,
  muteGroupFeedUser,
  reactToGroupFeedItem,
  removeGroupMember,
  revokeGroupInvite,
  replyToGroupDiscussion,
  reportGroupFeedItem,
  sendGroupInvites,
  toggleGroupFeedLike,
  updateGroupMemberRole,
  voteInGroupFeedPoll,
  emptyGroupFormDraft,
  emptyGroupImageDraft,
  getGroupFormCapabilities,
  groupFormFingerprint,
  updateGroupFromDraft,
  type GroupDetailRecord,
  type GroupDiscussion,
  type GroupDiscussionDetail,
  type GroupJoinRequestRecord,
  type GroupInviteRecord,
  type GroupInviteSendResult,
  type GroupMemberRecord,
  type GroupFormCapabilities,
  type GroupFormDraft,
} from './api';
import { GroupNotificationPrefs } from './components/GroupNotificationPrefs';
import { CourseGroupRecommendations } from '@/components/courses/CourseGroupRecommendations';
import {
  NewDiscussionModal,
  GroupSettingsModal,
  GroupLeaveModal,
  GroupDeleteModal,
  GroupInviteModal,
  GroupReportModal,
} from './components/GroupModals';
import { toJsonLd } from '@/lib/json-ld';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type GroupDetails = GroupDetailRecord;
type Discussion = GroupDiscussion;
type DiscussionDetail = GroupDiscussionDetail;
type GroupMember = GroupMemberRecord;
type JoinRequest = GroupJoinRequestRecord;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getMemberCount(group: GroupDetails): number {
  return group.member_count ?? group.members_count ?? 0;
}

function isMember(group: GroupDetails): boolean {
  if (group.viewer_membership) {
    return group.viewer_membership.status === 'active';
  }
  return group.is_member ?? false;
}

function isGroupAdmin(group: GroupDetails): boolean {
  if (group.viewer_membership) {
    return group.viewer_membership.is_admin;
  }
  return group.is_admin ?? false;
}

function appendUniqueById<T extends { id: number }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const numericId = id && /^\d+$/.test(id) ? Number(id) : Number.NaN;

  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return <Navigate to={tenantPath('/groups')} replace />;
  }

  return <GroupDetailView key={numericId} groupId={numericId} />;
}

interface GroupDetailViewProps {
  groupId: number;
}

function GroupDetailView({ groupId }: GroupDetailViewProps) {
  const { t } = useTranslation('groups');
  const id = String(groupId);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser, isAuthenticated } = useAuth();
  const { tenantPath, hasGroupTab, hasFeature } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);
  const requestScopeRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestScopeRef.current = controller;

    return () => {
      controller.abort();
      if (requestScopeRef.current === controller) requestScopeRef.current = null;
    };
  }, []);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Core state
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userIsMember = group ? isMember(group) : false;
  const userIsAdmin = group ? isGroupAdmin(group) : false;
  const hasSubGroups = Boolean(group?.sub_groups?.length);
  const availableSections = useMemo(
    () => getAvailableGroupSections({
      hasGroupTab,
      hasSubgroups: hasSubGroups,
      userIsAdmin,
      userIsMember,
      hasEventsFeature: hasFeature('events'),
    }),
    [hasFeature, hasGroupTab, hasSubGroups, userIsAdmin, userIsMember],
  );
  const requestedTab = searchParams.get('tab');
  const activeTab: GroupSectionKey = isGroupSectionKey(requestedTab) && availableSections.includes(requestedTab)
    ? requestedTab
    : (availableSections[0] ?? 'feed');

  useEffect(() => {
    if (!group || availableSections.length === 0 || requestedTab === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab);
    setSearchParams(next, { replace: true });
  }, [activeTab, availableSections.length, group, requestedTab, searchParams, setSearchParams]);

  const handleTabChange = useCallback((tab: GroupSectionKey) => {
    if (!availableSections.includes(tab)) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  }, [availableSections, searchParams, setSearchParams]);

  usePageTitle(group?.name ?? t('title'));

  // Feed state
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const feedCursorRef = useRef<string | undefined>(undefined);

  // Compose Hub for group posts
  const { isOpen: isComposeOpen, onOpen: onComposeOpen, onClose: onComposeClose } = useDisclosure();

  // Report modal
  const { isOpen: isReportOpen, onOpen: onReportOpen, onClose: onReportClose } = useDisclosure();
  const [reportPostId, setReportPostId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  // Members state
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersLoadingMore, setMembersLoadingMore] = useState(false);
  const [membersHasMore, setMembersHasMore] = useState(false);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const membersCursorRef = useRef<string | null>(null);
  const membersHasMoreRef = useRef(false);
  const membersSearchRef = useRef('');
  const membersRequestRef = useRef<AbortController | null>(null);
  const membersRequestSequenceRef = useRef(0);
  const membersSeenCursorsRef = useRef(new Set<string>());

  // Discussions state
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [discussionsLoaded, setDiscussionsLoaded] = useState(false);
  const [discussionsError, setDiscussionsError] = useState(false);
  const [discussionsCursor, setDiscussionsCursor] = useState<string | undefined>();
  const [discussionsHasMore, setDiscussionsHasMore] = useState(true);
  const [showNewDiscussion, setShowNewDiscussion] = useState(false);
  const [newDiscussionTitle, setNewDiscussionTitle] = useState('');
  const [newDiscussionContent, setNewDiscussionContent] = useState('');
  const [creatingDiscussion, setCreatingDiscussion] = useState(false);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [sendingInvites, setSendingInvites] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<GroupInviteRecord[]>([]);
  const [inviteResults, setInviteResults] = useState<GroupInviteSendResult[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [revokingInvite, setRevokingInvite] = useState<number | null>(null);

  // Notification preferences modal
  const [showNotifPrefs, setShowNotifPrefs] = useState(false);

  // Expanded discussion state
  const [expandedDiscussionId, setExpandedDiscussionId] = useState<number | null>(null);
  const [expandedDiscussion, setExpandedDiscussion] = useState<DiscussionDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [loadingEarlierReplies, setLoadingEarlierReplies] = useState(false);
  const expandedDiscussionRequestIdRef = useRef(0);
  const [replyContent, setReplyContent] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // Admin state
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<GroupFormDraft>(() => emptyGroupFormDraft());
  const [settingsCapabilities, setSettingsCapabilities] = useState<GroupFormCapabilities | null>(null);
  const settingsInitialFingerprintRef = useRef(groupFormFingerprint(emptyGroupFormDraft()));
  const [savingSettings, setSavingSettings] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);

  // Pending requests state
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestsError, setRequestsError] = useState(false);
  const [processingRequest, setProcessingRequest] = useState<number | null>(null);

  // Member management state
  const [updatingMember, setUpdatingMember] = useState<number | null>(null);

  // Leave confirmation state
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Events state
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLoadingMore, setEventsLoadingMore] = useState(false);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const eventsCursorRef = useRef<string | null>(null);
  const eventsHasMoreRef = useRef(false);
  const eventsRequestRef = useRef<AbortController | null>(null);
  const eventsRequestSequenceRef = useRef(0);
  const eventsSeenCursorsRef = useRef(new Set<string>());

  useEffect(() => () => {
    membersRequestRef.current?.abort();
    eventsRequestRef.current?.abort();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Load Group
  // ─────────────────────────────────────────────────────────────────────────

  const loadGroup = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const nextGroup = await getGroupDetail(groupId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setGroup(nextGroup);
    } catch (err) {
      if (controller.signal.aborted || abortRef.current !== controller) return;
      logError('Failed to load group', err);
      setError(
        err instanceof GroupApiError && err.code === 'NOT_FOUND'
          ? tRef.current('detail.not_found_desc')
          : tRef.current('detail.error_load_failed'),
      );
    } finally {
      if (!controller.signal.aborted && abortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, [groupId, id]);

  useEffect(() => {
    loadGroup();
    return () => abortRef.current?.abort();
  }, [loadGroup]);


  // Invite handlers
  const loadPendingInvites = useCallback(async () => {
    if (!id) return;
    const signal = requestScopeRef.current?.signal;
    try {
      setInvitesLoading(true);
      const invites = await listGroupInvites(groupId, { signal });
      if (!signal?.aborted) {
        setPendingInvites(invites);
        const latestLink = invites.find((invite) => invite.type === 'link' && invite.invite_url);
        if (latestLink?.invite_url) setInviteLink(latestLink.invite_url);
      }
    } catch (err) {
      if (!(err instanceof GroupApiError && err.isCancellation)) {
        logError('GroupDetailPage.loadInvites', err);
        toastRef.current.error(tRef.current('detail.invites_failed'));
      }
    } finally {
      if (!signal?.aborted) setInvitesLoading(false);
    }
  }, [groupId, id]);

  const handleGenerateInviteLink = async () => {
    if (!id) return;
    try {
      const invite = await createGroupInviteLink(groupId);
      setInviteLink(invite.invite_url ?? null);
      setPendingInvites((current) => [invite, ...current.filter((item) => item.id !== invite.id)]);
    } catch (err) {
      logError('GroupDetailPage.generateInviteLink', err);
      toastRef.current.error(tRef.current('detail.invite_link_error'));
    }
  };

  const handleSendInvites = async () => {
    if (!id || !inviteEmails.trim()) return;
    setSendingInvites(true);
    const emails = inviteEmails.split(',').map((e: string) => e.trim()).filter(Boolean);
    try {
      const results = await sendGroupInvites(groupId, { emails, message: inviteMessage });
      setInviteResults(results);
      if (results.some((result) => result.status === 'sent')) {
        toastRef.current.success(tRef.current('detail.invites_sent'));
      } else {
        toastRef.current.error(tRef.current('detail.invites_failed'));
      }
      setInviteEmails('');
      setInviteMessage('');
      await loadPendingInvites();
    } catch (err) {
      logError('GroupDetailPage.sendInvites', err);
      toastRef.current.error(tRef.current('detail.invites_failed'));
    } finally {
      setSendingInvites(false);
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    try {
      setRevokingInvite(inviteId);
      await revokeGroupInvite(groupId, inviteId);
      setPendingInvites((current) => current.filter((invite) => invite.id !== inviteId));
      if (pendingInvites.find((invite) => invite.id === inviteId)?.invite_url === inviteLink) {
        setInviteLink(null);
      }
      toastRef.current.success(tRef.current('toast.invite_revoked'));
    } catch (err) {
      logError('GroupDetailPage.revokeInvite', err);
      toastRef.current.error(tRef.current('toast.invite_revoke_failed'));
    } finally {
      setRevokingInvite(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Load Group Feed
  // ─────────────────────────────────────────────────────────────────────────

  const loadGroupFeed = useCallback(async (append = false) => {
    if (!id) return;
    if (append && !feedCursorRef.current) return;
    const signal = requestScopeRef.current?.signal;

    try {
      if (append) {
        setFeedLoadingMore(true);
      } else {
        setFeedLoading(true);
        setFeedError(false);
      }

      const page = await listGroupFeed(groupId, {
        cursor: append ? feedCursorRef.current : undefined,
        perPage: 20,
        signal,
      });
      if (signal?.aborted) return;
      if (append) {
        setFeedItems((prev) => [...prev, ...page.items]);
      } else {
        setFeedItems(page.items);
      }
      setFeedHasMore(page.hasMore);
      feedCursorRef.current = page.nextCursor;
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('Failed to load group feed', err);
      if (!append) {
        setFeedError(true);
        toastRef.current.error(tRef.current('toast.feed_load_failed'));
      } else {
        toastRef.current.error(tRef.current('load_more_error'));
      }
    } finally {
      if (!signal?.aborted) {
        setFeedLoading(false);
        setFeedLoadingMore(false);
        setFeedLoaded(true);
      }
    }
  }, [groupId, id]);

  useEffect(() => {
    const handler = (event: globalThis.Event) => {
      const payload = (event as unknown as CustomEvent<FeedSyncPayload>).detail;
      setFeedItems((prev) => prev.map((item) => applyFeedSyncToItem(item, payload)));
    };

    window.addEventListener(FEED_SYNC_EVENT, handler as EventListener);
    return () => window.removeEventListener(FEED_SYNC_EVENT, handler as EventListener);
  }, []);

  useEffect(() => {
    if (activeTab === 'feed' && !feedLoaded && group && isMember(group)) {
      loadGroupFeed();
    }
  }, [activeTab, feedLoaded, group]); // eslint-disable-line react-hooks/exhaustive-deps -- lazy load feed tab; loadGroupFeed excluded to avoid loop

  // ─────────────────────────────────────────────────────────────────────────
  // Feed Actions (like, hide, mute, report, delete, poll vote)
  // ─────────────────────────────────────────────────────────────────────────

  const handleFeedToggleLike = async (item: FeedItem) => {
    const newIsLiked = !item.is_liked;
    const newLikesCount = newIsLiked ? item.likes_count + 1 : item.likes_count - 1;
    setFeedItems((prev) =>
      prev.map((fi) =>
        fi.id === item.id && fi.type === item.type
          ? { ...fi, is_liked: newIsLiked, likes_count: newLikesCount }
          : fi
      )
    );
    try {
      const result = await toggleGroupFeedLike(item);
      const serverLiked = result.isLiked ?? newIsLiked;
      const serverLikesCount = result.likesCount;
      setFeedItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, is_liked: serverLiked, likes_count: serverLikesCount }
            : fi
        )
      );
      dispatchFeedSync({ targetType: item.type, targetId: item.id, patch: { is_liked: serverLiked, likes_count: serverLikesCount } });
    } catch (err) {
      logError('Failed to toggle like', err);
      setFeedItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, is_liked: item.is_liked, likes_count: item.likes_count }
            : fi
        )
      );
    }
  };

  const handleFeedReact = async (item: FeedItem, reactionType: ReactionType) => {
    const previousReactions = item.reactions ?? { counts: {}, total: 0, user_reaction: null, top_reactors: [] };
    try {
      const reactions = await reactToGroupFeedItem(item, reactionType);
      setFeedItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, reactions }
            : fi
        )
      );
      dispatchFeedSync({ targetType: item.type, targetId: item.id, patch: { reactions } });
    } catch (err) {
      logError('Failed to react', err);
      setFeedItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, reactions: previousReactions }
            : fi
        )
      );
    }
  };

  const handleFeedHidePost = async (item: FeedItem) => {
    try {
      await hideGroupFeedItem(item);
      setFeedItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
      toastRef.current.success(tRef.current('toast.post_hidden'));
    } catch (err) {
      logError('Failed to hide post', err);
      toastRef.current.error(tRef.current('toast.hide_failed'));
    }
  };

  const handleFeedMuteUser = async (userId: number) => {
    try {
      await muteGroupFeedUser(userId);
      setFeedItems((prev) => prev.filter((fi) => {
        const author = fi.author ?? (fi as unknown as Record<string, unknown>).user as FeedItem['author'];
        return !author || author.id !== userId;
      }));
      toastRef.current.success(tRef.current('toast.user_muted'));
    } catch (err) {
      logError('Failed to mute user', err);
      toastRef.current.error(tRef.current('toast.mute_failed'));
    }
  };

  const openFeedReportModal = (postId: number) => {
    setReportPostId(postId);
    setReportReason('');
    onReportOpen();
  };

  const handleFeedReport = async () => {
    if (!reportPostId || !reportReason.trim()) {
      toastRef.current.error(tRef.current('toast.provide_reason'));
      return;
    }
    setIsReporting(true);
    try {
      await reportGroupFeedItem(reportPostId, reportReason.trim());
      onReportClose();
      setReportPostId(null);
      setReportReason('');
      toastRef.current.success(tRef.current('toast.reported'));
    } catch (err) {
      logError('Failed to report post', err);
      toastRef.current.error(tRef.current('toast.report_failed'));
    } finally {
      setIsReporting(false);
    }
  };

  const handleFeedDeletePost = async (item: FeedItem) => {
    try {
      await deleteGroupFeedItem(item);
      setFeedItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
      toastRef.current.success(tRef.current('toast.post_deleted'));
    } catch (err) {
      logError('Failed to delete post', err);
      toastRef.current.error(tRef.current('toast.post_delete_failed'));
    }
  };

  const handleFeedVotePoll = async (pollId: number, optionId: number) => {
    try {
      const pollData = await voteInGroupFeedPoll(pollId, optionId);
      setFeedItems((prev) =>
        prev.map((fi) =>
          fi.id === pollId && fi.type === 'poll'
            ? { ...fi, poll_data: pollData }
            : fi
        )
      );
    } catch (err) {
      logError('Failed to vote', err);
      toastRef.current.error(tRef.current('toast.vote_failed'));
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Load Discussions
  // ─────────────────────────────────────────────────────────────────────────

  const loadDiscussions = useCallback(async (append = false) => {
    if (!id || discussionsLoading) return;
    if (append && !discussionsCursor) return;
    const signal = requestScopeRef.current?.signal;

    try {
      setDiscussionsLoading(true);
      if (!append) setDiscussionsError(false);
      const page = await listGroupDiscussions(groupId, {
        cursor: append ? discussionsCursor : undefined,
        perPage: 15,
        signal,
      });
      if (signal?.aborted) return;
      if (append) {
        setDiscussions((prev) => {
          const seen = new Set(prev.map((discussion) => discussion.id));
          return [...prev, ...page.discussions.filter((discussion) => !seen.has(discussion.id))];
        });
      } else {
        setDiscussions(page.discussions);
      }
      setDiscussionsCursor(page.nextCursor);
      setDiscussionsHasMore(page.hasMore);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('Failed to load discussions', err);
      if (!append) {
        setDiscussionsError(true);
        toastRef.current.error(tRef.current('toast.discussions_load_failed'));
      } else {
        toastRef.current.error(tRef.current('load_more_error'));
      }
    } finally {
      if (!signal?.aborted) {
        setDiscussionsLoading(false);
        setDiscussionsLoaded(true);
      }
    }
  }, [groupId, id, discussionsCursor, discussionsLoading]);

  // Load discussions when tab changes to discussion
  useEffect(() => {
    if (activeTab === 'discussion' && !discussionsLoaded && group && isMember(group)) {
      loadDiscussions();
    }
  }, [activeTab, discussionsLoaded, group]); // eslint-disable-line react-hooks/exhaustive-deps -- lazy load discussion tab; loadDiscussions excluded to avoid loop

  // ─────────────────────────────────────────────────────────────────────────
  // Load Members
  // ─────────────────────────────────────────────────────────────────────────

  const loadMembers = useCallback(async ({
    append = false,
    query = membersSearchRef.current,
  }: { append?: boolean; query?: string } = {}) => {
    if (!id) return;

    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    const requestedCursor = append ? membersCursorRef.current : null;
    if (append) {
      if (
        membersRequestRef.current
        || !membersHasMoreRef.current
        || requestedCursor === null
      ) return;
    } else {
      if (
        membersRequestRef.current
        && normalizedQuery === membersSearchRef.current
      ) return;
      membersRequestRef.current?.abort();
      membersSearchRef.current = normalizedQuery;
      membersCursorRef.current = null;
      membersHasMoreRef.current = false;
      membersSeenCursorsRef.current.clear();
      setMembers([]);
      setMembersHasMore(false);
    }

    const controller = new AbortController();
    const requestId = ++membersRequestSequenceRef.current;
    membersRequestRef.current = controller;

    try {
      if (append) {
        setMembersLoadingMore(true);
      } else {
        setMembersLoading(true);
        setMembersError(false);
      }
      const page = await listGroupMembers(groupId, {
        cursor: requestedCursor ?? undefined,
        perPage: 20,
        search: normalizedQuery || undefined,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted
        || membersRequestSequenceRef.current !== requestId
        || membersRequestRef.current !== controller
        || membersSearchRef.current !== normalizedQuery
      ) return;
      if (page.nextCursor && membersSeenCursorsRef.current.has(page.nextCursor)) {
        throw new Error('Groups member collection returned a repeated cursor.');
      }

      setMembers((current) => append ? appendUniqueById(current, page.items) : page.items);
      membersCursorRef.current = page.nextCursor;
      membersHasMoreRef.current = page.hasMore;
      if (page.nextCursor) membersSeenCursorsRef.current.add(page.nextCursor);
      setMembersHasMore(page.hasMore);
    } catch (err) {
      if (
        controller.signal.aborted
        || membersRequestSequenceRef.current !== requestId
        || membersRequestRef.current !== controller
        || (err instanceof GroupApiError && err.isCancellation)
      ) return;
      logError('Failed to load group members', err);
      if (append) {
        toastRef.current.error(tRef.current('load_more_error'));
      } else {
        setMembersError(true);
      }
    } finally {
      if (membersRequestRef.current === controller) {
        membersRequestRef.current = null;
        if (append) setMembersLoadingMore(false);
        else setMembersLoading(false);
        setMembersLoaded(true);
      }
    }
  }, [groupId, id]);

  useEffect(() => {
    if (activeTab === 'members' && !membersLoaded) {
      void loadMembers();
    }
  }, [activeTab, membersLoaded, loadMembers]);

  // ─────────────────────────────────────────────────────────────────────────
  // Load Events
  // ─────────────────────────────────────────────────────────────────────────

  const loadEvents = useCallback(async ({ append = false }: { append?: boolean } = {}) => {
    if (!id) return;

    const requestedCursor = append ? eventsCursorRef.current : null;
    if (append) {
      if (
        eventsRequestRef.current
        || !eventsHasMoreRef.current
        || requestedCursor === null
      ) return;
    } else {
      if (eventsRequestRef.current) return;
      eventsCursorRef.current = null;
      eventsHasMoreRef.current = false;
      eventsSeenCursorsRef.current.clear();
      setEvents([]);
      setEventsHasMore(false);
    }

    const controller = new AbortController();
    const requestId = ++eventsRequestSequenceRef.current;
    eventsRequestRef.current = controller;

    try {
      if (append) {
        setEventsLoadingMore(true);
      } else {
        setEventsLoading(true);
        setEventsError(false);
      }
      const page = await listGroupEvents(groupId, {
        cursor: requestedCursor ?? undefined,
        perPage: 20,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted
        || eventsRequestSequenceRef.current !== requestId
        || eventsRequestRef.current !== controller
      ) return;
      if (page.nextCursor && eventsSeenCursorsRef.current.has(page.nextCursor)) {
        throw new Error('Groups event collection returned a repeated cursor.');
      }

      setEvents((current) => append ? appendUniqueById(current, page.items) : page.items);
      eventsCursorRef.current = page.nextCursor;
      eventsHasMoreRef.current = page.hasMore;
      if (page.nextCursor) eventsSeenCursorsRef.current.add(page.nextCursor);
      setEventsHasMore(page.hasMore);
    } catch (err) {
      if (
        controller.signal.aborted
        || eventsRequestSequenceRef.current !== requestId
        || eventsRequestRef.current !== controller
        || (err instanceof GroupApiError && err.isCancellation)
      ) return;
      logError('Failed to load group events', err);
      if (append) {
        toastRef.current.error(tRef.current('load_more_error'));
      } else {
        setEventsError(true);
      }
    } finally {
      if (eventsRequestRef.current === controller) {
        eventsRequestRef.current = null;
        if (append) setEventsLoadingMore(false);
        else setEventsLoading(false);
        setEventsLoaded(true);
      }
    }
  }, [groupId, id]);

  useEffect(() => {
    if (activeTab === 'events' && !eventsLoaded) {
      void loadEvents();
    }
  }, [activeTab, eventsLoaded, loadEvents]);

  // ─────────────────────────────────────────────────────────────────────────
  // Load Pending Join Requests (Admin)
  // ─────────────────────────────────────────────────────────────────────────

  const loadJoinRequests = useCallback(async () => {
    if (!id || requestsLoading) return;
    const signal = requestScopeRef.current?.signal;

    try {
      setRequestsLoading(true);
      setRequestsError(false);
      const nextRequests = await listGroupJoinRequests(groupId, { signal });
      if (signal?.aborted) return;
      setJoinRequests(nextRequests);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('Failed to load join requests', err);
      setRequestsError(true);
    } finally {
      if (!signal?.aborted) {
        setRequestsLoading(false);
        setRequestsLoaded(true);
      }
    }
  }, [groupId, id, requestsLoading]);

  // ─────────────────────────────────────────────────────────────────────────
  // Join / Leave
  // ─────────────────────────────────────────────────────────────────────────

  async function handleJoinLeave() {
    if (!group || !isAuthenticated) return;

    const membershipStatus = group.viewer_membership?.status ?? (isMember(group) ? 'active' : 'none');
    if (membershipStatus === 'active') {
      if (group.viewer_membership?.capabilities?.can_leave === false) return;
      setShowLeaveConfirm(true);
      return;
    }
    if (membershipStatus === 'pending') {
      setShowLeaveConfirm(true);
      return;
    }

    try {
      setIsJoining(true);
      const memberCount = getMemberCount(group);
      const mutation = await joinGroup(group.id);
      const joinStatus = mutation.status;
      const countIncreased = mutation.action === 'joined';
      setGroup((prev) => prev ? {
        ...prev,
        is_member: joinStatus === 'active',
        viewer_membership: {
          status: joinStatus,
          role: mutation.membership?.role ?? 'member',
          is_admin: false,
          capabilities: prev.viewer_membership?.capabilities ? {
            ...prev.viewer_membership.capabilities,
            can_join: false,
            can_leave: joinStatus === 'active',
            can_cancel_request: joinStatus === 'pending',
          } : undefined,
        },
        member_count: countIncreased ? memberCount + 1 : memberCount,
        members_count: countIncreased ? memberCount + 1 : memberCount,
      } : null);
      toastRef.current.success(
        joinStatus === 'active'
          ? tRef.current('toast.joined')
          : tRef.current('toast.join_requested')
      );
    } catch (err) {
      logError('Failed to join group', err);
      toastRef.current.error(tRef.current('toast.join_failed'));
    } finally {
      setIsJoining(false);
    }

    // Always refresh from server to get authoritative membership state.
    try {
      const signal = requestScopeRef.current?.signal;
      const fresh = await getGroupDetail(group.id, { signal });
      if (!signal?.aborted) {
        setGroup(fresh);
        if (isMember(fresh) && !feedLoaded) {
          loadGroupFeed();
        }
      }
    } catch {
      // Silent — optimistic state is already set
    }
  }

  async function handleConfirmLeave() {
    if (!group) return;

    try {
      setIsJoining(true);
      const memberCount = getMemberCount(group);
      const mutation = await leaveGroup(group.id);
      const countDecreased = mutation.action === 'left';
      setGroup((prev) => prev ? {
        ...prev,
        is_member: false,
        viewer_membership: prev.viewer_membership ? {
          ...prev.viewer_membership,
          status: 'none',
          role: null,
          is_admin: false,
          capabilities: prev.viewer_membership.capabilities ? {
            ...prev.viewer_membership.capabilities,
            can_join: true,
            can_leave: false,
            can_cancel_request: false,
            can_invite: false,
            can_manage_members: false,
            can_manage_admins: false,
            can_delete: false,
          } : undefined,
        } : undefined,
        member_count: countDecreased ? Math.max(0, memberCount - 1) : memberCount,
        members_count: countDecreased ? Math.max(0, memberCount - 1) : memberCount,
      } : null);
      toastRef.current.success(tRef.current(
        mutation.action === 'request_cancelled' ? 'toast.request_cancelled' : 'toast.left',
      ));
    } catch (err) {
      logError('Failed to leave group', err);
      const wasPending = group.viewer_membership?.status === 'pending';
      toastRef.current.error(tRef.current(wasPending ? 'toast.request_cancel_failed' : 'toast.leave_failed'));
    } finally {
      setIsJoining(false);
      setShowLeaveConfirm(false);
    }

    // Refresh from server to get authoritative state
    try {
      const signal = requestScopeRef.current?.signal;
      const fresh = await getGroupDetail(group.id, { signal });
      if (!signal?.aborted) setGroup(fresh);
    } catch {
      // Silent — optimistic state is already set
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Create Discussion
  // ─────────────────────────────────────────────────────────────────────────

  async function handleCreateDiscussion() {
    const title = newDiscussionTitle.trim();
    const content = newDiscussionContent.trim();
    if (!id || !title || !content) return;

    try {
      setCreatingDiscussion(true);
      const discussion = await createGroupDiscussion(groupId, {
        title,
        content,
      });
      setDiscussions((prev) => [discussion, ...prev]);
      setNewDiscussionTitle('');
      setNewDiscussionContent('');
      setShowNewDiscussion(false);
      toastRef.current.success(tRef.current('toast.discussion_created'));
    } catch (err) {
      logError('Failed to create discussion', err);
      toastRef.current.error(tRef.current('toast.discussion_failed'));
    } finally {
      setCreatingDiscussion(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Expand Discussion & Load Messages
  // ─────────────────────────────────────────────────────────────────────────

  async function handleExpandDiscussion(discussionId: number) {
    if (expandedDiscussionId === discussionId) {
      expandedDiscussionRequestIdRef.current += 1;
      setExpandedDiscussionId(null);
      setExpandedDiscussion(null);
      setExpandedLoading(false);
      setLoadingEarlierReplies(false);
      return;
    }

    if (!id) return;
    const signal = requestScopeRef.current?.signal;
    const requestId = ++expandedDiscussionRequestIdRef.current;

    try {
      setExpandedDiscussionId(discussionId);
      setExpandedLoading(true);
      setLoadingEarlierReplies(false);
      setExpandedDiscussion(null);
      setReplyContent('');
      const detail = await getGroupDiscussion(groupId, discussionId, { signal });
      if (signal?.aborted || requestId !== expandedDiscussionRequestIdRef.current) return;
      setExpandedDiscussion(detail);
    } catch (err) {
      if (requestId !== expandedDiscussionRequestIdRef.current
        || (err instanceof GroupApiError && err.isCancellation)) return;
      logError('Failed to load discussion', err);
      toastRef.current.error(tRef.current('toast.discussion_load_failed'));
      setExpandedDiscussionId(null);
    } finally {
      if (!signal?.aborted && requestId === expandedDiscussionRequestIdRef.current) {
        setExpandedLoading(false);
      }
    }
  }

  async function handleLoadEarlierReplies() {
    const current = expandedDiscussion;
    if (!current || !expandedDiscussionId || !current.messagesHasMore || !current.messagesNextCursor || loadingEarlierReplies) {
      return;
    }
    const signal = requestScopeRef.current?.signal;
    const requestId = expandedDiscussionRequestIdRef.current;

    try {
      setLoadingEarlierReplies(true);
      const olderPage = await getGroupDiscussion(groupId, expandedDiscussionId, {
        cursor: current.messagesNextCursor,
        perPage: 50,
        signal,
      });
      if (signal?.aborted || requestId !== expandedDiscussionRequestIdRef.current) return;
      setExpandedDiscussion((previous) => {
        if (!previous || previous.id !== expandedDiscussionId) return previous;
        const existingIds = new Set(previous.messages.map((message) => message.id));
        const olderMessages = olderPage.messages.filter((message) => !existingIds.has(message.id));
        return {
          ...previous,
          messages: [...olderMessages, ...previous.messages],
          messagesNextCursor: olderPage.messagesNextCursor,
          messagesHasMore: olderPage.messagesHasMore,
        };
      });
    } catch (err) {
      if (requestId !== expandedDiscussionRequestIdRef.current
        || (err instanceof GroupApiError && err.isCancellation)) return;
      logError('Failed to load earlier discussion replies', err);
      toastRef.current.error(tRef.current('toast.replies_load_failed'));
    } finally {
      if (!signal?.aborted && requestId === expandedDiscussionRequestIdRef.current) {
        setLoadingEarlierReplies(false);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Reply to Discussion
  // ─────────────────────────────────────────────────────────────────────────

  async function handleReply() {
    const content = replyContent.trim();
    if (!id || !expandedDiscussionId || !content) return;

    try {
      setSendingReply(true);
      const newMessage = await replyToGroupDiscussion(groupId, expandedDiscussionId, content);
      setExpandedDiscussion((prev) =>
        prev ? {
          ...prev,
          messages: [...prev.messages, newMessage],
          reply_count: prev.reply_count + 1,
          last_reply_at: newMessage.created_at,
        } : null
      );
      setDiscussions((prev) =>
        prev.map((d) =>
          d.id === expandedDiscussionId
            ? { ...d, reply_count: d.reply_count + 1, last_reply_at: newMessage.created_at }
            : d
        )
      );
      setReplyContent('');
      toastRef.current.success(tRef.current('toast.reply_sent'));
    } catch (err) {
      logError('Failed to send reply', err);
      toastRef.current.error(tRef.current('toast.reply_failed'));
    } finally {
      setSendingReply(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: Save Settings
  // ─────────────────────────────────────────────────────────────────────────

  function openSettingsModal() {
    if (!group) return;
    const draft: GroupFormDraft = {
      name: group.name,
      description: group.description || '',
      visibility: group.visibility,
      location: {
        label: group.location || '',
        latitude: group.latitude ?? null,
        longitude: group.longitude ?? null,
      },
      typeId: group.type_id ?? null,
      parentId: group.parent_id ?? null,
      templateId: group.template_id ?? null,
      primaryColor: group.primary_color ?? null,
      accentColor: group.accent_color ?? null,
      avatar: emptyGroupImageDraft(group.image_url || null),
      cover: emptyGroupImageDraft(group.cover_image_url || group.cover_image || null),
    };
    settingsInitialFingerprintRef.current = groupFormFingerprint(draft);
    setSettingsDraft(draft);
    setShowSettingsModal(true);
    const controller = requestScopeRef.current;
    void getGroupFormCapabilities(controller?.signal)
      .then((value) => {
        if (!controller?.signal.aborted) setSettingsCapabilities(value);
      })
      .catch((error) => logError('Failed to load group settings capabilities', error));
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toastRef.current.error(tRef.current('form.toast.image_type'));
      e.target.value = '';
      return;
    }
    if (file.size > (settingsCapabilities?.limits.imageMaxBytes ?? 8 * 1024 * 1024)) {
      toastRef.current.error(tRef.current('form.toast.image_size'));
      e.target.value = '';
      return;
    }

    setSettingsDraft((previous) => {
      const current = previous[type];
      if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return {
        ...previous,
        [type]: {
          ...current,
          action: 'replace',
          file,
          previewUrl: URL.createObjectURL(file),
        },
      };
    });
    e.target.value = '';
  }

  function handleImageRemove(type: 'avatar' | 'cover') {
    setSettingsDraft((previous) => {
      const current = previous[type];
      if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return {
        ...previous,
        [type]: {
          ...current,
          action: current.existingUrl ? 'remove' : 'keep',
          file: null,
          previewUrl: null,
        },
      };
    });
  }

  async function handleSettingsOpenChange(open: boolean) {
    if (open) {
      setShowSettingsModal(true);
      return;
    }
    if (groupFormFingerprint(settingsDraft) !== settingsInitialFingerprintRef.current) {
      const discard = await confirm({
        title: tRef.current('form.discard_title'),
        body: tRef.current('form.discard_description'),
        confirmLabel: tRef.current('form.discard_confirm'),
        cancelLabel: tRef.current('form.discard_stay'),
        status: 'warning',
      });
      if (!discard) return;
    }
    for (const image of [settingsDraft.avatar, settingsDraft.cover]) {
      if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    }
    setShowSettingsModal(false);
  }

  async function handleSaveSettings() {
    if (!id || !settingsDraft.name.trim()) return;

    try {
      setSavingSettings(true);
      await updateGroupFromDraft(groupId, settingsDraft);
      settingsInitialFingerprintRef.current = groupFormFingerprint(settingsDraft);
      await loadGroup();
      setShowSettingsModal(false);
      toastRef.current.success(tRef.current('toast.settings_updated'));
    } catch (err) {
      logError('Failed to update group settings', err);
      toastRef.current.error(tRef.current('toast.settings_failed'));
    } finally {
      setSavingSettings(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: Delete Group
  // ─────────────────────────────────────────────────────────────────────────

  async function handleDeleteGroup() {
    if (!id) return;

    try {
      setDeletingGroup(true);
      await deleteGroup(groupId);
      toastRef.current.success(tRef.current('toast.deleted'));
      navigate(tenantPath('/groups'));
    } catch (err) {
      logError('Failed to delete group', err);
      toastRef.current.error(tRef.current('toast.delete_failed'));
    } finally {
      setDeletingGroup(false);
      setShowDeleteModal(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: Handle Join Request
  // ─────────────────────────────────────────────────────────────────────────

  async function handleJoinRequest(userId: number, action: 'accept' | 'reject') {
    if (!id) return;

    try {
      setProcessingRequest(userId);
      await decideGroupJoinRequest(groupId, userId, action);
      setJoinRequests((prev) => prev.filter((r) => r.user_id !== userId));
      toastRef.current.success(action === 'accept' ? tRef.current('toast.request_accepted') : tRef.current('toast.request_rejected'));
      if (action === 'accept') {
        // Re-fetch the group to get accurate member counts (avoids stale counts from rapid approvals)
        loadGroup();
        if (membersLoaded) {
          setMembersLoaded(false);
        }
      }
    } catch (err) {
      logError(`Failed to ${action} join request`, err);
      toastRef.current.error(tRef.current('toast.request_failed', { action }));
    } finally {
      setProcessingRequest(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: Update Member Role
  // ─────────────────────────────────────────────────────────────────────────

  async function handleUpdateMemberRole(userId: number, newRole: 'member' | 'admin') {
    if (!id) return;

    try {
      setUpdatingMember(userId);
      await updateGroupMemberRole(groupId, userId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === userId ? { ...m, role: newRole } : m))
      );
      toastRef.current.success(tRef.current('toast.role_updated', { role: newRole }));
    } catch (err) {
      logError('Failed to update member role', err);
      toastRef.current.error(tRef.current('toast.role_update_failed'));
    } finally {
      setUpdatingMember(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin: Remove Member
  // ─────────────────────────────────────────────────────────────────────────

  async function handleRemoveMember(userId: number) {
    if (!id) return;
    const member = members.find((item) => item.id === userId);
    if (!member || !group) return;

    const confirmed = await confirm({
      title: tRef.current('detail.remove_member_title'),
      body: tRef.current('detail.remove_member_confirm', { name: member.name, group: group.name }),
      confirmLabel: tRef.current('detail.remove_from_group'),
      cancelLabel: tRef.current('detail.cancel'),
      status: 'danger',
    });
    if (!confirmed) return;

    try {
      setUpdatingMember(userId);
      await removeGroupMember(groupId, userId);
      setMembers((prev) => prev.filter((m) => m.id !== userId));
      setGroup((prev) => prev ? {
        ...prev,
        member_count: Math.max(0, (prev.member_count ?? prev.members_count ?? 0) - 1),
        members_count: Math.max(0, (prev.member_count ?? prev.members_count ?? 0) - 1),
      } : null);
      toastRef.current.success(tRef.current('toast.member_removed'));
    } catch (err) {
      logError('Failed to remove member', err);
      toastRef.current.error(tRef.current('toast.member_remove_failed'));
    } finally {
      setUpdatingMember(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Computed
  // ─────────────────────────────────────────────────────────────────────────

  const isPrivateGroup = group?.visibility === 'private' || group?.visibility === 'secret';
  const metaDescription = isPrivateGroup
    ? t('detail.private_meta_description')
    : (
      group?.description ||
      (group ? t('detail.meta_description_fallback', { name: group.name, count: getMemberCount(group) }) : '')
    ).replace(/\s+/g, ' ').trim().slice(0, 160);
  const metaImage = isPrivateGroup
    ? undefined
    : group?.image_url || group?.cover_image_url || undefined;

  // ─────────────────────────────────────────────────────────────────────────
  // Loading / Error States
  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <>
        <PageMeta title={t('detail.loading')} noIndex />
        <LoadingScreen message={t('detail.loading')} />
      </>
    );
  }

  if (error || !group) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageMeta title={t('detail.unable_to_load')} noIndex />
        <GlassCard className="p-8 text-center" role="alert">
          <AlertCircle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('detail.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error || t('detail.not_found_desc')}</p>
          <div className="flex justify-center gap-3">
            <Button
              as={Link}
              to={tenantPath("/groups")}
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {t('detail.browse_groups')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => loadGroup()}
            >
              {t('detail.try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-6"
    >
      <PageMeta
        title={group?.name}
        description={metaDescription}
        image={metaImage}
        type="profile"
        noIndex={isPrivateGroup}
      />
      {!isPrivateGroup && (
        <Helmet>
          <script type="application/ld+json">
            {toJsonLd({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: group?.name,
              ...(group?.description ? { description: group.description.substring(0, 300) } : {}),
              ...(group?.image_url || group?.cover_image_url ? { image: group.image_url || group.cover_image_url } : {}),
              ...(group?.member_count ? { numberOfEmployees: { '@type': 'QuantitativeValue', value: group.member_count } } : {}),
            })}
          </script>
        </Helmet>
      )}

      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('title'), href: '/groups' },
        { label: group?.name || t('title') },
      ]} />

      {/* Group Header */}
      <GroupHeader
        group={group}
        userIsMember={userIsMember}
        userIsAdmin={userIsAdmin}
        isAuthenticated={isAuthenticated}
        isJoining={isJoining}
        isPrivateGroup={isPrivateGroup}
        joinRequests={joinRequests}
        requestsLoading={requestsLoading}
        requestsLoaded={requestsLoaded}
        requestsError={requestsError}
        processingRequest={processingRequest}
        getMemberCount={getMemberCount}
        onJoinLeave={handleJoinLeave}
        onOpenSettings={openSettingsModal}
        onOpenDelete={() => setShowDeleteModal(true)}
        onOpenInvite={() => {
          setShowInviteModal(true);
          setInviteResults([]);
          void loadPendingInvites();
        }}
        onOpenNotifPrefs={() => setShowNotifPrefs(true)}
        onLoadJoinRequests={loadJoinRequests}
        onJoinRequest={handleJoinRequest}
      />

      {/* Pinned Announcements Banner */}
      <PinnedAnnouncementsBanner groupId={group.id} isMember={userIsMember} />

      {/* Recommended courses (Courses module, alpha) — renders nothing when none linked */}
      <CourseGroupRecommendations groupId={group.id} />

      {/* Tab Navigation */}
      <GroupTabNav
        activeTab={activeTab}
        userIsAdmin={userIsAdmin}
        userIsMember={userIsMember}
        hasSubGroups={!!hasSubGroups}
        subGroupCount={group.sub_groups?.length ?? 0}
        onTabChange={handleTabChange}
      >
        <GroupTabContent
          activeTab={activeTab}
          groupId={group.id}
          userIsMember={userIsMember}
          userIsAdmin={userIsAdmin}
          isJoining={isJoining}
          currentUserId={currentUser?.id}
          groupOwnerId={group.owner?.id}
          groupAdminIds={group.admins?.map((a) => a.id)}
          hasSubGroups={!!hasSubGroups}
          subGroups={group.sub_groups}
          feedItems={feedItems}
          feedLoading={feedLoading}
          feedError={feedError}
          feedHasMore={feedHasMore}
          feedLoadingMore={feedLoadingMore}
          onComposeOpen={onComposeOpen}
          onLoadMoreFeed={() => loadGroupFeed(true)}
          onRefreshFeed={() => { feedCursorRef.current = undefined; return loadGroupFeed(false); }}
          onToggleLike={handleFeedToggleLike}
          onReact={handleFeedReact}
          onHidePost={handleFeedHidePost}
          onMuteUser={handleFeedMuteUser}
          onReportPost={openFeedReportModal}
          onDeletePost={handleFeedDeletePost}
          onVotePoll={handleFeedVotePoll}
          discussions={discussions}
          discussionsLoading={discussionsLoading}
          discussionsError={discussionsError}
          discussionsHasMore={discussionsHasMore}
          expandedDiscussionId={expandedDiscussionId}
          expandedDiscussion={expandedDiscussion}
          expandedLoading={expandedLoading}
          loadingEarlierReplies={loadingEarlierReplies}
          replyContent={replyContent}
          sendingReply={sendingReply}
          onShowNewDiscussion={() => setShowNewDiscussion(true)}
          onExpandDiscussion={handleExpandDiscussion}
          onLoadMoreDiscussions={() => loadDiscussions(true)}
          onLoadEarlierReplies={handleLoadEarlierReplies}
          onRetryDiscussions={() => loadDiscussions(false)}
          onReplyContentChange={setReplyContent}
          onSendReply={handleReply}
          members={members}
          membersLoading={membersLoading}
          membersLoadingMore={membersLoadingMore}
          membersHasMore={membersHasMore}
          membersError={membersError}
          updatingMember={updatingMember}
          onUpdateMemberRole={handleUpdateMemberRole}
          onRemoveMember={handleRemoveMember}
          onSearchMembers={(query) => { void loadMembers({ query }); }}
          onLoadMoreMembers={() => { void loadMembers({ append: true }); }}
          onRetryMembers={() => loadMembers()}
          events={events}
          eventsLoading={eventsLoading}
          eventsLoadingMore={eventsLoadingMore}
          eventsHasMore={eventsHasMore}
          eventsError={eventsError}
          onLoadMoreEvents={() => { void loadEvents({ append: true }); }}
          onRetryEvents={() => loadEvents()}
          onJoinLeave={handleJoinLeave}
        />
      </GroupTabNav>

      {/* ─── New Discussion Modal ─── */}
      <NewDiscussionModal
        isOpen={showNewDiscussion}
        onOpenChange={setShowNewDiscussion}
        newDiscussionTitle={newDiscussionTitle}
        newDiscussionContent={newDiscussionContent}
        creatingDiscussion={creatingDiscussion}
        onTitleChange={setNewDiscussionTitle}
        onContentChange={setNewDiscussionContent}
        onSubmit={handleCreateDiscussion}
      />

      {/* ─── Settings Modal ─── */}
      <GroupSettingsModal
        isOpen={showSettingsModal}
        onOpenChange={(open) => void handleSettingsOpenChange(open)}
        group={group}
        draft={settingsDraft}
        capabilities={settingsCapabilities}
        savingSettings={savingSettings}
        onDraftChange={setSettingsDraft}
        onImageUpload={handleImageUpload}
        onImageRemove={handleImageRemove}
        onSave={handleSaveSettings}
      />

      {/* ─── Leave Group Confirmation Modal ─── */}
      <GroupLeaveModal
        isOpen={showLeaveConfirm}
        onOpenChange={setShowLeaveConfirm}
        groupName={group.name}
        mode={group.viewer_membership?.status === 'pending' ? 'cancel_request' : 'leave'}
        isLoading={isJoining}
        onConfirm={handleConfirmLeave}
      />

      {/* ─── Delete Confirmation Modal ─── */}
      <GroupDeleteModal
        isOpen={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        groupName={group.name}
        isLoading={deletingGroup}
        onConfirm={handleDeleteGroup}
      />

      {/* ─── Compose Hub (Group Feed) ─── */}
      <ComposeHub
        isOpen={isComposeOpen}
        onClose={onComposeClose}
        groupId={group?.id ? Number(group.id) : undefined}
        onSuccess={() => { feedCursorRef.current = undefined; setFeedLoaded(false); loadGroupFeed(); }}
      />

      {/* ─── Report Post Modal ─── */}
      <GroupReportModal
        isOpen={isReportOpen}
        onClose={onReportClose}
        reportReason={reportReason}
        isReporting={isReporting}
        onReasonChange={setReportReason}
        onSubmit={handleFeedReport}
      />

      {/* ─── Notification Preferences Modal ─── */}
      {showNotifPrefs && group && (
        <GroupNotificationPrefs
          groupId={group.id}
          isOpen={showNotifPrefs}
          onClose={() => setShowNotifPrefs(false)}
        />
      )}

      {/* ─── Invite Modal ─── */}
      <GroupInviteModal
        isOpen={showInviteModal}
        onOpenChange={setShowInviteModal}
        inviteLink={inviteLink}
        inviteEmails={inviteEmails}
        inviteMessage={inviteMessage}
        sendingInvites={sendingInvites}
        pendingInvites={pendingInvites}
        inviteResults={inviteResults}
        invitesLoading={invitesLoading}
        revokingInvite={revokingInvite}
        onGenerateLink={handleGenerateInviteLink}
        onEmailsChange={setInviteEmails}
        onMessageChange={setInviteMessage}
        onSendInvites={handleSendInvites}
        onRevokeInvite={handleRevokeInvite}
        onCopyLink={(link) => { navigator.clipboard.writeText(link); toast.success(t('detail.link_copied')); }}
      />
    </motion.div>
  );
}

export default GroupDetailPage;
