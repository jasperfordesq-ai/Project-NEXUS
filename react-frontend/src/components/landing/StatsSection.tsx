// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback, useRef } from 'react';
import { CountUp } from '@/components/ui/CountUp';
import { Progress } from '@/components/ui/Progress';
import { getFormattingLocale } from '@/lib/helpers';
import { motion } from '@/lib/motion';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { StatsContent } from '@/types';

/** The community's running shared goal (warmth phase 6, D1): a community total, never one member's. */
interface PublicCommunityGoal {
  title: string;
  metric: 'hours' | 'exchanges' | 'offers' | 'events';
  target: number;
  current: number;
}

interface PlatformStats {
  members: number;
  hours_exchanged: number;
  listings: number;
  communities: number;
  community_goal?: PublicCommunityGoal | null;
}

const GOAL_METRICS: readonly PublicCommunityGoal['metric'][] = ['hours', 'exchanges', 'offers', 'events'];

/**
 * A small progress line for the community's shared goal, under the figures:
 * its name, a bar and "212 of 500 hours shared". Nothing without a goal.
 */
function CommunityGoalLine({ goal }: { goal: PublicCommunityGoal }) {
  const { t } = useTranslation('public');
  const locale = getFormattingLocale();
  const percent = Math.round(Math.min(100, Math.max(0, (goal.current / goal.target) * 100)) * 10) / 10;
  const values = {
    count: goal.target,
    current: goal.current.toLocaleString(locale),
    target: goal.target.toLocaleString(locale),
  };
  const line =
    goal.metric === 'exchanges' ? t('home.stats.goal_exchanges', values)
      : goal.metric === 'offers' ? t('home.stats.goal_offers', values)
        : goal.metric === 'events' ? t('home.stats.goal_events', values)
          : t('home.stats.goal_hours', values);

  return (
    <div data-testid="landing-community-goal" className="mx-auto mt-10 max-w-xl px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-theme-subtle">{t('home.stats.goal_label')}</p>
      <p className="mt-1 break-words text-base font-semibold text-theme-primary">{goal.title}</p>
      <Progress aria-label={t('home.stats.goal_label')} value={percent} size="sm" className="mt-3 w-full" />
      <p className="mt-2 text-sm text-theme-subtle">{line}</p>
    </div>
  );
}

/** Format a number with K/M suffix for display */
export function formatStatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M+';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K+';
  }
  return num.toString();
}

interface StatsSectionProps {
  content?: StatsContent;
}

export function StatsSection({ content }: StatsSectionProps) {
  const { t } = useTranslation('public');
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const hidden = content?.show_live_stats === false;

  const loadStats = useCallback(async () => {
    if (hidden) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.get<PlatformStats>('/v2/platform/stats');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setPlatformStats(response.data);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load platform stats', error);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [hidden]);

  useEffect(() => {
    loadStats();
    return () => abortRef.current?.abort();
  }, [loadStats]);

  // If show_live_stats is explicitly false, don't render
  if (hidden) {
    return null;
  }

  const stats = platformStats
    ? [
        { value: <CountUp value={platformStats.members} format={formatStatNumber} />, label: t('home.stats.active_members') },
        { value: <CountUp value={platformStats.hours_exchanged} format={formatStatNumber} />, label: t('home.stats.hours_exchanged') },
        { value: <CountUp value={platformStats.listings} format={formatStatNumber} />, label: t('home.stats.active_listings') },
        // A count of one says nothing on a community's own page (it read "1 Communities").
        ...(platformStats.communities > 1
          ? [{ value: <CountUp value={platformStats.communities} format={formatStatNumber} />, label: t('home.stats.communities') }]
          : []),
      ]
    : [
        { value: '\u2014', label: t('home.stats.active_members') },
        { value: '\u2014', label: t('home.stats.hours_exchanged') },
        { value: '\u2014', label: t('home.stats.active_listings') },
        { value: '\u2014', label: t('home.stats.communities') },
      ];

  const goal = platformStats?.community_goal;
  const showGoal = !!goal && GOAL_METRICS.includes(goal.metric) && goal.target > 0 && typeof goal.title === 'string';

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className={`mt-16 sm:mt-24 grid grid-cols-2 gap-4 sm:gap-8 ${stats.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}
      role={isLoading ? 'status' : undefined}
      aria-busy={isLoading}
      aria-label={isLoading ? t('loading', { ns: 'common' }) : undefined}
    >
      {stats.map((stat, index) => (
        <div key={stat.label} className="text-center">
          <motion.p
            initial={{ opacity: 0, scale: 0.5 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.1 }}
            className={`text-3xl sm:text-4xl font-bold text-gradient${isLoading ? ' animate-pulse' : ''}`}
          >
            {stat.value}
          </motion.p>
          <p className="mt-1 text-sm text-theme-subtle">{stat.label}</p>
        </div>
      ))}
    </motion.div>
    {showGoal && goal && <CommunityGoalLine goal={goal} />}
    </>
  );
}
