// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Feed Page - Social feed with posts, likes, comments, polls, and moderation
 *
 * Uses V2 API: GET /api/v2/feed, POST /api/v2/feed/posts, POST /api/v2/feed/like
 * Uses V2 API: GET /api/v2/comments, POST /api/v2/comments
 * Uses V2 API: POST /api/v2/feed/posts/{id}/hide, POST /api/v2/feed/users/{id}/mute
 * Uses V2 API: POST /api/v2/feed/posts/{id}/report
 * Uses V2 API: POST /api/v2/feed/polls, POST /api/v2/feed/polls/{id}/vote
 */

import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Newspaper from 'lucide-react/icons/newspaper';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ImagePlus from 'lucide-react/icons/image-plus';
import BarChart3 from 'lucide-react/icons/chart-column';
import TrendingUp from 'lucide-react/icons/trending-up';
import Flag from 'lucide-react/icons/flag';
import ArrowUp from 'lucide-react/icons/arrow-up';
import CircleX from 'lucide-react/icons/circle-x';
import ListFilter from 'lucide-react/icons/list-filter';
import { useTranslation } from 'react-i18next';
import { AlgorithmLabel } from '@/components/ui/AlgorithmLabel';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { filterAccentClasses } from '@/components/ui/filterAccent';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
import type { Key } from '@heroui/react/rac';
import { PageMeta } from '@/components/seo';
import type { ComposeTab } from '@/components/compose/types';
import { StoriesBar } from '@/components/feed/StoriesBar';
import { FeedFilterSheet } from '@/components/feed/FeedFilterSheet';
import { FeedModeToggle } from '@/components/feed/FeedModeToggle';
import { SubFilterChips } from '@/components/feed/SubFilterChips';
import { ConnectionSuggestionsWidget } from '@/components/feed/ConnectionSuggestionsWidget';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePusherOptional, type FeedPostEvent } from '@/contexts/PusherContext';
import { api } from '@/lib/api';
import { applyFeedSyncToItem, dispatchFeedSync, FEED_SYNC_EVENT, type FeedSyncPayload } from '@/lib/feedSync';
import { logError } from '@/lib/logger';
import { isAdminTier } from '@/lib/roles';
import { resolveAvatarUrl } from '@/lib/helpers';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';
import { usePageTitle } from '@/hooks';
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { resetImpressions } from '@/hooks/useFeedTracking';
import { FeedCard } from '@/components/feed/FeedCard';
import { FeedSkeleton } from '@/components/feed/FeedSkeleton';
import { FeedAdCard } from '@/components/feed/FeedAdCard';
import { MobileFAB } from '@/components/feed/MobileFAB';
import type { AdItem } from '@/components/feed/FeedAdCard';
import { FeedEmptyIllustration } from '@/components/illustrations';
import type { FeedItem, FeedFilter, PollData } from '@/components/feed/types';
import { getAuthor } from '@/components/feed/types';
import type { ReactionType } from '@/components/social';

const ComposeHub = lazy(() => import('@/components/compose').then((mod) => ({ default: mod.ComposeHub })));
const FeedSidebar = lazy(() => import('@/components/feed/sidebar/FeedSidebar'));

/* ───────────────────────── Constants ───────────────────────── */

const SCROLL_THRESHOLD = 200;
const FEED_MODE_KEY = 'nexus_feed_mode';
/**
 * The feed uses the tenant theme accent, shared with `FeedFilterSheet` through the
 * one accent map every filter primitive reads.
 *
 * NOTE: the feed's sticky region is deliberately NOT `MobileFilterBar`. That
 * primitive is phone-only (`sm:hidden`); `[data-testid="feed-controls"]` is one
 * element that is sticky on phones and a static card from `sm` up (`sm:static`,
 * asserted in FeedPage.test.tsx), so splitting it in two would change the ≥sm DOM.
 */
const FEED_ACCENT = filterAccentClasses('accent');
const VALID_FEED_FILTERS: FeedFilter[] = ['all', 'following', 'saved', 'posts', 'listings', 'events', 'polls', 'goals', 'jobs', 'challenges', 'volunteering', 'blogs', 'discussions'];
const FILTERS_WITH_SUBFILTERS = new Set<FeedFilter>(['listings']);

function coerceFeedFilter(value: string | null): FeedFilter {
  return value && VALID_FEED_FILTERS.includes(value as FeedFilter)
    ? (value as FeedFilter)
    : 'all';
}

function feedItemMatchesFilter(item: FeedItem, activeFilter: FeedFilter): boolean {
  switch (activeFilter) {
    case 'all':
      return true;
    case 'posts':
      return item.type === 'post';
    case 'listings':
      return item.type === 'listing';
    case 'events':
      return item.type === 'event';
    case 'polls':
      return item.type === 'poll';
    case 'goals':
      return item.type === 'goal';
    case 'jobs':
      return item.type === 'job';
    case 'challenges':
      return item.type === 'challenge';
    case 'volunteering':
      return item.type === 'volunteer';
    case 'blogs':
      return item.type === 'blog';
    case 'discussions':
      return item.type === 'discussion';
    case 'saved':
      return item.is_bookmarked === true;
    case 'following':
      return false;
    default: {
      const _exhaustiveCheck: never = activeFilter;
      void _exhaustiveCheck;
      return false;
    }
  }
}

/* ───────────────────────── Sidebar Error Boundary ───────────────────────── */


class SidebarErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { logError('Sidebar crash', { error, info }); }
  render() {
    if (this.state.hasError) return null; // Silently hide broken sidebar
    return this.props.children;
  }
}

/* ───────────────────────── Main Component ───────────────────────── */

