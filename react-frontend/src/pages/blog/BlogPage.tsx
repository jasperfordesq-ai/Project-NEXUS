// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Blog Page - Community news and blog posts
 *
 * Uses V2 API: GET /api/v2/blog, GET /api/v2/blog/categories
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import BookOpen from 'lucide-react/icons/book-open';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleButtonGroup, ToggleButton } from '@/components/ui/ToggleButtonGroup';
import { MobileFilterBar } from '@/components/ui/MobileFilterBar';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import { BlogFilterSheet } from '@/components/blog/BlogFilterSheet';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
// Direct hook paths on purpose: BlogPage.test.tsx replaces the whole '@/hooks'
// barrel with a partial stub, so a barrel import would resolve to `undefined`.
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { usePrerenderReady } from '@/hooks/usePrerenderReady';

/* ───────────────────────── Types ───────────────────────── */

interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  featured_image: string | null;
  published_at: string;
  created_at: string;
  views: number;
  reading_time: number;
  category: {
    id: number;
    name: string;
    color: string;
  } | null;
}

interface BlogCategory {
  id: number;
  name: string;
  slug: string;
  color: string;
  post_count: number;
}

/* ───────────────────────── Main Component ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const POSTS_PER_PAGE = 12;
/** Phones render fewer skeletons — six full-height cards is ~1,700px of grey. */
const SKELETON_KEYS = [1, 2, 3, 4, 5, 6];
const PHONE_SKELETON_KEYS = [1, 2, 3];

/**
 * Single source of truth for the `/v2/blog` query string, so the initial load,
 * the filtered reload and the "Load More" append can never drift apart.
 */
function buildBlogQuery(options: {
  cursor?: string;
  search: string;
  categoryId: number | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('per_page', String(POSTS_PER_PAGE));
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.search.trim()) params.set('search', options.search.trim());
  if (options.categoryId) params.set('category_id', String(options.categoryId));
  return params;
}

const categoryColorMap: Record<string, string> = {
  blue: 'bg-blue-500/10 text-[var(--color-info)]',
  gray: 'bg-gray-500/10 text-gray-500',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-500',
  purple: 'bg-accent/10 text-accent',
  green: 'bg-emerald-500/10 text-emerald-500',
  red: 'bg-rose-500/10 text-rose-500',
  yellow: 'bg-amber-500/10 text-[var(--color-warning)]',
};

