import { formatPercentRatio, getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Select, SelectItem, Button, Chip, Spinner, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch, Tab, Tabs, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '@/components/ui';
import Bot from 'lucide-react/icons/bot';
import Brain from 'lucide-react/icons/brain';
import Info from 'lucide-react/icons/info';
import Zap from 'lucide-react/icons/zap';
import CheckCircle from 'lucide-react/icons/check-circle';
import XCircle from 'lucide-react/icons/x-circle';
import Clock from 'lucide-react/icons/clock';
import Activity from 'lucide-react/icons/activity';
import Play from 'lucide-react/icons/play';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentConfig {
  enabled: boolean;
  auto_apply_threshold: number;
  tandem_matching_enabled: boolean;
  nudge_dispatch_enabled: boolean;
  activity_summary_enabled: boolean;
  demand_forecast_enabled: boolean;
  help_routing_enabled: boolean;
  schedule_hour: number;
  max_proposals_per_run: number;
  notification_email: string | null;
}

interface AgentRun {
  id: number;
  tenant_id: number;
  agent_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  triggered_by: string;
  proposals_generated: number;
  proposals_applied: number;
  output_summary: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  proposals?: AgentProposal[];
}

interface AgentProposal {
  id: number;
  run_id: number;
  proposal_type: string;
  subject_user_id: number | null;
  target_user_id: number | null;
  proposal_data: Record<string, unknown>;
  status: 'pending_review' | 'approved' | 'auto_applied' | 'rejected' | 'expired';
  confidence_score: number | null;
  reviewer_id: number | null;
  reviewed_at: string | null;
  applied_at: string | null;
  expires_at: string | null;
  created_at: string;
  run_agent_type?: string;
}

interface AgentStats {
  total_runs: number;
  total_proposals: number;
  proposals_by_status: Record<string, number>;
  runs_last_30_days: Array<{ day: string; agent_type: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_TYPES = [
  'tandem_matching',
  'demand_forecast',
  'nudge_dispatch',
  'activity_summary',
  'help_routing',
  'member_welcome',
] as const;

type AgentType = (typeof AGENT_TYPES)[number];

function statusColor(status: string): 'success' | 'danger' | 'warning' | 'default' {
  switch (status) {
    case 'completed':
    case 'approved':
    case 'auto_applied':
      return 'success';
    case 'failed':
    case 'rejected':
    case 'expired':
      return 'danger';
    case 'running':
    case 'pending_review':
      return 'warning';
    case 'pending':
      return 'default';
    default:
      return 'default';
  }
}

function confidenceColor(score: number | null): 'success' | 'warning' | 'danger' {
  if (score === null) return 'warning';
  if (score >= 0.8) return 'success';
  if (score >= 0.5) return 'warning';
  return 'danger';
}

function fmtDate(s: string | null, empty: string): string {
  if (!s) return empty;
  return new Date(s).toLocaleString(getFormattingLocale());
}

function durationMs(run: AgentRun, empty: string): string {
  if (!run.started_at || !run.completed_at) return empty;
  const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
  if (ms < 1000) {
    return new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'millisecond', unitDisplay: 'short' }).format(ms);
  }
  if (ms < 60000) {
    return new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(ms / 1000);
  }
  return new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(Math.round(ms / 60000));
}

const proposalFilters = ['pending_review', 'approved', 'auto_applied', 'rejected', 'expired', ''] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KiAgentAdminPage() {
  const { t } = useTranslation('admin_ai');
  usePageTitle(t('ai.ki_agents.meta.title'));
  const toast = useToast();

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [configDirty, setConfigDirty] = useState<Partial<AgentConfig>>({});
  const [savingConfig, setSavingConfig] = useState(false);

  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingProposals, setLoadingProposals] = useState(false);

  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [runModalOpen, setRunModalOpen] = useState(false);

  const [triggerType, setTriggerType] = useState<AgentType>('tandem_matching');
  const [triggering, setTriggering] = useState(false);

  const [proposalFilter, setProposalFilter] = useState('pending_review');
  const [approvingAll, setApprovingAll] = useState(false);

  // -------------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------------

  const fetchConfig = useCallback(async () => {
    try {
      const res = await api.get<AgentConfig>('/v2/admin/ki-agents/config');
      setConfig(res.data ?? null);
    } catch {
      toast.error(t('ai.ki_agents.toasts.config_load_failed'));
    }
  }, [t, toast]);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await api.get<AgentRun[]>('/v2/admin/ki-agents/runs?limit=50');
      setRuns(res.data ?? []);
    } catch {
      toast.error(t('ai.ki_agents.toasts.runs_load_failed'));
    } finally {
      setLoadingRuns(false);
    }
  }, [t, toast]);

  const fetchProposals = useCallback(async () => {
    setLoadingProposals(true);
    try {
      const url = proposalFilter
        ? `/v2/admin/ki-agents/proposals?status=${proposalFilter}&limit=100`
        : '/v2/admin/ki-agents/proposals?limit=100';
      const res = await api.get<AgentProposal[]>(url);
      setProposals(res.data ?? []);
    } catch {
      toast.error(t('ai.ki_agents.toasts.proposals_load_failed'));
    } finally {
      setLoadingProposals(false);
    }
  }, [proposalFilter, t, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get<AgentStats>('/v2/admin/ki-agents/stats');
      setStats(res.data ?? null);
    } catch {
      // Non-critical — stats may not be available
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
    void fetchRuns();
    void fetchProposals();
    void fetchStats();
  }, [fetchConfig, fetchRuns, fetchProposals, fetchStats]);

  useEffect(() => {
    void fetchProposals();
  }, [proposalFilter, fetchProposals]);

  // -------------------------------------------------------------------------
  // Config handlers
  // -------------------------------------------------------------------------

  const mergedConfig = config ? { ...config, ...configDirty } : null;

  function patchConfig<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    setConfigDirty((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveConfig() {
    if (!mergedConfig) return;
    setSavingConfig(true);
    try {
      const res = await api.put<AgentConfig>('/v2/admin/ki-agents/config', mergedConfig);
      setConfig(res.data ?? null);
      setConfigDirty({});
      toast.success(t('ai.ki_agents.toasts.config_saved'));
    } catch {
      toast.error(t('ai.ki_agents.toasts.config_save_failed'));
    } finally {
      setSavingConfig(false);
    }
  }

  // -------------------------------------------------------------------------
  // Run handlers
  // -------------------------------------------------------------------------

  async function handleTriggerRun() {
    setTriggering(true);
    try {
      const res = await api.post<AgentRun>('/v2/admin/ki-agents/trigger', { agent_type: triggerType });
      toast.success(t('ai.ki_agents.toasts.run_triggered', { count: res.data?.proposals_generated ?? 0 }));
      void fetchRuns();
      void fetchProposals();
      void fetchStats();
    } catch {
      toast.error(t('ai.ki_agents.toasts.run_trigger_failed'));
    } finally {
      setTriggering(false);
    }
  }

  async function handleOpenRunDetail(runId: number) {
    try {
      const res = await api.get<AgentRun>(`/v2/admin/ki-agents/runs/${runId}`);
      setSelectedRun(res.data ?? null);
      setRunModalOpen(true);
    } catch {
      toast.error(t('ai.ki_agents.toasts.run_details_load_failed'));
    }
  }

  // -------------------------------------------------------------------------
  // Proposal handlers
  // -------------------------------------------------------------------------

  async function handleApprove(id: number) {
    try {
      const res = await api.post(`/v2/admin/ki-agents/proposals/${id}/approve`, {});
      if (res.success) {
        toast.success(t('ai.ki_agents.toasts.proposal_approved'));
        void fetchProposals();
      } else {
        toast.error(t('ai.ki_agents.toasts.proposal_approve_failed'));
      }
    } catch {
      toast.error(t('ai.ki_agents.toasts.proposal_approve_failed'));
    }
  }

  async function handleReject(id: number) {
    try {
      const res = await api.post(`/v2/admin/ki-agents/proposals/${id}/reject`, {});
      if (res.success) {
        toast.success(t('ai.ki_agents.toasts.proposal_rejected'));
        void fetchProposals();
      } else {
        toast.error(t('ai.ki_agents.toasts.proposal_reject_failed'));
      }
    } catch {
      toast.error(t('ai.ki_agents.toasts.proposal_reject_failed'));
    }
  }

  async function handleApproveAllEligible() {
    setApprovingAll(true);
    try {
      const res = await api.post<{ approved: number; failed: number; threshold: number }>(
        '/v2/admin/ki-agents/proposals/approve-eligible',
        {},
      );
      toast.success(t('ai.ki_agents.toasts.approved_eligible', {
        approved: res.data?.approved ?? 0,
        failed: res.data?.failed ?? 0,
        threshold: ((res.data?.threshold ?? 0) * 100).toFixed(0),
      }));
      void fetchProposals();
      void fetchStats();
    } catch {
      toast.error(t('ai.ki_agents.toasts.approve_eligible_failed'));
    } finally {
      setApprovingAll(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const pendingCount = proposals.filter((p) => p.status === 'pending_review').length;
  const empty = t('ai.common.empty_dash');
  const translatedIdentifier = (key: string) => {
    const label = t(key);
    return label === key ? t('ai.ki_agents.unknown_identifier') : label;
  };
  const agentTypeText = (value: string) => translatedIdentifier(`ai.ki_agents.agent_types.${value}`);
  const statusText = (value: string) => translatedIdentifier(`ai.ki_agents.status.${value}`);
  const triggeredByText = (value: string) => translatedIdentifier(`ai.ki_agents.triggered_by.${value}`);
  const proposalTypeText = (value: string) => translatedIdentifier(`ai.ki_agents.proposal_types.${value}`);

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Brain size={28} className="text-accent" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">{t('ai.ki_agents.meta.title')}</h1>
          <p className="text-sm text-muted">
            {t('ai.ki_agents.meta.description')}
          </p>
        </div>
        {stats && (
          <div className="ml-auto flex gap-4 text-sm">
            <span className="text-muted">
              <strong>{stats.total_runs}</strong> {t('ai.ki_agents.stats.total_runs')}
            </span>
            <span className="text-muted">
              <strong>{stats.total_proposals}</strong> {t('ai.ki_agents.stats.total_proposals')}
            </span>
            {pendingCount > 0 && (
              <Chip color="warning" size="sm" startContent={<Clock size={12} />}>
                {t('ai.ki_agents.stats.pending_review', { count: pendingCount })}
              </Chip>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border-l-4 border-l-accent bg-accent-soft px-4 py-3 dark:bg-accent-soft">
        <div className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-accent dark:text-accent">{t('ai.ki_agents.about.title')}</p>
            <p className="text-muted">
              {t('ai.ki_agents.about.body')}
            </p>
            <p className="text-muted">
              <strong>{t('ai.ki_agents.agent_types.tandem_matching')}</strong> - {t('ai.ki_agents.about.tandem_prefix')} {t('common:nav.caring_community')}{t('ai.ki_agents.about.tandem_suffix')}{' '}
              <strong>{t('ai.ki_agents.agent_types.nudge_dispatch')}</strong> - {t('ai.ki_agents.about.nudge')}{' '}
              <strong>{t('ai.ki_agents.agent_types.demand_forecast')}</strong> - {t('ai.ki_agents.about.demand')}{' '}
              <strong>{t('ai.ki_agents.agent_types.help_routing')}</strong> - {t('ai.ki_agents.about.help')}{' '}
              <strong>{t('ai.ki_agents.agent_types.activity_summary')}</strong> - {t('ai.ki_agents.about.activity')}
            </p>
          </div>
        </div>
      </div>

      <Tabs aria-label={t('ai.ki_agents.tabs.aria')} variant="underlined">
        {/* ================================================================ */}
        {/* CONFIG TAB                                                        */}
        {/* ================================================================ */}
        <Tab
          key="config"
          title={
            <div className="flex items-center gap-2">
              <Zap size={16} aria-hidden="true" />
              <span>{t('ai.ki_agents.tabs.config')}</span>
            </div>
          }
        >
          {mergedConfig ? (
            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Master switch */}
              <div className="col-span-full flex items-center justify-between rounded-xl border border-border p-4">
                <div>
                  <p className="font-semibold">{t('ai.ki_agents.config.enable_title')}</p>
                  <p className="text-sm text-muted">
                    {t('ai.ki_agents.config.enable_description')}
                  </p>
                </div>
                <Switch
                  isSelected={mergedConfig.enabled}
                  onValueChange={(v) => patchConfig('enabled', v)}
                  color="success"
                />
              </div>

              {/* Agent toggles */}
              <div className="space-y-4 rounded-xl border border-border p-4">
                <p className="text-sm font-semibold text-foreground">{t('ai.ki_agents.config.agent_types_title')}</p>
                {(
                  [
                    ['tandem_matching_enabled', t('ai.ki_agents.agent_types.tandem_matching'), <>{t('common:nav.caring_community')}{t('ai.ki_agents.config.tandem_description')}</>],
                    ['nudge_dispatch_enabled', t('ai.ki_agents.agent_types.nudge_dispatch'), t('ai.ki_agents.config.nudge_description')],
                    ['activity_summary_enabled', t('ai.ki_agents.agent_types.activity_summary'), t('ai.ki_agents.config.activity_description')],
                    ['demand_forecast_enabled', t('ai.ki_agents.agent_types.demand_forecast'), t('ai.ki_agents.config.demand_description')],
                    ['help_routing_enabled', t('ai.ki_agents.agent_types.help_routing'), t('ai.ki_agents.config.help_description')],
                  ] as [keyof AgentConfig, string, React.ReactNode][]
                ).map(([key, label, desc]) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted">{desc}</p>
                    </div>
                    <Switch
                      size="sm"
                      isSelected={!!mergedConfig[key]}
                      onValueChange={(v) => patchConfig(key, v as AgentConfig[typeof key])}
                      isDisabled={!mergedConfig.enabled}
                    />
                  </div>
                ))}
              </div>

              {/* Thresholds */}
              <div className="space-y-5 rounded-xl border border-border p-4">
                <p className="text-sm font-semibold text-foreground">{t('ai.ki_agents.config.thresholds_title')}</p>

                <div>
                  <p className="text-sm mb-2">
                    {t('ai.ki_agents.config.auto_apply_threshold')}{' '}
                    <strong>{formatPercentRatio(mergedConfig.auto_apply_threshold, { maximumFractionDigits: 0 })}</strong>
                  </p>
                  <Slider
                    minValue={0}
                    maxValue={1}
                    step={0.01}
                    value={mergedConfig.auto_apply_threshold}
                    onChange={(v) =>
                      patchConfig('auto_apply_threshold', typeof v === 'number' ? v : (v[0] ?? 0))
                    }
                    aria-label={t('ai.ki_agents.config.auto_apply_threshold_aria')}
                    color="success"
                  />
                  <p className="mt-1 text-xs text-muted">
                    {t('ai.ki_agents.config.auto_apply_threshold_help')}
                  </p>
                </div>

                <Input
                  label={t('ai.ki_agents.config.max_proposals')}
                  type="number"
                  value={String(mergedConfig.max_proposals_per_run)}
                  onValueChange={(v) => patchConfig('max_proposals_per_run', parseInt(v, 10) || 50)}
                  variant="secondary"
                  size="sm"
                  min={1}
                  max={500}
                />

                <Input
                  label={t('ai.ki_agents.config.schedule_hour')}
                  type="number"
                  value={String(mergedConfig.schedule_hour)}
                  onValueChange={(v) => patchConfig('schedule_hour', parseInt(v, 10) || 2)}
                  variant="secondary"
                  size="sm"
                  min={0}
                  max={23}
                />

                <Input
                  label={t('ai.ki_agents.config.notification_email')}
                  type="email"
                  value={mergedConfig.notification_email ?? ''}
                  onValueChange={(v) => patchConfig('notification_email', v || null)}
                  placeholder={t('ai.ki_agents.config.notification_email_placeholder')}
                  variant="secondary"
                  size="sm"
                />
              </div>

              {/* Save */}
              <div className="col-span-full flex justify-end">
                <Button
                  onPress={handleSaveConfig}
                  isLoading={savingConfig}
                  startContent={<CheckCircle size={16} />}
                >
                  {t('ai.ki_agents.actions.save_config')}
                </Button>
              </div>
            </div>
          ) : (
            <Card className="mt-4 border border-border">
              <CardBody className="flex flex-row items-center gap-3 text-sm text-muted" role="status" aria-busy="true" aria-label={t('ai.ki_agents.empty.loading_config')}>
                <Spinner size="sm" />
                {t('ai.ki_agents.empty.loading_config')}
              </CardBody>
            </Card>
          )}
        </Tab>

        {/* ================================================================ */}
        {/* PROPOSALS TAB                                                     */}
        {/* ================================================================ */}
        <Tab
          key="proposals"
          title={
            <div className="flex items-center gap-2">
              <Activity size={16} aria-hidden="true" />
              <span>
                {t('ai.ki_agents.tabs.proposals')}{pendingCount > 0 && ` (${pendingCount})`}
              </span>
            </div>
          }
        >
          <div className="mt-4 space-y-4">
            {/* Filter + Approve All */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-2">
                {proposalFilters.map(
                  (s) => (
                    <Chip
                      key={s || 'all'}
                      color={proposalFilter === s ? 'accent' : 'default'}
                      variant="soft"
                      className="cursor-pointer"
                      onClick={() => setProposalFilter(s)}
                    >
                      {s ? statusText(s) : t('ai.ki_agents.status.all')}
                    </Chip>
                  ),
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Button
                  color="success"
                  size="sm"
                  startContent={<Zap size={14} />}
                  onPress={handleApproveAllEligible}
                  isLoading={approvingAll}
                >
                  {t('ai.ki_agents.actions.approve_all_eligible')}
                </Button>
                <p className="text-xs text-muted">
                  {t('ai.ki_agents.proposals.approve_all_help')}
                </p>
              </div>
            </div>

            {/* Status + confidence legend */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-muted">
              <span className="font-medium text-foreground">{t('ai.ki_agents.legend.status')}</span>
              <span><Chip size="sm" color="warning" variant="soft" className="mr-1">{statusText('pending_review')}</Chip>{t('ai.ki_agents.legend.awaiting_decision')}</span>
              <span><Chip size="sm" color="success" variant="soft" className="mr-1">{statusText('approved')}</Chip>{t('ai.ki_agents.legend.human_approved')}</span>
              <span><Chip size="sm" color="success" variant="soft" className="mr-1">{statusText('auto_applied')}</Chip>{t('ai.ki_agents.legend.auto_applied')}</span>
              <span><Chip size="sm" color="danger" variant="soft" className="mr-1">{statusText('rejected')}</Chip>{t('ai.ki_agents.legend.rejected')}</span>
              <span className="ml-2 font-medium text-foreground">{t('ai.ki_agents.legend.confidence')}</span>
              <span className="text-success-soft-foreground">{t('ai.ki_agents.legend.confidence_high')}</span>
              <span className="text-warning-soft-foreground">{t('ai.ki_agents.legend.confidence_medium')}</span>
              <span className="text-danger-soft-foreground">{t('ai.ki_agents.legend.confidence_low')}</span>
            </div>

            <Table
              aria-label={t('ai.ki_agents.proposals.table_aria')}
              isStriped
              removeWrapper
            >
              <TableHeader>
                <TableColumn>{t('ai.ki_agents.proposals.columns.type')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.proposals.columns.subject_user')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.proposals.columns.target_user')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.proposals.columns.confidence')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.proposals.columns.proposal_data')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.proposals.columns.status')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.proposals.columns.created')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.proposals.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={loadingProposals ? t('ai.ki_agents.empty.loading_proposals') : proposalFilter === 'pending_review' ? t('ai.ki_agents.empty.no_pending_proposals') : t('ai.ki_agents.empty.no_filtered_proposals')}>
                {proposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="text-xs">{proposalTypeText(p.proposal_type)}</span>
                    </TableCell>
                    <TableCell>{p.subject_user_id ?? empty}</TableCell>
                    <TableCell>{p.target_user_id ?? empty}</TableCell>
                    <TableCell>
                      {p.confidence_score !== null ? (
                        <Chip size="sm" color={confidenceColor(p.confidence_score)}>
                          {formatPercentRatio(p.confidence_score, { maximumFractionDigits: 0 })}
                        </Chip>
                      ) : (
                        empty
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[200px] text-xs text-muted line-clamp-2">
                        {JSON.stringify(p.proposal_data).slice(0, 120)}
                        {JSON.stringify(p.proposal_data).length > 120 ? '…' : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" color={statusColor(p.status)}>
                        {statusText(p.status)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{fmtDate(p.created_at, empty)}</span>
                    </TableCell>
                    <TableCell>
                      {p.status === 'pending_review' && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            isIconOnly
                            onPress={() => handleApprove(p.id)}
                            aria-label={t('ai.ki_agents.actions.approve')}
                          >
                            <CheckCircle size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            isIconOnly
                            onPress={() => handleReject(p.id)}
                            aria-label={t('ai.ki_agents.actions.reject')}
                          >
                            <XCircle size={14} />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Tab>

        {/* ================================================================ */}
        {/* RUNS TAB                                                          */}
        {/* ================================================================ */}
        <Tab
          key="runs"
          title={
            <div className="flex items-center gap-2">
              <BarChart3 size={16} aria-hidden="true" />
              <span>{t('ai.ki_agents.tabs.runs')}</span>
            </div>
          }
        >
          <div className="mt-4 space-y-4">
            {/* Trigger run */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
              <Bot size={20} className="text-accent" aria-hidden="true" />
              <p className="font-semibold text-sm">{t('ai.ki_agents.runs.trigger_title')}</p>
              <Select
                size="sm"
                className="w-full sm:w-56"
                selectedKeys={[triggerType]}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0];
                  if (next) {
                    setTriggerType(next as AgentType);
                  }
                }}
                aria-label={t('ai.ki_agents.runs.agent_type_aria')}
                label={t('ai.ki_agents.runs.agent_type_title')}
                labelPlacement="outside-left"
              >
                {AGENT_TYPES.map((t) => (
                  <SelectItem key={t} id={t}>
                    {agentTypeText(t)}
                  </SelectItem>
                ))}
              </Select>
              <Button
                size="sm"
                startContent={<Play size={14} />}
                onPress={handleTriggerRun}
                isLoading={triggering}
              >
                {t('ai.ki_agents.actions.trigger')}
              </Button>
            </div>

            <Table
              aria-label={t('ai.ki_agents.runs.table_aria')}
              isStriped
              removeWrapper
            >
              <TableHeader>
                <TableColumn>{t('ai.ki_agents.runs.columns.agent_type')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.runs.columns.status')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.runs.columns.proposals')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.runs.columns.applied')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.runs.columns.started')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.runs.columns.duration')}</TableColumn>
                <TableColumn title={t('ai.ki_agents.runs.triggered_by_help')}>{t('ai.ki_agents.runs.columns.triggered_by')}</TableColumn>
                <TableColumn>{t('ai.ki_agents.runs.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={loadingRuns ? t('ai.ki_agents.empty.loading_runs') : t('ai.ki_agents.empty.no_runs')}>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-medium">{agentTypeText(r.agent_type)}</span>
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" color={statusColor(r.status)}>
                        {statusText(r.status)}
                      </Chip>
                    </TableCell>
                    <TableCell>{r.proposals_generated}</TableCell>
                    <TableCell>{r.proposals_applied}</TableCell>
                    <TableCell>
                      <span className="text-xs">{fmtDate(r.started_at, empty)}</span>
                    </TableCell>
                    <TableCell>{durationMs(r, empty)}</TableCell>
                    <TableCell>
                      <span className="text-xs capitalize">{triggeredByText(r.triggered_by)}</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => handleOpenRunDetail(r.id)}
                      >
                        {t('ai.ki_agents.actions.details')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Tab>
      </Tabs>

      {/* ================================================================ */}
      {/* RUN DETAIL MODAL                                                  */}
      {/* ================================================================ */}
      <Modal
        isOpen={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <Bot size={18} aria-hidden="true" />
                {t('ai.ki_agents.run_detail.title', { id: selectedRun?.id ?? empty, type: selectedRun ? agentTypeText(selectedRun.agent_type) : '' })}
              </ModalHeader>
              <ModalBody>
                {selectedRun && (
                  <div className="space-y-4">
                    {/* Meta */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted">{t('ai.ki_agents.run_detail.status')} </span>
                        <Chip size="sm" color={statusColor(selectedRun.status)}>
                          {statusText(selectedRun.status)}
                        </Chip>
                      </div>
                      <div>
                        <span className="text-muted">{t('ai.ki_agents.run_detail.triggered_by')} </span>
                        <span className="capitalize">{triggeredByText(selectedRun.triggered_by)}</span>
                      </div>
                      <div>
                        <span className="text-muted">{t('ai.ki_agents.run_detail.started')} </span>
                        {fmtDate(selectedRun.started_at, empty)}
                      </div>
                      <div>
                        <span className="text-muted">{t('ai.ki_agents.run_detail.duration')} </span>
                        {durationMs(selectedRun, empty)}
                      </div>
                      <div>
                        <span className="text-muted">{t('ai.ki_agents.run_detail.proposals_generated')} </span>
                        {selectedRun.proposals_generated}
                      </div>
                      <div>
                        <span className="text-muted">{t('ai.ki_agents.run_detail.proposals_applied')} </span>
                        {selectedRun.proposals_applied}
                      </div>
                    </div>

                    {selectedRun.output_summary && (
                      <p className="rounded-lg bg-surface-secondary p-3 text-sm text-muted">
                        {selectedRun.output_summary}
                      </p>
                    )}

                    {selectedRun.error_message && (
                      <p className="text-sm text-danger bg-danger/10 rounded-lg p-3">
                        {selectedRun.error_message}
                      </p>
                    )}

                    {/* Proposals list */}
                    {selectedRun.proposals && selectedRun.proposals.length > 0 && (
                      <div>
                        <p className="font-semibold text-sm mb-2">
                          {t('ai.ki_agents.run_detail.proposals_count', { count: selectedRun.proposals.length })}
                        </p>
                        <Table aria-label={t('ai.ki_agents.run_detail.proposals_table_aria')} removeWrapper>
                          <TableHeader>
                            <TableColumn>{t('ai.ki_agents.proposals.columns.type')}</TableColumn>
                            <TableColumn>{t('ai.ki_agents.run_detail.columns.subject')}</TableColumn>
                            <TableColumn>{t('ai.ki_agents.proposals.columns.confidence')}</TableColumn>
                            <TableColumn>{t('ai.ki_agents.proposals.columns.status')}</TableColumn>
                          </TableHeader>
                          <TableBody>
                            {selectedRun.proposals.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell>
                                  <span className="text-xs">{proposalTypeText(p.proposal_type)}</span>
                                </TableCell>
                                <TableCell>{p.subject_user_id ?? empty}</TableCell>
                                <TableCell>
                                  {p.confidence_score !== null ? (
                                    <Chip size="sm" color={confidenceColor(p.confidence_score)}>
                                      {formatPercentRatio(p.confidence_score, { maximumFractionDigits: 0 })}
                                    </Chip>
                                  ) : (
                                    empty
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Chip size="sm" color={statusColor(p.status)}>
                                    {statusText(p.status)}
                                  </Chip>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('ai.common.close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
