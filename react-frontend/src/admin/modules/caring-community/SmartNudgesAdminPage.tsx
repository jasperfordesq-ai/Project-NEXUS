import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, useDisclosure, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';

import { Separator } from '@/components/ui';
import Bell from 'lucide-react/icons/bell';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';
import Send from 'lucide-react/icons/send';
import FlaskConical from 'lucide-react/icons/flask-conical';
import TrendingUp from 'lucide-react/icons/trending-up';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { logError } from '@/lib/logger';
import { formatPercentRatio, getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SmartNudgesAdminPage — AG31
 *
 * Admin console for the smart-nudge engine that suggests tandem matches
 * to members who would benefit from a peer connection.
 *
 * - 30-day conversion analytics chart
 * - Config (enabled, min_score threshold, cooldown days, daily limit)
 * - Dry-run dispatch preview (no emails sent)
 * - Real dispatch with confirm modal
 *
 * Admin UI text is translated through the admin namespace.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NudgeConfig {
  enabled: boolean;
  min_score: number;
  cooldown_days: number;
  daily_limit: number;
}

interface NudgeStats {
  sent_total: number;
  sent_30d: number;
  converted_total: number;
  converted_30d: number;
  conversion_rate_30d: number;
  opted_out_members: number;
}

interface NudgeRecent {
  id: number;
  target_user: { id: number; name: string };
  related_user: { id: number; name: string };
  score: number;
  status: string;
  sent_at: string;
  converted_at: string | null;
}

interface NudgeAnalytics {
  config: NudgeConfig;
  stats: NudgeStats;
  recent: NudgeRecent[];
  eligible_candidates: number;
}

interface DispatchResult {
  dispatched?: number;
  skipped?: number;
  candidates?: Array<{ target_user_id: number; related_user_id: number; score: number }>;
  dry_run?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildChartData(recent: NudgeRecent[]) {
  // Group by day for last 30 days
  const days: Record<string, { date: string; sent: number; converted: number }> = {};
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days[key] = { date: key.slice(5), sent: 0, converted: 0 };
  }
  for (const r of recent) {
    const sentKey = r.sent_at?.slice(0, 10);
    if (sentKey && days[sentKey]) days[sentKey].sent++;
    if (r.converted_at) {
      const convKey = r.converted_at.slice(0, 10);
      if (days[convKey]) days[convKey].converted++;
    }
  }
  return Object.values(days);
}

const adminDateFormatter = () => new Intl.DateTimeFormat(getFormattingLocale(), {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatAdminDate(value: string): string {
  return adminDateFormatter().format(new Date(value));
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SmartNudgesAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  const toast = useToast();
  usePageTitle(t('smart_nudges.meta.page_title'));

  const [data, setData] = useState<NudgeAnalytics | null>(null);
  const [config, setConfig] = useState<NudgeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [running, setRunning] = useState(false);
  const [dryResult, setDryResult] = useState<DispatchResult | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.get<NudgeAnalytics>('/v2/admin/caring-community/nudges/analytics');
      if (res.success && res.data) {
        setData(res.data);
        setConfig(res.data.config);
      } else {
        toast.error(t('smart_nudges.toasts.load_failed'));
      }
    } catch (err) {
      logError('SmartNudgesAdminPage: load failed', err);
      toast.error(t('smart_nudges.toasts.load_failed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveConfig = useCallback(async () => {
    if (!config) return;
    setSavingConfig(true);
    try {
      const res = await api.put<{ config: NudgeConfig }>(
        '/v2/admin/caring-community/nudges/config',
        config,
      );
      if (res.success) {
        toast.success(t('smart_nudges.toasts.config_saved'));
        void load();
      } else {
        toast.error(t('smart_nudges.toasts.save_failed'));
      }
    } catch (err) {
      logError('SmartNudgesAdminPage: save config failed', err);
      toast.error(t('smart_nudges.toasts.save_failed'));
    } finally {
      setSavingConfig(false);
    }
  }, [config, toast, load, t]);

  const handleDispatch = useCallback(
    async (dryRun: boolean) => {
      setRunning(true);
      try {
        const res = await api.post<DispatchResult>('/v2/admin/caring-community/nudges/dispatch', {
          dry_run: dryRun,
        });
        if (res.success && res.data) {
          if (dryRun) {
            setDryResult(res.data);
            toast.success(t('smart_nudges.toasts.dry_run', { count: res.data.candidates?.length ?? 0 }));
          } else {
            toast.success(t('smart_nudges.toasts.dispatched', { count: res.data.dispatched ?? 0 }));
            setDryResult(null);
            onClose();
            void load();
          }
        } else {
          toast.error(t('smart_nudges.toasts.dispatch_failed'));
        }
      } catch (err) {
        logError('SmartNudgesAdminPage: dispatch failed', err);
        toast.error(t('smart_nudges.toasts.dispatch_failed'));
      } finally {
        setRunning(false);
      }
    },
    [toast, onClose, load, t],
  );

  const chartSeries = {
    sent: t('smart_nudges.chart.sent'),
    converted: t('smart_nudges.chart.converted'),
  };
  const statusLabel = (status: string) => {
    if (status === 'converted') return t('smart_nudges.status.converted');
    if (status === 'sent') return t('smart_nudges.status.sent');
    return t('smart_nudges.status.unknown');
  };

  if (loading || !data || !config) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  const stats = data.stats;
  const chartData = buildChartData(data.recent);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('smart_nudges.meta.title')}
        description={t('smart_nudges.meta.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              startContent={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
              onPress={() => void load()}
              isDisabled={refreshing}
            >
              {t('smart_nudges.actions.refresh')}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              startContent={<FlaskConical className="w-4 h-4" />}
              onPress={() => void handleDispatch(true)}
              isLoading={running}
            >
              {t('smart_nudges.actions.dry_run')}
            </Button>
            <Button
              size="sm"
              startContent={<Send className="w-4 h-4" />}
              onPress={onOpen}
              isDisabled={!config.enabled}
            >
              {t('smart_nudges.actions.dispatch_now')}
            </Button>
          </div>
        }
      />

      {/* About card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft">
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('smart_nudges.about.title')}</p>
              <p className="text-muted">
                {t('smart_nudges.about.body')}
              </p>
              <ul className="mt-1 space-y-0.5 text-muted list-disc list-inside">
                <li><span className="font-medium text-foreground">{t('smart_nudges.about.inactivity_label')}:</span> {t('smart_nudges.about.inactivity_body')}</li>
                <li><span className="font-medium text-foreground">{t('smart_nudges.about.unmatched_request_label')}:</span> {t('smart_nudges.about.unmatched_request_body')}</li>
                <li><span className="font-medium text-foreground">{t('smart_nudges.about.follow_up_label')}:</span> {t('smart_nudges.about.follow_up_body')}</li>
              </ul>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Bell} label={t('smart_nudges.stats.sent_30d')} value={String(stats.sent_30d)} color="default" />
        <StatCard
          icon={TrendingUp}
          label={t('smart_nudges.stats.conversion_30d')}
          value={formatPercentRatio(stats.conversion_rate_30d)}
          color="success"
        />
        <StatCard icon={Bell} label={t('smart_nudges.stats.eligible_candidates')} value={String(data.eligible_candidates)} color="warning" />
        <StatCard icon={Bell} label={t('smart_nudges.stats.opted_out')} value={String(stats.opted_out_members)} color="default" />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-accent" />
          <h2 className="text-base font-semibold">{t('smart_nudges.chart.title')}</h2>
        </CardHeader>
        <Separator />
        <CardBody>
          <div className="w-full h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKEN_COLORS.border} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: CHART_TOKEN_COLORS.muted }} interval={3} />
                <YAxis tick={{ fontSize: 11, fill: CHART_TOKEN_COLORS.muted }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="sent" fill="#3b82f6" name={chartSeries.sent} />
                <Bar dataKey="converted" fill="#22c55e" name={chartSeries.converted} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      {/* Config */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-warning" />
          <h2 className="text-base font-semibold">{t('smart_nudges.config.title')}</h2>
        </CardHeader>
        <Separator />
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('smart_nudges.config.engine_enabled')}</p>
              <p className="text-xs text-muted">{t('smart_nudges.config.engine_description')}</p>
            </div>
            <Switch
              isSelected={config.enabled}
              onValueChange={(v) => setConfig({ ...config, enabled: v })}
              color="success"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label={t('smart_nudges.config.min_score')}
              type="number"
              min="0.40"
              max="0.95"
              step="0.05"
              value={String(config.min_score)}
              onValueChange={(v) =>
                setConfig({ ...config, min_score: Math.max(0.4, Math.min(0.95, parseFloat(v) || 0.55)) })
              }
              description={t('smart_nudges.config.min_score_description')}
            />
            <Input
              label={t('smart_nudges.config.cooldown_days')}
              type="number"
              min="1"
              max="90"
              step="1"
              value={String(config.cooldown_days)}
              onValueChange={(v) =>
                setConfig({ ...config, cooldown_days: Math.max(1, Math.min(90, parseInt(v, 10) || 14)) })
              }
              description={t('smart_nudges.config.cooldown_description')}
            />
            <Input
              label={t('smart_nudges.config.daily_limit')}
              type="number"
              min="1"
              max="250"
              step="1"
              value={String(config.daily_limit)}
              onValueChange={(v) =>
                setConfig({ ...config, daily_limit: Math.max(1, Math.min(250, parseInt(v, 10) || 25)) })
              }
              description={t('smart_nudges.config.daily_limit_description')}
            />
          </div>

          <div className="flex flex-col items-end gap-1">
            <Button
              startContent={<Save className="w-4 h-4" />}
              onPress={() => void handleSaveConfig()}
              isLoading={savingConfig}
            >
              {t('smart_nudges.actions.save_configuration')}
            </Button>
            <p className="text-xs text-muted">
              {t('smart_nudges.config.save_note')}
            </p>
          </div>
        </CardBody>
      </Card>

      {/* Dry-run result */}
      {dryResult && (
        <Card>
          <CardHeader className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold">{t('smart_nudges.dry_run.title')}</h2>
            <Chip size="sm" variant="soft" className="ml-auto">
              {t('smart_nudges.dry_run.candidates', { count: dryResult.candidates?.length ?? 0 })}
            </Chip>
          </CardHeader>
          <Separator />
          <CardBody>
            {!dryResult.candidates || dryResult.candidates.length === 0 ? (
              <p className="text-sm text-muted">{t('smart_nudges.dry_run.empty')}</p>
            ) : (
              <Table aria-label={t('smart_nudges.dry_run.table_aria')} removeWrapper>
                <TableHeader>
                  <TableColumn>{t('smart_nudges.table.target_user')}</TableColumn>
                  <TableColumn>{t('smart_nudges.table.suggested_partner')}</TableColumn>
                  <TableColumn align="end">{t('smart_nudges.table.score')}</TableColumn>
                </TableHeader>
                <TableBody>
                  {dryResult.candidates.map((c, i) => (
                    <TableRow key={`${c.target_user_id}-${c.related_user_id}-${i}`}>
                      <TableCell>#{c.target_user_id}</TableCell>
                      <TableCell>#{c.related_user_id}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.score.toFixed(3)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* Recent nudges */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-muted" />
          <h2 className="text-base font-semibold">{t('smart_nudges.recent.title')}</h2>
          <Chip size="sm" variant="soft" className="ml-auto">
            {data.recent.length}
          </Chip>
        </CardHeader>
        <Separator />
        <CardBody className="p-0">
          {data.recent.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted">{t('smart_nudges.recent.empty')}</div>
          ) : (
            <Table aria-label={t('smart_nudges.recent.table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('smart_nudges.table.sent')}</TableColumn>
                <TableColumn>{t('smart_nudges.table.target')}</TableColumn>
                <TableColumn>{t('smart_nudges.table.suggested_partner')}</TableColumn>
                <TableColumn align="end">{t('smart_nudges.table.score')}</TableColumn>
                <TableColumn>{t('smart_nudges.table.status')}</TableColumn>
              </TableHeader>
              <TableBody>
                {data.recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatAdminDate(r.sent_at)}</TableCell>
                    <TableCell>{r.target_user.name || `#${r.target_user.id}`}</TableCell>
                    <TableCell>{r.related_user.name || `#${r.related_user.id}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.score.toFixed(3)}</TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={r.status === 'converted' ? 'success' : 'default'}
                      >
                        {statusLabel(r.status)}
                      </Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Confirm dispatch modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>{t('smart_nudges.dispatch_modal.title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted">
              {t('smart_nudges.dispatch_modal.body_prefix')} <strong>{config.daily_limit}</strong>{' '}
              {t('smart_nudges.dispatch_modal.body_suffix')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose}>
              {t('smart_nudges.actions.cancel')}
            </Button>
            <Button onPress={() => void handleDispatch(false)} isLoading={running}>
              {t('smart_nudges.actions.dispatch')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
