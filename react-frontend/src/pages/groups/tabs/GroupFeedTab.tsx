// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Separator } from '@/components/ui/Separator';
import { Skeleton } from '@/components/ui/Skeleton';
/**
 * Group Feed Tab
 * Displays the group activity feed with create-post prompt, feed cards, and load-more.
 */

import { motion, AnimatePresence } from '@/lib/motion';

import Lock from 'lucide-react/icons/lock';
import Newspaper from 'lucide-react/icons/newspaper';
import Plus from 'lucide-react/icons/plus';
import TrendingUp from 'lucide-react/icons/trending-up';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useCallback } from 'react';
import { resolveAvatarUrl } from '@/lib/helpers';
import { FeedCard } from '@/components/feed/FeedCard';
import type { FeedItem } from '@/components/feed/types';
import { getAuthor, excludeGamificationMilestones } from '@/components/feed/types';
import type { ReactionType } from '@/components/social';

interface GroupFeedTabProps {
  isMember: boolean;
  isJoining: boolean;
  feedItems: FeedItem[];
  feedLoading: boolean;
  feedHasMore: boolean;
  feedLoadingMore: boolean;
  onJoinLeave: () => void;
  onComposeOpen: () => void;
  onLoadMore: () => void;
  /** Optional pull-to-refresh handler — when provided, mobile pull gesture refreshes the feed */
  onRefresh?: () => void | Promise<void>;
  onToggleLike: (item: FeedItem) => void;
  onReact: (item: FeedItem, reactionType: ReactionType) => void;
  onHidePost: (item: FeedItem) => void;
  onMuteUser: (userId: number) => void;
  onReportPost: (postId: number) => void;
  onDeletePost: (item: FeedItem) => void;
  onVotePoll: (pollId: number, optionId: number) => void;
}

export function GroupFeedTab({
  isMember,
  isJoining,
  feedItems,
  feedLoading,
  feedHasMore,
  feedLoadingMore,
  onJoinLeave,
  onComposeOpen,
  onLoadMore,
  onRefresh,
  onToggleLike,
  onReact,
  onHidePost,
  onMuteUser,
  onReportPost,
  onDeletePost,
  onVotePoll,
}: GroupFeedTabProps) {
  const { t } = useTranslation('groups');
  const { user: currentUser, isAuthenticated } = useAuth();

  // Infinite scroll: auto-trigger onLoadMore when sentinel hits viewport.
  const handleLoadMore = useCallback(() => onLoadMore(), [onLoadMore]);
  const infiniteScrollRef = useInfiniteScroll({
    hasMore: feedHasMore,
    isLoading: feedLoadingMore,
    onLoadMore: handleLoadMore,
  });

  // Pull-to-refresh (mobile only) — no-op when no onRefresh callback supplied.
  const handlePullRefresh = useCallback(async () => { if (onRefresh) await onRefresh(); }, [onRefresh]);
  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    enabled: Boolean(onRefresh) && !feedLoading,
  });

  if (!isMember) {
    return (
      <GlassCard className="p-6 sm:p-8">
        <EmptyState
          icon={<Lock className="w-12 h-12" aria-hidden="true" />}
          title={t('detail.join_to_see_feed_title')}
          description={t('detail.join_to_see_feed_desc')}
          action={
            isAuthenticated && (
              <Button
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                onPress={onJoinLeave}
                isLoading={isJoining}
              >
                {t('detail.join_group')}
              </Button>
            )
          }
        />
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pull-to-refresh indicator (mobile only, only when onRefresh wired) */}
      {onRefresh && (pullDistance > 0 || isRefreshing) && (
        <div className="flex h-12 items-center justify-center overflow-hidden sm:hidden">
          <RefreshCw
            className={`w-5 h-5 text-accent transition-opacity ${isRefreshing || pullDistance > 48 ? 'animate-spin opacity-100' : 'opacity-60'}`}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Create Post Button */}
      {isAuthenticated && (
        <GlassCard
          className="p-3 transition-colors hover:border-[var(--color-primary)]/20 sm:p-4"
          onClick={onComposeOpen}
          role="button"
          tabIndex={0}
          aria-label={t('detail.feed_create_post_aria')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onComposeOpen();
            }
          }}
        >
          <div className="flex items-center gap-3">
            <Avatar
              name={currentUser?.first_name || t('detail.you')}
              src={resolveAvatarUrl(currentUser?.avatar)}
              size="sm"
              isBordered
              className="ring-2 ring-[var(--border-default)]"
            />
            <div className="min-w-0 flex-1 truncate rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm text-[var(--text-subtle)] transition-colors hover:border-[var(--color-primary)]/30">
              {t('detail.feed_whats_on_your_mind')}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Feed Items */}
      {feedLoading && feedItems.length === 0 ? (
        <div role="status" aria-busy="true" aria-label={t('detail.feed_loading')} className="space-y-4">
          {[1, 2, 3].map((i) => (
            <GlassCard key={i} className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-28 rounded mb-2" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              </div>
              <Skeleton className="h-4 w-full rounded mb-2" />
              <Skeleton className="h-4 w-4/5 rounded mb-4" />
              <Separator />
              <div className="flex gap-4 pt-3">
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </GlassCard>
          ))}
        </div>
      ) : feedItems.length === 0 ? (
        <GlassCard className="p-6 sm:p-8">
          <EmptyState
            icon={<Newspaper className="w-12 h-12" aria-hidden="true" />}
            title={t('detail.feed_empty_title')}
            description={t('detail.feed_empty_desc')}
            action={
              isAuthenticated && (
                <Button
                  className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                  startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                  onPress={onComposeOpen}
                >
                  {t('detail.feed_create_post')}
                </Button>
              )
            }
          />
        </GlassCard>
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {excludeGamificationMilestones(feedItems).map((item) => (
              <motion.div key={`${item.type}-${item.id}`} layout>
                <FeedCard
                  item={item}
                  onToggleLike={() => onToggleLike(item)}
                  onReact={(feedItem, reactionType) => onReact(feedItem, reactionType)}
                  onHidePost={() => onHidePost(item)}
                  onMuteUser={() => onMuteUser(getAuthor(item).id)}
                  onReportPost={() => onReportPost(item.id)}
                  onDeletePost={() => onDeletePost(item)}
                  onVotePoll={onVotePoll}
                  feedMode="recent"
                  isAuthenticated={isAuthenticated}
                  currentUserId={currentUser?.id}
                  currentUserAvatar={currentUser?.avatar}
                  currentUserName={currentUser?.first_name || currentUser?.name}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Infinite scroll sentinel */}
          {feedHasMore && <div ref={infiniteScrollRef} className="h-1" aria-hidden="true" />}

          {feedHasMore && !feedLoadingMore && (
            <div className="pt-4 text-center">
              <Button
                variant="bordered"
                className="border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                onPress={onLoadMore}
                startContent={<TrendingUp className="w-4 h-4" aria-hidden="true" />}
              >
                {t('detail.feed_load_more')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
