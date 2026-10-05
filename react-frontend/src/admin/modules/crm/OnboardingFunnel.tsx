// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Onboarding Funnel
 *
 * How far members have got since joining, and who is waiting at each step.
 * Data source: GET /api/v2/admin/crm/funnel (+ /export/funnel for the CSV).
 *
 * Every stage count is "members who reached this step OR went further", so
 * the numbers only fall down the page and every percentage is a share of all
 * members. The page used to divide each stage by the one before it, on counts
 * that were not nested, and showed step rates such as 500%.
 *
 * The cohort (everyone, or members who joined in the last 30 / 90 / 365 days)
 * and the step whose waiting list is open live in the address
 * (/admin/crm/funnel?joined=90&step=email_verified), so a reload, the back
 * button or a shared link lands on the same view, and the same cohort drives
 * the "who is waiting" CSV export.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Download from 'lucide-react/icons/download';
import Filter from 'lucide-react/icons/filter';
import HandHeart from 'lucide-react/icons/hand-heart';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Repeat from 'lucide-react/icons/repeat';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';
import type { LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Alert, Avatar, Button, Card, CardBody, CardHeader, Progress, Spinner,
  ToggleButton, ToggleButtonGroup,
} from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { formatPercentValue, getFormattingLocale, resolveAvatarUrl } from '@/lib/helpers';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminCrm } from '../../api/adminApi';
import type { CrmFunnelData, CrmFunnelStage } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';

// ----- Cohorts -----

/** Address values for ?joined=. 'all' is the default and is never written to the address. */
const COHORTS = ['all', '30', '90', '365'] as const;
type Cohort = typeof COHORTS[number];
const DEFAULT_COHORT: Cohort = 'all';
const isCohort = (value: string): value is Cohort => (COHORTS as readonly string[]).includes(value);

interface Step extends CrmFunnelStage {
  index: number;
  title: string;
  description: string;
  waitingDescription: string;
  percent: number;
  isLast: boolean;
}

// ----- Formatting -----

function formatNumber(value: number): string {
  return value.toLocaleString(getFormattingLocale());
}

