// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PostDetailPage - View a single feed item by ID.
 *
 * Supports two routes:
 *   /feed/posts/:id            — legacy, treats target as a feed post
 *   /feed/item/:type/:id       — polymorphic (listing/event/poll/goal/etc.)
 *
 * APIs:
 *   GET /api/v2/feed/posts/{id}            (post-only, legacy)
 *   GET /api/v2/feed/items/{type}/{id}     (any reactable feed item)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Flag from 'lucide-react/icons/flag';
import Newspaper from 'lucide-react/icons/newspaper';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { FeedCard } from '@/components/feed/FeedCard';
import { FeedSkeleton } from '@/components/feed/FeedSkeleton';
import type { FeedItem, PollData } from '@/components/feed/types';
import { getAuthor } from '@/components/feed/types';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { applyFeedSyncToItem, dispatchFeedSync, FEED_SYNC_EVENT, type FeedSyncPayload } from '@/lib/feedSync';
import type { ReactionType } from '@/components/social';

// Reactable feed-item types supported by the polymorphic backend endpoint.
// Must stay in sync with the allowlist in SocialController::showItem.
const POLYMORPHIC_TYPES = new Set<FeedItem['type']>([
  'post', 'listing', 'event', 'poll', 'goal', 'review',
  'volunteer', 'challenge', 'resource', 'blog', 'discussion', 'job',
]);

