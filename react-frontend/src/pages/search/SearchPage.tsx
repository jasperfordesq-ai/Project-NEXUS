// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { AlgorithmLabel } from '@/components/ui/AlgorithmLabel';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { MobileFilterBar, type MobileFilterBarChip } from '@/components/ui/MobileFilterBar';
import { SearchField } from '@/components/ui/SearchField';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, Tab } from '@/components/ui/Tabs';
/**
 * Search Page - Global search across content
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Search from 'lucide-react/icons/search';
import ListTodo from 'lucide-react/icons/list-todo';
import User from 'lucide-react/icons/user';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Podcast from 'lucide-react/icons/podcast';
import Clock from 'lucide-react/icons/clock';
import MapPin from 'lucide-react/icons/map-pin';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import { SavedSearches } from '@/components/search/SavedSearches';
import { SearchFilterSheet } from '@/components/search/SearchFilterSheet';
import { AdvancedSearchFilters, defaultFilters } from '@/components/search/AdvancedSearchFilters';
import type { SearchFilters as AdvancedFilters } from '@/components/search/AdvancedSearchFilters';
import { FeaturedBadge } from '@/components/listings/FeaturedBadge';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
// Direct hook paths — page tests partial-mock the '@/hooks' barrel, so a barrel
// import of these would resolve to undefined and crash every render.
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Category, Listing, User as UserType, Event, Group } from '@/types/api';

interface SearchResults {
  listings: Listing[];
  users: UserType[];
  events: Event[];
  groups: Group[];
  podcasts: PodcastSearchResult[];
}

interface PodcastSearchResult {
  id: number;
  podcast_kind: 'show' | 'episode';
  show_slug: string;
  episode_slug?: string;
  title: string;
  summary?: string | null;
  show_title?: string;
  duration_seconds?: number | null;
}

/**
 * Raw item shape returned by the PHP UnifiedSearchService.
 * Each item carries a `type` discriminator plus type-specific fields.
 */
interface RawSearchItem {
  type: 'listing' | 'user' | 'event' | 'group' | 'podcast_show' | 'podcast_episode';
  id: number;
  // listing fields
  listing_type?: string;
  // user fields
  avatar_url?: string;
  bio?: string;
  // group fields
  member_count?: number;
  // shared / catch-all
  [key: string]: unknown;
}

/**
 * The PHP /api/v2/search endpoint returns a flat array of typed items.
 * This function groups them into the SearchResults shape expected by the UI,
 * normalising any field-name differences along the way.
 */
function groupSearchItems(items: RawSearchItem[]): SearchResults {
  const result: SearchResults = { listings: [], users: [], events: [], groups: [], podcasts: [] };

  for (const item of items) {
    if (item.type === 'listing') {
      result.listings.push({
        ...item,
        // PHP returns `listing_type`; Listing type uses `type` for offer/request
        type: (item.listing_type ?? item.type) as string,
      } as unknown as Listing);
    } else if (item.type === 'user') {
      result.users.push({
        ...item,
        // PHP returns `avatar_url`; React resolveAvatarUrl expects `avatar`
        avatar: item.avatar_url,
        // PHP returns `bio`; React renders `user.tagline`
        tagline: item.bio,
      } as unknown as UserType);
    } else if (item.type === 'event') {
      result.events.push(item as unknown as Event);
    } else if (item.type === 'group') {
      result.groups.push({
        ...item,
        // PHP returns `member_count`; React renders `group.members_count`
        members_count: item.member_count,
      } as unknown as Group);
    } else if (item.type === 'podcast_show' || item.type === 'podcast_episode') {
      result.podcasts.push(item as unknown as PodcastSearchResult);
    }
  }

  return result;
}

type SearchTab = 'all' | 'listings' | 'users' | 'events' | 'groups' | 'podcasts';

/**
 * Single source of truth for the `/v2/search` query string. Both the visible
 * search and the phone sheet's draft count probe go through this, so the count
 * in the sheet footer can never drift from what applying the draft returns.
 */
function buildSearchParams(searchQuery: string, filters: AdvancedFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('q', searchQuery);
  if (filters.type && filters.type !== 'all') params.set('type', filters.type);
  if (filters.category_id) params.set('category_id', filters.category_id);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  if (filters.sort && filters.sort !== 'relevance') params.set('sort', filters.sort);
  if (filters.skills) params.set('skills', filters.skills);
  if (filters.location) params.set('location', filters.location);
  return params;
}

