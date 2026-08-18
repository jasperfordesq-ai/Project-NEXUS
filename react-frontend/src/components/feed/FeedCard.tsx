// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FeedCard — renders an individual feed item with content, actions, comments, and polls.
 * Extracted from FeedPage.tsx for maintainability.
 */

import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import {
  Link } from 'react-router-dom';
import { motion,
  AnimatePresence } from '@/lib/motion';

import { Avatar } from '@/components/ui/Avatar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ConfettiCelebration } from '@/components/ui/ConfettiCelebration';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Separator } from '@/components/ui/Separator';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import Heart from 'lucide-react/icons/heart';
import MessageCircle from 'lucide-react/icons/message-circle';
import MoreHorizontal from 'lucide-react/icons/ellipsis';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import VolumeX from 'lucide-react/icons/volume-x';
import Flag from 'lucide-react/icons/flag';
import Trash2 from 'lucide-react/icons/trash-2';
import Check from 'lucide-react/icons/check';
import Star from 'lucide-react/icons/star';
import Clock from 'lucide-react/icons/clock';
import TrendingUp from 'lucide-react/icons/trending-up';
import BarChart3 from 'lucide-react/icons/chart-column';
import Target from 'lucide-react/icons/target';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Calendar from 'lucide-react/icons/calendar';
import MapPin from 'lucide-react/icons/map-pin';
import ArrowRight from 'lucide-react/icons/arrow-right';
import BookOpen from 'lucide-react/icons/book-open';
import Users from 'lucide-react/icons/users';
import Trophy from 'lucide-react/icons/trophy';
import Zap from 'lucide-react/icons/zap';
import Pencil from 'lucide-react/icons/pencil';
import ThumbsDown from 'lucide-react/icons/thumbs-down';
import Landmark from 'lucide-react/icons/landmark';
import PodcastIcon from 'lucide-react/icons/podcast';
import { useTranslation } from 'react-i18next';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { dispatchFeedSync } from '@/lib/feedSync';
import { resolveAvatarUrl, resolveThumbnailUrl, formatRelativeTime, formatDate, formatTime, getFormattingLocale } from '@/lib/helpers';
import { useFeedTracking } from '@/hooks/useFeedTracking';
import { useSharedFeedObserver } from '@/hooks/useSharedFeedObserver';
import { useLongPress } from '@/hooks/useLongPress';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSocialInteractions } from '@/hooks/useSocialInteractions';
import type { FeedItem, PollData } from './types';
import { getAuthor, getItemDetailPath, getItemDetailLabel } from './types';
import { WhyShown } from './WhyShown';
import { FeedContentRenderer } from './FeedContentRenderer';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { ReactionPicker, type ReactionType } from '@/components/social/ReactionPicker';
import { ReactionSummary } from '@/components/social/ReactionSummary';
import { DeferredUserHoverCard } from '@/components/social/DeferredUserHoverCard';
import { ShareButton, SharedByAttribution } from './ShareButton';
import { BookmarkButton } from '@/components/social/BookmarkButton';
import { safePodcastArtworkUrl } from '@/lib/podcasts/artwork';

const CommentsSection = lazy(() => import('@/components/social/CommentsSection').then((module) => ({ default: module.CommentsSection })));
const PostAnalyticsModal = lazy(() => import('./PostAnalyticsModal').then((module) => ({ default: module.PostAnalyticsModal })));
const ImageCarousel = lazy(() => import('./ImageCarousel').then((module) => ({ default: module.ImageCarousel })));
const MediaGrid = lazy(() => import('./MediaGrid').then((module) => ({ default: module.MediaGrid })));
const VideoPlayer = lazy(() => import('./VideoPlayer').then((module) => ({ default: module.VideoPlayer })));
const LinkPreviewCard = lazy(() => import('@/components/social/LinkPreviewCard').then((module) => ({ default: module.LinkPreviewCard })));
const QuotedPostEmbed = lazy(() => import('./QuotedPostEmbed').then((module) => ({ default: module.QuotedPostEmbed })));

function FeedMediaFallback() {
  return <div className="mx-5 aspect-video rounded-xl bg-theme-elevated" aria-hidden="true" />;
}

function FeedPreviewFallback() {
  return <div className="h-24 rounded-xl border border-theme-default bg-theme-elevated" aria-hidden="true" />;
}

/* ───────────────────────── Props ───────────────────────── */

export interface FeedCardProps {
  item: FeedItem;
  /** Called with the feed item when the user toggles the like button (legacy). */
  onToggleLike: (item: FeedItem) => void;
  /** Called when the user reacts to a post with an emoji reaction. */
  onReact?: (item: FeedItem, reactionType: ReactionType) => void;
  /** Called with the feed item when the user hides a post. */
  onHidePost: (item: FeedItem) => void;
  /** Called with the feed item when the user mutes the post author. Omit to hide the menu option. */
  onMuteUser?: (item: FeedItem) => void;
  /** Called with the feed item when the user reports a post. Omit to hide the menu option. */
  onReportPost?: (item: FeedItem) => void;
  /** Called with the feed item when the user deletes their own post. */
  onDeletePost: (item: FeedItem) => void;
  /** Called with the feed item when an admin deletes any post. */
  onAdminDeletePost?: (item: FeedItem) => void;
  /** Called with the feed item when the user wants to edit their own post. */
  onEditPost?: (item: FeedItem) => void;
  /** Called when the user marks a post as "not interested" (algorithm feedback). */
  onNotInterested?: (item: FeedItem) => void;
  onVotePoll: (pollId: number, optionId: number) => void;
  /** Current feed mode — used for "Why shown" explainer (only in ranking mode) */
  feedMode?: 'ranking' | 'recent';
  isAuthenticated: boolean;
  currentUserId?: number;
  currentUserAvatar?: string | null;
  currentUserName?: string | null;
  /** Whether the current user is an admin (shows admin delete on all posts). */
  isAdmin?: boolean;
  /** If true, comments section is open and loaded immediately on mount. */
  defaultShowComments?: boolean;
}

/* ───────────────────────── Type Badge Config ───────────────────────── */

/**
 * Item types the backend `BookmarkService` accepts.
 * MUST stay in sync with `app/Services/BookmarkService.php::VALID_TYPES`.
 */
const BOOKMARKABLE_TYPES = new Set<FeedItem['type']>([
  'post',
  'listing',
  'event',
  'job',
  'blog',
  'discussion',
]);

/**
 * Item types the backend `ShareService` accepts for polymorphic reposting.
 * MUST stay in sync with `app/Services/ShareService.php::VALID_TYPES`.
 * Milestones (badge_earned, level_up) and reviews are not repostable.
 */
const SHAREABLE_TYPES = new Set<FeedItem['type']>([
  'post',
  'listing',
  'event',
  'poll',
  'job',
  'blog',
  'discussion',
  'goal',
  'challenge',
  'volunteer',
]);

/**
 * Feed item types that support emoji reactions.
 * MUST stay in sync with `App\Services\ReactionService::VALID_TARGET_TYPES`.
 *
 * Notification-style cards (`badge_earned`, `level_up`) are not user-authored
 * content and are intentionally excluded — there is no entity to react against.
 */
const REACTABLE_FEED_TYPES = new Set<string>([
  'post',
  'listing',
  'event',
  'goal',
  'poll',
  'review',
  'volunteer',
  'challenge',
  'resource',
  'job',
  'blog',
  'discussion',
]);

const COMMENTABLE_TYPES = new Set<FeedItem['type']>([
  'post',
  'listing',
  'event',
  'goal',
  'poll',
  'review',
  'volunteer',
  'challenge',
  'job',
  'blog',
  'discussion',
  'resource',
]);

/**
 * Per-type card config.
 * - `softGradient` is used for the subtle body tint (e.g. view-detail CTA, milestone card backgrounds).
 * - `accentGradient` is the saturated top accent strip — matches the pattern established by the poll card redesign.
 */
