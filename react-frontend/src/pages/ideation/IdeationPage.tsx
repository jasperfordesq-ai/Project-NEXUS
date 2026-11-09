import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { TagGroup, Tag } from '@/components/ui/TagGroup';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Ideation Challenges Page - Browse and discover community challenges
 *
 * Features:
 * - Grid of challenge cards with status chips
 * - Filter tabs: All, Open, Voting, Evaluating, Closed, Archived, Favorites
 * - Category filter dropdown (I1)
 * - Tag chips on challenge cards (I1)
 * - Status lifecycle badges with color coding (I11)
 * - Favorite heart toggle (I8)
 * - Create Challenge button (admin only)
 * - Link to Campaigns page (I7)
 * - Link to Outcomes Dashboard (I10)
 * - Cursor-based pagination
 * - Empty state
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import Lightbulb from 'lucide-react/icons/lightbulb';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import MessageSquarePlus from 'lucide-react/icons/message-square-plus';
import Trophy from 'lucide-react/icons/trophy';
import Heart from 'lucide-react/icons/heart';
import Eye from 'lucide-react/icons/eye';
import Star from 'lucide-react/icons/star';
import Layers from 'lucide-react/icons/layers';
import BarChart3 from 'lucide-react/icons/chart-column';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveThumbnailUrl, getFormattingLocale } from '@/lib/helpers';
import { DetailCover } from '@/components/ui/DetailCover';
import { coverSeed } from '@/lib/coverSeeds';

/* ───────────────────────── Types ───────────────────────── */

interface Challenge {
  id: number;
  tenant_id: number;
  user_id: number;
  title: string;
  description: string;
  category: string | null;
  status: 'draft' | 'open' | 'voting' | 'evaluating' | 'closed' | 'archived';
  ideas_count: number;
  submission_deadline: string | null;
  voting_deadline: string | null;
  prize_description: string | null;
  max_ideas_per_user: number | null;
  created_at: string;
  tags: string[];
  cover_image: string | null;
  is_favorited: boolean;
  favorites_count: number;
  views_count: number;
  is_featured: boolean;
  creator: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
}

interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  challenges_count: number;
}

type FilterTab = 'all' | 'open' | 'voting' | 'evaluating' | 'closed' | 'archived' | 'favorites';

const STATUS_COLOR_MAP: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'secondary' | 'primary'> = {
  draft: 'default',
  open: 'success',
  voting: 'warning',
  evaluating: 'primary',
  closed: 'danger',
  archived: 'secondary',
};

/* ───────────────────────── Main Component ───────────────────────── */

const truncate = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

