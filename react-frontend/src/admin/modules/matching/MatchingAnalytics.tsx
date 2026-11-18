// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatUnit, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner, Progress } from '@/components/ui';
import {
  useState,
  useCallback,
  useEffect,
  useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Separator } from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Target from 'lucide-react/icons/target';
import MapPin from 'lucide-react/icons/map-pin';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import Zap from 'lucide-react/icons/zap';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ThumbsDown from 'lucide-react/icons/thumbs-down';
import Compass from 'lucide-react/icons/compass';
import Gauge from 'lucide-react/icons/gauge';
import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { adminMatching } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import type { MatchingStatsResponse } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { logError } from '@/lib/logger';
import { parseMatchingStatsResponse } from './matchingResponseGuards';

/**
 * Matching Analytics Page
 * Displays smart matching statistics, score distribution, * distance distribution, and approval metrics.
 */

/**
 * Colour per score bucket. The keys are the ranges the server sends
 * (SmartMatchingAnalyticsService::SCORE_BUCKETS) — half-open, so every score
 * lands in exactly one. Until November 2026 this map expected four different
 * ranges and every bar was labelled "Other score range".
 */
const SCORE_COLORS: Record<string, 'danger' | 'warning' | 'primary' | 'success'> = {
  '0-20': 'danger',
  '20-40': 'danger',
  '40-60': 'warning',
  '60-80': 'primary',
  '80-100': 'success',
};

/** Colour per distance bucket (SmartMatchingAnalyticsService::DISTANCE_BUCKETS). */
const DIST_COLORS: Record<string, 'success' | 'primary' | 'secondary' | 'warning' | 'danger'> = {
  '0-5': 'success',
  '5-15': 'primary',
  '15-30': 'secondary',
  '30-50': 'warning',
  '50+': 'danger',
  unknown: 'secondary',
};

/**
 * Labels for the reasons a member can give when dismissing a match — the
 * list MatchingController::DISMISS_REASONS accepts. An unknown key (an older
 * stored reason) is labelled "Other reason".
 */
const REASON_LABEL_KEYS: Record<string, string> = {
  not_relevant: 'matching.reason_not_relevant',
  too_far: 'matching.reason_too_far',
  already_done: 'matching.reason_already_done',
  not_my_skills: 'matching.reason_not_my_skills',
  not_interested: 'matching.reason_not_interested',
  other: 'matching.reason_other',
};

/** Label map for matching pillars */
const PILLAR_LABEL_KEYS: Record<string, string> = {
  relevance: 'matching.pillar_relevance',
  feasibility: 'matching.pillar_feasibility',
  trust: 'matching.pillar_trust',
};

function formatPercentage(value: number): string {
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value / 100);
}

/** A closed bucket key such as "20-40" or "5-15". */
const RANGE_KEY = /^(\d+)-(\d+)$/;
/** An open-ended bucket key such as "50+". */
const OPEN_RANGE_KEY = /^(\d+)\+$/;

