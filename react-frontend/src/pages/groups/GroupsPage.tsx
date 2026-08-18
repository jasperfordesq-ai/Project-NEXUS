// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar, AvatarGroup } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { MobileFilterBar, type MobileFilterBarChip } from '@/components/ui/MobileFilterBar';
import { SearchField } from '@/components/ui/SearchField';
import { GroupCardSkeleton } from '@/components/ui/Skeletons';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { Tooltip } from '@/components/ui/Tooltip';
/**
 * Groups Page - Community groups listing
 */

import { lazy, Suspense, useState, useEffect, useCallback, useRef, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Users from 'lucide-react/icons/users';
import Plus from 'lucide-react/icons/plus';
import Lock from 'lucide-react/icons/lock';
import Globe from 'lucide-react/icons/globe';
import MessageSquare from 'lucide-react/icons/message-square';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Star from 'lucide-react/icons/star';
import { useTranslation } from 'react-i18next';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useTenant } from '@/contexts/TenantContext';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks/usePageTitle';
// Direct hook paths, never the '@/hooks' barrel: page tests partial-mock the barrel,
// so a barrel import would resolve to undefined and crash every test.
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { PageMeta } from '@/components/seo/PageMeta';
import type { Group } from '@/types/api';
import { listGroupDirectory } from './api';
import { GroupsFilterSheet } from './components/GroupsFilterSheet';

type GroupFilter = 'all' | 'joined' | 'public' | 'private';

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_VISIBLE_TAGS = 3;
const RecommendedGroups = lazy(() =>
  import('./components/RecommendedGroups').then((module) => ({
    default: module.RecommendedGroups,
  })),
);

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

function readDirectoryFilter(searchParams: URLSearchParams, isAuthenticated: boolean): GroupFilter {
  if (isAuthenticated && searchParams.get('scope') === 'joined') return 'joined';
  const visibility = searchParams.get('visibility');
  return visibility === 'public' || visibility === 'private' ? visibility : 'all';
}

function dedupeGroups(groups: Group[]): Group[] {
  const seen = new Set<number>();
  return groups.filter((group) => {
    if (seen.has(group.id)) return false;
    seen.add(group.id);
    return true;
  });
}

