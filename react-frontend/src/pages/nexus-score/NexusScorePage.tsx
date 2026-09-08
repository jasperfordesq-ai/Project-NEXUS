// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/Progress';
import { Spinner } from '@/components/ui/Spinner';
/**
 * NexusScore Page — personal reputation score breakdown with 6-category detail
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef } from 'react';
import { motion } from '@/lib/motion';import Trophy from 'lucide-react/icons/trophy';
import Users from 'lucide-react/icons/users';
import Star from 'lucide-react/icons/star';
import Clock from 'lucide-react/icons/clock';
import Medal from 'lucide-react/icons/medal';
import Heart from 'lucide-react/icons/heart';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import TrendingUp from 'lucide-react/icons/trending-up';
import Info from 'lucide-react/icons/info';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { CHART_COLOR_MAP } from '@/lib/chartColors';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ScoreCategory {
  key: string;
  label: string;
  score: number;
  max: number;
  percentage: number;
  details: Record<string, unknown>;
}

interface NexusScoreData {
  total_score: number;
  max_score: number;
  percentage: number;
  percentile: number;
  tier: {
    name: string;
    icon: string;
    color: string;
  };
  breakdown: ScoreCategory[];
  insights: (string | Record<string, string>)[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier config
// ─────────────────────────────────────────────────────────────────────────────

const TIERS = [
  // color: light-mode uses -600 (≥4.5:1 on white), dark-mode uses -400 (≥4.5:1 on dark bg)
  { name: 'Novice',        key: 'novice',       min: 0,   color: 'text-slate-600   dark:text-slate-400',   bar: 'bg-slate-400'   },
  { name: 'Beginner',      key: 'beginner',     min: 200, color: 'text-amber-600   dark:text-amber-400',   bar: 'bg-amber-400'   },
  { name: 'Developing',    key: 'developing',   min: 300, color: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-400' },
  { name: 'Intermediate',  key: 'intermediate', min: 400, color: 'text-cyan-600    dark:text-cyan-400',    bar: 'bg-cyan-400'    },
  { name: 'Proficient',    key: 'proficient',   min: 500, color: 'text-violet-600  dark:text-violet-400',  bar: 'bg-violet-400'  },
  { name: 'Advanced',      key: 'advanced',     min: 600, color: 'text-accent  dark:text-accent',  bar: 'bg-accent'  },
  { name: 'Expert',        key: 'expert',       min: 700, color: 'text-orange-600  dark:text-orange-400',  bar: 'bg-orange-400'  },
  { name: 'Elite',         key: 'elite',        min: 800, color: 'text-pink-600    dark:text-pink-400',    bar: 'bg-pink-400'    },
  { name: 'Legendary',     key: 'legendary',    min: 900, color: 'text-yellow-600  dark:text-yellow-400',  bar: 'bg-yellow-400'  },
] as const;

function getTierConfig(name: string) {
  return TIERS.find(t => t.name === name) ?? TIERS[0];
}

function getTierLabel(t: TFunction<'gamification'>, name: string) {
  const tier = getTierConfig(name);
  return t(`nexus_score.tiers.${tier.key}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Category icon map
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  engagement: <Users className="w-5 h-5" aria-hidden="true" />,
  quality:    <Star className="w-5 h-5" aria-hidden="true" />,
  volunteer:  <Clock className="w-5 h-5" aria-hidden="true" />,
  activity:   <TrendingUp className="w-5 h-5" aria-hidden="true" />,
  badges:     <Medal className="w-5 h-5" aria-hidden="true" />,
  impact:     <Heart className="w-5 h-5" aria-hidden="true" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  engagement: 'text-[var(--color-info)]',
  quality:    'text-yellow-500',
  volunteer:  'text-emerald-500',
  activity:   'text-violet-500',
  badges:     'text-orange-500',
  impact:     'text-rose-500',
};

// ─────────────────────────────────────────────────────────────────────────────
// Animation variants
// ─────────────────────────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tier ladder component
// ─────────────────────────────────────────────────────────────────────────────

function TierLadder({
  currentTier,
  score,
  t,
}: {
  currentTier: string;
  score: number;
  t: TFunction<'gamification'>;
}) {
  return (
    <div className="flex items-end justify-between gap-1 px-1">
      {TIERS.map((tier) => {
        const isActive  = tier.name === currentTier;
        const isPassed  = score >= tier.min;
        const nextTier  = TIERS[TIERS.indexOf(tier) + 1];
        const isCurrent = isPassed && (!nextTier || score < nextTier.min);
        const tierLabel = t(`nexus_score.tiers.${tier.key}`);
        return (
          <div key={tier.name} className="flex flex-col items-center gap-1 flex-1">
            <div
              className={[
                'w-full rounded-sm transition-all duration-300',
                isPassed ? tier.bar : 'bg-theme-elevated',
                isCurrent || isActive ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-transparent' : '',
              ].join(' ')}
              style={{ height: `${Math.max(8, (tier.min / 900) * 48 + 8)}px` }}
              aria-label={t('nexus_score.tier_threshold', { tier: tierLabel, min: tier.min })}
            />
            {isActive && (
              <span className={`text-[9px] font-bold leading-none ${tier.color}`}>
                {tierLabel}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function NexusScorePage() {
  const { t } = useTranslation('gamification');
  const { user }       = useAuth();
  const { tenantPath, hasModule } = useTenant();
  const toast = useToast();

  usePageTitle(t('nexus_score.title'));

  const [data, setData]         = useState<NexusScoreData | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Stable refs for t/toast to avoid re-fetching on language change
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // AbortController ref for stale request cancellation
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (force = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!force) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const url = force ? '/v2/gamification/nexus-score?force=true' : '/v2/gamification/nexus-score';
      const res = await api.get<NexusScoreData>(url);
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error ?? tRef.current('nexus_score.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('NexusScorePage.load', err);
      setError(tRef.current('nexus_score.load_error'));
      if (force) toastRef.current.error(tRef.current('nexus_score.refresh_error'));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div role="status" aria-label={t('nexus_score.loading')} className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" color="secondary" aria-hidden="true" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (error || !data) {
    return (
      <div role="alert" className="max-w-lg mx-auto px-4 py-16 text-center">
        <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" aria-hidden="true" />
        <p className="text-theme-subtle mb-6">{error}</p>
        <Button color="primary" onPress={() => load()}>
          {t('nexus_score.try_again')}
        </Button>
      </div>
    );
  }

  const tierConfig = getTierConfig(data.tier.name);
  const currentTierLabel = getTierLabel(t, data.tier.name);

  // Next tier threshold
  const currentTierIndex = TIERS.findIndex(tier => tier.name === data.tier.name);
  const nextTier = TIERS[currentTierIndex + 1];
  const pointsToNext = nextTier ? nextTier.min - data.total_score : 0;

  return (
    <motion.div
      className="max-w-3xl mx-auto px-4 py-8 space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <PageMeta
        title={t('page_meta.nexus_score.title')}
        description={t('page_meta.nexus_score.description')}
        noIndex
      />
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-2">
            <Trophy className="w-6 h-6 text-accent" aria-hidden="true" />
            {t('nexus_score.title')}
          </h1>
          <p className="text-sm text-theme-subtle mt-0.5">
            {t('nexus_score.subtitle')}
          </p>
        </div>
        <Button
          size="sm"
          variant="flat"
          color="default"
          isLoading={refreshing}
          onPress={() => load(true)}
          startContent={!refreshing && <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
        >
          {t('nexus_score.refresh')}
        </Button>
      </motion.div>

      {/* ── Score hero card ────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Score ring */}
            <div className="relative flex-shrink-0">
              <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90" aria-hidden="true">
                <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor"
                  className="text-theme-elevated" strokeWidth="10" />
                <circle cx="60" cy="60" r="52" fill="none"
                  stroke="url(#score-grad)" strokeWidth="10"
                  strokeDasharray={`${2 * Math.PI * 52}`}
                  strokeDashoffset={`${2 * Math.PI * 52 * (1 - data.percentage / 100)}`}
                  strokeLinecap="round" />
                <defs>
                  <linearGradient id="score-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={CHART_COLOR_MAP.primary} />
                    <stop offset="100%" stopColor={CHART_COLOR_MAP.primaryLight} />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-theme-primary leading-none">
                  {data.total_score}
                </span>
                <span className="text-xs text-theme-subtle">
                  {t('nexus_score.max_score_label', { max: data.max_score })}
                </span>
              </div>
            </div>

            {/* Tier + stats */}
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                {data.tier.icon && (
                  <span className="text-2xl leading-none">{data.tier.icon}</span>
                )}
                <span className={`text-xl font-bold ${tierConfig.color}`}>
                  {currentTierLabel}
                </span>
                <Chip size="sm" variant="flat" color="secondary" className="ml-1">
                  {t('nexus_score.top_percent', { percent: Math.round(100 - data.percentile) })}
                </Chip>
              </div>

              <p className="text-sm text-theme-subtle mb-4">
                {nextTier
                  ? t('nexus_score.points_to_next', {
                      count: pointsToNext,
                      tier: getTierLabel(t, nextTier.name),
                    })
                  : t('nexus_score.max_tier')}
              </p>

              {/* Tier ladder */}
              <TierLadder currentTier={data.tier.name} score={data.total_score} t={t} />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Category breakdown ─────────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <h2 className="text-base font-semibold text-theme-primary mb-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
          {t('nexus_score.breakdown_title')}
        </h2>
        <div className="space-y-3">
          {data.breakdown.map((cat) => (
            <motion.div key={cat.key} variants={itemVariants}>
              <GlassCard className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className={`${CATEGORY_COLORS[cat.key] ?? 'text-theme-subtle'} flex-shrink-0`}>
                    {CATEGORY_ICONS[cat.key]}
                  </span>
                  <span className="flex-1 text-sm font-medium text-theme-primary">
                    {cat.label}
                  </span>
                  <span className="text-sm font-semibold text-theme-primary tabular-nums">
                    {cat.score}
                    <span className="text-theme-subtle font-normal text-xs ml-0.5">
                      /{cat.max}
                    </span>
                  </span>
                </div>
                <Progress
                  value={cat.percentage}
                  size="sm"
                  color="secondary"
                  className="w-full"
                  aria-label={t('nexus_score.category_progress_aria', {
                    category: cat.label,
                    score: cat.score,
                    max: cat.max,
                  })}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-theme-subtle">{cat.percentage}%</span>
                  {cat.percentage < 100 && (
                    <span className="text-xs text-theme-subtle">
                      {t('nexus_score.remaining_count', { count: cat.max - cat.score })}
                    </span>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── Insights ───────────────────────────────────────────────────────── */}
      {Array.isArray(data.insights) && data.insights.length > 0 && (
        <motion.div variants={itemVariants}>
          <GlassCard className="p-5">
            <h2 className="text-base font-semibold text-theme-primary mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent" aria-hidden="true" />
              {t('nexus_score.insights_title')}
            </h2>
            <ul className="space-y-2">
              {data.insights.map((insight, i) => {
                const text = typeof insight === 'string' ? insight : (insight as Record<string, string>).message ?? (insight as Record<string, string>).title ?? '';
                return (
                  <li key={i} className="flex items-start gap-2 text-sm text-theme-subtle">
                    <span className="text-accent font-bold mt-0.5" aria-hidden="true">-</span>
                    {text}
                  </li>
                );
              })}
            </ul>
          </GlassCard>
        </motion.div>
      )}

      {/* ── Footer links ───────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="flex flex-wrap gap-3 justify-center pt-2">
        <Button
          as={Link}
          to={tenantPath('/leaderboard?type=nexus_score')}
          variant="flat"
          color="secondary"
          size="sm"
          startContent={<Trophy className="w-4 h-4" aria-hidden="true" />}
        >
          {t('nexus_score.view_leaderboard')}
        </Button>
        {hasModule('profile') && <Button
          as={Link}
          to={tenantPath(`/profile/${user?.id}`)}
          variant="flat"
          color="default"
          size="sm"
        >
          {t('nexus_score.my_profile')}
        </Button>}
      </motion.div>
    </motion.div>
  );
}