const fallbackTypeConfig = {
  labelKey: null,
  color: 'default' as const,
  icon: null,
  softGradient: '',
  accentGradient: 'from-[var(--border-default)] via-[var(--border-subtle)] to-[var(--border-default)]',
};

const typeConfig = {
  post: {
    labelKey: null,
    color: 'default' as const,
    icon: null,
    softGradient: '',
    // Neutral strip on post cards — keeps every feed card visually matched
    // without implying a "type" colour (posts have no type chip).
    accentGradient: 'from-[var(--border-default)] via-[var(--border-subtle)] to-[var(--border-default)]',
  },
  listing: {
    labelKey: 'card.type_listing',
    color: 'primary' as const,
    icon: <ShoppingBag className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-accent/10 to-blue-500/10',
    accentGradient: 'from-accent via-blue-500 to-accent-gradient-end',
  },
  event: {
    labelKey: 'card.type_event',
    color: 'success' as const,
    icon: <Calendar className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-emerald-500/10 to-green-500/10',
    accentGradient: 'from-emerald-500 via-green-500 to-emerald-500',
  },
  poll: {
    labelKey: 'card.type_poll',
    color: 'warning' as const,
    icon: <BarChart3 className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-amber-500/10 to-orange-500/10',
    accentGradient: 'from-amber-500 via-orange-500 to-amber-500',
  },
  goal: {
    labelKey: 'card.type_goal',
    color: 'secondary' as const,
    icon: <Target className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-accent/10 to-pink-500/10',
    accentGradient: 'from-accent via-pink-500 to-accent-gradient-end',
  },
  review: {
    labelKey: 'card.type_review',
    color: 'warning' as const,
    icon: <Star className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-amber-500/10 to-yellow-500/10',
    accentGradient: 'from-amber-500 via-yellow-500 to-amber-500',
  },
  job: {
    labelKey: 'card.type_job',
    color: 'primary' as const,
    icon: <TrendingUp className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-blue-500/10 to-cyan-500/10',
    accentGradient: 'from-blue-500 via-cyan-500 to-blue-500',
  },
  challenge: {
    labelKey: 'card.type_challenge',
    color: 'secondary' as const,
    icon: <Target className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-violet-500/10 to-accent-gradient-end/10',
    accentGradient: 'from-violet-500 via-accent-gradient-end to-violet-500',
  },
  volunteer: {
    labelKey: 'card.type_volunteer',
    color: 'success' as const,
    icon: <Heart className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-green-500/10 to-emerald-500/10',
    accentGradient: 'from-green-500 via-emerald-500 to-green-500',
  },
  volunteer_hours: {
    labelKey: 'card.type_volunteer_hours',
    color: 'success' as const,
    icon: <Clock className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-green-500/10 to-emerald-500/10',
    accentGradient: 'from-emerald-500 via-green-500 to-emerald-500',
  },
  blog: {
    labelKey: 'card.type_blog',
    color: 'primary' as const,
    icon: <BookOpen className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-sky-500/10 to-blue-500/10',
    accentGradient: 'from-sky-500 via-blue-500 to-sky-500',
  },
  discussion: {
    labelKey: 'card.type_discussion',
    color: 'secondary' as const,
    icon: <Users className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-fuchsia-500/10 to-accent-gradient-end/10',
    accentGradient: 'from-fuchsia-500 via-accent-gradient-end to-fuchsia-500',
  },
  resource: {
    labelKey: 'card.type_resource',
    color: 'primary' as const,
    icon: <BookOpen className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-teal-500/10 to-cyan-500/10',
    accentGradient: 'from-teal-500 via-cyan-500 to-teal-500',
  },
  badge_earned: {
    labelKey: 'card.type_badge_earned',
    color: 'warning' as const,
    icon: <Trophy className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-yellow-500/10 to-amber-500/10',
    accentGradient: 'from-yellow-500 via-amber-500 to-yellow-500',
  },
  level_up: {
    labelKey: 'card.type_level_up',
    color: 'success' as const,
    icon: <Zap className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-emerald-500/10 to-teal-500/10',
    accentGradient: 'from-emerald-500 via-teal-500 to-emerald-500',
  },
  course: {
    labelKey: 'card.type_course',
    color: 'primary' as const,
    icon: <BookOpen className="w-3 h-3" aria-hidden="true" />,
    softGradient: 'from-accent/10 to-violet-500/10',
    accentGradient: 'from-accent via-violet-500 to-accent-gradient-end',
  },
  podcast_show: {
    labelKey: 'card.type_podcast_show',
    color: 'primary' as const,
    icon: <PodcastIcon className="h-3 w-3" aria-hidden="true" />,
    softGradient: 'from-fuchsia-500/10 to-violet-500/10',
    accentGradient: 'from-fuchsia-500 via-violet-500 to-fuchsia-500',
  },
  podcast_episode: {
    labelKey: 'card.type_podcast_episode',
    color: 'secondary' as const,
    icon: <PodcastIcon className="h-3 w-3" aria-hidden="true" />,
    softGradient: 'from-violet-500/10 to-blue-500/10',
    accentGradient: 'from-violet-500 via-blue-500 to-violet-500',
  },
};

/* ────────────── Heart Overlay (double-tap to like) ────────────── */

function HeartOverlay({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="heart-overlay"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1.2, opacity: 1 }}
          exit={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          aria-hidden="true"
        >
          <Heart className="w-20 h-20 text-white fill-white drop-shadow-lg" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Hook to detect double-tap / double-click on an element.
 * Returns a click handler and a ref for the timeout.
 */
function useDoubleTap(onDoubleTap: () => void, delay = 300) {
  const lastTapRef = useRef<number>(0);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < delay) {
      lastTapRef.current = 0;
      onDoubleTap();
    } else {
      lastTapRef.current = now;
    }
  }, [onDoubleTap, delay]);

  return handleTap;
}

/* ───────────────────────── Feed Card ───────────────────────── */

