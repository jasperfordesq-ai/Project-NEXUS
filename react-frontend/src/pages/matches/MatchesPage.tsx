// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Matches Page (MA1) - Cross-Module Matches
 * Unified matches feed showing matches from all modules:
 * listings, groups, volunteering, events.
 * Each card shows module, match score, title, reasons, and — where the
 * backend provides it — a full score breakdown and AI explanation.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from '@/lib/motion';

import Sparkles from 'lucide-react/icons/sparkles';
import ListChecks from 'lucide-react/icons/list-checks';
import Heart from 'lucide-react/icons/heart';
import Users from 'lucide-react/icons/users';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TrendingUp from 'lucide-react/icons/trending-up';
import Target from 'lucide-react/icons/target';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import MapPin from 'lucide-react/icons/map-pin';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import { Alert } from '@/components/ui/Alert';
import { AlgorithmLabel } from '@/components/ui/AlgorithmLabel';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { Breadcrumbs } from '@/components/navigation';
import { useAuth, useToast, useTenant } from '@/contexts';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

import { useTranslation } from 'react-i18next';
import { MatchCard } from './components/MatchCard';
import { MatchesEmptyState } from './components/MatchesEmptyState';
import type { Match, MatchesMeta, MatchModule } from './types';
import { matchElementId } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TabFilter = 'all' | 'listings' | 'groups' | 'volunteering';

const TAB_MODULE: Record<Exclude<TabFilter, 'all'>, MatchModule> = {
  listings: 'listing',
  groups: 'group',
  volunteering: 'volunteering',
};

const TAB_CONFIG: Record<Exclude<TabFilter, 'all'>, { icon: typeof ListChecks; labelKey: string }> = {
  listings: { icon: ListChecks, labelKey: 'filter_people_listings' },
  groups: { icon: Users, labelKey: 'source_group' },
  volunteering: { icon: Heart, labelKey: 'source_volunteering' },
};

