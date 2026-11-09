// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * HashtagsDiscoveryPage - Browse and discover all hashtags
 *
 * Shows trending hashtags with post counts.
 * API: GET /api/v2/feed/hashtags/trending
 * API: GET /api/v2/feed/hashtags/search
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import Hash from 'lucide-react/icons/hash';
import TrendingUp from 'lucide-react/icons/trending-up';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface HashtagItem {
  tag: string;
  post_count: number;
  trend_direction?: 'up' | 'down' | 'stable';
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
};

const itemVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

export function HashtagsDiscoveryPage() {
  const { t } = useTranslation('feed');
  usePageTitle(t('hashtags.title'));
  const { tenantPath } = useTenant();

  const [hashtags, setHashtags] = useState<HashtagItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HashtagItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTrending = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<HashtagItem[]>('/v2/feed/hashtags/trending?limit=50');
      if (response.success && response.data) {
        setHashtags(response.data);
      } else {
        setError(t('hashtags.load_failed'));
      }
    } catch (err) {
      logError('Failed to load trending hashtags', err);
      setError(t('hashtags.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadTrending();
  }, [loadTrending]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        setIsSearching(true);
        const response = await api.get<HashtagItem[]>(`/v2/feed/hashtags/search?q=${encodeURIComponent(query)}`);
        if (response.success && response.data) {
          setSearchResults(response.data);
        }
      } catch (err) {
        logError('Failed to search hashtags', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const displayHashtags = searchQuery.length >= 2 ? searchResults : hashtags;

  return (
    <>
    <PageMeta
      title={t("hashtags.title")}
      description={t("hashtags.subtitle")}
    />
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <Button as={Link} to={tenantPath('/feed')}
        isIconOnly
        variant="flat"
        className="bg-theme-elevated text-theme-muted"
        aria-label={t('hashtags.back_to_feed')}
      >
        <ArrowLeft className="w-5 h-5" />
      </Button>
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        title={t('hashtags.title')}
        description={t('hashtags.subtitle')}
        icon={<Hash className="h-7 w-7" aria-hidden="true" />}
        accent="indigo"
      />

      {/* Search */}
      <GlassCard className="p-4">
        <SearchField
          placeholder={t('hashtags.search_placeholder')}
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          aria-label={t('hashtags.search_placeholder')}
          endContent={isSearching ? <span role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })}><Spinner size="sm" /></span> : undefined}
          classNames={{
            input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
            inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
          }}
        />
      </GlassCard>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('hashtags.unable_to_load')}</h3>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadTrending}
          >
            {t('hashtags.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Hashtags Grid */}
      {!isLoading && !error && (
        <>
          {displayHashtags.length === 0 ? (
            <EmptyState
              icon={<Hash className="w-12 h-12" aria-hidden="true" />}
              title={t('hashtags.no_hashtags')}
              description={searchQuery ? t('hashtags.no_match', { query: searchQuery }) : t('hashtags.no_trending')}
            />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
            >
              {displayHashtags.map((hashtag) => (
                <motion.div key={hashtag.tag} variants={itemVariants}>
                  <Link to={tenantPath(`/feed/hashtag/${hashtag.tag}`)}>
                    <GlassCard hoverable className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 mb-1">
                        {hashtag.trend_direction === 'up' && (
                          <TrendingUp className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                        )}
                        <span className="font-semibold text-theme-primary text-sm">
                          #{hashtag.tag}
                        </span>
                      </div>
                      <p className="text-xs text-theme-subtle">
                        {t('hashtags.post_count', { count: hashtag.post_count })}
                      </p>
                    </GlassCard>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          )}
        </>
      )}
    </div>
    </>
  );
}

export default HashtagsDiscoveryPage;