export function PostDetailPage() {
  const { t } = useTranslation('feed');
  const { id, type: typeParam } = useParams<{ id: string; type?: string }>();
  const [searchParams] = useSearchParams();
  const { tenantPath } = useTenant();
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  usePageTitle(t('post_detail.title'));

  // Resolve target type from either route segment (/feed/item/:type/:id)
  // or query string (?type=listing on the legacy /feed/posts/:id route).
  // Falls back to 'post' for backward compat with the original detail URL.
  const queryType = searchParams.get('type');
  const rawType = typeParam ?? queryType ?? 'post';
  const itemType: FeedItem['type'] = POLYMORPHIC_TYPES.has(rawType as FeedItem['type'])
    ? (rawType as FeedItem['type'])
    : 'post';

  // Report modal
  const { isOpen: isReportOpen, onOpen: onReportOpen, onClose: onReportClose } = useDisclosure();
  const [reportTarget, setReportTarget] = useState<{ id: number; type: FeedItem['type'] } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  const [item, setItem] = useState<FeedItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    // Use polymorphic endpoint for non-post types (listings, events, polls, etc.)
    // Posts continue to hit the existing /v2/feed/posts/{id} route for back-compat.
    const url = itemType === 'post'
      ? `/v2/feed/posts/${id}`
      : `/v2/feed/items/${itemType}/${id}`;

    api.get<FeedItem>(url)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.success && response.data) {
          setItem(response.data);
        } else {
          setError(t('post_detail.not_found'));
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        logError('Failed to load feed item', err);
        setError(t('post_detail.load_failed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => { abortRef.current?.abort(); };
  }, [id, itemType, t]);

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent<FeedSyncPayload>).detail;
      setItem((prev) => prev ? applyFeedSyncToItem(prev, payload) : prev);
    };

    window.addEventListener(FEED_SYNC_EVENT, handler);
    return () => window.removeEventListener(FEED_SYNC_EVENT, handler);
  }, []);

  // Handlers wrapped in useCallback so FeedCard's React.memo isn't defeated by
  // inline arrows being recreated every render.
  const handleToggleLike = useCallback(async (feedItem: FeedItem) => {
    const newIsLiked = !feedItem.is_liked;
    const newLikesCount = newIsLiked ? feedItem.likes_count + 1 : feedItem.likes_count - 1;
    setItem((prev) => prev ? { ...prev, is_liked: newIsLiked, likes_count: newLikesCount } : null);
    try {
      const response = await api.post<{ action?: string; likes_count: number }>('/v2/feed/like', { target_type: feedItem.type, target_id: feedItem.id });
      if (response.success && response.data) {
        const serverLiked = response.data.action === 'liked'
          ? true
          : response.data.action === 'unliked'
            ? false
            : newIsLiked;
        const serverLikesCount = response.data.likes_count;
        setItem((prev) => prev ? { ...prev, is_liked: serverLiked, likes_count: serverLikesCount } : null);
        dispatchFeedSync({ targetType: feedItem.type, targetId: feedItem.id, patch: { is_liked: serverLiked, likes_count: serverLikesCount } });
      }
    } catch (err) {
      logError('Failed to toggle like', err);
      setItem((prev) => prev ? { ...prev, is_liked: feedItem.is_liked, likes_count: feedItem.likes_count } : null);
    }
  }, []);

  const handleReact = useCallback(async (feedItem: FeedItem, reactionType: ReactionType) => {
    const previousReactions = feedItem.reactions ?? { counts: {}, total: 0, user_reaction: null, top_reactors: [] };
    try {
      const response = await api.post<{ reactions: FeedItem['reactions'] }>('/v2/reactions', {
        target_type: feedItem.type,
        target_id: feedItem.id,
        reaction_type: reactionType,
      });
      if (response.success && response.data?.reactions) {
        const reactions = response.data.reactions;
        setItem((prev) => prev ? { ...prev, reactions } : null);
        dispatchFeedSync({ targetType: feedItem.type, targetId: feedItem.id, patch: { reactions } });
      }
    } catch (err) {
      logError('Failed to react', err);
      setItem((prev) => prev ? { ...prev, reactions: previousReactions } : null);
    }
  }, []);

  const handleHidePost = useCallback(async (feedItem: FeedItem) => {
    try {
      await api.post(`/v2/feed/posts/${feedItem.id}/hide`, { type: feedItem.type });
      navigate(tenantPath('/feed'));
    } catch (err) {
      logError('Failed to hide post', err);
      toast.error(t('toast.hide_failed'));
    }
  }, [navigate, tenantPath, toast, t]);

  const handleMuteUser = useCallback(async (feedItem: FeedItem) => {
    const authorId = getAuthor(feedItem).id;
    if (!authorId) return;
    try {
      await api.post(`/v2/feed/users/${authorId}/mute`);
      toast.success(t('toast.user_muted'));
      navigate(tenantPath('/feed'));
    } catch (err) {
      logError('Failed to mute user', err);
      toast.error(t('toast.mute_failed'));
    }
  }, [navigate, tenantPath, toast, t]);

  const openReportModal = useCallback((feedItem: FeedItem) => {
    setReportTarget({ id: feedItem.id, type: feedItem.type });
    setReportReason('');
    onReportOpen();
  }, [onReportOpen]);

  const handleReport = useCallback(async () => {
    if (!reportTarget || !reportReason.trim()) {
      toast.error(t('toast.provide_reason'));
      return;
    }
    try {
      setIsReporting(true);
      const reportPath = reportTarget.type === 'post'
        ? `/v2/feed/posts/${reportTarget.id}/report`
        : `/v2/feed/items/${reportTarget.type}/${reportTarget.id}/report`;
      await api.post(reportPath, {
        reason: reportReason.trim(),
        target_type: reportTarget.type,
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
  }, [reportTarget, reportReason, onReportClose, toast, t]);

  const handleDeletePost = useCallback(async (feedItem: FeedItem) => {
    try {
      await api.post(`/v2/feed/posts/${feedItem.id}/delete`);
      toast.success(t('toast.deleted'));
      navigate(tenantPath('/feed'));
    } catch (err) {
      logError('Failed to delete post', err);
      toast.error(t('toast.delete_failed'));
    }
  }, [navigate, tenantPath, toast, t]);

  const handleVotePoll = useCallback(async (pollId: number, optionId: number) => {
    try {
      const response = await api.post<PollData>(`/v2/feed/polls/${pollId}/vote`, { option_id: optionId });
      if (response.success && response.data) {
        setItem((prev) => prev && prev.id === pollId && prev.type === 'poll'
          ? { ...prev, poll_data: response.data }
          : prev
        );
      }
    } catch (err) {
      logError('Failed to vote on poll', err);
      toast.error(t('toast.vote_failed'));
    }
  }, [toast, t]);

  const handleNotInterested = useCallback(async (feedItem: FeedItem) => {
    try {
      await api.post(`/v2/feed/posts/${feedItem.id}/not-interested`, { type: feedItem.type });
      toast.success(t('toast.not_interested'));
      navigate(tenantPath('/feed'));
    } catch (err) {
      logError('Failed to record not-interested', err);
    }
  }, [toast, t, navigate, tenantPath]);

  return (
    <>
      <PageMeta
        title={item?.content?.substring(0, 60) || t('post_detail.title')}
        description={item?.content?.substring(0, 160)}
        noIndex
      />
      <div className="space-y-4 max-w-2xl mx-auto">
        <div>
          <Button as={Link} to={tenantPath('/feed')}
            variant="light"
            startContent={<ArrowLeft className="w-4 h-4" />}
            className="text-theme-muted hover:text-theme-primary -ml-2"
          >
            {t('post_detail.back')}
          </Button>
        </div>

        {/* The page's heading (WCAG 2.4.6), in the same soft panel in the
            community colour that opens the feed's other pages. */}
        <PublicPageHero
          size="compact"
          title={t('post_detail.title')}
          icon={<Newspaper className="h-6 w-6" aria-hidden="true" />}
        />

        {isLoading ? (
          <FeedSkeleton />
        ) : error ? (
          <GlassCard className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
            <p className="text-theme-muted">{error}</p>
            <Button as={Link} to={tenantPath('/feed')} variant="flat" className="mt-4 inline-block bg-theme-elevated text-theme-primary">
              {t('post_detail.back')}
            </Button>
          </GlassCard>
        ) : item ? (
          <FeedCard
            item={item}
            onToggleLike={handleToggleLike}
            onReact={handleReact}
            onHidePost={handleHidePost}
            onMuteUser={handleMuteUser}
            onReportPost={openReportModal}
            onDeletePost={handleDeletePost}
            onNotInterested={handleNotInterested}
            onVotePoll={handleVotePoll}
            feedMode="recent"
            isAuthenticated={isAuthenticated}
            currentUserId={user?.id}
            currentUserAvatar={user?.avatar}
            currentUserName={user?.first_name || user?.name}
            defaultShowComments
          />
        ) : null}
      </div>

      {/* Report Post Modal */}
      <Modal
        isOpen={isReportOpen}
        onClose={() => {
          onReportClose();
          setReportTarget(null);
          setReportReason('');
        }}
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
                setReportReason('');
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

export default PostDetailPage;