const FeedCard = React.memo(function FeedCard({
  item,
  onToggleLike,
  onReact,
  onHidePost,
  onMuteUser,
  onReportPost,
  onDeletePost,
  onAdminDeletePost,
  onEditPost,
  onNotInterested,
  onVotePoll,
  feedMode = 'ranking',
  isAuthenticated,
  currentUserId,
  currentUserAvatar,
  currentUserName,
  isAdmin,
  defaultShowComments = false,
}: FeedCardProps) {
  const { t } = useTranslation('feed');
  const { t: tSocial } = useTranslation('social');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [showComments, setShowComments] = useState(defaultShowComments);
  // Native-app comments: phones open a bottom sheet instead of expanding the
  // card inline. Detail pages (defaultShowComments) keep the inline section so
  // comments stay visible without an extra tap.
  const isPhone = useMediaQuery('(max-width: 639px)');
  const useSheetForComments = isPhone && !defaultShowComments;
  const [isCommentsSheetOpen, setIsCommentsSheetOpen] = useState(false);
  const social = useSocialInteractions({
    targetType: item.type,
    targetId: item.id,
    enabled: isAuthenticated,
    initialLiked: item.is_liked,
    initialLikesCount: item.likes_count,
    initialCommentsCount: item.comments_count,
  });
  const [pollData, setPollData] = useState<PollData | null>(item.poll_data ?? null);
  const [isLoadingPoll, setIsLoadingPoll] = useState(false);
  const [pollLoadError, setPollLoadError] = useState(false);

  useEffect(() => {
    if (item.type === 'poll' && item.poll_data) {
      setPollData(item.poll_data);
      setPollLoadError(false);
    }
  }, [item.type, item.poll_data]);

  // AG38 — swap original text with translated text in place
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const itemLocale = (item as { locale?: string | null; content_locale?: string | null }).locale
    ?? (item as { content_locale?: string | null }).content_locale
    ?? null;

  // Double-tap to like
  const [showHeartOverlay, setShowHeartOverlay] = useState(false);
  const heartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bottom sheet for mobile options menu
  const [isOptionsSheetOpen, setIsOptionsSheetOpen] = useState(false);

  // Long-press to open options on mobile
  const longPressHandlers = useLongPress({
    onLongPress: () => { if (isAuthenticated) setIsOptionsSheetOpen(true); },
  });

  const handleDoubleTapLike = useCallback(() => {
    if (!isAuthenticated) return;
    // Only like if not already liked
    if (!item.is_liked) {
      onToggleLike(item);
    }
    // Always show the heart animation
    setShowHeartOverlay(true);
    if (heartTimeoutRef.current) clearTimeout(heartTimeoutRef.current);
    heartTimeoutRef.current = setTimeout(() => setShowHeartOverlay(false), 800);
  }, [isAuthenticated, item, onToggleLike]);

  const doubleTapHandler = useDoubleTap(handleDoubleTapLike);

  // Clean up heart timeout on unmount
  useEffect(() => {
    return () => {
      if (heartTimeoutRef.current) clearTimeout(heartTimeoutRef.current);
    };
  }, []);

  // Post analytics modal
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Confetti celebration for milestone feed items (badge_earned, level_up)
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiTriggeredRef = useRef(false);
  const confettiTimeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // H6: Mounted guard — prevents setState calls after unmount
  // Clean up confetti timeouts on unmount
  useEffect(() => {
    return () => {
      confettiTimeoutRefs.current.forEach(clearTimeout);
    };
  }, []);

  // View tracking — fire once per session per post when entering viewport.
  // Uses the shared IntersectionObserver so a 50-card feed registers ONE observer
  // for all view-tracking instead of 50 separate ones.
  const viewTrackedRef = useRef(false);

  // Reset tracking flag whenever the item changes.
  useEffect(() => {
    viewTrackedRef.current = false;
  }, [item.id, item.type]);

  const handleViewEntry = useCallback(
    (entry: IntersectionObserverEntry) => {
      if (!entry.isIntersecting || viewTrackedRef.current) return;
      viewTrackedRef.current = true;
      if (item.type === 'post') {
        api.post(`/v2/feed/posts/${item.id}/view`).catch(() => {});
      }

      // Trigger confetti for milestone items on first view
      const isMilestone = item.type === 'badge_earned' || item.type === 'level_up';
      if (isMilestone && !confettiTriggeredRef.current) {
        confettiTriggeredRef.current = true;
        const t1 = setTimeout(() => { setShowConfetti(true); }, 300);
        const t2 = setTimeout(() => {
          setShowConfetti(false);
          confettiTimeoutRefs.current = confettiTimeoutRefs.current.filter(id => id !== t1 && id !== t2);
        }, 2000);
        confettiTimeoutRefs.current.push(t1, t2);
      }
    },
    [item.id, item.type]
  );

  const setViewRef = useSharedFeedObserver(handleViewEntry, { threshold: 0.5 });

  const author = getAuthor(item, t('author_unknown'));
  const isOwnPost = currentUserId === author.id;
  const canViewAnalytics = isOwnPost && item.type === 'post';
  const isCommentable = COMMENTABLE_TYPES.has(item.type);
  // Keep the route usable if an API feed type arrives before a cached client
  // learns its presentation. Unknown items render neutrally instead of taking
  // down the whole feed through an undefined configuration lookup.
  const config = typeConfig[item.type] ?? fallbackTypeConfig;
  const typeLabel = config.labelKey ? t(config.labelKey) : null;
  const detailPath = getItemDetailPath(item);
  const detailLabel = getItemDetailLabel(item);
  const imageUrl = item.type === 'podcast_show' || item.type === 'podcast_episode'
    ? safePodcastArtworkUrl(item.image_url)
    : item.image_url;
  // Volunteer-hours activity is system-generated, so its stored title is a
  // non-localised fallback; render a localised title from the hours instead.
  const displayTitle = item.type === 'volunteer_hours' && item.hours != null
    ? t('card.volunteer_hours_title', { hours: item.hours, organization: item.organization ?? '' })
    : item.title;
  const { ref: trackingRef, recordClick } = useFeedTracking(item.id, item.type, isAuthenticated);

  // Load poll data lazily ONLY when the item is a poll, poll_data was NOT
  // provided inline, and we haven't already loaded or started loading it.
  useEffect(() => {
    if (item.type === 'poll' && !item.poll_data && !pollData && !isLoadingPoll && !pollLoadError) {
      setIsLoadingPoll(true);
      api.get<PollData>(`/v2/feed/polls/${item.id}`)
        .then((response) => {
          if (response.success && response.data) {
            setPollData(response.data);
          } else {
            setPollLoadError(true);
          }
        })
        .catch((err) => {
          logError('Failed to load poll', err);
          setPollLoadError(true);
        })
        .finally(() => setIsLoadingPoll(false));
    }
  }, [item.type, item.id, item.poll_data, pollData, isLoadingPoll, pollLoadError]);

  const handleVote = (optionId: number) => {
    if (!pollData) return;
    const pollExpired = pollData.expires_at && new Date(pollData.expires_at) < new Date();
    if (pollExpired) {
      toast.error(t('poll.expired'));
      return;
    }
    onVotePoll(item.id, optionId);
  };

  const toggleComments = () => {
    if (useSheetForComments) {
      setIsCommentsSheetOpen(true);
    } else {
      setShowComments(!showComments);
    }
  };

  return (
    <GlassCard ref={(el: HTMLDivElement | null) => { trackingRef(el); setViewRef(el); }} role="article" hoverable className="overflow-visible group relative">
      {/* Long-press touch target for mobile context menu */}
      <div onTouchStart={longPressHandlers.onTouchStart} onTouchMove={longPressHandlers.onTouchMove} onTouchEnd={longPressHandlers.onTouchEnd}>
      {/* Confetti celebration overlay for milestones */}
      <ConfettiCelebration show={showConfetti} />

      {/*
        Accent strip on every card. Typed cards use their saturated type colour
        (green=event, amber=poll, etc.); native posts use a neutral border-coloured
        strip so every card has matching anatomy in the feed.
      */}
      {config.accentGradient && (
        <div className={`h-1 bg-gradient-to-r ${config.accentGradient}`} aria-hidden="true" />
      )}

      <div className="p-5">
        {/*
          Shared-by attribution — rendered when this feed item appears in the
          viewer's feed because someone they know reposted it. Backend populates
          `shared_by` via post_shares join.
        */}
        {item.shared_by && (
          <div className="mb-3">
            <SharedByAttribution user={item.shared_by} />
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <DeferredUserHoverCard userId={author.id}>
              <Link to={tenantPath(`/profile/${author.id}`)} className="relative">
                <Avatar
                  name={author.name}
                  src={resolveAvatarUrl(author.avatar)}
                  size="md"
                  className="ring-2 ring-[var(--border-default)] group-hover:ring-accent/30 transition-all"
                  isBordered
                />
              </Link>
            </DeferredUserHoverCard>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DeferredUserHoverCard userId={author.id}>
                  <Link
                    to={tenantPath(`/profile/${author.id}`)}
                    className="font-semibold text-theme-primary hover:text-accent transition-colors text-sm truncate"
                  >
                    {author.name}
                  </Link>
                </DeferredUserHoverCard>
                {typeLabel && (
                  detailPath ? (
                    <Link to={tenantPath(detailPath)} onClick={recordClick}>
                      <Chip
                        size="sm"
                        variant="flat"
                        color={config.color}
                        startContent={config.icon}
                        className="text-[10px] h-5 cursor-pointer hover:opacity-80 transition-opacity"
                      >
                        {typeLabel}
                      </Chip>
                    </Link>
                  ) : (
                    <Chip
                      size="sm"
                      variant="flat"
                      color={config.color}
                      startContent={config.icon}
                      className="text-[10px] h-5"
                    >
                      {typeLabel}
                    </Chip>
                  )
                )}
                {/* AG14: Official badge — shown when posted by a municipality_announcer */}
                {item.is_official && (
                  <Chip
                    size="sm"
                    variant="flat"
                    startContent={<Landmark className="w-3 h-3" aria-hidden="true" />}
                    className="text-[10px] h-5 bg-accent/15 text-accent dark:text-accent border border-accent/30"
                  >
                    {t('feed.official_badge', { ns: 'common' })}
                  </Chip>
                )}
                {/* Scheduling indicator — visible only to the post author */}
                {item.publish_status === 'scheduled' && isOwnPost && item.scheduled_at && (
                  <Tooltip content={new Date(item.scheduled_at).toLocaleString(getFormattingLocale())} placement="bottom" delay={300} closeDelay={0} size="sm">
                    <Chip
                      size="sm"
                      variant="flat"
                      color="warning"
                      startContent={<Clock className="w-3 h-3" aria-hidden="true" />}
                      className="text-[10px] h-5"
                    >
                      {t('card.scheduled')}
                    </Chip>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Tooltip content={new Date(item.created_at).toLocaleString(getFormattingLocale())} placement="bottom" delay={500} closeDelay={0} size="sm">
                  <p className="text-xs text-theme-subtle flex items-center gap-1 cursor-default">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    <span>
                      {formatRelativeTime(item.created_at)}
                      {item.updated_at && item.updated_at !== item.created_at && (
                        <span className="italic"> · {t('card.edited')}</span>
                      )}
                    </span>
                  </p>
                </Tooltip>
                <WhyShown item={item} feedMode={feedMode} />
              </div>
            </div>
          </div>

          {/* 3-dot moderation menu — Dropdown on desktop, BottomSheet on mobile */}
          {isAuthenticated && (
            <>
              {/* Desktop: HeroUI Dropdown */}
              <div className="hidden sm:block">
                <Dropdown placement="bottom-end">
                  <DropdownTrigger>
                    <Button
                      isIconOnly
                      variant="light"
                      className="size-11 min-h-11 min-w-11 p-0 text-theme-subtle hover:text-theme-primary opacity-100 pointer-coarse:opacity-100 any-pointer-coarse:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:focus-visible:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                      aria-label={t('card.post_options')}
                    >
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu aria-label={t('card.post_actions')}>
                    {isOwnPost ? (
                      <>
                        {canViewAnalytics && (
                          <DropdownItem
                            key="analytics" id="analytics"
                            startContent={<BarChart3 className="w-4 h-4" aria-hidden="true" />}
                            onPress={() => setShowAnalytics(true)}
                          >
                            {t('card.view_analytics')}
                          </DropdownItem>
                        )}
                        {onEditPost && item.type === 'post' && (
                          <DropdownItem
                            key="edit" id="edit"
                            startContent={<Pencil className="w-4 h-4" aria-hidden="true" />}
                            onPress={() => onEditPost(item)}
                          >
                            {t('card.edit_post')}
                          </DropdownItem>
                        )}
                        {item.type === 'post' && (
                          <DropdownItem
                            key="delete" id="delete"
                            startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                            className="text-danger"
                            color="danger"
                            onPress={() => onDeletePost(item)}
                          >
                            {t('card.delete_post')}
                          </DropdownItem>
                        )}
                      </>
                    ) : (
                      <>
                        {!item.is_official && (
                          <DropdownItem
                            key="hide" id="hide"
                            startContent={<EyeOff className="w-4 h-4" aria-hidden="true" />}
                            onPress={() => onHidePost(item)}
                          >
                            {t('card.hide_post')}
                          </DropdownItem>
                        )}
                        {onNotInterested && (
                          <DropdownItem
                            key="not-interested" id="not-interested"
                            startContent={<ThumbsDown className="w-4 h-4" aria-hidden="true" />}
                            onPress={() => onNotInterested(item)}
                          >
                            {t('card.not_interested')}
                          </DropdownItem>
                        )}
                        {onMuteUser && (
                          <DropdownItem
                            key="mute" id="mute"
                            startContent={<VolumeX className="w-4 h-4" aria-hidden="true" />}
                            onPress={() => onMuteUser(item)}
                          >
                            {t('card.mute_user', { name: author.name })}
                          </DropdownItem>
                        )}
                        {onReportPost && (
                          <DropdownItem
                            key="report" id="report"
                            startContent={<Flag className="w-4 h-4" aria-hidden="true" />}
                            className="text-danger"
                            color="danger"
                            onPress={() => onReportPost(item)}
                          >
                            {t('card.report_post')}
                          </DropdownItem>
                        )}
                        {isAdmin && onAdminDeletePost && (
                          <DropdownItem
                            key="admin-delete" id="admin-delete"
                            startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                            className="text-danger"
                            color="danger"
                            onPress={() => onAdminDeletePost(item)}
                          >
                            {t('card.admin_delete')}
                          </DropdownItem>
                        )}
                      </>
                    )}
                  </DropdownMenu>
                </Dropdown>
              </div>

              {/* Mobile: Button that opens BottomSheet */}
              <Button
                isIconOnly
                variant="light"
                className="size-11 min-h-11 min-w-11 p-0 sm:hidden text-theme-subtle hover:text-theme-primary"
                aria-label={t('card.post_options')}
                onPress={() => setIsOptionsSheetOpen(true)}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>

              {/* Mobile BottomSheet for post options */}
              <BottomSheet
                isOpen={isOptionsSheetOpen}
                onClose={() => setIsOptionsSheetOpen(false)}
                title={t('card.post_options')}
                snapPoints={['auto']}
              >
                <div className="flex flex-col gap-1 [&_.button]:min-h-11">
                  {isOwnPost ? (
                    <>
                      {canViewAnalytics && (
                        <Button
                          variant="light"
                          className="justify-start text-theme-primary"
                          startContent={<BarChart3 className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => { setIsOptionsSheetOpen(false); setShowAnalytics(true); }}
                        >
                          {t('card.view_analytics')}
                        </Button>
                      )}
                      {onEditPost && item.type === 'post' && (
                        <Button
                          variant="light"
                          className="justify-start text-theme-primary"
                          startContent={<Pencil className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => { setIsOptionsSheetOpen(false); onEditPost(item); }}
                        >
                          {t('card.edit_post')}
                        </Button>
                      )}
                      {item.type === 'post' && (
                        <Button
                          variant="light"
                          className="justify-start text-danger"
                          startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => { setIsOptionsSheetOpen(false); onDeletePost(item); }}
                        >
                          {t('card.delete_post')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      {!item.is_official && (
                        <Button
                          variant="light"
                          className="justify-start text-theme-primary"
                          startContent={<EyeOff className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => { setIsOptionsSheetOpen(false); onHidePost(item); }}
                        >
                          {t('card.hide_post')}
                        </Button>
                      )}
                      {onNotInterested && (
                        <Button
                          variant="light"
                          className="justify-start text-theme-primary"
                          startContent={<ThumbsDown className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => { setIsOptionsSheetOpen(false); onNotInterested(item); }}
                        >
                          {t('card.not_interested')}
                        </Button>
                      )}
                      {onMuteUser && (
                        <Button
                          variant="light"
                          className="justify-start text-theme-primary"
                          startContent={<VolumeX className="w-4 h-4" aria-hidden="true" />}
                          aria-label={t('card.mute_user_label', { name: author.name ?? '' })}
                          onPress={() => { setIsOptionsSheetOpen(false); onMuteUser(item); }}
                        >
                          {t('card.mute_user', { name: author.name })}
                        </Button>
                      )}
                      {onReportPost && (
                        <Button
                          variant="light"
                          className="justify-start text-danger"
                          startContent={<Flag className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => { setIsOptionsSheetOpen(false); onReportPost(item); }}
                        >
                          {t('card.report_post')}
                        </Button>
                      )}
                      {isAdmin && onAdminDeletePost && (
                        <Button
                          variant="light"
                          className="justify-start text-danger"
                          startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => { setIsOptionsSheetOpen(false); onAdminDeletePost(item); }}
                        >
                          {t('card.admin_delete')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </BottomSheet>
            </>
          )}
        </div>

        {/* Content */}
        <div className="mb-4">
          {displayTitle && displayTitle !== item.content && (
            detailPath ? (
              <Link
                to={tenantPath(detailPath)}
                className="text-sm font-semibold text-theme-primary hover:text-accent transition-colors mb-1.5 block"
                onClick={recordClick}
              >
                {displayTitle}
              </Link>
            ) : (
              <p className="text-sm font-semibold text-theme-primary mb-1.5">{displayTitle}</p>
            )
          )}
          <FeedContentRenderer
            content={translatedContent ?? item.content}
            truncated={item.content_truncated}
            detailPath={detailPath ? tenantPath(detailPath) : undefined}
            postTitle={item.title ?? undefined}
          />
          {item.content && (
            <div className="mt-1">
              <TranslateButton
                contentType={`feed_${item.type ?? 'post'}`}
                contentId={item.id}
                sourceText={item.content}
                sourceLocale={itemLocale}
                onTextChange={(_text, isTranslated) => {
                  setTranslatedContent(isTranslated ? _text : null);
                }}
              />
            </div>
          )}
        </div>

        {/* Link Previews */}
        {item.link_previews && item.link_previews.length > 0 && (
          <div className={`mb-4 ${item.link_previews.length > 1 ? 'space-y-2' : ''}`}>
            <Suspense fallback={<FeedPreviewFallback />}>
              {item.link_previews.map((lp) => (
                <LinkPreviewCard
                  key={lp.url}
                  preview={lp}
                  compact={item.link_previews!.length > 1}
                />
              ))}
            </Suspense>
          </div>
        )}
        {/* Quoted Post Embed (quote repost) */}
        {item.quoted_post && (
          <div className="mb-4">
            <Suspense fallback={<FeedPreviewFallback />}>
              <QuotedPostEmbed post={item.quoted_post} />
            </Suspense>
          </div>
        )}

        {/* Event: calendar-page date chip + countdown + location. Listing: date + location only. */}
        {(item.type === 'event' || item.type === 'listing' || item.type === 'volunteer') && (item.start_date || item.location) && (() => {
          const isEvent = item.type === 'event';
          const startMs = item.start_date ? new Date(item.start_date).getTime() : null;
          const deltaMs = startMs != null ? startMs - Date.now() : null;
          const isUpcoming = deltaMs != null && deltaMs > 0;
          const isImminent = isUpcoming && deltaMs! < 48 * 3600 * 1000;
          const countdown = (() => {
            if (!isImminent || deltaMs == null) return null;
            const hours = Math.floor(deltaMs / 3600000);
            const minutes = Math.floor(deltaMs / 60000);
            if (minutes < 60) return t('card.event.starts_in_minutes', { minutes });
            return t('card.event.starts_in_hours', { hours });
          })();
          const dateForChip = item.start_date ? new Date(item.start_date) : null;

          return (
            <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-theme-muted">
              {/* Event-only: calendar-page date chip */}
              {isEvent && dateForChip && (
                <div className="flex items-center gap-2.5">
                  <div className="flex flex-col items-center justify-center rounded-lg overflow-hidden border border-theme-default bg-[var(--surface-base)] w-11 h-12 shadow-sm" aria-hidden="true">
                    <div className="w-full px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-emerald-500 to-green-500 text-white text-center leading-tight">
                      {dateForChip.toLocaleString(getFormattingLocale(), { month: 'short' })}
                    </div>
                    <div className="flex-1 flex items-center justify-center text-lg font-bold tabular-nums text-theme-primary leading-none">
                      {dateForChip.getDate()}
                    </div>
                  </div>
                  <div className="flex flex-col text-xs">
                    <span className="text-theme-primary font-medium">
                      {formatDate(item.start_date!, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span className="text-theme-subtle">{formatTime(item.start_date!)}</span>
                  </div>
                </div>
              )}

              {/* Non-event types keep the simpler inline date */}
              {!isEvent && item.start_date && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                  <span>{formatDate(item.start_date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  <span className="text-theme-subtle">{formatTime(item.start_date)}</span>
                </span>
              )}

              {/* Countdown pill for imminent events */}
              {isEvent && countdown && (
                <Chip
                  size="sm"
                  variant="flat"
                  color="success"
                  startContent={<Clock className="w-3 h-3" aria-hidden="true" />}
                  className="h-6 text-[11px] font-medium"
                >
                  {countdown}
                </Chip>
              )}

              {item.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                  <span className="truncate">{item.location}</span>
                </span>
              )}
            </div>
          );
        })()}

        {/* Job-specific chips: job_type (paid/volunteer/timebank), commitment, location */}
        {item.type === 'job' && (item.job_type || item.commitment || item.location) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            {item.job_type && (
              <Chip
                size="sm"
                variant="flat"
                color="primary"
                startContent={<TrendingUp className="w-3 h-3" aria-hidden="true" />}
                className="h-6 text-[11px] font-medium"
              >
                {t(`card.job.type_${item.job_type}`)}
              </Chip>
            )}
            {item.commitment && (
              <Chip
                size="sm"
                variant="flat"
                color="default"
                startContent={<Clock className="w-3 h-3" aria-hidden="true" />}
                className="h-6 text-[11px] font-medium"
              >
                {t(`card.job.commitment_${item.commitment}`)}
              </Chip>
            )}
            {item.location && (
              <span className="flex items-center gap-1.5 text-theme-muted">
                <MapPin className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                <span className="truncate">{item.location}</span>
              </span>
            )}
          </div>
        )}

        {/* Volunteer-specific chips: credits_offered + organization */}
        {item.type === 'volunteer' && (item.credits_offered != null || item.organization) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            {item.credits_offered != null && item.credits_offered > 0 && (
              <Chip
                size="sm"
                variant="flat"
                color="success"
                startContent={<Clock className="w-3 h-3" aria-hidden="true" />}
                className="h-6 text-[11px] font-medium"
              >
                {t('card.volunteer.credits_offered', { count: item.credits_offered })}
              </Chip>
            )}
            {item.organization && (
              <span className="flex items-center gap-1.5 text-theme-muted">
                <Users className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                <span className="truncate">{item.organization}</span>
              </span>
            )}
          </div>
        )}

        {/* Challenge-specific chips: submission deadline + ideas count */}
        {item.type === 'challenge' && (item.submission_deadline || item.ideas_count != null) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            {item.submission_deadline && (() => {
              const deadlineMs = new Date(item.submission_deadline).getTime() - Date.now();
              const isClosingSoon = deadlineMs > 0 && deadlineMs < 72 * 3600 * 1000;
              return (
                <Chip
                  size="sm"
                  variant="flat"
                  color={isClosingSoon ? 'warning' : 'secondary'}
                  startContent={<Clock className="w-3 h-3" aria-hidden="true" />}
                  className="h-6 text-[11px] font-medium"
                >
                  {isClosingSoon
                    ? t('card.challenge.closing_soon')
                    : t('card.challenge.closes_on', {
                        date: formatDate(item.submission_deadline!, { month: 'short', day: 'numeric' }),
                      })}
                </Chip>
              );
            })()}
            {item.ideas_count != null && item.ideas_count > 0 && (
              <Chip
                size="sm"
                variant="flat"
                color="default"
                startContent={<Target className="w-3 h-3" aria-hidden="true" />}
                className="h-6 text-[11px] font-medium"
              >
                {t('card.challenge.ideas_count', { count: item.ideas_count })}
              </Chip>
            )}
          </div>
        )}

        {/* Media: Multi-image carousel/grid, single image/video, or placeholder */}
        {/* Wrapped with double-tap-to-like detection */}
        {item.media && item.media.length > 1 ? (
          /* Multi-media: use grid for 2-4, carousel for 5+ */
          <div
            className="mb-4 -mx-5 overflow-hidden relative"
            onClick={doubleTapHandler}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doubleTapHandler(); } }}
            role="button"
            tabIndex={0}
            aria-label={t('card.like_action')}
          >
            <HeartOverlay show={showHeartOverlay} />
            <Suspense fallback={<FeedMediaFallback />}>
              {item.media.length <= 4 ? (
                <MediaGrid media={item.media} className="mx-5" />
              ) : (
                <ImageCarousel media={item.media} className="mx-5" />
              )}
            </Suspense>
          </div>
        ) : item.media && item.media.length === 1 && item.media[0] ? (
          /* Single media item — use VideoPlayer for video, ImageCarousel for image */
          <div
            className="mb-4 -mx-5 overflow-hidden relative"
            onClick={doubleTapHandler}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doubleTapHandler(); } }}
            role="button"
            tabIndex={0}
            aria-label={t('card.like_action')}
          >
            <HeartOverlay show={showHeartOverlay} />
            <Suspense fallback={<FeedMediaFallback />}>
              {item.media[0].media_type === 'video' ? (
                <VideoPlayer media={item.media[0]} className="mx-5" />
              ) : (
                <ImageCarousel media={item.media} className="mx-5" />
              )}
            </Suspense>
          </div>
        ) : imageUrl ? (
          <div
            className="mb-4 -mx-5 overflow-hidden relative"
            onClick={detailPath ? undefined : doubleTapHandler}
            onKeyDown={detailPath ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doubleTapHandler(); } }}
            role={detailPath ? undefined : 'button'}
            tabIndex={detailPath ? undefined : 0}
            aria-label={detailPath ? undefined : t('card.like_action')}
          >
            <HeartOverlay show={showHeartOverlay} />
            {detailPath ? (
              <Link to={tenantPath(detailPath)} onClick={doubleTapHandler}>
                <img
                  src={resolveThumbnailUrl(imageUrl, { width: 960, height: 540 })}
                  alt={t('card.image_alt', { type: typeLabel ?? t('card.type_post'), name: author.name })}
                  className="w-full max-h-[28rem] object-cover group-hover:scale-[1.02] transition-transform duration-500"
                  loading="lazy"
                  width={800}
                  height={448}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </Link>
            ) : (
              <img
                src={resolveThumbnailUrl(imageUrl, { width: 960, height: 540 })}
                alt={t('card.image_alt', { type: t('card.type_post'), name: author.name })}
                className="w-full max-h-[28rem] object-cover group-hover:scale-[1.02] transition-transform duration-500"
                loading="lazy"
                width={800}
                height={448}
              />
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 pointer-events-none" aria-hidden="true" />
          </div>
        ) : null}

        {/* Poll Display */}
        {item.type === 'poll' && (
          <div className="mb-4">
            {isLoadingPoll ? (
              <div className="rounded-2xl border border-theme-default bg-theme-elevated overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-amber-500/40 via-orange-500/40 to-amber-500/40" />
                <div className="p-5 space-y-3">
                  <Skeleton className="h-6 w-3/4 rounded-lg" />
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            ) : pollLoadError ? (
              <div className="rounded-2xl border border-theme-default bg-theme-elevated p-5 text-center">
                <BarChart3 className="w-8 h-8 mx-auto mb-2 text-theme-subtle" aria-hidden="true" />
                <p className="text-sm text-theme-muted">{t('poll.load_failed')}</p>
              </div>
            ) : pollData ? (
              (() => {
                const now = new Date();
                const pollExpired = !!(pollData.expires_at && new Date(pollData.expires_at) < now);
                const hasVoted = pollData.user_vote_option_id !== null;
                const showResults = hasVoted || pollExpired;
                const totalVotes = pollData.total_votes ?? 0;
                // Backend hides per-option counts on OPEN polls for non-creators
                // (prevents results from influencing remaining voters). In that case
                // total_votes is null even though the user has voted.
                const resultsHidden = showResults && pollData.total_votes == null;

                // Identify leading option when results are visible
                const leadingOptionId = showResults
                  ? pollData.options.reduce<number | null>((lead, opt) => {
                      if (opt.percentage == null) return lead;
                      const leadOpt = pollData.options.find((o) => o.id === lead);
                      const leadPct = leadOpt?.percentage ?? -1;
                      return opt.percentage > leadPct ? opt.id : lead;
                    }, pollData.options[0]?.id ?? null)
                  : null;

                const timeRemaining = (() => {
                  if (!pollData.expires_at || pollExpired) return null;
                  const ms = new Date(pollData.expires_at).getTime() - now.getTime();
                  const hours = Math.floor(ms / 3600000);
                  const minutes = Math.floor(ms / 60000);
                  if (minutes < 60) return t('poll.closes_minutes', { minutes });
                  if (hours < 24) return t('poll.closes_hours', { hours });
                  const days = Math.floor(hours / 24);
                  return t('poll.closes_days', { days });
                })();

                const pollDetailPath = tenantPath('/polls');

                return (
                  <div className="rounded-2xl border border-theme-default bg-theme-elevated overflow-hidden shadow-sm">
                    {/* Gradient accent bar */}
                    <div className={`h-1 bg-gradient-to-r ${pollExpired ? 'from-gray-400/30 to-gray-500/30' : 'from-amber-500 via-orange-500 to-amber-500'}`} />

                    {/* Header: pill + status */}
                    <div className="flex items-center justify-between gap-2 px-5 pt-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500/15 to-orange-500/15 border border-amber-500/20">
                          <BarChart3 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-warning">
                            {t('card.type_poll')}
                          </span>
                        </div>
                        {!pollExpired && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-theme-success">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            </span>
                            {t('poll.live')}
                          </span>
                        )}
                      </div>
                      {pollExpired ? (
                        <Chip size="sm" variant="flat" color="default" startContent={<Clock className="w-3 h-3" />} className="h-6 text-[11px]">
                          {t('poll.closed')}
                        </Chip>
                      ) : timeRemaining ? (
                        <Chip size="sm" variant="flat" color="warning" startContent={<Clock className="w-3 h-3" />} className="h-6 text-[11px]">
                          {timeRemaining}
                        </Chip>
                      ) : null}
                    </div>

                    {/* Question */}
                    {pollData.question && (
                      <h3 className="px-5 pt-3 text-[15px] sm:text-base font-semibold leading-snug text-theme-primary">
                        {pollData.question}
                      </h3>
                    )}

                    {/* Options */}
                    <div className="px-5 pt-3 pb-2 space-y-2">
                      {pollData.options.map((option) => {
                        const isVoted = pollData.user_vote_option_id === option.id;
                        const isLeading = showResults && option.id === leadingOptionId && totalVotes > 0;
                        const pct = option.percentage ?? 0;

                        if (showResults) {
                          return (
                            <div
                              key={option.id}
                              className={`relative rounded-xl overflow-hidden border transition-colors ${
                                isVoted
                                  ? 'border-amber-500/60 bg-amber-500/5'
                                  : isLeading
                                    ? 'border-theme-default bg-[var(--surface-base)]'
                                    : 'border-[var(--border-subtle)] bg-[var(--surface-base)]'
                              }`}
                            >
                              {/* Animated percentage fill (skipped when results are hidden) */}
                              {!resultsHidden && (
                                <div
                                  className={`absolute inset-y-0 left-0 transition-[width] duration-700 ease-out ${
                                    isVoted
                                      ? 'bg-gradient-to-r from-amber-500/25 to-orange-500/20'
                                      : isLeading
                                        ? 'bg-[var(--surface-hover)]'
                                        : 'bg-[var(--surface-hover)]/60'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                  aria-hidden="true"
                                />
                              )}
                              <div className="relative flex items-center justify-between gap-3 px-3.5 py-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  {isVoted ? (
                                    <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white">
                                      <Check className="w-3 h-3" aria-hidden="true" />
                                    </span>
                                  ) : isLeading && !resultsHidden ? (
                                    <TrendingUp className="w-4 h-4 flex-shrink-0 text-theme-muted" aria-hidden="true" />
                                  ) : (
                                    <span className="flex-shrink-0 w-5 h-5" aria-hidden="true" />
                                  )}
                                  <span className={`text-sm leading-snug truncate ${(isVoted || (isLeading && !resultsHidden)) ? 'font-semibold text-theme-primary' : 'text-theme-primary'}`}>
                                    {option.text}
                                  </span>
                                </div>
                                <div className="flex flex-col items-end shrink-0">
                                  {option.percentage != null && (
                                    <span className={`text-sm font-bold tabular-nums ${isVoted ? 'text-amber-600 dark:text-amber-400' : 'text-theme-primary'}`}>
                                      {option.percentage}%
                                    </span>
                                  )}
                                  {option.vote_count != null && (
                                    <span className="text-[10px] text-theme-subtle tabular-nums">
                                      {option.vote_count} {option.vote_count === 1 ? t('card.vote') : t('card.votes')}
                                    </span>
                                  )}
                                  {isVoted && resultsHidden && (
                                    <span className="text-[10px] font-semibold text-theme-warning uppercase tracking-wide">
                                      {t('poll.your_vote')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <Button
                            key={option.id}
                            onPress={() => handleVote(option.id)}
                            isDisabled={pollExpired}
                            variant="bordered"
                            fullWidth
                            disableRipple
                            className="group relative h-auto justify-start rounded-xl border-2 border-theme-default bg-[var(--surface-base)] px-4 py-3 text-left text-sm font-medium text-theme-primary transition-all hover:border-amber-500 hover:bg-amber-500/5 active:scale-[0.99]"
                          >
                            <span className="flex w-full items-center justify-between gap-3">
                              <span className="truncate">{option.text}</span>
                              <ArrowRight className="w-4 h-4 text-theme-subtle group-hover:text-amber-500 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
                            </span>
                          </Button>
                        );
                      })}
                    </div>

                    {/* Footer: meta + CTA */}
                    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--surface-base)]/40">
                      <div className="flex items-center gap-2 text-xs text-theme-muted min-w-0">
                        {resultsHidden ? (
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <EyeOff className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                            <span className="truncate">
                              {t('poll.results_hidden_until_close')}
                            </span>
                          </span>
                        ) : pollData.total_votes == null ? (
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <EyeOff className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                            <span className="truncate">
                              {t('poll.vote_to_see_results')}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="tabular-nums font-medium">
                              {totalVotes} {totalVotes === 1 ? t('card.vote') : t('card.votes')}
                            </span>
                          </span>
                        )}
                      </div>
                      <Button
                        as={Link}
                        to={pollDetailPath}
                        size="sm"
                        variant="flat"
                        color="warning"
                        endContent={<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
                        className="h-8 font-semibold"
                      >
                        {t('poll.view_full')}
                      </Button>
                    </div>
                  </div>
                );
              })()
            ) : null}
          </div>
        )}

        {/* Review Display — oversized stars, pull-quote styling, receiver avatar inline */}
        {item.type === 'review' && item.rating && item.receiver && (
          <Card shadow="none" className="mb-4 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 overflow-hidden">
            <CardBody className="p-5">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <Link
                  to={tenantPath(`/profile/${item.receiver.id}`)}
                  className="flex items-center gap-2.5 min-w-0 group/receiver"
                >
                  <Avatar
                    name={item.receiver.name}
                    size="sm"
                    className="ring-2 ring-amber-500/30 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-theme-warning uppercase tracking-wider leading-none">
                      {t('card.reviewed')}
                    </div>
                    <div className="text-sm font-semibold text-theme-primary group-hover/receiver:text-accent transition-colors truncate">
                      {item.receiver.name}
                    </div>
                  </div>
                </Link>
                <div className="flex items-center gap-1" aria-label={t('card.review.rating_aria', { rating: item.rating })}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-6 h-6 transition-colors ${star <= item.rating! ? 'text-amber-400 fill-amber-400 drop-shadow-sm' : 'text-[var(--border-default)]'}`}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
              {item.content && (
                <blockquote className="relative border-s-4 border-amber-500/60 ps-4 py-1 text-[15px] text-theme-secondary italic leading-relaxed">
                  <span className="absolute -top-1 -start-1 text-2xl text-amber-500/40 leading-none select-none" aria-hidden="true">&ldquo;</span>
                  {item.content}
                </blockquote>
              )}
            </CardBody>
          </Card>
        )}

        {/* Badge Earned — celebratory "moment" framing with oversized icon */}
        {item.type === 'badge_earned' && (
          <Card shadow="none" className="mb-4 bg-gradient-to-br from-yellow-500/20 via-amber-500/15 to-orange-500/10 border border-yellow-500/30 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(251,191,36,0.18),_transparent_70%)] pointer-events-none" aria-hidden="true" />
            <CardBody className="p-6 text-center relative">
              <div className="mx-auto mb-3 inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-yellow-400 to-amber-500 shadow-lg shadow-amber-500/30 text-5xl" aria-hidden="true">
                {item.badge_icon || '\uD83C\uDFC6'}
              </div>
              <p className="text-xs font-semibold text-theme-warning uppercase tracking-[0.2em] mb-1">
                {t('card.milestone.badge_unlocked')}
              </p>
              <p className="text-base font-bold text-theme-primary leading-snug">
                {t('card.badge_earned_message', {
                  name: author.name,
                  badge: item.badge_name || item.title || '',
                })}
              </p>
            </CardBody>
          </Card>
        )}

        {/* Level Up — celebratory "moment" framing with oversized icon */}
        {item.type === 'level_up' && (
          <Card shadow="none" className="mb-4 bg-gradient-to-br from-emerald-500/20 via-teal-500/15 to-cyan-500/10 border border-emerald-500/30 overflow-hidden relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.18),_transparent_70%)] pointer-events-none" aria-hidden="true" />
            <CardBody className="p-6 text-center relative">
              <div className="mx-auto mb-3 inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/30" aria-hidden="true">
                <Zap className="w-10 h-10 text-white fill-white" />
              </div>
              <p className="text-xs font-semibold text-theme-success uppercase tracking-[0.2em] mb-1">
                {t('card.milestone.level_reached')}
              </p>
              <p className="text-base font-bold text-theme-primary leading-snug">
                {t('card.level_up_message', {
                  name: author.name,
                  level: item.new_level || item.title?.replace('Level ', '') || '',
                })}
              </p>
            </CardBody>
          </Card>
        )}

        {/* View detail CTA — for listings, events, goals, reviews */}
        {detailPath && detailLabel && (
          <div className="mb-3">
            <Link
              to={tenantPath(detailPath)}
              className={`inline-flex items-center justify-center gap-2 py-2 px-5 rounded-xl text-sm font-medium transition-all bg-gradient-to-r ${config.softGradient || 'from-accent/10 to-accent/5'} text-theme-primary hover:opacity-80 border border-theme-default hover:border-accent/30`}
              onClick={recordClick}
            >
              {config.icon}
              {t(detailLabel)}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        )}

        {/* Stats Row — Reactions + Comments Count + Views */}
        {((item.reactions?.total ?? item.likes_count) > 0 || social.commentsCount > 0 || (item.views_count ?? 0) > 0) && (
          <div className="flex items-center justify-between text-xs text-theme-subtle mb-3">
            <span className="flex items-center gap-3">
              {item.reactions && item.reactions.total > 0 ? (
                <ReactionSummary
                  counts={item.reactions.counts}
                  total={item.reactions.total}
                  topReactors={item.reactions.top_reactors}
                  entityType={item.type}
                  entityId={item.id}
                />
              ) : item.likes_count > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="flex -space-x-0.5">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center">
                      <Heart className="w-2.5 h-2.5 text-white fill-white" aria-hidden="true" />
                    </span>
                  </span>
                  {item.likes_count} {item.likes_count === 1 ? t('card.like') : t('card.likes')}
                </span>
              ) : null}
              {(item.views_count ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  {item.views_count}
                </span>
              )}
            </span>
            {social.commentsCount > 0 && (
              <Button
                variant="light"
                size="sm"
                className="text-xs text-theme-subtle hover:text-theme-primary p-0 min-w-0 min-h-9"
                onPress={toggleComments}
              >
                {social.commentsCount} {social.commentsCount === 1 ? t('card.comment') : t('card.comments')}
              </Button>
            )}
          </div>
        )}

        {/* Separator before actions */}
        <Separator className="mb-1" />

        {/* Action Buttons — reactions + comment as primary; share + bookmark as ghost icon-only secondary actions */}
        <div className="flex flex-wrap items-center justify-between gap-1 -mx-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {/*
              ReactionPicker is shown for reactable feed item types when an
              onReact handler is supplied; otherwise likeable cards fall back to
              a simple Like button.

              Notification-style cards (level_up, badge_earned) are NOT
              user-authored content — there is no entity to like or react
              against, and the backend like API (SocialController::likeV2)
              rejects those target_types with a 400. Rendering an interactive
              Like button on them produced the "Failed to like" error users hit
              (Sentry NEXUS-PHP-1Y), so milestone cards now get no like/react
              control at all.

              REACTABLE_FEED_TYPES MUST stay in sync with
              ReactionService::VALID_TARGET_TYPES and
              SocialController::VALID_LIKE_TARGETS.
            */}
            {REACTABLE_FEED_TYPES.has(item.type) ? (
              onReact ? (
                <ReactionPicker
                  userReaction={(item.reactions?.user_reaction as ReactionType | null) ?? null}
                  onReact={(type) => onReact(item, type)}
                  isAuthenticated={isAuthenticated}
                  size="sm"
                />
              ) : (
                <Tooltip content={item.is_liked ? t('card.unlike') : t('card.like_action')} delay={400} closeDelay={0} size="sm">
                  <Button
                    size="sm"
                    variant="light"
                    className={`transition-all ${item.is_liked
                      ? 'text-rose-500 font-medium bg-rose-500/5'
                      : 'text-theme-muted hover:text-rose-500 hover:bg-rose-500/5'
                    }`}
                    startContent={
                      <Heart
                        className={`w-[18px] h-[18px] transition-all ${item.is_liked ? 'fill-rose-500 text-rose-500 scale-110 animate-heart-pop' : ''}`}
                        aria-hidden="true"
                      />
                    }
                    onPress={isAuthenticated ? () => onToggleLike(item) : undefined}
                    isDisabled={!isAuthenticated}
                  >
                    {t('card.like_action')}
                  </Button>
                </Tooltip>
              )
            ) : null}

            {isCommentable && (
              <Tooltip content={t('card.view_comments')} delay={400} closeDelay={0} size="sm">
                <Button
                  size="sm"
                  variant="light"
                  className={`transition-all ${showComments ? 'text-accent font-medium bg-accent/5' : 'text-theme-muted hover:text-accent hover:bg-accent/5'}`}
                  startContent={<MessageCircle className={`w-[18px] h-[18px] ${showComments ? 'fill-accent/20' : ''}`} aria-hidden="true" />}
                  onPress={toggleComments}
                >
                  {t('card.comment_action')}
                </Button>
              </Tooltip>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {/*
              Share button — polymorphic. Available for every type in SHAREABLE_TYPES
              (post, listing, event, poll, job, blog, discussion, goal, challenge, volunteer).
              The Quote Post option is auto-disabled for non-post types inside ShareButton
              because quote post requires a feed_posts row (quoted_post_id FK).
            */}
            {isAuthenticated && SHAREABLE_TYPES.has(item.type) && (
              <ShareButton
                type={item.type}
                id={item.id}
                shareCount={item.share_count ?? 0}
                isShared={item.is_shared ?? false}
                isAuthenticated={isAuthenticated}
                post={item}
                onShareChange={(newCount, newIsShared) => {
                  dispatchFeedSync({
                    targetType: item.type,
                    targetId: item.id,
                    patch: { share_count: newCount, is_shared: newIsShared },
                  });
                }}
                compact
              />
            )}

            {/*
              Bookmark — only rendered for types BookmarkService::VALID_TYPES supports.
              Keep this list in sync with app/Services/BookmarkService.php::VALID_TYPES.
            */}
            {isAuthenticated && BOOKMARKABLE_TYPES.has(item.type) && (
              <BookmarkButton
                type={item.type}
                id={item.id}
                isBookmarked={item.is_bookmarked}
                onToggle={(bookmarked) => {
                  dispatchFeedSync({
                    targetType: item.type,
                    targetId: item.id,
                    patch: { is_bookmarked: bookmarked },
                  });
                }}
              />
            )}
          </div>
        </div>

        {/* Post Analytics Modal */}
        {showAnalytics && canViewAnalytics && (
          <Suspense fallback={null}>
            <PostAnalyticsModal
              isOpen={showAnalytics}
              onClose={() => setShowAnalytics(false)}
              postId={item.id}
            />
          </Suspense>
        )}

        {/* Comments — phones get a native-style bottom sheet with the composer
            pinned at the bottom; desktop keeps the inline expansion. */}
        {useSheetForComments && isCommentable && (
          <BottomSheet
            isOpen={isCommentsSheetOpen}
            onClose={() => setIsCommentsSheetOpen(false)}
            title={social.commentsCount > 0
              ? `${tSocial('comments_title')} (${social.commentsCount})`
              : tSocial('comments_title')}
            snapPoints={['full']}
          >
            <Suspense fallback={null}>
              <CommentsSection
                variant="sheet"
                comments={social.comments}
                commentsCount={social.commentsCount}
                commentsLoading={social.commentsLoading}
                commentsLoaded={social.commentsLoaded}
                loadComments={social.loadComments}
                submitComment={social.submitComment}
                editComment={social.editComment}
                deleteComment={social.deleteComment}
                toggleReaction={social.toggleReaction}
                searchMentions={social.searchMentions}
                isAuthenticated={isAuthenticated}
                currentUserId={currentUserId}
                currentUserAvatar={currentUserAvatar ?? undefined}
                currentUserName={currentUserName ?? undefined}
              />
            </Suspense>
          </BottomSheet>
        )}

        {/* Comments Section */}
        <AnimatePresence>
          {showComments && isCommentable && !useSheetForComments && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="mt-3 pt-3 border-t border-theme-default space-y-3"
            >
              <Suspense fallback={null}>
                <CommentsSection
                  comments={social.comments}
                  commentsCount={social.commentsCount}
                  commentsLoading={social.commentsLoading}
                  commentsLoaded={social.commentsLoaded}
                  loadComments={social.loadComments}
                  submitComment={social.submitComment}
                  editComment={social.editComment}
                  deleteComment={social.deleteComment}
                  toggleReaction={social.toggleReaction}
                  searchMentions={social.searchMentions}
                  isAuthenticated={isAuthenticated}
                  currentUserId={currentUserId}
                  currentUserAvatar={currentUserAvatar ?? undefined}
                  currentUserName={currentUserName ?? undefined}
                />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </div>{/* end long-press touch target */}
    </GlassCard>
  );
});

export { FeedCard };
export default FeedCard;