export function GroupsPage() {
  const { t } = useTranslation('groups');
  usePageTitle(t('title'));
  // Phones hide the hero, so the page title moves into the fixed app bar.
  useSetAppBarTitle(t('title'));
  const { isAuthenticated, user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const searchQuery = searchParams.get('q') || '';
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const filter = readDirectoryFilter(searchParams, isAuthenticated);

  // Phone-only chrome: sticky filter bar + full-screen search overlay + filter sheet.
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const appendAbortControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  // Debounce search query
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

  const loadGroups = useCallback(async (append = false) => {
    if (append && loadMoreInFlightRef.current) return;

    if (!append) {
      abortControllerRef.current?.abort();
      appendAbortControllerRef.current?.abort();
      loadMoreInFlightRef.current = false;
      requestGenerationRef.current += 1;
    }

    const generation = requestGenerationRef.current;
    const requestCursor = append ? nextCursorRef.current : null;
    if (append && !requestCursor) return;

    const controller = new AbortController();
    if (append) {
      loadMoreInFlightRef.current = true;
      appendAbortControllerRef.current = controller;
    } else {
      abortControllerRef.current = controller;
    }

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
        setTotalCount(null);
      } else {
        setIsLoadingMore(true);
      }

      const page = await listGroupDirectory({
        search: debouncedQuery || undefined,
        visibility: filter === 'public' || filter === 'private' ? filter : undefined,
        memberUserId: filter === 'joined' && user?.id ? user.id : undefined,
        perPage: ITEMS_PER_PAGE,
        cursor: requestCursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      if (append) {
        setGroups((prev) => {
          const seen = new Set(prev.map((group) => group.id));
          const uniquePage = page.groups.filter((group) => {
            if (seen.has(group.id)) return false;
            seen.add(group.id);
            return true;
          });
          return [...prev, ...uniquePage];
        });
      } else {
        setGroups(dedupeGroups(page.groups));
      }
      nextCursorRef.current = page.nextCursor;
      setCursor(page.nextCursor);
      setHasMore(page.hasMore && (!append || page.nextCursor !== requestCursor));
      if (page.totalCount !== null) {
        setTotalCount(page.totalCount);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load groups', err);
      if (!append) {
        setError(t('load_error'));
      } else {
        logError('Failed to load more groups', err);
        toast.error(t('load_more_error'));
      }
    } finally {
      if (append && appendAbortControllerRef.current === controller) {
        appendAbortControllerRef.current = null;
        loadMoreInFlightRef.current = false;
      }
      if (!append && abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (!controller.signal.aborted && generation === requestGenerationRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [debouncedQuery, filter, user?.id, t, toast]);

  // Load groups when filter or debounced query changes; reset cursor for a fresh page-1 fetch
  useEffect(() => {
    nextCursorRef.current = null;
    setCursor(null);
    loadGroups();
    setHasMore(true);
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      appendAbortControllerRef.current?.abort();
    };
  }, [debouncedQuery, filter]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on filter change; loadGroups excluded to avoid loop

  const loadMoreGroups = useCallback(() => {
    if (isLoadingMore || !hasMore || !cursor) return;
    void loadGroups(true);
  }, [isLoadingMore, hasMore, cursor, loadGroups]);

  function updateSearch(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set('q', value);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  }

  function updateFilter(value: GroupFilter) {
    const params = new URLSearchParams(searchParams);
    params.delete('scope');
    params.delete('visibility');
    if (value === 'joined') params.set('scope', 'joined');
    else if (value === 'public' || value === 'private') params.set('visibility', value);
    setSearchParams(params);
  }

  function resetSearch() {
    updateSearch('');
    setDebouncedQuery('');
  }

  function getFilterLabel(value: GroupFilter) {
    switch (value) {
      case 'joined':
        return t('filter_my');
      case 'public':
        return t('filter_public');
      case 'private':
        return t('filter_private');
      case 'all':
      default:
        return t('filter_all');
    }
  }

  /**
   * Clears the query AND the scope/visibility filter in ONE searchParams write.
   * Calling updateSearch('') then updateFilter('all') would lose one of them:
   * both build from the same `searchParams` snapshot captured this render.
   */
  function clearAllFilters() {
    const params = new URLSearchParams(searchParams);
    params.delete('q');
    params.delete('scope');
    params.delete('visibility');
    setSearchParams(params);
    setDebouncedQuery('');
  }

  // "My Groups" is meaningless for guests — readDirectoryFilter refuses scope=joined
  // without auth, so offering it would silently resolve back to 'all'.
  const filterOptions = [
    { key: 'all', label: t('filter_all') },
    ...(isAuthenticated ? [{ key: 'joined', label: t('filter_my') }] : []),
    { key: 'public', label: t('filter_public') },
    { key: 'private', label: t('filter_private') },
  ];

  // Phone: the applied filter as a removable chip (the query shows in the search
  // pill instead, matching ListingsPage).
  const phoneFilterChips: MobileFilterBarChip[] = filter === 'all'
    ? []
    : [{ key: 'filter', label: getFilterLabel(filter), onRemove: () => updateFilter('all') }];

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_title')} description={t('page_description')} />
      {/* The hero owns this page's only <h1> and is hidden on phones, where the
          title moves into the app bar as plain text — leaving a phone with no
          heading to orient by. Keep one for screen readers. Mirrors BlogPage. */}
      {isPhone && <h1 className="sr-only">{t('title')}</h1>}
      {/* Tablet/desktop chrome, unchanged. Phones hide the hero, the quick-filter row
          and the search card and get the sticky bar + filter sheet below instead. */}
      {!isPhone && (
      <>
      <PublicPageHero
        eyebrow={t('hero_eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        icon={<Users className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
        stats={totalCount != null && !isLoading ? [{ label: t('count_label'), value: totalCount.toLocaleString(getFormattingLocale()) }] : undefined}
        action={
          isAuthenticated ? (
            <Button
              as={Link}
              to={tenantPath('/groups/create')}
              color="primary"
              className="shrink-0 font-semibold shadow-sm"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            >
              {t('create_group')}
            </Button>
          ) : undefined
        }
      />

      {/* Quick Filters — single-select ToggleButtonGroup (per-filter accent via data-[selected]). */}
      <ToggleButtonGroup
        aria-label={t('filters_aria')}
        selectionMode="single"
        disallowEmptySelection
        isDetached
        size="sm"
        selectedKeys={new Set([filter])}
        onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) updateFilter(k as GroupFilter); }}
        className="flex flex-wrap items-center gap-2"
      >
        <ToggleButton
          id="all"
          variant="ghost"
          className="bg-theme-elevated text-theme-secondary hover:text-accent data-[selected=true]:bg-accent data-[selected=true]:font-semibold data-[selected=true]:text-white data-[selected=true]:shadow-sm"
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          {t('filter_all')}
        </ToggleButton>
        {isAuthenticated && (
          <ToggleButton
            id="joined"
            variant="ghost"
            className="bg-theme-elevated text-theme-secondary hover:text-emerald-600 data-[selected=true]:bg-emerald-600 data-[selected=true]:font-semibold data-[selected=true]:text-white data-[selected=true]:shadow-sm"
          >
            <Star className="w-3.5 h-3.5" aria-hidden="true" />
            {t('filter_my')}
          </ToggleButton>
        )}
        <ToggleButton
          id="public"
          variant="ghost"
          className="bg-theme-elevated text-theme-secondary hover:text-sky-600 data-[selected=true]:bg-sky-600 data-[selected=true]:font-semibold data-[selected=true]:text-white data-[selected=true]:shadow-sm"
        >
          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
          {t('filter_public')}
        </ToggleButton>
        <ToggleButton
          id="private"
          variant="ghost"
          className="bg-theme-elevated text-theme-secondary hover:text-amber-600 data-[selected=true]:bg-amber-600 data-[selected=true]:font-semibold data-[selected=true]:text-white data-[selected=true]:shadow-sm"
        >
          <Lock className="w-3.5 h-3.5" aria-hidden="true" />
          {t('filter_private')}
        </ToggleButton>
      </ToggleButtonGroup>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex-1">
            <SearchField
              placeholder={t('search_placeholder')}
              aria-label={t('search_placeholder')}
              value={searchQuery}
              onChange={(e) => updateSearch(e.target.value)}
              isClearable={Boolean(searchQuery)}
              onClear={resetSearch}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
            />
          </div>
          {(debouncedQuery || filter !== 'all') && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-theme-muted">
              <span>{t('active_filters')}</span>
              {debouncedQuery && <Chip size="sm" variant="flat" className="bg-theme-elevated text-theme-secondary">{debouncedQuery}</Chip>}
              {filter !== 'all' && <Chip size="sm" variant="flat" className="bg-theme-elevated text-theme-secondary">{getFilterLabel(filter)}</Chip>}
            </div>
          )}
        </div>
      </GlassCard>
      </>
      )}

      {/* Phone: slim sticky control bar — search pill, Filters button + count badge,
          and the re-homed Create Group action (the hero was its only entry point). */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="indigo"
          testId="groups-filter-bar"
          onSearchPress={() => setIsSearchOverlayOpen(true)}
          searchValue={searchQuery}
          onFiltersPress={() => setIsFilterSheetOpen(true)}
          chips={phoneFilterChips}
          onClearAll={clearAllFilters}
          labels={{ search: t('search_placeholder') }}
          trailing={
            isAuthenticated ? (
              <Button
                as={Link}
                to={tenantPath('/groups/create')}
                isIconOnly
                color="primary"
                aria-label={t('create_group')}
                className="size-11 min-h-11 shrink-0 rounded-full font-semibold shadow-sm"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </Button>
            ) : undefined
          }
        />
      )}

      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchQuery}
          onValueChange={updateSearch}
          placeholder={t('search_placeholder')}
          recentKey="groups"
        />
      )}

      {/* Phone filter sheet — one immediate-apply chip group, no draft, no footer. */}
      {isPhone && (
        <GroupsFilterSheet
          isOpen={isFilterSheetOpen}
          onClose={() => setIsFilterSheetOpen(false)}
          filter={filter}
          options={filterOptions}
          onFilterChange={(key) => updateFilter(key as GroupFilter)}
        />
      )}

      {/* Smart Matching group recommendations */}
      {isAuthenticated && (
        <Suspense fallback={null}>
          <RecommendedGroups />
        </Suspense>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-linear-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadGroups()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Groups Grid */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label={t('loading_aria')} aria-busy="true">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <GroupCardSkeleton key={i} />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <PublicEmptyState
              icon={<Users className="w-12 h-12" aria-hidden="true" />}
              title={t('no_groups')}
              description={t('no_groups_desc')}
              tips={[t('empty_tip_interests'), t('empty_tip_location'), t('empty_tip_create')]}
              accent="indigo"
              action={
                isAuthenticated && (
                  <Button as={Link} to={tenantPath('/groups/create')} className="bg-linear-to-r from-accent to-accent-gradient-end text-white">
                    {t('create_group')}
                  </Button>
                )
              }
            />
          ) : (
            <motion.div
              key={debouncedQuery + filter}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              {/* Featured Groups Section */}
              {(() => {
                const featuredGroups = groups.filter((g) => g.is_featured);
                const regularGroups = groups.filter((g) => !g.is_featured);

                return (
                  <>
                    {featuredGroups.length > 0 && (
                      <div className="space-y-3">
                        <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
                          <Star className="w-5 h-5 text-[var(--color-warning)]" aria-hidden="true" />
                          {t('featured_groups')}
                        </h2>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {featuredGroups.map((group) => (
                            <motion.div key={group.id} variants={itemVariants}>
                              <GroupCard group={group} featured />
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* All Groups Section */}
                    {regularGroups.length > 0 && (
                      <div className="space-y-3">
                        {featuredGroups.length > 0 && (
                          <h2 className="text-lg font-semibold text-theme-primary">
                            {t('all_groups')}
                          </h2>
                        )}
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {regularGroups.map((group) => (
                            <motion.div key={group.id} variants={itemVariants}>
                              <GroupCard group={group} />
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Load More Button */}
              {hasMore && (
                <div className="space-y-3 pt-4">
                  {totalCount != null && totalCount > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-theme-muted px-1">
                        <span>{groups.length.toLocaleString(getFormattingLocale())} / {totalCount.toLocaleString(getFormattingLocale())}</span>
                        <span className="font-medium text-theme-secondary">{Math.round((groups.length / totalCount) * 100)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-theme-elevated overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-linear-to-r from-accent to-accent-gradient-end"
                          initial={{ width: '0%' }}
                          animate={{ width: `${Math.round((groups.length / totalCount) * 100)}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="text-center">
                    <Button
                      variant="flat"
                      className="bg-theme-elevated text-theme-muted hover:bg-theme-hover"
                      onPress={loadMoreGroups}
                      isLoading={isLoadingMore}
                    >
                      {totalCount != null && totalCount > groups.length
                        ? t('load_more_count', { remaining: (totalCount - groups.length).toLocaleString(getFormattingLocale()) })
                        : t('load_more')}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

interface GroupCardProps {
  group: Group;
  featured?: boolean;
}

const GroupCard = memo(function GroupCard({ group, featured }: GroupCardProps) {
  const { t } = useTranslation('groups');
  const { tenantPath } = useTenant();
  const memberCount = group.member_count ?? group.members_count ?? 0;
  const privacyLabel = group.visibility === 'private' || group.visibility === 'secret'
    ? t('private_title')
    : t('public_title');
  const groupImageSource = group.cover_image_url || group.cover_image || group.image_url;
  const imageProps = groupImageSource
    ? responsiveThumbnailProps(groupImageSource, {
        width: 360,
        height: 160,
        sizes: '(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw',
      })
    : null;

  return (
    <Link to={tenantPath(`/groups/${group.id}`)} aria-label={`${group.name} - ${privacyLabel} - ${t('members', { count: memberCount })}`} className="block h-full">
      <article className="h-full">
        <GlassCard className={`overflow-hidden hover:scale-[1.01] transition-transform h-full flex flex-col${featured ? ' ring-1 ring-amber-500/30' : ''}`}>
          <div className="relative h-24 bg-theme-elevated">
            {imageProps ? (
              <img
                {...imageProps}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-theme-elevated text-theme-subtle">
                <Users className="h-8 w-8" aria-hidden="true" />
              </div>
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/35 to-transparent" aria-hidden="true" />
            {group.visibility === 'private' || group.visibility === 'secret' ? (
              <Tooltip content={t('private_title')}>
                <span className="absolute end-3 top-3 shrink-0 rounded-full bg-black/45 p-1.5 text-white backdrop-blur-sm">
                  <Lock className="w-4 h-4" aria-hidden="true" />
                </span>
              </Tooltip>
            ) : (
              <Tooltip content={t('public_title')}>
                <span className="absolute end-3 top-3 shrink-0 rounded-full bg-black/45 p-1.5 text-white backdrop-blur-sm">
                  <Globe className="w-4 h-4" aria-hidden="true" />
                </span>
              </Tooltip>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
            {featured && (
              <div className="flex items-center gap-1.5 mb-2" role="img" aria-label={t('featured_badge')}>
                <Star className="w-3.5 h-3.5 text-[var(--color-warning)] fill-amber-500" aria-hidden="true" />
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400" aria-hidden="true">
                  {t('featured_badge')}
                </span>
              </div>
            )}
            <h3 className="mb-3 line-clamp-2 text-lg font-semibold text-theme-primary">{group.name}</h3>

            <SafeHtml content={group.description || t('no_description')} className="text-theme-muted text-sm line-clamp-2 flex-1 mb-2" as="p" />

            {/* Tags */}
            {group.tags && group.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {group.tags.slice(0, MAX_VISIBLE_TAGS).map((tag: { id: number; name: string }) => (
                  <span key={tag.id} className="inline-flex max-w-full items-center break-all rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                    {tag.name}
                  </span>
                ))}
                {group.tags.length > MAX_VISIBLE_TAGS && (
                  <span className="text-[10px] text-theme-subtle">+{group.tags.length - MAX_VISIBLE_TAGS}</span>
                )}
              </div>
            )}

            {/* Group Stats */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-4 text-sm text-theme-subtle">
                <Tooltip content={t('members_count_label', { count: memberCount })}>
                  <span className="flex items-center gap-1" aria-label={t('members_count_label', { count: memberCount })}>
                    <Users className="w-4 h-4" aria-hidden="true" />
                    {memberCount}
                  </span>
                </Tooltip>
                {group.posts_count !== undefined && (
                  <Tooltip content={t('posts_count_label', { count: group.posts_count })}>
                    <span className="flex items-center gap-1" aria-label={t('posts_count_label', { count: group.posts_count })}>
                      <MessageSquare className="w-4 h-4" aria-hidden="true" />
                      {group.posts_count}
                    </span>
                  </Tooltip>
                )}
              </div>

              {group.recent_members && group.recent_members.length > 0 && (
                <AvatarGroup max={3} size="sm">
                  {group.recent_members.map((member) => (
                    <Avatar
                      key={member.id}
                      src={resolveAvatarUrl(member.avatar_url || member.avatar)}
                      name={member.name || `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim()}
                      className="ring-2 ring-black/50"
                    />
                  ))}
                </AvatarGroup>
              )}
            </div>

          {/* Member Status */}
          {(group.is_member || group.viewer_membership?.status === 'active') && (
            <div className="mt-4 pt-4 border-t border-theme-default">
              <Chip size="sm" variant="flat" className="bg-accent/20 text-accent dark:text-accent">
                {t('member_status')}
              </Chip>
            </div>
          )}
          </div>
        </GlassCard>
      </article>
    </Link>
  );
});

export default GroupsPage;