export function BlogPage() {
  const { t } = useTranslation('blog');
  usePageTitle(t('page_title'));
  // Phones hide the hero, so the page title lives in the fixed app bar instead.
  useSetAppBarTitle(t('title'));
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [categoriesReady, setCategoriesReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `searchInput` is what the field/pill shows; `searchQuery` is the debounced
  // value the fetch depends on. The split is mandatory rather than cosmetic:
  // MobileSearchOverlay fires `onValueChange` on every keystroke by design, and
  // before the split every keystroke fired its own GET /v2/blog.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isPaginated, setIsPaginated] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  // Load categories on mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await api.get<BlogCategory[]>('/v2/blog/categories');
        if (response.success && response.data) {
          setCategories(Array.isArray(response.data) ? response.data : []);
          setCategoriesReady(true);
        }
      } catch (err) {
        setCategoriesReady(false);
        logError('Failed to load blog categories', err);
      }
    };
    loadCategories();
  }, []);

  const cursorRef = useRef<string | undefined>(undefined);

  const loadPosts = useCallback(async (append = false) => {
    // Capture OUR controller in a local. The previous code compared against
    // `abortRef.current`, which is the controller this very call just installed
    // and never aborts — so the staleness guards could never fire and an
    // out-of-order response could clobber the list.
    let controller: AbortController | null = null;
    if (!append) {
      abortRef.current?.abort();
      controller = new AbortController();
      abortRef.current = controller;
    }

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      const params = buildBlogQuery({
        cursor: append ? cursorRef.current : undefined,
        search: searchQuery,
        categoryId: selectedCategory,
      });

      const response = await api.get<BlogPost[]>(
        `/v2/blog?${params}`
      );

      if (controller?.signal.aborted) return;

      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];

        if (append) {
          setPosts((prev) => [...prev, ...items]);
          setIsPaginated(true);
        } else {
          setPosts(items);
          setIsPaginated(false);
        }
        setHasMore(response.meta?.has_more ?? false);
        cursorRef.current = response.meta?.cursor ?? undefined;
      } else {
        if (!append) setError(tRef.current('error_load_posts'));
      }
    } catch (err) {
      if (controller?.signal.aborted) return;
      logError('Failed to load blog posts', err);
      if (!append) setError(tRef.current('error_load_posts_retry'));
    } finally {
      // A superseded request must not clear the spinner the newer one just set.
      if (append) {
        setIsLoadingMore(false);
      } else if (!controller?.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [searchQuery, selectedCategory]);

  // Debounce the search field / overlay into the value the fetch depends on.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    cursorRef.current = undefined;
    loadPosts();
  }, [searchQuery, selectedCategory, loadPosts]);

  /**
   * ONE boolean for "the visible list is filtered". Both the featured-post
   * branch and the grid's `slice()` must read the same value, or post #1 either
   * duplicates (featured + grid) or vanishes.
   */
  const hasActiveFilters = Boolean(searchQuery || selectedCategory);
  const showFeaturedPost = !hasActiveFilters && !isPaginated;

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setSelectedCategory(null);
  }, []);

  // Phone: the applied category as a removable chip (search shows in the pill).
  const phoneFilterChips = useMemo(() => {
    if (selectedCategory === null) return [];
    const cat = categories.find((c) => c.id === selectedCategory);
    return [{
      key: 'category',
      label: cat?.name ?? String(selectedCategory),
      onRemove: () => setSelectedCategory(null),
    }];
  }, [selectedCategory, categories]);

  usePrerenderReady(!isLoading && error === null && categoriesReady);

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_title')} description={t('page_description')} />
      {/* Phones hide the hero entirely — the title lives in the app bar (useSetAppBarTitle). */}
      {!isPhone && (
      <PublicPageHero
        eyebrow={t('hero_eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        accent="blue"
        icon={<BookOpen className="h-7 w-7" aria-hidden="true" />}
        stats={posts.length > 0 && !isLoading ? [{ label: t('hero_posts_label'), value: posts.length.toLocaleString(getFormattingLocale()) }] : undefined}
      />
      )}

      {/* The hero holds the page's only <h1>; keep one for screen readers and
          for a future mobile-viewport prerender variant. */}
      {isPhone && <h1 className="sr-only">{t('title')}</h1>}

      {/* Phone: slim sticky control bar — auto-hides on scroll down. No view-mode
          toggle exists on this page, so the search pill takes the extra width. */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="blue"
          onSearchPress={() => setIsSearchOverlayOpen(true)}
          searchValue={searchInput}
          onFiltersPress={() => setIsFilterSheetOpen(true)}
          chips={phoneFilterChips}
          onClearAll={resetFilters}
          labels={{ search: t('search_placeholder') }}
          testId="blog-filter-bar"
        />
      )}

      {/* Phone: re-homes the hero's "Posts shown" stat (posts loaded so far — the
          endpoint publishes no total). */}
      {isPhone && !isLoading && posts.length > 0 && (
        <p className="px-1 text-xs font-medium text-theme-muted sm:hidden">
          {t('results_count', { count: posts.length })}
        </p>
      )}

      {/* Search & Filters (tablet and desktop — phones use the sticky bar + sheet) */}
      {!isPhone && (
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 max-w-md">
          <SearchField
            placeholder={t('search_placeholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t('search_placeholder')}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />
        </div>

        {categories.length > 0 && (
          <ToggleButtonGroup
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[selectedCategory === null ? 'all' : String(selectedCategory)]}
            onSelectionChange={(keys) => {
              const next = Array.from(keys)[0];
              setSelectedCategory(next && next !== 'all' ? Number(next) : null);
            }}
            isDetached
            size="sm"
            className="flex gap-2 flex-wrap"
            aria-label={t('filter_by_category')}
          >
            <ToggleButton
              id="all"
              className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-blue-500 data-[selected=true]:to-accent-gradient-end data-[selected=true]:text-white"
            >
              {t('filter_all')}
            </ToggleButton>
            {categories.map((cat) => (
              <ToggleButton
                key={cat.id}
                id={String(cat.id)}
                className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-blue-500 data-[selected=true]:to-accent-gradient-end data-[selected=true]:text-white"
              >
                {cat.name}
                {cat.post_count > 0 && (
                  <span className="ml-1 opacity-70">({cat.post_count})</span>
                )}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-blue-500 to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadPosts()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Posts Grid */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true" aria-label={t('loading_posts')}>
              {(isPhone ? PHONE_SKELETON_KEYS : SKELETON_KEYS).map((i) => (
                <GlassCard key={i} className="overflow-hidden">
                  <Skeleton className="h-48 rounded-none" />
                  <div className="p-5">
                    <Skeleton className="mb-3 h-4 w-1/4 rounded" />
                    <Skeleton className="mb-2 h-5 w-3/4 rounded" />
                    <Skeleton className="mb-1 h-3 w-full rounded" />
                    <Skeleton className="mb-4 h-3 w-2/3 rounded" />
                    <Skeleton className="h-3 w-1/3 rounded" />
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <PublicEmptyState
              icon={<BookOpen className="w-12 h-12" aria-hidden="true" />}
              title={t('empty_title')}
              description={hasActiveFilters ? t('empty_desc_filtered') : t('empty_desc')}
              accent="blue"
              tips={[t('empty_tip_stories'), t('empty_tip_guides'), t('empty_tip_updates')]}
            />
          ) : (
            <>
              {/* Featured Post (first post gets larger treatment) */}
              {posts.length > 0 && showFeaturedPost && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {posts[0] && <FeaturedPostCard post={posts[0]} categoryColors={categoryColorMap} />}
                </motion.div>
              )}

              {/* Posts Grid */}
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
              >
                {posts.slice(showFeaturedPost ? 1 : 0).map((post) => (
                  <motion.div key={post.id} variants={itemVariants}>
                    <BlogPostCard post={post} categoryColors={categoryColorMap} />
                  </motion.div>
                ))}
              </motion.div>

              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="flat"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={() => loadPosts(true)}
                    isLoading={isLoadingMore}
                  >
                    {t('load_more')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchInput}
          onValueChange={setSearchInput}
          onSubmit={(value) => setSearchQuery(value)}
          placeholder={t('search_placeholder')}
          recentKey="blog"
        />
      )}

      {/* Phone filter sheet — one category chip row, applied on tap (simple archetype). */}
      {isPhone && (
        <BlogFilterSheet
          isOpen={isFilterSheetOpen}
          onClose={() => setIsFilterSheetOpen(false)}
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Featured Post Card ───────────────────────── */

interface PostCardProps {
  post: BlogPost;
  categoryColors: Record<string, string>;
}

function FeaturedPostCard({ post, categoryColors }: PostCardProps) {
  const { t } = useTranslation('blog');
  const { tenantPath } = useTenant();
  const imageProps = post.featured_image
    ? responsiveThumbnailProps(post.featured_image, {
        width: 720,
        height: 420,
        sizes: '(min-width: 768px) 44vw, 92vw',
      })
    : null;

  return (
    <Link to={tenantPath(`/blog/${post.slug}`)} className="block group mb-6">
      <GlassCard className="overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Image */}
          <div className="md:w-1/2 h-48 md:h-72 bg-gradient-to-br from-blue-500/20 to-accent-gradient-end/20 flex items-center justify-center overflow-hidden">
            {imageProps ? (
              <img
                {...imageProps}
                alt={post.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
                decoding="async"
                width={600}
                height={288}
              />
            ) : (
              <BookOpen className="w-16 h-16 text-blue-300 opacity-50" aria-hidden="true" />
            )}
          </div>

          {/* Content */}
          <div className="md:w-1/2 p-4 sm:p-6 flex flex-col justify-center">
            {post.category && (
              <Chip
                size="sm"
                variant="flat"
                className={`mb-3 w-fit ${categoryColors[post.category.color] ?? categoryColors.blue}`}
              >
                {post.category.name}
              </Chip>
            )}
            <h2 className="text-xl font-bold text-theme-primary mb-2 group-hover:text-[var(--color-info)] transition-colors line-clamp-2">
              {post.title}
            </h2>
            <p className="text-sm text-theme-muted mb-4 line-clamp-3">{post.excerpt}</p>

            <div className="flex items-center gap-4 text-xs text-theme-subtle">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" aria-hidden="true" />
                {new Date(post.published_at).toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {t('min_read', { count: post.reading_time })}
              </span>
            </div>
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

/* ───────────────────────── Blog Post Card ───────────────────────── */

function BlogPostCard({ post, categoryColors }: PostCardProps) {
  const { t } = useTranslation('blog');
  const { tenantPath } = useTenant();
  const imageProps = post.featured_image
    ? responsiveThumbnailProps(post.featured_image, {
        width: 420,
        height: 260,
        sizes: '(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw',
      })
    : null;

  return (
    <Link to={tenantPath(`/blog/${post.slug}`)} className="block group h-full">
      <GlassCard className="overflow-hidden h-full flex flex-col">
        {/* Image */}
        <div className="h-48 bg-gradient-to-br from-blue-500/10 to-accent-gradient-end/10 flex items-center justify-center overflow-hidden">
          {imageProps ? (
            <img
              {...imageProps}
              alt={post.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <BookOpen className="w-12 h-12 text-blue-300 opacity-30" aria-hidden="true" />
          )}
        </div>

        {/* Content */}
        <div className="p-5 flex-1 flex flex-col">
          {post.category && (
            <Chip
              size="sm"
              variant="flat"
              className={`mb-2 w-fit ${categoryColors[post.category.color] ?? categoryColors.blue}`}
            >
              {post.category.name}
            </Chip>
          )}

          <h3 className="font-semibold text-theme-primary group-hover:text-[var(--color-info)] transition-colors mb-2 line-clamp-2">
            {post.title}
          </h3>

          <p className="text-sm text-theme-muted mb-4 flex-1 line-clamp-3">{post.excerpt}</p>

          <div className="flex items-center justify-between text-xs text-theme-subtle mt-auto pt-3 border-t border-theme-default">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {t('min_read_short', { count: post.reading_time })}
              </span>
              {post.views > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" aria-hidden="true" />
                  {post.views}
                </span>
              )}
            </div>
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

export default BlogPage;
