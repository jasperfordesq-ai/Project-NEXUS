// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RevenueDashboard
 * Platform team only: what the platform itself expects to be paid, at
 * /platform-team/billing/revenue.
 *
 * The shape below is the one the server sends
 * (TenantBillingService::getRevenueDashboard()), pinned from the server's
 * side by tests/Laravel/Feature/Billing/RevenuePageTest.php. This page used
 * to read a field the server never sent and showed "NaN" in the plan table.
 */

import { Card, CardBody, CardHeader, Chip, Spinner, Button, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Separator } from '@/components/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import Banknote from 'lucide-react/icons/banknote';
import Building2 from 'lucide-react/icons/building-2';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, getFormattingLocale } from '@/lib/helpers';
import { BillingDevelopmentNotice } from './BillingDevelopmentNotice';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Currency = 'eur' | 'gbp';

export interface RevenueDashboardData {
  communities: number;
  with_plan: number;
  without_plan: number;
  paying_platform: number;
  paying_parent: number;
  not_billed: number;
  paused: number;
  over_limit: number;
  active_members: number;
  /** One entry per currency somebody pays the platform in. Never added together. */
  totals: Array<{ currency: Currency; monthly: number; yearly: number; communities: number }>;
  plan_breakdown: Array<{
    plan: string;
    communities: number;
    paying_platform: number;
    monthly_eur: number;
    monthly_gbp: number;
  }>;
  recent_changes: Array<{
    tenant_name: string;
    action: string;
    created_at: string;
    acted_by: string | null;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function money(amount: number, currency: Currency): string {
  return formatCurrency(amount, currency.toUpperCase(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type ChipColor = 'primary' | 'warning' | 'danger' | 'secondary' | 'default' | 'success';

/** Every action the billing log can hold, with its label and colour. */
const ACTIONS: Record<string, { label: string; color: ChipColor }> = {
  plan_assigned: { label: 'billing.action_plan_assigned', color: 'primary' },
  plan_changed: { label: 'revenue.action_plan_changed', color: 'primary' },
  grace_period_set: { label: 'billing.action_grace_period_set', color: 'warning' },
  plan_paused: { label: 'billing.action_plan_paused', color: 'danger' },
  plan_resumed: { label: 'billing.action_plan_resumed', color: 'success' },
  delegate_granted: { label: 'billing.action_delegate_granted', color: 'secondary' },
  delegate_revoked: { label: 'billing.action_delegate_revoked', color: 'danger' },
  standing_suspended: { label: 'revenue.action_standing_suspended', color: 'danger' },
  standing_restored: { label: 'revenue.action_standing_restored', color: 'success' },
  standing_paid_until_set: { label: 'revenue.action_standing_paid_until_set', color: 'success' },
  standing_payer_set: { label: 'revenue.action_standing_payer_set', color: 'default' },
  standing_exempted: { label: 'revenue.action_standing_exempted', color: 'secondary' },
  standing_exemption_removed: { label: 'revenue.action_standing_exemption_removed', color: 'warning' },
  standing_over_limit_rule_set: { label: 'revenue.action_standing_over_limit_rule_set', color: 'default' },
  standing_children_over_limit_rule_set: { label: 'revenue.action_standing_children_over_limit_rule_set', color: 'default' },
  hub_plan_terms_changed: { label: 'revenue.action_hub_plan_terms_changed', color: 'default' },
  upgrade_requested: { label: 'revenue.action_upgrade_requested', color: 'warning' },
  billing_setting_changed: { label: 'revenue.action_billing_setting_changed', color: 'default' },
};

const OTHER_ACTION = { label: 'revenue.action_other', color: 'default' as ChipColor };

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'default';
  icon?: React.ReactNode;
}

const colorClass: Record<string, string> = {
  primary: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  default: 'text-foreground',
};

function StatCard({ label, value, color = 'default', icon }: StatCardProps) {
  return (
    <Card className="p-1">
      <CardBody className="gap-2">
        <div className="flex items-center gap-2 text-muted text-sm">
          {icon}
          <span>{label}</span>
        </div>
        <p className={`text-2xl font-bold ${colorClass[color]}`}>{value}</p>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function RevenueDashboard() {
  const { t } = useTranslation('admin_billing');
  usePageTitle(t('billing.revenue_title'));
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const [data, setData] = useState<RevenueDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect non-god users silently
  useEffect(() => {
    if (user && !user.is_god) {
      navigate(tenantPath('/admin'), { replace: true });
    }
  }, [user, navigate, tenantPath]);

  useEffect(() => {
    if (!user?.is_god) return;

    setLoading(true);
    api
      .get<RevenueDashboardData>('/v2/admin/super/billing/revenue')
      .then((res) => {
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setError(t('billing.failed_to_load'));
        }
      })
      .catch(() => setError(t('billing.failed_to_load')))
      .finally(() => setLoading(false));
  }, [user, t]);

  if (!user?.is_god) return null;

  const number = (value: number) => value.toLocaleString(getFormattingLocale());
  const showsPounds = data?.plan_breakdown.some((row) => row.monthly_gbp > 0) ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('billing.revenue_title')}</h1>
          <p className="text-muted text-sm mt-1">{t('revenue.desc')}</p>
        </div>
        <Button
          as={Link}
          to={tenantPath('/platform-team/billing')}
          variant="tertiary"
          size="sm"
        >
          {t('billing.back_to_billing')}
        </Button>
      </div>

      <BillingDevelopmentNotice />

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <Card role="alert">
          <CardBody>
            <p className="text-danger text-center py-8">{error}</p>
          </CardBody>
        </Card>
      ) : data ? (
        <>
          {/* ── What the platform expects, one pair of cards per currency ── */}
          {data.totals.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-muted text-center py-4">{t('revenue.nothing_expected')}</p>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.totals.map((total) => [
                <StatCard
                  key={`${total.currency}-month`}
                  label={t('revenue.per_month')}
                  value={money(total.monthly, total.currency)}
                  icon={<Banknote aria-hidden="true" className="w-4 h-4" />}
                />,
                <StatCard
                  key={`${total.currency}-year`}
                  label={t('revenue.per_year')}
                  value={money(total.yearly, total.currency)}
                  color="success"
                  icon={<TrendingUp aria-hidden="true" className="w-4 h-4" />}
                />,
              ])}
            </div>
          )}
          <p className="text-sm text-muted">{t('revenue.how_counted')}</p>