/** Short labels for the phone applied-filter chips (full labels live in the sheet). */
const CONTENT_TYPE_CHIP_KEYS: Record<string, string> = {
  listings: 'filter_listings',
  users: 'filter_members',
  events: 'filter_events',
  groups: 'filter_groups',
  podcasts: 'filter_podcasts',
};

const SORT_CHIP_KEYS: Record<string, string> = {
  newest: 'filter_newest',
  oldest: 'filter_oldest',
};

function splitSkills(skills: string): string[] {
  return skills ? skills.split(',').filter(Boolean) : [];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function SearchPage() {
  const { t } = useTranslation('search_page');
  usePageTitle(t('page_title'));
  // On phones the page hides its own hero; the title lives in the app bar.
  useSetAppBarTitle(t('title'));
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const toast = useToast();
  const { tenantPath, hasFeature } = useTenant();
  const podcastsEnabled = hasFeature('podcasts');
  const [searchParams, setSearchParams] = useSearchParams();
  // `query` is the COMMITTED search — it mirrors `?q=` and is the only value the
  // results, the phone search pill, the filter refetches and the draft count probe
  // ever read. `searchInput` is the editable draft the desktop input and the phone
  // overlay bind to. Keeping them separate (the ListingsPage pattern) is what stops
  // abandoned text from being advertised by the pill or silently re-searched by a
  // chip removal while the URL still carries the previous query.
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  // Native-app search: phones type into a full-screen overlay with recents
  // instead of the inline form, which is hidden on phones.
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [results, setResults] = useState<SearchResults>({
    listings: [],
    users: [],
    events: [],
    groups: [],
    podcasts: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({ ...defaultFilters });
  // Option lists for the phone filter sheet. The desktop AdvancedSearchFilters
  // panel still loads its own copies when it expands — these are fetched only
  // when the sheet opens, and are also what labels the applied category chip.
  const [sheetCategories, setSheetCategories] = useState<Category[]>([]);
  const [sheetPopularTags, setSheetPopularTags] = useState<string[]>([]);
  const sheetOptionsLoadedRef = useRef(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const performSearch = useCallback(async (searchQuery: string, filters?: AdvancedFilters) => {
    if (!searchQuery.trim()) {
      setResults({ listings: [], users: [], events: [], groups: [], podcasts: [] });
      setHasSearched(false);
      setSearchError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setHasSearched(true);
      setSearchError(null);

      const params = buildSearchParams(searchQuery, filters || advancedFilters);

      const response = await api.get<RawSearchItem[]>(`/v2/search?${params}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setResults(groupSearchItems(response.data));
      } else {
        setSearchError(tRef.current('error_message'));
        toastRef.current.error(response.error || tRef.current('toast.search_failed'));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Search failed', error);
      setSearchError(tRef.current('error_message'));
      toastRef.current.error(tRef.current('toast.search_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [advancedFilters]);

  useEffect(() => {
    const urlQuery = searchParams.get('q');
    if (urlQuery) {
      setQuery(urlQuery);
      setSearchInput(urlQuery);
      performSearch(urlQuery);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps -- sync from URL params; performSearch excluded to avoid loop

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchInput.trim()) {
      setSearchParams({ q: searchInput.trim() });
    }
  }

  function handleRunSavedSearch(queryParams: Record<string, string>) {
    const savedQuery = queryParams.q || '';
    setQuery(savedQuery);
    setSearchInput(savedQuery);
    if (queryParams.type) {
      setActiveTab(queryParams.type as SearchTab);
    }
    // Build filters from saved search params
    const savedFilters: AdvancedFilters = {
      type: queryParams.type || 'all',
      category_id: queryParams.category_id || '',
      date_from: queryParams.date_from || '',
      date_to: queryParams.date_to || '',
      sort: queryParams.sort || 'relevance',
      skills: queryParams.skills || '',
      location: queryParams.location || '',
    };
    setAdvancedFilters(savedFilters);
    setSearchParams(savedQuery ? { q: savedQuery } : {});
    performSearch(savedQuery, savedFilters);
  }

  const totalResults =
    results.listings.length +
    results.users.length +
    results.events.length +
    results.groups.length +
    results.podcasts.length;

  // Result count for the currently-selected category tab (null for the "all" tab).
  // Used to show an empty state when a single category has no matches even though
  // other categories do — otherwise that tab rendered a blank panel.
  const activeCategoryCount =
    activeTab === 'listings' ? results.listings.length
    : activeTab === 'users' ? results.users.length
    : activeTab === 'events' ? results.events.length
    : activeTab === 'groups' ? results.groups.length
    : activeTab === 'podcasts' ? results.podcasts.length
    : null;

  // ── Phone filter sheet (draft state — nothing applies until "Show N results") ──
  // The draft machine (snapshot / patch / debounced count probe / apply) lives in
  // useFilterDraft; only the search-specific pieces stay here.

  /** Commits a whole filter set and refetches — used by apply, chip removal and clear-all. */
  const applySearchFilters = useCallback((next: AdvancedFilters) => {
    setAdvancedFilters(next);
    performSearch(query, next);
  }, [performSearch, query]);

  /**
   * Live count for the sheet footer. `/v2/search` has no cheap total — its
   * `meta.search.total` is just the size of the returned page — so the probe
   * runs the real search and counts what came back. That IS the number of
   * results applying the draft would show, since the page has no pagination.
   * Debounced well above the default to respect the endpoint's 60/min limit.
   */
  const countDraftResults = useCallback(async (candidate: AdvancedFilters) => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const response = await api.get<RawSearchItem[]>(
      `/v2/search?${buildSearchParams(trimmed, candidate)}`,
    );
    return response.success && Array.isArray(response.data) ? response.data.length : null;
  }, [query]);

  const filterSheet = useFilterDraft<AdvancedFilters>({
    onApply: applySearchFilters,
    emptyDraft: defaultFilters,
    countFor: countDraftResults,
    countKey: query,
    debounceMs: 450,
  });
  const { open: openDraft } = filterSheet;

  /**
   * Categories and popular tags are what the desktop panel lazy-loads when it
   * expands; the sheet needs the same lists, so load them on first open.
   */
  const loadSheetOptions = useCallback(async () => {
    if (sheetOptionsLoadedRef.current) return;
    sheetOptionsLoadedRef.current = true;
    try {
      const response = await api.get<Category[]>('/v2/categories');
      if (response.success && Array.isArray(response.data)) setSheetCategories(response.data);
    } catch (error) {
      logError('Failed to load search filter categories', error);
    }
    try {
      const response = await api.get<Array<{ tag: string; count: number }>>(
        '/v2/listings/tags/popular?limit=10',
      );
      if (response.success && Array.isArray(response.data)) {
        setSheetPopularTags(
          response.data
            .map((item) => item?.tag)
            .filter((tag): tag is string => typeof tag === 'string'),
        );
      }
    } catch (error) {
      logError('Failed to load popular search tags', error);
    }
  }, []);

  const openFilterSheet = useCallback(() => {
    void loadSheetOptions();
    openDraft(advancedFilters, hasSearched ? totalResults : null);
  }, [loadSheetOptions, openDraft, advancedFilters, hasSearched, totalResults]);

  /** Phone: removable chip per applied filter (the query shows in the search pill instead). */
  const phoneFilterChips = useMemo<MobileFilterBarChip[]>(() => {
    const chips: MobileFilterBarChip[] = [];
    const f = advancedFilters;
    const remove = (patch: Partial<AdvancedFilters>) => applySearchFilters({ ...f, ...patch });

    if (f.type && f.type !== 'all') {
      chips.push({
        key: 'type',
        label: t(CONTENT_TYPE_CHIP_KEYS[f.type] ?? 'filter_all_types'),
        onRemove: () => remove({ type: 'all' }),
      });
    }
    if (f.category_id) {
      const category = sheetCategories.find((c) => String(c.id) === f.category_id);
      chips.push({
        key: 'category',
        label: category?.name ?? t('filter_category'),
        onRemove: () => remove({ category_id: '' }),
      });
    }
    if (f.sort && f.sort !== 'relevance') {
      chips.push({
        key: 'sort',
        label: t(SORT_CHIP_KEYS[f.sort] ?? 'filter_relevance'),
        onRemove: () => remove({ sort: 'relevance' }),
      });
    }
    for (const skill of splitSkills(f.skills)) {
      chips.push({
        key: `skill-${skill}`,
        label: skill,
        onRemove: () => remove({ skills: splitSkills(f.skills).filter((s) => s !== skill).join(',') }),
      });
    }
    if (f.date_from) {
      chips.push({
        key: 'date_from',
        label: `${t('filter_from_date')}: ${f.date_from}`,
        onRemove: () => remove({ date_from: '' }),
      });
    }
    if (f.date_to) {
      chips.push({
        key: 'date_to',
        label: `${t('filter_to_date')}: ${f.date_to}`,
        onRemove: () => remove({ date_to: '' }),
      });
    }
    if (f.location) {
      chips.push({ key: 'location', label: f.location, onRemove: () => remove({ location: '' }) });
    }
    return chips;
  }, [advancedFilters, sheetCategories, applySearchFilters, t]);

  const resetSearchFilters = useCallback(() => {
    applySearchFilters({ ...defaultFilters });
  }, [applySearchFilters]);

  /**
   * Phone: the overlay always starts from the COMMITTED query, so text typed and
   * then abandoned with the back arrow (which never commits) cannot come back on
   * the next open and cannot be mistaken for the applied search.
   */
  const openSearchOverlay = useCallback(() => {
    setSearchInput(query);
    setIsSearchOverlayOpen(true);
  }, [query]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Screen-reader live region: announces result count after each search */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {hasSearched && !isLoading
          ? t('results_count_announcement', { count: totalResults })
          : null}
      </div>
      <PageMeta title={t('page_meta.title')} description={t('page_meta.description')} noIndex />
      {/* Phones hide the hero entirely — the title lives in the app bar (useSetAppBarTitle). */}
      {!isPhone && (
      <PublicPageHero
        eyebrow={t('hero_eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        icon={<Search className="h-6 w-6" aria-hidden="true" />}
        accent="emerald"
        stats={hasSearched ? [{ label: t('results_label'), value: totalResults.toLocaleString(getFormattingLocale()) }] : undefined}
      />
      )}

      {/* Search Form (desktop and tablet — phones use the sticky bar + overlay) */}
      {!isPhone && (
      <GlassCard className="p-4">
        <form onSubmit={handleSearch} aria-label={t('form_aria')} className="flex flex-col sm:flex-row gap-3">
          <SearchField
            placeholder={t('search_placeholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t('search_placeholder')}
            size="lg"
            classNames={{
              base: 'flex-1',
              input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
              inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
            }}
          />
          <Button
            type="submit"
            color="primary"
            size="lg"
            isLoading={isLoading}
            className="sm:w-auto w-full"
          >
            {t('search_button')}
          </Button>
        </form>
      </GlassCard>
      )}

      {/* Phone: slim sticky control bar — auto-hides on scroll down, returns on scroll up. */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="emerald"
          onSearchPress={openSearchOverlay}
          searchValue={query}
          onFiltersPress={openFilterSheet}
          chips={phoneFilterChips}
          onClearAll={resetSearchFilters}
          labels={{ search: t('search_placeholder') }}
          testId="search-mobile-controls"
        />
      )}

      {/* Phone: compact results count (the hero stat is hidden on phones). */}
      {isPhone && hasSearched && !isLoading && (
        <p className="px-1 text-xs font-medium text-theme-muted sm:hidden">
          {t('results_label')}: {totalResults.toLocaleString(getFormattingLocale())}
        </p>
      )}

      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchInput}
          onValueChange={setSearchInput}
          onSubmit={(value) => {
            const trimmed = value.trim();
            if (trimmed) setSearchParams({ q: trimmed });
          }}
          placeholder={t('search_placeholder')}
          recentKey="search"
        />
      )}

      {/* Phone filter sheet — chip groups, live count, draft-apply. */}
      {isPhone && filterSheet.draft && (
        <SearchFilterSheet
          isOpen={filterSheet.isOpen}
          onClose={filterSheet.close}
          draft={filterSheet.draft}
          onDraftChange={filterSheet.patch}
          categories={sheetCategories}
          popularTags={sheetPopularTags}
          podcastsEnabled={podcastsEnabled}
          resultCount={filterSheet.count}
          onApply={filterSheet.apply}
          onClearAll={filterSheet.clear}
        />
      )}

      {/* Advanced Filters (desktop and tablet — phones use the sheet) */}
      {!isPhone && (
      <AdvancedSearchFilters
        filters={advancedFilters}
        onChange={setAdvancedFilters}
        onApply={() => performSearch(query, advancedFilters)}
        onReset={() => performSearch(query, { ...defaultFilters })}
      />
      )}

      {/* Saved Searches */}
      <SavedSearches
        onRunSearch={handleRunSavedSearch}
        currentQuery={hasSearched ? query : undefined}
        currentFilters={hasSearched ? {
          ...(advancedFilters.type !== 'all' ? { type: advancedFilters.type } : {}),
          ...(advancedFilters.category_id ? { category_id: advancedFilters.category_id } : {}),
          ...(advancedFilters.skills ? { skills: advancedFilters.skills } : {}),
        } : undefined}
      />

      {/* Results */}
      {hasSearched && (
        <>
          {/* Algorithm indicator */}
          <div className="flex justify-end">
            <AlgorithmLabel area="matching" />
          </div>

          {/* Tabs */}
          <Tabs
            aria-label={t('tabs_aria')}
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(key as SearchTab)}
            classNames={{
              base: 'w-full max-w-full overflow-x-auto',
              tabList: 'bg-theme-elevated p-1 rounded-lg min-w-max flex-nowrap',
              cursor: 'bg-theme-hover',
              tab: 'shrink-0 text-theme-muted data-[selected=true]:text-theme-primary',
            }}
          >
            <Tab key="all" title={t('tab_all', { count: totalResults })} />
            <Tab key="listings" title={t('tab_listings', { count: results.listings.length })} />
            <Tab key="users" title={t('tab_members', { count: results.users.length })} />
            <Tab key="events" title={t('tab_events', { count: results.events.length })} />
            <Tab key="groups" title={t('tab_groups', { count: results.groups.length })} />
            {podcastsEnabled && <Tab key="podcasts" title={t('tab_podcasts', { count: results.podcasts.length })} />}
          </Tabs>

          {/* Results Content */}
          {searchError ? (
            <GlassCard role="alert" className="p-8 text-center">
              <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('error_title')}</h2>
              <p className="text-theme-muted mb-4">{searchError}</p>
              <Button
                className="bg-linear-to-r from-accent to-accent-gradient-end text-white"
                onPress={() => performSearch(query)}
              >
                {t('try_again')}
              </Button>
            </GlassCard>
          ) : isLoading ? (
            <div role="status" aria-label={t('aria.loading_search_results')} aria-busy="true" className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <GlassCard key={i} className="p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 rounded-lg w-2/3" />
                      <Skeleton className="h-3 rounded-lg w-1/2" />
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : totalResults === 0 ? (
            <PublicEmptyState
              icon={<Search className="w-12 h-12" aria-hidden="true" />}
              title={t('no_results_title')}
              description={t('no_results_desc', { query })}
              tips={[t('empty_tip_spelling'), t('empty_tip_filters'), t('empty_tip_broaden')]}
              accent="emerald"
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              {/* Empty state for a single category tab that has no matches even
                  though other categories do (the "all" tab already shows results,
                  so this only fires when a specific category is selected). */}
              {activeCategoryCount === 0 && (
                <PublicEmptyState
                  icon={<Search className="w-12 h-12" aria-hidden="true" />}
                  title={t('no_results_title')}
                  description={t('no_results_desc', { query })}
                  tips={[t('empty_tip_spelling'), t('empty_tip_filters'), t('empty_tip_broaden')]}
                  accent="emerald"
                />
              )}

              {/* Listings */}
              {(activeTab === 'all' || activeTab === 'listings') && results.listings.length > 0 && (
                <section>
                  {activeTab === 'all' && (
                    <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                      <ListTodo className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                      {t('section_listings', { count: results.listings.length })}
                    </h2>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {results.listings.slice(0, activeTab === 'all' ? 4 : undefined).map((listing) => (
                      <motion.div key={listing.id} variants={itemVariants}>
                        <Link to={tenantPath(`/listings/${listing.id}`)}>
                          <GlassCard className="hover:scale-[1.02] transition-transform h-full flex flex-col overflow-hidden">
                            {listing.image_url && (
                              <img
                                {...responsiveThumbnailProps(listing.image_url, {
                                  width: 640,
                                  height: 360,
                                  widths: [320, 480, 640],
                                  sizes: '(max-width: 640px) 100vw, 50vw',
                                })}
                                alt={listing.title || t('listing_image_alt')}
                                className="w-full h-32 object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            )}
                            <div className="p-5 flex flex-col flex-1">
                              <span className={`
                                text-xs px-2 py-1 rounded-full self-start
                                ${listing.type === 'offer' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'}
                              `}>
                                {listing.type === 'offer' ? t('listing_offering') : t('listing_requesting')}
                              </span>
                              {listing.is_featured && <FeaturedBadge />}
                              <h3 className="font-semibold text-theme-primary mt-2 break-words [overflow-wrap:anywhere]">{listing.title}</h3>
                              <p className="text-sm text-theme-subtle line-clamp-2 mt-1">{listing.description}</p>
                              <div className="flex items-center gap-2 mt-3 text-xs text-theme-subtle">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                {listing.hours_estimate ?? listing.estimated_hours
                                  ? t('hours_estimate', { hours: listing.hours_estimate ?? listing.estimated_hours })
                                  : t('hours_unknown')}
                              </div>
                            </div>
                          </GlassCard>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                  {activeTab === 'all' && results.listings.length > 4 && (
                    <Button
                      variant="light"
                      color="primary"
                      size="sm"
                      className="mt-2"
                      onPress={() => setActiveTab('listings')}
                    >
                      {t('view_all_listings', { count: results.listings.length })}
                    </Button>
                  )}
                </section>
              )}

              {/* Users */}
              {(activeTab === 'all' || activeTab === 'users') && results.users.length > 0 && (
                <section>
                  {activeTab === 'all' && (
                    <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                      <User className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      {t('section_members', { count: results.users.length })}
                    </h2>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {results.users.slice(0, activeTab === 'all' ? 4 : undefined).map((user) => (
                      <motion.div key={user.id} variants={itemVariants}>
                        <Link to={tenantPath(`/profile/${user.id}`)}>
                          <GlassCard className="p-5 hover:scale-[1.02] transition-transform">
                            <div className="flex items-center gap-4">
                              <Avatar
                                src={resolveAvatarUrl(user.avatar)}
                                name={user.name}
                                size="lg"
                                className="shrink-0 ring-2 ring-theme-default"
                              />
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-theme-primary truncate">{user.name}</h3>
                                {user.tagline && (
                                  <p className="text-sm text-theme-subtle line-clamp-2">{user.tagline}</p>
                                )}
                                {user.location && (
                                  <p className="text-xs text-theme-subtle flex min-w-0 items-center gap-1 mt-1">
                                    <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{user.location}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </GlassCard>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                  {activeTab === 'all' && results.users.length > 4 && (
                    <Button
                      variant="light"
                      color="primary"
                      size="sm"
                      className="mt-2"
                      onPress={() => setActiveTab('users')}
                    >
                      {t('view_all_members', { count: results.users.length })}
                    </Button>
                  )}
                </section>
              )}

              {/* Events */}
              {(activeTab === 'all' || activeTab === 'events') && results.events.length > 0 && (
                <section>
                  {activeTab === 'all' && (
                    <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                      {t('section_events', { count: results.events.length })}
                    </h2>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {results.events.slice(0, activeTab === 'all' ? 4 : undefined).map((event) => (
                      <motion.div key={event.id} variants={itemVariants}>
                        <Link to={tenantPath(`/events/${event.id}`)}>
                          <GlassCard className="p-5 hover:scale-[1.02] transition-transform">
                            <h3 className="font-semibold text-theme-primary break-words [overflow-wrap:anywhere]">{event.title}</h3>
                            <p className="text-sm text-theme-subtle line-clamp-2 mt-1">{event.description}</p>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-theme-subtle">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" aria-hidden="true" />
                                {event.start_date ? new Date(event.start_date).toLocaleDateString(getFormattingLocale()) : '—'}
                              </span>
                              {event.location && (
                                <span className="flex min-w-0 items-center gap-1">
                                  <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{event.location}</span>
                                </span>
                              )}
                            </div>
                          </GlassCard>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                  {activeTab === 'all' && results.events.length > 4 && (
                    <Button
                      variant="light"
                      color="primary"
                      size="sm"
                      className="mt-2"
                      onPress={() => setActiveTab('events')}
                    >
                      {t('view_all_events', { count: results.events.length })}
                    </Button>
                  )}
                </section>
              )}

              {/* Groups */}
              {(activeTab === 'all' || activeTab === 'groups') && results.groups.length > 0 && (
                <section>
                  {activeTab === 'all' && (
                    <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                      <Users className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                      {t('section_groups', { count: results.groups.length })}
                    </h2>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {results.groups.slice(0, activeTab === 'all' ? 4 : undefined).map((group) => (
                      <motion.div key={group.id} variants={itemVariants}>
                        <Link to={tenantPath(`/groups/${group.id}`)}>
                          <GlassCard className="p-5 hover:scale-[1.02] transition-transform">
                            <h3 className="font-semibold text-theme-primary break-words [overflow-wrap:anywhere]">{group.name}</h3>
                            <p className="text-sm text-theme-subtle line-clamp-2 mt-1">{group.description}</p>
                            <div className="flex items-center gap-2 mt-3 text-xs text-theme-subtle">
                              <Users className="w-3 h-3" aria-hidden="true" />
                              {t('members_count', { count: group.members_count })}
                            </div>
                          </GlassCard>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                  {activeTab === 'all' && results.groups.length > 4 && (
                    <Button
                      variant="light"
                      color="primary"
                      size="sm"
                      className="mt-2"
                      onPress={() => setActiveTab('groups')}
                    >
                      {t('view_all_groups', { count: results.groups.length })}
                    </Button>
                  )}
                </section>
              )}

              {/* Podcasts */}
              {podcastsEnabled && (activeTab === 'all' || activeTab === 'podcasts') && results.podcasts.length > 0 && (
                <section>
                  {activeTab === 'all' && (
                    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-theme-primary">
                      <Podcast className="h-5 w-5 text-accent" aria-hidden="true" />
                      {t('section_podcasts', { count: results.podcasts.length })}
                    </h2>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {results.podcasts.slice(0, activeTab === 'all' ? 4 : undefined).map((podcast) => {
                      const path = podcast.podcast_kind === 'episode' && podcast.episode_slug
                        ? `/podcasts/${podcast.show_slug}/${podcast.episode_slug}`
                        : `/podcasts/${podcast.show_slug}`;
                      return (
                        <motion.div key={`${podcast.podcast_kind}-${podcast.id}`} variants={itemVariants}>
                          <Link to={tenantPath(path)}>
                            <GlassCard className="h-full p-5 transition-transform hover:scale-[1.02]">
                              <div className="flex items-start gap-3">
                                <span className="rounded-full bg-accent/15 p-2 text-accent" aria-hidden="true">
                                  <Podcast className="h-5 w-5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium uppercase tracking-wide text-theme-subtle">
                                    {podcast.podcast_kind === 'episode'
                                      ? t('podcast_episode_label', { show: podcast.show_title ?? '' })
                                      : t('podcast_show_label')}
                                  </p>
                                  <h3 className="break-words font-semibold text-theme-primary [overflow-wrap:anywhere]">
                                    {podcast.title}
                                  </h3>
                                  {podcast.summary && (
                                    <p className="mt-1 line-clamp-2 text-sm text-theme-subtle">{podcast.summary}</p>
                                  )}
                                </div>
                              </div>
                            </GlassCard>
                          </Link>
                        </motion.div>
                      );
                    })}
                  </div>
                  {activeTab === 'all' && results.podcasts.length > 4 && (
                    <Button variant="light" color="primary" size="sm" className="mt-2" onPress={() => setActiveTab('podcasts')}>
                      {t('view_all_podcasts', { count: results.podcasts.length })}
                    </Button>
                  )}
                </section>
              )}
            </motion.div>
          )}
        </>
      )}

      {/* Initial State */}
      {!hasSearched && (
        <PublicEmptyState
          icon={<Search className="w-12 h-12" aria-hidden="true" />}
          title={t('initial_title')}
          description={t('initial_desc')}
          tips={[t('initial_tip_services'), t('initial_tip_people'), t('initial_tip_events')]}
          accent="emerald"
        />
      )}
    </div>
  );
}

export default SearchPage;
