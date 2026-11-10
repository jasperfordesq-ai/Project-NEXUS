// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Knowledge Base Page
 *
 * Browsable, searchable knowledge base with category tabs, article cards,
 * and polished UI. Supports nested articles and search.
 *
 * API: GET /api/v2/kb
 *      GET /api/v2/kb/search?q=...
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import BookOpen from 'lucide-react/icons/book-open';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ChevronRight from 'lucide-react/icons/chevron-right';
import FileText from 'lucide-react/icons/file-text';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import Folder from 'lucide-react/icons/folder';
import File from 'lucide-react/icons/file';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { categoryColour, colourForSeed } from '@/lib/categoryColours';
import { coverSeed } from '@/lib/coverSeeds';
import { useCategoryListColours } from '@/hooks/useCategoryListColours';

/* ───────────────────────── Types ───────────────────────── */

interface KBArticle {
  id: number;
  title: string;
  slug: string;
  content_type: string;
  category_id: number | null;
  category_name: string | null;
  parent_article_id: number | null;
  is_published: boolean;
  views_count: number;
  helpful_yes: number;
  helpful_no: number;
  created_at: string;
  updated_at: string | null;
  author: { id: number; name: string } | null;
  // Search results shape
  content_preview?: string;
  helpfulness?: number | null;
}

const ALL_CATEGORIES = '__all__';

/* ───────────────────────── Helpers ───────────────────────── */

function getContentTypeIcon(type: string) {
  switch (type) {
    case 'markdown': return 'MD';
    case 'plain': return 'TXT';
    default: return null;
  }
}

