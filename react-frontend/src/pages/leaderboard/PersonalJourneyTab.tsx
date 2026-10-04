// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
/**
 * PersonalJourneyTab — shows the user's own growth over time.
 *
 * Replaces competitive rankings with personal progress tracking:
 * monthly activity timeline, badge progression, skills growth, milestones.
 */

import { useState, useEffect } from 'react';
import { motion } from '@/lib/motion';

import Award from 'lucide-react/icons/award';
import Calendar from 'lucide-react/icons/calendar';
import Target from 'lucide-react/icons/target';
import TrendingUp from 'lucide-react/icons/trending-up';
import Milestone from 'lucide-react/icons/milestone';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface MonthlyActivity {
  month: string;
  badges: number;
  xp_earned: number;
}

interface BadgeEntry {
  badge_key: string;
  name: string;
  icon: string;
  earned_at: string | null;
}

interface PersonalMilestone {
  type: string;
  label: string;
  date: string | null;
}

interface PersonalSummary {
  xp: number;
  level: number;
  level_name: string;
  total_badges: number;
  total_listings: number;
  volunteer_hours: number;
  total_connections: number;
  total_reviews: number;
  member_since: string | null;
}

interface JourneyData {
  monthly_activity: MonthlyActivity[];
  badge_progression: BadgeEntry[];
  milestones: PersonalMilestone[];
  summary: PersonalSummary;
}

export default function PersonalJourneyTab() {
  const { t } = useTranslation('gamification');
  const [data, setData] = useState<JourneyData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const res = await api.get<JourneyData>('/v2/gamification/personal-journey');
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setError(res.error || t('journey.load_error'));
        }
      } catch (err: unknown) {
        logError('PersonalJourneyTab', err);
        setError(t('journey.load_error'));
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [t]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <GlassCard key={i} className="p-4">
            <Skeleton className="h-4 w-32 mb-3 rounded" />
            <Skeleton className="h-20 w-full rounded" />
          </GlassCard>
        ))}
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

  if (!data) {
    return null;
  }

  // The backend's catch-fallback returns summary as [] (an empty array, not the
  // typed object) inside a 200 { success:true } envelope when its journey query
  // fails, and the list fields may be absent too. Coerce to safe shapes so a
  // degraded response renders zeros/empty rather than throwing on
  // summary.xp.toLocaleString() — which previously crashed the whole Leaderboard
  // section via the error boundary.
  const summary: Partial<PersonalSummary> =
    data.summary && !Array.isArray(data.summary) ? data.summary : {};
  const monthly_activity = Array.isArray(data.monthly_activity) ? data.monthly_activity : [];
  const badge_progression = Array.isArray(data.badge_progression) ? data.badge_progression : [];
  const milestones = Array.isArray(data.milestones) ? data.milestones : [];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          label={summary.level_name || t('journey.level', { level: summary.level ?? 0 })}
          value={t('journey.xp_value', { xp: (summary.xp ?? 0).toLocaleString(getFormattingLocale()) })}
          icon={<TrendingUp aria-hidden="true" className="w-4 h-4 text-accent" />}
          isText
        />
        <SummaryCard
          label={t('journey.badges')}
          value={summary.total_badges ?? 0}
          icon={<Award aria-hidden="true" className="w-4 h-4 text-[var(--color-warning)]" />}
        />
        <SummaryCard
          label={t('journey.listings')}
          value={summary.total_listings ?? 0}
          icon={<Target aria-hidden="true" className="w-4 h-4 text-[var(--color-info)]" />}
        />
        <SummaryCard
          label={t('journey.volunteer_hours')}
          value={summary.volunteer_hours ?? 0}
          icon={<Target aria-hidden="true" className="w-4 h-4 text-emerald-500" />}
        />
        <SummaryCard
          label={t('journey.connections')}
          value={summary.total_connections ?? 0}
          icon={<Target aria-hidden="true" className="w-4 h-4 text-pink-500" />}
        />
        {summary.member_since && (
          <SummaryCard
            label={t('journey.member_since')}
            value={summary.member_since}
            icon={<Calendar aria-hidden="true" className="w-4 h-4 text-muted" />}
            isText
          />
        )}
      </div>

      {/* Monthly activity chart (simple bar representation) */}
      {monthly_activity.length > 0 && (
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            {t('journey.monthly_activity')}
          </h3>
          <div className="flex items-end gap-1 h-32">
            {monthly_activity.map((month, i) => {
              const maxXP = Math.max(
                ...monthly_activity.map((m) => m.xp_earned),
                1
              );
              const height = Math.max(
                (month.xp_earned / maxXP) * 100,
                4
              );

              return (
                <motion.div
                  key={month.month}
                  className="flex-1 origin-bottom flex flex-col items-center gap-1"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <span className="text-[10px] text-muted font-medium">
                    {month.xp_earned || ''}
                  </span>
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-accent-soft to-accent min-h-1"
                    style={{ height: `${height}%` }}
                    title={t('journey.monthly_activity_bar_title', {
                      month: month.month,
                      xp: month.xp_earned,
                      badges: month.badges,
                    })}
                  />
                  <span className="text-[9px] text-muted truncate w-full text-center">
                    {month.month.split(' ')[0]?.slice(0, 3)}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* Badge progression timeline */}
      {badge_progression.length > 0 && (
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            {t('journey.badge_timeline')}
          </h3>
          <div className="space-y-3">
            {badge_progression.slice(-10).map((badge, i) => (
              <motion.div
                key={badge.badge_key}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-secondary/50 transition-colors"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <span className="text-xl">{badge.icon}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{badge.name}</p>
                  {badge.earned_at && (
                    <p className="text-xs text-muted">{badge.earned_at}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Milestones */}
      {milestones.length > 0 && (
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Milestone aria-hidden="true" className="w-5 h-5 text-[var(--color-warning)]" />
            {t('journey.milestones')}
          </h3>
          <div className="space-y-2">
            {milestones.map((milestone, i) => (
              <div
                key={`${milestone.type}-${i}`}
                className="flex items-center gap-3 p-2"
              >
                <div className="w-2 h-2 rounded-full bg-accent-soft" />
                <div className="flex-1">
                  <p className="text-sm">{milestone.label}</p>
                  {milestone.date && (
                    <p className="text-xs text-muted">{milestone.date}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  isText = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  isText?: boolean;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted">{label}</span>
      </div>
      <p className={isText ? 'text-sm font-medium' : 'text-xl font-bold'}>
        {typeof value === 'number' ? value.toLocaleString(getFormattingLocale()) : value}
      </p>
    </GlassCard>
  );
}
