// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Button, Chip, Spinner, Progress } from '@/components/ui';
import {
  useState,
  useCallback,
  useEffect,
  useRef } from 'react';
import { Link } from 'react-router-dom';
import { Separator } from '@/components/ui';
import Settings from 'lucide-react/icons/settings';
import BarChart3 from 'lucide-react/icons/chart-column';
import Trash2 from 'lucide-react/icons/trash-2';
import Zap from 'lucide-react/icons/zap';
import Target from 'lucide-react/icons/target';
import Database from 'lucide-react/icons/database';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import ShieldCheck from 'lucide-react/icons/shield-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminMatching } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { SmartMatchingConfig, MatchingStatsResponse, MatchingPillarWeights } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { logError } from '@/lib/logger';
import { formatPercentValue } from '@/lib/helpers';
import { isSmartMatchingConfig, parseMatchingStatsResponse } from './matchingResponseGuards';

/**
 * Smart Matching Overview
 * Dashboard showing algorithm configuration summary, matching stats, * and quick actions for the Smart Matching admin module.
 */

/** Weight metadata for display */
const WEIGHT_META: Array<{
  key: keyof Pick<SmartMatchingConfig,
    'category_weight' | 'skill_weight' | 'proximity_weight' |
    'freshness_weight' | 'reciprocity_weight' | 'quality_weight'
  >;
  label: string;
  color: 'default' | 'success' | 'warning' | 'danger';
}> = [
  { key: 'category_weight',    label: 'matching.weight_category',    color: 'default' },
  { key: 'skill_weight',       label: 'matching.weight_skill',       color: 'success' },
  { key: 'proximity_weight',   label: 'matching.weight_proximity',   color: 'warning' },
  { key: 'freshness_weight',   label: 'matching.weight_freshness',   color: 'default' },
  { key: 'reciprocity_weight', label: 'matching.weight_reciprocity', color: 'default' },
  { key: 'quality_weight',     label: 'matching.weight_quality',     color: 'danger' },
];

/** The three weights of the current scoring method. */
const PILLAR_META: Array<{
  key: keyof MatchingPillarWeights;
  label: string;
  color: 'default' | 'success' | 'warning';
}> = [
  { key: 'relevance',   label: 'matching.pillar_relevance',   color: 'default' },
  { key: 'feasibility', label: 'matching.pillar_feasibility', color: 'warning' },
  { key: 'trust',       label: 'matching.pillar_trust',       color: 'success' },
];