const DEFAULT_META: MatchesMeta = {
  total: 0,
  modules: [],
  min_score: 0,
  needs_location: false,
  degraded: false,
  degraded_reason: null,
  has_active_listings: null,
  paused: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MatchesPage() {
  const { t } = useTranslation('matches');
  usePageTitle(t('page_title'));
  useAuth(); // ensure authenticated
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [matches, setMatches] = useState<Match[]>([]);
  const [meta, setMeta] = useState<MatchesMeta>(DEFAULT_META);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mutualOnly, setMutualOnly] = useState(searchParams.get('type') === 'mutual');
  const [showMutualBanner, setShowMutualBanner] = useState(searchParams.get('type') === 'mutual');

  const tabFromParams = (searchParams.get('tab') as TabFilter | null) ?? 'all';
  const [tab, setTab] = useState<TabFilter>(
    tabFromParams === 'listings' || tabFromParams === 'groups' || tabFromParams === 'volunteering' ? tabFromParams : 'all',
  );

  const highlightId = searchParams.get('highlight');
  const hasScrolledRef = useRef(false);

  // ─── Load matches ───
  const loadMatches = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.get<{ matches?: Match[]; meta?: Partial<MatchesMeta> }>('/v2/matches/all');
      // api.get resolves { success:false } on a 4xx WITHOUT throwing — without
      // the else branch a failure envelope rendered the "no matches yet" empty
      // state as if the user genuinely had no matches.
      if (res.success) {
        const payload = res.data;
        const items = Array.isArray(payload) ? payload : payload?.matches ?? [];
        setMatches(items);
        setMeta({ ...DEFAULT_META, ...(Array.isArray(payload) ? {} : payload?.meta ?? {}) });
        setLoadError(false);
      } else if (showRefresh) {
        // Keep the already-loaded list on a failed refresh; just tell the user.
        toast.error(t('load_failed'));
      } else {
        setLoadError(true);
      }
    } catch (err) {
      logError('MatchesPage.load', err);
      toast.error(t('load_failed'));
      if (!showRefresh) setLoadError(true);
    }

    setLoading(false);
    setRefreshing(false);
  }, [toast, t]);

  useEffect(() => { loadMatches(); }, [loadMatches]);

  // ─── Sync tab -> URL ───
  const handleTabChange = useCallback((key: TabFilter) => {
    setTab(key);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key === 'all') next.delete('tab');
      else next.set('tab', key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ─── Scroll to highlighted match once loaded ───
  useEffect(() => {
    if (!highlightId || loading || hasScrolledRef.current) return;
    const el = document.getElementById(highlightId);
    if (el) {
      hasScrolledRef.current = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightId, loading, matches]);

  // ─── Dismiss / removal ───
  const handleDismissed = useCallback((match: Match) => {
    setMatches((prev) => prev.filter((m) => m !== match));
  }, []);

  // ─── Filtered matches ───
  const moduleFiltered = tab === 'all' ? matches : matches.filter((m) => m.module === TAB_MODULE[tab]);
  const filteredMatches = mutualOnly ? moduleFiltered.filter((m) => m.is_mutual) : moduleFiltered;

  // ─── Stats ───
  const totalMatches = matches.length;
  const avgScore = totalMatches > 0
    ? Math.round(matches.reduce((sum, m) => sum + m.match_score, 0) / totalMatches)
    : 0;
  const mutualCount = useMemo(() => matches.filter((m) => m.is_mutual).length, [matches]);
  const moduleCounts = matches.reduce<Record<string, number>>((acc, m) => {
    acc[m.module] = (acc[m.module] || 0) + 1;
    return acc;
  }, {});

  // ─── Empty state variant ───
  const emptyVariant = meta.degraded_reason === 'no_coordinates'
    ? 'no_coordinates'
    : meta.degraded_reason === 'safeguarding_policy_unavailable'
      ? 'safeguarding_unavailable'
      : meta.has_active_listings === false && (tab === 'all' || tab === 'listings')
        ? 'no_listings'
        : 'none';

  // ─── Render ───
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <PageMeta title={t('page_meta.title')} noIndex />
      <Breadcrumbs items={[{ label: t('breadcrumb_dashboard'), href: '/dashboard' }, { label: t('breadcrumb_matches') }]} />

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20">
              <Sparkles className="w-6 h-6 text-accent" />
            </div>
            {t('heading')}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-theme-subtle">{t('subtitle')}</p>
            <AlgorithmLabel area="matching" />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            as={Link}
            to={tenantPath('/matches/preferences')}
            isIconOnly
            variant="flat"
            aria-label={t('preferences_link')}
            size="sm"
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            variant="flat"
            startContent={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
            onPress={() => loadMatches(true)}
            isLoading={refreshing}
            size="sm"
          >
            {t('refresh')}
          </Button>
        </div>
      </div>

      {/* Degraded (no coordinates) banner */}
      {meta.degraded_reason === 'no_coordinates' && (
        <Alert
          color="warning"
          icon={<MapPin className="w-5 h-5" aria-hidden="true" />}
          title={t('banner.no_coords_title')}
          description={t('banner.no_coords_desc')}
          endContent={
            <Button as={Link} to={tenantPath('/settings?tab=profile')} size="sm" className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
              {t('empty.set_location_cta')}
            </Button>
          }
        />
      )}

      {/* Safeguarding-degraded banner: the community's safeguarding setup is
          unfinished, so protected members' matches are hidden. Only shown when
          some matches still render — the empty state carries its own copy. */}
      {meta.degraded_reason === 'safeguarding_policy_unavailable' && filteredMatches.length > 0 && (
        <Alert
          color="warning"
          icon={<ShieldAlert className="w-5 h-5" aria-hidden="true" />}
          title={t('banner.safeguarding_unavailable_title')}
          description={t('banner.safeguarding_unavailable_desc')}
        />
      )}

      {/* Paused banner */}
      {meta.paused && (
        <Alert
          color="default"
          title={t('banner.paused_title')}
          description={t('banner.paused_desc')}
          endContent={
            <Button as={Link} to={tenantPath('/matches/preferences')} size="sm" variant="secondary" className="bg-theme-elevated text-theme-primary">
              {t('preferences_link')}
            </Button>
          }
        />
      )}

      {/* Mutual-only deep-link banner */}
      {showMutualBanner && (
        <Alert
          color="success"
          icon={<ArrowLeftRight className="w-5 h-5" aria-hidden="true" />}
          title={t('banner.mutual_title')}
          description={t('banner.mutual_desc')}
          endContent={
            <Button
              size="sm"
              variant="light"
              onPress={() => { setShowMutualBanner(false); setMutualOnly(false); }}
            >
              {t('banner.show_all')}
            </Button>
          }
        />
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard className="p-4 text-center">
          <Target className="w-5 h-5 text-accent mx-auto mb-1" aria-hidden="true" />
          <p className="text-2xl font-bold text-theme-primary">{totalMatches}</p>
          <p className="text-xs text-theme-subtle">{t('stats_total_matches')}</p>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <TrendingUp className="w-5 h-5 text-emerald-400 mx-auto mb-1" aria-hidden="true" />
          <p className="text-2xl font-bold text-theme-primary">{avgScore}%</p>
          <p className="text-xs text-theme-subtle">{t('stats_avg_score')}</p>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <Sparkles className="w-5 h-5 text-amber-400 mx-auto mb-1" aria-hidden="true" />
          <p className="text-2xl font-bold text-theme-primary">
            {matches.filter((m) => m.match_score >= 80).length}
          </p>
          <p className="text-xs text-theme-subtle">{t('stats_hot_matches')}</p>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <ArrowLeftRight className="w-5 h-5 text-accent mx-auto mb-1" aria-hidden="true" />
          <p className="text-2xl font-bold text-theme-primary">{mutualCount}</p>
          <p className="text-xs text-theme-subtle">{t('stats_mutual_matches')}</p>
        </GlassCard>
      </div>

      {/* Mutual-only toggle chip (shown once we know there are mutual matches) */}
      {mutualCount > 0 && (
        <div className="flex items-center gap-2">
          <Chip
            as="button"
            size="sm"
            variant={mutualOnly ? 'solid' : 'flat'}
            color={mutualOnly ? 'success' : 'default'}
            className="cursor-pointer"
            onClick={() => setMutualOnly((prev) => !prev)}
            startContent={<ArrowLeftRight className="w-3 h-3" aria-hidden="true" />}
          >
            {t('filter_mutual_only')}
          </Chip>
        </div>
      )}

      {/* Module filter tabs */}
      <Tabs
        aria-label={t('filter_tabs_aria')}
        selectedKey={tab}
        onSelectionChange={(key) => handleTabChange(key as TabFilter)}
        classNames={{
          tabList: 'bg-theme-elevated p-1 rounded-lg',
          cursor: 'bg-theme-hover',
          tab: 'text-theme-muted data-[selected=true]:text-theme-primary',
        }}
      >
        <Tab
          key="all"
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              {t('filter_all')} ({totalMatches})
            </span>
          }
        />
        {(Object.entries(TAB_CONFIG) as Array<[Exclude<TabFilter, 'all'>, typeof TAB_CONFIG[Exclude<TabFilter, 'all'>]]>).map(([key, config]) => {
          const Icon = config.icon;
          const count = moduleCounts[TAB_MODULE[key]] || 0;
          if (count === 0 && tab !== key) return null;
          return (
            <Tab
              key={key}
              title={
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {t(config.labelKey)} ({count})
                </span>
              }
            />
          );
        })}
      </Tabs>

      {/* Matches list — never show the empty state when the load failed */}
      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : loadError ? (
        <GlassCard role="alert" className="p-8 text-center">
          <Sparkles className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('load_error_title')}</h2>
          <p className="text-theme-muted mb-4">{t('load_failed')}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadMatches()}
          >
            {t('retry')}
          </Button>
        </GlassCard>
      ) : filteredMatches.length === 0 ? (
        <MatchesEmptyState variant={emptyVariant} />
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {filteredMatches.map((match, index) => (
              <MatchCard
                key={matchElementId(match)}
                match={match}
                index={index}
                highlightId={highlightId}
                onDismissed={handleDismissed}
              />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}

export default MatchesPage;