export function FeedPage() {
  const { t } = useTranslation(['feed', 'common']);
  const confirm = useConfirm();
  usePageTitle(t('page_title'));
  // On phones the page hides its own hero card; the title lives in the app bar.
  useSetAppBarTitle(t('title'));
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();
  const pusher = usePusherOptional();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenantPath, tenant, hasFeature, hasModule } = useTenant();
  const showDesktopSidebar = useMediaQuery('(min-width: 1024px)');
  // Admin-tier gate aligned with the backend (BaseApiController::callerIsAdminTier):
  // includes god / is_god / is_tenant_super_admin, which the old inline check omitted
  // — those users saw no admin-delete option even though the API would allow it.
  const isAdmin = isAdminTier(user);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize filter from URL param, fallback to 'all'
  const [filter, setFilter] = useState<FeedFilter>(() => {
    return coerceFeedFilter(searchParams.get('filter'));
  });

  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Count of real-time posts received while the user hasn't scrolled to top
  const [pendingPostCount, setPendingPostCount] = useState(0);
  // Whether the user is scrolled past the top of the feed
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  // Buffer for real-time posts received while scrolled down
  const pendingPostsRef = useRef<FeedItem[]>([]);

  // Feed mode: EdgeRank vs chronological — persisted in URL + localStorage
  const [feedMode, setFeedMode] = useState<'ranking' | 'recent'>(() => {
    const urlMode = searchParams.get('mode');
    if (urlMode === 'ranking' || urlMode === 'recent') return urlMode;
    const stored = safeLocalStorageGet(FEED_MODE_KEY);
    return stored === 'ranking' || stored === 'recent' ? stored : 'ranking';
  });

  // Sub-filter (e.g. listings -> offers/requests) — synced to URL
  const [subFilter, setSubFilter] = useState<string | null>(() => {
    const initialFilter = coerceFeedFilter(searchParams.get('filter'));
    return FILTERS_WITH_SUBFILTERS.has(initialFilter) ? searchParams.get('subFilter') || null : null;
  });

  // Compose Hub
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const [composeDefaultTab, setComposeDefaultTab] = useState<ComposeTab>('listing');
  const openCompose = (tab: ComposeTab = 'listing') => { setComposeDefaultTab(tab); onCreateOpen(); };

  // Report modal
  const { isOpen: isReportOpen, onOpen: onReportOpen, onClose: onReportClose } = useDisclosure();
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const { isOpen: isFilterSheetOpen, onOpen: onFilterSheetOpen, onClose: onFilterSheetClose } = useDisclosure();
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  // Use a ref for cursor to avoid infinite re-render loop
  const cursorRef = useRef<string | undefined>(undefined);

  // Active ad creatives — stored in a ref so ad injection never triggers re-renders
  const adsRef = useRef<AdItem[]>([]);

  // Fetch ads once on mount — failures are silently swallowed so the feed is unaffected
  useEffect(() => {
    api.get<AdItem[]>('/v2/ads/active?placement=feed&limit=3')
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          adsRef.current = res.data;
        }
      })
      .catch((err) => logError('Failed to fetch feed ads', err));
  }, []);

  // Separate AbortControllers: initial/filter loads vs load-more appends
  // This prevents a fresh load from aborting an in-flight append (or vice versa)
  const abortRef = useRef<AbortController | null>(null);
  const appendAbortRef = useRef<AbortController | null>(null);

  // Sync filter, mode, and subFilter to URL query string without polluting history
  const syncToUrl = useCallback((updates: { filter?: FeedFilter; mode?: 'ranking' | 'recent'; subFilter?: string | null }) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (updates.filter !== undefined) {
        if (updates.filter === 'all') next.delete('filter');
        else next.set('filter', updates.filter);
        if (!FILTERS_WITH_SUBFILTERS.has(updates.filter)) next.delete('subFilter');
      }
      if (updates.mode !== undefined) {
        if (updates.mode === 'ranking') next.delete('mode');
        else next.set('mode', updates.mode);
      }
      if (updates.subFilter !== undefined) {
        if (!updates.subFilter) next.delete('subFilter');
        else next.set('subFilter', updates.subFilter);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Stable ref for loadFeed — avoids including it in useEffect deps which causes reset loops
  const loadFeedRef = useRef<(append?: boolean) => Promise<void>>(null!);

  // Stable ref for filter — prevents stale closure in Pusher callback (M5)
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  // Stable ref for feedMode — prevents stale closure in Pusher callback
  const feedModeRef = useRef(feedMode);
  useEffect(() => { feedModeRef.current = feedMode; }, [feedMode]);

  // Infinite scroll: auto-load when sentinel nears viewport
  const handleLoadMore = useCallback(() => { loadFeedRef.current?.(true); }, []);
  const infiniteScrollRef = useInfiniteScroll({
    hasMore,
    isLoading: isLoadingMore,
    onLoadMore: handleLoadMore,
  });

  // Pull-to-refresh: touch gesture on mobile
  const handlePullRefresh = useCallback(async () => { await loadFeedRef.current?.(); }, []);
  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    enabled: !isLoading,
  });


  const loadFeed = useCallback(async (append = false) => {
    // Use separate abort controllers so fresh loads don't cancel appends
    const ref = append ? appendAbortRef : abortRef;
    ref.current?.abort();
    const controller = new AbortController();
    ref.current = controller;

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        // Fresh load — also cancel any in-flight append to avoid stale data
        appendAbortRef.current?.abort();
        setIsLoading(true);
        setError(null);
        // Clear impression dedup set so each post fires again on the new load
        resetImpressions();
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');
      params.set('mode', feedMode === 'ranking' ? 'ranked' : 'chronological');
      // AG35 — explicit personalised flag mirrors the toggle so the backend
      // PersonalisedFeedService re-ranker is bypassed in "Recent" mode.
      params.set('personalised', feedMode === 'ranking' ? 'true' : 'false');
      params.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (filter !== 'all') params.set('type', filter);
      if (subFilter) params.set('subtype', subFilter);
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      const response = await api.get<FeedItem[]>(
        `/v2/feed?${params}`
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const feedItems = Array.isArray(response.data) ? response.data : [];

        if (append) {
          // Deduplicate: prevent double-rendering if API returns overlapping items
          setItems((prev) => {
            const existingKeys = new Set(prev.map((p) => `${p.type}-${p.id}`));
            const newItems = feedItems.filter((fi) => !existingKeys.has(`${fi.type}-${fi.id}`));
            return [...prev, ...newItems];
          });
        } else {
          setItems(feedItems);
        }
        setHasMore(response.meta?.has_more ?? false);
        cursorRef.current = response.meta?.cursor ?? undefined;
      } else {
        if (!append) {
          if (response.code === 'SESSION_EXPIRED') {
            navigate(tenantPath('/login'));
          } else {
            setError(tRef.current('error_load'));
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load feed', err);
      if (!append) {
        setError(tRef.current('error_load_retry'));
        // M9: Reset pending post count so stale buffered posts are discarded on failure
        setPendingPostCount(0);
        pendingPostsRef.current = [];
      }
    } finally {
      // Reset the loading flag by controller identity, not by abortedness. A
      // fresh load aborts the in-flight append (see the appendAbortRef.abort()
      // above); when that aborted append settles it must STILL clear
      // isLoadingMore here. Guarding on `!controller.signal.aborted` skipped it,
      // leaving isLoadingMore stuck true forever — which disables infinite
      // scroll, hides the "load more" button, and pins the skeletons on screen
      // until remount. `ref.current === controller` is true only for the most
      // recent call on this ref, so stale calls correctly skip the reset.
      if (ref.current === controller) {
        if (append) {
          setIsLoadingMore(false);
        } else {
          setIsLoading(false);
        }
      }
    }
  }, [filter, feedMode, subFilter, navigate, tenantPath]);

  // Keep loadFeedRef in sync with latest loadFeed
  loadFeedRef.current = loadFeed;

  // Track previous filter to detect filter changes and auto-reset subFilter
  const prevFilterRef = useRef(filter);
  useEffect(() => {
    // If the main filter changed and a subFilter was set, reset it.
    // Only early-return when the reset actually triggers a re-render — if subFilter
    // was already null, setSubFilter(null) is a no-op and the effect would never
    // re-fire, leaving loadFeed uncalled (the bug that made filter clicks do nothing).
    if (prevFilterRef.current !== filter) {
      prevFilterRef.current = filter;
      if (subFilter !== null) {
        setSubFilter(null);
        return;
      }
    }
    cursorRef.current = undefined;
    setPendingPostCount(0);
    pendingPostsRef.current = [];
    loadFeedRef.current();
    const currentAbort = abortRef.current;
    const currentAppendAbort = appendAbortRef.current;
    return () => { currentAbort?.abort(); currentAppendAbort?.abort(); };
  }, [filter, feedMode, subFilter]); // loadFeed via ref to avoid dependency loop

  /* ───────── Cross-page social state sync ───────── */
  // When a detail page (listing, event, post, etc.) changes a like or comment count,
  // it dispatches a FEED_SYNC_EVENT. We patch the matching item in-place so the feed
  // card reflects the change without a full reload.
  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<FeedSyncPayload>).detail;
      setItems((prev) => {
        const next = prev.map((item) => applyFeedSyncToItem(item, payload));
        if (filterRef.current === 'saved' && payload.patch.is_bookmarked === false) {
          return next.filter((item) => !(item.type === payload.targetType && item.id === payload.targetId));
        }
        return next;
      });
    };
    window.addEventListener(FEED_SYNC_EVENT, handler);
    return () => window.removeEventListener(FEED_SYNC_EVENT, handler);
  }, []);

  /* ───────── Scroll position tracking ───────── */

  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrolledDown = window.scrollY > SCROLL_THRESHOLD;
        setIsScrolledDown(scrolledDown);

        // If user scrolled back to top naturally, flush buffered posts.
        // In ranking mode we don't auto-flush on scroll — the banner stays visible
        // so the user can choose to reload (triggering EdgeRank re-sort) by tapping it.
        if (!scrolledDown && pendingPostsRef.current.length > 0 && feedModeRef.current === 'recent') {
          const buffered = [...pendingPostsRef.current];
          pendingPostsRef.current = [];
          setPendingPostCount(0);
          const currentFilter = filterRef.current;
          setItems((prev) => {
            const existingKeys = new Set(prev.map((p) => `${p.type}-${p.id}`));
            const newItems = buffered
              .filter((fi) => !existingKeys.has(`${fi.type}-${fi.id}`))
              .filter((fi) => feedItemMatchesFilter(fi, currentFilter));
            return [...newItems, ...prev];
          });
        }
        ticking = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  /* ───────── Real-time feed subscription ───────── */

  useEffect(() => {
    if (!pusher || isLoading) return;

    const unsub = pusher.onFeedPost((event: FeedPostEvent) => {
      const incoming = event.post;

      // C3: Validate tenant_id — discard posts from other tenants or events without a tenant_id
      if (!incoming.tenant_id || incoming.tenant_id !== tenant?.id) return;

      // If the post was created by the current user it is already prepended
      // optimistically by ComposeHub / the onSuccess reload, so skip it.
      if (user?.id && incoming.author?.id === user.id) return;

      // Only surface posts that match the active filter.
      // M5: Use filterRef.current so the closure always has the latest filter value.
      const currentFilter = filterRef.current;
      if (currentFilter === 'following') {
        setPendingPostCount((n) => n + 1);
        return;
      }
      const matchesFilter = feedItemMatchesFilter(incoming, currentFilter);

      if (!matchesFilter) return;

      // In ranking mode, never blindly prepend real-time posts — the EdgeRank algorithm
      // determines order, so live posts should be surfaced via the "new posts" banner
      // which triggers a full reload. Always buffer in ranking mode.
      if (feedModeRef.current === 'ranking' || window.scrollY > SCROLL_THRESHOLD) {
        pendingPostsRef.current = [incoming, ...pendingPostsRef.current];
        setPendingPostCount((n) => n + 1);
        return;
      }

      // Chronological mode at top of feed — prepend directly
      setItems((prev) => {
        // Guard against duplicates (e.g. race between Pusher event and manual reload)
        if (prev.some((p) => p.type === incoming.type && p.id === incoming.id)) {
          return prev;
        }
        return [incoming, ...prev];
      });
    });

    return unsub;
  }, [pusher, isLoading, user?.id, tenant?.id]);

  /* ───────── Like Toggle ───────── */

  const handleToggleLike = useCallback(async (item: FeedItem) => {
    // Optimistic update
    setItems((prev) =>
      prev.map((fi) =>
        fi.id === item.id && fi.type === item.type
          ? {
              ...fi,
              is_liked: !fi.is_liked,
              likes_count: fi.is_liked ? Math.max(0, fi.likes_count - 1) : fi.likes_count + 1,
            }
          : fi
      )
    );

    try {
      const res = await api.post('/v2/feed/like', {
        target_type: item.type,
        target_id: item.id,
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Like request failed');
      }
      const serverData = res.data as { action?: string; likes_count?: number } | undefined;
      const serverLikes = serverData?.likes_count;
      const serverLiked = serverData?.action === 'liked'
        ? true
        : serverData?.action === 'unliked'
          ? false
          : undefined;
      if (typeof serverLikes === 'number') {
        setItems((prev) =>
          prev.map((fi) =>
            fi.id === item.id && fi.type === item.type
              ? { ...fi, likes_count: serverLikes, is_liked: serverLiked ?? fi.is_liked }
              : fi
          )
        );
        dispatchFeedSync({
          targetType: item.type,
          targetId: item.id,
          patch: {
            likes_count: serverLikes,
            ...(serverLiked !== undefined ? { is_liked: serverLiked } : {}),
          },
        });
      }
    } catch (err) {
      logError('Failed to toggle like', err);
      // Revert on error
      setItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, is_liked: item.is_liked, likes_count: item.likes_count }
            : fi
        )
      );
      toastRef.current.error(tRef.current('toast.like_failed'));
    }
  }, []);

  /* ───────── Emoji Reaction ───────── */

  const handleReact = useCallback(async (item: FeedItem, reactionType: ReactionType) => {
    // Optimistic update
    const prevReactions = item.reactions ?? { counts: {}, total: 0, user_reaction: null, top_reactors: [] };
    const currentReaction = prevReactions.user_reaction;
    const newCounts = { ...prevReactions.counts };
    let newTotal = prevReactions.total;
    let newUserReaction: string | null;

    if (currentReaction === reactionType) {
      // Remove reaction
      newCounts[reactionType] = Math.max(0, (newCounts[reactionType] ?? 0) - 1);
      if (newCounts[reactionType] === 0) delete newCounts[reactionType];
      newTotal = Math.max(0, newTotal - 1);
      newUserReaction = null;
    } else {
      // Switch or add reaction
      if (currentReaction) {
        newCounts[currentReaction] = Math.max(0, (newCounts[currentReaction] ?? 0) - 1);
        if (newCounts[currentReaction] === 0) delete newCounts[currentReaction];
      } else {
        newTotal += 1;
      }
      newCounts[reactionType] = (newCounts[reactionType] ?? 0) + 1;
      newUserReaction = reactionType;
    }

    setItems((prev) =>
      prev.map((fi) =>
        fi.id === item.id && fi.type === item.type
          ? { ...fi, reactions: { ...prevReactions, counts: newCounts, total: newTotal, user_reaction: newUserReaction } }
          : fi
      )
    );

    try {
      // Polymorphic — works for post, listing, event, goal, poll, review, etc.
      // Previously hardcoded /v2/posts/{id}/reactions, which silently wrote
      // every non-post reaction against target_type='post' and made them
      // disappear on reload (the recurring "like doesn't persist" bug).
      const res = await api.post('/v2/reactions', {
        target_type: item.type,
        target_id: item.id,
        reaction_type: reactionType,
      });
      const resData = res.data as Record<string, unknown> | undefined;
      if (resData?.reactions) {
        const serverReactions = resData.reactions as FeedItem['reactions'];
        setItems((prev) =>
          prev.map((fi) =>
            fi.id === item.id && fi.type === item.type
              ? { ...fi, reactions: serverReactions }
              : fi
          )
        );
        dispatchFeedSync({
          targetType: item.type,
          targetId: item.id,
          patch: { reactions: serverReactions },
        });
      }
    } catch (err) {
      logError('Failed to react', err);
      // Revert on error
      setItems((prev) =>
        prev.map((fi) =>
          fi.id === item.id && fi.type === item.type
            ? { ...fi, reactions: prevReactions }
            : fi
        )
      );
    }
  }, []);

  /* ───────── Moderation ───────── */

  const handleHidePost = useCallback(async (item: FeedItem) => {
    try {
      const response = await api.post(`/v2/feed/posts/${item.id}/hide`, { type: item.type });
      if (response.success) {
        setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
        toastRef.current.success(tRef.current('toast.post_hidden'));
      } else {
        toastRef.current.error(response.error || tRef.current('toast.hide_failed'));
      }
    } catch (err) {
      logError('Failed to hide post', err);
      toastRef.current.error(tRef.current('toast.hide_failed'));
    }
  }, []);

  const handleMuteUser = useCallback(async (item: FeedItem) => {
    const userId = getAuthor(item).id;
    try {
      const response = await api.post(`/v2/feed/users/${userId}/mute`);
      if (response.success) {
        setItems((prev) => prev.filter((fi) => getAuthor(fi).id !== userId));
        toastRef.current.success(tRef.current('toast.user_muted'));
      } else {
        toastRef.current.error(response.error || tRef.current('toast.mute_failed'));
      }
    } catch (err) {
      logError('Failed to mute user', err);
      toastRef.current.error(tRef.current('toast.mute_failed'));
    }
  }, []);

  const openReportModal = useCallback((item: FeedItem) => {
    setReportTarget(item);
    setReportReason('');
    onReportOpen();
  }, [onReportOpen]);

  const handleReport = useCallback(async () => {
    if (!reportTarget || !reportReason.trim()) {
      toastRef.current.error(tRef.current('toast.provide_reason'));
      return;
    }

    try {
      setIsReporting(true);
      const response = await api.post(`/v2/feed/items/${reportTarget.type}/${reportTarget.id}/report`, {
        reason: reportReason.trim(),
      });
      if (response.success) {
        onReportClose();
        setReportTarget(null);
        setReportReason('');
        toastRef.current.success(tRef.current('toast.reported'));
      } else {
        toastRef.current.error(response.error || tRef.current('toast.report_failed'));
      }
    } catch (err) {
      logError('Failed to report post', err);
      toastRef.current.error(tRef.current('toast.report_failed'));
    } finally {
      setIsReporting(false);
    }
  }, [reportTarget, reportReason, onReportClose]);

  const handleDeletePost = useCallback(async (item: FeedItem) => {
    if (item.type !== 'post') return;
    const ok = await confirm({
      title: tRef.current('confirm.delete_post'),
      status: 'danger',
      confirmLabel: tRef.current('common:delete'),
    });
    if (!ok) return;
    try {
      const response = await api.delete(`/v2/feed/posts/${item.id}`);
      if (response.success) {
        setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
        toastRef.current.success(tRef.current('toast.deleted'));
      } else {
        toastRef.current.error(response.error || tRef.current('toast.delete_failed'));
      }
    } catch (err) {
      logError('Failed to delete post', err);
      toastRef.current.error(tRef.current('toast.delete_failed'));
    }
  }, [confirm]);

  const handleAdminDeletePost = useCallback(async (item: FeedItem) => {
    const ok = await confirm({
      title: tRef.current('confirm.delete_post'),
      status: 'danger',
      confirmLabel: tRef.current('common:delete'),
    });
    if (!ok) return;
    try {
      const sourceType = item.type || 'post';
      const response = await api.delete(`/v2/admin/feed/posts/${item.id}?type=${encodeURIComponent(sourceType)}`);
      if (response.success) {
        setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
        toastRef.current.success(tRef.current('toast.deleted'));
      } else {
        toastRef.current.error(response.error || tRef.current('toast.delete_failed'));
      }
    } catch (err) {
      logError('Failed to admin-delete post', err);
      toastRef.current.error(tRef.current('toast.delete_failed'));
    }
  }, [confirm]);

  /* ───────── Edit Post ───────── */

  const [editingItem, setEditingItem] = useState<FeedItem | null>(null);

  const handleEditPost = useCallback((item: FeedItem) => {
    setEditingItem(item);
    setComposeDefaultTab('post');
    onCreateOpen();
  }, [onCreateOpen]);

  const handleEditSuccess = useCallback((updatedItem: FeedItem) => {
    // Merge server response into existing item to preserve engagement counts, reactions, etc.
    setItems((prev) =>
      prev.map((fi) =>
        fi.id === updatedItem.id && (fi.type === updatedItem.type || updatedItem.type === undefined)
          ? { ...fi, content: updatedItem.content, updated_at: updatedItem.updated_at ?? new Date().toISOString() }
          : fi
      )
    );
    setEditingItem(null);
    onCreateClose();
  }, [onCreateClose]);

  const handleComposeClose = useCallback(() => {
    setEditingItem(null);
    onCreateClose();
  }, [onCreateClose]);

  /* ───────── Not Interested ───────── */

  const handleNotInterested = useCallback(async (item: FeedItem) => {
    // Optimistic removal — revert by re-inserting on failure
    setItems((prev) => prev.filter((fi) => !(fi.id === item.id && fi.type === item.type)));
    try {
      const response = await api.post(`/v2/feed/posts/${item.id}/not-interested`, { type: item.type });
      if (response.success) {
        toastRef.current.success(tRef.current('toast.not_interested'));
      } else {
        // Revert: re-insert the item (may not be in original position, but that's acceptable)
        setItems((prev) => {
          if (prev.some((fi) => fi.id === item.id && fi.type === item.type)) return prev;
          return [item, ...prev];
        });
        toastRef.current.error(response.error || tRef.current('toast.hide_failed'));
      }
    } catch (err) {
      logError('Failed to record not-interested', err);
      // Revert: re-insert the item (may not be in original position, but that's acceptable)
      setItems((prev) => {
        if (prev.some((fi) => fi.id === item.id && fi.type === item.type)) return prev;
        return [item, ...prev];
      });
      toastRef.current.error(tRef.current('toast.hide_failed'));
    }
  }, []);

  /* ───────── Poll Voting ───────── */

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
        toastRef.current.error(response.error || tRef.current('toast.vote_failed'));
      }
    } catch (err) {
      logError('Failed to vote', err);
      toastRef.current.error(tRef.current('toast.vote_failed'));
    }
  }, []);

  /* ───────── New-posts banner dismiss ───────── */

  const isScrollingRef = useRef(false);

  const handleScrollToNewPosts = useCallback(() => {
    if (isScrollingRef.current) return;
    isScrollingRef.current = true;
    setPendingPostCount(0);

    if (feedModeRef.current === 'ranking' || filterRef.current === 'following') {
      // Ranking and following both need a server pass: ranking must re-score,
      // and following requires relationship context that realtime events do not carry.
      pendingPostsRef.current = [];
      cursorRef.current = undefined;
      loadFeedRef.current();
    } else {
      // Chronological mode — flush buffered posts directly to the top
      const buffered = [...pendingPostsRef.current];
      pendingPostsRef.current = [];
      const currentFilter = filterRef.current;
      if (buffered.length > 0) {
        setItems((prev) => {
          const existingKeys = new Set(prev.map((p) => `${p.type}-${p.id}`));
          const newItems = buffered
            .filter((fi) => !existingKeys.has(`${fi.type}-${fi.id}`))
            .filter((fi) => feedItemMatchesFilter(fi, currentFilter));
          return [...newItems, ...prev];
        });
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { isScrollingRef.current = false; }, 1000);
  }, []);

  const handleFilterChange = useCallback((nextFilter: FeedFilter) => {
    setFilter(nextFilter);
    if (!FILTERS_WITH_SUBFILTERS.has(nextFilter)) {
      setSubFilter(null);
    }
    syncToUrl({
      filter: nextFilter,
      subFilter: FILTERS_WITH_SUBFILTERS.has(nextFilter) ? undefined : null,
    });
  }, [syncToUrl]);

  const clearFeedControls = useCallback(() => {
    setFilter('all');
    setSubFilter(null);
    syncToUrl({ filter: 'all', subFilter: null });
  }, [syncToUrl]);

  const filterOptions: { key: FeedFilter; label: string }[] = useMemo(() => [
    { key: 'all', label: t('filter.all') },
    ...(user ? [
      { key: 'following' as FeedFilter, label: t('filter.following') },
      { key: 'saved' as FeedFilter, label: t('filter.saved') },
    ] : []),
    { key: 'posts', label: t('filter.posts') },
    ...(hasModule('listings') ? [{ key: 'listings' as FeedFilter, label: t('filter.listings') }] : []),
    ...(hasFeature('events') ? [{ key: 'events' as FeedFilter, label: t('filter.events') }] : []),
    ...(hasFeature('polls') ? [{ key: 'polls' as FeedFilter, label: t('filter.polls') }] : []),
    ...(hasFeature('goals') ? [{ key: 'goals' as FeedFilter, label: t('filter.goals') }] : []),
    ...(hasFeature('job_vacancies') ? [{ key: 'jobs' as FeedFilter, label: t('filter.jobs') }] : []),
    ...(hasFeature('ideation_challenges') ? [{ key: 'challenges' as FeedFilter, label: t('filter.challenges') }] : []),
    ...(hasFeature('volunteering') ? [{ key: 'volunteering' as FeedFilter, label: t('filter.volunteering') }] : []),
    ...(hasFeature('blog') ? [{ key: 'blogs' as FeedFilter, label: t('filter.blogs') }] : []),
    ...(hasFeature('groups') ? [{ key: 'discussions' as FeedFilter, label: t('filter.discussions') }] : []),
  ], [hasFeature, hasModule, t, user]);

  const filterOptionsKey = filterOptions.map((option) => option.key).join(',');
  useEffect(() => {
    const validKeys = filterOptionsKey.split(',');
    if (!validKeys.includes(filter)) {
      handleFilterChange('all');
    }
  }, [filter, filterOptionsKey, handleFilterChange]);

  const hasActiveFeedView = filter !== 'all' || subFilter !== null;
  const activeFilterLabel = filterOptions.find((opt) => opt.key === filter)?.label ?? t('filter.all');
  const emptyDescription = filter !== 'all'
    ? t('empty_filtered_with_filter', { filter: activeFilterLabel })
    : t('empty_desc');


  return (
    <>
      <PageMeta
        title={t('title')}
        description={t('meta_description')}
        noIndex
      />
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-0 sm:px-2">
        {/* Main Feed Column */}
        <section className="w-full min-w-0 max-w-2xl flex-1 space-y-4" aria-label={t('feed.region_label')}>

      {/* Pull-to-refresh indicator (mobile only) */}
      {(pullDistance > 0 || isRefreshing) && (
        <div className="flex h-12 items-center justify-center overflow-hidden sm:hidden">
          <RefreshCw
            className={`w-5 h-5 text-accent transition-opacity ${isRefreshing || pullDistance > 48 ? 'animate-spin opacity-100' : 'opacity-60'}`}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Page header — hidden on phones (title lives in the app bar), full hero on ≥sm */}
      <section className="hidden overflow-hidden rounded-xl border border-theme-default bg-[var(--surface-base)] shadow-sm sm:block">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/15">
            <Newspaper className="w-5 h-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-balance text-3xl font-semibold leading-tight text-theme-primary">{t('title')}</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-theme-muted">{t('subtitle')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isLoading && items.length > 0 && (
              <Chip size="sm" variant="flat" className="bg-accent/10 text-accent">
                {t('items_loaded', { count: items.length })}
              </Chip>
            )}
            <AlgorithmLabel area="feed" />
            {isAuthenticated && (
              <Button
                className="bg-accent text-white shadow-sm"
                startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                onPress={() => openCompose('listing')}
              >
                {t('create')}
              </Button>
            )}
          </div>
        </div>
        <div className="border-t border-theme-default bg-theme-elevated/45 px-5 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-theme-muted">
            {t('feed.current_view', { filter: activeFilterLabel })}
          </p>
        </div>
      </section>

      {/* Feed controls */}
      <section
        data-testid="feed-controls"
        aria-label={t('controls_region_label')}
        className={`sticky top-[calc(var(--safe-area-top)+3.5rem)] z-20 w-full min-w-0 max-w-full space-y-3 overflow-hidden border-y border-theme-default bg-[var(--surface-base)]/95 px-3 py-2.5 shadow-sm backdrop-blur-md transition-[transform,opacity] duration-200 ${
          showMobileControls ? '' : 'pointer-events-none -translate-y-3 opacity-0'
        } sm:pointer-events-auto sm:static sm:z-auto sm:translate-y-0 sm:rounded-xl sm:border sm:px-4 sm:py-3 sm:opacity-100 sm:backdrop-blur-none`}
      >
        {/* Phone: mode toggle + filter-sheet trigger in one slim bar */}
        <div className="flex min-w-0 items-center gap-2 sm:hidden">
          <FeedModeToggle mode={feedMode} onModeChange={(mode) => { safeLocalStorageSet(FEED_MODE_KEY, mode); setFeedMode(mode); syncToUrl({ mode }); }} />
          <div className="flex-1" />
          <AlgorithmLabel area="feed" />
          <Button
            size="sm"
            variant="flat"
            radius="full"
            onPress={onFilterSheetOpen}
            startContent={<ListFilter className="h-4 w-4 shrink-0" aria-hidden="true" />}
            className={`min-w-0 px-3 ${
              hasActiveFeedView ? FEED_ACCENT.filtersButtonActive : FEED_ACCENT.filtersButtonIdle
            }`}
          >
            <span className="truncate">{hasActiveFeedView ? activeFilterLabel : t('filter.filters')}</span>
          </Button>
        </div>

        <div className="hidden min-w-0 items-center justify-between gap-3 sm:flex">
          <FeedModeToggle mode={feedMode} onModeChange={(mode) => { safeLocalStorageSet(FEED_MODE_KEY, mode); setFeedMode(mode); syncToUrl({ mode }); }} />
          {hasActiveFeedView && (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              className="text-theme-muted hover:text-accent"
              onPress={clearFeedControls}
              aria-label={t('filter.clear')}
            >
              <CircleX className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        <div className="hidden min-w-0 sm:block" role="group" aria-label={t('filter.select')}>
          {/*
            Desktop & up: a single-select ToggleButtonGroup is the idiomatic HeroUI v3
            component for a mutually-exclusive filter set. disallowEmptySelection keeps
            exactly one filter active. Phones use the FeedFilterSheet instead.
          */}
          <ToggleButtonGroup
            aria-label={t('filter.select')}
            selectionMode="single"
            disallowEmptySelection
            isDetached
            size="sm"
            selectedKeys={new Set<Key>([filter])}
            onSelectionChange={(keys) => {
              const [key] = Array.from(keys);
              if (key) handleFilterChange(key as FeedFilter);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            {filterOptions.map((opt) => (
              <ToggleButton
                key={opt.key}
                id={opt.key}
                variant="ghost"
                className="shrink-0 rounded-full border border-theme-default bg-theme-elevated px-3 text-theme-muted transition-colors hover:bg-accent/5 hover:text-accent data-[selected=true]:border-transparent data-[selected=true]:bg-accent data-[selected=true]:text-white data-[selected=true]:shadow-sm"
              >
                {opt.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>

        {/* Sub-Filter Chips (contextual, e.g. Listings -> Offers/Requests); in the sheet on phones */}
        {FILTERS_WITH_SUBFILTERS.has(filter) && (
          <div className="hidden sm:block">
            <SubFilterChips filter={filter} subFilter={subFilter} onSubFilterChange={(sf) => { setSubFilter(sf); syncToUrl({ subFilter: sf }); }} />
          </div>
        )}
      </section>

      {/* Phone filter sheet — all filters + contextual sub-filters */}
      <FeedFilterSheet
        isOpen={isFilterSheetOpen}
        onClose={onFilterSheetClose}
        options={filterOptions}
        filter={filter}
        onFilterChange={handleFilterChange}
        filtersWithSubFilters={FILTERS_WITH_SUBFILTERS}
        subFilter={subFilter}
        onSubFilterChange={(sf) => { setSubFilter(sf); syncToUrl({ subFilter: sf }); }}
      />

      {/* Stories Bar — loads its own data from /v2/stories */}
      {isAuthenticated && (
        <StoriesBar />
      )}

      {/* Quick Post Box */}
      {isAuthenticated && (
        <GlassCard className="p-3.5 transition-colors hover:border-accent/20 sm:p-4">
          {/*
            The composer trigger is a real <button> (HeroUI Button), with the two
            quick-action icon buttons as siblings rather than nested children — so
            there are no interactive elements inside a pressable region (which would
            be invalid button-in-button markup) and no stopPropagation hack is needed.
          */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar
                name={user?.first_name || t('you')}
                src={resolveAvatarUrl(user?.avatar)}
                size="sm"
                isBordered
                className="shrink-0 ring-2 ring-[var(--border-default)]"
              />
              <Button
                variant="flat"
                onPress={() => openCompose('listing')}
                aria-label={t('whats_on_your_mind')}
                className="min-h-11 flex-1 justify-start rounded-full border border-theme-default bg-theme-elevated px-4 py-2.5 text-left text-sm font-normal text-theme-subtle transition-colors hover:border-accent/30 hover:bg-theme-elevated"
              >
                <span className="line-clamp-1">{t('whats_on_your_mind')}</span>
              </Button>
            </div>
            <div className="flex shrink-0 justify-end gap-1">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className="text-theme-muted"
                onPress={() => openCompose('post')}
                aria-label={t('add_image_aria')}
              >
                <ImagePlus className="w-4 h-4" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className="text-theme-muted"
                onPress={() => openCompose('poll')}
                aria-label={t('create_poll_aria')}
              >
                <BarChart3 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </GlassCard>
      )}

      {/* New posts floating chip — appears when real-time posts arrive while scrolled down */}
      <AnimatePresence>
        {pendingPostCount > 0 && (feedMode === 'ranking' || filter === 'following' || isScrolledDown) && (
          <motion.div
            key="new-posts-chip"
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50"
            role="status"
            aria-live="polite"
            aria-label={t('new_posts_available')}
          >
            <Chip
              as="button"
              color="primary"
              variant="shadow"
              size="lg"
              classNames={{
                base: 'cursor-pointer bg-gradient-to-r from-accent to-accent-gradient-end shadow-lg shadow-accent/30 hover:shadow-accent/50 transition-shadow px-4 py-2 min-h-9',
                content: 'flex items-center gap-2 text-white font-medium text-sm',
              }}
              startContent={<ArrowUp className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
              onClick={handleScrollToNewPosts}
            >
              {t('realtime.new_posts', { count: pendingPostCount })}
            </Chip>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="px-5 py-10 text-center sm:p-12" glow="primary" role="alert">
          <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-5 ring-1 ring-warning/20">
            <AlertTriangle className="w-8 h-8 text-[var(--color-warning)]" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h2>
          <p className="mx-auto mb-2 max-w-sm text-sm leading-6 text-theme-muted">{error}</p>
          <p className="mx-auto mb-6 max-w-sm text-xs leading-5 text-theme-subtle">{t('error_hint')}</p>
          <Button
            className="bg-accent text-white shadow-lg shadow-accent/20"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadFeed()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Feed Items */}
      {!error && (
        <>
          {isLoading ? (
            <div className="space-y-4" role="status" aria-live="polite" aria-label={t('loading_label')}>
              <div className="rounded-xl border border-theme-default bg-theme-elevated/50 px-4 py-3 text-sm text-theme-muted">
                {t('loading_label')}
              </div>
              {[0, 1, 2].map((i) => (
                <FeedSkeleton key={i} index={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <GlassCard className="px-5 py-12 text-center sm:p-12">
              <div className="mx-auto mb-6">
                <FeedEmptyIllustration className="w-32 h-32 mx-auto" />
              </div>
              <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('empty_title')}</h2>
              <p className="text-sm leading-6 text-theme-muted mb-6 max-w-sm mx-auto">
                {emptyDescription}
              </p>
              <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
              {filter !== 'all' && (
                <Button
                  variant="flat"
                  className="text-theme-muted"
                  onPress={clearFeedControls}
                >
                  {t('filter.show_all')}
                </Button>
              )}
              {isAuthenticated && (
                <Button
                  className="bg-accent text-white shadow-lg shadow-accent/20"
                  startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                  onPress={() => openCompose('listing')}
                >
                  {t('create')}
                </Button>
              )}
              </div>
            </GlassCard>
          ) : (
            <motion.div
              key={`${filter}-${subFilter ?? ''}-${feedMode}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <AnimatePresence>
                {items.map((item, index) => (
                  <React.Fragment key={`${item.type}-${item.id}`}>
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, overflow: 'hidden' }} transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.4) }}>
                      <FeedCard
                        item={item}
                        onToggleLike={handleToggleLike}
                        onReact={handleReact}
                        onHidePost={handleHidePost}
                        onMuteUser={handleMuteUser}
                        onReportPost={openReportModal}
                        onDeletePost={handleDeletePost}
                        onAdminDeletePost={isAdmin ? handleAdminDeletePost : undefined}
                        onEditPost={handleEditPost}
                        onNotInterested={handleNotInterested}
                        onVotePoll={handleVotePoll}
                        feedMode={feedMode}
                        isAuthenticated={isAuthenticated}
                        currentUserId={user?.id}
                        currentUserAvatar={user?.avatar}
                        currentUserName={user?.first_name || user?.name}
                        isAdmin={isAdmin}
                      />
                    </motion.div>
                    {/* Show connection suggestions inline on mobile after every 10 posts */}
                    {index === 9 && isAuthenticated && (
                      <div className="lg:hidden">
                        <ConnectionSuggestionsWidget layout="inline" />
                      </div>
                    )}
                    {/* Inject an ad after every 8th real feed item (index 7, 15, 23...) */}
                    {(index + 1) % 8 === 0 && (() => {
                      try {
                        const ads = adsRef.current;
                        if (ads.length === 0) return null;
                        const adIndex = Math.floor((index + 1) / 8) - 1;
                        const ad = ads[adIndex % ads.length];
                        if (!ad) return null;
                        return (
                          <motion.div
                            key={`ad-${ad.campaign_id}-${adIndex}`}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25 }}
                          >
                            <FeedAdCard ad={ad} />
                          </motion.div>
                        );
                      } catch {
                        return null;
                      }
                    })()}
                  </React.Fragment>
                ))}
              </AnimatePresence>

              {/* Infinite scroll sentinel — triggers auto-load before user reaches bottom */}
              {hasMore && <div ref={infiniteScrollRef} className="h-1" aria-hidden="true" />}

              {/* End-of-feed message */}
              {!hasMore && items.length > 0 && !isLoading && (
                <div className="text-center py-10">
                  <Chip
                    variant="flat"
                    className="border border-theme-default bg-theme-elevated text-theme-muted"
                    startContent={<span className="w-1.5 h-1.5 rounded-full bg-accent/60" aria-hidden="true" />}
                    endContent={<span className="w-1.5 h-1.5 rounded-full bg-accent/60" aria-hidden="true" />}
                  >
                    {t('feed.end_of_feed')}
                  </Chip>
                </div>
              )}

              {/* Manual fallback: visible only when more items exist but NOT currently loading */}
              {hasMore && !isLoadingMore && (
                <div className="pt-6 pb-2 text-center">
                  <Button
                    variant="bordered"
                    className="border-theme-default text-theme-muted hover:border-accent hover:text-accent transition-colors"
                    onPress={() => loadFeed(true)}
                    startContent={<TrendingUp className="w-4 h-4" aria-hidden="true" />}
                  >
                    {t('load_more')}
                  </Button>
                </div>
              )}

              {/* Pagination loading skeletons */}
              {isLoadingMore && (
                <div className="space-y-4 pt-2">
                  {[0, 1].map((i) => (
                    <FeedSkeleton key={`load-more-skeleton-${i}`} index={i} />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </>
      )}

      {/* Compose Hub */}
      {(isCreateOpen || editingItem) && (
        <Suspense fallback={null}>
          <ComposeHub
            isOpen={isCreateOpen}
            onClose={handleComposeClose}
            defaultTab={composeDefaultTab}
            editItem={editingItem}
            onEditSuccess={handleEditSuccess}
            onSuccess={(type) => {
              if (type === 'poll') {
                navigate(tenantPath('/polls'));
              } else {
                cursorRef.current = undefined;
                loadFeed();
              }
            }}
          />
        </Suspense>
      )}

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
          <ModalHeader className="flex items-center gap-3 text-theme-primary">
            <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center">
              <Flag className="w-4 h-4 text-danger" aria-hidden="true" />
            </div>
            <ModalHeading>{t('report.title')}</ModalHeading>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-theme-muted mb-3">
              {t('report.description')}
            </p>
            <Textarea
              label={t('report.reason_label')}
              placeholder={t('report.reason_placeholder')}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              minRows={3}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={onReportClose}
              className="text-theme-muted"
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
      </section>

      {/* Right Sidebar — full widget panel in normal document flow. */}
      {showDesktopSidebar && (
        <aside data-testid="feed-sidebar-panel" aria-label={t('aria.feed_sidebar')} className="static hidden w-72 shrink-0 self-start lg:block">
          <SidebarErrorBoundary>
            <Suspense fallback={null}>
              <FeedSidebar />
            </Suspense>
          </SidebarErrorBoundary>
        </aside>
      )}
    </div>

    {isAuthenticated && <MobileFAB onPress={() => openCompose('listing')} />}
</>
  );
}

export default FeedPage;
