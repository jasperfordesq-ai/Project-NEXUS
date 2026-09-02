// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Avatar, Button, Card, CardBody, Chip, ModuleStageBadge, SearchField, Select, SelectItem, Spinner } from '@/components/ui';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { podcastsApi, type PodcastShow } from '@/lib/api/podcasts';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { safePodcastArtworkUrl } from '@/lib/podcasts/artwork';
import PodcastIcon from 'lucide-react/icons/podcast';
import Plus from 'lucide-react/icons/plus';
import Search from 'lucide-react/icons/search';

type PodcastSort = 'newest' | 'title' | 'episodes' | 'followers';

const SORT_OPTIONS: PodcastSort[] = ['newest', 'title', 'episodes', 'followers'];

function showArtwork(show: PodcastShow): string | undefined {
  return safePodcastArtworkUrl(show.artwork_url) ?? undefined;
}

export default function PodcastsPage() {
  const { t } = useTranslation('podcasts');
  usePageTitle(t('title'));
  const { tenant, isLoading: tenantLoading, tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();

  const [shows, setShows] = useState<PodcastShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<PodcastSort>('newest');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (tenantLoading) {
      setLoading(true);
      return;
    }

    if (!tenant?.id) {
      setShows([]);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const isFirstPage = page === 1;
    if (isFirstPage) setLoading(true);
    else setLoadingMore(true);

    setLoadError(null);
    podcastsApi
      .browse({ q: debouncedSearch || undefined, category: category || undefined, sort, page }, { signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          const items = res.data.items;
          setShows((prev) => {
            if (isFirstPage) return items;
            // De-dupe by id — the list can shift between pages (e.g. a new show
            // published while sorting by newest), which would otherwise append
            // a duplicate card and collide React keys.
            const seen = new Set(prev.map((show) => show.id));
            return [...prev, ...items.filter((show) => !seen.has(show.id))];
          });
          setHasMore(res.data.has_more);
          // Only refresh category options while browsing the full catalogue.
          // When a category filter is active the results are already narrowed,
          // so leave the dropdown intact. Reset on the first page so stale
          // categories from a previous search/sort don't linger.
          const metaCategories = (res.meta as { categories?: string[] } | undefined)?.categories;
          if (metaCategories?.length) {
            setCategoryOptions(Array.from(new Set(metaCategories.filter(Boolean))).sort((a, b) => a.localeCompare(b)));
          } else if (!category && !debouncedSearch) {
            setCategoryOptions((prev) => {
              const next = new Set(isFirstPage ? [] : prev);
              items.forEach((show) => {
                if (show.category) next.add(show.category);
              });
              return Array.from(next).sort((a, b) => a.localeCompare(b));
            });
          }
        } else if (res.code !== 'REQUEST_ABORTED' && res.code !== 'ABORTED') {
          if (isFirstPage) {
            setShows([]);
            setHasMore(false);
          }
          setLoadError(res.error || t('browse.load_failed'));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          if (isFirstPage) setShows([]);
          setLoadError(t('browse.load_failed'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tenant?.id, tenantLoading, category, debouncedSearch, sort, page, retryKey, t]);

  useEffect(() => {
    setPage(1);
  }, [tenant?.id, category, debouncedSearch, sort]);

  const activeFilterCount = useMemo(
    () => [searchTerm.trim(), category].filter(Boolean).length,
    [category, searchTerm],
  );

  function clearFilters(): void {
    setSearchTerm('');
    setCategory('');
    setSort('newest');
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold leading-tight">{t('title')}</h1>
            <ModuleStageBadge stage="beta" />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('subtitle')}</p>
        </div>

        {isAuthenticated && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button as={Link} to={tenantPath('/podcasts/studio')} variant="tertiary" size="sm">
              {t('studio.title')}
            </Button>
            <Button as={Link} to={tenantPath('/podcasts/studio')} color="primary" size="sm" startContent={<Plus size={16} aria-hidden="true" />}>
              {t('studio.create_show')}
            </Button>
          </div>
        )}
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_12rem_auto]">
        <SearchField
          size="sm"
          value={searchTerm}
          onValueChange={setSearchTerm}
          onClear={() => setSearchTerm('')}
          isClearable
          placeholder={t('browse.search_placeholder')}
          aria-label={t('browse.search_placeholder')}
          startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
        />
        <Select
          size="sm"
          aria-label={t('browse.category_label')}
          selectedKeys={category ? [category] : ['all']}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as string | undefined;
            setCategory(value && value !== 'all' ? value : '');
          }}
        >
          <SelectItem id="all">{t('browse.all_categories')}</SelectItem>
          {categoryOptions.map((option) => (
            <SelectItem key={option} id={option}>{option}</SelectItem>
          ))}
        </Select>
        <Select
          size="sm"
          aria-label={t('browse.sort_label')}
          selectedKeys={[sort]}
          onSelectionChange={(keys) => setSort(((Array.from(keys)[0] as PodcastSort) || 'newest'))}
        >
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option} id={option}>{t(`browse.sort.${option}`)}</SelectItem>
          ))}
        </Select>
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={activeFilterCount === 0 && sort === 'newest'}
          onPress={clearFilters}
        >
          {t('browse.clear_filters')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16" role="status" aria-busy="true">
          <Spinner size="lg" />
        </div>
      ) : loadError ? (
        <div className="py-16 text-center" role="alert">
          <PodcastIcon size={42} className="mx-auto mb-3 text-danger" aria-hidden="true" />
          <p className="text-lg font-medium text-foreground">{t('browse.load_failed')}</p>
          <p className="mt-1 text-sm text-muted">{loadError}</p>
          <Button className="mt-4" variant="secondary" onPress={() => setRetryKey((value) => value + 1)}>
            {t('browse.retry')}
          </Button>
        </div>
      ) : shows.length === 0 ? (
        <div className="py-16 text-center text-muted">
          <PodcastIcon size={42} className="mx-auto mb-3" aria-hidden="true" />
          <p className="text-lg font-medium text-foreground">{t('browse.empty')}</p>
          <p className="mt-1 text-sm">{t('browse.empty_hint')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shows.map((show) => (
              <Card key={show.id} className="h-full">
                <CardBody className="flex h-full flex-col gap-4">
                  <div className="flex gap-4">
                    <Avatar
                      src={showArtwork(show)}
                      name={show.title}
                      radius="md"
                      className="h-16 w-16 shrink-0"
                      imgProps={showArtwork(show) ? {
                        src: resolveThumbnailUrl(showArtwork(show), { width: 192, height: 192 }),
                        referrerPolicy: 'no-referrer',
                      } : undefined}
                    />
                    <div className="min-w-0">
                      <Link className="text-base font-semibold hover:text-accent" to={tenantPath(`/podcasts/${show.slug}`)}>
                        {show.title}
                      </Link>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{show.summary || t('show.no_summary')}</p>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Chip size="sm" variant="soft">{t(`visibility.${show.visibility}`, { defaultValue: show.visibility })}</Chip>
                    {show.category ? <Chip size="sm" variant="soft">{show.category}</Chip> : null}
                    <span>{t('show.episode_count', { count: show.approved_episode_count ?? show.episode_count ?? 0 })}</span>
                    <span>{t('show.follower_count', { count: show.subscriber_count ?? 0 })}</span>
                    {show.owner?.name ? <span>{t('show.byline', { name: show.owner.name })}</span> : null}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" isLoading={loadingMore} onPress={() => setPage((p) => p + 1)}>
                {t('browse.load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