export function SmartMatchingOverview() {
  const { t } = useTranslation('admin_matching');
  usePageTitle(t('matching.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [config, setConfig] = useState<SmartMatchingConfig | null>(null);
  const [stats, setStats] = useState<MatchingStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailures, setLoadFailures] = useState({ config: false, stats: false });
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const requestIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const [configResult, statsResult] = await Promise.allSettled([
        adminMatching.getConfig(),
        adminMatching.getMatchingStats(),
      ]);
      if (requestId !== requestIdRef.current) return;

      let configLoaded = false;
      let statsLoaded = false;
      if (configResult.status === 'fulfilled' && configResult.value.success && isSmartMatchingConfig(configResult.value.data)) {
        setConfig(configResult.value.data);
        configLoaded = true;
      }
      const parsedStats = statsResult.status === 'fulfilled' && statsResult.value.success
        ? parseMatchingStatsResponse(statsResult.value.data)
        : null;
      if (parsedStats) {
        setStats(parsedStats);
        statsLoaded = true;
      }

      if (configResult.status === 'rejected') logError('Failed to load matching configuration', configResult.reason);
      if (statsResult.status === 'rejected') logError('Failed to load matching stats', statsResult.reason);
      setLoadFailures({ config: !configLoaded, stats: !statsLoaded });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logError('Failed to load smart matching overview', err);
      setLoadFailures({ config: true, stats: true });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    return () => { requestIdRef.current += 1; };
  }, [loadData]);

  const handleClearCache = useCallback(async () => {
    setClearing(true);
    try {
      const res = await adminMatching.clearCache();
      if (res.success) {
        const cleared = (res.data as { entries_cleared?: unknown } | undefined)?.entries_cleared;
        toast.success(
          typeof cleared === 'number' && Number.isFinite(cleared)
            ? t('matching.cache_cleared_count', { count: cleared })
            : t('matching.cache_cleared')
        );
        setClearModalOpen(false);
        void loadData();
      } else {
        toast.error(t('matching.failed_to_clear_cache'));
      }
    } catch {
      toast.error(t('matching.failed_to_clear_cache'));
    } finally {
      setClearing(false);
    }
  }, [t, toast, loadData])


  const overview = stats?.overview;
  const initialLoading = loading && config === null && stats === null;

  return (
    <div>
      <PageHeader
        title={t('matching.smart_matching_overview_title')}
        description={t('matching.smart_matching_overview_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={loadData}
            isLoading={loading}
            size="sm"
          >
            {t('matching.refresh')}
          </Button>
        }
      />

      {(loadFailures.config || loadFailures.stats) && !initialLoading && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-danger sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              {loadFailures.config && <p>{t('matching.failed_to_load_matching_configuration')}</p>}
              {loadFailures.stats && <p>{t('matching.failed_to_load_matching_analytics')}</p>}
            </div>
          </div>
          <Button variant="outline" onPress={loadData} isLoading={loading}>{t('common.retry')}</Button>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label={t('matching.label_members_with_matches')}
          value={overview?.active_users_matching ?? '---'}
          icon={Target}
          color="default"
          loading={initialLoading}
        />
        <StatCard
          label={t('matching.label_cache_size')}
          value={overview?.cache_entries ?? '---'}
          icon={Database}
          color="default"
          loading={initialLoading}
        />
        <StatCard
          label={t('matching.label_avg_score')}
          value={overview?.avg_match_score !== undefined
            ? formatPercentValue(overview.avg_match_score)
            : '---'}
          icon={TrendingUp}
          color="success"
          loading={initialLoading}
        />
        {/* Matches waiting for a coordinator. (This tile used to read "Broker
            approval: Enabled", a setting nothing ever acted on.) */}
        <StatCard
          label={t('matching.label_pending_approvals')}
          value={stats ? stats.pending_approvals : '---'}
          icon={ShieldCheck}
          color={stats && stats.pending_approvals > 0 ? 'warning' : 'success'}
          loading={initialLoading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Algorithm Weights */}
        <Card>
          <CardHeader className="flex items-center justify-between px-4 pt-4 pb-0">
            <div className="flex items-center gap-2">
              <Zap aria-hidden="true" size={18} className="text-accent" />
              <h3 className="font-semibold">{t('matching.scoring_weights')}</h3>
            </div>
            {config && (
              <Chip
                size="sm"
                variant="soft"
                color={config.enabled ? 'success' : 'default'}
              >
                {config.enabled ? t('matching.active') : t('matching.inactive')}
              </Chip>
            )}
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading && config === null ? (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-48 items-center justify-center">
                <Spinner />
              </div>
            ) : config && config.engine_version !== 1 ? (
              // Current scoring method: three weights, balanced against each
              // other by the scorer, so there is no "total" to show.
              <div className="space-y-4">
                {PILLAR_META.map(({ key, label: labelKey, color }) => {
                  const value = config.pillars?.[key];
                  if (value === undefined) return null;
                  const pct = Math.round(value * 100);
                  const labelText = t(labelKey);
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-foreground/80">{labelText}</span>
                        <span className="text-sm font-medium text-foreground">
                          {formatPercentValue(pct)}
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        color={color}
                        size="sm"
                        aria-label={t('matching.weight_aria', { label: labelText, value: pct })}
                      />
                    </div>
                  );
                })}
              </div>
            ) : config ? (
              <div className="space-y-4">
                {WEIGHT_META.map(({ key, label: labelKey, color }) => {
                  const value = config[key];
                  const pct = Math.round(value * 100);
                  const labelText = t(labelKey);
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-foreground/80">{labelText}</span>
                        <span className="text-sm font-medium text-foreground">
                          {formatPercentValue(pct)}
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        color={color}
                        size="sm"
                        aria-label={t('matching.weight_aria', { label: labelText, value: pct })}
                      />
                    </div>
                  );
                })}
                <Separator className="my-2" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">{t('matching.total')}</span>
                  <span className="font-semibold">
                    {formatPercentValue(Math.round(
                      (config.category_weight +
                        config.skill_weight +
                        config.proximity_weight +
                        config.freshness_weight +
                        config.reciprocity_weight +
                        config.quality_weight) * 100
                    ))}
                  </span>
                </div>
              </div>
            ) : loadFailures.config ? (
              <p className="py-8 text-center text-sm text-danger">{t('matching.failed_to_load_matching_configuration')}</p>
            ) : (
              <p className="py-8 text-center text-sm text-muted/80">
                {t('matching.no_configuration_loaded')}
              </p>
            )}
          </CardBody>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Settings aria-hidden="true" size={18} className="text-accent" />
            <h3 className="font-semibold">{t('matching.quick_actions')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <div className="space-y-3">
              <Button
                as={Link}
                to={tenantPath('/admin/smart-matching/configuration')}
                fullWidth
                variant="secondary"
                startContent={<Settings aria-hidden="true" size={16} />}
                className="justify-start"
              >
                {t('matching.configure_algorithm')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/admin/smart-matching/analytics')}
                fullWidth
                variant="tertiary"
                startContent={<BarChart3 aria-hidden="true" size={16} />}
                className="justify-start"
              >
                {t('matching.view_analytics')}
              </Button>
              <Button
                fullWidth
                variant="danger-soft"
                startContent={<Trash2 aria-hidden="true" size={16} />}
                className="justify-start"
                onPress={() => setClearModalOpen(true)}
              >
                {t('matching.clear_match_cache')}
              </Button>
              <Separator className="my-2" />
              <Button
                as={Link}
                to={tenantPath('/broker/match-approvals')}
                fullWidth
                variant="tertiary"
                startContent={<ShieldCheck aria-hidden="true" size={16} />}
                className="justify-start"
              >
                {t('matching.broker_approvals')}
                {stats?.pending_approvals ? (
                  <Chip size="sm" color="warning" variant="soft" className="ml-auto">
                    {stats.pending_approvals}
                  </Chip>
                ) : null}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Matching Activity Summary */}
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Users aria-hidden="true" size={18} className="text-accent" />
            <h3 className="font-semibold">{t('matching.matching_activity')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading && stats === null ? (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-32 items-center justify-center">
                <Spinner />
              </div>
            ) : overview ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 rounded-lg bg-surface-secondary">
                  <p className="text-2xl font-bold text-foreground">
                    {overview.total_matches_today ?? '---'}
                  </p>
                  <p className="text-xs text-muted">{t('matching.matches_today')}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-surface-secondary">
                  <p className="text-2xl font-bold text-foreground">
                    {overview.total_matches_week ?? '---'}
                  </p>
                  <p className="text-xs text-muted">{t('matching.this_week')}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-surface-secondary">
                  <p className="text-2xl font-bold text-foreground">
                    {overview.total_matches_month}
                  </p>
                  <p className="text-xs text-muted">{t('matching.this_month')}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-surface-secondary">
                  <p className="text-2xl font-bold text-foreground">
                    {overview.active_users_matching}
                  </p>
                  <p className="text-xs text-muted">{t('matching.label_members_with_matches')}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-surface-secondary">
                  <p className="text-2xl font-bold text-foreground">
                    {overview.hot_matches_count}
                  </p>
                  <p className="text-xs text-muted">{t('matching.hot_matches')}</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-surface-secondary">
                  <p className="text-2xl font-bold text-foreground">
                    {overview.mutual_matches_count ?? '---'}
                  </p>
                  <p className="text-xs text-muted">{t('matching.mutual')}</p>
                </div>
              </div>
            ) : loadFailures.stats ? (
              <p className="py-8 text-center text-sm text-danger">{t('matching.failed_to_load_matching_analytics')}</p>
            ) : (
              <p className="py-8 text-center text-sm text-muted/80">
                {t('matching.no_matching_data')}
              </p>
            )}
          </CardBody>
        </Card>

        {/* Approval Summary */}
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <ShieldCheck aria-hidden="true" size={18} className="text-accent" />
            <h3 className="font-semibold">{t('matching.approval_summary')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading && stats === null ? (
              <div className="flex h-32 items-center justify-center">
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
              </div>
            ) : stats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 rounded-lg bg-warning/10">
                    <p className="text-xl font-bold text-warning">
                      {stats.pending_approvals}
                    </p>
                    <p className="text-xs text-muted">{t('matching.label_pending')}</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-success/10">
                    <p className="text-xl font-bold text-success">
                      {stats.approved_count}
                    </p>
                    <p className="text-xs text-muted">{t('matching.label_approved')}</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-danger/10">
                    <p className="text-xl font-bold text-danger">
                      {stats.rejected_count}
                    </p>
                    <p className="text-xs text-muted">{t('matching.label_rejected')}</p>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-foreground/80">{t('matching.label_approval_rate')}</span>
                    <span className="text-sm font-medium">{formatPercentValue(stats.approval_rate)}</span>
                  </div>
                  <Progress
                    value={stats.approval_rate}
                    color="success"
                    size="sm"
                    aria-label={t('matching.approval_rate_aria', { value: stats.approval_rate })}
                  />
                </div>
              </div>
            ) : loadFailures.stats ? (
              <p className="py-8 text-center text-sm text-danger">{t('matching.failed_to_load_matching_analytics')}</p>
            ) : (
              <p className="py-8 text-center text-sm text-muted/80">
                {t('matching.no_approval_data')}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Clear Cache Confirmation */}
      <ConfirmModal
        isOpen={clearModalOpen}
        onClose={() => setClearModalOpen(false)}
        onConfirm={handleClearCache}
        title={t('matching.clear_match_cache')}
        message={overview && !loadFailures.stats
          ? t('matching.clear_cache_confirm_with_count', { count: overview.cache_entries })
          : t('matching.clear_cache_confirm')}
        confirmLabel={t('matching.clear_cache_btn')}
        confirmColor="danger"
        isLoading={clearing}
      />
    </div>
  );
}

export default SmartMatchingOverview;
