// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Onboarding Page
 *
 * Member-growth cockpit for brokers: KPI cards derived from the onboarding
 * funnel, a stage-by-stage funnel visualisation with conversion rates
 * between stages, a month-over-month registrations trend chart (Recharts,
 * hidden gracefully when the API doesn't provide monthly data), and the
 * pending-members approval queue.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ArrowDown from 'lucide-react/icons/arrow-down';
import ArrowRight from 'lucide-react/icons/arrow-right';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Clock from 'lucide-react/icons/clock';
import ExternalLink from 'lucide-react/icons/external-link';
import Filter from 'lucide-react/icons/filter';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';
import TrendingDown from 'lucide-react/icons/trending-down';
import TrendingUp from 'lucide-react/icons/trending-up';
import UserCheck from 'lucide-react/icons/user-check';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';

import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { adminCrm, adminUsers } from '@/admin/api/adminApi';
import type { AdminUser, CrmFunnelStage } from '@/admin/api/types';
import { DataTable, ConfirmModal } from '@/admin/components';
import type { Column } from '@/admin/components';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Avatar,
  Progress,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerSkeleton,
  BrokerEmptyState,
} from '../components';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MonthlyRegistration {
  month: string; // 'YYYY-MM'
  count: number;
}

interface FunnelData {
  stages: CrmFunnelStage[];
  /** Present on newer APIs — last 6 months of registrations. Older API
   *  responses omit it entirely, so the trend section hides gracefully. */
  monthly_registrations?: MonthlyRegistration[];
}

const PAGE_SIZE = 20;

const cardClass = 'rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type FunnelTone = 'success' | 'warning' | 'danger';

/** Bar tone by share-of-entry — mirrors the pre-restyle thresholds. */
function shareTone(pct: number): FunnelTone {
  if (pct > 60) return 'success';
  if (pct > 30) return 'warning';
  return 'danger';
}

/** Conversion chip tone between stages — healthy handoffs read green. */
function rateTone(rate: number): FunnelTone {
  if (rate >= 70) return 'success';
  if (rate >= 40) return 'warning';
  return 'danger';
}

// Tailwind JIT needs full class names at build time — dynamic `from-${tone}` won't compile.
const barGradientClass: Record<FunnelTone, string> = {
  success: 'bg-gradient-to-r from-success/90 to-success/50',
  warning: 'bg-gradient-to-r from-warning/90 to-warning/50',
  danger: 'bg-gradient-to-r from-danger/90 to-danger/50',
};

/**
 * 'YYYY-MM' → locale-aware short month label. Constructs the date from local
 * year/month parts (first of the month) instead of parsing the ISO string,
 * which jsdom/browsers treat as UTC midnight — that shifts the label into the
 * previous month in negative-offset timezones.
 */
function formatMonthLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return new Date(year, monthIndex, 1).toLocaleDateString(getFormattingLocale(), {
    month: 'short',
    year: 'numeric',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const { tenantPath } = useTenant();
  usePageTitle(t('onboarding.page_title'));

  // Funnel state
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [funnelError, setFunnelError] = useState(false);

  // Pending members state
  const [members, setMembers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState(false);

  // Approve confirmation
  const [approveUser, setApproveUser] = useState<AdminUser | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Stash the latest `t`/`toast` in refs so the fetch callbacks are keyed on
  // params only — otherwise a language switch or toast identity churn would
  // refetch the whole page (see BrokerDashboardPage for the same pattern).
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // ─── Fetch funnel ─────────────────────────────────────────────────────────

  const fetchFunnel = useCallback(async () => {
    setFunnelLoading(true);
    setFunnelError(false);
    try {
      const res = await adminCrm.getFunnel();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (payload && typeof payload === 'object' && 'stages' in (payload as Record<string, unknown>)) {
          setFunnel(payload as FunnelData);
        }
      } else {
        setFunnelError(true);
      }
    } catch {
      // No toast — the funnel is non-critical; the card renders an honest
      // inline error state with a retry button instead.
      setFunnelError(true);
    } finally {
      setFunnelLoading(false);
    }
  }, []);

  // ─── Fetch pending members ────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(false);
    try {
      const res = await adminUsers.list({
        status: 'pending',
        page,
        limit: PAGE_SIZE,
      });
      if (res.success && res.data) {
        // api client unwrap: res.data is the row array, res.meta the pagination
        // meta — meta.total is the full collection size (drives pagination).
        const payload = res.data as unknown;
        const rows = Array.isArray(payload)
          ? (payload as AdminUser[])
          : ((payload as { data?: AdminUser[] }).data ?? []);
        setMembers(rows);
        const metaTotal =
          res.meta?.total ?? (payload as { meta?: { total?: number } })?.meta?.total;
        setTotal(typeof metaTotal === 'number' ? metaTotal : rows.length);
      }
    } catch {
      setMembersError(true);
      toastRef.current.error(tRef.current('common.error'));
    } finally {
      setMembersLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchFunnel();
  }, [fetchFunnel]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const refreshAll = () => {
    fetchFunnel();
    fetchMembers();
  };

  // ─── Approve action ───────────────────────────────────────────────────────

  const handleApprove = async () => {
    if (!approveUser) return;
    setActionLoading(true);
    try {
      const res = await adminUsers.approve(approveUser.id);
      if (res.success) {
        toast.success(t('members.approved_success'));
        setApproveUser(null);
        fetchMembers();
        // Approving a member shifts their funnel stage — refetch the funnel
        // counts so the visualisation stays consistent with the table.
        fetchFunnel();
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Funnel derivations ───────────────────────────────────────────────────

  const stages = funnel?.stages ?? [];
  const maxCount = stages.length > 0 ? (stages[0]?.count ?? 1) : 1;

  const getStageCode = (stage: CrmFunnelStage) => stage.code || 'unknown';
  const getStageLabel = (stage: CrmFunnelStage) =>
    t(`onboarding.stage_${getStageCode(stage)}`, {
      defaultValue: t('onboarding.stage_unknown'),
    });

  const firstStage = stages[0];
  const lastStage = stages[stages.length - 1];
  const overallConversion =
    firstStage && firstStage.count > 0 && lastStage
      ? ((lastStage.count / firstStage.count) * 100).toFixed(1)
      : null;

  // The stage transition with the lowest conversion — where members drop off most.
  let biggestDropoff: { name: string; rate: number } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    const cur = stages[i];
    if (prev && prev.count > 0 && cur) {
      const rate = Math.round((cur.count / prev.count) * 1000) / 10;
      if (biggestDropoff === null || rate < biggestDropoff.rate) {
        biggestDropoff = { name: getStageLabel(cur), rate };
      }
    }
  }

  // ─── Monthly registrations trend (newer API only) ─────────────────────────

  const monthlyRaw = funnel?.monthly_registrations;
  const monthly: MonthlyRegistration[] = Array.isArray(monthlyRaw)
    ? monthlyRaw.filter(
        (m): m is MonthlyRegistration =>
          !!m && typeof m.month === 'string' && typeof m.count === 'number',
      )
    : [];

  const latestMonth = monthly.length > 0 ? monthly[monthly.length - 1] : undefined;
  const prevMonth = monthly.length > 1 ? monthly[monthly.length - 2] : undefined;
  const momDelta =
    latestMonth && prevMonth && prevMonth.count > 0
      ? Math.round(((latestMonth.count - prevMonth.count) / prevMonth.count) * 1000) / 10
      : undefined;
  const registrationsTrend = monthly.length >= 2 ? monthly.map((m) => m.count) : undefined;

  // ─── Table columns ────────────────────────────────────────────────────────

  const columns: Column<AdminUser>[] = useMemo(
    () => [
      {
        key: 'name',
        label: t('members.col_name'),
        sortable: true,
        render: (user: AdminUser) => (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              src={user.avatar_url || user.avatar || undefined}
              name={user.name}
              size="sm"
              className="shrink-0"
            />
            <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
          </div>
        ),
      },
      {
        key: 'email',
        label: t('members.col_email'),
        sortable: true,
        render: (user: AdminUser) => (
          <span className="truncate text-sm text-muted">{user.email}</span>
        ),
      },
      {
        key: 'created_at',
        label: t('members.col_joined'),
        sortable: true,
        render: (user: AdminUser) => (
          <span className="text-sm tabular-nums text-muted">
            {formatServerDate(user.created_at)}
          </span>
        ),
      },
      {
        key: 'actions',
        label: t('members.col_actions'),
        render: (user: AdminUser) => (
          <Dropdown>
            <DropdownTrigger>
              <Button isIconOnly variant="light" size="sm" aria-label={t('members.col_actions')}>
                <MoreVertical size={16} aria-hidden="true" />
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label={t('members.col_actions')}>
              <DropdownItem
                key="approve" id="approve"
                startContent={<UserCheck size={14} />}
                onPress={() => setApproveUser(user)}
              >
                {t('members.approve')}
              </DropdownItem>
              <DropdownItem
                key="view" id="view"
                startContent={<ExternalLink size={14} />}
                onPress={() =>
                  window.open(tenantPath(`/profile/${user.id}`), '_blank')
                }
              >
                {t('members.view_profile')}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        ),
      },
    ],
    [t, tenantPath],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_reports', articleId: 'broker_onboarding_funnel' }}
      title={t('onboarding.title')}
      description={t('onboarding.description')}
      icon={UserPlus}
      color="accent"
      actions={
        <Button
          variant="tertiary"
          size="sm"
          startContent={<RefreshCw size={16} />}
          onPress={refreshAll}
          isLoading={funnelLoading && membersLoading}
        >
          {t('common.refresh')}
        </Button>
      }
    >
      {/* ── KPI cards — derived from the funnel + pending queue ──────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <BrokerStatCard
          label={t('onboarding.kpi_registered')}
          value={firstStage?.count ?? null}
          icon={Users}
          color="accent"
          loading={funnelLoading}
          delta={momDelta}
          deltaLabel={t('onboarding.kpi_vs_last_month')}
          trend={registrationsTrend}
        />
        <BrokerStatCard
          label={t('onboarding.kpi_conversion')}
          value={overallConversion !== null ? `${overallConversion}%` : null}
          icon={TrendingUp}
          color="success"
          loading={funnelLoading}
        />
        <BrokerStatCard
          label={t('onboarding.kpi_pending')}
          value={membersError ? null : total}
          icon={Clock}
          color="warning"
          loading={membersLoading}
        />
        <BrokerStatCard
          label={t('onboarding.kpi_dropoff')}
          value={biggestDropoff ? `${biggestDropoff.rate}%` : null}
          icon={TrendingDown}
          color="danger"
          loading={funnelLoading}
          description={biggestDropoff ? biggestDropoff.name : t('onboarding.kpi_none')}
        />
      </div>

      {/* ── Onboarding funnel ─────────────────────────────────────────────── */}
      {funnelLoading ? (
        <BrokerSkeleton variant="table" count={4} className="mb-6" />
      ) : (
        <Card className={`${cardClass} mb-6`}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-current/10"
              aria-hidden="true"
            >
              <Filter size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t('onboarding.funnel_title')}
              </h2>
              <p className="text-sm text-muted">{t('onboarding.funnel_subtitle')}</p>
            </div>
          </CardHeader>
          <CardBody>
            {funnelError ? (
              <BrokerEmptyState
                bare
                icon={AlertCircle}
                color="danger"
                title={t('onboarding.funnel_error_title')}
                hint={t('onboarding.funnel_error_hint')}
                action={
                  <Button size="sm" variant="danger-soft" onPress={fetchFunnel}>
                    {t('onboarding.retry')}
                  </Button>
                }
              />
            ) : stages.length === 0 ? (
              <BrokerEmptyState
                bare
                icon={Users}
                color="neutral"
                title={t('common.no_data')}
              />
            ) : (
              <div className="space-y-2">
                {stages.map((stage, index) => {
                  const pct = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
                  const prevStage = index > 0 ? stages[index - 1] : undefined;
                  const conversionRate =
                    prevStage && prevStage.count > 0
                      ? Math.round((stage.count / prevStage.count) * 1000) / 10
                      : null;
                  const label = getStageLabel(stage);
                  const tone = shareTone(pct);

                  return (
                    <div key={getStageCode(stage)}>
                      {/* Conversion rate between stages */}
                      {index > 0 && (
                        <div className="flex items-center justify-center gap-2 py-1.5">
                          <ArrowDown size={14} className="text-muted/60" aria-hidden="true" />
                          {conversionRate !== null && (
                            <Chip
                              size="sm"
                              variant="soft"
                              color={rateTone(conversionRate)}
                              className="tabular-nums"
                            >
                              {conversionRate}%
                            </Chip>
                          )}
                          <ArrowDown size={14} className="text-muted/60" aria-hidden="true" />
                        </div>
                      )}

                      {/* Stage bar */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                        <div className="min-w-0 sm:w-44 sm:shrink-0">
                          <p className="truncate text-sm font-medium text-foreground">{label}</p>
                          <p className="text-xs tabular-nums text-muted">
                            {stage.count.toLocaleString(getFormattingLocale())}
                          </p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <Progress
                            value={pct}
                            size="lg"
                            color={tone}
                            aria-label={`${label}: ${Math.round(pct)}%`}
                            classNames={{
                              track: 'h-6 rounded-full bg-surface-secondary',
                              indicator: `h-6 rounded-full ${barGradientClass[tone]}`,
                            }}
                          />
                        </div>
                        <div className="text-left sm:w-16 sm:shrink-0 sm:text-right">
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {Math.round(pct)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Overall conversion */}
                {stages.length >= 2 && firstStage && lastStage && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-divider/70 bg-surface-secondary/60 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
                      <span className="truncate">
                        {getStageLabel(firstStage)}
                      </span>
                      <ArrowRight size={14} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">
                        {getStageLabel(lastStage)}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-muted">{t('onboarding.kpi_conversion')}</span>
                      <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                        {overallConversion !== null ? `${overallConversion}%` : '—'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Monthly registrations trend — hidden when the API omits it ───── */}
      {!funnelLoading && !funnelError && monthly.length > 0 && (
        <Card className={`${cardClass} mb-6`}>
          <CardHeader className="flex items-center gap-3 pb-0">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-current/10"
              aria-hidden="true"
            >
              <CalendarDays size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t('onboarding.trend_title')}
              </h2>
              <p className="text-sm text-muted">{t('onboarding.trend_subtitle')}</p>
            </div>
            {momDelta !== undefined && (
              <div className="flex shrink-0 items-center gap-2">
                <Chip
                  size="sm"
                  variant="soft"
                  color={momDelta >= 0 ? 'success' : 'danger'}
                  className="tabular-nums"
                >
                  {momDelta > 0 ? '+' : ''}
                  {momDelta}%
                </Chip>
                <span className="hidden text-xs text-muted sm:inline">
                  {t('onboarding.kpi_vs_last_month')}
                </span>
              </div>
            )}
          </CardHeader>
          <CardBody>
            <div className="h-64" role="img" aria-label={t('onboarding.trend_aria')}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 12, right: 10, left: -12, bottom: 6 }}>
                  <defs>
                    <linearGradient id="brokerOnboardingTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" className="opacity-20" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => formatMonthLabel(String(value))}
                  />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    labelFormatter={(value) => formatMonthLabel(String(value))}
                    formatter={(value) =>
                      [
                        Number(value ?? 0).toLocaleString(getFormattingLocale()),
                        t('onboarding.trend_registrations'),
                      ] as [string, string]
                    }
                    contentStyle={{
                      borderRadius: '16px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--overlay)',
                      color: 'var(--overlay-foreground)',
                      boxShadow: '0 18px 50px rgba(15, 23, 42, 0.12)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="var(--accent)"
                    strokeWidth={3}
                    fill="url(#brokerOnboardingTrendFill)"
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Pending approvals queue ───────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t('onboarding.pending_approvals')}
        </h2>
        {!membersLoading && total > 0 && (
          <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
            {total.toLocaleString(getFormattingLocale())}
          </Chip>
        )}
      </div>
      <DataTable<AdminUser>
        columns={columns}
        data={members}
        keyField="id"
        isLoading={membersLoading}
        searchable={false}
        totalItems={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onRefresh={fetchMembers}
        emptyContent={
          membersError ? (
            <BrokerEmptyState
              bare
              icon={AlertCircle}
              color="danger"
              title={t('onboarding.members_error_title')}
              hint={t('onboarding.members_error_hint')}
              action={
                <Button size="sm" variant="danger-soft" onPress={fetchMembers}>
                  {t('onboarding.retry')}
                </Button>
              }
            />
          ) : (
            <BrokerEmptyState
              bare
              icon={Sparkles}
              color="success"
              title={t('onboarding.empty_pending_title')}
              hint={t('onboarding.no_pending')}
            />
          )
        }
      />

      {/* Approve confirmation */}
      <ConfirmModal
        isOpen={!!approveUser}
        onClose={() => setApproveUser(null)}
        onConfirm={handleApprove}
        title={t('members.confirm_approve_title')}
        message={t('members.confirm_approve_message')}
        confirmLabel={t('members.approve')}
        cancelLabel={t('common.cancel')}
        confirmColor="primary"
        isLoading={actionLoading}
      />
    </BrokerPageShell>
  );
}
