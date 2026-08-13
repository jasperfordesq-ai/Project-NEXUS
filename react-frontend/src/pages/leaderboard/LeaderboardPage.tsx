// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Select, SelectItem } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, Tab } from '@/components/ui/Tabs';
/**
 * Leaderboard Page — Community dashboard with 4 tabs.
 *
 * Redesigned to lead with community impact rather than competitive rankings:
 *   1. Community Impact (default) — aggregate stats, trends
 *   2. My Journey — personal growth timeline
 *   3. Member Spotlight — daily rotating featured members
 *   4. Most Active — traditional competitive leaderboard (optional)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, type Variants } from '@/lib/motion';

import Trophy from 'lucide-react/icons/trophy';
import Medal from 'lucide-react/icons/medal';
import Crown from 'lucide-react/icons/crown';
import TrendingUp from 'lucide-react/icons/trending-up';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Star from 'lucide-react/icons/star';
import Clock from 'lucide-react/icons/clock';
import Coins from 'lucide-react/icons/coins';
import Zap from 'lucide-react/icons/zap';
import Calendar from 'lucide-react/icons/calendar';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Flame from 'lucide-react/icons/flame';
import Users from 'lucide-react/icons/users';
import Route from 'lucide-react/icons/route';
import Sparkles from 'lucide-react/icons/sparkles';
import BarChart3 from 'lucide-react/icons/chart-column';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import CommunityImpactTab from './CommunityImpactTab';
import PersonalJourneyTab from './PersonalJourneyTab';
import MemberSpotlightTab from './MemberSpotlightTab';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type LeaderboardPeriod = 'all' | 'season' | 'month' | 'week';
type LeaderboardType = 'xp' | 'volunteer_hours' | 'credits_earned' | 'nexus_score';

interface LeaderboardEntry {
  position: number;
  user: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
  xp: number;
  score: number;
  level: number;
  is_current_user: boolean;
}

interface LeaderboardMeta {
  period: string;
  type: string;
  your_position: number | null;
  total_entries: number;
  has_more?: boolean;
}

/**
 * Raw season row from GET /v2/gamification/seasons.
 * Backend returns DB rows: status='active'|'completed', rewards as JSON string,
 * no `description` or `is_active` fields.
 */
interface SeasonRow {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  rewards: string | Record<string, unknown> | null;
}

/**
 * GET /v2/gamification/seasons/current returns:
 * { season: {...}, user_rank, user_data, leaderboard, rewards, days_remaining,
 *   is_ending_soon, total_participants }
 */
interface CurrentSeasonResponse {
  season: {
    id: number;
    name: string;
    start_date: string;
    end_date: string;
    status: string;
    rewards: string | Record<string, unknown> | null;
  } | null;
  user_rank: Record<string, unknown> | null;
  user_data: {
    xp_earned: number;
    rank: number | null;
    position: number | null;
  } | null;
  leaderboard: unknown[];
  rewards: Record<string, unknown> | null;
  days_remaining: number;
  is_ending_soon: boolean;
  total_participants: number;
}

const typeIcons: Record<LeaderboardType, React.ReactNode> = {
  xp: <Zap className="w-4 h-4 text-theme-subtle" aria-hidden="true" />,
  volunteer_hours: <Clock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />,
  credits_earned: <Coins className="w-4 h-4 text-theme-subtle" aria-hidden="true" />,
  nexus_score: <Trophy className="w-4 h-4 text-accent" aria-hidden="true" />,
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
};

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Season Card Component
// ─────────────────────────────────────────────────────────────────────────────

