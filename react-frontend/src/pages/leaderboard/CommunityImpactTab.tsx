// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { useState, useEffect } from 'react';
import { motion } from '@/lib/motion';

import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import Award from 'lucide-react/icons/award';
import TrendingUp from 'lucide-react/icons/trending-up';
import TrendingDown from 'lucide-react/icons/trending-down';
import UserPlus from 'lucide-react/icons/user-plus';
import FileText from 'lucide-react/icons/file-text';
import Handshake from 'lucide-react/icons/handshake';
import Zap from 'lucide-react/icons/zap';
import Heart from 'lucide-react/icons/heart';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface MonthStats {
  new_members: number;
  badges_awarded: number;
  new_listings: number;
  new_connections: number;
  volunteer_hours: number;
  new_posts: number;
}

interface CommunityImpactData {
  total_members: number;
  total_xp: number;
  total_badges_awarded: number;
  total_volunteer_hours: number;
  total_listings: number;
  total_connections: number;
  total_exchanges: number;
  total_reviews: number;
  this_month: MonthStats;
  last_month: MonthStats;
  trends: Record<string, number>;
}

export default function CommunityImpactTab() {
  const { t } = useTranslation('gamification');
  const [data, setData] = useState<CommunityImpactData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const res = await api.get<CommunityImpactData>('/v2/gamification/community-dashboard');
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setError(res.error || t('community.load_error'));
        }
      } catch (err: unknown) {
        logError('CommunityImpactTab', err);
        setError(t('community.load_error'));
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [t]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <GlassCard key={i} className="p-4">
              <Skeleton className="h-4 w-20 mb-2 rounded" />
              <Skeleton className="h-8 w-16 rounded" />
            </GlassCard>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-6 text-center">
        <p className="text-danger-soft-foreground">{error}</p>
      </GlassCard>
    );
  }

  if (!data) return null;

  // Backend catch-fallbacks can return a degraded 200 where top-level numbers are
  // missing and this_month/last_month/trends come back as [] instead of objects.
  // Coerce to safe shapes so a degraded response renders zeros rather than throwing
  // on data.total_xp.toLocaleString() — which crashed the whole Leaderboard via the
  // error boundary.
  const num = (v: number | undefined | null) => v ?? 0;
  const thisMonth: Partial<MonthStats> =
    data.this_month && !Array.isArray(data.this_month) ? data.this_month : {};
  const trends: Record<string, number> =
    data.trends && !Array.isArray(data.trends) ? data.trends : {};

  const stats = [
    { label: t('community.total_members'), value: num(data.total_members), icon: <Users className="w-5 h-5" />, color: 'text-[var(--color-info)]', bg: 'bg-blue-500/10' },
    { label: t('community.total_badges'), value: num(data.total_badges_awarded), icon: <Award className="w-5 h-5" />, color: 'text-[var(--color-warning)]', bg: 'bg-amber-500/10' },
    { label: t('community.volunteer_hours'), value: num(data.total_volunteer_hours), icon: <Clock className="w-5 h-5" />, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: t('community.total_xp'), value: num(data.total_xp).toLocaleString(getFormattingLocale()), icon: <Zap className="w-5 h-5" />, color: 'text-accent', bg: 'bg-accent/10' },
  ];

  const secondaryStats = [
    { label: t('community.total_listings'), value: num(data.total_listings), icon: <FileText className="w-4 h-4" /> },
    { label: t('community.total_connections'), value: num(data.total_connections), icon: <Handshake className="w-4 h-4" /> },
    { label: t('community.total_reviews'), value: num(data.total_reviews), icon: <Heart className="w-4 h-4" /> },
  ];

  const monthMetrics = [
    { label: t('community.new_members'), value: num(thisMonth.new_members), trend: trends.new_members ?? 0, icon: <UserPlus className="w-4 h-4" /> },
    { label: t('community.badges_awarded'), value: num(thisMonth.badges_awarded), trend: trends.badges_awarded ?? 0, icon: <Award className="w-4 h-4" /> },
    { label: t('community.new_listings'), value: num(thisMonth.new_listings), trend: trends.new_listings ?? 0, icon: <FileText className="w-4 h-4" /> },
    { label: t('community.new_connections'), value: num(thisMonth.new_connections), trend: trends.new_connections ?? 0, icon: <Handshake className="w-4 h-4" /> },
    { label: t('community.volunteer_hours'), value: num(thisMonth.volunteer_hours), trend: trends.volunteer_hours ?? 0, icon: <Clock className="w-4 h-4" /> },
    { label: t('community.new_posts'), value: num(thisMonth.new_posts), trend: trends.new_posts ?? 0, icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Primary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${stat.bg} ${stat.color}`}>{stat.icon}</div>
                <span className="text-xs text-muted">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold">{typeof stat.value === 'number' ? stat.value.toLocaleString(getFormattingLocale()) : stat.value}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-3 gap-4">
        {secondaryStats.map((stat) => (
          <GlassCard key={stat.label} className="p-3 flex items-center gap-3">
            <span className="text-muted">{stat.icon}</span>
            <div>
              <p className="text-lg font-semibold">{stat.value}</p>
              <p className="text-xs text-muted">{stat.label}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* This month breakdown */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4">{t('community.this_month')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {monthMetrics.map((metric) => (
            <div key={metric.label} className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary/50">
              <div className="flex items-center gap-2">
                <span className="text-muted">{metric.icon}</span>
                <div>
                  <p className="text-sm text-muted">{metric.label}</p>
                  <p className="text-lg font-semibold">{metric.value}</p>
                </div>
              </div>
              <TrendChip trend={metric.trend} neutralLabel={t('community.no_change')} />
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function TrendChip({ trend, neutralLabel }: { trend: number; neutralLabel: string }) {
  if (!trend || trend === 0) return <Chip size="sm" variant="flat">{neutralLabel}</Chip>;
  const isPositive = trend > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  return (
    <Chip size="sm" variant="flat" color={isPositive ? 'success' : 'warning'} startContent={<Icon className="w-3 h-3" />}>
      {isPositive ? '+' : ''}{trend}%
    </Chip>
  );
}