          {/* ── Who pays whom ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label={t('revenue.paying_platform')}
              value={number(data.paying_platform)}
              icon={<Building2 aria-hidden="true" className="w-4 h-4" />}
            />
            <StatCard label={t('revenue.paying_parent')} value={number(data.paying_parent)} />
            <StatCard label={t('revenue.not_billed')} value={number(data.not_billed)} />
            <StatCard
              label={t('revenue.active_members')}
              value={number(data.active_members)}
              icon={<Users aria-hidden="true" className="w-4 h-4" />}
            />
          </div>

          {/* ── What needs a look ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label={t('revenue.without_plan')}
              value={number(data.without_plan)}
              color={data.without_plan > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label={t('revenue.over_limit')}
              value={number(data.over_limit)}
              color={data.over_limit > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label={t('revenue.paused')}
              value={number(data.paused)}
              color={data.paused > 0 ? 'warning' : 'default'}
            />
          </div>

          {/* ── By plan ── */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">{t('revenue.by_plan')}</h2>
            </CardHeader>
            <Separator />
            <CardBody className="p-0">
              <Table removeWrapper aria-label={t('revenue.by_plan')}>
                <TableHeader>
                  <TableColumn>{t('revenue.col_plan')}</TableColumn>
                  <TableColumn>{t('revenue.col_communities')}</TableColumn>
                  <TableColumn>{t('revenue.col_paying_platform')}</TableColumn>
                  <TableColumn>{t('revenue.col_month', { currency: 'EUR' })}</TableColumn>
                  <TableColumn>{t('revenue.col_month', { currency: 'GBP' })}</TableColumn>
                </TableHeader>
                <TableBody emptyContent={t('revenue.no_plans')}>
                  {data.plan_breakdown.map((row) => (
                    <TableRow key={row.plan}>
                      <TableCell className="font-medium">{row.plan}</TableCell>
                      <TableCell>{number(row.communities)}</TableCell>
                      <TableCell>{number(row.paying_platform)}</TableCell>
                      <TableCell>{money(row.monthly_eur, 'eur')}</TableCell>
                      <TableCell>{showsPounds || row.monthly_gbp > 0 ? money(row.monthly_gbp, 'gbp') : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          {/* ── Latest changes ── */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">{t('revenue.recent')}</h2>
            </CardHeader>
            <Separator />
            <CardBody className="p-0">
              <Table removeWrapper aria-label={t('revenue.recent')}>
                <TableHeader>
                  <TableColumn>{t('revenue.col_community')}</TableColumn>
                  <TableColumn>{t('revenue.col_change')}</TableColumn>
                  <TableColumn>{t('revenue.col_by')}</TableColumn>
                  <TableColumn>{t('revenue.col_date')}</TableColumn>
                </TableHeader>
                <TableBody emptyContent={t('revenue.no_changes')}>
                  {data.recent_changes.map((change, index) => {
                    const action = ACTIONS[change.action] ?? OTHER_ACTION;
                    return (
                      <TableRow key={`${change.created_at}-${change.tenant_name}-${change.action}-${index}`}>
                        <TableCell className="font-medium">{change.tenant_name || '—'}</TableCell>
                        <TableCell>
                          <Chip size="sm" variant="soft" color={action.color}>
                            {t(action.label)}
                          </Chip>
                        </TableCell>
                        <TableCell>{change.acted_by ?? t('revenue.automatic')}</TableCell>
                        <TableCell>{formatDate(change.created_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default RevenueDashboard;
