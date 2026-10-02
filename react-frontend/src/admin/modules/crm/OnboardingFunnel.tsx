// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Onboarding Funnel
 *
 * How far members have got since joining, and who is waiting at each step.
 * Data source: GET /api/v2/admin/crm/funnel
 *
 * Every stage count is "members who reached this step OR went further", so
 * the numbers only fall down the page and every percentage is a share of all
 * members. The page used to divide each stage by the one before it, on counts
 * that were not nested, and showed step rates such as 500%.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CalendarDays from 'lucide-react/icons/calendar-days';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import Hourglass from 'lucide-react/icons/hourglass';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Repeat from 'lucide-react/icons/repeat';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';
import type { LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Avatar, Button, Card, CardBody, CardHeader, Progress, Spinner } from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { formatPercentValue, getFormattingLocale, resolveAvatarUrl } from '@/lib/helpers';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminCrm } from '../../api/adminApi';
import type { CrmFunnelData, CrmFunnelStage } from '../../api/types';

interface Step extends CrmFunnelStage {
  title: string;
  description: string;
  waitingDescription: string;
  percent: number;
  isLast: boolean;
}

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

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  accentClassName: string;
}

function StatTile({ icon: Icon, label, value, hint, accentClassName }: StatTileProps) {
  return (
    <Card className="border border-border">
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

export default function OnboardingFunnel() {
  const { t } = useTranslation('admin_crm');
  useAdminPageMeta({ title: t('crm.onboarding_funnel_title') });

  const toast = useToast();
  const { tenantPath } = useTenant();

  const [data, setData] = useState<CrmFunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminCrm.getFunnel();
      setData(res.data as CrmFunnelData);
    } catch {
      setError(t('crm.failed_to_load_onboarding_funnel_data'));
      toast.error(t('crm.failed_to_load_onboarding_funnel_data'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const steps = useMemo<Step[]>(() => {
    const stages = data?.stages ?? [];
    const total = data?.total_members ?? stages[0]?.count ?? 0;
    return stages.map((stage, index) => ({
      ...stage,
      title: t(`crm.funnel_step_${stage.code}_title`, { defaultValue: t('crm.funnel_stage_unknown') }),
      description: t(`crm.funnel_step_${stage.code}_desc`, { defaultValue: '' }),
      waitingDescription: t(`crm.funnel_step_${stage.code}_waiting`, { defaultValue: '' }),
      percent: total > 0 ? (stage.count / total) * 100 : 0,
      isLast: index === stages.length - 1,
    }));
  }, [data, t]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[420px] items-center justify-center" role="status" aria-busy="true">
        <Spinner size="lg" label={t('crm.loading_funnel')} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="mx-auto max-w-3xl border border-danger/20">
        <CardBody className="gap-4 p-8">
          <h1 className="text-2xl font-semibold text-foreground">{t('crm.onboarding_funnel_title')}</h1>
          <p className="text-muted">{error || t('crm.no_data_available')}</p>
          <div>
            <Button onPress={fetchData} startContent={<RefreshCw size={16} aria-hidden="true" />}>
              {t('crm.refresh')}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const total = data.total_members ?? steps[0]?.count ?? 0;
  const regulars = steps[steps.length - 1];
  const holdUp = steps
    .filter((step) => !step.isLast && (step.waiting ?? 0) > 0)
    .reduce<Step | null>((largest, step) => (!largest || (step.waiting ?? 0) > (largest.waiting ?? 0) ? step : largest), null);
  const thisMonth = currentMonthKey();
  const monthLabel = (month: string) =>
    month === thisMonth ? t('crm.funnel_month_so_far', { month: formatMonth(month) }) : formatMonth(month);

  const showWho = (code: string) => {
    setOpenStep(code);
    document.getElementById(`funnel-step-${code}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('crm.onboarding_funnel_title')}</h1>
          <p className="max-w-2xl text-base text-muted">{t('crm.funnel_intro')}</p>
        </div>
        <Button
          variant="secondary"
          onPress={fetchData}
          isLoading={loading}
          startContent={<RefreshCw size={16} aria-hidden="true" />}
          className="shrink-0"
        >
          {t('crm.refresh')}
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <StatTile
          icon={Users}
          label={t('crm.funnel_stat_members')}
          value={formatNumber(total)}
          hint={t('crm.funnel_stat_members_hint')}
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
          icon={UserPlus}
          label={t('crm.funnel_stat_new')}
          value={formatNumber(data.new_last_30_days ?? 0)}
          hint={t('crm.funnel_stat_new_hint')}
          accentClassName="bg-warning/10 text-warning"
        />
      </div>

      {total === 0 ? (
        <Card className="border border-border">
          <CardBody className="p-8 text-center text-muted">{t('crm.funnel_no_members')}</CardBody>
        </Card>
      ) : (
        <>
          {holdUp ? (
            <Card className="border border-warning/30 bg-warning/5">
              <CardBody className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Hourglass size={22} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-warning">{t('crm.funnel_hold_up_title')}</p>
                    <h2 className="text-lg font-semibold text-foreground">{holdUp.title}</h2>
                    <p className="text-foreground">{holdUp.waitingDescription}</p>
                    <p className="text-sm font-medium text-muted">
                      {t('crm.funnel_waiting_label', { waiting: formatNumber(holdUp.waiting ?? 0) })}
                    </p>
                  </div>
                </div>
                <Button variant="secondary" className="shrink-0" onPress={() => showWho(holdUp.code)}>
                  {t('crm.funnel_show_who')}
                </Button>
              </CardBody>
            </Card>
          ) : (
            <Card className="border border-success/30 bg-success/5">
              <CardBody className="flex flex-row items-start gap-3 p-5">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-foreground">{t('crm.funnel_all_clear_title')}</h2>
                  <p className="text-sm text-muted">{t('crm.funnel_all_clear_body')}</p>
                </div>
              </CardBody>
            </Card>
          )}

          <Card className="border border-border">
            <CardHeader className="flex flex-col items-start gap-1 px-6 pb-0 pt-6">
              <h2 className="text-xl font-semibold text-foreground">{t('crm.funnel_journey_title')}</h2>
              <p className="text-sm text-muted">{t('crm.funnel_journey_help')}</p>
            </CardHeader>
            <CardBody className="px-6 pb-6 pt-5">
              <ol className="space-y-3">
                {steps.map((step, index) => {
                  const waiting = step.waiting ?? 0;
                  const members = step.waiting_members ?? [];
                  const isOpen = openStep === step.code;
                  const listId = `funnel-step-${step.code}-members`;

                  return (
                    <li
                      key={step.code}
                      id={`funnel-step-${step.code}`}
                      className="scroll-mt-24 rounded-2xl border border-border bg-surface-secondary p-4 sm:p-5"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent"
                            aria-hidden="true"
                          >
                            {index + 1}
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
                        <p className="mt-3 text-sm text-success">{t('crm.funnel_final_step_note')}</p>
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
                            onPress={() => setOpenStep(isOpen ? null : step.code)}
                          >
                            {isOpen ? t('crm.funnel_hide_who') : t('crm.funnel_show_who')}
                          </Button>
                        </div>
                      ) : null}

                      {isOpen && !step.isLast && (
                        <div id={listId} className="mt-3 space-y-2">
                          <ul className="grid gap-2 sm:grid-cols-2">
                            {members.map((member) => (
                              <li key={member.id}>
                                <Link
                                  to={tenantPath(`/admin/users/${member.id}/edit`)}
                                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 transition-colors hover:border-accent/40 hover:bg-accent/5"
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
                                      </span>
                                    )}
                                  </span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                          {waiting > members.length && (
                            <p className="text-xs text-muted">
                              {t('crm.funnel_newest_shown', { shown: formatNumber(members.length), waiting: formatNumber(waiting) })}
                            </p>
                          )}
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

      <Card className="border border-border">
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
            <div className="h-[260px]">
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
          ) : (
            <p className="py-8 text-center text-sm text-muted">{t('crm.no_registration_data')}</p>
          )}
          <p className="mt-3 text-xs text-muted">{t('crm.funnel_monthly_partial_note')}</p>
        </CardBody>
      </Card>
    </div>
  );
}
