// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback, useRef } from 'react';
import { CountUp } from '@/components/ui/CountUp';
import { motion } from '@/lib/motion';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { StatsContent } from '@/types';

interface PlatformStats {
  members: number;
  hours_exchanged: number;
  listings: number;
  communities: number;
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
        { value: <CountUp value={platformStats.communities} format={formatStatNumber} />, label: t('home.stats.communities') },
      ]
    : [
        { value: '\u2014', label: t('home.stats.active_members') },
        { value: '\u2014', label: t('home.stats.hours_exchanged') },
        { value: '\u2014', label: t('home.stats.active_listings') },
        { value: '\u2014', label: t('home.stats.communities') },
      ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="mt-16 sm:mt-24 grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-8"
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
  );
}
