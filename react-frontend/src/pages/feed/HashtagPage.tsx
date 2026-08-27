// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * HashtagPage - Displays posts for a specific hashtag
 *
 * Shows all feed posts tagged with a particular hashtag.
 * API: GET /api/v2/feed/hashtags/{tag}
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Hash from 'lucide-react/icons/hash';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import TrendingUp from 'lucide-react/icons/trending-up';
import Sparkles from 'lucide-react/icons/sparkles';
import Flag from 'lucide-react/icons/flag';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { PageMeta } from '@/components/seo';
import { EmptyState } from '@/components/feedback';
import { FeedCard } from '@/components/feed/FeedCard';
import { FeedSkeleton } from '@/components/feed/FeedSkeleton';
import type { FeedItem, PollData } from '@/components/feed/types';
import { getAuthor, excludeGamificationMilestones } from '@/components/feed/types';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { api } from '@/lib/api';
import { applyFeedSyncToItem, dispatchFeedSync, FEED_SYNC_EVENT, type FeedSyncPayload } from '@/lib/feedSync';
import { logError } from '@/lib/logger';
import type { ReactionType } from '@/components/social';

export function HashtagPage() {
  const { t } = useTranslation('feed');
  const { tag } = useParams<{ tag: string }>();
  const { tenantPath } = useTenant();
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();
  usePageTitle(tag ? `#${tag}` : t('hashtag.title'));

  // Report modal
  const { isOpen: isReportOpen, onOpen: onReportOpen, onClose: onReportClose } = useDisclosure();
  const [reportTarget, setReportTarget] = useState<{ id: number; type: FeedItem['type'] } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [postCount, setPostCount] = useState(0);
  const cursorRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const loadPosts = useCallback(async (append = false) => {
    if (!tag) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      const response = await api.get<FeedItem[]>(`/v2/feed/hashtags/${encodeURIComponent(tag)}?${params}`);
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const feedItems = Array.isArray(response.data) ? response.data : [];
        if (append) {
          setItems((prev) => [...prev, ...feedItems]);
        } else {
          setItems(feedItems);
        }
        setHasMore(response.meta?.has_more ?? false);
        cursorRef.current = response.meta?.cursor ?? undefined;
        if (response.meta?.total_items !== undefined) {
          setPostCount(response.meta.total_items);
        }
      } else {
        if (!append) setError(tRef.current('hashtag.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load hashtag posts', err);
      if (!append) setError(tRef.current('hashtag.load_failed'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [tag]);

  const loadPostsRef = useRef(loadPosts);
  loadPostsRef.current = loadPosts;

  useEffect(() => {
    cursorRef.current = undefined;
    setItems([]); // Clear previous tag's items so the user doesn't see stale posts during loading
    loadPostsRef.current(false);
    return () => { abortRef.current?.abort(); };
  }, [tag]);

  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<FeedSyncPayload>).detail;
      setItems((prev) =>
        prev.map((item) => applyFeedSyncToItem(item, payload))
      );
    };
    window.addEventListener(FEED_SYNC_EVENT, handler);
    return () => window.removeEventListener(FEED_SYNC_EVENT, handler);
  }, []);

  // Stable refs for toast/t so callbacks don't re-create when i18n loads.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Infinite scroll: auto-load when sentinel nears viewport
  const handleLoadMore = useCallback(() => { loadPostsRef.current(true); }, []);
  const infiniteScrollRef = useInfiniteScroll({
    hasMore,
    isLoading: isLoadingMore,
    onLoadMore: handleLoadMore,
  });

  // Pull-to-refresh: touch gesture on mobile
  const handlePullRefresh = useCallback(async () => { await loadPostsRef.current(false); }, []);
  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    enabled: !isLoading,
  });

  // Feed interactions — wrapped in useCallback to keep FeedCard's React.memo effective.
  const handleToggleLike = useCallback(async (item: FeedItem) => {
    const originalIsLiked = item.is_liked;
    const originalLikesCount = item.likes_count;
    setItems((prev) =>
      prev.map((fi) =>
        fi.id === item.id && fi.type === item.type
          ? {
              ...fi,
              is_liked: !originalIsLiked,
              likes_count: Math.max(0, originalLikesCount + (originalIsLiked ? -1 : 1)),
            }
          : fi
      )
    );
    try {
      const response = await api.post<{ action: 'liked' | 'unliked'; likes_count: number }>(
        '/v2/feed/like',
        { target_type: item.type, target_id: item.id }
      );
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Like toggle failed');
      }
      const nextPatch = {
        is_liked: response.data.action === 'liked',
        likes_count: response.data.likes_count,
      };
      setItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type ? { ...fi, ...nextPatch } : fi
        )
      );
      dispatchFeedSync({
        targetType: item.type,
        targetId: item.id,
        patch: nextPatch,
      });
    } catch (err) {
      logError('Failed to toggle like', err);
      setItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, is_liked: originalIsLiked, likes_count: originalLikesCount }
            : fi
        )
      );
      toastRef.current.error(tRef.current('toast.like_failed'));
    }
  }, []);

  const handleReact = useCallback(async (item: FeedItem, reactionType: ReactionType) => {
    const originalReactions = item.reactions;
    try {
      const response = await api.post<{ reactions: NonNullable<FeedItem['reactions']> }>('/v2/reactions', {
        target_type: item.type,
        target_id: item.id,
        reaction_type: reactionType,
      });
      if (!response.success || !response.data?.reactions) {
        throw new Error(response.error || 'Reaction failed');
      }
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
    } catch (err) {
      logError('Failed to react to feed item', err);
      setItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, reactions: originalReactions }
            : fi
        )
      );
      toastRef.current.error(tRef.current('toast.like_failed'));
    }
  }, []);

  const handleHidePost = useCallback(async (item: FeedItem) => {
    try {
      const res = await api.post(`/v2/feed/posts/${item.id}/hide`, { type: item.type });
      // api.post resolves { success:false } on a 4xx WITHOUT throwing — without gating on
      // it the post vanished from the list and a fake "hidden" toast showed while the
      // backend kept it (it reappeared on the next reload).
      if (res.success) {
        setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
        toastRef.current.success(tRef.current('toast.post_hidden'));
      } else {
        toastRef.current.error(tRef.current('toast.hide_failed'));
      }
    } catch (err) {
      logError('Failed to hide post', err);
      toastRef.current.error(tRef.current('toast.hide_failed'));
    }
  }, []);

  const handleMuteUser = useCallback(async (item: FeedItem) => {
    const userId = getAuthor(item).id;
    try {
      const res = await api.post(`/v2/feed/users/${userId}/mute`);
      // Gate on a confirmed mute — otherwise a { success:false } wiped EVERY post by
      // this user from the list with a fake "muted" toast while the backend muted nobody.
      if (res.success) {
        setItems((prev) => prev.filter((fi) => getAuthor(fi).id !== userId));
        toastRef.current.success(tRef.current('toast.user_muted'));
      } else {
        toastRef.current.error(tRef.current('toast.mute_failed'));
      }
    } catch (err) {
      logError('Failed to mute user', err);
      toastRef.current.error(tRef.current('toast.mute_failed'));
    }
  }, []);

  const handleDeletePost = useCallback(async (item: FeedItem) => {
    try {
      const res = await api.post(`/v2/feed/posts/${item.id}/delete`);
      if (res.success) {
        setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
        toastRef.current.success(tRef.current('toast.deleted'));
      } else {
        toastRef.current.error(tRef.current('toast.delete_failed'));
      }
    } catch (err) {
      logError('Failed to delete post', err);
      toastRef.current.error(tRef.current('toast.delete_failed'));
    }
  }, []);

  const handleVotePoll = useCallback(async (pollId: number, optionId: number) => {
    try {
      const response = await api.post<PollData>(`/v2/feed/polls/${pollId}/vote`, { option_id: optionId });
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
        toastRef.current.error(tRef.current('toast.vote_failed'));
      }
    } catch (err) {
      logError('Failed to vote', err);
      toastRef.current.error(tRef.current('toast.vote_failed'));
    }
  }, []);

  const openReportModal = useCallback((item: FeedItem) => {
    setReportTarget({ id: item.id, type: item.type });
    setReportReason('');
    onReportOpen();
  }, [onReportOpen]);

  const handleReport = async () => {
    if (!reportTarget || !reportReason.trim()) {
      toast.error(t('toast.provide_reason'));
      return;
    }
    try {
      setIsReporting(true);
      await api.post(`/v2/feed/items/${reportTarget.type}/${reportTarget.id}/report`, {
        reason: reportReason.trim(),
      });
      onReportClose();
      setReportTarget(null);
      setReportReason('');
      toast.success(t('toast.reported'));
    } catch (err) {
      logError('Failed to report post', err);
      toast.error(t('toast.report_failed'));
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <>
    <PageMeta
      title={tag ? `#${tag}` : t("hashtag.title")}
      description={t("hashtag.page_description", { tag: tag || "" })}
    />
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Pull-to-refresh indicator (mobile only) */}
      {(pullDistance > 0 || isRefreshing) && (
        <div className="flex h-12 items-center justify-center overflow-hidden sm:hidden">
          <RefreshCw
            className={`w-5 h-5 text-accent transition-opacity ${isRefreshing || pullDistance > 48 ? 'animate-spin opacity-100' : 'opacity-60'}`}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button as={Link} to={tenantPath('/feed')}
          isIconOnly
          variant="flat"
          className="bg-theme-elevated text-theme-muted"
          aria-label={t('hashtag.back_to_feed')}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-2">
            <Hash className="w-6 h-6 text-accent" aria-hidden="true" />
            {tag}
          </h1>
          {postCount > 0 && (
            <p className="text-sm text-theme-muted">
              {t('hashtag.post_count', { count: postCount })}
            </p>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('hashtag.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadPosts()}
          >
            {t('hashtag.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Feed Items */}
      {!error && (
        <>
          {isLoading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => <FeedSkeleton key={i} index={i} />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="w-12 h-12" aria-hidden="true" />}
              title={t('hashtag.no_posts')}
              description={t('hashtag.no_posts_desc', { tag })}
            />
          ) : (
            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {excludeGamificationMilestones(items).map((item) => (
                  <motion.div key={`${item.type}-${item.id}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} layout>
                    <FeedCard
                      item={item}
                      onToggleLike={handleToggleLike}
                      onHidePost={handleHidePost}
                      onMuteUser={handleMuteUser}
                      onReportPost={openReportModal}
                      onDeletePost={handleDeletePost}
                      onVotePoll={handleVotePoll}
                      onReact={handleReact}
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

              {/* Manual fallback button for users without IO support / for accessibility */}
              {hasMore && !isLoadingMore && (
                <div className="pt-6 pb-2 text-center">
                  <Button
                    variant="bordered"
                    className="border-[var(--border-default)] text-[var(--text-muted)]"
                    onPress={() => loadPosts(true)}
                    startContent={<TrendingUp className="w-4 h-4" aria-hidden="true" />}
                  >
                    {t('hashtag.load_more')}
                  </Button>
                </div>
              )}

              {/* Pagination loading indicator */}
              {isLoadingMore && (
                <div className="space-y-4 pt-2">
                  {[0, 1].map((i) => <FeedSkeleton key={`load-more-skeleton-${i}`} index={i} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>

    {/* Report Post Modal */}
    <Modal
      isOpen={isReportOpen}
      onClose={onReportClose}
      classNames={{
        base: 'bg-[var(--surface-dropdown)] border border-[var(--border-default)]',
        backdrop: 'bg-black/60 backdrop-blur-sm',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-3 text-[var(--text-primary)]">
          <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center">
            <Flag className="w-4 h-4 text-danger" aria-hidden="true" />
          </div>
          <ModalHeading>{t('report.title')}</ModalHeading>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-[var(--text-muted)] mb-3">
            {t('report.description')}
          </p>
          <Textarea
            label={t('report.reason_label')}
            placeholder={t('report.reason_placeholder')}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            minRows={3}
            classNames={{
              input: 'bg-transparent text-[var(--text-primary)]',
              inputWrapper: 'bg-[var(--surface-elevated)] border-[var(--border-default)]',
            }}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="flat"
            onPress={() => {
              onReportClose();
              setReportTarget(null);
            }}
            className="text-[var(--text-muted)]"
          >
            {t('report.cancel')}
          </Button>
          <Button
            color="danger"
            variant="flat"
            onPress={handleReport}
            isLoading={isReporting}
            isDisabled={!reportReason.trim()}
            className="font-medium"
          >
            {t('report.submit')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    </>
  );
}

export default HashtagPage;
