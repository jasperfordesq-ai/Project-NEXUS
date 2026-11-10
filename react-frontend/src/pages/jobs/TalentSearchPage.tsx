// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { CloseButton } from '@/components/ui/CloseButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
/**
 * Talent Search Page — Candidate Resume Database Search
 *
 * Allows authenticated users to search community members who have opted in
 * to being discoverable by employers (resume_searchable = 1).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import MapPin from 'lucide-react/icons/map-pin';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import Filter from 'lucide-react/icons/filter';
import X from 'lucide-react/icons/x';
import UserSearch from 'lucide-react/icons/user-search';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { useMediaQuery, usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';

interface Candidate {
  id: number;
  first_name: string;
  last_name: string;
  name: string;
  avatar_url: string | null;
  headline: string | null;
  skills: string[];
  location: string | null;
  last_active: string | null;
}

interface SearchResult {
  items: Candidate[];
  total: number;
}

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 400;

export function TalentSearchPage() {
  const { t } = useTranslation('jobs');
  const { tenantPath } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();

  usePageTitle(t('talent_search.title'));

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Search state
  const [keywords, setKeywords] = useState(searchParams.get('q') || '');
  const [debouncedKeywords, setDebouncedKeywords] = useState(keywords);
  const [skillsInput, setSkillsInput] = useState(searchParams.get('skills') || '');
  const [locationInput, setLocationInput] = useState(searchParams.get('location') || '');
  const [showFilters, setShowFilters] = useState(false);
  const usesFilterSheet = useMediaQuery('(max-width: 639px)');

  // Refs
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  // Debounce keyword input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedKeywords(keywords);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [keywords]);

  const searchCandidates = useCallback(async (offset = 0, append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!append) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('per_page', String(ITEMS_PER_PAGE));
      params.set('offset', String(offset));

      if (debouncedKeywords.trim()) {
        params.set('keywords', debouncedKeywords.trim());
      }
      if (skillsInput.trim()) {
        params.set('skills', skillsInput.trim());
      }
      if (locationInput.trim()) {
        params.set('location', locationInput.trim());
      }

      const response = await api.get<SearchResult>(`/v2/jobs/talent-search?${params.toString()}`);

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const result = response.data;
        if (append) {
          setCandidates((prev) => [...prev, ...(result.items || [])]);
        } else {
          setCandidates(result.items || []);
        }
        setTotalCount(result.total || 0);
        setHasSearched(true);
      } else {
        setError(tRef.current('talent_search.error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to search candidates', err);
      setError(tRef.current('talent_search.error'));
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [debouncedKeywords, skillsInput, locationInput]);

  // Auto-search when debounced keywords change
  useEffect(() => {
    searchCandidates(0, false);
  }, [searchCandidates]);

  // Update URL search params
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedKeywords) params.set('q', debouncedKeywords);
    if (skillsInput) params.set('skills', skillsInput);
    if (locationInput) params.set('location', locationInput);
    setSearchParams(params, { replace: true });
  }, [debouncedKeywords, skillsInput, locationInput, setSearchParams]);

  const handleLoadMore = () => {
    searchCandidates(candidates.length, true);
  };

  const handleClearFilters = () => {
    setKeywords('');
    setSkillsInput('');
    setLocationInput('');
  };

  const hasActiveFilters = keywords.trim() || skillsInput.trim() || locationInput.trim();
  const hasMore = candidates.length < totalCount;

  const formatLastActive = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('talent_search.today');
    if (diffDays === 1) return t('talent_search.yesterday');
    if (diffDays < 7) return t('talent_search.days_ago', { count: diffDays });
    if (diffDays < 30) return t('talent_search.weeks_ago', { count: Math.floor(diffDays / 7) });
    return date.toLocaleDateString(getFormattingLocale());
  };

  const filterFields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input
        label={t('talent_search.skills_filter')}
        placeholder={t('talent_search.skills_placeholder')}
        value={skillsInput}
        onChange={(e) => setSkillsInput(e.target.value)}
        description={t('talent_search.skills_description')}
        classNames={{
          input: 'bg-transparent text-theme-primary',
          inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
        }}
      />
      <Input
        label={t('talent_search.location_filter')}
        placeholder={t('talent_search.location_placeholder')}
        value={locationInput}
        onChange={(e) => setLocationInput(e.target.value)}
        startContent={<MapPin className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
        classNames={{
          input: 'bg-transparent text-theme-primary',
          inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
        }}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_meta.talent_search.title')} noIndex />
      {/* Back navigation */}
      <Link
        to={tenantPath('/jobs')}
        className="inline-flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t('title')}
      </Link>

      {/* Header */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-strong to-accent-strong-end flex items-center justify-center">
            <UserSearch className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-theme-primary">
              {t('talent_search.title')}
            </h1>
            <p className="text-sm text-theme-muted">
              {t('talent_search.subtitle')}
            </p>
          </div>
        </div>

        {/* Search bar */}
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <SearchField
              placeholder={t('talent_search.search_placeholder')}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              className="flex-1"
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
              aria-label={t('talent_search.search_placeholder')}
            />
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-muted"
              startContent={<Filter className="w-4 h-4" aria-hidden="true" />}
              onPress={() => setShowFilters(!showFilters)}
            >
              {t('talent_search.skills_filter')}
            </Button>
          </div>

          <BottomSheet
            isOpen={showFilters && usesFilterSheet}
            onClose={() => setShowFilters(false)}
            title={t('talent_search.skills_filter')}
            snapPoints={['auto']}
          >
            {filterFields}
          </BottomSheet>

          {/* Larger screens retain the compact inline filter row. */}
          {showFilters && !usesFilterSheet && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="hidden sm:block"
            >
              {filterFields}
            </motion.div>
          )}

          {/* Active filters / clear */}
          {hasActiveFilters && (
            <div className="flex items-center gap-2 flex-wrap">
              {keywords.trim() && (
                <Chip
                  size="sm"
                  variant="tertiary"
                  color="accent"
                >
                  <Chip.Label>{keywords}</Chip.Label>
                  <CloseButton
                    aria-label={t('talent_search.clear_filters')}
                    className="inline-flex size-3 items-center justify-center text-current opacity-70 hover:opacity-100"
                    onPress={() => setKeywords('')}
                  />
                </Chip>
              )}
              {skillsInput.trim() && (
                <Chip
                  size="sm"
                  variant="tertiary"
                  color="default"
                >
                  <Chip.Label>{t('talent_search.skills_chip', { skills: skillsInput })}</Chip.Label>
                  <CloseButton
                    aria-label={t('talent_search.clear_filters')}
                    className="inline-flex size-3 items-center justify-center text-current opacity-70 hover:opacity-100"
                    onPress={() => setSkillsInput('')}
                  />
                </Chip>
              )}
              {locationInput.trim() && (
                <Chip
                  size="sm"
                  variant="tertiary"
                  color="default"
                >
                  <MapPin className="w-3 h-3" aria-hidden="true" />
                  <Chip.Label>
                    {locationInput}
                  </Chip.Label>
                  <CloseButton
                    aria-label={t('talent_search.clear_filters')}
                    className="inline-flex size-3 items-center justify-center text-current opacity-70 hover:opacity-100"
                    onPress={() => setLocationInput('')}
                  />
                </Chip>
              )}
              <Button
                size="sm"
                variant="light"
                className="text-theme-muted"
                startContent={<X className="w-3 h-3" aria-hidden="true" />}
                onPress={handleClearFilters}
              >
                {t('talent_search.clear_filters')}
              </Button>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Results count */}
      {hasSearched && !isLoading && (
        <p className="text-sm text-theme-muted">
          {t('talent_search.results_count', { count: totalCount })}
        </p>
      )}

      {/* Loading */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('talent_search.loading')} className="flex items-center justify-center py-12">
          <Spinner size="lg" aria-hidden="true" />
          <span className="ml-3 text-theme-muted">{t('talent_search.loading')}</span>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-6 text-center" role="alert">
          <p className="text-danger mb-3">{error}</p>
          <Button
            variant="flat"
            className="bg-theme-elevated text-theme-muted"
            onPress={() => searchCandidates(0, false)}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Empty state */}
      {!isLoading && !error && hasSearched && candidates.length === 0 && (
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title={t('talent_search.no_results_title')}
          description={t('talent_search.no_results_description')}
          action={
            hasActiveFilters ? (
              <Button
                variant="flat"
                className="bg-theme-elevated text-theme-muted"
                onPress={handleClearFilters}
              >
                {t('talent_search.clear_filters')}
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Candidate cards */}
      {!isLoading && candidates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {candidates.map((candidate, index) => (
            <motion.div
              key={candidate.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <Link to={tenantPath(`/profile/${candidate.id}`)}>
                <GlassCard className="p-5 hover:border-accent/30 transition-colors cursor-pointer h-full">
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={candidate.name}
                      src={resolveAvatarUrl(candidate.avatar_url)}
                      size="md"
                      isBordered
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-theme-primary truncate">
                        {candidate.name}
                      </h3>
                      <p className="text-sm text-theme-muted truncate">
                        {candidate.headline || t('talent_search.headline_placeholder')}
                      </p>
                    </div>
                  </div>

                  {/* Skills */}
                  {candidate.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {candidate.skills.slice(0, 5).map((skill) => (
                        <Chip
                          key={skill}
                          size="sm"
                          variant="tertiary"
                          color="accent"
                          className="bg-accent/10 text-accent-soft-foreground"
                        >
                          {skill}
                        </Chip>
                      ))}
                      {candidate.skills.length > 5 && (
                        <Chip size="sm" variant="tertiary" color="default">
                          +{candidate.skills.length - 5}
                        </Chip>
                      )}
                    </div>
                  )}

                  {/* Meta info */}
                  <div className="flex items-center gap-3 mt-3 text-xs text-theme-subtle">
                    {candidate.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {candidate.location}
                      </span>
                    )}
                    {candidate.last_active && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {formatLastActive(candidate.last_active)}
                      </span>
                    )}
                  </div>
                </GlassCard>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !isLoading && candidates.length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="flat"
            className="bg-theme-elevated text-theme-muted"
            onPress={handleLoadMore}
            isLoading={isLoadingMore}
          >
            {t('talent_search.load_more')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default TalentSearchPage;