function formatPercent(value: number): string {
  return formatPercentValue(value, { maximumFractionDigits: 0 });
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMonth(value: string): string {
  const parsed = /^\d{4}-\d{2}$/.test(value) ? parseDate(`${value}-01`) : null;
  return parsed
    ? parsed.toLocaleDateString(getFormattingLocale(), { month: 'short', year: 'numeric' })
    : value;
}

function formatDay(value: string): string {
  const parsed = parseDate(value);
  return parsed
    ? parsed.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    : value;
}

/**
 * "3 days ago", "2 weeks ago", "last month" — in the admin's language, with
 * the plural rules the browser already knows, so no translation key has to
 * carry a number.
 */
function formatJoinedAgo(value: string): string | null {
  const parsed = parseDate(value);
  if (!parsed) return null;
  const days = Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto' });
  if (days < 1) return rtf.format(0, 'day');
  if (days < 14) return rtf.format(-days, 'day');
  if (days < 61) return rtf.format(-Math.round(days / 7), 'week');
  if (days < 365) return rtf.format(-Math.round(days / 30), 'month');
  return rtf.format(-Math.round(days / 365), 'year');
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ----- Stat tile -----

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  accentClassName: string;
}

function StatTile({ icon: Icon, label, value, hint, accentClassName }: StatTileProps) {
  return (
    <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardBody className="flex flex-row items-start gap-4 p-5">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accentClassName}`}>
          <Icon size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-sm text-muted">{hint}</p>
        </div>
      </CardBody>
    </Card>
  );
}

// ----- Page -----

export default function OnboardingFunnel() {
  const { t } = useTranslation('admin_crm');
  useAdminPageMeta({ title: t('crm.onboarding_funnel_title') });

  const toast = useToast();
  const { tenantPath } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- The address is the source of truth -----
  const cohortParam = searchParams.get('joined') || DEFAULT_COHORT;
  const cohort: Cohort = isCohort(cohortParam) ? cohortParam : DEFAULT_COHORT;
  const joinedDays = cohort === 'all' ? 0 : Number(cohort);
  const openStep = searchParams.get('step') || null;

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ----- Data -----
  const [data, setData] = useState<CrmFunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminCrm.getFunnel(joinedDays > 0 ? { joined_days: joinedDays } : undefined);
      setData(res.data as CrmFunnelData);
    } catch {
      setError(t('crm.failed_to_load_onboarding_funnel_data'));
      toast.error(t('crm.failed_to_load_onboarding_funnel_data'));
    } finally {
      setLoading(false);
    }
  }, [joinedDays, t, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async (step?: string) => {
    setExporting(step ?? 'all');
    try {
      await adminCrm.exportFunnel({
        joined_days: joinedDays > 0 ? joinedDays : undefined,
        step,
      });
      toast.success(t('crm.export_success'));
    } catch {
      toast.error(t('crm.export_failed'));
    } finally {
      setExporting(null);
    }
  };

  const steps = useMemo<Step[]>(() => {
    const stages = data?.stages ?? [];
    const total = data?.total_members ?? stages[0]?.count ?? 0;
    return stages.map((stage, index) => {
      const isLast = index === stages.length - 1;
      return {
        ...stage,
        index,
        title: t(`crm.funnel_step_${stage.code}_title`, { defaultValue: t('crm.funnel_stage_unknown') }),
        description: t(`crm.funnel_step_${stage.code}_desc`, { defaultValue: '' }),
        // Nobody waits at the final step, so it has no "waiting" sentence to look up.
        waitingDescription: isLast ? '' : t(`crm.funnel_step_${stage.code}_waiting`, { defaultValue: '' }),
        percent: total > 0 ? (stage.count / total) * 100 : 0,
        isLast,
      };
    });
  }, [data, t]);

  const cohortSelection = useMemo(() => new Set<Key>([cohort]), [cohort]);

  // ----- First load / failure -----

  if (loading && !data) {
    return (
      <div className="flex min-h-[420px] items-center justify-center" role="status" aria-busy="true">
        <Spinner size="lg" label={t('crm.loading_funnel')} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title={t('crm.onboarding_funnel_title')} description={t('crm.funnel_intro')} icon={<Filter size={20} />} />
        <Card className="border border-danger/30 bg-surface">
          <CardBody className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <TriangleAlert size={28} aria-hidden="true" />
            </div>
            <p className="text-foreground">{error || t('crm.failed_to_load_onboarding_funnel_data')}</p>
            <Button variant="secondary" onPress={fetchData} startContent={<RefreshCw size={16} aria-hidden="true" />}>
              {t('common.retry')}
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  // ----- Derived figures -----

  const total = data.total_members ?? steps[0]?.count ?? 0;
  const regulars = steps[steps.length - 1];
  const needNudge = Math.max(0, total - (regulars?.count ?? 0));
  const anyoneWaiting = steps.some((step) => !step.isLast && (step.waiting ?? 0) > 0);
  const holdUp = steps
    .filter((step) => !step.isLast && (step.waiting ?? 0) > 0)
    .reduce<Step | null>((largest, step) => (!largest || (step.waiting ?? 0) > (largest.waiting ?? 0) ? step : largest), null);
  const thisMonth = currentMonthKey();
  const monthLabel = (month: string) =>
    month === thisMonth ? t('crm.funnel_month_so_far', { month: formatMonth(month) }) : formatMonth(month);
  const summaryText = cohort === 'all'
    ? t('crm.funnel_summary_all', { total: formatNumber(total) })
    : t(`crm.funnel_summary_${cohort}`, { total: formatNumber(total) });

  const showWho = (code: string) => {
    updateParams({ step: code });
    document.getElementById(`funnel-step-${code}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('crm.onboarding_funnel_title')}
        description={t('crm.funnel_intro')}
        icon={<Filter size={20} />}
        actions={
          <>
            <Button
              variant="secondary"
              startContent={<Download size={16} aria-hidden="true" />}
              onPress={() => handleExport()}
              isLoading={exporting === 'all'}
              isDisabled={exporting !== null || !anyoneWaiting}
            >
              {t('crm.funnel_export')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} aria-hidden="true" />}
              onPress={() => { fetchData(); }}
              isDisabled={loading}
            >
              {t('crm.refresh')}
            </Button>
          </>
        }
      />

      {/* Cohort */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span id="funnel-cohort-label" className="text-sm font-medium text-muted">
            {t('crm.funnel_cohort_label')}
          </span>
          <ToggleButtonGroup
            aria-labelledby="funnel-cohort-label"
            selectionMode="single"
            disallowEmptySelection
            isDetached
            size="sm"
            selectedKeys={cohortSelection}
            onSelectionChange={(keys) => {
              const [key] = Array.from(keys);
              const next = key == null ? '' : String(key);
              updateParams({ joined: isCohort(next) && next !== DEFAULT_COHORT ? next : null, step: null });
            }}
            className="flex flex-wrap gap-2"
          >
            {COHORTS.map((value) => (
              <ToggleButton key={value} id={value}>{t(`crm.funnel_cohort_${value}`)}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>
        <p className="text-sm text-muted" aria-live="polite">{summaryText}</p>
      </div>

      {/* A cohort change or refresh keeps the figures on screen (dimmed)
          instead of blanking the page. */}
      <div
        className={`flex flex-col gap-6 pb-10 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}
        aria-busy={loading || undefined}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            icon={Users}
            label={t('crm.funnel_stat_members')}
            value={formatNumber(total)}
            hint={cohort === 'all' ? t('crm.funnel_stat_members_hint') : t('crm.funnel_stat_members_cohort_hint')}
            accentClassName="bg-accent/10 text-accent"
          />
          <StatTile
            icon={Repeat}
            label={t('crm.funnel_stat_regulars')}
            value={formatNumber(regulars?.count ?? 0)}
            hint={t('crm.funnel_stat_regulars_hint', { percent: formatPercent(regulars?.percent ?? 0) })}
            accentClassName="bg-success/10 text-success"
          />
          <StatTile
            icon={HandHeart}
            label={t('crm.funnel_stat_nudge')}
            value={formatNumber(needNudge)}
            hint={t('crm.funnel_stat_nudge_hint')}
            accentClassName="bg-warning/10 text-warning"
          />
          <StatTile
            icon={UserPlus}
            label={t('crm.funnel_stat_new')}
            value={formatNumber(data.new_last_30_days ?? 0)}
            hint={cohort === 'all' ? t('crm.funnel_stat_new_hint') : t('crm.funnel_stat_new_hint_cohort')}
            accentClassName="bg-accent/10 text-accent"
          />
        </div>

        {total === 0 ? (
          cohort === 'all' ? (
            <EmptyState icon={Users} title={t('crm.funnel_no_members')} />
          ) : (
            <EmptyState
              icon={Users}
              title={t('crm.funnel_no_members_cohort')}
              actionLabel={t('crm.funnel_show_everyone')}
              onAction={() => updateParams({ joined: null, step: null })}
            />
          )
        ) : (
          <>
            {holdUp ? (
              <Alert
                color="warning"
                title={t('crm.funnel_hold_up_title')}
                description={
                  <span className="block space-y-1">
                    <span className="block text-base font-semibold text-foreground">{holdUp.title}</span>
                    <span className="block">{holdUp.waitingDescription}</span>
                    <span className="block font-medium">
                      {t('crm.funnel_waiting_label', { waiting: formatNumber(holdUp.waiting ?? 0) })}
                    </span>
                  </span>
                }
                endContent={
                  <div className="flex shrink-0 items-center self-center">
                    <Button variant="secondary" size="sm" onPress={() => showWho(holdUp.code)}>
                      {t('crm.funnel_show_who')}
                    </Button>
                  </div>
                }
              />
            ) : (
              <Alert
                color="success"
                title={t('crm.funnel_all_clear_title')}
                description={t('crm.funnel_all_clear_body')}
              />
            )}

            <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
              <CardHeader className="flex flex-col items-start gap-1 px-6 pb-0 pt-6">
                <h2 className="text-xl font-semibold text-foreground">{t('crm.funnel_journey_title')}</h2>
                <p className="text-sm text-muted">{t('crm.funnel_journey_help')}</p>
              </CardHeader>
              <CardBody className="px-6 pb-6 pt-5">
                <ol className="space-y-3">
                  {steps.map((step) => {
                    const waiting = step.waiting ?? 0;
                    const members = step.waiting_members ?? [];
                    const isOpen = openStep === step.code;
                    const listId = `funnel-step-${step.code}-members`;

                    return (
                      <li
                        key={step.code}
                        id={`funnel-step-${step.code}`}
                        className="scroll-mt-24 rounded-2xl border border-divider/70 bg-surface-secondary p-4 sm:p-5"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent"
                              aria-hidden="true"
                            >
                              {step.index + 1}
                            </span>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-foreground">{step.title}</h3>
                              <p className="text-sm text-muted">{step.description}</p>
                            </div>
                          </div>
                          <div className="flex items-baseline gap-2 pl-11 sm:block sm:shrink-0 sm:pl-0 sm:text-right">
                            <p className="text-2xl font-semibold tracking-tight text-foreground">
                              {formatPercent(step.percent)}
                            </p>
                            <p className="text-sm text-muted">
                              {t('crm.funnel_step_reached', { reached: formatNumber(step.count), total: formatNumber(total) })}
                            </p>
                          </div>
                        </div>

                        <Progress
                          value={step.percent}
                          color={step.isLast ? 'success' : 'primary'}
                          aria-label={t('crm.funnel_step_progress_label', { step: step.title, percent: formatPercent(step.percent) })}
                          className="mt-3"
                          classNames={{ track: 'h-2.5', indicator: 'rounded-full' }}
                        />

                        {step.isLast ? (
                          <p className="mt-3 text-sm text-success-soft-foreground">{t('crm.funnel_final_step_note')}</p>
                        ) : waiting > 0 ? (
                          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-warning/20 bg-warning/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm">
                              <p className="font-medium text-foreground">
                                {t('crm.funnel_waiting_label', { waiting: formatNumber(waiting) })}
                              </p>
                              <p className="text-muted">{step.waitingDescription}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="shrink-0"
                              aria-expanded={isOpen}
                              aria-controls={listId}
                              onPress={() => updateParams({ step: isOpen ? null : step.code })}
                            >
                              {isOpen ? t('crm.funnel_hide_who') : t('crm.funnel_show_who')}
                            </Button>
                          </div>
                        ) : null}

                        {isOpen && !step.isLast && waiting > 0 && (
                          <div id={listId} className="mt-3 space-y-3">
                            <ul className="grid gap-2 sm:grid-cols-2">
                              {members.map((member) => {
                                const joinedAgo = member.joined_at ? formatJoinedAgo(member.joined_at) : null;
                                return (
                                  <li key={member.id}>
                                    <Link
                                      to={tenantPath(`/admin/users/${member.id}/edit`)}
                                      className="flex items-center gap-3 rounded-xl border border-divider/70 bg-surface px-3 py-2 transition-colors hover:border-accent/40 hover:bg-accent/5"
                                    >
                                      <Avatar
                                        src={member.avatar_url ? resolveAvatarUrl(member.avatar_url) : undefined}
                                        name={member.name}
                                        size="sm"
                                        className="shrink-0"
                                      />
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium text-foreground">{member.name}</span>
                                        {member.joined_at && (
                                          <span className="block text-xs text-muted">
                                            {t('crm.funnel_joined_on', { date: formatDay(member.joined_at) })}
                                            {joinedAgo ? ` · ${joinedAgo}` : ''}
                                          </span>
                                        )}
                                      </span>
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs text-muted">
                                {waiting > members.length
                                  ? t('crm.funnel_newest_shown', { shown: formatNumber(members.length), waiting: formatNumber(waiting) })
                                  : null}
                              </p>
                              <Button
                                size="sm"
                                variant="tertiary"
                                startContent={<Download size={14} aria-hidden="true" />}
                                onPress={() => handleExport(step.code)}
                                isLoading={exporting === step.code}
                                isDisabled={exporting !== null}
                                className="self-start sm:self-auto"
                              >
                                {t('crm.funnel_export_step')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </CardBody>
            </Card>
          </>
        )}

        <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
          <CardHeader className="flex flex-row items-start gap-3 px-6 pb-0 pt-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <CalendarDays size={18} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t('crm.funnel_monthly_title')}</h2>
              <p className="text-sm text-muted">{t('crm.funnel_monthly_desc')}</p>
            </div>
          </CardHeader>
          <CardBody className="px-6 pb-6 pt-5">
            {data.monthly_registrations.length > 0 ? (
              <>
                <div className="h-[260px]" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.monthly_registrations} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="4 4" className="opacity-20" />
                      <XAxis
                        dataKey="month"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => monthLabel(String(value))}
                      />
                      <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip
                        cursor={{ fillOpacity: 0.08 }}
                        labelFormatter={(value) => monthLabel(String(value))}
                        formatter={(value) => [formatNumber(Number(value ?? 0)), t('crm.funnel_chart_series')] as [string, string]}
                        contentStyle={{
                          borderRadius: '12px',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--overlay)',
                          color: 'var(--overlay-foreground)',
                        }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
                        {data.monthly_registrations.map((entry) => (
                          <Cell
                            key={entry.month}
                            fill="var(--accent)"
                            fillOpacity={entry.month === thisMonth ? 0.45 : 1}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* The same figures as a table, for screen readers and anyone who prefers numbers. */}
                <table className="sr-only">
                  <caption>{t('crm.funnel_chart_table_caption')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('crm.funnel_chart_col_month')}</th>
                      <th scope="col">{t('crm.funnel_chart_series')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthly_registrations.map((entry) => (
                      <tr key={entry.month}>
                        <th scope="row">{monthLabel(entry.month)}</th>
                        <td>{formatNumber(entry.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted">{t('crm.no_registration_data')}</p>
            )}
            <p className="mt-3 text-xs text-muted">{t('crm.funnel_monthly_partial_note')}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