/* ───────────────────────── Component ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export function KnowledgeBasePage() {
  const { t } = useTranslation('kb');
  const palette = useSitePalette();
  // The community's help-centre categories share the palette out in id
  // order, so two never match by chance (warmth plan W3).
  const kbCategoryColour = useCategoryListColours('/v2/categories?type=resource');
  usePageTitle(t('title'));
  const { tenantPath } = useTenant();

  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KBArticle[] | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);

  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  // Load articles
  const loadArticles = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<KBArticle[]>('/v2/kb?per_page=100');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        setArticles(items);
      } else {
        setError(tRef.current('error.load_articles'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load KB articles', err);
      setError(tRef.current('error.load_retry'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  // Search
  const searchAbortRef = useRef<AbortController | null>(null);
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      setIsSearching(true);
      const response = await api.get<KBArticle[]>(`/v2/kb/search?q=${encodeURIComponent(query.trim())}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setSearchResults(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to search KB', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => handleSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  // Extract unique categories from articles
  const categories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const a of articles) {
      const name = a.category_name || t('general_category');
      cats.set(name, (cats.get(name) || 0) + 1);
    }
    return Array.from(cats.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [articles, t]);

  // Filter articles by active category
  const displayArticles = useMemo(() => {
    const source = searchResults || articles;
    if (activeCategory === ALL_CATEGORIES || searchResults) return source;
    const generalLabel = t('general_category');
    return source.filter((a) => {
      const cat = a.category_name || generalLabel;
      return cat === activeCategory;
    });
  }, [searchResults, articles, activeCategory, t]);

  // Group filtered articles by category
  const groupedArticles = useMemo(() => {
    const groups: Record<string, KBArticle[]> = {};
    for (const article of displayArticles) {
      const cat = article.category_name || t('general_category');
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(article);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [displayArticles, t]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageMeta title={t('page_title')} description={t('page_description')} />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        title={t('title')}
        description={t('description')}
        icon={<BookOpen className="h-7 w-7" aria-hidden="true" />}
        accent="blue"
      />

      {/* Search */}
      <div className="max-w-xl mx-auto">
        <SearchField
          placeholder={t('search_placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={t('search_placeholder')}
          endContent={isSearching ? <span role="status" aria-label={t('searching')}><Spinner size="sm" /></span> : undefined}
          classNames={{
            input: 'bg-transparent text-theme-primary',
            inputWrapper: 'bg-theme-elevated border-theme-default shadow-sm',
          }}
          size="lg"
          isClearable
          onClear={() => { setSearchQuery(''); setSearchResults(null); }}
        />
      </div>

      {/* Search Results Indicator */}
      {searchResults !== null && (
        <div className="flex items-center justify-center gap-2">
          <Chip
            size="sm"
            variant="flat"
            className="bg-blue-500/10 text-blue-700 dark:text-blue-400"
            onClose={() => { setSearchQuery(''); setSearchResults(null); }}
          >
            {t('search_results', { count: searchResults.length, query: searchQuery })}
          </Chip>
        </div>
      )}

      {/* Category Tabs */}
      {!searchResults && categories.length > 1 && !isLoading && (
        <div className="flex justify-center">
          <Tabs
            aria-label={t('category_tabs_aria')}
            selectedKey={activeCategory}
            onSelectionChange={(key) => setActiveCategory(key as string)}
            variant="underlined"
            size="sm"
            classNames={{
              tabList: 'gap-4 flex-wrap justify-center',
              tab: 'px-1',
            }}
          >
            <Tab
              key={ALL_CATEGORIES}
              title={
                <span className="flex items-center gap-1.5">
                  {t('all_categories')}
                  <Chip size="sm" variant="flat" className="text-[10px] min-w-5 h-4 bg-theme-elevated text-theme-subtle">
                    {articles.length}
                  </Chip>
                </span>
              }
            />
            {categories.map(([name, count]) => (
              <Tab
                key={name}
                title={
                  <span className="flex items-center gap-1.5">
                    {name}
                    <Chip size="sm" variant="flat" className="text-[10px] min-w-5 h-4 bg-theme-elevated text-theme-subtle">
                      {count}
                    </Chip>
                  </span>
                }
              />
            ))}
          </Tabs>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('error.title')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-blue-600 to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadArticles}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Content */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" aria-label={t('loading')} aria-busy="true" className="space-y-4">
              {[1, 2, 3].map((i) => (
                <CardRowsSkeleton key={i} />
              ))}
            </div>
          ) : displayArticles.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="w-12 h-12" aria-hidden="true" />}
              title={t('empty.title')}
              description={searchQuery ? t('empty.search_description') : t('empty.no_articles')}
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              {groupedArticles.map(([category, catArticles]) => {
                // Each category in its own colour, shared by its heading and its
                // articles' tiles (AWID: "clear categories"; all were blue).
                const colour = kbCategoryColour(catArticles[0]?.category_id)
                  ?? colourForSeed(coverSeed.kbCategory(catArticles[0]?.category_id), palette);
                const tone = categoryColour(colour);
                return (
                <motion.div key={category} variants={itemVariants}>
                  <GlassCard className="overflow-hidden">
                    {/* Category header */}
                    <div data-testid="kb-category-heading" data-colour={colour} className={`px-5 py-3 border-b border-theme-default ${tone.band}`}>
                      <h2 className="text-sm font-semibold flex items-center gap-2">
                        <Folder className="w-4 h-4" aria-hidden="true" />
                        {category}
                        <Chip size="sm" variant="flat" className="text-[10px] bg-theme-elevated text-theme-subtle">
                          {t('article_count', { count: catArticles.length })}
                        </Chip>
                      </h2>
                    </div>

                    {/* Article list */}
                    <div className="divide-y divide-theme-default">
                      {catArticles.map((article) => (
                        <Link
                          key={article.id}
                          to={tenantPath(`/kb/${article.id}`)}
                          className="flex items-center gap-4 px-5 py-4 hover:bg-theme-hover/40 transition-colors group"
                        >
                          <div data-testid="kb-article-tile" data-colour={colour} className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tone.band}`}>
                            <FileText className="w-5 h-5" aria-hidden="true" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-theme-primary group-hover:text-accent transition-colors truncate">
                                {article.title}
                              </h3>
                              {getContentTypeIcon(article.content_type) && (
                                <Chip size="sm" variant="flat" className="text-[9px] h-4 bg-theme-elevated text-theme-subtle flex-shrink-0">
                                  {getContentTypeIcon(article.content_type)}
                                </Chip>
                              )}
                            </div>
                            {article.content_preview && (
                              <p className="text-xs text-theme-muted line-clamp-1 mt-0.5">{article.content_preview}</p>
                            )}
                            <div className="flex items-center gap-3 text-xs text-theme-subtle mt-1.5">
                              {article.updated_at && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" aria-hidden="true" />
                                  {formatRelativeTime(article.updated_at)}
                                </span>
                              )}
                              {article.views_count > 0 && (
                                <span className="flex items-center gap-1">
                                  <Eye className="w-3 h-3" aria-hidden="true" />
                                  {t('views', { count: article.views_count })}
                                </span>
                              )}
                              {article.author && (
                                <span className="text-theme-subtle">
                                  {t('author_by', { name: article.author.name })}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-theme-subtle group-hover:text-accent transition-colors flex-shrink-0" aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  </GlassCard>
                </motion.div>
                );
              })}
            </motion.div>
          )}
        </>
      )}

      {/* Stats footer */}
      {!isLoading && !error && articles.length > 0 && (
        <div className="flex items-center justify-center gap-4 text-xs text-theme-subtle py-2">
          <span className="flex items-center gap-1">
            <File className="w-3 h-3" aria-hidden="true" />
            {t('article_count', { count: articles.length })}
          </span>
          {categories.length > 0 && (
            <span className="flex items-center gap-1">
              <Folder className="w-3 h-3" aria-hidden="true" />
              {t('category_count', { count: categories.length })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default KnowledgeBasePage;
