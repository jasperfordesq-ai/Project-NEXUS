// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Activity Dashboard Page - User's activity overview
 *
 * Features:
 * - Activity timeline (recent actions)
 * - Hours given/received summary cards
 * - Monthly activity chart
 * - Skills breakdown
 * - Connection stats
 *
 * API: GET /api/v2/users/me/activity/dashboard
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';import Activity from 'lucide-react/icons/activity';
import ArrowUpRight from 'lucide-react/icons/arrow-up-right';
import ArrowDownLeft from 'lucide-react/icons/arrow-down-left';
import Users from 'lucide-react/icons/users';
import ListTodo from 'lucide-react/icons/list-todo';
import CalendarCheck from 'lucide-react/icons/calendar-check';
import TrendingUp from 'lucide-react/icons/trending-up';
import Clock from 'lucide-react/icons/clock';
import MessageSquare from 'lucide-react/icons/message-square';
import Star from 'lucide-react/icons/star';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Sparkles from 'lucide-react/icons/sparkles';
import BarChart3 from 'lucide-react/icons/chart-column';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback';
// No context imports needed - standalone dashboard
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ActivityItem {
  id: number;
  activity_type: string;
  description: string;
  created_at: string;
}

interface HoursSummary {
  hours_given: number;
  hours_received: number;
  transactions_given: number;
  transactions_received: number;
  net_balance: number;
}

interface ConnectionStats {
  total_connections: number;
  pending_requests: number;
  groups_joined: number;
}

interface EngagementMetrics {
  posts_count: number;
  comments_count: number;
  likes_given: number;
  likes_received: number;
}

interface SkillEntry {
  skill_name: string;
  is_offering: boolean;
  is_requesting: boolean;
  proficiency: string | null;
  endorsements: number;
}

interface SkillsBreakdown {
  skills: SkillEntry[];
  offering_count: number;
  requesting_count: number;
}

interface MonthlyEntry {
  month: string;
  label: string;
  given: number;
  received: number;
}