function SeasonCard() {
  const { t } = useTranslation('gamification');
  const toast = useToast();
  const [season, setSeason] = useState<CurrentSeasonResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [seasonError, setSeasonError] = useState(false);
  const [showAllSeasons, setShowAllSeasons] = useState(false);
  const [allSeasons, setAllSeasons] = useState<SeasonRow[]>([]);
  const [loadingAllSeasons, setLoadingAllSeasons] = useState(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadCurrentSeason = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setSeasonError(false);
      const res = await api.get<CurrentSeasonResponse>('/v2/gamification/seasons/current');
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        setSeason(res.data);
      } else if (!res.success) {
        logError('Failed to load current season', res.error);
        setSeasonError(true);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load current season', err);
      setSeasonError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrentSeason();
  }, [loadCurrentSeason]);

  const loadAllSeasons = async () => {
    if (allSeasons.length > 0) {
      setShowAllSeasons(!showAllSeasons);
      return;
    }
    try {
      setLoadingAllSeasons(true);
      const res = await api.get<SeasonRow[]>('/v2/gamification/seasons');
      if (res.success && res.data) {
        setAllSeasons(Array.isArray(res.data) ? res.data : []);
      }
      setShowAllSeasons(true);
    } catch (err) {
      logError('Failed to load all seasons', err);
      toastRef.current.error(tRef.current('leaderboard.season.load_failed'), tRef.current('leaderboard.season.load_failed_desc'));
    } finally {
      setLoadingAllSeasons(false);
    }
  };

  if (isLoading) {
    return (
      <GlassCard role="status" className="p-5" aria-label={t('leaderboard.season.loading')} aria-busy="true">
        <div className="space-y-3">
          <Skeleton className="rounded-lg">
            <div className="h-5 rounded-lg bg-surface-tertiary w-1/3" />
          </Skeleton>
          <Skeleton className="rounded-lg">
            <div className="h-3 rounded-lg bg-surface-secondary w-2/3" />
          </Skeleton>
          <Skeleton className="rounded-lg">
            <div className="h-2 rounded-lg bg-surface-secondary w-full" />
          </Skeleton>
          <Skeleton className="rounded-lg">
            <div className="h-3 rounded-lg bg-surface-secondary w-1/4" />
          </Skeleton>
        </div>
      </GlassCard>
    );
  }

  if (seasonError) {
    return (
      <GlassCard className="p-5">
        <div className="flex items-center gap-3 text-[var(--color-warning)]">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-theme-primary">{t('leaderboard.season.unavailable')}</p>
            <p className="text-xs text-theme-muted mt-0.5">{t('leaderboard.season.unavailable_desc')}</p>
          </div>
          <Button size="sm" variant="light" onPress={loadCurrentSeason}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </GlassCard>
    );
  }

  // Backend returns { season: null } when no season exists
  if (!season || !season.season) return null;

  const seasonInfo = season.season;
  const userData = season.user_data;

  // Parse rewards: backend stores as JSON string in the DB, but the controller
  // returns the parsed object in `season.rewards` (top-level, already decoded).
  // Shape: { 1: {xp,badge,title}, 2: {...}, 'top10': {...}, ... }
  const rewardMap = season.rewards ?? {};
  const rewardEntries = Object.entries(rewardMap).filter(
    ([, v]) => v && typeof v === 'object'
  );

  // Derive user position: backend sends rank or position
  const userPosition = userData?.position ?? userData?.rank;

  return (
    <div className="space-y-3">
      <GlassCard className="p-5 border-l-4 border-accent">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
              <Flame className="w-5 h-5 text-accent" aria-hidden="true" />
              {seasonInfo.name}
            </h3>
          </div>
          <Chip size="sm" color="secondary" variant="flat" className="flex-shrink-0">
            <Calendar className="w-3 h-3" aria-hidden="true" />
            {t('leaderboard.season.days_left', { days: season.days_remaining })}
          </Chip>
        </div>

        {/* Season date range */}
        <p className="text-xs text-theme-subtle mb-3">
          {new Date(seasonInfo.start_date).toLocaleDateString(getFormattingLocale())} &mdash; {new Date(seasonInfo.end_date).toLocaleDateString(getFormattingLocale())}
          {' '}&middot; {t('leaderboard.season.participants', { count: season.total_participants })}
        </p>

        {/* User's season progress */}
        {userData && (
          <div className="bg-theme-hover/50 rounded-lg p-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-theme-primary">{t('leaderboard.season.your_progress')}</span>
              <div className="flex items-center gap-2">
                {userPosition && (
                  <span className="text-sm font-bold text-accent dark:text-accent">#{userPosition}</span>
                )}
              </div>
            </div>
            <p className="text-xs text-theme-subtle mt-1">
              {t('leaderboard.season.xp_earned', { xp: (userData.xp_earned ?? 0).toLocaleString(getFormattingLocale()) })}
            </p>
          </div>
        )}

        {/* Reward tiers */}
        {rewardEntries.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-theme-muted mb-1">{t('leaderboard.season.rewards')}</p>
            <div className="flex flex-wrap gap-2">
              {rewardEntries.map(([key, value]) => {
                const reward = value as Record<string, unknown>;
                const label = (reward.title as string) ?? t('leaderboard.season.rank_label', { rank: key });
                const xp = reward.xp ? t('leaderboard.season.xp_reward', { xp: reward.xp }) : '';
                return (
                  <Chip key={key} size="sm" variant="flat">
                    {label}{xp ? ` — ${xp}` : ''}
                  </Chip>
                );
              })}
            </div>
          </div>
        )}

        {/* All seasons toggle */}
        <div className="mt-3 pt-3 border-t border-white/5">
          <Button
            variant="light"
            size="sm"
            className="text-accent dark:text-accent"
            endContent={
              <ChevronRight
                className={`w-4 h-4 transition-transform ${showAllSeasons ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
            }
            onPress={loadAllSeasons}
            isLoading={loadingAllSeasons}
          >
            {showAllSeasons ? t('leaderboard.season.hide_history') : t('leaderboard.season.all_seasons')}
          </Button>
        </div>
      </GlassCard>

      {/* All Seasons History */}
      {showAllSeasons && allSeasons.length > 0 && (
        <GlassCard className="p-4">
          <h4 className="font-semibold text-theme-primary mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
            {t('leaderboard.season.history')}
          </h4>
          <div className="space-y-2">
            {allSeasons.map((s) => {
              const isActive = s.status === 'active';
              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between p-2 rounded-lg ${
                    isActive ? 'bg-accent/10 border border-accent/30' : 'bg-theme-hover/30'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isActive ? (
                      <Flame className="w-4 h-4 text-accent flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <Calendar className="w-4 h-4 text-theme-subtle flex-shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-theme-primary truncate">
                        {s.name}
                        {isActive && (
                          <Chip size="sm" color="secondary" variant="flat" className="ml-2">{t('leaderboard.season.active')}</Chip>
                        )}
                      </p>
                      <p className="text-xs text-theme-subtle">
                        {new Date(s.start_date).toLocaleDateString(getFormattingLocale())} - {new Date(s.end_date).toLocaleDateString(getFormattingLocale())}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Leaderboard Page
// ─────────────────────────────────────────────────────────────────────────────

const LEADERBOARD_PAGE_SIZE = 50;

const getRankIcon = (position: number) => {
  if (position === 1) return <Crown className="w-5 h-5 text-yellow-400" aria-hidden="true" />;
  if (position === 2) return <Medal className="w-5 h-5 text-gray-300" aria-hidden="true" />;
  if (position === 3) return <Medal className="w-5 h-5 text-amber-600" aria-hidden="true" />;
  return <span className="text-theme-subtle font-mono text-sm w-5 text-center">{position}</span>;
};

export function LeaderboardPage() {
  const { t } = useTranslation('gamification');
  usePageTitle(t('leaderboard.page_title'));
  const { tenantPath } = useTenant();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [meta, setMeta] = useState<LeaderboardMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const [type, setType] = useState<LeaderboardType>('xp');

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t
  const tRef = useRef(t);
  tRef.current = t;

  const loadLeaderboard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set('period', period);
      params.set('type', type);
      params.set('limit', String(LEADERBOARD_PAGE_SIZE));

      const response = await api.get<LeaderboardEntry[]>(
        `/v2/gamification/leaderboard?${params}`
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setEntries(Array.isArray(response.data) ? response.data : []);
        const responseMeta = (response.meta as unknown as LeaderboardMeta) ?? null;
        setMeta(responseMeta);
        setHasMore(responseMeta?.has_more ?? false);
      } else {
        setError(response.code === 'SESSION_EXPIRED'
          ? tRef.current('leaderboard.session_expired')
          : tRef.current('leaderboard.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load leaderboard', err);
      setError(tRef.current('leaderboard.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [period, type]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    try {
      setIsLoadingMore(true);

      const params = new URLSearchParams();
      params.set('period', period);
      params.set('type', type);
      params.set('limit', String(LEADERBOARD_PAGE_SIZE));
      params.set('offset', String(entries.length));

      const response = await api.get<LeaderboardEntry[]>(
        `/v2/gamification/leaderboard?${params}`
      );

      if (response.success && response.data) {
        const newEntries = Array.isArray(response.data) ? response.data : [];
        setEntries((prev) => [...prev, ...newEntries]);
        const responseMeta = (response.meta as unknown as LeaderboardMeta) ?? null;
        setMeta(responseMeta);
        setHasMore(responseMeta?.has_more ?? false);
      }
    } catch (err) {
      logError('Failed to load more leaderboard entries', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, period, type, entries.length]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  /**
   * Format a score value based on the current leaderboard type
   */
  const formatScore = (entry: LeaderboardEntry) => {
    // Use `score` if available, fallback to `xp` for backwards compat. Coerce to 0
    // defensively: a degraded entry (both score and xp missing/null — e.g. a partial
    // backend response) would otherwise make `value.toLocaleString()` throw and blank
    // the entire Leaderboard page via the error boundary.
    const value = entry.score ?? entry.xp ?? 0;

    switch (type) {
      case 'volunteer_hours':
        return (
          <>
            <span className="font-bold text-theme-primary">{value.toLocaleString(getFormattingLocale())}</span>
            <span className="text-xs text-theme-subtle ml-1">{t('leaderboard.score_unit.hours')}</span>
          </>
        );
      case 'credits_earned':
        return (
          <>
            <span className="font-bold text-theme-primary">{value.toLocaleString(getFormattingLocale())}</span>
            <span className="text-xs text-theme-subtle ml-1">{t('leaderboard.score_unit.credits')}</span>
          </>
        );
      case 'nexus_score':
        return (
          <>
            <span className="font-bold text-accent dark:text-accent">{value.toLocaleString(getFormattingLocale())}</span>
            <span className="text-xs text-theme-subtle ml-1">{t('leaderboard.score_unit.nexus_score')}</span>
          </>
        );
      case 'xp':
      default:
        return (
          <>
            <span className="font-bold text-theme-primary">{value.toLocaleString(getFormattingLocale())}</span>
            <span className="text-xs text-theme-subtle ml-1">{t('leaderboard.score_unit.xp')}</span>
          </>
        );
    }
  };

  const typeLabels: Record<LeaderboardType, string> = {
    xp: t('leaderboard.type.xp'),
    volunteer_hours: t('leaderboard.type.volunteer_hours'),
    credits_earned: t('leaderboard.type.credits_earned'),
    nexus_score: t('leaderboard.type.nexus_score'),
  };

  const periodLabels: Record<LeaderboardPeriod, string> = {
    all: t('leaderboard.period.all'),
    season: t('leaderboard.period.season'),
    month: t('leaderboard.period.month'),
    week: t('leaderboard.period.week'),
  };

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_meta.leaderboard.title')} description={t('page_meta.leaderboard.description')} />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
          <Users className="w-7 h-7 text-amber-400" aria-hidden="true" />
          {t('leaderboard.title')}
        </h1>
        <p className="text-theme-muted mt-1">
          {t('leaderboard.subtitle_redesign')}
        </p>
      </div>

      {/* Tab navigation */}
      <Tabs
        aria-label={t('leaderboard.tabs_aria')}
        color="primary"
        variant="underlined"
        classNames={{ tabList: 'gap-4' }}
        defaultSelectedKey="competitive"
      >
        <Tab
          key="competitive"
          title={
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4" aria-hidden="true" />
              <span>{t('leaderboard.tab.competitive')}</span>
            </div>
          }
        >
          <div className="pt-4">
            <CompetitiveLeaderboard
              entries={entries}
              meta={meta}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              hasMore={hasMore}
              error={error}
              period={period}
              type={type}
              setPeriod={setPeriod}
              setType={setType}
              tenantPath={tenantPath}
              t={t}
              getRankIcon={getRankIcon}
              formatScore={formatScore}
              typeLabels={typeLabels}
              typeIcons={typeIcons}
              periodLabels={periodLabels}
              containerVariants={containerVariants}
              itemVariants={itemVariants}
              loadLeaderboard={loadLeaderboard}
              loadMore={loadMore}
            />
          </div>
        </Tab>

        <Tab
          key="community"
          title={
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
              <span>{t('leaderboard.tab.community')}</span>
            </div>
          }
        >
          <div className="pt-4">
            <CommunityImpactTab />
          </div>
        </Tab>

        <Tab
          key="journey"
          title={
            <div className="flex items-center gap-2">
              <Route className="w-4 h-4" aria-hidden="true" />
              <span>{t('leaderboard.tab.journey')}</span>
            </div>
          }
        >
          <div className="pt-4">
            <PersonalJourneyTab />
          </div>
        </Tab>

        <Tab
          key="spotlight"
          title={
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span>{t('leaderboard.tab.spotlight')}</span>
            </div>
          }
        >
          <div className="pt-4">
            <MemberSpotlightTab />
          </div>
        </Tab>
      </Tabs>
    </div>
  );
}

interface CompetitiveLeaderboardProps {
  entries: LeaderboardEntry[];
  meta: LeaderboardMeta | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  period: LeaderboardPeriod;
  type: LeaderboardType;
  setPeriod: (period: LeaderboardPeriod) => void;
  setType: (type: LeaderboardType) => void;
  tenantPath: (path: string) => string;
  t: TFunction;
  getRankIcon: (position: number) => React.ReactNode;
  formatScore: (entry: LeaderboardEntry) => React.ReactNode;
  typeLabels: Record<LeaderboardType, string>;
  typeIcons: Record<LeaderboardType, React.ReactNode>;
  periodLabels: Record<LeaderboardPeriod, string>;
  containerVariants: Variants;
  itemVariants: Variants;
  loadLeaderboard: () => void;
  loadMore: () => void;
}

/**
 * CompetitiveLeaderboard — the original ranking view, now wrapped as a tab.
 */
function CompetitiveLeaderboard(props: CompetitiveLeaderboardProps) {
  const {
    entries,
    meta,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    period,
    type,
    setPeriod,
    setType,
    tenantPath,
    t,
    getRankIcon,
    formatScore,
    typeLabels,
    typeIcons,
    periodLabels,
    containerVariants,
    itemVariants,
    loadLeaderboard,
    loadMore,
  } = props;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
          {/* Type Selector */}
          <Select
            placeholder={t('leaderboard.type_placeholder')}
            aria-label={t('leaderboard.type_aria')}
            selectedKeys={[type]}
            onChange={(e) => setType((e.target.value as LeaderboardType) || 'xp')}
            className="w-full sm:w-48"
            disallowEmptySelection
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              value: 'text-theme-primary',
            }}
            startContent={typeIcons[type]}
          >
            <SelectItem key="xp" id="xp">{t('leaderboard.type.xp')}</SelectItem>
            <SelectItem key="volunteer_hours" id="volunteer_hours">{t('leaderboard.type.volunteer_hours')}</SelectItem>
            <SelectItem key="credits_earned" id="credits_earned">{t('leaderboard.type.credits_earned')}</SelectItem>
            <SelectItem key="nexus_score" id="nexus_score">{t('leaderboard.type.nexus_score')}</SelectItem>
          </Select>

          {/* Period Selector */}
          <Select
            placeholder={t('leaderboard.period_placeholder')}
            aria-label={t('leaderboard.period_aria')}
            selectedKeys={[period]}
            onChange={(e) => setPeriod(e.target.value as LeaderboardPeriod)}
            className="w-full sm:w-44"
            disallowEmptySelection
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              value: 'text-theme-primary',
            }}
            startContent={<TrendingUp className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
          >
            <SelectItem key="all" id="all">{t('leaderboard.period.all')}</SelectItem>
            <SelectItem key="season" id="season">{t('leaderboard.period.season')}</SelectItem>
            <SelectItem key="month" id="month">{t('leaderboard.period.month')}</SelectItem>
            <SelectItem key="week" id="week">{t('leaderboard.period.week')}</SelectItem>
          </Select>
        </div>

      {/* Season Section */}
      <SeasonCard />

      {/* Your Position Banner — prefer the entry-based position from the visible
          list over the meta fallback, which can disagree if the backend's fallback
          rank query uses different filters. */}
      {(() => {
        const myEntry = entries.find((e: LeaderboardEntry) => e.is_current_user);
        const displayPosition = myEntry?.position ?? meta?.your_position;
        const displayTotal = meta?.total_entries ?? entries.length;
        if (!displayPosition) return null;
        return (
          <GlassCard className="p-4 border-l-4 border-accent">
            <div className="flex items-center gap-3">
              <Star className="w-5 h-5 text-accent" aria-hidden="true" />
              <span className="text-theme-primary font-medium">
                {t('leaderboard.your_rank', {
                  position: displayPosition,
                  total: Math.max(displayTotal, displayPosition),
                })}
                {' '}({periodLabels[period]} &middot; {typeLabels[type]})
              </span>
            </div>
          </GlassCard>
        );
      })()}

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('leaderboard.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            color="primary"
            aria-label={t('leaderboard.retry')}
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadLeaderboard}
          >
            {t('leaderboard.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Leaderboard Table */}
      {!error && (
        <>
          {isLoading ? (
            <GlassCard role="status" className="divide-y divide-white/5" aria-label={t('leaderboard.loading')} aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4">
                  <Skeleton className="rounded-full flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-surface-tertiary" />
                  </Skeleton>
                  <Skeleton className="rounded-full flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-surface-tertiary" />
                  </Skeleton>
                  <div className="flex-1 space-y-2">
                    <Skeleton className="rounded-lg">
                      <div className="h-4 rounded-lg bg-surface-tertiary w-1/3" />
                    </Skeleton>
                    <Skeleton className="rounded-lg">
                      <div className="h-3 rounded-lg bg-surface-secondary w-1/5" />
                    </Skeleton>
                  </div>
                  <Skeleton className="rounded-lg">
                    <div className="h-5 rounded-lg bg-surface-tertiary w-16" />
                  </Skeleton>
                </div>
              ))}
            </GlassCard>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={<Trophy className="w-12 h-12" aria-hidden="true" />}
              title={t('leaderboard.empty_title')}
              description={t('leaderboard.empty_description', { type: typeLabels[type] })}
            />
          ) : (
            <>
              <GlassCard className="overflow-hidden">
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="divide-y divide-white/5"
                >
                  {entries.map((entry: LeaderboardEntry) => (
                    <motion.div key={entry.position} variants={itemVariants}>
                      <Link
                        to={tenantPath(`/profile/${entry.user.id}`)}
                        className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-theme-hover transition-colors ${
                          entry.is_current_user ? 'bg-accent/10 border-l-2 border-accent' : ''
                        } ${entry.position <= 3 ? 'bg-gradient-to-r from-amber-500/5 to-transparent' : ''}`}
                      >
                        {/* Rank */}
                        <div className="w-8 flex justify-center flex-shrink-0">
                          {getRankIcon(entry.position)}
                        </div>

                        {/* Avatar */}
                        <Avatar
                          name={entry.user.name}
                          src={resolveAvatarUrl(entry.user.avatar_url)}
                          size="sm"
                          showFallback
                          className={entry.position <= 3 ? 'ring-2 ring-amber-400/50' : ''}
                        />

                        {/* Name & Level */}
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate ${entry.is_current_user ? 'text-accent dark:text-accent' : 'text-theme-primary'}`}>
                            {entry.user.name}
                            {entry.is_current_user && <span className="text-xs ml-2 text-accent dark:text-accent">{t('leaderboard.you')}</span>}
                          </p>
                          <p className="text-xs text-theme-subtle">{t('leaderboard.level', { level: entry.level })}</p>
                        </div>

                        {/* Score */}
                        <div className="text-right flex-shrink-0">
                          {formatScore(entry)}
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </motion.div>
              </GlassCard>

              {/* Load More button */}
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="flat"
                    className="bg-theme-elevated text-theme-primary"
                    onPress={loadMore}
                    isLoading={isLoadingMore}
                    startContent={!isLoadingMore ? <TrendingUp className="w-4 h-4" aria-hidden="true" /> : undefined}
                  >
                    {t('leaderboard.load_more')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default LeaderboardPage;
