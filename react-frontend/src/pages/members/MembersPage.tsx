// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Alert } from '@/components/ui/Alert';
import { AlgorithmLabel, useAlgorithmInfo } from '@/components/ui/AlgorithmLabel';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import Search from 'lucide-react/icons/search';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import { MobileFilterBar, type MobileFilterBarChip } from '@/components/ui/MobileFilterBar';
import { MemberFilterSheet, type MemberFilterDraft } from '@/components/members/MemberFilterSheet';
// Direct hook paths on purpose: page tests partial-mock the '@/hooks' barrel, so a
// barrel import of these would resolve to undefined and crash every test.
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { persistRadiusPreference, useSavedRadiusKm } from '@/hooks/useSavedRadiusKm';
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { MemberCardSkeleton } from '@/components/ui/Skeletons';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { Tooltip } from '@/components/ui/Tooltip';
/**
 * Members Page - Community member directory
 */

import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef, memo, type ComponentType } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Users from 'lucide-react/icons/users';
import MapPin from 'lucide-react/icons/map-pin';
import Star from 'lucide-react/icons/star';
import Clock from 'lucide-react/icons/clock';
import Filter from 'lucide-react/icons/filter';
import Grid from 'lucide-react/icons/grid-3x3';
import List from 'lucide-react/icons/list';
import MapIcon from 'lucide-react/icons/map';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import X from 'lucide-react/icons/x';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Sparkles from 'lucide-react/icons/sparkles';
import TrendingUp from 'lucide-react/icons/trending-up';
import BadgeCheck from 'lucide-react/icons/badge-check';
import UserCircle from 'lucide-react/icons/circle-user';
import { useTranslation } from 'react-i18next';
import { PresenceIndicator } from '@/components/social/PresenceIndicator';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { PageMeta } from '@/components/seo';
import { useAuth, useToast, useTenant, useFeature } from '@/contexts';
import { usePresenceOptional } from '@/contexts/PresenceContext';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';
import { MAPS_ENABLED } from '@/lib/map-config';
import { usePageTitle } from '@/hooks';
import type { EntityMapViewProps } from '@/components/location/EntityMapView';
import type { User } from '@/types/api';

const LazyEntityMapView = lazy(() =>
  import('@/components/location/EntityMapView').then((module) => ({
    default: module.EntityMapView,
  })),
) as ComponentType<EntityMapViewProps<User>>;

type SortOption = 'communityrank' | 'name' | 'joined' | 'rating' | 'hours_given';
type ViewMode = 'grid' | 'list' | 'map';
type QuickFilter = 'all' | 'new' | 'active';

const ITEMS_PER_PAGE = 24;
const SEARCH_DEBOUNCE_MS = 300;

const VALID_SORTS: SortOption[] = ['communityrank', 'name', 'joined', 'rating', 'hours_given'];
const VALID_VIEW_MODES: ViewMode[] = ['grid', 'list', 'map'];
const DEFAULT_RADIUS_KM = 25;

/** Sort key → the label the phone applied-filter chip shows. */
const SORT_LABEL_KEYS: Record<SortOption, string> = {
  communityrank: 'members.sort_communityrank',
  name: 'members.sort_name',
  joined: 'members.sort_newest',
  rating: 'members.sort_rated',
  hours_given: 'members.sort_active',
};

interface MembersQueryValues {
  q: string;
  sort: SortOption;
  /** Nearby mode swaps the endpoint and drops sort/order entirely. */
  nearby: boolean;
  lat?: number | null;
  lon?: number | null;
  radiusKm: number;
  limit: number;
  offset?: number;
}

/**
 * Single source of truth for filter → API request, used by the grid fetch AND by
 * the phone sheet's live count probe so the two can never drift. The parameter
 * order is deliberate: it reproduces the shipped query strings exactly, which the
 * page's tests assert on.
 */