export function MatchingAnalytics() {
  const { t } = useTranslation('admin_matching');

  // A bucket key is a range of numbers, so its label is built from the
  // numbers rather than looked up per bucket.
  const scoreLabel = (range: string): string => {
    const bounds = RANGE_KEY.exec(range);
    return bounds
      ? t('matching.score_range', { from: bounds[1], to: bounds[2] })
      : t('matching.score_range_unknown');
  };
  const distanceLabel = (range: string): string => {
    if (range === 'unknown') return t('matching.distance_none');
    const bounds = RANGE_KEY.exec(range);
    if (bounds) return t('matching.distance_range', { from: bounds[1], to: bounds[2] });
    const over = OPEN_RANGE_KEY.exec(range);
    return over
      ? t('matching.distance_range_over', { from: over[1] })
      : t('matching.distance_unknown');
  };
  usePageTitle(t('matching.page_title'));
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const [stats, setStats] = useState<MatchingStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestIdRef = useRef(0);

  const loadStats = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await adminMatching.getMatchingStats();
      if (requestId !== requestIdRef.current) return;
      const parsed = res.success ? parseMatchingStatsResponse(res.data) : null;
      if (parsed) {
        setStats(parsed);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logError('Failed to load matching analytics', err);
      setLoadFailed(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);


  useEffect(() => {
    void loadStats();
    return () => { requestIdRef.current += 1; };
  }, [loadStats]);

  const overview = stats?.overview;

  const initialLoading = loading && stats === null;

  return (
    <div>
      <PageHeader
        title={t('matching.matching_analytics_title')}
        description={t('matching.matching_analytics_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              onPress={() => navigate(tenantPath('/admin/smart-matching'))}
              size="sm"
            >
              {t('common.back')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadStats}
              isLoading={loading}
              size="sm"
            >
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      {initialLoading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : loadFailed && stats === null ? (
        <div role="alert">
          <EmptyState icon={AlertTriangle} title={t('matching.failed_to_load_matching_analytics')} actionLabel={t('common.retry')} onAction={loadStats} />
        </div>
      ) : stats !== null ? (
        <>
          {loadFailed && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-danger sm:flex-row sm:items-center sm:justify-between" role="alert">
              <div className="flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /><p className="text-sm">{t('matching.failed_to_load_matching_analytics')}</p></div>
              <Button variant="outline" onPress={loadStats} isLoading={loading}>{t('common.retry')}</Button>
            </div>
          )}
          {/* Stats Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            {/* Every match on record now. (This tile was headed "Total
                matches" but showed only this month's new ones.) */}
            <StatCard
              label={t('matching.label_current_matches')}
              value={overview?.cache_entries ?? 0}
              icon={Target}
              loading={loading}
            />
            <StatCard
              label={t('matching.label_approval_rate')}
              value={formatPercentage(stats?.approval_rate ?? 0)}
              icon={CheckCircle}
              color="success"
              loading={loading}
            />
            <StatCard
              label={t('matching.label_average_score')}
              value={overview?.avg_match_score !== undefined
                ? formatPercentage(overview.avg_match_score)
                : '---'}
              icon={TrendingUp}
              loading={loading}
            />
            <StatCard
              label={t('matching.label_avg_distance')}
              value={overview?.avg_distance_km !== undefined
                ? formatUnit(overview.avg_distance_km, 'kilometer', { maximumFractionDigits: 1 })
                : '---'}
              icon={MapPin}
              color="warning"
              loading={loading}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Score Distribution */}
            <Card >
              <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
                <Zap size={18} className="text-accent" />
                <h3 className="font-semibold">{t('matching.score_distribution')}</h3>
              </CardHeader>
              <CardBody className="px-4 pb-4">
                {Object.keys(stats.score_distribution).length > 0 ? (
                  <div className="space-y-4">
                    {Object.entries(stats.score_distribution).map(([range, count]) => {
                      const total = Object.values(stats.score_distribution).reduce(
                        (a, b) => a + b,
                        0
                      );
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={range}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-muted">
                              {scoreLabel(range)}
                            </span>
                            <span className="text-sm font-medium tabular-nums">
                              {count} ({formatPercentage(pct)})
                            </span>
                          </div>
                          <Progress
                            value={pct}
                            color={SCORE_COLORS[range] ?? 'primary'}
                            size="sm"
                            aria-label={t('matching.distribution_aria', {
                              label: scoreLabel(range),
                              count,
                              percent: pct,
                            })}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted">
                    {t('matching.no_score_data')}
                  </p>
                )}
              </CardBody>
            </Card>

            {/* Distance Distribution */}
            <Card >
              <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
                <MapPin size={18} className="text-accent" />
                <h3 className="font-semibold">{t('matching.distance_distribution')}</h3>
              </CardHeader>
              <CardBody className="px-4 pb-4">
                {Object.keys(stats.distance_distribution).length > 0 ? (
                  <div className="space-y-4">
                    {Object.entries(stats.distance_distribution).map(
                      ([band, count]) => {
                        const total = Object.values(
                          stats.distance_distribution
                        ).reduce((a, b) => a + b, 0);
                        const pct =
                          total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                          <div key={band}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-muted">
                                {distanceLabel(band)}
                              </span>
                              <span className="text-sm font-medium tabular-nums">
                                {count} ({formatPercentage(pct)})
                              </span>
                            </div>
                            <Progress
                              value={pct}
                              color={DIST_COLORS[band] ?? 'primary'}
                              size="sm"
                              aria-label={t('matching.distribution_aria', {
                                label: distanceLabel(band),
                                count,
                                percent: pct,
                              })}
                            />
                          </div>
                        );
                      }
                    )}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted">
                    {t('matching.no_distance_data')}
                  </p>
                )}
              </CardBody>
            </Card>

            {/* Matching Activity */}
            <Card >
              <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
                <Users size={18} className="text-accent" />
                <h3 className="font-semibold">{t('matching.matching_activity')}</h3>
              </CardHeader>
              <CardBody className="px-4 pb-4">
                {overview ? (
                  <div className="space-y-3">
                    <ActivityRow
                      label={t('matching.label_matches_today')}
                      value={overview.total_matches_today ?? '---'}
                    />
                    <Separator />
                    <ActivityRow
                      label={t('matching.label_matches_this_week')}
                      value={overview.total_matches_week ?? '---'}
                    />
                    <Separator />
                    <ActivityRow
                      label={t('matching.label_matches_this_month')}
                      value={overview.total_matches_month}
                    />
                    <Separator />
                    <ActivityRow
                      label={t('matching.label_hot_matches')}
                      value={overview.hot_matches_count}
                    />
                    <Separator />
                    <ActivityRow
                      label={t('matching.label_mutual_matches')}
                      value={overview.mutual_matches_count ?? '---'}
                    />
                    <Separator />
                    <ActivityRow
                      label={t('matching.label_members_with_matches')}
                      value={overview.active_users_matching}
                    />
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted">
                    {t('matching.no_activity_data')}
                  </p>
                )}
              </CardBody>
            </Card>

            {/* Approval Metrics */}
            <Card >
              <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
                <CheckCircle size={18} className="text-accent" />
                <h3 className="font-semibold">{t('matching.approval_metrics')}</h3>
              </CardHeader>
              <CardBody className="px-4 pb-4">
                {stats ? (
                  <div className="space-y-3">
                    <ActivityRow
                      label={t('matching.label_pending_approvals')}
                      value={stats.pending_approvals}
                      color="text-warning"
                    />
                    <Separator />
                    <ActivityRow
                      label={t('matching.label_approved_matches')}
                      value={stats.approved_count}
                      color="text-success"
                    />
                    <Separator />
                    <ActivityRow
                      label={t('matching.label_rejected_matches')}
                      value={stats.rejected_count}
                      color="text-danger"
                    />
                    <Separator />
                    <div className="flex items-center justify-between py-1">
                      <span className="text-sm text-muted">{t('matching.label_approval_rate')}</span>
                      <span className="text-sm font-bold text-success">
                        {formatPercentage(stats.approval_rate)}
                      </span>
                    </div>
                    <Progress
                      value={stats.approval_rate}
                      color="success"
                      size="sm"
                      aria-label={t('matching.approval_rate_aria', { value: stats.approval_rate })}
                    />
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted">
                    {t('matching.no_approval_data')}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Location Data Readiness / Gate Impact */}
          {stats?.gate_impact && (
            <div className="mt-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <Compass size={18} className="text-accent" />
                {t('matching.gate_impact')}
              </h3>
              <p className="mb-4 text-sm text-muted">{t('matching.gate_impact_desc')}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard
                  label={t('matching.label_degraded_members')}
                  value={stats.gate_impact.degraded_users_count}
                  description={t('matching.of_active_users', { total: stats.gate_impact.active_users_count })}
                  icon={Users}
                  color="warning"
                />
                <StatCard
                  label={t('matching.label_listings_without_coords')}
                  value={stats.gate_impact.listings_without_coords}
                  icon={MapPin}
                  color="danger"
                />
                <StatCard
                  label={t('matching.label_remote_listings_share')}
                  value={stats.gate_impact.remote_listings_count}
                  description={t('matching.of_active_listings', { total: stats.gate_impact.active_listings_count })}
                  icon={Compass}
                  color="secondary"
                />
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Feedback Reasons */}
            {stats?.gate_impact?.dismiss_reasons && (
              <Card>
                <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
                  <ThumbsDown size={18} className="text-accent" />
                  <h3 className="font-semibold">{t('matching.feedback_reasons')}</h3>
                </CardHeader>
                <CardBody className="px-4 pb-4">
                  <p className="mb-4 text-sm text-muted">{t('matching.feedback_reasons_desc')}</p>
                  {Object.keys(stats.gate_impact.dismiss_reasons).length > 0 ? (
                    <div className="space-y-4">
                      {Object.entries(stats.gate_impact.dismiss_reasons).map(([reason, count]) => {
                        const total = Object.values(stats.gate_impact!.dismiss_reasons).reduce(
                          (a, b) => a + b,
                          0
                        );
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                        const label = REASON_LABEL_KEYS[reason] ? t(REASON_LABEL_KEYS[reason]) : t('matching.reason_unknown');
                        return (
                          <div key={reason}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-muted">{label}</span>
                              <span className="text-sm font-medium tabular-nums">
                                {count} ({formatPercentage(pct)})
                              </span>
                            </div>
                            <Progress
                              value={pct}
                              color="secondary"
                              size="sm"
                              aria-label={t('matching.feedback_reason_aria', { label, count, percent: pct })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted">
                      {t('matching.no_feedback_reasons_data')}
                    </p>
                  )}
                </CardBody>
              </Card>
            )}

            {/* Pillar Averages */}
            {stats?.pillar_averages && stats.pillar_averages.sample_size > 0 && (
              <Card>
                <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
                  <Gauge size={18} className="text-accent" />
                  <h3 className="font-semibold">{t('matching.pillar_averages')}</h3>
                </CardHeader>
                <CardBody className="px-4 pb-4">
                  <p className="mb-4 text-sm text-muted">{t('matching.pillar_averages_desc')}</p>
                  <div className="space-y-4">
                    {(['relevance', 'feasibility', 'trust'] as const).map((pillar) => {
                      const value = stats.pillar_averages?.pillars?.[pillar];
                      if (value === undefined) return null;
                      const pct = Math.round(value * 100);
                      const label = PILLAR_LABEL_KEYS[pillar]
                        ? t(PILLAR_LABEL_KEYS[pillar])
                        : t('matching.pillar_unknown');
                      return (
                        <div key={pillar}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-muted">{label}</span>
                            <span className="text-sm font-medium tabular-nums">{formatPercentage(pct)}</span>
                          </div>
                          <Progress
                            value={pct}
                            color="primary"
                            size="sm"
                            aria-label={t('matching.pillar_aria', { label, percent: pct })}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-xs text-muted">
                    {t('matching.pillar_averages_sample_size', { count: stats.pillar_averages.sample_size })}
                  </p>
                </CardBody>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Simple key-value row for activity/metrics cards */
function ActivityRow({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color ?? 'text-foreground'}`}>
        {typeof value === 'number' ? value.toLocaleString(getFormattingLocale()) : value}
      </span>
    </div>
  );
}

export default MatchingAnalytics;
