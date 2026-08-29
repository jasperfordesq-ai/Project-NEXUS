import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Select, SelectItem, Switch, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';

import { Separator } from '@/components/ui';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Building2 from 'lucide-react/icons/building-2';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Clock from 'lucide-react/icons/clock';
import Copy from 'lucide-react/icons/copy';
import Download from 'lucide-react/icons/download';
import ExternalLink from 'lucide-react/icons/external-link';
import FileText from 'lucide-react/icons/file-text';
import Heart from 'lucide-react/icons/heart';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Pause from 'lucide-react/icons/pause';
import Printer from 'lucide-react/icons/printer';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';
import Search from 'lucide-react/icons/search';
import Sparkles from 'lucide-react/icons/sparkles';
import BrainCircuit from 'lucide-react/icons/brain-circuit';
import TrendingUp from 'lucide-react/icons/trending-up';
import TrendingDown from 'lucide-react/icons/trending-down';
import Minus from 'lucide-react/icons/minus';
import Info from 'lucide-react/icons/info';
import ShieldCheck from 'lucide-react/icons/shield-check';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';
import XCircle from 'lucide-react/icons/circle-x';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { formatPercentRatio, resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import CaregiverLinkReviewPanel from './CaregiverLinkReviewPanel';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type PendingReview = {
  id: number;
  member_name: string;
  organisation_name: string;
  opportunity_title: string;
  hours: number;
  date_logged: string;
  created_at: string;
  age_days: number;
  is_overdue: boolean;
  is_escalated: boolean;
  assigned_to: number | null;
  assigned_name: string | null;
  assigned_at: string | null;
  escalated_at: string | null;
  escalation_note: string | null;
};

type RecentDecision = {
  id: number;
  member_name: string;
  organisation_name: string;
  hours: number;
  status: 'approved' | 'declined';
  decided_at: string;
};

type WorkflowSummary = {
  stats: {
    pending_count: number;
    pending_hours: number;
    overdue_count: number;
    escalated_count: number;
    approved_30d_hours: number;
    declined_30d_count: number;
    coordinator_count: number;
  };
  pending_reviews: PendingReview[];
  recent_decisions: RecentDecision[];
  coordinator_signals: {
    active_requests: number;
    active_offers: number;
    trusted_organisations: number;
  };
  coordinators: Coordinator[];
  role_pack?: RolePack;
  policy?: WorkflowPolicy;
};

type Coordinator = {
  id: number;
  name: string;
  role: string;
};

type RolePack = {
  available: boolean;
  installed_count: number;
  total_count: number;
  presets: RolePresetStatus[];
};

type RolePresetStatus = {
  key: string;
  role_name: string;
  role_id: number | null;
  installed: boolean;
  permission_count: number;
  installed_permissions: number;
};

type WorkflowPolicy = {
  approval_required: boolean;
  auto_approve_trusted_reviewers: boolean;
  review_sla_days: number;
  escalation_sla_days: number;
  allow_member_self_log: boolean;
  require_organisation_for_partner_hours: boolean;
  monthly_statement_day: number;
  municipal_report_default_period: string;
  include_social_value_estimate: boolean;
  default_hour_value_chf: number;
};

type MemberStatement = {
  user: {
    id: number;
    name: string;
    email: string;
    current_balance: number;
  };
  period: {
    start: string;
    end: string;
    statement_day: number;
  };
  summary: {
    approved_support_hours: number;
    pending_support_hours: number;
    wallet_hours_earned: number;
    wallet_hours_spent: number;
    wallet_net_change: number;
    current_balance: number;
    estimated_social_value_chf: number;
  };
  support_hours_by_organisation: Array<{
    organisation_name: string;
    approved_hours: number;
    pending_hours: number;
    log_count: number;
  }>;
};

type MemberStatementCsv = {
  filename: string;
  csv: string;
  statement: MemberStatement;
};

type SupportRelationship = {
  id: number;
  supporter: { id: number; name: string };
  recipient: { id: number; name: string };
  coordinator: { id: number; name: string } | null;
  organization_name: string;
  category_name: string;
  title: string;
  description: string;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'ad_hoc';
  expected_hours: number;
  start_date: string;
  end_date: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  last_logged_at: string | null;
  next_check_in_at: string | null;
};

type SupportRelationshipList = {
  stats: {
    active_count: number;
    paused_count: number;
    check_ins_due: number;
    expected_active_hours: number;
  };
  items: SupportRelationship[];
};

type InviteCode = {
  id: number;
  code: string;
  label: string | null;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  status: 'active' | 'used' | 'expired';
  created_at: string;
  invite_url: string;
};

type GeneratedCode = {
  id: number;
  code: string;
  label: string | null;
  expires_at: string;
  invite_url: string;
};

type PaperOnboardingFields = {
  name?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
};

type PaperOnboardingIntake = {
  id: number;
  status: 'pending_review' | 'confirmed' | 'rejected';
  original_filename: string;
  extracted_fields: PaperOnboardingFields | null;
  corrected_fields: PaperOnboardingFields | null;
  ocr_provider: string;
  created_at: string;
};

type PaperOnboardingList = {
  count: number;
  items: PaperOnboardingIntake[];
};

const workflowStages = [
  { key: 'intake', icon: HeartHandshake },
  { key: 'match', icon: Users },
  { key: 'log', icon: Clock },
  { key: 'verify', icon: ClipboardCheck },
  { key: 'statement', icon: FileText },
] as const;

const rolePresets = [
  { key: 'national_admin', icon: ShieldCheck },
  { key: 'canton_admin', icon: Building2 },
  { key: 'municipality_admin', icon: Building2 },
  { key: 'cooperative_coordinator', icon: HeartHandshake },
  { key: 'organisation_coordinator', icon: Users },
  { key: 'trusted_reviewer', icon: ClipboardCheck },
] as const;

const reportPeriods = ['last_30_days', 'last_90_days', 'year_to_date', 'previous_quarter'] as const;
const relationshipFrequencies = ['weekly', 'fortnightly', 'monthly', 'ad_hoc'] as const;

type FavourItem = {
  id: number;
  category: string | null;
  description: string;
  favour_date: string;
  is_anonymous: boolean;
  offerer_name: string | null;
};

type FavoursData = { count: number; items: FavourItem[] };

type TandemSuggestionMember = {
  id: number;
  name: string;
  avatar_url: string;
  languages: string[];
  skills: string[];
};

type TandemSuggestion = {
  supporter: TandemSuggestionMember;
  recipient: TandemSuggestionMember;
  score: number;
  signals: {
    distance_km?: number;
    language_overlap?: number;
    skill_complement?: number;
    availability_overlap?: number;
    interest_overlap?: number;
  };
  reasons: Array<{
    code: string;
    params: Record<string, string | number>;
  }>;
};

type TandemSuggestionsResponse = {
  suggestions: TandemSuggestion[];
  generated_at: string;
};

type ForecastTrend = 'growing' | 'stable' | 'declining';
type ForecastConfidence = 'high' | 'medium' | 'low';

type ForecastSeries = {
  history: Array<{ month: string; hours: number }>;
  forecast: Array<{ month: string; hours: number; lower: number; upper: number }>;
  trend: ForecastTrend;
  growth_rate_pct: number;
  confidence: ForecastConfidence;
};

type ForecastAlert = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title_code: string;
  message_code: string;
  message_params: Record<string, string | number>;
  count: number;
  action_code: string | null;
  action_url: string | null;
};

type SubRegionDemandRow = {
  id: number;
  name: string;
  slug: string;
  requested_30d: number;
  fulfilled_30d: number;
  coverage_ratio_30d: number;
  requested_90d: number;
  fulfilled_90d: number;
  coverage_ratio_90d: number;
  flagged: boolean;
};

type SubRegionDemand = {
  window_days: { short: number; long: number };
  sub_regions: SubRegionDemandRow[];
  under_supplied_count: number;
};

type HelperChurnCategoryRow = {
  category_id: number | null;
  category_name: string;
  prior_active: number;
  lapsed: number;
  churn_rate: number;
};

type HelperChurn = {
  prior_window_days: { start: number; end: number };
  lapsed_threshold_days: number;
  overall: { prior_active: number; lapsed: number; churn_rate: number };
  by_category: HelperChurnCategoryRow[];
  lapsed_helper_ids: number[];
};

type CoefficientDriftRow = {
  category_id: number;
  category_name: string;
  baseline_coefficient: number;
  expected_session_hours: number;
  observed_session_hours: number;
  drift: number;
  flagged: boolean;
  sample_size: number;
};

type CoefficientDrift = {
  threshold: number;
  categories: CoefficientDriftRow[];
  drift_count: number;
};

type ForecastResponse = {
  hours: ForecastSeries;
  members: ForecastSeries;
  recipients: ForecastSeries;
  sub_region_demand?: SubRegionDemand;
  helper_churn?: HelperChurn;
  coefficient_drift?: CoefficientDrift;
  alerts: ForecastAlert[];
  generated_at: string;
};

function isForecastResponse(value: unknown): value is ForecastResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ForecastResponse>;
  return (
    typeof v.hours === 'object' && v.hours !== null && Array.isArray(v.hours.history) &&
    typeof v.members === 'object' && v.members !== null && Array.isArray(v.members.history) &&
    typeof v.recipients === 'object' && v.recipients !== null && Array.isArray(v.recipients.history) &&
    Array.isArray(v.alerts)
  );
}

function isTandemSuggestionsResponse(value: unknown): value is TandemSuggestionsResponse {
  return Boolean(value && typeof value === 'object' && 'suggestions' in value && Array.isArray((value as TandemSuggestionsResponse).suggestions));
}

function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  return Boolean(value && typeof value === 'object' && 'stats' in value && 'pending_reviews' in value);
}

function isSupportRelationshipList(value: unknown): value is SupportRelationshipList {
  return Boolean(value && typeof value === 'object' && 'stats' in value && 'items' in value);
}

type PredictiveInsightsCardProps = {
  forecast: ForecastResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  t: AdminT;
};

type AdminT = (key: string, options?: Record<string, unknown>) => string;

type ForecastChartPoint = {
  month: string;
  history: number | null;
  predicted: number | null;
  band: [number, number] | null;
};

function buildChartData(series: ForecastSeries): ForecastChartPoint[] {
  const points: ForecastChartPoint[] = series.history.map((h) => ({
    month: h.month,
    history: h.hours,
    predicted: null,
    band: null,
  }));

  // Bridge: last history point also feeds the predicted line so the series joins.
  const lastHistory = series.history[series.history.length - 1];
  const lastPoint = points[points.length - 1];
  if (lastHistory && lastPoint) {
    lastPoint.predicted = lastHistory.hours;
    lastPoint.band = [lastHistory.hours, lastHistory.hours];
  }

  for (const f of series.forecast) {
    points.push({
      month: f.month,
      history: null,
      predicted: f.hours,
      band: [f.lower, f.upper],
    });
  }
  return points;
}

function trendChip(series: ForecastSeries, t: AdminT): { label: string; color: 'success' | 'warning' | 'default'; icon: typeof TrendingUp } {
  if (series.trend === 'growing') {
    return { label: t('caring_workflow.predictive.trend_growing', { value: series.growth_rate_pct.toFixed(0) }), color: 'success', icon: TrendingUp };
  }
  if (series.trend === 'declining') {
    return { label: t('caring_workflow.predictive.trend_declining', { value: Math.abs(series.growth_rate_pct).toFixed(0) }), color: 'warning', icon: TrendingDown };
  }
  return { label: t('caring_workflow.predictive.trend_stable'), color: 'default', icon: Minus };
}