interface DashboardData {
  timeline: ActivityItem[];
  hours_summary: HoursSummary;
  connection_stats: ConnectionStats;
  engagement: EngagementMetrics;
  skills_breakdown: SkillsBreakdown;
  monthly_hours: MonthlyEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Icon Map
// ─────────────────────────────────────────────────────────────────────────────

const activityIcons: Record<string, { icon: React.ReactNode; color: string }> = {
  exchange: { icon: <ArrowUpRight className="w-4 h-4" aria-hidden="true" />, color: 'text-emerald-500 bg-emerald-500/10' },
  listing: { icon: <ListTodo className="w-4 h-4" aria-hidden="true" />, color: 'text-accent-soft-foreground bg-accent/10' },
  connection: { icon: <Users className="w-4 h-4" aria-hidden="true" />, color: 'text-[var(--color-info)] bg-blue-500/10' },
  event: { icon: <CalendarCheck className="w-4 h-4" aria-hidden="true" />, color: 'text-accent-soft-foreground bg-accent/10' },
  message: { icon: <MessageSquare className="w-4 h-4" aria-hidden="true" />, color: 'text-cyan-500 bg-cyan-500/10' },
  review: { icon: <Star className="w-4 h-4" aria-hidden="true" />, color: 'text-[var(--color-warning)] bg-amber-500/10' },
  post: { icon: <Activity className="w-4 h-4" aria-hidden="true" />, color: 'text-rose-500 bg-rose-500/10' },
  default: { icon: <Activity className="w-4 h-4" aria-hidden="true" />, color: 'text-theme-subtle bg-theme-elevated' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <GlassCard className="p-4 text-center">
      <div className={`inline-flex p-2 rounded-lg bg-gradient-to-br ${color} mb-2`}>
        {icon}
      </div>
      <div className="text-xl font-bold text-theme-primary">{value}</div>
      <div className="text-xs text-theme-subtle">{label}</div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple Bar Chart (no recharts dependency for basic display)
// ─────────────────────────────────────────────────────────────────────────────

function SimpleBarChart({ data, givenLabel, receivedLabel }: { data: MonthlyEntry[]; givenLabel: string; receivedLabel: string }) {
  if (data.length === 0) return null;

  const maxVal = Math.max(...data.flatMap((d) => [d.given, d.received]), 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 mb-3 text-xs text-theme-subtle">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
          <span>{givenLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-accent" />
          <span>{receivedLabel}</span>
        </div>
      </div>
      <div className="flex items-end gap-1 h-32">
        {data.map((item, idx) => (
          <div key={idx} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full flex gap-0.5 items-end h-full">
              <div
                className="flex-1 bg-emerald-500/60 rounded-t-sm transition-all"
                style={{ height: `${Math.max((item.given / maxVal) * 100, 4)}%` }}
              />
              <div
                className="flex-1 bg-accent/60 rounded-t-sm transition-all"
                style={{ height: `${Math.max((item.received / maxVal) * 100, 4)}%` }}
              />
            </div>
            <span className="text-[10px] text-theme-subtle truncate w-full text-center">
              {item.label ? item.label.slice(0, 3) : item.month.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function ActivityDashboardPage() {
  const { t } = useTranslation('activity');
  usePageTitle(t('page_title'));
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const loadDashboard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<DashboardData>('/v2/users/me/activity/dashboard');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setDashboard(response.data);
      } else {
        setError(tRef.current('error_load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load activity dashboard', err);
      setError(tRef.current('error_load_failed_detail'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label={t('loading')} aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadDashboard}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  if (!dashboard) return null;

  const {
    timeline = [],
    hours_summary = { hours_given: 0, hours_received: 0, transactions_given: 0, transactions_received: 0, net_balance: 0 },
    connection_stats = { total_connections: 0, pending_requests: 0, groups_joined: 0 },
    engagement = { posts_count: 0, comments_count: 0, likes_given: 0, likes_received: 0 },
    skills_breakdown = { skills: [], offering_count: 0, requesting_count: 0 },
    monthly_hours = [],
  } = dashboard;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-5xl mx-auto space-y-6"
    >
      <PageMeta title={t('page_meta.title')} noIndex />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <motion.div variants={itemVariants}>
        <PublicPageHero
          size="compact"
          title={t('page_title')}
          description={t('page_subtitle')}
          icon={<Activity className="h-6 w-6" aria-hidden="true" />}
          accent="indigo"
        />
      </motion.div>

      {/* Stats Grid */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<ArrowUpRight className="w-5 h-5" aria-hidden="true" />}
          label={t('stats.hours_given')}
          value={hours_summary.hours_given}
          color="from-emerald-500/20 to-teal-500/20 text-emerald-500"
        />
        <StatCard
          icon={<ArrowDownLeft className="w-5 h-5" aria-hidden="true" />}
          label={t('stats.hours_received')}
          value={hours_summary.hours_received}
          color="from-accent/20 to-blue-500/20 text-accent"
        />
        <StatCard
          icon={<Users className="w-5 h-5" aria-hidden="true" />}
          label={t('stats.connections')}
          value={connection_stats.total_connections}
          color="from-blue-500/20 to-cyan-500/20 text-[var(--color-info)]"
        />
        <StatCard
          icon={<ListTodo className="w-5 h-5" aria-hidden="true" />}
          label={t('stats.exchanges')}
          value={hours_summary.transactions_given + hours_summary.transactions_received}
          color="from-accent/20 to-fuchsia-500/20 text-accent"
        />
      </motion.div>

      {/* Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column - Activity Timeline */}
        <motion.div variants={itemVariants} className="lg:col-span-2 space-y-4">
          {/* Monthly Chart */}
          {monthly_hours.some(m => m.given > 0 || m.received > 0) && (
            <GlassCard className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-accent" aria-hidden="true" />
                <h3 className="font-semibold text-theme-primary">{t('chart.monthly_activity')}</h3>
              </div>
              <div role="img" aria-label={t('chart.monthly_activity_aria')}>
                <SimpleBarChart data={monthly_hours} givenLabel={t('chart.given')} receivedLabel={t('chart.received')} />
              </div>
            </GlassCard>
          )}

          {/* Recent Activity */}
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-accent" aria-hidden="true" />
                <h3 className="font-semibold text-theme-primary">{t('recent_activity')}</h3>
              </div>
            </div>

            {timeline.length > 0 ? (
              <div className="space-y-4">
                {timeline.map((item, idx) => {
                  const config = activityIcons[item.activity_type] ?? activityIcons.default ?? { icon: null, color: '' };
                  return (
                    <div key={`${item.id}-${idx}`} className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                        {config.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-theme-primary">{item.description}</p>
                        <p className="text-xs text-theme-subtle mt-0.5">
                          {formatRelativeTime(item.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles className="w-10 h-10" aria-hidden="true" />}
                title={t('empty_title')}
                description={t('empty_description')}
              />
            )}
          </GlassCard>
        </motion.div>

        {/* Right Column - Skills & Stats */}
        <motion.div variants={itemVariants} className="space-y-4">
          {/* Quick Stats */}
          <GlassCard className="p-5">
            <h3 className="font-semibold text-theme-primary mb-3 text-sm">{t('quick_stats')}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-theme-muted flex items-center gap-2">
                  <Users className="w-4 h-4" aria-hidden="true" />
                  {t('groups_joined')}
                </span>
                <span className="font-semibold text-theme-primary">{connection_stats.groups_joined}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-theme-muted flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" aria-hidden="true" />
                  {t('posts_30d')}
                </span>
                <span className="font-semibold text-theme-primary">{engagement.posts_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-theme-muted flex items-center gap-2">
                  <Star className="w-4 h-4" aria-hidden="true" />
                  {t('likes_received_30d')}
                </span>
                <span className="font-semibold text-theme-primary">{engagement.likes_received}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-theme-muted flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" aria-hidden="true" />
                  {t('net_balance')}
                </span>
                <span className={`font-semibold ${hours_summary.net_balance >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {hours_summary.net_balance >= 0 ? '+' : ''}{hours_summary.net_balance}{t('hours_suffix')}
                </span>
              </div>
            </div>
          </GlassCard>

          {/* Skills */}
          {skills_breakdown.skills.length > 0 && (
            <GlassCard className="p-5">
              <h3 className="font-semibold text-theme-primary mb-3 text-sm">{t('my_skills')}</h3>
              <div className="space-y-2">
                {skills_breakdown.skills.slice(0, 6).map((skill) => (
                  <div key={skill.skill_name} className="flex items-center justify-between">
                    <span className="text-sm text-theme-muted truncate">{skill.skill_name}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      {skill.is_offering && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{t('skill_offer')}</span>
                      )}
                      {skill.is_requesting && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400">{t('skill_request')}</span>
                      )}
                      {skill.endorsements > 0 && (
                        <span className="text-[10px] text-accent font-semibold">×{skill.endorsements}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

export default ActivityDashboardPage;
