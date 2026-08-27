// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Separator } from '@/components/ui/Separator';
import { Skeleton } from '@/components/ui/Skeleton';
/**
 * ProfileFeed — displays a user's activity feed on their profile page.
 * Reuses FeedCard from the main feed system for consistent rendering.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

import Rss from 'lucide-react/icons/rss';
import ChevronDown from 'lucide-react/icons/chevron-down';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { motion, AnimatePresence } from '@/lib/motion';
import { useTranslation } from 'react-i18next';
import { FeedCard } from '@/components/feed/FeedCard';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast } from '@/contexts';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { api } from '@/lib/api';
import { applyFeedSyncToItem, dispatchFeedSync, FEED_SYNC_EVENT, type FeedSyncPayload } from '@/lib/feedSync';
import { logError } from '@/lib/logger';
import type { FeedItem, PollData } from '@/components/feed/types';
import { excludeGamificationMilestones } from '@/components/feed/types';
import type { ReactionType } from '@/components/social';

interface ProfileFeedProps {
  userId: number;
  isOwnProfile?: boolean;
}

function FeedSkeleton() {
  return (
    <GlassCard className="p-5">
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
  );
}

export function ProfileFeed({ userId, isOwnProfile = false }: ProfileFeedProps) {
  const { t } = useTranslation('profile');
  const { user, isAuthenticated } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const loadFeed = useCallback(async (cursor?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const isInitial = !cursor;
      if (isInitial) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams({
        user_id: String(userId),
        per_page: '20',
      });
      if (cursor) params.set('cursor', cursor);

      const response = await api.get<FeedItem[]>(`/v2/feed?${params.toString()}`);

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const feedItems = Array.isArray(response.data) ? response.data : [];
        if (isInitial) {
          setItems(feedItems);
        } else {
          setItems((prev) => [...prev, ...feedItems]);
        }
        cursorRef.current = response.meta?.cursor ?? undefined;
        setHasMore(response.meta?.has_more ?? false);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load profile feed', err);
      if (!cursor) setError(tRef.current('feed_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [userId]);

  const loadFeedRef = useRef(loadFeed);
  loadFeedRef.current = loadFeed;

  useEffect(() => {
    cursorRef.current = undefined;
    setItems([]);
    loadFeedRef.current();
    return () => {
      abortRef.current?.abort();
    };
  }, [userId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent<FeedSyncPayload>).detail;
      setItems((prev) => prev.map((item) => applyFeedSyncToItem(item, payload)));
    };

    window.addEventListener(FEED_SYNC_EVENT, handler);
    return () => window.removeEventListener(FEED_SYNC_EVENT, handler);
  }, []);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Infinite scroll: auto-load when sentinel nears viewport
  const handleLoadMore = useCallback(() => {
    if (cursorRef.current) loadFeedRef.current(cursorRef.current);
  }, []);
  const infiniteScrollRef = useInfiniteScroll({
    hasMore,
    isLoading: isLoadingMore,
    onLoadMore: handleLoadMore,
  });

  // Pull-to-refresh: touch gesture on mobile
  const handlePullRefresh = useCallback(async () => { await loadFeedRef.current(); }, []);
  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    enabled: !isLoading,
  });

  // --- Feed action handlers (matching FeedPage patterns).
  // Wrapped in useCallback so FeedCard's React.memo isn't defeated by inline arrows.

  const handleToggleLike = useCallback(async (item: FeedItem) => {
    if (!isAuthenticated) return;
    const originalIsLiked = item.is_liked;
    const originalLikesCount = item.likes_count;
    const optimisticIsLiked = !originalIsLiked;
    const optimisticLikesCount = Math.max(0, originalLikesCount + (originalIsLiked ? -1 : 1));
    setItems((prev) =>
      prev.map((fi) =>
        fi.id === item.id && fi.type === item.type
          ? {
              ...fi,
              is_liked: optimisticIsLiked,
              likes_count: optimisticLikesCount,
            }
          : fi
      )
    );
    try {
      const response = await api.post<{ action?: string; likes_count: number }>('/v2/feed/like', {
        target_type: item.type,
        target_id: item.id,
      });
      if (response.success && response.data) {
        const serverLiked = response.data.action === 'liked'
          ? true
          : response.data.action === 'unliked'
            ? false
            : optimisticIsLiked;
        const serverLikesCount = response.data.likes_count;
        setItems((prev) =>
          prev.map((fi) =>
            fi.id === item.id && fi.type === item.type
              ? { ...fi, is_liked: serverLiked, likes_count: serverLikesCount }
              : fi
          )
        );
        dispatchFeedSync({
          targetType: item.type,
          targetId: item.id,
          patch: { is_liked: serverLiked, likes_count: serverLikesCount },
        });
      }
    } catch (err) {
      logError('Failed to toggle like', err);
      // Rollback
      setItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? {
                ...fi,
                is_liked: originalIsLiked,
                likes_count: originalLikesCount,
              }
            : fi
        )
      );
      toastRef.current.error(tRef.current('like_failed'));
    }
  }, [isAuthenticated]);

  const handleReact = useCallback(async (item: FeedItem, reactionType: ReactionType) => {
    if (!isAuthenticated) return;

    const previousReactions = item.reactions ?? { counts: {}, total: 0, user_reaction: null, top_reactors: [] };
    try {
      const response = await api.post<{ reactions: FeedItem['reactions'] }>('/v2/reactions', {
        target_type: item.type,
        target_id: item.id,
        reaction_type: reactionType,
      });
      if (response.success && response.data?.reactions) {
        const reactions = response.data.reactions;
        setItems((prev) =>
          prev.map((fi) =>
            fi.id === item.id && fi.type === item.type
              ? { ...fi, reactions }
              : fi
          )
        );
        dispatchFeedSync({
          targetType: item.type,
          targetId: item.id,
          patch: { reactions },
        });
      }
    } catch (err) {
      logError('Failed to react', err);
      setItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, reactions: previousReactions }
            : fi
        )
      );
    }
  }, [isAuthenticated]);

  const handleHidePost = useCallback(async (item: FeedItem) => {
    try {
      const res = await api.post(`/v2/feed/posts/${item.id}/hide`, { type: item.type });
      // api.post resolves { success:false } on a 4xx WITHOUT throwing — without gating
      // on it the post vanished from the list and a fake "hidden" toast showed while the
      // backend kept it (it reappeared on the next reload).
      if (res.success) {
        setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
        toastRef.current.success(tRef.current('post_hidden'));
      } else {
        toastRef.current.error(tRef.current('hide_failed'));
      }
    } catch (err) {
      logError('Failed to hide post', err);
      toastRef.current.error(tRef.current('hide_failed'));
    }
  }, []);

  const handleVotePoll = useCallback(async (pollId: number, optionId: number) => {
    try {
      const response = await api.post<PollData>(`/v2/feed/polls/${pollId}/vote`, {
        option_id: optionId,
      });
      if (response.success && response.data) {
        setItems((prev) =>
          prev.map((fi) =>
            fi.id === pollId && fi.type === 'poll'
              ? { ...fi, poll_data: response.data as PollData }
              : fi
          )
        );
      } else {
        // Surface a rejected vote instead of silently doing nothing.
        toastRef.current.error(tRef.current('vote_failed'));
      }
    } catch (err) {
      logError('Failed to vote', err);
      toastRef.current.error(tRef.current('vote_failed'));
    }
  }, []);

  // Delete behaviour mirrors FeedPage: only feed posts have a polymorphic
  // /v2/feed/posts/{id}/delete endpoint. For non-post types (listing, event,
  // goal, poll, etc.) we hide the item from the feed rather than deleting the
  // underlying entity — that matches the user's expectation when clicking
  // "Remove from feed" from a profile timeline and avoids destroying records
  // that have their own dedicated delete flows.
  const handleDeletePost = useCallback(async (item: FeedItem) => {
    if (item.type !== 'post') {
      // Inline the hide flow to avoid coupling to the other useCallback's identity.
      try {
        const res = await api.post(`/v2/feed/posts/${item.id}/hide`, { type: item.type });
        if (res.success) {
          setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
          toastRef.current.success(tRef.current('post_hidden'));
        } else {
          toastRef.current.error(tRef.current('hide_failed'));
        }
      } catch (err) {
        logError('Failed to hide post', err);
        toastRef.current.error(tRef.current('hide_failed'));
      }
      return;
    }
    try {
      const res = await api.post(`/v2/feed/posts/${item.id}/delete`);
      // Gate the removal + "deleted" toast on a confirmed delete — a { success:false }
      // (already deleted / not owned / rate-limited) otherwise made the post vanish with
      // a fake "deleted" confirmation while the backend kept it.
      if (res.success) {
        setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
        toastRef.current.success(tRef.current('post_deleted'));
      } else {
        toastRef.current.error(tRef.current('delete_failed'));
      }
    } catch (err) {
      logError('Failed to delete post', err);
      toastRef.current.error(tRef.current('delete_failed'));
    }
  }, []);

  // --- Render ---

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <FeedSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertTriangle className="w-10 h-10 text-[var(--color-warning)] mx-auto mb-3" aria-hidden="true" />
        <p className="text-theme-muted mb-4">{error}</p>
        <Button
          variant="flat"
          className="bg-theme-elevated text-theme-primary"
          startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
          onPress={() => void loadFeed()}
        >
          {t('retry')}
        </Button>
      </GlassCard>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Rss className="w-10 h-10" aria-hidden="true" />}
        title={t('no_activity_title')}
        description={
          isOwnProfile
            ? t('no_activity_own')
            : t('no_activity_other')
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Pull-to-refresh indicator (mobile only) */}
      {(pullDistance > 0 || isRefreshing) && (
        <div className="flex h-12 items-center justify-center overflow-hidden sm:hidden">
          <RefreshCw
            className={`w-5 h-5 text-accent transition-opacity ${isRefreshing || pullDistance > 48 ? 'animate-spin opacity-100' : 'opacity-60'}`}
            aria-hidden="true"
          />
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {excludeGamificationMilestones(items).map((item) => (
          <motion.div key={`${item.type}-${item.id}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} layout>
            <FeedCard
              item={item}
              onToggleLike={handleToggleLike}
              onReact={handleReact}
              onHidePost={handleHidePost}
              onDeletePost={handleDeletePost}
              onVotePoll={handleVotePoll}
              feedMode="recent"
              isAuthenticated={isAuthenticated}
              currentUserId={user?.id}
              currentUserAvatar={user?.avatar}
              currentUserName={user?.first_name || user?.name}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Infinite scroll sentinel */}
      {hasMore && <div ref={infiniteScrollRef} className="h-1" aria-hidden="true" />}

      {hasMore && !isLoadingMore && (
        <div className="pt-6 pb-2 text-center">
          <Button
            variant="bordered"
            className="border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
            onPress={() => void loadFeed(cursorRef.current)}
            startContent={<ChevronDown className="w-4 h-4" aria-hidden="true" />}
          >
            {t('load_more')}
          </Button>
        </div>
      )}

      {isLoadingMore && (
        <div className="space-y-4 pt-2">
          {[1, 2].map((i) => <FeedSkeleton key={`load-more-${i}`} />)}
        </div>
      )}
    </div>
  );
}