function ForecastMiniChart({ title, series, valueSuffix, t }: { title: string; series: ForecastSeries; valueSuffix: string; t: AdminT }): ReactNode {
  const data = buildChartData(series);
  const chip = trendChip(series, t);
  const ChipIcon = chip.icon;

  if (series.history.every((p) => p.hours === 0) && series.forecast.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-3 rounded-md bg-surface-secondary p-3 text-xs text-muted">
          {t('caring_workflow.predictive.not_enough_activity')}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <Chip size="sm" variant="soft" color={chip.color} startContent={<ChipIcon aria-hidden="true" size={14} />}>
          {chip.label}
        </Chip>
      </div>
      <div className="mt-3 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKEN_COLORS.border} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(value) => {
                if (value === null || value === undefined) return t('caring_workflow.empty.value');
                const num = typeof value === 'number' ? value : Number(value);
                return Number.isFinite(num) ? `${num.toFixed(1)} ${valueSuffix}`.trim() : t('caring_workflow.empty.value');
              }}
              labelStyle={{ fontSize: 12 }}
              contentStyle={{ fontSize: 12 }}
            />
            <Area
              type="monotone"
              dataKey="band"
              stroke="none"
              fill={CHART_TOKEN_COLORS.primary}
              fillOpacity={0.15}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="history"
              stroke={CHART_TOKEN_COLORS.primary}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls={false}
              isAnimationActive={false}
              name={t('caring_workflow.predictive.history')}
            />
            <Line
              type="monotone"
              dataKey="predicted"
              stroke={CHART_TOKEN_COLORS.primary}
              strokeDasharray="4 4"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
              isAnimationActive={false}
              name={t('caring_workflow.predictive.forecast')}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-[11px] text-muted">
        {t('caring_workflow.predictive.confidence')}:{' '}
        <span>{t(`caring_workflow.predictive.confidence_levels.${series.confidence}`)}</span>
      </div>
    </div>
  );
}

function alertSeverityChipColor(severity: ForecastAlert['severity']): 'danger' | 'warning' | 'accent' {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'accent';
}

function alertSeverityLabel(severity: ForecastAlert['severity'], t: AdminT): string {
  if (severity === 'critical') return t('caring_workflow.predictive.severity.critical');
  if (severity === 'warning') return t('caring_workflow.predictive.severity.warning');
  return t('caring_workflow.predictive.severity.info');
}

function alertMessageParams(alert: ForecastAlert): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(alert.message_params).map(([key, value]) => [
      key,
      typeof value === 'number' ? value.toLocaleString(getFormattingLocale()) : value,
    ]),
  );
}

function tandemReason(suggestion: TandemSuggestion, t: AdminT): string {
  const reasons = suggestion.reasons.map(({ code, params }) => {
    const localizedParams = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        typeof value === 'number'
          ? value.toLocaleString(getFormattingLocale(), { maximumFractionDigits: 1 })
          : value,
      ]),
    );
    return t(`caring_workflow.tandem.reasons.${code}`, localizedParams);
  });

  return reasons.reduce(
    (combined, reason) => combined
      ? t('caring_workflow.tandem.reason_join', { previous: combined, next: reason })
      : reason,
    '',
  );
}