function buildMembersQuery(v: MembersQueryValues): { endpoint: string; params: URLSearchParams } {
  const params = new URLSearchParams();
  if (v.q) params.set('q', v.q);
  if (!v.nearby) {
    params.set('sort', v.sort);
    // Quick filters imply descending order for joined and hours_given
    if (v.sort === 'joined' || v.sort === 'hours_given') {
      params.set('order', 'desc');
    }
  }
  params.set('limit', String(v.limit));
  if (v.offset != null && v.offset > 0) {
    params.set('offset', String(v.offset));
  }
  if (v.nearby) {
    params.set('lat', String(v.lat));
    params.set('lon', String(v.lon));
    params.set('radius_km', String(v.radiusKm));
  }
  return { endpoint: v.nearby ? '/v2/members/nearby' : '/v2/users', params };
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

export function MembersPage() {
  const { t } = useTranslation('common');
  usePageTitle(t('members.title'));
  // On phones the page hides its own hero; the title lives in the app bar.
  useSetAppBarTitle(t('members.title'));
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const [members, setMembers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  // Size of the whole community, for the note explaining why the directory is
  // smaller. The note deliberately reuses totalCount as its "listed" figure
  // rather than the API's directory_total: CommunityRank caches its result for
  // three minutes while the count is live, so the two can briefly disagree, and
  // one screen must never show two different answers to the same question.
  const [communityTotal, setCommunityTotal] = useState<number | null>(null);
  const [directoryCriteria, setDirectoryCriteria] = useState<string[]>([]);

  // Quick filter state
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  // Native-app search: phones open a full-screen overlay with recents instead
  // of typing into the inline filter field. Desktop keeps the inline field.
  const isPhone = useMediaQuery('(max-width: 639px)');
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const rawSort = searchParams.get('sort');
  const initialSort: SortOption | null = rawSort && (VALID_SORTS as string[]).includes(rawSort) ? rawSort as SortOption : null;
  const [sortBy, setSortBy] = useState<SortOption | null>(initialSort);
  const storedViewMode = safeLocalStorageGet('members_view_mode');
  const [viewMode, setViewMode] = useState<ViewMode>(
    storedViewMode && (VALID_VIEW_MODES as string[]).includes(storedViewMode) ? storedViewMode as ViewMode : 'grid'
  );
  const [nearMeEnabled, setNearMeEnabled] = useState(false);
  // Members hand-rolls its radius control rather than using ProximityFilter, so
  // it needs the saved preference wired up separately. Starts at the fallback
  // and adopts the member's saved radius once it resolves, unless they have
  // already changed it on this page.
  const savedRadiusKm = useSavedRadiusKm();
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const radiusTouchedRef = useRef(false);

  useEffect(() => {
    if (!radiusTouchedRef.current) {
      setRadiusKm(savedRadiusKm);
    }
  }, [savedRadiusKm]);
  const { user, isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();
  const hasMapsFeature = useFeature('maps');
  const canUseMapView = MAPS_ENABLED && hasMapsFeature;
  const membersAlgorithm = useAlgorithmInfo('members');
  const defaultSort: SortOption | null = membersAlgorithm
    ? membersAlgorithm.key === 'communityrank'
      ? 'communityrank'
      : 'name'
    : membersAlgorithm === null
      ? 'name'
      : null;
  const activeSortBy = sortBy ?? defaultSort;
  const isNearbyMode = nearMeEnabled && user?.latitude != null && user?.longitude != null;

  /**
   * Explain the gap between "people who have joined" and "people this directory
   * may list" — but only when there is a gap. A community holding nobody back
   * gets no apology for an absence that does not exist, and a member who is
   * searching or using Near me is looking at their own filter, not at this.
   */
  const showCoverageNote =
    !isNearbyMode &&
    !debouncedQuery &&
    !isLoading &&
    totalCount !== null &&
    communityTotal !== null &&
    totalCount < communityTotal;

  // Refs
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const membersCountRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Keep ref in sync for offset calculation without stale closures
  useEffect(() => { membersCountRef.current = members.length; }, [members.length]);

  // Persist view mode — never let a full or blocked localStorage crash the page.
  // A bare preference write is tiny; a QuotaExceededError here means storage is
  // already full of something else, and the preference simply won't persist.
  useEffect(() => {
    safeLocalStorageSet('members_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!canUseMapView && viewMode === 'map') {
      setViewMode('grid');
    }
  }, [canUseMapView, viewMode]);

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort();
    };
  }, []);

  // Handle quick filter selection
  const handleQuickFilter = useCallback((filter: QuickFilter) => {
    setQuickFilter(filter);
    if (filter === 'new') {
      setSortBy('joined');
    } else if (filter === 'active') {
      setSortBy('hours_given');
    } else {
      setSortBy(defaultSort ?? 'name');
    }
  }, [defaultSort]);

  // Sync quickFilter when sortBy changes from the Select dropdown
  useEffect(() => {
    if (activeSortBy === 'joined') {
      setQuickFilter('new');
    } else if (activeSortBy === 'hours_given') {
      setQuickFilter('active');
    } else {
      setQuickFilter('all');
    }
  }, [activeSortBy]);

  // Load members
  const loadMembers = useCallback(async (append = false) => {
    if (!activeSortBy) {
      return;
    }

    const requestId = ++requestIdRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const { endpoint, params } = buildMembersQuery({
        q: debouncedQuery,
        sort: activeSortBy,
        nearby: isNearbyMode,
        lat: user?.latitude,
        lon: user?.longitude,
        radiusKm,
        limit: ITEMS_PER_PAGE,
        offset: append ? membersCountRef.current : undefined,
      });

      const response = await api.get<User[]>(`${endpoint}?${params}`, { signal: controller.signal });

      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return;
      }

      if (response.success && response.data) {
        if (append) {
          setMembers((prev) => [...prev, ...response.data!]);
        } else {
          setMembers(response.data);
        }
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);

        // Get total count from response meta if available
        if (response.meta?.total_items !== undefined) {
          setTotalCount(response.meta.total_items);
        }
        // Community-wide context. Only /v2/users returns these — the nearby
        // endpoint does not, and leaving the last values in place there would
        // caption a distance-limited list with directory-wide numbers.
        setCommunityTotal(response.meta?.community_total ?? null);
        setDirectoryCriteria(response.meta?.directory_criteria ?? []);
      } else {
        if (!append) {
          setError(t('members.load_failed'));
        } else {
          toast.error(t('members.load_more_failed'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return;
      }
      logError('Failed to load members', err);
      if (!append) {
        setError(t('members.load_failed'));
      } else {
        toast.error(t('members.load_more_failed'));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [activeSortBy, debouncedQuery, t, toast, isNearbyMode, user?.latitude, user?.longitude, radiusKm]);

  // Load more
  const loadMoreMembers = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    loadMembers(true);
  }, [isLoadingMore, hasMore, loadMembers]);

  // Presence context for fetching online status
  const presence = usePresenceOptional();

  // Load on mount and when filters change
  useEffect(() => {
    if (!activeSortBy) {
      return;
    }
    loadMembers();
    // Reset pagination state when filters change
    setHasMore(true);
    setTotalCount(null);
  }, [activeSortBy, debouncedQuery, nearMeEnabled, user?.id, user?.latitude, user?.longitude, radiusKm]); // eslint-disable-line react-hooks/exhaustive-deps -- reset pagination on filter change; user.id retries on login/token-refresh

  // Fetch presence for visible members
  useEffect(() => {
    if (members.length > 0 && presence) {
      const userIds = members.map((m) => m.id);
      presence.fetchPresence(userIds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch presence when member list updates; presence excluded (stable ref)
  }, [members]);

  // Update URL params
  useEffect(() => {
    if (!activeSortBy || !defaultSort) {
      return;
    }
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (activeSortBy !== defaultSort) params.set('sort', activeSortBy);
    setSearchParams(params, { replace: true });
  }, [activeSortBy, debouncedQuery, defaultSort, setSearchParams]);

  function handleNearMeToggle() {
    if (nearMeEnabled) {
      setNearMeEnabled(false);
      return;
    }
    if (user?.latitude == null || user?.longitude == null) {
      toast.error(t('members.near_me_no_location'));
      return;
    }
    setSortBy(null);  // reset sort when entering nearby mode
    setNearMeEnabled(true);
  }

  function resetSearch() {
    setSearchQuery('');
    setDebouncedQuery('');
  }

  // ── Phone filter sheet (draft state — nothing applies until the footer button) ──
  // The draft machine (snapshot / patch / debounced count probe / apply) lives in
  // useFilterDraft; only the members-specific pieces stay here.

  const canUseNearMe = user?.latitude != null && user?.longitude != null;

  // Applied-filter snapshot for the probe's short-circuit. A ref, so the probe
  // never re-fires merely because the grid finished loading.
  const appliedFiltersRef = useRef({ sort: activeSortBy, nearby: isNearbyMode, radiusKm, total: totalCount });
  appliedFiltersRef.current = { sort: activeSortBy, nearby: isNearbyMode, radiusKm, total: totalCount };

  /**
   * Live result count for the sheet footer — a cheap limit=1 fetch of the draft
   * filters. Debounced hard (400ms) and short-circuited while the draft still
   * matches the applied filters: /v2/users is rate-limited 60/60s and a
   * communityrank total ranks the whole tenant, so a probe per tap is expensive.
   */
  const countDraftMembers = useCallback(async (candidate: MemberFilterDraft, signal: AbortSignal) => {
    const nearby = candidate.nearMe && canUseNearMe;
    const applied = appliedFiltersRef.current;
    // Nearby mode ignores sort server-side, and non-nearby ignores the radius, so
    // only the dimension that actually reaches the query has to match.
    const sameAsApplied = nearby === applied.nearby
      && (nearby ? candidate.radiusKm === applied.radiusKm : candidate.sort === applied.sort);
    if (sameAsApplied && applied.total != null) {
      return applied.total;
    }
    const { endpoint, params } = buildMembersQuery({
      q: debouncedQuery,
      sort: candidate.sort,
      nearby,
      lat: user?.latitude,
      lon: user?.longitude,
      radiusKm: candidate.radiusKm,
      limit: 1,
    });
    const response = await api.get<User[]>(`${endpoint}?${params}`, { signal });
    return response.success ? (response.meta?.total_items ?? null) : null;
  }, [debouncedQuery, canUseNearMe, user?.latitude, user?.longitude]);

  const commitDraftFilters = useCallback((next: MemberFilterDraft) => {
    const nearby = next.nearMe && user?.latitude != null && user?.longitude != null;
    if (next.nearMe && !nearby) {
      // Same guard as handleNearMeToggle — nearby needs coordinates on the profile.
      toast.error(t('members.near_me_no_location'));
    }
    radiusTouchedRef.current = true;
    persistRadiusPreference(next.radiusKm);
    setRadiusKm(next.radiusKm);
    setNearMeEnabled(nearby);
    // Nearby mode ignores sort server-side, so entering it drops the explicit sort
    // exactly like handleNearMeToggle does.
    setSortBy(nearby ? null : next.sort);
  }, [user?.latitude, user?.longitude, toast, t]);

  /** What "Clear all" resets to inside the sheet — sort returns to the tenant default. */
  const emptyMemberDraft = useMemo<Partial<MemberFilterDraft>>(
    () => ({ sort: defaultSort ?? 'name', nearMe: false, radiusKm: DEFAULT_RADIUS_KM }),
    [defaultSort],
  );

  const filterSheet = useFilterDraft<MemberFilterDraft>({
    onApply: commitDraftFilters,
    emptyDraft: emptyMemberDraft,
    countFor: countDraftMembers,
    countKey: `${debouncedQuery}|${user?.latitude ?? ''}|${user?.longitude ?? ''}`,
    debounceMs: 400,
  });
  const { open: openDraft } = filterSheet;

  const openFilterSheet = useCallback(() => {
    openDraft({
      sort: activeSortBy ?? defaultSort ?? 'name',
      nearMe: nearMeEnabled,
      radiusKm,
    }, totalCount);
  }, [openDraft, activeSortBy, defaultSort, nearMeEnabled, radiusKm, totalCount]);

  /**
   * Phone: removable chips for the applied filters. The query itself shows in the
   * search pill, and "removing" a sort means returning to the tenant default —
   * there is always some sort in effect.
   */
  const phoneFilterChips = useMemo<MobileFilterBarChip[]>(() => {
    const chips: MobileFilterBarChip[] = [];
    if (activeSortBy && defaultSort && activeSortBy !== defaultSort) {
      chips.push({
        key: 'sort',
        label: t(SORT_LABEL_KEYS[activeSortBy]),
        onRemove: () => setSortBy(null),
      });
    }
    if (nearMeEnabled) {
      chips.push({
        key: 'near',
        label: t('members.nearby_filter', { radius: radiusKm }),
        onRemove: () => setNearMeEnabled(false),
      });
    }
    return chips;
  }, [activeSortBy, defaultSort, nearMeEnabled, radiusKm, t]);

  const resetPhoneFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSortBy(null);
    setNearMeEnabled(false);
    // "Clear all" returns to the member's saved radius, not the platform
    // fallback — clearing filters should not discard their preference.
    radiusTouchedRef.current = false;
    setRadiusKm(savedRadiusKm);
  }, [savedRadiusKm]);

  return (
    <div className="space-y-5">
      <PageMeta title={t('page_meta.members.title')} description={t('page_meta.members.description')} noIndex />
      {/* The hero owns this page's only <h1> and is hidden on phones, where the
          title moves into the app bar as plain text — leaving a phone with no
          heading to orient by. Keep one for screen readers. Mirrors BlogPage. */}
      {isPhone && <h1 className="sr-only">{t('members.title')}</h1>}
      {/* Phones hide the hero entirely — the title lives in the app bar (useSetAppBarTitle). */}
      {!isPhone && (
      <PublicPageHero
        eyebrow={t('members.hero_eyebrow')}
        title={t('members.title')}
        description={t('members.subtitle')}
        icon={<Users className="h-6 w-6" aria-hidden="true" />}
        accent="blue"
        stats={totalCount != null && !isLoading ? [{ label: t('members.count_label'), value: totalCount.toLocaleString(getFormattingLocale()) }] : undefined}
        action={
          isAuthenticated && user ? (
            <Button
              as={Link}
              to={tenantPath(`/profile/${user.id}`)}
              variant="primary"
              className="shrink-0 font-semibold"
              startContent={<UserCircle className="w-4 h-4" aria-hidden="true" />}
            >
              {t('members.my_profile')}
            </Button>
          ) : undefined
        }
      />
      )}
      {/* Phones read the ranking algorithm inside the filter sheet's Sort group instead. */}
      {!isPhone && activeSortBy === 'communityrank' && !isNearbyMode && (
        <div className="-mt-2">
          <AlgorithmLabel area="members" />
        </div>
      )}

      {/* Phone: slim sticky control bar (feed/listings parity) — auto-hides on scroll down. */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="blue"
          onSearchPress={() => setIsSearchOverlayOpen(true)}
          searchValue={searchQuery}
          onFiltersPress={openFilterSheet}
          chips={phoneFilterChips}
          onClearAll={resetPhoneFilters}
          labels={{ search: t('members.search_placeholder') }}
          trailing={
            <ToggleButtonGroup
              aria-label={t('aria.view_mode')}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([viewMode])}
              onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setViewMode(k as ViewMode); }}
              className="shrink-0 gap-0 overflow-hidden rounded-full border border-theme-default bg-theme-elevated"
            >
              <ToggleButton
                id="grid"
                isIconOnly
                variant="ghost"
                aria-label={t('aria.grid_view')}
                className="h-10 min-w-10 rounded-none text-theme-muted transition-colors data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-blue-700 dark:data-[selected=true]:text-blue-300"
              >
                <Grid className="h-4 w-4" aria-hidden="true" />
              </ToggleButton>
              <ToggleButton
                id="list"
                isIconOnly
                variant="ghost"
                aria-label={t('aria.list_view')}
                className="h-10 min-w-10 rounded-none text-theme-muted transition-colors data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-blue-700 dark:data-[selected=true]:text-blue-300"
              >
                <List className="h-4 w-4" aria-hidden="true" />
              </ToggleButton>
              {canUseMapView && (
                <ToggleButton
                  id="map"
                  isIconOnly
                  variant="ghost"
                  aria-label={t('aria.map_view')}
                  className="h-10 min-w-10 rounded-none text-theme-muted transition-colors data-[selected=true]:bg-blue-500/15 data-[selected=true]:text-blue-700 dark:data-[selected=true]:text-blue-300"
                >
                  <MapIcon className="h-4 w-4" aria-hidden="true" />
                </ToggleButton>
              )}
            </ToggleButtonGroup>
          }
        />
      )}

      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder={t('members.search_placeholder')}
          recentKey="members"
        />
      )}

      {/* Phone filter sheet — sort + distance as chips, live count, draft-apply. */}
      {isPhone && filterSheet.draft && (
        <MemberFilterSheet
          isOpen={filterSheet.isOpen}
          onClose={filterSheet.close}
          draft={filterSheet.draft}
          onDraftChange={filterSheet.patch}
          resultCount={filterSheet.count}
          onApply={filterSheet.apply}
          onClearAll={filterSheet.clear}
          hasCommunityRank={membersAlgorithm?.key === 'communityrank'}
          canUseNearMe={canUseNearMe}
          onNearMeUnavailable={() => toast.error(t('members.near_me_no_location'))}
        />
      )}

      {/* Quick Filters — single-select ToggleButtonGroup (per-filter accent colour via data-[selected]).
          Phones reach the same values through the sheet's Sort group (this row is a facade over sortBy). */}
      {!isPhone && (
      <ToggleButtonGroup
        aria-label={t('members.quick_filters')}
        selectionMode="single"
        disallowEmptySelection
        isDetached
        size="sm"
        isDisabled={isNearbyMode}
        selectedKeys={new Set([quickFilter])}
        onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) handleQuickFilter(k as QuickFilter); }}
        className="flex flex-wrap items-center gap-2"
      >
        <ToggleButton
          id="all"
          variant="ghost"
          className="bg-theme-elevated text-theme-secondary transition-colors hover:bg-accent/5 hover:text-accent data-[selected=true]:bg-accent data-[selected=true]:text-white data-[selected=true]:shadow-sm"
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          {t('members.all')}
        </ToggleButton>
        <ToggleButton
          id="new"
          variant="ghost"
          className="bg-theme-elevated text-theme-secondary transition-colors hover:bg-emerald-500/5 hover:text-emerald-500 data-[selected=true]:bg-emerald-600 data-[selected=true]:text-white data-[selected=true]:shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {t('members.new')}
        </ToggleButton>
        <ToggleButton
          id="active"
          variant="ghost"
          className="bg-theme-elevated text-theme-secondary transition-colors hover:bg-amber-500/5 hover:text-[var(--color-warning)] data-[selected=true]:bg-amber-600 data-[selected=true]:text-white data-[selected=true]:shadow-sm"
        >
          <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
          {t('members.active')}
        </ToggleButton>
      </ToggleButtonGroup>
      )}

      {/* Search & Sort Filters (desktop and tablet — phones use the sticky bar + sheet) */}
      {!isPhone && (
      <GlassCard className="p-4">
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1">
            {/* This card only mounts when !isPhone, so the pill arm below is inert —
                kept verbatim so the tablet/desktop tree is byte-identical to before. */}
            {isPhone ? (
              <Button
                variant="flat"
                onPress={() => setIsSearchOverlayOpen(true)}
                aria-label={t('members.search_placeholder')}
                className="min-h-12 w-full justify-start gap-2 rounded-xl border border-theme-default bg-theme-elevated px-4 text-left text-sm font-normal"
              >
                <Search className="h-4 w-4 shrink-0 text-theme-subtle" aria-hidden="true" />
                <span className={`line-clamp-1 ${searchQuery ? 'text-theme-primary' : 'text-theme-subtle'}`}>
                  {searchQuery || t('members.search_placeholder')}
                </span>
              </Button>
            ) : (
              <SearchField
                placeholder={t('members.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                isClearable
                onClear={resetSearch}
                aria-label={t('members.search_placeholder')}
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                }}
              />
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:flex-nowrap">
            <Select
              placeholder={t('members.sort_by')}
              selectedKeys={activeSortBy ? [activeSortBy] : []}
              disallowEmptySelection
              isDisabled={isNearbyMode}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="w-36 sm:w-44"
              aria-label={t('members.sort_by')}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
              startContent={<Filter className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            >
              {membersAlgorithm?.key === 'communityrank' ? (
                <SelectItem key="communityrank" id="communityrank">{t('members.sort_communityrank')}</SelectItem>
              ) : null}
              <SelectItem key="name" id="name">{t('members.sort_name')}</SelectItem>
              <SelectItem key="joined" id="joined">{t('members.sort_newest')}</SelectItem>
              <SelectItem key="rating" id="rating">{t('members.sort_rated')}</SelectItem>
              <SelectItem key="hours_given" id="hours_given">{t('members.sort_active')}</SelectItem>
            </Select>

            <ToggleButton
              size="sm"
              variant="ghost"
              isSelected={nearMeEnabled}
              onChange={() => handleNearMeToggle()}
              className="bg-theme-elevated text-theme-primary transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 data-[selected=true]:bg-emerald-600 data-[selected=true]:text-white data-[selected=true]:shadow-sm"
              aria-label={t('members.near_me')}
            >
              <MapPin className="w-4 h-4" aria-hidden="true" />
              {t('members.near_me')}
            </ToggleButton>

            {nearMeEnabled && (
              <Select
                aria-label={t('members.radius_label')}
                selectedKeys={[String(radiusKm)]}
                disallowEmptySelection
                onSelectionChange={(keys) => {
                  const val = keys instanceof Set ? ([...keys][0] as string) : String(DEFAULT_RADIUS_KM);
                  const next = Number(val) || DEFAULT_RADIUS_KM;
                  radiusTouchedRef.current = true;
                  persistRadiusPreference(next);
                  setRadiusKm(next);
                }}
                className="w-32"
                classNames={{
                  trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                  value: 'text-theme-primary',
                }}
              >
                <SelectItem key="5" id="5">{t('radius_5')}</SelectItem>
                <SelectItem key="10" id="10">{t('radius_10')}</SelectItem>
                <SelectItem key="25" id="25">{t('radius_25')}</SelectItem>
                <SelectItem key="50" id="50">{t('radius_50')}</SelectItem>
                <SelectItem key="100" id="100">{t('radius_100')}</SelectItem>
              </Select>
            )}

            <ToggleButtonGroup
              aria-label={t('aria.view_mode')}
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={new Set([viewMode])}
              onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setViewMode(k as ViewMode); }}
              className="flex w-fit gap-0 overflow-hidden rounded-xl border border-theme-default"
            >
              <ToggleButton
                id="grid"
                isIconOnly
                variant="ghost"
                aria-label={t('aria.grid_view')}
                className="rounded-none bg-theme-elevated text-theme-muted transition-colors data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent dark:data-[selected=true]:text-accent"
              >
                <Grid className="w-4 h-4" aria-hidden="true" />
              </ToggleButton>
              <ToggleButton
                id="list"
                isIconOnly
                variant="ghost"
                aria-label={t('aria.list_view')}
                className="rounded-none bg-theme-elevated text-theme-muted transition-colors data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent dark:data-[selected=true]:text-accent"
              >
                <List className="w-4 h-4" aria-hidden="true" />
              </ToggleButton>
              {canUseMapView && (
                <ToggleButton
                  id="map"
                  isIconOnly
                  variant="ghost"
                  aria-label={t('aria.map_view')}
                  className="rounded-none bg-theme-elevated text-theme-muted transition-colors data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent dark:data-[selected=true]:text-accent"
                >
                  <MapIcon className="w-4 h-4" aria-hidden="true" />
                </ToggleButton>
              )}
            </ToggleButtonGroup>
          </div>
        </div>
        {(debouncedQuery || nearMeEnabled) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-theme-default pt-3">
            <span className="text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('members.applied_filters')}</span>
            {debouncedQuery && (
              <Chip
                variant="soft"
                className="bg-theme-elevated text-theme-secondary"
                endContent={
                  <Button
                    isIconOnly
                    size="sm"
                    variant="tertiary"
                    className="ml-1 min-h-5 h-5 min-w-5 text-theme-subtle"
                    onPress={resetSearch}
                    aria-label={t('members.clear_search')}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </Button>
                }
              >
                {t('members.search_filter', { query: debouncedQuery })}
              </Chip>
            )}
            {nearMeEnabled && (
              <Chip variant="soft" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                {t('members.nearby_filter', { radius: radiusKm })}
              </Chip>
            )}
          </div>
        )}
      </GlassCard>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('members.unable_to_load')}</h3>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadMembers()}
          >
            {t('members.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Members Grid/List */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className={viewMode === 'grid' ? 'grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-3'} aria-label={t('aria.loading_members')} aria-busy="true">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <MemberCardSkeleton key={i} />
              ))}
            </div>
          ) : members.length === 0 ? (
            <PublicEmptyState
              icon={<Users className="w-12 h-12" />}
              title={t('members.no_members')}
              description={debouncedQuery ? t('members.no_members_search') : t('members.no_members_community')}
              tips={[t('members.empty_tip_profiles'), t('members.empty_tip_skills'), t('members.empty_tip_location')]}
              accent="blue"
              action={debouncedQuery ? (
                <Button variant="secondary" onPress={resetSearch} startContent={<X className="h-4 w-4" aria-hidden="true" />}>
                  {t('members.clear_search')}
                </Button>
              ) : undefined}
            />
          ) : (
            <>
              {/* Results count with search context */}
              {(debouncedQuery || totalCount !== null) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {debouncedQuery && totalCount !== null ? (
                    <p role="status" className="text-sm text-theme-muted">
                      {t('members.results_matching', { shown: members.length.toLocaleString(getFormattingLocale()), total: totalCount.toLocaleString(getFormattingLocale()), query: debouncedQuery })}
                    </p>
                  ) : totalCount !== null && totalCount > members.length ? (
                    <p role="status" className="text-sm text-theme-muted">
                      {t('members.results_showing_of', { shown: members.length.toLocaleString(getFormattingLocale()), total: totalCount.toLocaleString(getFormattingLocale()) })}
                    </p>
                  ) : (
                    <p role="status" className="text-sm text-theme-muted">
                      {t('members.results_count', { count: members.length })}
                    </p>
                  )}
                  {debouncedQuery && (
                    <Button size="sm" variant="tertiary" className="text-theme-muted" onPress={resetSearch} startContent={<X className="h-3.5 w-3.5" aria-hidden="true" />}>
                      {t('members.clear_search')}
                    </Button>
                  )}
                </div>
              )}

              {/* Why the directory is smaller than the community. Shown only
                  when members really are held back, so a community with nothing
                  hidden never explains an absence that isn't there. Suppressed
                  while searching or in Near me, where the shortfall the member
                  is looking at is their own filter, not this. */}
              {showCoverageNote && (
                <Alert
                  color="secondary"
                  icon={<Users className="h-4 w-4" aria-hidden="true" />}
                  title={t('members.coverage_title', {
                    listed: totalCount!.toLocaleString(getFormattingLocale()),
                    joined: communityTotal!.toLocaleString(getFormattingLocale()),
                  })}
                  description={
                    <div className="space-y-2">
                      <p>{t('members.coverage_intro')}</p>
                      <ul className="list-disc list-outside ms-5 space-y-1">
                        {directoryCriteria.map((criterion) => (
                          <li key={criterion}>{t(`members.coverage_criteria.${criterion}`)}</li>
                        ))}
                      </ul>
                      <p>{t('members.coverage_outro')}</p>
                      {isAuthenticated && (
                        <Link
                          to={tenantPath('/settings?tab=privacy')}
                          className="inline-block font-medium text-accent underline underline-offset-2"
                        >
                          {t('members.coverage_check_own')}
                        </Link>
                      )}
                    </div>
                  }
                />
              )}

              {viewMode === 'map' ? (
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-busy="true"
                      aria-label={t('aria.loading_members')}
                      className="h-[600px] rounded-xl bg-theme-elevated"
                    />
                  }
                >
                <LazyEntityMapView
                  items={members}
                  getCoordinates={(m: User) =>
                    m.latitude != null && m.longitude != null
                      ? { lat: Number(m.latitude), lng: Number(m.longitude) }
                      : null
                  }
                  getMarkerConfig={(m: User) => ({
                    id: m.id,
                    title: m.name?.trim() || `${m.first_name || ''} ${m.last_name || ''}`.trim() || t('members.fallback_name'),
                  })}
                  renderInfoContent={(m: User) => (
                    <div className="p-2 max-w-[200px]">
                      <div className="flex items-center gap-2">
                        {(m.avatar || m.avatar_url) && (
                          <Avatar
                            src={resolveAvatarUrl(m.avatar ?? m.avatar_url)}
                            alt={t('members.avatar_alt', { name: m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || t('members.fallback_name') })}
                            name={m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || t('members.fallback_name')}
                            size="sm"
                          />
                        )}
                        <div>
                          <h4 className="font-semibold text-sm text-theme-primary">
                            {m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim()}
                          </h4>
                          {m.tagline && (
                            <p className="text-xs text-theme-muted">{m.tagline}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  isLoading={isLoading}
                  emptyMessage={t('members.no_location')}
                  onMapsFailed={() => setViewMode('grid')}
                />
                </Suspense>
              ) : (
                <motion.div
                  key={`${debouncedQuery}-${activeSortBy}-${quickFilter}`}
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className={viewMode === 'grid' ? 'grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-3'}
                >
                  {members.map((member) => (
                    <motion.div key={member.id} variants={itemVariants}>
                      <MemberCard member={member} viewMode={viewMode} sortBy={sortBy ?? undefined} />
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {/* Load More with progress */}
              {hasMore && (
                <div className="space-y-3 pt-4">
                  {totalCount != null && totalCount > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-theme-muted px-1">
                        <span>{members.length.toLocaleString(getFormattingLocale())} / {totalCount.toLocaleString(getFormattingLocale())}</span>
                        <span className="font-medium text-theme-secondary">{Math.round((members.length / totalCount) * 100)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-theme-elevated overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-linear-to-r from-accent to-accent-gradient-end"
                          initial={{ width: '0%' }}
                          animate={{ width: `${Math.round((members.length / totalCount) * 100)}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="text-center">
                    <Button
                      variant="secondary"
                      className="bg-theme-elevated text-theme-muted hover:bg-theme-hover"
                      onPress={loadMoreMembers}
                      isLoading={isLoadingMore}
                    >
                      {totalCount != null && totalCount > members.length
                        ? t('members.load_more_count', { remaining: (totalCount - members.length).toLocaleString(getFormattingLocale()) })
                        : t('members.load_more')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

interface MemberCardProps {
  member: User;
  viewMode: ViewMode;
  sortBy?: SortOption;
}

const MemberCard = memo(function MemberCard({ member, viewMode, sortBy }: MemberCardProps) {
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  const hasGamification = useFeature('gamification');

  // Handle empty names gracefully - fallback to "Member" or first_name/last_name
  const displayName = member.name?.trim()
    || `${member.first_name || ''} ${member.last_name || ''}`.trim()
    || t('members.fallback_name');

  // Resolve avatar from either field (index returns 'avatar', nearby may return 'avatar_url')
  const avatarSrc = resolveAvatarUrl(member.avatar ?? member.avatar_url);

  const level = member.level ?? 0;
  const showcasedBadges = member.showcased_badges ?? [];

  // Format join date for "New members" sort
  const joinedLabel = sortBy === 'joined' && member.created_at
    ? t('members.joined_date', {
        date: new Date(member.created_at).toLocaleDateString(getFormattingLocale(), { month: 'short', year: 'numeric' }),
      })
    : null;

  // Distance label for nearby mode
  const distanceLabel = member.distance != null
    ? t('members.distance_km', { distance: Number(member.distance).toFixed(1) })
    : null;

  if (viewMode === 'list') {
    return (
      <Link to={tenantPath(`/profile/${member.id}`)} aria-label={t('members.profile_aria', { name: displayName })}>
        <article>
          <GlassCard className="p-4 hover:bg-theme-hover hover:shadow-md hover:shadow-accent/5 border-l-4 border-l-accent/20 hover:border-l-accent/50 transition-all duration-200">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="relative inline-block">
                <Avatar
                  src={avatarSrc}
                  name={displayName}
                  size="lg"
                  className="ring-2 ring-theme-muted/20"
                />
                <PresenceIndicator userId={member.id} size="md" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="truncate font-semibold text-theme-primary">{displayName}</h3>
                  {member.is_verified && (
                    <Tooltip content={t('members.verified_member')}>
                      <span role="img" aria-label={t('members.verified_member')} className="inline-flex shrink-0">
                        <BadgeCheck className="w-4 h-4 text-teal-500 shrink-0" aria-hidden="true" />
                      </span>
                    </Tooltip>
                  )}
                  {hasGamification && level > 0 && (
                    <Chip size="sm" variant="soft" className="bg-accent-soft dark:bg-accent/40 text-accent dark:text-accent text-xs h-5 min-w-0">
                      {t('level_short', { level })}
                    </Chip>
                  )}
                  {hasGamification && showcasedBadges.length > 0 && (
                    <span className="flex items-center gap-0.5 ml-1" role="group" aria-label={t('members.showcased_badges')}>
                      {showcasedBadges.map((badge) => (
                        <Tooltip key={badge.badge_key} content={badge.name}>
                          <span className="text-base leading-none cursor-default" role="img" aria-label={badge.name}>{badge.icon || '🏆'}</span>
                        </Tooltip>
                      ))}
                    </span>
                  )}
                </div>
                {member.tagline && (
                  <p className="mt-0.5 line-clamp-2 text-sm text-theme-subtle sm:truncate">{member.tagline}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-theme-subtle sm:justify-end">
                {member.location && (
                  <span className="flex min-w-0 items-center gap-1">
                    <MapPin className="w-4 h-4" aria-hidden="true" />
                    <span className="truncate">{member.location}</span>
                  </span>
                )}
                {member.rating != null && (
                  <span className="flex items-center gap-1" aria-label={t('members.rating_aria', { rating: member.rating.toFixed(1) })}>
                    <Star className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    <span>{member.rating.toFixed(1)}</span>
                  </span>
                )}
                <span className="flex items-center gap-1 shrink-0 whitespace-nowrap" aria-label={t('members.hours_exchanged_aria', { count: (member.total_hours_given ?? 0) + (member.total_hours_received ?? 0) })}>
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <span>{t('members.hours_short', { count: (member.total_hours_given ?? 0) + (member.total_hours_received ?? 0) })}</span>
                </span>
                {joinedLabel && (
                  <span className="flex items-center gap-1 shrink-0 whitespace-nowrap text-accent dark:text-accent">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{joinedLabel}</span>
                  </span>
                )}
                {distanceLabel && (
                  <span className="flex items-center gap-1 shrink-0 whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                    <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{distanceLabel}</span>
                  </span>
                )}
                {sortBy === 'communityrank' && member.community_rank_score != null && (
                  <Tooltip content={t('members.community_rank_score_tooltip')}>
                    <span className="flex items-center gap-1 shrink-0 whitespace-nowrap text-violet-600 dark:text-violet-400 cursor-default">
                      <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{Math.round(member.community_rank_score * 100)}%</span>
                      {/* Tooltips don't exist on touch — show the label inline on phones */}
                      <span className="sm:hidden">{t('members.community_rank_score_tooltip')}</span>
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
          </GlassCard>
        </article>
      </Link>
    );
  }

  return (
      <Link to={tenantPath(`/profile/${member.id}`)} aria-label={t('members.profile_aria', { name: displayName })} className="group h-full">
      <article>
        <GlassCard className="flex h-full min-h-[272px] flex-col p-5 text-center transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-accent/10">
          <div className="relative inline-block mx-auto mb-3">
            <Avatar
              src={avatarSrc}
              name={displayName}
              className="w-20 h-20 ring-2 ring-theme-muted/20 group-hover:ring-accent/50 transition-all duration-200"
            />
            <PresenceIndicator userId={member.id} size="md" />
          </div>
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-theme-primary">{displayName}</h3>
            {member.is_verified && (
              <Tooltip content={t('members.verified_member')}>
                <span role="img" aria-label={t('members.verified_member')} className="inline-flex shrink-0">
                  <BadgeCheck className="w-4 h-4 text-teal-500 shrink-0" aria-hidden="true" />
                </span>
              </Tooltip>
            )}
            {hasGamification && level > 0 && (
              <Chip size="sm" variant="soft" className="bg-accent-soft dark:bg-accent/40 text-accent dark:text-accent text-xs h-5 min-w-0">
                {t('level_short', { level })}
              </Chip>
            )}
          </div>
          {hasGamification && showcasedBadges.length > 0 && (
            <div className="flex items-center justify-center gap-1 mt-1.5" role="group" aria-label={t('members.showcased_badges')}>
              {showcasedBadges.map((badge) => (
                <Tooltip key={badge.badge_key} content={badge.name}>
                  <span className="text-lg leading-none cursor-default" role="img" aria-label={badge.name}>{badge.icon || '🏆'}</span>
                </Tooltip>
              ))}
            </div>
          )}
          {member.tagline && (
            <p className="mx-auto mt-1 min-h-5 max-w-full text-sm text-theme-subtle line-clamp-1">{member.tagline}</p>
          )}

          {/* Stat chips */}
          <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
            {member.rating != null && (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 text-theme-warning text-xs font-medium"
                aria-label={t('members.rating_aria', { rating: member.rating.toFixed(1) })}
              >
                <Star className="w-3 h-3 fill-amber-500 text-[var(--color-warning)]" aria-hidden="true" />
                {member.rating.toFixed(1)}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-theme-hover text-theme-muted text-xs font-medium"
              aria-label={t('members.hours_exchanged_aria', { count: (member.total_hours_given ?? 0) + (member.total_hours_received ?? 0) })}
            >
              <Clock className="w-3 h-3" aria-hidden="true" />
              {t('members.hours_short', { count: (member.total_hours_given ?? 0) + (member.total_hours_received ?? 0) })}
            </span>
            {sortBy === 'communityrank' && member.community_rank_score != null && (
              <Tooltip content={t('members.community_rank_score_tooltip')}>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-medium cursor-default">
                  <TrendingUp className="w-3 h-3" aria-hidden="true" />
                  {Math.round(member.community_rank_score * 100)}%
                  {/* Tooltips don't exist on touch — show the label inline on phones */}
                  <span className="sm:hidden">{t('members.community_rank_score_tooltip')}</span>
                </span>
              </Tooltip>
            )}
          </div>

          {(member.location || distanceLabel) && (
            <p className="mt-2 flex items-center justify-center gap-1 text-xs text-theme-subtle">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              <span className="truncate">
                {distanceLabel && member.location
                  ? t('members.location_distance', { location: member.location, distance: distanceLabel })
                  : distanceLabel || member.location}
              </span>
            </p>
          )}

          {joinedLabel && (
            <p className="text-xs text-accent dark:text-accent mt-1 flex items-center justify-center gap-1">
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              <span>{joinedLabel}</span>
            </p>
          )}
        </GlassCard>
      </article>
    </Link>
  );
});

export default MembersPage;
