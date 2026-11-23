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
 *
 * Layout (23 Nov 2026). The page was three unlabelled rows of cards and two
 * tables. It now reads top to bottom: what is expected, one card per currency
 * (the two are never added together); the communities and who they pay; what
 * needs a look, each figure a link to Billing control already showing those
 * communities (`?show=`); then the two tables, which stack on a phone.
 */

import { Card, CardBody, CardHeader, Chip, Spinner, Button, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Separator } from '@/components/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Ban from 'lucide-react/icons/ban';
import Banknote from 'lucide-react/icons/banknote';
import Building2 from 'lucide-react/icons/building-2';
import CirclePause from 'lucide-react/icons/circle-pause';
import FileQuestion from 'lucide-react/icons/file-question';
import Info from 'lucide-react/icons/info';
import Network from 'lucide-react/icons/network';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { BillingDevelopmentNotice } from './BillingDevelopmentNotice';
import { Glance } from './Glance';

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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** "Euro", "British pound": the currency's own name in the reader's language. */
function currencyName(currency: Currency): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.DisplayNames([getFormattingLocale()], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A group of figures under its own small heading. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-sm font-semibold text-muted">{title}</h2>
      {children}
    </section>
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
  // Billing control, already showing only the communities a figure counts.
  const listOf = (show: 'no_plan' | 'over_limit' | 'paused') => tenantPath(`/platform-team/billing?show=${show}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('billing.revenue_title')}
        description={t('revenue.desc')}
        actions={
          <Button
            as={Link}
            to={tenantPath('/platform-team/billing')}
            variant="tertiary"
            size="sm"
          >
            {t('billing.back_to_billing')}
          </Button>
        }
      />

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
          {/* ── What the platform expects: one card per currency, never added together ── */}
          <Section id="revenue-expected" title={t('revenue.section_expected')}>
            {data.totals.length === 0 ? (
              <Card>
                <CardBody>
                  <p className="text-muted text-center py-4">{t('revenue.nothing_expected')}</p>
                </CardBody>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.totals.map((total) => (
                  <Card key={total.currency} data-testid={`revenue-total-${total.currency}`}>
                    <CardBody className="gap-4 p-5">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-soft-foreground">
                          <Banknote aria-hidden="true" className="size-4" />
                        </span>
                        <span className="inline-block first-letter:uppercase">{currencyName(total.currency)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-muted">{t('revenue.per_month')}</p>
                          <p className="text-3xl font-bold tabular-nums">{money(total.monthly, total.currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">{t('revenue.per_year')}</p>
                          <p className="text-3xl font-bold tabular-nums text-success">{money(total.yearly, total.currency)}</p>
                        </div>
                      </div>
                      {/* How many communities that figure comes from. */}
                      <p data-testid={`revenue-total-${total.currency}-communities`} className="text-xs text-muted">
                        {t('revenue.paying_platform')}: <span className="font-medium text-foreground">{number(total.communities)}</span>
                      </p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
            <p className="flex items-start gap-2 text-xs text-muted">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t('revenue.how_counted')}</span>
            </p>
          </Section>

          {/* ── Who pays whom ── */}
          <Section id="revenue-communities" title={t('revenue.section_communities')}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Glance icon={Building2} label={t('revenue.paying_platform')} value={number(data.paying_platform)} tone="accent" />
              <Glance icon={Network} label={t('revenue.paying_parent')} value={number(data.paying_parent)} tone="quiet" />
              <Glance icon={Ban} label={t('revenue.not_billed')} value={number(data.not_billed)} tone="quiet" />
              <Glance icon={Users} label={t('revenue.active_members')} value={number(data.active_members)} tone="quiet" />
            </div>
          </Section>

          {/* ── What needs a look: each opens Billing control on those communities ── */}
          <Section id="revenue-attention" title={t('revenue.section_attention')}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Glance
                icon={FileQuestion}
                label={t('revenue.without_plan')}
                value={number(data.without_plan)}
                tone={data.without_plan > 0 ? 'warning' : 'quiet'}
                to={listOf('no_plan')}
              />
              <Glance
                icon={AlertTriangle}
                label={t('revenue.over_limit')}
                value={number(data.over_limit)}
                tone={data.over_limit > 0 ? 'danger' : 'quiet'}
                to={listOf('over_limit')}
              />
              <Glance
                icon={CirclePause}
                label={t('revenue.paused')}
                value={number(data.paused)}
                tone={data.paused > 0 ? 'warning' : 'quiet'}
                to={listOf('paused')}
              />
            </div>
          </Section>

          {/* ── By plan ── */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold">{t('revenue.by_plan')}</h2>
            </CardHeader>
            <Separator />
            <CardBody className="p-0 max-sm:p-3">
              {/* Stacked, one plan to a block, on a phone: five columns do not fit one. */}
              <Table removeWrapper mobileCards aria-label={t('revenue.by_plan')}>
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
                      <TableCell className="tabular-nums">{number(row.communities)}</TableCell>
                      <TableCell className="tabular-nums">{number(row.paying_platform)}</TableCell>
                      <TableCell className="tabular-nums">{money(row.monthly_eur, 'eur')}</TableCell>
                      <TableCell className="tabular-nums">{showsPounds || row.monthly_gbp > 0 ? money(row.monthly_gbp, 'gbp') : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          {/* ── Latest changes ── */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold">{t('revenue.recent')}</h2>
            </CardHeader>
            <Separator />
            <CardBody className="p-0 max-sm:p-3">
              <Table removeWrapper mobileCards aria-label={t('revenue.recent')}>
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