function PredictiveInsightsCard({ forecast, loading, error, onRefresh, t }: PredictiveInsightsCardProps): ReactNode {
  const isInitialLoading = loading && !forecast;
  const hasAnyHistory = forecast
    ? [forecast.hours, forecast.members, forecast.recipients].some(
        (s) => s.history.some((h) => h.hours > 0) || s.forecast.length > 0,
      )
    : false;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BrainCircuit aria-hidden="true" size={18} className="text-accent" />
            {t('caring_workflow.predictive.title')}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {t('caring_workflow.predictive.subtitle')}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          startContent={<RefreshCw aria-hidden="true" size={16} />}
          isLoading={loading}
          onPress={onRefresh}
        >
          {t('caring_workflow.actions.refresh')}
        </Button>
      </CardHeader>
      <Separator />
      <CardBody className="gap-4">
        {isInitialLoading ? (
          <div className="flex items-center justify-center py-10">
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="md" /></div>
          </div>
        ) : error ? (
          <div className="rounded-lg bg-danger-50 p-4 text-sm text-danger-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="danger" startContent={<RefreshCw aria-hidden="true" size={14} />} onPress={onRefresh}>
              {t('caring_workflow.actions.retry')}
            </Button>
          </div>
        ) : !forecast ? (
          <div className="rounded-lg bg-surface-secondary p-4 text-sm text-muted">
            {t('caring_workflow.predictive.no_forecast')}
          </div>
        ) : !hasAnyHistory ? (
          <div className="rounded-lg bg-surface-secondary p-4 text-sm text-muted">
            {t('caring_workflow.predictive.not_enough_activity')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ForecastMiniChart title={t('caring_workflow.predictive.hours_forecast')} series={forecast.hours} valueSuffix="h" t={t} />
              <ForecastMiniChart title={t('caring_workflow.predictive.active_members')} series={forecast.members} valueSuffix="" t={t} />
              <ForecastMiniChart title={t('caring_workflow.predictive.recipients_reached')} series={forecast.recipients} valueSuffix="" t={t} />
            </div>
            {forecast.sub_region_demand && forecast.sub_region_demand.sub_regions.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Info aria-hidden="true" size={14} />
                  {t('caring_workflow.predictive.sub_region_coverage', {
                    days: forecast.sub_region_demand.window_days.long,
                  })}
                  {forecast.sub_region_demand.under_supplied_count > 0 && (
                    <Chip size="sm" variant="soft" color="warning">
                      {t('caring_workflow.predictive.under_supplied_count', {
                        count: forecast.sub_region_demand.under_supplied_count,
                      })}
                    </Chip>
                  )}
                </div>
                <Table aria-label={t('caring_workflow.predictive.sub_region_coverage_aria')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('caring_workflow.predictive.columns.sub_region')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.requested_90d')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.fulfilled_90d')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.coverage')}</TableColumn>
                    <TableColumn>{t('caring_workflow.predictive.columns.status')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {forecast.sub_region_demand.sub_regions.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.requested_90d.toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.fulfilled_90d.toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercentRatio(r.coverage_ratio_90d, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell>
                          <Chip size="sm" variant="soft" color={r.flagged ? 'warning' : 'default'}>
                            {r.flagged ? t('caring_workflow.predictive.status.under_supplied') : t('caring_workflow.predictive.status.ok')}
                          </Chip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {forecast.helper_churn && forecast.helper_churn.overall.prior_active > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Info aria-hidden="true" size={14} />
                  {t('caring_workflow.predictive.helper_churn', {
                    days: forecast.helper_churn.lapsed_threshold_days,
                  })}
                  <Chip
                    size="sm"
                    variant="soft"
                    color={forecast.helper_churn.overall.churn_rate > 0.3 ? 'warning' : 'default'}
                  >
                    {t('caring_workflow.predictive.overall_percent', {
                      value: (forecast.helper_churn.overall.churn_rate * 100).toFixed(0),
                    })}
                  </Chip>
                </div>
                <p className="text-xs text-muted">
                  {t('caring_workflow.predictive.helper_churn_note', {
                    lapsed: forecast.helper_churn.overall.lapsed,
                    prior: forecast.helper_churn.overall.prior_active,
                  })}
                </p>
                {forecast.helper_churn.by_category.length > 0 && (
                  <Table aria-label={t('caring_workflow.predictive.helper_churn_aria')} removeWrapper>
                    <TableHeader>
                      <TableColumn>{t('caring_workflow.predictive.columns.category')}</TableColumn>
                      <TableColumn align="end">{t('caring_workflow.predictive.columns.prior_active')}</TableColumn>
                      <TableColumn align="end">{t('caring_workflow.predictive.columns.lapsed')}</TableColumn>
                      <TableColumn align="end">{t('caring_workflow.predictive.columns.churn_rate')}</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {forecast.helper_churn.by_category.map((c) => (
                        <TableRow key={`${c.category_id ?? 'none'}-${c.category_name}`}>
                          <TableCell>{c.category_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.prior_active}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.lapsed}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercentRatio(c.churn_rate, { maximumFractionDigits: 0 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}

            {forecast.coefficient_drift && forecast.coefficient_drift.categories.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Info aria-hidden="true" size={14} />
                  {t('caring_workflow.predictive.coefficient_drift')}
                  {forecast.coefficient_drift.drift_count > 0 && (
                    <Chip size="sm" variant="soft" color="warning">
                      {t('caring_workflow.predictive.drifting_count', {
                        count: forecast.coefficient_drift.drift_count,
                      })}
                    </Chip>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {t('caring_workflow.predictive.coefficient_drift_note', {
                    threshold: (forecast.coefficient_drift.threshold * 100).toFixed(0),
                  })}
                </p>
                <Table aria-label={t('caring_workflow.predictive.coefficient_drift_aria')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('caring_workflow.predictive.columns.category')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.baseline')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.expected_hrs')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.observed_hrs')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.drift')}</TableColumn>
                    <TableColumn align="end">{t('caring_workflow.predictive.columns.sample')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {forecast.coefficient_drift.categories.map((c) => (
                      <TableRow key={c.category_id}>
                        <TableCell>{c.category_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.baseline_coefficient.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.expected_session_hours.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.observed_session_hours.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Chip size="sm" variant="soft" color={c.flagged ? 'warning' : 'default'}>
                            {formatPercentRatio(c.drift, { maximumFractionDigits: 0 })}
                          </Chip>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.sample_size}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {forecast.alerts.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Info aria-hidden="true" size={14} />
                  {t('caring_workflow.predictive.proactive_alerts')}
                </div>
                {forecast.alerts.map((alert) => (
                  <div key={alert.id} className="rounded-lg border border-border p-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip size="sm" variant="soft" color={alertSeverityChipColor(alert.severity)}>
                          {alertSeverityLabel(alert.severity, t)}
                        </Chip>
                        <span className="text-sm font-semibold text-foreground">
                          {t(`caring_workflow.predictive.alerts.${alert.title_code}.title`)}
                        </span>
                        <Chip size="sm" variant="soft" color="default">
                          {alert.count.toLocaleString(getFormattingLocale())}
                        </Chip>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {t(
                          `caring_workflow.predictive.alerts.${alert.message_code}.message`,
                          alertMessageParams(alert),
                        )}
                      </p>
                    </div>
                    {alert.action_url && alert.action_code && (
                      <Button
                        as={Link}
                        size="sm"
                        variant={alert.severity === 'critical' ? 'danger' : 'secondary'}
                        to={alert.action_url}
                      >
                        {t(`caring_workflow.predictive.alert_actions.${alert.action_code}`)}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

const formatHours = (value: number) => `${Number(value.toFixed(1))} h`;

export default function CaringCommunityWorkflowPage() {
  const { t } = useTranslation('admin_caring_community');
  const { tenantPath } = useTenant();
  const toast = useToast();
  usePageTitle(t('caring_workflow.meta.page_title'));

  const [summary, setSummary] = useState<WorkflowSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [installingRoles, setInstallingRoles] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [assigningReviewId, setAssigningReviewId] = useState<number | null>(null);
  const [escalatingReviewId, setEscalatingReviewId] = useState<number | null>(null);
  const [decidingReviewId, setDecidingReviewId] = useState<number | null>(null);
  const [statementMemberId, setStatementMemberId] = useState('');
  const [statementStartDate, setStatementStartDate] = useState('');
  const [statementEndDate, setStatementEndDate] = useState('');
  const [memberStatement, setMemberStatement] = useState<MemberStatement | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [relationships, setRelationships] = useState<SupportRelationshipList | null>(null);
  const [loadingRelationships, setLoadingRelationships] = useState(false);
  const [savingRelationship, setSavingRelationship] = useState(false);
  const [relationshipSupporterId, setRelationshipSupporterId] = useState('');
  const [relationshipRecipientId, setRelationshipRecipientId] = useState('');
  const [relationshipSupporter, setRelationshipSupporter] = useState<MemberSearchMember | null>(null);
  const [relationshipRecipient, setRelationshipRecipient] = useState<MemberSearchMember | null>(null);
  const [relationshipTitle, setRelationshipTitle] = useState('');
  const [relationshipFrequency, setRelationshipFrequency] = useState<SupportRelationship['frequency']>('weekly');
  const [relationshipExpectedHours, setRelationshipExpectedHours] = useState('1');
  const [relationshipStartDate, setRelationshipStartDate] = useState('');
  const [updatingRelationshipId, setUpdatingRelationshipId] = useState<number | null>(null);
  const [loggingRelationshipId, setLoggingRelationshipId] = useState<number | null>(null);
  const [relationshipLogDate, setRelationshipLogDate] = useState('');
  const [relationshipLogHours, setRelationshipLogHours] = useState('');
  const [relationshipLogDescription, setRelationshipLogDescription] = useState('');

  // Invite code state
  const [inviteLabel, setInviteLabel] = useState('');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<GeneratedCode | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [loadingInviteCodes, setLoadingInviteCodes] = useState(false);
  const [printCodeId, setPrintCodeId] = useState<number | null>(null);

  // Informal favours state
  const [favoursData, setFavoursData] = useState<FavoursData | null>(null);
  const [loadingFavours, setLoadingFavours] = useState(false);

  // Tandem suggestions state (admin English-only)
  const [tandemSuggestions, setTandemSuggestions] = useState<TandemSuggestion[]>([]);
  const [loadingTandems, setLoadingTandems] = useState(false);
  const [tandemError, setTandemError] = useState<string | null>(null);
  const [dismissingTandemKey, setDismissingTandemKey] = useState<string | null>(null);

  // Predictive insights state (admin English-only) — Tom Debus AI/Daten pillar
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Safeguarding reports dashboard state (admin English-only) — K9
  type SafeguardingDashboardSummary = {
    total: number;
    open_total: number;
    open_by_severity: { critical: number; high: number; medium: number; low: number };
    by_status: Record<string, number>;
    overdue: number;
    recent: Array<{
      id: number;
      reporter_name: string;
      subject_user_name: string | null;
      subject_organisation_id: number | null;
      category: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      status: 'submitted' | 'triaged' | 'investigating' | 'resolved' | 'dismissed';
      is_overdue: boolean;
      created_at: string;
    }>;
  };
  const [safeguardingSummary, setSafeguardingSummary] = useState<SafeguardingDashboardSummary | null>(null);
  const [loadingSafeguarding, setLoadingSafeguarding] = useState(false);

  // Assisted onboarding state
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingEmail, setOnboardingEmail] = useState('');
  const [onboardingPhone, setOnboardingPhone] = useState('');
  const [onboardingNote, setOnboardingNote] = useState('');
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingResult, setOnboardingResult] = useState<{ user: { id: number; name: string; email: string }; temp_password: string } | null>(null);
  const [onboardingCopied, setOnboardingCopied] = useState(false);
  const [paperIntakes, setPaperIntakes] = useState<PaperOnboardingIntake[]>([]);
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperUploading, setPaperUploading] = useState(false);
  const [paperLoading, setPaperLoading] = useState(false);
  const [paperReviewingId, setPaperReviewingId] = useState<number | null>(null);
  const [paperName, setPaperName] = useState('');
  const [paperDateOfBirth, setPaperDateOfBirth] = useState('');
  const [paperAddress, setPaperAddress] = useState('');
  const [paperPhone, setPaperPhone] = useState('');
  const [paperEmail, setPaperEmail] = useState('');
  const [paperNote, setPaperNote] = useState('');

  const loadWorkflow = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<WorkflowSummary>('/v2/admin/caring-community/workflow');
      if (isWorkflowSummary(res.data)) setSummary(res.data);
    } catch {
      toast.error(t('caring_workflow.toast.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  const loadSupportRelationships = useCallback(async () => {
    setLoadingRelationships(true);
    try {
      const res = await api.get<SupportRelationshipList>('/v2/admin/caring-community/support-relationships?status=all');
      if (isSupportRelationshipList(res.data)) setRelationships(res.data);
    } catch {
      toast.error(t('caring_workflow.relationships.load_failed'));
    } finally {
      setLoadingRelationships(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadSupportRelationships();
  }, [loadSupportRelationships]);

  const loadForecast = useCallback(async () => {
    setLoadingForecast(true);
    setForecastError(null);
    try {
      const res = await api.get<ForecastResponse>('/v2/admin/caring-community/forecast');
      if (isForecastResponse(res.data)) {
        setForecast(res.data);
      } else {
        setForecast(null);
        setForecastError(t('caring_workflow.predictive.load_failed'));
      }
    } catch {
      setForecastError(t('caring_workflow.predictive.load_failed'));
    } finally {
      setLoadingForecast(false);
    }
  }, [t]);

  useEffect(() => {
    loadForecast();
  }, [loadForecast]);

  const loadSafeguardingSummary = useCallback(async () => {
    setLoadingSafeguarding(true);
    try {
      const res = await api.get<SafeguardingDashboardSummary>('/v2/admin/caring-community/safeguarding/dashboard');
      if (res.success && res.data) {
        setSafeguardingSummary(res.data);
      } else {
        setSafeguardingSummary(null);
      }
    } catch {
      setSafeguardingSummary(null);
    } finally {
      setLoadingSafeguarding(false);
    }
  }, []);

  useEffect(() => {
    loadSafeguardingSummary();
  }, [loadSafeguardingSummary]);

  const loadPaperIntakes = useCallback(async () => {
    setPaperLoading(true);
    try {
      const res = await api.get<PaperOnboardingList>('/v2/admin/caring-community/paper-onboarding?status=pending_review');
      if (res.data && Array.isArray(res.data.items)) {
        setPaperIntakes(res.data.items);
      }
    } catch {
      toast.error(t('caring_workflow.paper_onboarding.load_failed'));
    } finally {
      setPaperLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadPaperIntakes();
  }, [loadPaperIntakes]);

  const loadTandemSuggestions = useCallback(async () => {
    setLoadingTandems(true);
    setTandemError(null);
    try {
      const res = await api.get<TandemSuggestionsResponse>('/v2/admin/caring-community/tandem-suggestions?limit=20');
      if (isTandemSuggestionsResponse(res.data)) {
        setTandemSuggestions(res.data.suggestions);
      } else {
        setTandemSuggestions([]);
      }
    } catch {
      setTandemError(t('caring_workflow.tandem.load_failed'));
    } finally {
      setLoadingTandems(false);
    }
  }, [t]);

  useEffect(() => {
    loadTandemSuggestions();
  }, [loadTandemSuggestions]);

  const dismissTandemSuggestion = useCallback(async (suggestion: TandemSuggestion) => {
    const key = `${suggestion.supporter.id}:${suggestion.recipient.id}`;
    setDismissingTandemKey(key);
    try {
      await api.post('/v2/admin/caring-community/tandem-suggestions/dismiss', {
        supporter_id: suggestion.supporter.id,
        recipient_id: suggestion.recipient.id,
      });
      setTandemSuggestions((prev) => prev.filter((s) => `${s.supporter.id}:${s.recipient.id}` !== key));
      toast.success(t('caring_workflow.tandem.dismiss_success'));
    } catch {
      toast.error(t('caring_workflow.tandem.dismiss_failed'));
    } finally {
      setDismissingTandemKey(null);
    }
  }, [t, toast]);

  const createTandemFromSuggestion = useCallback((suggestion: TandemSuggestion) => {
    const supporter: MemberSearchMember = {
      id: suggestion.supporter.id,
      name: suggestion.supporter.name,
      email: '',
      avatar_url: suggestion.supporter.avatar_url || null,
    };
    const recipient: MemberSearchMember = {
      id: suggestion.recipient.id,
      name: suggestion.recipient.name,
      email: '',
      avatar_url: suggestion.recipient.avatar_url || null,
    };
    setRelationshipSupporterId(String(suggestion.supporter.id));
    setRelationshipRecipientId(String(suggestion.recipient.id));
    setRelationshipSupporter(supporter);
    setRelationshipRecipient(recipient);
    setRelationshipTitle(t('caring_workflow.tandem.relationship_title', {
      supporter: suggestion.supporter.name,
      recipient: suggestion.recipient.name,
    }));
    // Scroll to the support-relationships create form so the coordinator sees it.
    if (typeof window !== 'undefined') {
      const target = document.getElementById('caring-support-relationship-form');
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [t]);

  useEffect(() => {
    setLoadingFavours(true);
    api.get<FavoursData>('/v2/admin/caring-community/favours')
      .then((res) => {
        if (res.data && typeof res.data === 'object' && 'count' in res.data) {
          setFavoursData(res.data);
        }
      })
      .catch(() => { /* non-critical — silently ignore */ })
      .finally(() => setLoadingFavours(false));
  }, []);

  const stats = summary?.stats;
  const signals = summary?.coordinator_signals;
  const rolePack = summary?.role_pack;
  const formatChf = (value: number) => t('caring_workflow.member_statement.chf_value', {
    value: value.toLocaleString(getFormattingLocale(), { maximumFractionDigits: 0 }),
  });

  const roleCountLabel = useMemo(() => (
    rolePack
      ? t('caring_workflow.role_pack.installed_count', { installed: rolePack.installed_count, total: rolePack.total_count })
      : t('caring_workflow.role_pack.available_count', { count: rolePresets.length })
  ), [rolePack, t]);

  const roleStatusByKey = useMemo(() => {
    const statuses = rolePack?.presets ?? [];
    return new Map(statuses.map((status) => [status.key, status]));
  }, [rolePack]);
  const coordinatorOptions = useMemo(() => [
    { id: 'unassigned', label: t('caring_workflow.empty.unassigned') },
    ...(summary?.coordinators ?? []).map((coordinator) => ({ id: String(coordinator.id), label: coordinator.name })),
  ], [summary?.coordinators, t]);
  const frequencyOptions = useMemo(() => relationshipFrequencies.map((frequency) => ({
    id: frequency,
    label: t(`caring_workflow.relationships.frequency.${frequency}`),
  })), [t]);

  const replaceReview = useCallback((review: PendingReview) => {
    setSummary((current) => {
      if (!current) return current;
      return {
        ...current,
        pending_reviews: current.pending_reviews.map((item) => item.id === review.id ? review : item),
      };
    });
  }, []);

  const updatePolicyField = useCallback(<K extends keyof WorkflowPolicy>(key: K, value: WorkflowPolicy[K]) => {
    setSummary((current) => {
      if (!current?.policy) return current;
      return { ...current, policy: { ...current.policy, [key]: value } };
    });
  }, []);

  const installRolePack = useCallback(async () => {
    setInstallingRoles(true);
    try {
      const res = await api.post<RolePack>('/v2/admin/caring-community/role-presets/install', {});
      setSummary((current) => current ? { ...current, role_pack: res.data } : current);
      toast.success(t('caring_workflow.role_pack.install_success'));
    } catch {
      toast.error(t('caring_workflow.role_pack.install_failed'));
    } finally {
      setInstallingRoles(false);
    }
  }, [t, toast]);

  const savePolicy = useCallback(async () => {
    if (!summary?.policy) return;

    setSavingPolicy(true);
    try {
      const res = await api.put<WorkflowPolicy>('/v2/admin/caring-community/workflow/policy', summary.policy);
      setSummary((current) => current ? { ...current, policy: res.data } : current);
      toast.success(t('caring_workflow.policy.save_success'));
    } catch {
      toast.error(t('caring_workflow.policy.save_failed'));
    } finally {
      setSavingPolicy(false);
    }
  }, [summary?.policy, t, toast]);

  const assignReview = useCallback(async (reviewId: number, assignedTo: number | null) => {
    setAssigningReviewId(reviewId);
    try {
      const res = await api.put<{ review: PendingReview }>(`/v2/admin/caring-community/workflow/reviews/${reviewId}/assign`, {
        assigned_to: assignedTo,
      });
      if (res.data?.review) replaceReview(res.data.review);
      toast.success(t('caring_workflow.pending.assign_success'));
    } catch {
      toast.error(t('caring_workflow.pending.assign_failed'));
    } finally {
      setAssigningReviewId(null);
    }
  }, [replaceReview, t, toast]);

  const escalateReview = useCallback(async (review: PendingReview) => {
    setEscalatingReviewId(review.id);
    try {
      const res = await api.put<{ review: PendingReview }>(`/v2/admin/caring-community/workflow/reviews/${review.id}/escalate`, {
        note: t('caring_workflow.pending.manual_escalation_note', { count: review.age_days }),
      });
      if (res.data?.review) replaceReview(res.data.review);
      toast.success(t('caring_workflow.pending.escalate_success'));
    } catch {
      toast.error(t('caring_workflow.pending.escalate_failed'));
    } finally {
      setEscalatingReviewId(null);
    }
  }, [replaceReview, t, toast]);

  const decideReview = useCallback(async (review: PendingReview, action: 'approve' | 'decline') => {
    setDecidingReviewId(review.id);
    try {
      const res = await api.put<{ review: { summary: WorkflowSummary } }>(`/v2/admin/caring-community/workflow/reviews/${review.id}/decision`, {
        action,
      });
      if (res.data?.review?.summary) setSummary(res.data.review.summary);
      toast.success(action === 'approve' ? t('caring_workflow.pending.approve_success') : t('caring_workflow.pending.decline_success'));
    } catch {
      toast.error(t('caring_workflow.pending.decision_failed'));
    } finally {
      setDecidingReviewId(null);
    }
  }, [t, toast]);

  const statementQuery = useCallback((format?: 'csv') => {
    const params = new URLSearchParams();
    if (statementStartDate) params.set('start_date', statementStartDate);
    if (statementEndDate) params.set('end_date', statementEndDate);
    if (format) params.set('format', format);
    const query = params.toString();
    return query ? `?${query}` : '';
  }, [statementEndDate, statementStartDate]);

  const loadMemberStatement = useCallback(async () => {
    const memberId = Number(statementMemberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      toast.error(t('caring_workflow.member_statement.invalid_member'));
      return;
    }

    setLoadingStatement(true);
    try {
      const res = await api.get<MemberStatement>(`/v2/admin/caring-community/member-statements/${memberId}${statementQuery()}`);
      setMemberStatement(res.data ?? null);
    } catch {
      toast.error(t('caring_workflow.member_statement.load_failed'));
    } finally {
      setLoadingStatement(false);
    }
  }, [statementMemberId, statementQuery, t, toast]);

  const exportMemberStatement = useCallback(async () => {
    const memberId = Number(statementMemberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      toast.error(t('caring_workflow.member_statement.invalid_member'));
      return;
    }

    setLoadingStatement(true);
    try {
      const res = await api.get<MemberStatementCsv>(`/v2/admin/caring-community/member-statements/${memberId}${statementQuery('csv')}`);
      if (!res.data) throw new Error('Missing member statement CSV payload');
      setMemberStatement(res.data.statement);
      const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = res.data.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t('caring_workflow.member_statement.export_success'));
    } catch {
      toast.error(t('caring_workflow.member_statement.export_failed'));
    } finally {
      setLoadingStatement(false);
    }
  }, [statementMemberId, statementQuery, t, toast]);

  const createSupportRelationship = useCallback(async () => {
    const supporterId = Number(relationshipSupporterId);
    const recipientId = Number(relationshipRecipientId);
    if (!Number.isInteger(supporterId) || !Number.isInteger(recipientId) || supporterId <= 0 || recipientId <= 0 || supporterId === recipientId) {
      toast.error(t('caring_workflow.relationships.pick_different_members'));
      return;
    }

    setSavingRelationship(true);
    try {
      await api.post<SupportRelationship>('/v2/admin/caring-community/support-relationships', {
        supporter_id: supporterId,
        recipient_id: recipientId,
        title: relationshipTitle || undefined,
        frequency: relationshipFrequency,
        expected_hours: Number(relationshipExpectedHours || 1),
        start_date: relationshipStartDate || undefined,
      });
      setRelationshipSupporterId('');
      setRelationshipRecipientId('');
      setRelationshipSupporter(null);
      setRelationshipRecipient(null);
      setRelationshipTitle('');
      setRelationshipExpectedHours('1');
      setRelationshipStartDate('');
      toast.success(t('caring_workflow.relationships.create_success'));
      loadSupportRelationships();
    } catch {
      toast.error(t('caring_workflow.relationships.create_failed'));
    } finally {
      setSavingRelationship(false);
    }
  }, [
    loadSupportRelationships,
    relationshipExpectedHours,
    relationshipFrequency,
    relationshipRecipientId,
    relationshipStartDate,
    relationshipSupporterId,
    relationshipTitle,
    t,
    toast,
  ]);

  const updateSupportRelationshipStatus = useCallback(async (relationship: SupportRelationship, status: SupportRelationship['status']) => {
    setUpdatingRelationshipId(relationship.id);
    try {
      await api.put<SupportRelationship>(`/v2/admin/caring-community/support-relationships/${relationship.id}`, { status });
      toast.success(t('caring_workflow.relationships.update_success'));
      loadSupportRelationships();
    } catch {
      toast.error(t('caring_workflow.relationships.update_failed'));
    } finally {
      setUpdatingRelationshipId(null);
    }
  }, [loadSupportRelationships, t, toast]);

  const logSupportRelationshipHours = useCallback(async (relationship: SupportRelationship) => {
    const hours = Number(relationshipLogHours || relationship.expected_hours);
    if (!relationshipLogDate || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
      toast.error(t('caring_workflow.relationships.log_validation_failed'));
      return;
    }

    setLoggingRelationshipId(relationship.id);
    try {
      const res = await api.post(`/v2/admin/caring-community/support-relationships/${relationship.id}/hours`, {
        date: relationshipLogDate,
        hours,
        description: relationshipLogDescription || undefined,
      });
      if (res.success) {
        toast.success(t('caring_workflow.relationships.log_success'));
        setRelationshipLogDate('');
        setRelationshipLogHours('');
        setRelationshipLogDescription('');
        loadSupportRelationships();
        loadWorkflow();
      } else {
        toast.error(t('caring_workflow.relationships.log_failed'));
      }
    } catch {
      toast.error(t('caring_workflow.relationships.log_failed'));
    } finally {
      setLoggingRelationshipId(null);
    }
  }, [
    loadSupportRelationships,
    loadWorkflow,
    relationshipLogDate,
    relationshipLogDescription,
    relationshipLogHours,
    t,
    toast,
  ]);

  const loadInviteCodes = useCallback(async () => {
    setLoadingInviteCodes(true);
    try {
      const res = await api.get<InviteCode[]>('/v2/admin/caring-community/invite-codes');
      if (Array.isArray(res.data)) setInviteCodes(res.data);
    } catch {
      toast.error(t('caring_workflow.invite_codes.load_failed'));
    } finally {
      setLoadingInviteCodes(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadInviteCodes();
  }, [loadInviteCodes]);

  const generateInviteCode = useCallback(async () => {
    setGeneratingCode(true);
    setGeneratedCode(null);
    try {
      const res = await api.post<GeneratedCode>('/v2/admin/caring-community/invite-codes', {
        label: inviteLabel.trim() || undefined,
        expires_days: 30,
      });
      if (res.data) {
        setGeneratedCode(res.data);
        setInviteLabel('');
        toast.success(t('caring_workflow.invite_codes.generate_success'));
        loadInviteCodes();
      }
    } catch {
      toast.error(t('caring_workflow.invite_codes.generate_failed'));
    } finally {
      setGeneratingCode(false);
    }
  }, [inviteLabel, loadInviteCodes, t, toast]);

  const copyInviteCode = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }, []);

  const printInviteCard = useCallback((code: GeneratedCode | InviteCode) => {
    setPrintCodeId(code.id);
    setTimeout(() => {
      window.print();
      setPrintCodeId(null);
    }, 50);
  }, []);

  const handlePaperFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPaperFile(event.target.files?.[0] ?? null);
  }, []);

  const uploadPaperOnboarding = useCallback(async () => {
    if (!paperFile) {
      toast.error(t('caring_workflow.paper_onboarding.file_required'));
      return;
    }

    setPaperUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', paperFile);
      formData.append('name', paperName);
      formData.append('date_of_birth', paperDateOfBirth);
      formData.append('address', paperAddress);
      formData.append('phone', paperPhone);
      formData.append('email', paperEmail);

      const res = await api.upload<PaperOnboardingIntake>('/v2/admin/caring-community/paper-onboarding', formData);
      if (res.data) {
        setPaperIntakes((current) => [res.data as PaperOnboardingIntake, ...current]);
        setPaperReviewingId(res.data.id);
        setPaperFile(null);
        toast.success(t('caring_workflow.paper_onboarding.upload_success'));
      }
    } catch {
      toast.error(t('caring_workflow.paper_onboarding.upload_failed'));
    } finally {
      setPaperUploading(false);
    }
  }, [paperAddress, paperDateOfBirth, paperEmail, paperFile, paperName, paperPhone, t, toast]);

  const startPaperReview = useCallback((intake: PaperOnboardingIntake) => {
    const fields = intake.corrected_fields ?? intake.extracted_fields ?? {};
    setPaperReviewingId(intake.id);
    setPaperName(fields.name ?? '');
    setPaperDateOfBirth(fields.date_of_birth ?? '');
    setPaperAddress(fields.address ?? '');
    setPaperPhone(fields.phone ?? '');
    setPaperEmail(fields.email ?? '');
    setPaperNote('');
  }, []);

  const confirmPaperOnboarding = useCallback(async () => {
    if (!paperReviewingId) return;
    if (!paperName.trim() || !paperEmail.trim()) {
      toast.error(t('caring_workflow.assisted_onboarding.required'));
      return;
    }

    setOnboardingLoading(true);
    setOnboardingResult(null);
    try {
      const res = await api.post<{ success: boolean; user: { id: number; name: string; email: string }; temp_password: string }>(
        `/v2/admin/caring-community/paper-onboarding/${paperReviewingId}/confirm`,
        {
          name: paperName.trim(),
          date_of_birth: paperDateOfBirth.trim() || undefined,
          address: paperAddress.trim() || undefined,
          phone: paperPhone.trim() || undefined,
          email: paperEmail.trim(),
          note: paperNote.trim() || undefined,
        },
      );
      if (res.data) {
        setOnboardingResult({ user: res.data.user, temp_password: res.data.temp_password });
        setPaperIntakes((current) => current.filter((item) => item.id !== paperReviewingId));
        setPaperReviewingId(null);
        setPaperName('');
        setPaperDateOfBirth('');
        setPaperAddress('');
        setPaperPhone('');
        setPaperEmail('');
        setPaperNote('');
        toast.success(t('caring_workflow.paper_onboarding.confirm_success'));
      }
    } catch {
      toast.error(t('caring_workflow.paper_onboarding.confirm_failed'));
    } finally {
      setOnboardingLoading(false);
    }
  }, [paperAddress, paperDateOfBirth, paperEmail, paperName, paperNote, paperPhone, paperReviewingId, t, toast]);

  const submitAssistedOnboarding = useCallback(async () => {
    if (!onboardingName.trim() || !onboardingEmail.trim()) {
      toast.error(t('caring_workflow.assisted_onboarding.required'));
      return;
    }
    setOnboardingLoading(true);
    setOnboardingResult(null);
    try {
      const res = await api.post<{ user: { id: number; name: string; email: string }; temp_password: string }>(
        '/v2/admin/caring-community/assisted-onboarding',
        {
          name: onboardingName.trim(),
          email: onboardingEmail.trim(),
          phone: onboardingPhone.trim() || undefined,
          note: onboardingNote.trim() || undefined,
        },
      );
      if (res.data) {
        setOnboardingResult(res.data);
        setOnboardingName('');
        setOnboardingEmail('');
        setOnboardingPhone('');
        setOnboardingNote('');
        toast.success(t('caring_workflow.assisted_onboarding.created'));
      }
    } catch {
      toast.error(t('caring_workflow.assisted_onboarding.create_failed'));
    } finally {
      setOnboardingLoading(false);
    }
  }, [onboardingEmail, onboardingName, onboardingNote, onboardingPhone, t, toast]);

  const copyTempPassword = useCallback(() => {
    if (!onboardingResult) return;
    void navigator.clipboard.writeText(onboardingResult.temp_password);
    setOnboardingCopied(true);
    setTimeout(() => setOnboardingCopied(false), 2000);
  }, [onboardingResult]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('caring_workflow.loading.workflow')} /></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-8">
      <PageHeader
        title={t('caring_workflow.meta.title')}
        description={t('caring_workflow.meta.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              as={Link}
              to={tenantPath('/admin/volunteering/hours')}
              variant="secondary"
              size="sm"
              startContent={<ClipboardCheck aria-hidden="true" size={16} />}
            >
              {t('caring_workflow.actions.open_hour_review')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/caring/municipal-impact')}
              variant="secondary"
              size="sm"
              startContent={<FileText aria-hidden="true" size={16} />}
            >
              {t('caring_workflow.actions.open_report_pack')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              startContent={<RefreshCw aria-hidden="true" size={16} />}
              onPress={loadWorkflow}
            >
              {t('caring_workflow.actions.refresh')}
            </Button>
          </div>
        }
      />

      <CaregiverLinkReviewPanel />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label={t('caring_workflow.stats.pending_reviews')} value={(stats?.pending_count ?? 0).toLocaleString(getFormattingLocale())} icon={ClipboardCheck} color="warning" />
        <StatCard label={t('caring_workflow.stats.pending_hours')} value={formatHours(stats?.pending_hours ?? 0)} icon={Clock} color="warning" />
        <StatCard label={t('caring_workflow.stats.approved_30d')} value={formatHours(stats?.approved_30d_hours ?? 0)} icon={CheckCircle2} color="success" />
        <StatCard label={t('caring_workflow.stats.coordinators')} value={(stats?.coordinator_count ?? 0).toLocaleString(getFormattingLocale())} icon={Users} color="default" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{t('caring_workflow.pending.title')}</h2>
                <p className="mt-1 text-sm text-muted">
                  {t('caring_workflow.pending.description_prefix')} <span className="font-medium text-warning-600">{t('caring_workflow.pending.needs_review')}</span> {t('caring_workflow.pending.description_middle')}{' '}
                  <span className="font-medium text-danger-600">{t('caring_workflow.pending.escalate_now')}</span> {t('caring_workflow.pending.description_suffix')}
                </p>
              </div>
              {(stats?.overdue_count ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(stats?.escalated_count ?? 0) > 0 && (
                    <Chip color="danger" variant="soft">{t('caring_workflow.pending.escalated_count', { count: stats?.escalated_count ?? 0 })}</Chip>
                  )}
                  <Chip color="warning" variant="soft">{t('caring_workflow.pending.overdue_count', { count: stats?.overdue_count ?? 0 })}</Chip>
                </div>
              )}
            </CardHeader>
            <Separator />
            <CardBody className="gap-3">
              {summary?.pending_reviews.length === 0 ? (
                <div className="rounded-lg bg-success/10 p-4 text-sm text-success-700">
                  {t('caring_workflow.pending.empty')}
                </div>
              ) : summary?.pending_reviews.map((review) => (
                <div key={review.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{review.member_name}</p>
                      <p className="mt-1 text-sm text-muted">
                        {review.organisation_name || review.opportunity_title || t('caring_workflow.empty.unassigned')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {review.is_escalated && <Chip size="sm" color="danger" variant="soft">{t('caring_workflow.pending.escalate_now')}</Chip>}
                      {!review.is_escalated && review.is_overdue && <Chip size="sm" color="warning" variant="soft">{t('caring_workflow.pending.needs_review')}</Chip>}
                      <Chip size="sm" color="accent" variant="soft">{formatHours(review.hours)}</Chip>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{t('caring_workflow.pending.logged', { date: review.date_logged })}</span>
                    <span>{t('caring_workflow.pending.submitted', { date: review.created_at })}</span>
                    <span>{t('caring_workflow.pending.age_days', { count: review.age_days })}</span>
                    {review.assigned_name && <span>{t('caring_workflow.pending.assigned_to', { name: review.assigned_name })}</span>}
                    {review.escalated_at && <span>{t('caring_workflow.pending.escalated_at', { date: review.escalated_at })}</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <Select
                      size="sm"
                      label={t('caring_workflow.pending.assign_coordinator')}
                      selectedKeys={[review.assigned_to ? String(review.assigned_to) : 'unassigned']}
                      isDisabled={assigningReviewId === review.id || decidingReviewId === review.id}
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0];
                        assignReview(review.id, selected && selected !== 'unassigned' ? Number(selected) : null);
                      }}
                      items={coordinatorOptions}
                    >
                      {(item) => <SelectItem key={item.id} id={item.id}>{item.label}</SelectItem>}
                    </Select>
                    <Button
                      size="sm"
                      variant={review.is_escalated ? 'danger' : 'secondary'}
                      startContent={review.is_escalated ? <TriangleAlert aria-hidden="true" size={16} /> : <UserPlus aria-hidden="true" size={16} />}
                      isLoading={escalatingReviewId === review.id}
                      isDisabled={decidingReviewId === review.id}
                      onPress={() => escalateReview(review)}
                    >
                      {review.is_escalated ? t('caring_workflow.actions.re_escalate') : t('caring_workflow.actions.escalate')}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      startContent={<CheckCircle2 aria-hidden="true" size={16} />}
                      isLoading={decidingReviewId === review.id}
                      onPress={() => decideReview(review, 'approve')}
                    >
                      {t('caring_workflow.actions.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      startContent={<XCircle aria-hidden="true" size={16} />}
                      isDisabled={decidingReviewId === review.id}
                      onPress={() => decideReview(review, 'decline')}
                    >
                      {t('caring_workflow.actions.decline')}
                    </Button>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t('caring_workflow.relationships.title')}</h2>
                <p className="mt-1 text-sm text-muted">{t('caring_workflow.relationships.description')}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                startContent={<RefreshCw aria-hidden="true" size={16} />}
                isLoading={loadingRelationships}
                onPress={loadSupportRelationships}
              >
                {t('caring_workflow.actions.refresh')}
              </Button>
            </CardHeader>
            <Separator />
            <CardBody className="gap-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SignalRow label={t('caring_workflow.relationships.active')} value={relationships?.stats.active_count ?? 0} />
                <SignalRow label={t('caring_workflow.relationships.paused')} value={relationships?.stats.paused_count ?? 0} />
                <SignalRow label={t('caring_workflow.relationships.check_ins_due')} value={relationships?.stats.check_ins_due ?? 0} />
                <SignalRow label={t('caring_workflow.relationships.expected_hours')} value={relationships?.stats.expected_active_hours ?? 0} />
              </div>
              <div id="caring-support-relationship-form" className="rounded-lg border border-border p-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <MemberSearchPicker
                    value={relationshipSupporterId}
                    onValueChange={setRelationshipSupporterId}
                    selectedMember={relationshipSupporter}
                    onSelectedMemberChange={setRelationshipSupporter}
                    label={t('caring_workflow.relationships.supporter')}
                    placeholder={t('caring_workflow.relationships.supporter_placeholder')}
                    noResultsText={t('caring_workflow.relationships.no_members')}
                    clearText={t('caring_workflow.relationships.clear')}
                    isRequired
                  />
                  <MemberSearchPicker
                    value={relationshipRecipientId}
                    onValueChange={setRelationshipRecipientId}
                    selectedMember={relationshipRecipient}
                    onSelectedMemberChange={setRelationshipRecipient}
                    label={t('caring_workflow.relationships.recipient')}
                    placeholder={t('caring_workflow.relationships.recipient_placeholder')}
                    noResultsText={t('caring_workflow.relationships.no_members')}
                    clearText={t('caring_workflow.relationships.clear')}
                    isRequired
                  />
                  <Input label={t('caring_workflow.relationships.relationship_title')} value={relationshipTitle} onValueChange={setRelationshipTitle} />
                  <Select
                    label={t('caring_workflow.relationships.frequency_label')}
                    selectedKeys={[relationshipFrequency]}
                    onSelectionChange={(keys) => setRelationshipFrequency((Array.from(keys)[0]?.toString() as SupportRelationship['frequency']) || 'weekly')}
                    items={frequencyOptions}
                  >
                    {(item) => <SelectItem key={item.id} id={item.id}>{item.label}</SelectItem>}
                  </Select>
                  <Input type="number" min={0.25} step={0.25} label={t('caring_workflow.relationships.expected_hours_per_visit')} value={relationshipExpectedHours} onValueChange={setRelationshipExpectedHours} />
                  <Input type="date" label={t('caring_workflow.relationships.start_date')} value={relationshipStartDate} onValueChange={setRelationshipStartDate} />
                </div>
                <div className="mt-3">
                  <Button variant="primary" startContent={<Plus size={16} />} isLoading={savingRelationship} onPress={createSupportRelationship}>
                    {t('caring_workflow.relationships.create')}
                  </Button>
                </div>
              </div>
              {(relationships?.items.length ?? 0) === 0 ? (
                <div className="rounded-lg bg-surface-secondary p-4 text-sm text-muted">
                  {t('caring_workflow.relationships.empty')}
                </div>
              ) : relationships?.items.map((relationship) => (
                <div key={relationship.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{relationship.title}</p>
                      <p className="mt-1 text-sm text-muted">
                        {t('caring_workflow.relationships.pair', { supporter: relationship.supporter.name, recipient: relationship.recipient.name })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip size="sm" color={relationship.status === 'active' ? 'success' : 'warning'} variant="soft">
                        {t(`caring_workflow.relationships.status.${relationship.status}`)}
                      </Chip>
                      <Chip size="sm" color="accent" variant="soft">{formatHours(relationship.expected_hours)}</Chip>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                    <span>{t(`caring_workflow.relationships.frequency.${relationship.frequency}`)}</span>
                    <span>{t('caring_workflow.relationships.started', { date: relationship.start_date })}</span>
                    {relationship.next_check_in_at && <span>{t('caring_workflow.relationships.next_check_in', { date: relationship.next_check_in_at })}</span>}
                    {relationship.organization_name && <span>{relationship.organization_name}</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      startContent={relationship.status === 'active' ? <Pause aria-hidden="true" size={16} /> : <CheckCircle2 aria-hidden="true" size={16} />}
                      isLoading={updatingRelationshipId === relationship.id}
                      onPress={() => updateSupportRelationshipStatus(relationship, relationship.status === 'active' ? 'paused' : 'active')}
                    >
                      {relationship.status === 'active' ? t('caring_workflow.relationships.pause') : t('caring_workflow.relationships.resume')}
                    </Button>
                  </div>
                  {relationship.status === 'active' && (
                    <div className="mt-4 rounded-lg bg-surface p-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr_auto]">
                        <Input
                          type="date"
                          size="sm"
                          label={t('caring_workflow.relationships.log_date')}
                          value={relationshipLogDate}
                          onValueChange={setRelationshipLogDate}
                        />
                        <Input
                          type="number"
                          size="sm"
                          min={0.25}
                          max={24}
                          step={0.25}
                          label={t('caring_workflow.relationships.log_hours')}
                          placeholder={String(relationship.expected_hours)}
                          value={relationshipLogHours}
                          onValueChange={setRelationshipLogHours}
                        />
                        <Input
                          size="sm"
                          label={t('caring_workflow.relationships.log_note')}
                          value={relationshipLogDescription}
                          onValueChange={setRelationshipLogDescription}
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          className="self-end"
                          startContent={<ClipboardCheck aria-hidden="true" size={16} />}
                          isLoading={loggingRelationshipId === relationship.id}
                          onPress={() => logSupportRelationshipHours(relationship)}
                        >
                          {t('caring_workflow.relationships.log_hours_action')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Safeguarding reports - K9 */}
          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <TriangleAlert aria-hidden="true" size={18} className="text-danger" />
                  {t('caring_workflow.safeguarding.title')}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {t('caring_workflow.safeguarding.description')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  startContent={<RefreshCw aria-hidden="true" size={16} />}
                  isLoading={loadingSafeguarding}
                  onPress={loadSafeguardingSummary}
                >
                  {t('caring_workflow.actions.refresh')}
                </Button>
                <Button
                  as={Link}
                  to={tenantPath('/caring/safeguarding')}
                  size="sm"
                  variant="primary"
                >
                  {t('caring_workflow.safeguarding.view_all')}
                </Button>
              </div>
            </CardHeader>
            <Separator />
            <CardBody className="space-y-4">
              {loadingSafeguarding && !safeguardingSummary ? (
                <div className="flex justify-center py-6">
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
                </div>
              ) : !safeguardingSummary ? (
                <p className="text-sm text-muted py-4 text-center">{t('caring_workflow.safeguarding.no_data')}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-rose-700 dark:text-rose-300">{t('caring_workflow.safeguarding.severity.critical')}</p>
                      <p className="text-2xl font-semibold">{safeguardingSummary.open_by_severity.critical}</p>
                    </div>
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">{t('caring_workflow.safeguarding.severity.high')}</p>
                      <p className="text-2xl font-semibold">{safeguardingSummary.open_by_severity.high}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-foreground">{t('caring_workflow.safeguarding.severity.medium')}</p>
                      <p className="text-2xl font-semibold">{safeguardingSummary.open_by_severity.medium}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-foreground">{t('caring_workflow.safeguarding.severity.low')}</p>
                      <p className="text-2xl font-semibold">{safeguardingSummary.open_by_severity.low}</p>
                    </div>
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-center">
                      <p className="text-xs uppercase tracking-wide text-rose-700 dark:text-rose-300 flex items-center justify-center gap-1">
                        <TriangleAlert aria-hidden="true" size={12} /> {t('caring_workflow.safeguarding.overdue')}
                      </p>
                      <p className="text-2xl font-semibold">{safeguardingSummary.overdue}</p>
                    </div>
                  </div>

                  {safeguardingSummary.recent.length === 0 ? (
                    <p className="text-sm text-muted py-4 text-center">{t('caring_workflow.safeguarding.no_reports')}</p>
                  ) : (
                    <Table aria-label={t('caring_workflow.safeguarding.table_aria')} removeWrapper>
                      <TableHeader>
                        <TableColumn>{t('caring_workflow.safeguarding.columns.severity')}</TableColumn>
                        <TableColumn>{t('caring_workflow.safeguarding.columns.category')}</TableColumn>
                        <TableColumn>{t('caring_workflow.safeguarding.columns.subject')}</TableColumn>
                        <TableColumn>{t('caring_workflow.safeguarding.columns.status')}</TableColumn>
                        <TableColumn>{t('caring_workflow.safeguarding.columns.age')}</TableColumn>
                        <TableColumn align="end">{t('caring_workflow.safeguarding.columns.action')}</TableColumn>
                      </TableHeader>
                      <TableBody>
                          {safeguardingSummary.recent.slice(0, 10).map((r) => {
                            const severityColor: Record<typeof r.severity, 'danger' | 'warning' | 'default' | 'success'> = {
                              critical: 'danger',
                              high: 'warning',
                              medium: 'default',
                              low: 'success',
                            };
                            const statusColor: Record<typeof r.status, 'default' | 'primary' | 'warning' | 'success'> = {
                              submitted: 'primary',
                              triaged: 'primary',
                              investigating: 'warning',
                              resolved: 'success',
                              dismissed: 'default',
                            };
                            const ageHours = Math.max(
                              0,
                              Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60)),
                            );
                            const ageLabel = ageHours < 24
                              ? t('caring_workflow.safeguarding.age_hours', { count: ageHours })
                              : t('caring_workflow.safeguarding.age_days', { count: Math.floor(ageHours / 24) });
                            return (
                              <TableRow key={r.id}>
                                <TableCell>
                                  <Chip size="sm" color={severityColor[r.severity]} variant="soft">
                                    {t(`caring_workflow.safeguarding.severity.${r.severity}`)}
                                  </Chip>
                                </TableCell>
                                <TableCell>
                                  {t(`caring_workflow.safeguarding.categories.${r.category}`, {
                                    defaultValue: t('caring_workflow.safeguarding.categories.unknown'),
                                  })}
                                </TableCell>
                                <TableCell>
                                  {r.subject_user_name ?? (r.subject_organisation_id ? t('caring_workflow.safeguarding.org_subject', { id: r.subject_organisation_id }) : t('caring_workflow.empty.value'))}
                                </TableCell>
                                <TableCell>
                                  <Chip size="sm" color={statusColor[r.status]} variant="soft">
                                    {t(`caring_workflow.safeguarding.status.${r.status}`)}
                                  </Chip>
                                  {r.is_overdue && (
                                    <Chip size="sm" color="danger" variant="secondary" className="ml-1">
                                      {t('caring_workflow.safeguarding.overdue')}
                                    </Chip>
                                  )}
                                </TableCell>
                                <TableCell>{ageLabel}</TableCell>
                                <TableCell>
                                  <div className="flex justify-end">
                                    <Button
                                      as={Link}
                                      to={tenantPath('/caring/safeguarding')}
                                      size="sm"
                                      variant="secondary"
                                    >
                                      {t('caring_workflow.safeguarding.open')}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <PredictiveInsightsCard
            forecast={forecast}
            loading={loadingForecast}
            error={forecastError}
            onRefresh={loadForecast}
            t={t}
          />

          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Sparkles aria-hidden="true" size={18} className="text-accent" />
                  {t('caring_workflow.tandem.title')}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {t('caring_workflow.tandem.description')}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                startContent={<RefreshCw aria-hidden="true" size={16} />}
                isLoading={loadingTandems}
                onPress={loadTandemSuggestions}
              >
                {t('caring_workflow.actions.refresh')}
              </Button>
            </CardHeader>
            <Separator />
            <CardBody className="gap-3">
              {loadingTandems && tandemSuggestions.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="md" /></div>
                </div>
              ) : tandemError ? (
                <div className="rounded-lg bg-danger-50 p-4 text-sm text-danger-700">
                  {tandemError}
                </div>
              ) : tandemSuggestions.length === 0 ? (
                <div className="rounded-lg bg-surface-secondary p-4 text-sm text-muted">
                  {t('caring_workflow.tandem.empty')}
                </div>
              ) : (
                tandemSuggestions.map((suggestion) => {
                  const key = `${suggestion.supporter.id}:${suggestion.recipient.id}`;
                  const scoreColor: 'success' | 'warning' | 'default' =
                    suggestion.score >= 0.7 ? 'success' : suggestion.score >= 0.5 ? 'warning' : 'default';
                  const signals = suggestion.signals;
                  const chips: { key: string; label: string }[] = [];
                  if (typeof signals.distance_km === 'number') {
                    chips.push({ key: 'distance', label: t('caring_workflow.tandem.distance_km', { value: signals.distance_km.toFixed(1) }) });
                  }
                  if (typeof signals.language_overlap === 'number' && signals.language_overlap > 0.4) {
                    chips.push({ key: 'language', label: t('caring_workflow.tandem.same_language') });
                  }
                  if (typeof signals.skill_complement === 'number' && signals.skill_complement > 0.4) {
                    chips.push({ key: 'skills', label: t('caring_workflow.tandem.complementary_skills') });
                  }
                  if (typeof signals.availability_overlap === 'number' && signals.availability_overlap > 0.4) {
                    chips.push({ key: 'availability', label: t('caring_workflow.tandem.availability_overlap') });
                  }
                  if (typeof signals.interest_overlap === 'number' && signals.interest_overlap > 0.4) {
                    chips.push({ key: 'interests', label: t('caring_workflow.tandem.shared_interests') });
                  }
                  return (
                    <div key={key} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2">
                            <div className="h-9 w-9 overflow-hidden rounded-full bg-surface-secondary flex items-center justify-center text-xs font-semibold">
                              {suggestion.supporter.avatar_url ? (
                                <img src={resolveAvatarUrl(suggestion.supporter.avatar_url)} alt="" className="h-full w-full object-cover" />
                              ) : (
                                suggestion.supporter.name.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="text-sm">
                              <div className="font-semibold text-foreground">{suggestion.supporter.name}</div>
                              <div className="text-xs text-muted">{t('caring_workflow.relationships.supporter')}</div>
                            </div>
                          </div>
                          <HeartHandshake aria-hidden="true" size={20} className="text-accent" />
                          <div className="flex items-center gap-2">
                            <div className="h-9 w-9 overflow-hidden rounded-full bg-surface-secondary flex items-center justify-center text-xs font-semibold">
                              {suggestion.recipient.avatar_url ? (
                                <img src={resolveAvatarUrl(suggestion.recipient.avatar_url)} alt="" className="h-full w-full object-cover" />
                              ) : (
                                suggestion.recipient.name.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="text-sm">
                              <div className="font-semibold text-foreground">{suggestion.recipient.name}</div>
                              <div className="text-xs text-muted">{t('caring_workflow.relationships.recipient')}</div>
                            </div>
                          </div>
                        </div>
                        <Chip size="sm" color={scoreColor} variant="soft">
                          {t('caring_workflow.tandem.score', { value: Math.round(suggestion.score * 100) })}
                        </Chip>
                      </div>
                      {chips.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {chips.map((chip) => (
                            <Chip key={chip.key} size="sm" variant="soft" color="accent">
                              {chip.label}
                            </Chip>
                          ))}
                        </div>
                      )}
                      {suggestion.reasons.length > 0 && (
                        <p className="mt-2 text-xs text-muted">{tandemReason(suggestion, t)}</p>
                      )}
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="tertiary"
                          startContent={<XCircle aria-hidden="true" size={16} />}
                          isLoading={dismissingTandemKey === key}
                          onPress={() => dismissTandemSuggestion(suggestion)}
                        >
                          {t('caring_workflow.tandem.dismiss')}
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          startContent={<Heart aria-hidden="true" size={16} />}
                          onPress={() => createTandemFromSuggestion(suggestion)}
                        >
                          {t('caring_workflow.tandem.create')}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {summary?.policy && (
            <Card>
              <CardHeader className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{t('caring_workflow.policy.title')}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {t('caring_workflow.policy.description')}
                  </p>
                </div>
                <Button
                  size="sm"
                  startContent={<Save aria-hidden="true" size={16} />}
                  isLoading={savingPolicy}
                  onPress={savePolicy}
                >
                  {t('caring_workflow.policy.save')}
                </Button>
              </CardHeader>
              <Separator />
              <CardBody className="gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    label={t('caring_workflow.policy.review_sla_days')}
                    description={t('caring_workflow.policy.review_sla_days_description')}
                    value={String(summary.policy.review_sla_days)}
                    onValueChange={(value) => updatePolicyField('review_sla_days', Number(value || 1))}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    label={t('caring_workflow.policy.escalation_sla_days')}
                    description={t('caring_workflow.policy.escalation_sla_days_description')}
                    value={String(summary.policy.escalation_sla_days)}
                    onValueChange={(value) => updatePolicyField('escalation_sla_days', Number(value || 1))}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    label={t('caring_workflow.policy.monthly_statement_day')}
                    description={t('caring_workflow.policy.monthly_statement_day_description')}
                    value={String(summary.policy.monthly_statement_day)}
                    onValueChange={(value) => updatePolicyField('monthly_statement_day', Number(value || 1))}
                  />
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    label={t('caring_workflow.policy.default_hour_value_chf')}
                    description={t('caring_workflow.policy.default_hour_value_chf_description')}
                    value={String(summary.policy.default_hour_value_chf)}
                    onValueChange={(value) => updatePolicyField('default_hour_value_chf', Number(value || 0))}
                  />
                </div>
                <Select
                  label={t('caring_workflow.policy.municipal_report_default_period')}
                  selectedKeys={[summary.policy.municipal_report_default_period]}
                  onSelectionChange={(keys) => updatePolicyField('municipal_report_default_period', Array.from(keys)[0]?.toString() ?? 'last_90_days')}
                >
                  {reportPeriods.map((period) => (
                    <SelectItem key={period} id={period}>{t(`caring_workflow.policy.periods.${period}`)}</SelectItem>
                  ))}
                </Select>
                <div className="grid grid-cols-1 gap-3">
                  <PolicySwitch
                    label={t('caring_workflow.policy.approval_required')}
                    description={t('caring_workflow.policy.approval_required_description')}
                    value={summary.policy.approval_required}
                    onChange={(value) => updatePolicyField('approval_required', value)}
                  />
                  <PolicySwitch
                    label={t('caring_workflow.policy.auto_approve_trusted_reviewers')}
                    description={t('caring_workflow.policy.auto_approve_trusted_reviewers_description')}
                    value={summary.policy.auto_approve_trusted_reviewers}
                    onChange={(value) => updatePolicyField('auto_approve_trusted_reviewers', value)}
                  />
                  <PolicySwitch
                    label={t('caring_workflow.policy.allow_member_self_log')}
                    description={t('caring_workflow.policy.allow_member_self_log_description')}
                    value={summary.policy.allow_member_self_log}
                    onChange={(value) => updatePolicyField('allow_member_self_log', value)}
                  />
                  <PolicySwitch
                    label={t('caring_workflow.policy.require_organisation_for_partner_hours')}
                    description={t('caring_workflow.policy.require_organisation_for_partner_hours_description')}
                    value={summary.policy.require_organisation_for_partner_hours}
                    onChange={(value) => updatePolicyField('require_organisation_for_partner_hours', value)}
                  />
                  <PolicySwitch
                    label={t('caring_workflow.policy.include_social_value_estimate')}
                    description={t('caring_workflow.policy.include_social_value_estimate_description')}
                    value={summary.policy.include_social_value_estimate}
                    onChange={(value) => updatePolicyField('include_social_value_estimate', value)}
                  />
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div>
                <h2 className="text-lg font-semibold">{t('caring_workflow.member_statement.title')}</h2>
                <p className="mt-1 text-sm text-muted">
                  {t('caring_workflow.member_statement.description')}
                </p>
              </div>
            </CardHeader>
            <Separator />
            <CardBody className="gap-4">
              <Input
                type="number"
                min={1}
                label={t('caring_workflow.member_statement.member_id')}
                value={statementMemberId}
                onValueChange={setStatementMemberId}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  label={t('caring_workflow.member_statement.start_date')}
                  value={statementStartDate}
                  onValueChange={setStatementStartDate}
                />
                <Input
                  type="date"
                  label={t('caring_workflow.member_statement.end_date')}
                  value={statementEndDate}
                  onValueChange={setStatementEndDate}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  startContent={<Search aria-hidden="true" size={16} />}
                  isLoading={loadingStatement}
                  onPress={loadMemberStatement}
                >
                  {t('caring_workflow.member_statement.preview')}
                </Button>
                <Button
                  variant="secondary"
                  startContent={<Download aria-hidden="true" size={16} />}
                  isLoading={loadingStatement}
                  onPress={exportMemberStatement}
                >
                  {t('caring_workflow.member_statement.export_csv')}
                </Button>
              </div>
              {memberStatement ? (
                <div className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{memberStatement.user.name}</p>
                      <p className="text-xs text-muted">{memberStatement.user.email}</p>
                    </div>
                    <Chip size="sm" color="success" variant="soft">
                      {formatHours(memberStatement.summary.current_balance)}
                    </Chip>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <SignalRow label={t('caring_workflow.member_statement.approved_support_hours')} value={memberStatement.summary.approved_support_hours} />
                    <SignalRow label={t('caring_workflow.member_statement.pending_support_hours')} value={memberStatement.summary.pending_support_hours} />
                    <SignalRow label={t('caring_workflow.member_statement.wallet_hours_earned')} value={memberStatement.summary.wallet_hours_earned} />
                    <SignalRow label={t('caring_workflow.member_statement.wallet_hours_spent')} value={memberStatement.summary.wallet_hours_spent} />
                  </div>
                  <div className="mt-3 rounded-lg bg-surface-secondary px-3 py-2 text-sm text-foreground">
                    {formatChf(memberStatement.summary.estimated_social_value_chf)}
                  </div>
                  {memberStatement.support_hours_by_organisation.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {memberStatement.support_hours_by_organisation.slice(0, 3).map((organisation) => (
                        <div key={organisation.organisation_name} className="flex items-center justify-between gap-3 text-xs">
                          <span className="truncate text-foreground">{organisation.organisation_name}</span>
                          <span className="font-semibold text-foreground">{formatHours(organisation.approved_hours)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg bg-surface-secondary p-3 text-sm text-muted">
                  {t('caring_workflow.member_statement.empty')}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <h2 className="text-lg font-semibold">{t('caring_workflow.signals.title')}</h2>
                <p className="mt-1 text-sm text-muted">
                  {t('caring_workflow.signals.description')}
                </p>
              </div>
            </CardHeader>
            <Separator />
            <CardBody className="gap-3">
              <SignalRow label={t('caring_workflow.signals.active_requests')} value={signals?.active_requests ?? 0} />
              <SignalRow label={t('caring_workflow.signals.active_offers')} value={signals?.active_offers ?? 0} />
              <SignalRow label={t('caring_workflow.signals.trusted_organisations')} value={signals?.trusted_organisations ?? 0} />
              <SignalRow label={t('caring_workflow.signals.declined_30d')} value={stats?.declined_30d_count ?? 0} />
            </CardBody>
          </Card>

          {/* Informal Favours (AG11) */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Heart size={18} className="text-rose-500" />
                <div>
                  <h2 className="text-lg font-semibold">{t('caring_workflow.favours.title')}</h2>
                  <p className="mt-0.5 text-sm text-muted">
                    {loadingFavours ? t('caring_workflow.favours.loading') : t('caring_workflow.favours.total_recorded', { count: favoursData?.count ?? 0 })}
                  </p>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardBody className="gap-2">
              {loadingFavours && (
                <p className="text-sm text-muted">{t('caring_workflow.favours.loading_favours')}</p>
              )}
              {!loadingFavours && !favoursData?.items?.length && (
                <p className="text-sm text-muted">{t('caring_workflow.favours.empty')}</p>
              )}
              {!loadingFavours && (favoursData?.items ?? []).slice(0, 5).map((f) => (
                <div key={f.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{f.is_anonymous ? t('caring_workflow.favours.anonymous') : (f.offerer_name ?? t('caring_workflow.favours.unknown'))}</span>
                    <span>{f.favour_date}</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground line-clamp-2">{f.description}</p>
                  {f.category && (
                    <span className="mt-1 inline-block rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-foreground">
                      {t(`caring_workflow.favours.categories.${f.category}`, {
                        defaultValue: t('caring_workflow.favours.categories.unknown'),
                      })}
                    </span>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t('caring_workflow.role_pack.title')}</h2>
                <p className="mt-1 text-sm text-muted">
                  {t('caring_workflow.role_pack.description', { countLabel: roleCountLabel })}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                isLoading={installingRoles}
                onPress={installRolePack}
              >
                {installingRoles ? t('caring_workflow.role_pack.installing') : t('caring_workflow.role_pack.install')}
              </Button>
            </CardHeader>
            <Separator />
            <CardBody className="gap-3">
              {rolePresets.map((role) => {
                const Icon = role.icon;
                const status = roleStatusByKey.get(role.key);
                return (
                  <div key={role.key} className="flex items-start gap-3 rounded-lg border border-border p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{t(`caring_workflow.role_pack.presets.${role.key}.title`)}</p>
                        <Chip size="sm" color={status?.installed ? 'success' : 'default'} variant="soft">
                          {status?.installed ? t('caring_workflow.role_pack.installed') : t('caring_workflow.role_pack.not_installed')}
                        </Chip>
                      </div>
                      <p className="mt-1 text-xs text-muted">{t(`caring_workflow.role_pack.presets.${role.key}.description`)}</p>
                      {status && (
                        <p className="mt-2 text-xs text-muted">
                          {t('caring_workflow.role_pack.permissions_granted', { installed: status.installed_permissions, total: status.permission_count })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Assisted Onboarding card */}
      <Card className="mt-6" >
        <CardHeader>
          <div>
            <h2 className="text-lg font-semibold">{t('caring_workflow.assisted_onboarding.title')}</h2>
            <p className="mt-1 text-sm text-muted">
              {t('caring_workflow.assisted_onboarding.description')}
            </p>
          </div>
        </CardHeader>
        <Separator />
        <CardBody className="gap-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t('caring_workflow.paper_onboarding.title')}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  {t('caring_workflow.paper_onboarding.description')}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                startContent={<RefreshCw size={14} />}
                isLoading={paperLoading}
                onPress={loadPaperIntakes}
              >
                {t('caring_workflow.actions.refresh')}
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                type="file"
                label={t('caring_workflow.paper_onboarding.file_label')}
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={handlePaperFileChange}
              />
              <Input
                label={t('caring_workflow.paper_onboarding.name_label')}
                placeholder={t('caring_workflow.paper_onboarding.name_placeholder')}
                value={paperName}
                onValueChange={setPaperName}
              />
              <Input
                type="date"
                label={t('caring_workflow.paper_onboarding.dob_label')}
                value={paperDateOfBirth}
                onValueChange={setPaperDateOfBirth}
              />
              <Input
                type="email"
                label={t('caring_workflow.paper_onboarding.email_label')}
                placeholder={t('caring_workflow.paper_onboarding.email_placeholder')}
                value={paperEmail}
                onValueChange={setPaperEmail}
              />
              <Input
                label={t('caring_workflow.paper_onboarding.phone_label')}
                placeholder={t('caring_workflow.paper_onboarding.phone_placeholder')}
                value={paperPhone}
                onValueChange={setPaperPhone}
              />
              <Input
                label={t('caring_workflow.paper_onboarding.address_label')}
                placeholder={t('caring_workflow.paper_onboarding.address_placeholder')}
                value={paperAddress}
                onValueChange={setPaperAddress}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                startContent={<FileText size={16} />}
                isLoading={paperUploading}
                onPress={uploadPaperOnboarding}
              >
                {t('caring_workflow.paper_onboarding.upload_cta')}
              </Button>
              {paperReviewingId && (
                <Button
                  variant="primary"
                  startContent={<CheckCircle2 size={16} />}
                  isLoading={onboardingLoading}
                  onPress={confirmPaperOnboarding}
                >
                  {t('caring_workflow.paper_onboarding.confirm_cta')}
                </Button>
              )}
            </div>

            {paperReviewingId && (
              <Textarea
                className="mt-3"
                label={t('caring_workflow.paper_onboarding.note_label')}
                placeholder={t('caring_workflow.paper_onboarding.note_placeholder')}
                value={paperNote}
                onValueChange={setPaperNote}
              />
            )}

            {paperIntakes.length > 0 && (
              <div className="mt-4 space-y-2">
                {paperIntakes.map((intake) => {
                  const fields = intake.corrected_fields ?? intake.extracted_fields ?? {};
                  return (
                    <div key={intake.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {fields.name || intake.original_filename}
                        </p>
                        <p className="text-xs text-muted">
                          {fields.email || t('caring_workflow.paper_onboarding.no_email')} · {intake.original_filename}
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" onPress={() => startPaperReview(intake)}>
                        {t('caring_workflow.paper_onboarding.review_cta')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label={t('caring_workflow.assisted_onboarding.name_label')}
              placeholder={t('caring_workflow.assisted_onboarding.name_placeholder')}
              value={onboardingName}
              onValueChange={setOnboardingName}
              isRequired
            />
            <Input
              type="email"
              label={t('caring_workflow.assisted_onboarding.email_label')}
              placeholder={t('caring_workflow.assisted_onboarding.email_placeholder')}
              value={onboardingEmail}
              onValueChange={setOnboardingEmail}
              isRequired
            />
            <Input
              label={t('caring_workflow.assisted_onboarding.phone_label')}
              placeholder={t('caring_workflow.assisted_onboarding.phone_placeholder')}
              value={onboardingPhone}
              onValueChange={setOnboardingPhone}
            />
            <Input
              label={t('caring_workflow.assisted_onboarding.note_label')}
              placeholder={t('caring_workflow.assisted_onboarding.note_placeholder')}
              value={onboardingNote}
              onValueChange={setOnboardingNote}
            />
          </div>
          <Button
            variant="primary"
            startContent={<UserPlus size={16} />}
            isLoading={onboardingLoading}
            onPress={submitAssistedOnboarding}
          >
            {t('caring_workflow.assisted_onboarding.create_cta')}
          </Button>

          {onboardingResult && (
            <div className="rounded-lg border border-success-200 bg-success-50 p-4">
              <p className="text-sm font-semibold text-success-700">
                {t('caring_workflow.assisted_onboarding.created_for', { name: onboardingResult.user.name, email: onboardingResult.user.email })}
              </p>
              <p className="mt-2 text-xs text-muted">
                {t('caring_workflow.assisted_onboarding.password_note')}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 rounded bg-surface-secondary px-3 py-2 text-sm font-mono text-foreground">
                  {onboardingResult.temp_password}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  startContent={<Copy size={14} />}
                  onPress={copyTempPassword}
                >
                  {onboardingCopied ? t('caring_workflow.assisted_onboarding.copied') : t('caring_workflow.assisted_onboarding.copy')}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Invite Codes card */}
      <Card className="mt-6" >
        <CardHeader className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t('caring_workflow.invite_codes.title')}</h2>
            <p className="mt-1 text-sm text-muted">
              {t('caring_workflow.invite_codes.description')}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            isLoading={loadingInviteCodes}
            onPress={loadInviteCodes}
          >
            {t('caring_workflow.actions.refresh')}
          </Button>
        </CardHeader>
        <Separator />
        <CardBody className="gap-4">
          {/* Generate form */}
          <div className="flex flex-wrap items-end gap-3">
            <Input
              className="flex-1"
              label={t('caring_workflow.invite_codes.label')}
              placeholder={t('caring_workflow.invite_codes.label_placeholder')}
              value={inviteLabel}
              onValueChange={setInviteLabel}
            />
            <Button
              variant="primary"
              startContent={<Plus size={16} />}
              isLoading={generatingCode}
              onPress={generateInviteCode}
            >
              {t('caring_workflow.invite_codes.generate')}
            </Button>
          </div>

          {/* Result box */}
          {generatedCode && (
            <div className="rounded-lg border border-success-200 bg-success-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">{t('caring_workflow.invite_codes.new_code')}</p>
                  <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-success-700">
                    {generatedCode.code}
                  </p>
                  {generatedCode.label && (
                    <p className="mt-1 text-xs text-foreground">{generatedCode.label}</p>
                  )}
                  <p className="mt-1 text-xs text-muted">
                    {t('caring_workflow.invite_codes.expires', { date: new Date(generatedCode.expires_at).toLocaleDateString(getFormattingLocale()) })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    startContent={<Copy size={14} />}
                    onPress={() => copyInviteCode(generatedCode.invite_url)}
                  >
                    {codeCopied ? t('caring_workflow.invite_codes.copied') : t('caring_workflow.invite_codes.copy_url')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    startContent={<Printer size={14} />}
                    onPress={() => printInviteCard(generatedCode)}
                  >
                    {t('caring_workflow.invite_codes.print_card')}
                  </Button>
                  <Button
                    as="a"
                    href={generatedCode.invite_url}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    variant="secondary"
                    startContent={<ExternalLink size={14} />}
                  >
                    {t('caring_workflow.invite_codes.open')}
                  </Button>
                </div>
              </div>

              {/* Print card — hidden on screen, visible when printing */}
              {printCodeId === generatedCode.id && (
                <div className="hidden print:block">
                  <PrintableInviteCard
                    code={generatedCode.code}
                    label={generatedCode.label}
                    inviteUrl={generatedCode.invite_url}
                    expiresAt={generatedCode.expires_at}
                  />
                </div>
              )}
            </div>
          )}

          {/* Recent codes table */}
          {inviteCodes.length > 0 && (
            <Table aria-label={t('caring_workflow.invite_codes.table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('caring_workflow.invite_codes.columns.code')}</TableColumn>
                <TableColumn>{t('caring_workflow.invite_codes.columns.label')}</TableColumn>
                <TableColumn>{t('caring_workflow.invite_codes.columns.expires')}</TableColumn>
                <TableColumn>{t('caring_workflow.invite_codes.columns.status')}</TableColumn>
                <TableColumn>{t('caring_workflow.invite_codes.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                  {inviteCodes.map((ic) => (
                    <TableRow key={ic.id}>
                      <TableCell className="font-mono font-semibold tracking-wider text-foreground">{ic.code}</TableCell>
                      <TableCell className="text-foreground">{ic.label ?? t('caring_workflow.empty.value')}</TableCell>
                      <TableCell className="text-muted">{new Date(ic.expires_at).toLocaleDateString(getFormattingLocale())}</TableCell>
                      <TableCell>
                        <Chip
                          size="sm"
                          variant="soft"
                          color={ic.status === 'active' ? 'success' : ic.status === 'used' ? 'default' : 'warning'}
                        >
                          {ic.status === 'active'
                            ? t('caring_workflow.invite_codes.status.active')
                            : ic.status === 'used'
                              ? (ic.used_by ? t('caring_workflow.invite_codes.status.used_by', { name: ic.used_by }) : t('caring_workflow.invite_codes.status.used'))
                              : t('caring_workflow.invite_codes.status.expired')}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            isIconOnly
                            variant="tertiary"
                            aria-label={t('caring_workflow.invite_codes.copy_url')}
                            onPress={() => copyInviteCode(ic.invite_url)}
                          >
                            <Copy size={14} />
                          </Button>
                          {ic.status === 'active' && (
                            <Button
                              size="sm"
                              isIconOnly
                              variant="tertiary"
                              aria-label={t('caring_workflow.invite_codes.print_card')}
                              onPress={() => printInviteCard(ic)}
                            >
                              <Printer size={14} />
                            </Button>
                          )}
                        </div>
                        {/* Print card for this row */}
                        {printCodeId === ic.id && (
                          <div className="hidden print:block">
                            <PrintableInviteCard
                              code={ic.code}
                              label={ic.label}
                              inviteUrl={ic.invite_url}
                              expiresAt={ic.expires_at}
                            />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}

          {inviteCodes.length === 0 && !loadingInviteCodes && (
            <div className="rounded-lg bg-surface-secondary p-3 text-sm text-muted">
              {t('caring_workflow.invite_codes.empty')}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6" >
        <CardHeader>
          <div>
            <h2 className="text-lg font-semibold">{t('caring_workflow.stages.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('caring_workflow.stages.description')}</p>
          </div>
        </CardHeader>
        <Separator />
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {workflowStages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <div key={stage.key} className="rounded-lg border border-border p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon size={18} />
                  </div>
                  <Chip size="sm" variant="soft">{index + 1}</Chip>
                </div>
                <p className="text-sm font-semibold text-foreground">{t(`caring_workflow.stages.${stage.key}.title`)}</p>
                <p className="mt-1 text-xs text-muted">{t(`caring_workflow.stages.${stage.key}.description`)}</p>
              </div>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}

function SignalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
      <span className="text-sm text-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value.toLocaleString(getFormattingLocale())}</span>
    </div>
  );
}

function PolicySwitch({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-1 text-xs text-muted">{description}</p>
      </div>
      <Switch isSelected={value} onValueChange={onChange} aria-label={label} />
    </div>
  );
}

function PrintableInviteCard({
  code,
  label,
  inviteUrl,
  expiresAt,
}: {
  code: string;
  label: string | null;
  inviteUrl: string;
  expiresAt: string;
}) {
  const { t } = useTranslation('admin_caring_community');

  return (
    <div className="mx-auto max-w-[400px] rounded-xl border-[3px] border-foreground p-8 text-center font-serif">
      <p className="mb-1 text-[13px] font-semibold uppercase tracking-wider text-muted">
        {t('caring_workflow.invite_card.brand')}
      </p>
      <p className="mb-5 text-[13px] text-muted">
        {t('caring_workflow.invite_card.subtitle')}
      </p>
      <div className="mb-5 inline-block rounded-lg border-2 border-foreground bg-surface px-6 py-4 dark:bg-surface-secondary">
        <span className="font-mono text-[40px] font-bold tracking-[0.25em] text-foreground">
          {code}
        </span>
      </div>
      {label && (
        <p className="mb-3 text-sm italic text-foreground">{label}</p>
      )}
      <p className="mb-2 text-xs text-foreground">
        {t('caring_workflow.invite_card.instructions')}
      </p>
      <p className="break-all font-mono text-[11px] text-foreground">{inviteUrl}</p>
      <p className="mt-3 text-[11px] text-muted">
        {t('caring_workflow.invite_card.valid_until', { date: new Date(expiresAt).toLocaleDateString(getFormattingLocale()) })}
      </p>
    </div>
  );
}