export function IdeationPage() {
  const { t } = useTranslation('ideation');
  usePageTitle(t('page_title'));
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [favoritingIds, setFavoritingIds] = useState<Set<number>>(new Set());

  // Category filter (I1)
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // Search + tag filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [availableTags, setAvailableTags] = useState<{tag: string; count: number}[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const isAdmin = user?.role && ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(user.role);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Fetch categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await api.get<Category[]>('/v2/ideation-categories');
        if (response.success && response.data) {
          setCategories(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err) {
        logError('Failed to fetch ideation categories', err);
      }
    };
    fetchCategories();
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch available tags for filtering
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const response = await api.get<{tag: string; count: number}[]>('/v2/ideation-tags/popular');
        if (response.success && response.data) {
          setAvailableTags(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err) {
        logError('Failed to fetch ideation tags', err);
      }
    };
    fetchTags();
  }, []);

  const fetchChallenges = useCallback(async (tab: FilterTab, loadMore = false, categoryFilter?: string, searchTerm?: string, tagFilter?: string[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (loadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');

      if (tab === 'favorites') {
        params.set('favorites', '1');
      } else if (tab !== 'all') {
        params.set('status', tab);
      }

      if (categoryFilter) {
        params.set('category', categoryFilter);
      }

      if (searchTerm) {
        params.set('search', searchTerm);
      }

      if (tagFilter && tagFilter.length > 0) {
        params.set('tags', tagFilter.join(','));
      }

      if (loadMore && cursor) {
        params.set('cursor', cursor);
      }

      const response = await api.get<Challenge[]>(`/v2/ideation-challenges?${params}`);
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        if (loadMore) {
          setChallenges(prev => [...prev, ...items]);
        } else {
          setChallenges(items);
        }
        setHasMore(response.meta?.has_more ?? false);
        setCursor(response.meta?.cursor ?? undefined);
      } else {
        if (!loadMore) setError(tRef.current('challenges.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to fetch challenges', err);
      if (!loadMore) {
        setError(tRef.current('challenges.load_error'));
      } else {
        toastRef.current.error(tRef.current('challenges.load_error'));
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [cursor]);

  useEffect(() => {
    setCursor(undefined);
    fetchChallenges(activeTab, false, selectedCategory, debouncedSearch, selectedTags);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on filter change; fetchChallenges excluded to avoid loop
  }, [activeTab, selectedCategory, debouncedSearch, selectedTags]);

  const handleTabChange = (key: React.Key) => {
    setActiveTab(key as FilterTab);
  };

  const handleCategoryChange = (keys: Set<React.Key> | 'all') => {
    if (keys === 'all') {
      setSelectedCategory('');
      return;
    }
    const selected = Array.from(keys)[0];
    setSelectedCategory(selected ? String(selected) : '');
  };

  const handleToggleFavorite = async (challengeId: number) => {
    if (favoritingIds.has(challengeId)) return;

    setFavoritingIds(prev => new Set(prev).add(challengeId));

    try {
      const response = await api.post<{ favorited: boolean; favorites_count: number }>(
        `/v2/ideation-challenges/${challengeId}/favorite`
      );

      if (response.data) {
        setChallenges(prev => prev.map(c => {
          if (c.id === challengeId) {
            return {
              ...c,
              is_favorited: response.data!.favorited,
              favorites_count: response.data!.favorites_count,
            };
          }
          return c;
        }));
      }
    } catch (err) {
      logError('Failed to toggle favorite', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setFavoritingIds(prev => {
        const next = new Set(prev);
        next.delete(challengeId);
        return next;
      });
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <PageMeta
        title={t('page_title')}
        description={t('page_description')}
      />

      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
      <PublicPageHero
        size="compact"
        title={t('title')}
        description={t('subtitle')}
        icon={<Lightbulb className="h-6 w-6" aria-hidden="true" />}
        accent="amber"
        action={
        <div className="flex flex-wrap items-center gap-2">
          {/* Campaigns link */}
          <Button
            variant="flat"
            size="sm"
            startContent={<Layers className="w-4 h-4" aria-hidden="true" />}
            onPress={() => navigate(tenantPath('/ideation/campaigns'))}
          >
            {t('campaigns.title')}
          </Button>

          {/* Outcomes Dashboard link */}
          <Button
            variant="flat"
            size="sm"
            startContent={<BarChart3 className="w-4 h-4" aria-hidden="true" />}
            onPress={() => navigate(tenantPath('/ideation/outcomes'))}
          >
            {t('outcomes.dashboard')}
          </Button>

          {isAdmin && (
            <Button
              color="primary"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={() => navigate(tenantPath('/ideation/create'))}
            >
              {t('challenges.create')}
            </Button>
          )}
        </div>
        }
      />
      </div>

      {/* Filter Row: Tabs + Category dropdown */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="flex-1 overflow-x-auto">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={handleTabChange}
            variant="underlined"
            color="primary"
            aria-label={t('tabs_filter_aria')}
          >
            <Tab key="all" title={t('tabs.all')} />
            <Tab key="open" title={t('tabs.open')} />
            <Tab key="voting" title={t('tabs.voting')} />
            <Tab key="evaluating" title={t('tabs.evaluating')} />
            <Tab key="closed" title={t('tabs.closed')} />
            <Tab key="archived" title={t('tabs.archived')} />
            <Tab key="favorites" title={t('tabs.favorites')} />
          </Tabs>
        </div>

        {/* Category Filter (I1) */}
        {categories.length > 0 && (
          <div className="w-48 shrink-0">
            <Select
              size="sm"
              label={t('categories.title')}
              placeholder={t('categories.all')}
              selectedKeys={selectedCategory ? new Set([selectedCategory]) : new Set<string>()}
              onSelectionChange={handleCategoryChange}
              variant="bordered"
              className="max-w-xs"
            >
              {categories.map((cat) => (
                <SelectItem key={cat.slug} id={cat.slug}>
                  {cat.name}
                </SelectItem>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* Search + Tag Filters */}
      <div className="space-y-3 mb-6">
        {/* Search Bar */}
        <SearchField
          placeholder={t('search.placeholder')}
          value={searchQuery}
          onValueChange={setSearchQuery}
          aria-label={t('search.placeholder')}
          variant="bordered"
          size="sm"
          className="max-w-md"
        />

        {/* Tag Filter Buttons */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <TagGroup
              aria-label={t('tags.label')}
              selectionMode="multiple"
              selectedKeys={new Set(selectedTags)}
              onSelectionChange={(keys) => setSelectedTags(keys === 'all' ? availableTags.map((a) => a.tag) : Array.from(keys).map(String))}
            >
              <TagGroup.List className="flex flex-wrap gap-1.5">
                {availableTags.slice(0, 15).map(({ tag, count }) => (
                  <Tag
                    key={tag}
                    id={tag}
                    className="data-[selected=true]:bg-primary data-[selected=true]:text-white"
                  >
                    {tag} ({count})
                  </Tag>
                ))}
              </TagGroup.List>
            </TagGroup>
            {selectedTags.length > 0 && (
              <Button
                size="sm"
                variant="flat"
                color="danger"
                onPress={() => setSelectedTags([])}
              >
                {t('search.clear_tags')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10 text-theme-subtle" />}
            title={t('challenges.load_error')}
            description={error}
            action={
              <Button
                color="primary"
                variant="flat"
                startContent={<RefreshCw className="w-4 h-4" />}
                onPress={() => fetchChallenges(activeTab, false, selectedCategory, debouncedSearch, selectedTags)}
              >
                {t('actions.retry')}
              </Button>
            }
          />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && challenges.length === 0 && (
        <EmptyState
          icon={<Lightbulb className="w-10 h-10 text-theme-subtle" />}
          title={
            activeTab === 'favorites'
              ? t('favorites.empty_title')
              : t('challenges.empty_title')
          }
          description={
            activeTab === 'favorites'
              ? t('favorites.empty_description')
              : activeTab === 'all'
                ? t('challenges.empty_description')
                : t('challenges.empty_filtered')
          }
        />
      )}

      {/* Challenge Grid */}
      {!isLoading && !error && challenges.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {challenges.map((challenge) => (
              <div key={challenge.id} className="relative h-full">
              <Link
                to={tenantPath(`/ideation/${challenge.id}`)}
                className="block h-full"
              >
                <GlassCard className="h-full hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                  {/* Its picture, or a cover in its own colour — the same as its page
                      (was nothing, so the grid was uneven). */}
                  <DetailCover
                    data-testid="challenge-card-cover"
                    seed={coverSeed.challenge(challenge.id)}
                    icon={Trophy}
                    imageUrl={challenge.cover_image ? resolveThumbnailUrl(challenge.cover_image, { width: 640, height: 360 }) : null}
                    imageAlt={challenge.title}
                    className="h-40"
                  />

                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-[var(--color-text)] line-clamp-2">
                          {challenge.title}
                        </h3>
                        {challenge.is_featured && (
                          <Chip
                            size="sm"
                            color="warning"
                            variant="flat"
                            startContent={<Star className="w-3 h-3 fill-current" />}
                          >
                            {t('featured')}
                          </Chip>
                        )}
                      </div>
                      <div className="mr-10 flex items-center gap-2 shrink-0">
                        {/* Status Badge (I11) */}
                        <Chip
                          size="sm"
                          color={STATUS_COLOR_MAP[challenge.status] ?? 'default'}
                          variant="flat"
                        >
                          {t(`status.${challenge.status}`)}
                        </Chip>
                        {/* Favorite Button (I8) — uses onClick to stop Link propagation */}
                      </div>
                    </div>

                    <p className="text-sm text-[var(--color-text-secondary)] mb-3 line-clamp-3">
                      {truncate(challenge.description, 150)}
                    </p>

                    {/* Tags (I1) */}
                    {challenge.tags && challenge.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {challenge.tags.map((tag) => (
                          <Chip key={tag} size="sm" variant="bordered" className="text-xs">
                            {tag}
                          </Chip>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                      {/* Ideas count */}
                      <span className="flex items-center gap-1">
                        <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('challenge.ideas_count', { count: challenge.ideas_count })}
                      </span>

                      {/* Views count */}
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        {challenge.views_count} {t('views')}
                      </span>

                      {/* Favorites count */}
                      <span className="flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5" aria-hidden="true" />
                        {challenge.favorites_count}
                      </span>

                      {/* Submission deadline */}
                      {challenge.submission_deadline && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                          {t('challenge.submission_deadline', { date: formatDate(challenge.submission_deadline) })}
                        </span>
                      )}

                      {/* Prize indicator */}
                      {challenge.prize_description && (
                        <span className="flex items-center gap-1">
                          <Trophy className="w-3.5 h-3.5 text-[var(--color-warning)]" aria-hidden="true" />
                          {t('challenge.prize')}
                        </span>
                      )}

                      {/* Category (I1) */}
                      {challenge.category && (
                        <Chip size="sm" variant="flat" className="text-xs">
                          {challenge.category}
                        </Chip>
                      )}
                    </div>
                  </div>
                </GlassCard>
              </Link>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => handleToggleFavorite(challenge.id)}
                aria-label={challenge.is_favorited ? t('favorites.remove') : t('favorites.add')}
                isDisabled={favoritingIds.has(challenge.id)}
                className="absolute right-3 top-[10.75rem] z-10 size-11 min-h-11 min-w-11 rounded-full"
              >
                <Heart
                  className={`w-4 h-4 ${
                    challenge.is_favorited
                      ? 'text-[var(--color-error)] fill-current'
                      : 'text-[var(--color-text-tertiary)]'
                  }`}
                  aria-hidden="true"
                />
              </Button>
              </div>
            ))}
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center mt-6">
              <Button
                variant="flat"
                isLoading={isLoadingMore}
                onPress={() => fetchChallenges(activeTab, true, selectedCategory, debouncedSearch, selectedTags)}
              >
                {t('challenges.load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default IdeationPage;
