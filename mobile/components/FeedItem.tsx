// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Share, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@/components/ui/Icon';
import { router } from 'expo-router';
import { Button as HeroButton, Card as HeroCard, Separator, Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import * as Haptics from '@/lib/haptics';

import { useTranslation } from 'react-i18next';

import { getFeedAuthor, toggleBookmark, toggleLike, toggleReaction, type FeedItem as FeedItemType, type PollData, type ReactionsSummary, type ReactionType } from '@/lib/api/feed';
import {
  hideFeedItem,
  markFeedItemNotInterested,
  muteFeedAuthor,
  reportFeedItem,
  type FeedTargetType,
} from '@/lib/api/feedModeration';
import { describeApiError } from '@/lib/api/describeApiError';
import { ApiResponseError } from '@/lib/api/client';
import BottomSheet from '@/components/ui/BottomSheet';
import NativePressable from '@/components/ui/NativePressable';
import type { CommentTargetType } from '@/lib/api/comments';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import Avatar from '@/components/ui/Avatar';
import ImageCarousel from '@/components/ui/ImageCarousel';
import ActionSheet from '@/components/ui/ActionSheet';
import { useAppToast } from '@/components/ui/AppToast';
import CommentSheet from '@/components/comments/CommentSheet';
import ReactionBar, { REACTION_EMOJI_MAP } from '@/components/reactions/ReactionBar';
import ReactionSummaryRow from '@/components/reactions/ReactionSummaryRow';
import PollCard from '@/components/PollCard';
import { formatRelativeTime } from '@/lib/utils/formatRelativeTime';

interface FeedItemProps {
  item: FeedItemType;
  disableDetailNavigation?: boolean;
  commentsCountOverride?: number;
  onOpenComments?: (target: FeedCommentTarget) => void;
  onCommentsCountChange?: (target: FeedCommentTarget, count: number) => void;
  /** Screen-level handler that opens the shared reactors sheet. Sheets cannot
   *  render from inside a FlatList row (portal never becomes visible), so the
   *  host screen owns the sheet — same architecture as onOpenComments. */
  onOpenReactors?: (target: FeedReactorsTarget) => void;
}

export interface FeedReactorsTarget {
  targetType: string;
  targetId: number;
  reactions: ReactionsSummary | null;
}

export interface FeedCommentTarget {
  targetType: CommentTargetType;
  targetId: number;
  initialCount: number;
}

type ChipColor = 'accent' | 'default' | 'success' | 'warning' | 'danger';

/**
 * The report reasons, deliberately the same closed list the listing report flow uses
 * (`app/(modals)/exchange-detail.tsx`). Chips rather than a text box: the server requires a
 * non-empty reason, and a member reporting something unpleasant should not have to compose a
 * sentence for the report to be accepted.
 */
const REPORT_REASONS = ['safety_concern', 'inappropriate', 'misleading', 'spam', 'other'] as const;
type ReportReason = (typeof REPORT_REASONS)[number];

const TYPE_CONFIG: Record<
  FeedItemType['type'],
  {
    chipColor: ChipColor;
    icon: keyof typeof Ionicons.glyphMap;
    strip: readonly [string, string, string];
  }
> = {
  post: {
    chipColor: 'default',
    icon: 'chatbox-ellipses-outline',
    strip: ['#D4D4D8', '#E4E4E7', '#D4D4D8'],
  },
  listing: {
    chipColor: 'accent',
    icon: 'swap-horizontal-outline',
    strip: ['#6366F1', '#3B82F6', '#6366F1'],
  },
  event: {
    chipColor: 'success',
    icon: 'calendar-outline',
    strip: ['#10B981', '#22C55E', '#10B981'],
  },
  poll: {
    chipColor: 'warning',
    icon: 'stats-chart-outline',
    strip: ['#F59E0B', '#F97316', '#F59E0B'],
  },
  goal: {
    chipColor: 'accent',
    icon: 'flag-outline',
    strip: ['#A855F7', '#EC4899', '#A855F7'],
  },
  review: {
    chipColor: 'warning',
    icon: 'star-outline',
    strip: ['#F59E0B', '#EAB308', '#F59E0B'],
  },
  job: {
    chipColor: 'accent',
    icon: 'briefcase-outline',
    strip: ['#3B82F6', '#06B6D4', '#3B82F6'],
  },
  challenge: {
    chipColor: 'accent',
    icon: 'trophy-outline',
    strip: ['#8B5CF6', '#A855F7', '#8B5CF6'],
  },
  volunteer: {
    chipColor: 'success',
    icon: 'heart-outline',
    strip: ['#22C55E', '#10B981', '#22C55E'],
  },
  blog: {
    chipColor: 'accent',
    icon: 'book-outline',
    strip: ['#0EA5E9', '#3B82F6', '#0EA5E9'],
  },
  discussion: {
    chipColor: 'accent',
    icon: 'people-outline',
    strip: ['#D946EF', '#A855F7', '#D946EF'],
  },
  resource: {
    chipColor: 'accent',
    icon: 'library-outline',
    strip: ['#14B8A6', '#06B6D4', '#14B8A6'],
  },
  badge_earned: {
    chipColor: 'warning',
    icon: 'ribbon-outline',
    strip: ['#EAB308', '#F59E0B', '#EAB308'],
  },
  level_up: {
    chipColor: 'success',
    icon: 'flash-outline',
    strip: ['#10B981', '#14B8A6', '#10B981'],
  },
};

const DEFAULT_TYPE_CONFIG = TYPE_CONFIG.post;

const COMMENTABLE_TYPES = new Set<FeedItemType['type']>([
  'post',
  'listing',
  'event',
  'poll',
  'goal',
  'job',
  'challenge',
  'volunteer',
  'review',
  'blog',
  'discussion',
  'resource',
]);

const BOOKMARKABLE_TYPES = new Set<FeedItemType['type']>([
  'post',
  'listing',
  'event',
  'job',
  'blog',
  'discussion',
]);

/**
 * Feed item types the LIKE endpoint accepts — MUST stay in sync with
 * App\Http\Controllers\Api\SocialController::VALID_LIKE_TARGETS.
 *
 * 🔴 This set existed on the web and not here, and its absence was a live bug. The
 * heart in the card footer was rendered for EVERY feed item. On a milestone card
 * (`level_up`, `badge_earned`) there is no entity to like or react to, and both
 * endpoints refuse it — measured 2026-08-20 against the local API:
 *
 *   POST /api/v2/reactions  {target_type: "level_up"}     -> 400 Invalid target_type
 *   POST /api/v2/feed/like  {target_type: "badge_earned"} -> 400 Invalid target_type
 *
 * So tapping that heart could only ever fail: the optimistic update flipped the icon,
 * the request 400'd, the state reverted and a "reaction failed" toast appeared. On a
 * gamification-heavy feed that is most of the cards — 3 of the first 4 in the test
 * fixture. It reads as "the app cannot save my reactions", which is exactly how it was
 * reported.
 *
 * `react-frontend/src/components/feed/FeedCard.tsx` fixed this by rendering NO
 * like/react control on milestone cards, citing Sentry NEXUS-PHP-1Y. Mobile never got
 * that fix. This is that fix.
 */
const LIKEABLE_TYPES = new Set<FeedItemType['type']>([
  'post',
  'listing',
  'event',
  'poll',
  'goal',
  'resource',
  'volunteer',
  'review',
  'challenge',
  'job',
  'blog',
  'discussion',
]);

/**
 * Feed item types that support emoji reactions — MUST stay in sync with
 * App\Services\ReactionService::VALID_TARGET_TYPES (mirrors the web
 * REACTABLE_FEED_TYPES in FeedCard.tsx).
 */
const REACTABLE_TYPES = new Set<FeedItemType['type']>([
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

function getTypeConfig(type: FeedItemType['type'] | string) {
  return TYPE_CONFIG[type as FeedItemType['type']] ?? DEFAULT_TYPE_CONFIG;
}

function getTypeColor(type: FeedItemType['type'] | string): ChipColor {
  return getTypeConfig(type).chipColor;
}

function getTypeIcon(type: FeedItemType['type'] | string): keyof typeof Ionicons.glyphMap {
  return getTypeConfig(type).icon;
}

function getDetailTarget(item: FeedItemType) {
  switch (item.type) {
    case 'listing':
      return { pathname: '/(modals)/exchange-detail', params: { id: String(item.id) }, labelKey: 'detail.listing' };
    case 'event':
      return { pathname: '/(modals)/event-detail', params: { id: String(item.id) }, labelKey: 'detail.event' };
    case 'job':
      return { pathname: '/(modals)/job-detail', params: { id: String(item.id) }, labelKey: 'detail.job' };
    case 'volunteer':
      return { pathname: '/(modals)/volunteering-detail', params: { id: String(item.id) }, labelKey: 'detail.volunteer' };
    case 'goal':
      return { pathname: '/(modals)/goals', params: { id: String(item.id) }, labelKey: 'detail.goal' };
    case 'review':
      return item.receiver ? { pathname: '/(modals)/member-profile', params: { id: String(item.receiver.id) }, labelKey: 'detail.profile' } : null;
    case 'blog':
      return item.slug ? { pathname: '/(modals)/blog-post', params: { id: item.slug }, labelKey: 'detail.blog' } : null;
    case 'post':
    case 'poll':
    case 'challenge':
    case 'discussion':
    case 'resource':
      return { pathname: '/(modals)/feed-item-detail', params: { id: String(item.id), type: item.type }, labelKey: 'detail.post' };
    /*
     * 🔴 `badge_earned` and `level_up` were in the list above, and the link they produced
     * ALWAYS dead-ended. Found by walking the app on 2026-08-20: tapping "View post" on a
     * badge card opens a screen reading "Not found. Something went wrong. Please try
     * again." with a Retry button that fails identically for ever.
     *
     * Why it cannot work: the detail screen calls `getFeedItem(type, id)`, and
     * `POLYMORPHIC_FEED_TYPES` in lib/api/feed.ts does not include these two — so
     * `safeType` silently falls back to `'post'` and it fetches
     * `GET /api/v2/feed/posts/<id>` with a GAMIFICATION event id. Measured:
     *
     *   GET /api/v2/feed/posts/674            -> 404 {"code":"NOT_FOUND","message":"Post not found"}
     *   GET /api/v2/feed/items/listing/515    -> 200 (real content, for contrast)
     *
     * There is no post behind a milestone, so there is nothing to link to. Same family as
     * the react/like control being rendered on these cards: an action offered on a card
     * that has nothing behind it. Returning null removes the link rather than leaving a
     * button whose only outcome is an error screen.
     */
    case 'badge_earned':
    case 'level_up':
      return null;
    default:
      return null;
  }
}

function FeedItemInner({
  item,
  disableDetailNavigation = false,
  commentsCountOverride,
  onOpenComments,
  onCommentsCountChange,
  onOpenReactors,
}: FeedItemProps) {
  const { t } = useTranslation(['home', 'exchanges', 'common']);
  const { show: showToast } = useAppToast();
  // Muting yourself is meaningless, so the option is hidden on your own content.
  const currentUserId = useAuth().user?.id ?? null;

  /**
   * 🔴 Getting content off your own feed, and telling someone about it.
   *
   * Until 2026-08-22 the card's "…" menu offered Share, Save and View post — nothing about
   * the content itself. The website has had hide, not-interested and mute since the V2 feed
   * was built, and the server's report endpoint alerts the community's moderators. On the
   * phone there was no way to do any of it, which is a safeguarding gap and not a
   * convenience one.
   *
   * `dismissed` hides the card locally the moment the server accepts a hide or a mute. The
   * feed is not re-fetched for one action, so without this the member taps "Hide this" and
   * the post stays exactly where it was, which reads as a dead control.
   */
  const [dismissed, setDismissed] = useState(false);
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('safety_concern');
  const [isReporting, setIsReporting] = useState(false);
  const primary = usePrimaryColor();
  const theme = useTheme();

  /**
   * 🔴 Word labels come off the action row on narrow phones.
   *
   * The row is four controls wide at its widest and two of them carry words ("Comment",
   * "Share"). At 411dp — the emulator, and every Pixel — that fits. At 360dp, a very
   * common Android width, the save button was pushed off the card edge and clipped away
   * with nothing to show it existed. Measured 2026-08-20 at both densities on one build.
   *
   * The footer also carries `flex-wrap`, which alone is enough to stop anything being
   * clipped — but it produces a lopsided two-line row, so this keeps a single tidy line
   * instead and leaves the wrap as the backstop for a width nobody anticipated.
   *
   * 🔴 Dropping a Label REMOVES the button's accessible name, because that is what a
   * screen reader was reading. Both buttons therefore gain an explicit
   * `accessibilityLabel` below — without it this "fix" would have made the row worse for
   * anyone using TalkBack while looking fine to everyone else.
   */
  const { width: screenWidth } = useWindowDimensions();
  const compactActions = screenWidth < 380;

  const [liked, setLiked] = useState(item.is_liked ?? false);
  const [likesCount, setLikesCount] = useState(item.likes_count ?? 0);
  const [reactions, setReactions] = useState<ReactionsSummary | null>(item.reactions ?? null);
  const [reactionBarVisible, setReactionBarVisible] = useState(false);
  const isReactingRef = useRef(false);
  const [localCommentsCount, setLocalCommentsCount] = useState(item.comments_count ?? 0);
  const [pollData, setPollData] = useState<PollData | null | undefined>(item.poll_data);
  const [bookmarked, setBookmarked] = useState(item.is_bookmarked ?? false);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);

  // Server truth wins after a refresh: when the parent hands us a NEW item
  // object (refetch), reseed the interaction state. Optimistic updates are
  // safe — they never replace the item reference.
  useEffect(() => {
    setLiked(item.is_liked ?? false);
    setLikesCount(item.likes_count ?? 0);
    setReactions(item.reactions ?? null);
    setBookmarked(item.is_bookmarked ?? false);
    setPollData(item.poll_data);
    setLocalCommentsCount(item.comments_count ?? 0);
  }, [item]);

  // FlatList recycles rows — never let a pending tap/hold timer fire against
  // a different item after this row unmounts.
  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastTapRef = useRef<number>(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const overlayScale = useRef(new Animated.Value(0.5)).current;
  const heartBtnScale = useRef(new Animated.Value(1)).current;

  const performLike = useCallback(async () => {
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikesCount((n) => (wasLiked ? n - 1 : n + 1));

    try {
      const result = await toggleLike(item.type, item.id);
      setLiked(result.data.action === 'liked');
      setLikesCount(result.data.likes_count);
    } catch {
      setLiked(wasLiked);
      setLikesCount((n) => (wasLiked ? n + 1 : n - 1));
      showToast({ title: t('common:errors.alertTitle'), description: t('reaction.failed'), variant: 'danger' });
    }
  }, [liked, item.id, item.type, showToast, t]);

  const isReactable = REACTABLE_TYPES.has(item.type);
  /**
   * Whether a heart/emoji control can do anything at all for this item. A milestone
   * card is neither reactable nor likeable, so showing one guarantees a 400 — see the
   * LIKEABLE_TYPES note above.
   */
  const canRespond = isReactable || LIKEABLE_TYPES.has(item.type);
  const userReaction = reactions?.user_reaction ?? null;

  /**
   * Toggle an emoji reaction (web parity). Tapping the current reaction
   * removes it; selecting a different one switches to it. Optimistic update
   * reconciled from the server's authoritative summary.
   */
  const performReact = useCallback(async (type: ReactionType) => {
    if (isReactingRef.current) return;
    isReactingRef.current = true;
    setReactionBarVisible(false);

    const previous = reactions ?? { counts: {}, total: 0, user_reaction: null };
    const counts = { ...previous.counts };
    let newUserReaction: string | null;
    if (previous.user_reaction === type) {
      counts[type] = Math.max(0, (counts[type] ?? 1) - 1);
      newUserReaction = null;
    } else {
      if (previous.user_reaction) {
        counts[previous.user_reaction] = Math.max(0, (counts[previous.user_reaction] ?? 1) - 1);
      }
      counts[type] = (counts[type] ?? 0) + 1;
      newUserReaction = type;
    }
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    setReactions({ ...previous, counts, total, user_reaction: newUserReaction });

    try {
      const result = await toggleReaction(item.type, item.id, type);
      if (result.data?.reactions) {
        setReactions(result.data.reactions);
      }
    } catch {
      setReactions(previous);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: t('reaction.failed'), variant: 'danger' });
    } finally {
      isReactingRef.current = false;
    }
  }, [item.id, item.type, reactions]);

  function showHeartOverlay() {
    overlayOpacity.setValue(1);
    overlayScale.setValue(0.5);

    Animated.parallel([
      Animated.spring(overlayScale, {
        toValue: 1.0,
        friction: 4,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 1000,
        useNativeDriver: true,
      }),
    ]).start();
  }

  function animateHeartButton() {
    heartBtnScale.setValue(1);
    Animated.spring(heartBtnScale, {
      toValue: 1.3,
      friction: 3,
      tension: 200,
      useNativeDriver: true,
    }).start(() => {
      Animated.spring(heartBtnScale, {
        toValue: 1.0,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }).start();
    });
  }

  function navigateToDetail() {
    if (disableDetailNavigation) return;
    setReactionBarVisible(false);
    const detailTarget = getDetailTarget(item);
    if (detailTarget) {
      router.push({ pathname: detailTarget.pathname as never, params: detailTarget.params });
    }
  }

  function handleFeedImagePress() {
    if (detailTarget) {
      navigateToDetail();
      return;
    }
    if (imageUrl) {
      router.push({ pathname: '/(modals)/image-viewer', params: { uri: imageUrl, title: item.title ?? '' } });
    }
  }

  function handleDoubleTap() {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showHeartOverlay();
      animateHeartButton();
      if (isReactable) {
        if (!userReaction) void performReact('like');
      } else if (!liked) {
        void performLike();
      }
    } else {
      lastTapRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        navigateToDetail();
      }, 300);
    }
  }

  // Hold-to-react detection. We deliberately do NOT pass onLongPress to the
  // button: with the reanimated-wrapped Pressable, supplying onLongPress made
  // QUICK taps fire neither callback (verified on-device 2026-06-11 — single
  // taps produced no event while hold-and-release fired BOTH callbacks).
  // Instead we time the press ourselves from onPressIn/onPressOut — the same
  // events that drive the press animation, which fire reliably — and open the
  // reaction bar mid-hold (Instagram-style). onPress still handles the tap and
  // is skipped when the hold already fired.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);

  function handleLikePressIn() {
    holdFiredRef.current = false;
    if (!isReactable) return;
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      holdFiredRef.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setReactionBarVisible(true);
    }, 450);
  }

  function handleLikePressOut() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function handleLikePress() {
    if (holdFiredRef.current) {
      // The hold already opened the reaction bar — releasing the finger must
      // not ALSO toggle a like.
      holdFiredRef.current = false;
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateHeartButton();
    if (isReactable) {
      // Quick tap: toggle the current reaction, or add the default 'like'.
      void performReact((userReaction as ReactionType | null) ?? 'like');
      return;
    }
    void performLike();
  }

  const typeConfig = getTypeConfig(item.type);
  const imageItems = item.media
    ?.filter((media) => media.media_type === 'image' && media.file_url)
    .sort((a, b) => a.display_order - b.display_order)
    .map((media) => ({ uri: resolveImageUrl(media.file_url) ?? media.file_url, alt: media.alt_text ?? undefined }));
  const videoItems = item.media?.filter((media) => media.media_type === 'video' && media.file_url) ?? [];
  const imageUrl = resolveImageUrl(item.image_url);
  const author = getFeedAuthor(item, t('stories.member'));
  const authorName = author.name;
  const detailTarget = disableDetailNavigation ? null : getDetailTarget(item);
  const isCommentable = COMMENTABLE_TYPES.has(item.type);
  const canBookmark = BOOKMARKABLE_TYPES.has(item.type);
  const commentsCount = commentsCountOverride ?? localCommentsCount;
  const reactionTotal = reactions?.total ?? likesCount;
  const userReactionEmoji = userReaction ? REACTION_EMOJI_MAP[userReaction] : null;
  const likeButtonActive = isReactable ? userReaction !== null : liked;
  const linkPreview = item.link_previews?.[0];
  const linkPreviewImageUrl = resolveImageUrl(linkPreview?.image_url);
  const commentTarget = isCommentable
    ? { targetType: item.type as CommentTargetType, targetId: item.id, initialCount: commentsCount }
    : null;

  function handleCommentPress() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (commentTarget && onOpenComments) {
      onOpenComments(commentTarget);
      return;
    }
    setCommentsVisible(true);
  }

  function handleCommentsCountChange(count: number) {
    setLocalCommentsCount(count);
    if (commentTarget) {
      onCommentsCountChange?.(commentTarget, count);
    }
  }

  const handleShare = useCallback(async () => {
    try {
      await Share.share({ message: `${item.title ?? ''}\n${item.content ?? ''}`.trim() });
    } catch {
      // User cancelled or share failed.
    }
  }, [item.content, item.title]);

  const handleSave = useCallback(async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const wasBookmarked = bookmarked;
    setBookmarked(!wasBookmarked);
    try {
      const result = await toggleBookmark(item.type, item.id);
      setBookmarked(result.data.bookmarked);
    } catch {
      setBookmarked(wasBookmarked);
      showToast({ title: t('common:errors.alertTitle'), description: t('saveFailed'), variant: 'danger' });
    }
  }, [bookmarked, item.id, item.type, showToast, t]);

  const moderationTargetType = item.type as FeedTargetType;

  const runModeration = useCallback(
    async (fn: () => Promise<unknown>, successTitle: string, hideCard: boolean) => {
      try {
        await fn();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({ title: successTitle, variant: 'success' });
        if (hideCard) {
          // 🔴 On a detail screen there is nothing behind the card, so dismissing it in
          // place leaves the member staring at an empty page with a header. Measured on a
          // device on 2026-08-22. `disableDetailNavigation` is only set by the detail
          // screen, so it is the signal for "this card IS the page".
          if (disableDetailNavigation && typeof router.back === 'function') router.back();
          else setDismissed(true);
        }
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({
          title: t('common:errors.alertTitle'),
          description: describeApiError(err, t('moderationFailed')),
          variant: 'danger',
        });
      }
    },
    [disableDetailNavigation, showToast, t],
  );

  const submitReport = useCallback(async () => {
    if (isReporting) return;
    setIsReporting(true);
    try {
      await reportFeedItem(item.id, reportReason, moderationTargetType);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReportSheetVisible(false);
      showToast({ title: t('reportSentTitle'), description: t('reportSentBody'), variant: 'success' });
    } catch (err) {
      // 🔴 409 means "you already reported this", which is an ANSWER, not a failure. Showing
      // it as an error would tell a member their report had not gone through when it had.
      const already = err instanceof ApiResponseError && err.status === 409;
      void Haptics.notificationAsync(
        already ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      );
      setReportSheetVisible(false);
      showToast(
        already
          ? { title: t('reportAlreadyTitle'), description: t('reportAlreadyBody') }
          : {
              title: t('common:errors.alertTitle'),
              description: describeApiError(err, t('moderationFailed')),
              variant: 'danger',
            },
      );
    } finally {
      setIsReporting(false);
    }
  }, [isReporting, item.id, moderationTargetType, reportReason, showToast, t]);

  const cardLabel = `${authorName}. ${item.title ?? ''}${item.content ? '. ' + item.content.slice(0, 100) : ''}`;

  // Hidden or muted: the card goes at once. See `dismissed` above for why.
  if (dismissed) return null;

  return (
    <View className="mx-4 my-2" accessible accessibilityLabel={cardLabel} accessibilityRole="summary">
      <HeroCard variant="default" className="overflow-hidden">
        <View
          className="h-1 w-full"
          style={[
            { backgroundColor: typeConfig.strip[1] },
            Platform.OS === 'web'
              ? ({
                  backgroundImage: `linear-gradient(90deg, ${typeConfig.strip[0]}, ${typeConfig.strip[1]}, ${typeConfig.strip[2]})`,
                } as object)
              : null,
          ]}
        />
        <Pressable onPress={handleDoubleTap}>
          <HeroCard.Header className="flex-row items-center gap-3 px-4 pb-2 pt-4">
            <Avatar uri={author.avatar} name={authorName} size={40} />
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {authorName}
              </Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>
                {item.created_at ? formatRelativeTime(item.created_at) : ''}
              </Text>
            </View>
            {item.type !== 'post' ? (
              <Chip size="sm" variant="soft" color={getTypeColor(item.type)}>
                <Ionicons name={getTypeIcon(item.type)} size={12} color={typeConfig.strip[1]} />
                <Chip.Label>{t(`feedTypes.${item.type}`, { defaultValue: item.type })}</Chip.Label>
              </Chip>
            ) : null}
            {item.is_official ? (
              <Chip size="sm" variant="soft" color="accent">
                <Chip.Label>{t('official')}</Chip.Label>
              </Chip>
            ) : null}
            <HeroButton
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={() => setActionSheetVisible(true)}
              accessibilityLabel={t('moreOptions')}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={theme.textMuted} />
            </HeroButton>
          </HeroCard.Header>

          <HeroCard.Body className="gap-3 px-4 pb-4 pt-1">
            {item.type === 'badge_earned' || item.type === 'level_up' ? (
              <Surface variant="secondary" className="items-center gap-2 rounded-panel-inner p-5">
                <View className="h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: primary }}>
                  <Ionicons name={item.type === 'badge_earned' ? 'ribbon' : 'flash'} size={34} color="#fff" />
                </View>
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {item.type === 'badge_earned' ? t('milestone.badgeUnlocked') : t('milestone.levelReached')}
                </Text>
                <Text className="text-center text-base font-bold" style={{ color: theme.text }}>
                  {item.type === 'badge_earned'
                    ? t('milestone.badgeMessage', { name: authorName, badge: item.badge_name || item.title || '' })
                    : t('milestone.levelMessage', { name: authorName, level: item.new_level || item.title || '' })}
                </Text>
              </Surface>
            ) : null}

            {item.title ? (
              <Text className="text-base font-bold leading-6" style={{ color: theme.text }}>
                {item.title}
              </Text>
            ) : null}
            {item.content ? (
              <View className="gap-1">
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={item.content_truncated ? 4 : 5}>
                  {item.content}
                </Text>
                {item.content.length > 150 || item.content_truncated ? (
                  <HeroButton
                    size="sm"
                    variant="ghost"
                    isDisabled={!detailTarget}
                    className="self-start px-0"
                    onPress={navigateToDetail}
                    accessibilityLabel={t('readMore')}
                  >
                    <HeroButton.Label style={{ color: detailTarget ? primary : theme.textMuted }}>
                      {t('readMore')}
                    </HeroButton.Label>
                  </HeroButton>
                ) : null}
              </View>
            ) : null}

            {imageItems && imageItems.length > 0 ? (
              <View className="overflow-hidden rounded-panel-inner">
                <ImageCarousel images={imageItems} height={210} onImagePress={detailTarget ? handleFeedImagePress : undefined} />
              </View>
            ) : imageUrl ? (
              <Pressable
                onPress={handleFeedImagePress}
                accessibilityLabel={t('feedTypes.post')}
                accessibilityRole="imagebutton"
              >
                <Image source={{ uri: imageUrl }} style={{ width: '100%', height: 210, borderRadius: 14 }} contentFit="cover" />
              </Pressable>
            ) : null}

            {videoItems.length > 0 ? (
              <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-4">
                <Ionicons name="play-circle-outline" size={28} color={primary} />
                <View className="min-w-0 flex-1">
                  <Text className="font-semibold" style={{ color: theme.text }}>{t('media.video')}</Text>
                  <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {videoItems[0]?.alt_text || t('media.videoDescription')}
                  </Text>
                </View>
              </Surface>
            ) : null}

            {linkPreview ? (
              <Surface variant="secondary" className="overflow-hidden rounded-panel-inner">
                {linkPreviewImageUrl ? (
                  <Image source={{ uri: linkPreviewImageUrl }} style={{ width: '100%', height: 120 }} contentFit="cover" />
                ) : null}
                <View className="gap-1 p-3">
                  <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{linkPreview.domain || linkPreview.site_name}</Text>
                  <Text className="font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                    {linkPreview.title || linkPreview.url}
                  </Text>
                  {linkPreview.description ? (
                    <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={2}>
                      {linkPreview.description}
                    </Text>
                  ) : null}
                </View>
              </Surface>
            ) : null}

            {item.type === 'poll' && pollData ? (
              <PollCard
                pollData={pollData}
                itemId={item.id}
                onVoted={(updated) => setPollData(updated)}
                // The card's own title is the poll question for a poll item, so asking the
                // poll to print it again put the same line on screen twice.
                showQuestion={(item.title ?? '').trim() !== (pollData.question ?? '').trim()}
              />
            ) : null}

            {item.location ? (
              <View className="flex-row items-center gap-1">
                <Ionicons name="location-outline" size={14} color={theme.textMuted} />
                <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {item.location}
                </Text>
              </View>
            ) : null}

            {detailTarget ? (
              <HeroButton size="sm" variant="secondary" onPress={navigateToDetail}>
                <Ionicons name={getTypeIcon(item.type)} size={16} color={primary} />
                <HeroButton.Label>{t(detailTarget.labelKey)}</HeroButton.Label>
                <Ionicons name="arrow-forward" size={15} color={primary} />
              </HeroButton>
            ) : null}
          </HeroCard.Body>

          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: overlayOpacity,
              transform: [{ scale: overlayScale }],
            }}
          >
            <Ionicons name="heart" size={80} color={primary} />
          </Animated.View>
        </Pressable>

        <View className="mx-4">
          <Separator />
        </View>

        {reactionTotal > 0 || commentsCount > 0 || (item.views_count ?? 0) > 0 || (item.share_count ?? 0) > 0 ? (
          <View className="flex-row items-center justify-between px-4 pt-3">
            <View className="flex-row flex-wrap items-center gap-3">
              {isReactable && reactions && reactions.total > 0 ? (
                <ReactionSummaryRow
                  reactions={reactions}
                  primary={primary}
                  onPress={() => onOpenReactors?.({ targetType: item.type, targetId: item.id, reactions })}
                />
              ) : reactionTotal > 0 ? (
                <Text className="text-xs" style={{ color: theme.textSecondary }}>
                  {t('stats.reactions', { count: reactionTotal })}
                </Text>
              ) : null}
              {(item.views_count ?? 0) > 0 ? (
                <Text className="text-xs" style={{ color: theme.textSecondary }}>
                  {t('stats.views', { count: item.views_count })}
                </Text>
              ) : null}
              {(item.share_count ?? 0) > 0 ? (
                <Text className="text-xs" style={{ color: theme.textSecondary }}>
                  {t('stats.shares', { count: item.share_count })}
                </Text>
              ) : null}
            </View>
            {commentsCount > 0 ? (
              isCommentable ? (
                <HeroButton
                  size="sm"
                  variant="ghost"
                  className="px-0"
                  onPress={handleCommentPress}
                  accessibilityLabel={t('stats.comments', { count: commentsCount })}
                >
                  <HeroButton.Label style={{ color: theme.textSecondary }}>
                    {t('stats.comments', { count: commentsCount })}
                  </HeroButton.Label>
                </HeroButton>
              ) : (
                <Text className="text-xs" style={{ color: theme.textSecondary }}>
                  {t('stats.comments', { count: commentsCount })}
                </Text>
              )
            ) : null}
          </View>
        ) : null}

        {/*
          🔴 `flex-wrap` is not cosmetic. This row is four controls wide at its widest
          (reaction, comment, share, save) and two of them carry text labels. That fits a
          411dp phone — the emulator and every Pixel — and on a **360dp** phone, a very
          common Android width, the save button was pushed past the card edge and clipped
          away entirely. Measured on 2026-08-20 by rendering the same card at both
          densities: present at 411dp, gone at 360dp. Wrapping means the row gets shorter
          rather than shorter-by-one-button, and nothing changes on a wide screen.
        */}
        <HeroCard.Footer className="flex-row flex-wrap items-center gap-2 px-4 py-3">
          {/*
            🔴 Gated on `canRespond`. This control used to render on EVERY card, including
            milestone cards where both the reaction and the like endpoint answer 400
            "Invalid target_type" — so the heart there could only ever fail, revert, and
            raise a "reaction failed" toast. Same fix, and same reasoning, as
            react-frontend/src/components/feed/FeedCard.tsx (Sentry NEXUS-PHP-1Y): a
            milestone is not user-authored content, there is nothing to react against, so
            it gets no control rather than a broken one.
          */}
          {canRespond ? (
            <HeroButton
              size="sm"
              variant={likeButtonActive ? 'secondary' : 'ghost'}
              onPress={handleLikePress}
              onPressIn={handleLikePressIn}
              onPressOut={handleLikePressOut}
              accessibilityLabel={likeButtonActive ? t('unlikePost') : t('likePost')}
              accessibilityHint={isReactable ? t('reaction.longPressHint') : undefined}
            >
              <Animated.View style={{ transform: [{ scale: heartBtnScale }] }}>
                {userReactionEmoji ? (
                  userReaction === 'time_credit' ? (
                    <Ionicons name="time-outline" size={18} color={primary} />
                  ) : (
                    <Text style={{ fontSize: 16 }}>{userReactionEmoji}</Text>
                  )
                ) : (
                  <Ionicons name={likeButtonActive ? 'heart' : 'heart-outline'} size={18} color={likeButtonActive ? primary : theme.textMuted} />
                )}
              </Animated.View>
              {(isReactable ? reactionTotal : likesCount) > 0 ? (
                <HeroButton.Label style={{ color: likeButtonActive ? primary : theme.textMuted }}>
                  {isReactable ? reactionTotal : likesCount}
                </HeroButton.Label>
              ) : null}
              {/*
                🔴 The eight emoji reactions were invisible. `ReactionBar` offers 👍 ❤️ 😂
                😮 😢 🎉 👏 ⏰, but the only way to reach it is a long press with no
                affordance — so the app looked as though it had one reaction, a heart.
                Reported as "the emojis are shit, there's just a heart". This chevron is
                the smallest honest fix: it says more is available without changing what a
                tap does (a tap stays a quick reaction, so nobody loses the fast path).
              */}
              {isReactable && !userReactionEmoji ? (
                <Ionicons name="chevron-up" size={11} color={theme.textMuted} />
              ) : null}
            </HeroButton>
          ) : null}

          {isCommentable ? (
            <HeroButton
              size="sm"
              variant={commentsVisible ? 'secondary' : 'ghost'}
              onPress={handleCommentPress}
              accessibilityLabel={commentsCount > 0 ? t('stats.comments', { count: commentsCount }) : t('comment')}
            >
              <Ionicons name="chatbubble-outline" size={17} color={theme.textMuted} />
              {/* Compact keeps the COUNT — that is information — and drops only the word. */}
              {!compactActions || commentsCount > 0 ? (
                <HeroButton.Label style={{ color: commentsVisible ? primary : theme.textMuted }}>
                  {compactActions
                    ? commentsCount
                    : commentsCount > 0
                      ? t('stats.comments', { count: commentsCount })
                      : t('comment')}
                </HeroButton.Label>
              ) : null}
            </HeroButton>
          ) : null}

          <HeroButton size="sm" variant="ghost" onPress={() => void handleShare()} accessibilityLabel={t('share')}>
            <Ionicons name="share-social-outline" size={17} color={theme.textMuted} />
            {compactActions ? null : (
              <HeroButton.Label style={{ color: theme.textMuted }}>{t('share')}</HeroButton.Label>
            )}
          </HeroButton>

          {canBookmark ? (
            /*
              🔴 Icon-only, so the label is the ONLY thing a screen reader can announce.
              It had none, and the icon glyph masked that: TalkBack read the private-use
              codepoint, so the control looked "named" in an accessibility dump. Found on
              2026-08-23 once decorative icons stopped reaching the tree. Its Share
              sibling above has carried a label all along. Reuses the same keys as the
              overflow menu entry below.
            */
            <HeroButton
              size="sm"
              variant={bookmarked ? 'secondary' : 'ghost'}
              onPress={() => void handleSave()}
              accessibilityLabel={bookmarked ? t('unsave') : t('save')}
            >
              <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={17} color={bookmarked ? primary : theme.textMuted} />
            </HeroButton>
          ) : null}
        </HeroCard.Footer>

        {isReactable ? (
          <ReactionBar
            visible={reactionBarVisible}
            userReaction={userReaction}
            primary={primary}
            onSelect={(type) => void performReact(type)}
            onDismiss={() => setReactionBarVisible(false)}
          />
        ) : null}
      </HeroCard>

      <ActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        actions={[
          { label: t('share'), icon: 'share-outline', onPress: () => void handleShare() },
          ...(canBookmark ? [{ label: bookmarked ? t('unsave') : t('save'), icon: bookmarked ? 'bookmark' : 'bookmark-outline', onPress: () => void handleSave() }] : []),
          ...(detailTarget ? [{ label: t(detailTarget.labelKey), icon: 'arrow-forward-outline', onPress: navigateToDetail }] : []),
          {
            label: t('notInterested'),
            icon: 'eye-off-outline',
            onPress: () => void runModeration(
              () => markFeedItemNotInterested(item.id, moderationTargetType),
              t('notInterestedToast'),
              false,
            ),
          },
          {
            label: t('hidePost'),
            icon: 'close-circle-outline',
            onPress: () => void runModeration(
              () => hideFeedItem(item.id, moderationTargetType),
              t('hiddenToast'),
              true,
            ),
          },
          // Muting is about a PERSON, so it is only offered on someone else's content —
          // and the label names them, because "Mute" alone does not say whom.
          ...(author.id && author.id !== currentUserId
            ? [{
                label: t('muteAuthor', { name: authorName }),
                icon: 'volume-mute-outline',
                onPress: () => void runModeration(
                  () => muteFeedAuthor(author.id as number),
                  t('mutedToast', { name: authorName }),
                  true,
                ),
              }]
            : []),
          {
            label: t('reportPost'),
            icon: 'flag-outline',
            destructive: true,
            onPress: () => setReportSheetVisible(true),
          },
        ]}
      />

      {/*
        The report sheet lives here, beside the action sheet, and both render from inside a
        FlatList row. That was impossible before 2026-08-21 — a portal opened from a row never
        became visible — which is why `CommentSheet` is hoisted to the screen instead. Now
        that sheets work, keeping this local means the card owns its own reporting.
      */}
      <BottomSheet
        visible={reportSheetVisible}
        onClose={() => setReportSheetVisible(false)}
        title={t('reportTitle')}
      >
        <View className="gap-3 pt-2">
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('reportIntro')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {REPORT_REASONS.map((reason) => {
              const selected = reportReason === reason;
              return (
                <NativePressable
                  key={reason}
                  onPress={() => setReportReason(reason)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t(`reportReason.${reason}`)}
                >
                  <Chip size="sm" variant={selected ? 'primary' : 'secondary'}>
                    <Chip.Label>{t(`reportReason.${reason}`)}</Chip.Label>
                  </Chip>
                </NativePressable>
              );
            })}
          </View>
          <HeroButton
            isDisabled={isReporting}
            onPress={() => void submitReport()}
            testID="feed-report-submit"
          >
            <HeroButton.Label>{t('reportSend')}</HeroButton.Label>
          </HeroButton>
        </View>
      </BottomSheet>
      {isCommentable && !onOpenComments ? (
        <CommentSheet
          visible={commentsVisible}
          targetType={item.type as CommentTargetType}
          targetId={item.id}
          initialCount={commentsCount}
          strings={{
            title: t('comment'),
            placeholder: t('exchanges:detail.commentPlaceholder'),
            empty: t('exchanges:detail.noComments'),
            loadFailed: t('exchanges:detail.commentsFailed'),
            submitFailed: t('exchanges:detail.commentFailed'),
            actionFailedTitle: t('exchanges:detail.actionFailedTitle'),
            send: t('common:buttons.send'),
            authorFallback: t('common:labels.member'),
            reply: t('exchanges:detail.commentReply'),
            replyingTo: t('exchanges:detail.commentReplyingTo'),
            edit: t('common:buttons.edit'),
            editing: t('exchanges:detail.commentEditing'),
            delete: t('common:buttons.delete'),
            deleteConfirmTitle: t('exchanges:detail.commentDeleteTitle'),
            deleteConfirmMessage: t('exchanges:detail.commentDeleteMessage'),
            edited: t('exchanges:detail.commentEdited'),
            cancel: t('common:buttons.cancel'),
            like: t('exchanges:detail.commentLike'),
            editFailed: t('exchanges:detail.commentEditFailed'),
            deleteFailed: t('exchanges:detail.commentDeleteFailed'),
          }}
          onClose={() => setCommentsVisible(false)}
          onCountChange={handleCommentsCountChange}
        />
      ) : null}
    </View>
  );
}

/**
 * Memoized: home.tsx re-renders on every comment-count / target change; without
 * memo every visible card re-rendered (animations re-initialised, images
 * re-evaluated). Rows only re-render when their own item or count changes.
 */
const FeedItem = memo(FeedItemInner, (prev, next) =>
  prev.item === next.item &&
  prev.commentsCountOverride === next.commentsCountOverride &&
  prev.disableDetailNavigation === next.disableDetailNavigation &&
  prev.onOpenComments === next.onOpenComments &&
  prev.onCommentsCountChange === next.onCommentsCountChange &&
  prev.onOpenReactors === next.onOpenReactors,
);

export default FeedItem;
