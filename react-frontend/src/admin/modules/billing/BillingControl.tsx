import { Alert, Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import CreditCard from 'lucide-react/icons/credit-card';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Leaf from 'lucide-react/icons/leaf';
import Download from 'lucide-react/icons/download';
import { usePageTitle } from '@/hooks';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber, getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { BillingDevelopmentNotice } from './BillingDevelopmentNotice';
import { BillingAutomationCard } from './BillingAutomationCard';
import { assignablePlans } from './assignablePlans';
import { planFactLines } from './planFactLines';
import { RecordPaymentDialog, type PaymentMethod } from './RecordPaymentDialog';
import { PayerDialog, type Payer } from './PayerDialog';
import { OverLimitRuleDialog, OverLimitSummary, type OverLimitChoice, type OverLimitState } from './OverLimitRuleDialog';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BillingControl
 * Platform team billing dashboard — every community's plan and price, who it
 * pays, whether it is paused for non-payment or exempt, and what happens if it
 * goes over its member number; assign a plan, pause, restore, exempt, set a
 * community's own over-limit rule, and export a CSV.
 *
 * 🔴 The types below are the SERVER's shape, key for key
 * (TenantBillingService::getBillingSnapshot, BillingStandingService::get).
 * There is no mapping layer on purpose. Until 20 Nov 2026 this file declared
 * the shape it wished for (tenant_id, tenant_name, current_plan_name,
 * is_over_limit …) and assigned the response to it unchecked: every name,
 * plan and price was blank and every button posted `tenant_id: undefined`.
 * tests/Laravel/Feature/Billing/BillingSnapshotContractTest.php now pins every
 * key read here to a real response. Rename a key there and here together.
 *
 * "Pause billing" and "Set grace period" were removed from this screen on the
 * same day: they only ever wrote a note. Pausing a community for non-payment
 * is the standing column and its actions.
 */


// ---------------------------------------------------------------------------
// Types — the server's shape
// ---------------------------------------------------------------------------

interface EffectivePrice {
  monthly: number;
  yearly: number;
  has_custom: boolean;
  discount_pct: number;
  nonprofit: boolean;
}

interface CurrentPlan {
  id: number;
  name: string;
  slug: string;
  max_users: number | null;
  /** The currency the community is charged in; every price on the row is in it. */
  currency: Currency;
  price_monthly: number;
  price_yearly: number;
  /** A card payer's period; null when it pays by hand. */
  billing_interval: 'monthly' | 'yearly' | null;
  /** The platform team's own notes on this plan record. */
  notes: string | null;
  /** False for a retired plan: nobody new is put on it. */
  is_active: boolean;
  custom_price_monthly: number | null;
  custom_price_yearly: number | null;
  discount_percentage: number;
  discount_reason: string | null;
  grace_period_ends_at: string | null;
  is_paused: boolean;
  nonprofit_verified: boolean;
  expires_at: string | null;
  effective_price: EffectivePrice;
  /** `expired` after a failed card payment; the plan is still shown beside it. */
  assignment_status: AssignmentStatus;
  max_communities: number | null;
  /** One of the seven standard packages (DESIGN §11), not a retired plan. */
  is_standard: boolean;
  /** `hub` when the name and member number shown are its hub's version of the plan. */
  terms?: 'default' | 'hub';
}

type AssignmentStatus = 'active' | 'trial' | 'expired' | 'cancelled';
type Currency = 'eur' | 'gbp';
type RowFilter = 'all' | 'no_plan' | 'no_paid_until' | 'paused' | 'over_limit';

const ROW_FILTERS: RowFilter[] = ['all', 'no_plan', 'no_paid_until', 'paused', 'over_limit'];

const ASSIGNMENT_STATUS_COLOR: Record<Exclude<AssignmentStatus, 'active'>, ChipColor> = {
  trial: 'primary',
  expired: 'danger',
  cancelled: 'default',
};

interface Standing {
  tenant_id: number;
  payer: Payer;
  payer_is_default: boolean;
  paid_until: string | null;
  suspended_at: string | null;
  suspension_source: 'auto' | 'manual' | null;
  suspension_note: string | null;
  exempt: boolean;
  exempt_reason: string | null;
  locked: boolean;
  locked_by_tenant_id: number | null;
}

interface TenantSnapshot {
  id: number;
  name: string;
  slug: string;
  depth: number;
  parent_id: number | null;
  allows_subtenants: boolean;
  own_user_count: number;
  subtree_user_count: number;
  current_plan: CurrentPlan | null;
  /** Active accounts that signed in within 90 days, the whole branch. */
  active_member_count: number;
  /** Of the plan's member limit; null with no plan or no limit. */
  usage_percent: number | null;
  /** The currency the community is billed in (a special price typed for it is in this). */
  billing_currency: Currency;
  /** Slug of the smallest standard package that fits; null above the largest. */
  suggested_plan: string | null;
  /** Over its member limit now. */
  over_limit: boolean;
  /**
   * What happens if it goes over its member number: the same eight keys as a
   * Branch payments row's `over_limit` (OverLimitRule::describe()). Named
   * differently here because `over_limit` above is the "over now" flag.
   * Null for the platform's own community: no rule applies to it.
   */
  over_limit_rule: OverLimitState | null;
  /** False when "Move up to the next plan" may not be chosen (it pays the platform by card). */
  upgrade_allowed: boolean;
  is_in_grace_period: boolean;
  grace_days_remaining: number;
  standing: Standing;
  /** Earliest day the daily check would pause it (paid-until + the pause days); null when none applies. */
  pause_on: string | null;
  /** The newest payment recorded by hand, if any. */
  last_payment: { received_on: string; method: PaymentMethod } | null;
}

/** A row of GET /v2/admin/plans. Prices arrive as the database's strings. */
interface PlanItem {
  id: number;
  name: string;
  slug: string;
  max_users: number | null;
  price_monthly: number | string | null;
  price_yearly: number | string | null;
  /** Pounds; null = not sold in pounds. */
  price_monthly_gbp?: number | string | null;
  price_yearly_gbp?: number | string | null;
  /** The one-off setup fee: euro, then pounds. */
  setup_fee?: number | string | null;
  setup_fee_gbp?: number | string | null;
  /** 0/1 from the database; retired `legacy-…` plans are 0. */
  is_active: number | boolean;
}

type StandingState = 'open' | 'paused' | 'paused_from_above' | 'exempt';
type StandingDialog = { row: TenantSnapshot; kind: 'pause' | 'exempt' } | null;
type ChipColor = 'success' | 'warning' | 'danger' | 'default' | 'primary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function money(amount: number, currency: Currency): string {
  return formatCurrency(amount, currency.toUpperCase(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * The currency a special price for `row` on `plan` is in: pounds only for a
 * pound community on a plan that has a pound price (the server's own rule,
 * TenantBillingService::pricesFor()).
 */
function chargeCurrency(row: TenantSnapshot, plan: PlanItem | undefined): Currency {
  if (row.billing_currency !== 'gbp' || !plan) return 'eur';
  return Number(plan.price_monthly_gbp ?? 0) > 0 || Number(plan.price_yearly_gbp ?? 0) > 0 ? 'gbp' : 'eur';
}

function matchesFilter(row: TenantSnapshot, filter: RowFilter): boolean {
  switch (filter) {
    case 'no_plan':
      return row.current_plan === null;
    case 'no_paid_until':
      // A community nobody bills has no date to chase.
      return row.standing.paid_until === null && !row.standing.exempt && row.standing.payer !== 'not_billed';
    case 'paused':
      return row.standing.suspended_at !== null;
    case 'over_limit':
      return row.over_limit;
    default:
      return true;
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(getFormattingLocale()).format(value);
}

// In the reader's number format ("1,043 (1,243)"), not raw digits.
const formatUserCount = (row: TenantSnapshot): string => {
  if (row.subtree_user_count !== row.own_user_count) {
    return `${formatCount(row.own_user_count)} (${formatCount(row.subtree_user_count)})`;
  }
  return formatCount(row.own_user_count);
};

// How far a community sits below the top, as whole class names so the
// stylesheet keeps them (no inline styles).
const INDENT = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'] as const;

function indentFor(depth: number): string {
  return INDENT[Math.min(INDENT.length - 1, Math.max(0, depth))] ?? INDENT[0];
}

/** `820 / 1,000 (82%)`, or just the active count when nothing limits it. */
function formatMembers(row: TenantSnapshot): string {
  const max = row.current_plan?.max_users ?? null;
  if (max === null || row.usage_percent === null) {
    return formatCount(row.active_member_count);
  }
  return `${formatCount(row.active_member_count)} / ${formatCount(max)} (${row.usage_percent}%)`;
}

/**
 * The same thresholds the daily check uses: warning from its percent, danger
 * at or over the limit, as Branch payments colours it. `over_limit` is asked
 * too: the percent is rounded down, so 201 of 200 reads "100%" and is over.
 */
function membersColour(row: TenantSnapshot, warningPercent: number): string {
  if (row.usage_percent === null) return 'text-muted';
  if (row.over_limit || row.usage_percent >= 100) return 'font-semibold text-danger';
  if (row.usage_percent >= warningPercent) return 'font-semibold text-warning';
  return 'text-muted';
}

/** Exempt wins: an exempt community is never paused, whatever is above it. */
function standingState(row: TenantSnapshot): StandingState {
  if (row.standing.exempt) return 'exempt';
  if (row.standing.suspended_at !== null) return 'paused';
  if (row.standing.locked) return 'paused_from_above';
  return 'open';
}

const STANDING_COLOR: Record<StandingState, ChipColor> = {
  open: 'success',
  paused: 'danger',
  paused_from_above: 'warning',
  // Neutral: an exemption is not a warning, and the brand colour read as one.
  exempt: 'default',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BillingControl() {
  // super_admin: "On its hub's terms", worded as on Branch payments.
  const { t } = useTranslation(['admin_billing', 'super_admin']);
  usePageTitle(t('billing.control_title'));
  const { user } = useAuth();
  const toast = useToast();

  const userRecord = user as Record<string, unknown> | null;
  const isGod = userRecord?.is_god === true;

  // ---- snapshot state ----
  const [snapshot, setSnapshot] = useState<TenantSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<RowFilter>('all');

  // ---- plans state ----
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  // ---- assign plan modal ----
  const [selectedTenant, setSelectedTenant] = useState<TenantSnapshot | null>(null);
  const isAssignOpen = selectedTenant !== null;
  const onAssignClose = () => setSelectedTenant(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [customPriceMonthly, setCustomPriceMonthly] = useState('');
  const [customPriceYearly, setCustomPriceYearly] = useState('');
  const [discountPct, setDiscountPct] = useState('0');
  const [discountReason, setDiscountReason] = useState('');
  const [nonprofitVerified, setNonprofitVerified] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // ---- pause / exempt dialog, and the row an action is running on ----
  const [standingDialog, setStandingDialog] = useState<StandingDialog>(null);
  const [standingText, setStandingText] = useState('');
  const [standingBusyId, setStandingBusyId] = useState<number | null>(null);

  // ---- set paid-until dialog (local state, as on Branch payments) ----
  const [paidUntilRow, setPaidUntilRow] = useState<TenantSnapshot | null>(null);
  const [paidUntilText, setPaidUntilText] = useState('');

  // ---- record a payment / change how it pays ----
  const [paymentRow, setPaymentRow] = useState<TenantSnapshot | null>(null);
  const [payerRow, setPayerRow] = useState<TenantSnapshot | null>(null);

  // ---- one community's own over-limit rule ----
  const [ruleRow, setRuleRow] = useState<TenantSnapshot | null>(null);

  // The daily check's warning percent, from its settings card; 80 until known.
  const [warningPercent, setWarningPercent] = useState(80);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  // The whole page is replaced by a spinner on the FIRST load only. A reload
  // after an action keeps the page as it is: it used to blank on every
  // action, which lost the reader's place and threw away unsaved edits on
  // the Automatic checks card above the table.
  const fetchSnapshot = useCallback(async () => {
    const response = await api.get<TenantSnapshot[]>('/v2/admin/super/billing/snapshot');
    if (response.success && Array.isArray(response.data)) {
      setSnapshot(response.data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
      toast.error(t('billing.failed_to_load'));
    }
    setLoading(false);
  }, [t, toast]);


  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const fetchPlans = useCallback(async () => {
    if (plans.length > 0) return;
    setPlansLoading(true);
    const response = await api.get<PlanItem[]>('/v2/admin/plans');
    if (response.success && Array.isArray(response.data)) {
      setPlans(response.data);
    }
    // failure is non-critical — plans list will be empty
    setPlansLoading(false);
  }, [plans.length]);

  // Loaded up front too: the "Suggested" line names a package by the plan
  // list's own name, not by translated text.
  // fetchPlans skips a list already loaded, so this runs the request once.
  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  // ---------------------------------------------------------------------------
  // Assign plan handlers
  // ---------------------------------------------------------------------------

  const handleOpenAssign = (tenant: TenantSnapshot) => {
    const plan = tenant.current_plan;
    setSelectedTenant(tenant);
    setSelectedPlanId(plan ? String(plan.id) : '');
    // What is stored already. These two opened empty, so saving anything
    // (a new price, say) wiped the notes and the date.
    setExpiresAt(plan?.expires_at ? plan.expires_at.slice(0, 10) : '');
    setNotes(plan?.notes ?? '');
    setCustomPriceMonthly(plan && plan.custom_price_monthly !== null ? String(plan.custom_price_monthly) : '');
    setCustomPriceYearly(plan && plan.custom_price_yearly !== null ? String(plan.custom_price_yearly) : '');
    setDiscountPct(String(plan?.discount_percentage ?? 0));
    setDiscountReason(plan?.discount_reason ?? '');
    setNonprofitVerified(plan?.nonprofit_verified ?? false);
    void fetchPlans();
  };

  const handleAssign = async () => {
    if (!selectedTenant || !selectedPlanId) return;
    setAssigning(true);
    const response = await api.post('/v2/admin/super/billing/assign-plan', {
      tenant_id: selectedTenant.id,
      pay_plan_id: Number(selectedPlanId),
      expires_at: expiresAt || null,
      notes: notes || null,
      custom_price_monthly: customPriceMonthly !== '' ? Number(customPriceMonthly) : null,
      custom_price_yearly: customPriceYearly !== '' ? Number(customPriceYearly) : null,
      discount_percentage: Number(discountPct) || 0,
      discount_reason: discountReason || null,
      nonprofit_verified: nonprofitVerified,
    });
    if (response.success) {
      toast.success(t('billing.plan_assigned'));
      onAssignClose();
      void fetchSnapshot();
    } else {
      // The server says why (a card payer, a retired plan, a bad date) in
      // the reader's language. "Failed to assign" said nothing.
      // admin-i18n-ignore: localized server message — AdminSuperController::assignPlan refusals (lang/*/api.php)
      toast.error(response.error || t('billing.failed_to_assign'));
    }
    setAssigning(false);
  };

  // ---------------------------------------------------------------------------
  // Standing: pause, restore, exempt
  // ---------------------------------------------------------------------------

  /** One place every standing action goes through, so each reports the same way. */
  const sendStanding = async (
    row: TenantSnapshot,
    endpoint: 'suspend' | 'restore' | 'exempt',
    body: Record<string, unknown>,
    doneKey: string,
  ): Promise<boolean> => {
    setStandingBusyId(row.id);
    const response = await api.post(`/v2/admin/super/billing/standing/${endpoint}`, { tenant_id: row.id, ...body });
    setStandingBusyId(null);

    if (response.success) {
      toast.success(t(doneKey));
      void fetchSnapshot();
      return true;
    }

    // The server explains its own refusals (exempt, the platform's own
    // community …) in the reader's language: show that, not a generic line.
    // admin-i18n-ignore: localized server message — AdminSuperController standing refusals (lang/*/api.php)
    toast.error(response.error || t('billing.standing_failed'));
    return false;
  };

  const openStandingDialog = (row: TenantSnapshot, kind: 'pause' | 'exempt') => {
    setStandingText('');
    setStandingDialog({ row, kind });
  };

  const closeStandingDialog = () => {
    setStandingDialog(null);
    setStandingText('');
  };

  const confirmStandingDialog = async () => {
    if (!standingDialog) return;
    const text = standingText.trim();
    const { row, kind } = standingDialog;

    const done = kind === 'pause'
      ? await sendStanding(row, 'suspend', text ? { note: text } : {}, 'billing.done_paused')
      : await sendStanding(row, 'exempt', { exempt: true, reason: text }, 'billing.done_exempted');

    if (done) closeStandingDialog();
  };

  // ---------------------------------------------------------------------------
  // Paid-until date
  // ---------------------------------------------------------------------------

  const openPaidUntil = (row: TenantSnapshot) => {
    setPaidUntilText(row.standing.paid_until ?? '');
    setPaidUntilRow(row);
  };

  const closePaidUntil = () => {
    setPaidUntilRow(null);
    setPaidUntilText('');
  };

  const confirmPaidUntil = async () => {
    if (!paidUntilRow) return;
    const value = paidUntilText.trim();
    const row = paidUntilRow;

    setStandingBusyId(row.id);
    // An emptied field sends null on purpose: that is "stop tracking a date".
    const response = await api.post('/v2/admin/super/billing/standing/paid-until', {
      tenant_id: row.id,
      paid_until: value === '' ? null : value,
    });
    setStandingBusyId(null);

    if (response.success) {
      toast.success(t('control.done_paid_until'));
      closePaidUntil();
      void fetchSnapshot();
      return;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController standing refusals (lang/*/api.php)
    toast.error(response.error || t('billing.standing_failed'));
  };

  // ---------------------------------------------------------------------------
  // Over-limit rule
  // ---------------------------------------------------------------------------

  const saveRule = async (choice: OverLimitChoice): Promise<boolean> => {
    if (!ruleRow) return false;
    const response = await api.post('/v2/admin/super/billing/standing/over-limit', { tenant_id: ruleRow.id, ...choice });

    if (response.success) {
      toast.success(t('over_limit_rule.saved'));
      void fetchSnapshot();
      return true;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController over-limit refusals (lang/*/api.php)
    toast.error(response.error || t('over_limit_rule.save_failed'));
    return false;
  };

  const filterCounts = useMemo(() => {
    const counts = {} as Record<RowFilter, number>;
    for (const key of ROW_FILTERS) {
      counts[key] = snapshot.filter((row) => matchesFilter(row, key)).length;
    }
    return counts;
  }, [snapshot]);

  /** The suggested package's own name, when it differs from the current plan. */
  const suggestedPlanName = (row: TenantSnapshot): string | null => {
    if (!row.suggested_plan || row.suggested_plan === row.current_plan?.slug) return null;
    return plans.find((plan) => plan.slug === row.suggested_plan)?.name ?? null;
  };

  // ---------------------------------------------------------------------------
  // Plan chip rendering
  // ---------------------------------------------------------------------------

  const getPlanChipColor = (row: TenantSnapshot): ChipColor => (row.current_plan ? 'success' : 'default');

  const assignmentStatusLabel = (status: Exclude<AssignmentStatus, 'active'>): string => {
    if (status === 'trial') return t('billing.assignment_status_trial');
    if (status === 'expired') return t('billing.assignment_status_expired');
    return t('billing.assignment_status_cancelled');
  };

  // The plan's own name, always. "Over Limit" and "In Grace Period" used to
  // replace it, so the one row that needed a decision hid which plan it was on.
  const getPlanChipLabel = (row: TenantSnapshot): string =>
    row.current_plan ? row.current_plan.name : t('billing.status_no_plan');

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('billing.control_title')}
          description={t('billing.control_desc')}
        />
        <BillingDevelopmentNotice />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const selectedPlan = plans.find((p) => String(p.id) === selectedPlanId);
  const exemptNeedsReason = standingDialog?.kind === 'exempt' && standingText.trim() === '';
  const shownRows = snapshot.filter((row) => matchesFilter(row, filter));
  // A card is charged by Stripe for the plan on its subscription, at the
  // plan's own price: the server refuses a change of either made here.
  const selectedPaysByCard = selectedTenant?.standing.payer === 'platform_card';
  const dialogCurrency = selectedTenant ? chargeCurrency(selectedTenant, selectedPlan).toUpperCase() : 'EUR';
  // Active plans, and the retired one this community is already on: it can
  // stay there and have its price edited; nobody new is put on it.
  const plansForDialog = plans.filter(
    (plan) => assignablePlans([plan]).length === 1 || plan.id === selectedTenant?.current_plan?.id,
  );
  const placeholderPrice = (period: 'monthly' | 'yearly'): string => {
    if (!selectedPlan) return '';
    const value = dialogCurrency === 'GBP' ? selectedPlan[`price_${period}_gbp`] : selectedPlan[`price_${period}`];
    return value != null ? String(value) : '';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('billing.control_title')}
        description={t('billing.control_desc')}
        actions={
          <Button
            size="sm"
            variant="tertiary"
            startContent={<Download size={14} />}
            onPress={() => {
              void api
                .download('/v2/admin/super/billing/export', { filename: 'billing-export.csv' })
                .catch(() => toast.error(t('billing.failed_to_load')));
            }}
          >
            {t('billing.export_csv')}
          </Button>
        }
      />

      <BillingDevelopmentNotice />

      <BillingAutomationCard onWarningPercent={setWarningPercent} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-start gap-2 pb-0">
          <CreditCard size={18} className="text-accent" />
          <span className="font-semibold text-sm">{t('billing.control_title')}</span>
        </CardHeader>
        <CardBody className="p-0">
          {/* Wider than most screens: the table scrolls sideways inside this
              card, never the page, and says so. */}
          <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
            <div className="w-64">
              <Select
                label={t('control.filter_label')}
                selectedKeys={new Set([filter])}
                onSelectionChange={(keys) => {
                  const chosen = String(Array.from(keys)[0] ?? 'all') as RowFilter;
                  setFilter(ROW_FILTERS.includes(chosen) ? chosen : 'all');
                }}
              >
                {ROW_FILTERS.map((key) => (
                  <SelectItem key={key} id={key}>
                    {t('control.filter_option', { label: t(`control.filter_${key}`), count: filterCounts[key] })}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <p data-testid="billing-filter-count" className="text-xs text-muted">
              {t('control.filter_count', { shown: shownRows.length, total: snapshot.length })}
            </p>
          </div>
          {loadFailed ? (
            <div className="px-4 pt-3">
              <Alert color="danger" role="alert">
                <span>{t('control.load_failed')}</span>{' '}
                <Button size="sm" variant="tertiary" onPress={() => void fetchSnapshot()}>
                  {t('control.try_again')}
                </Button>
              </Alert>
            </div>
          ) : null}
          <p className="px-4 pt-2 text-xs text-muted">{t('billing.table_scrolls')}</p>
          <Table aria-label={t('billing.control_title')} removeWrapper classNames={{ table: 'min-w-[1500px]' }}>
            <TableHeader>
              <TableColumn>{t('billing.col_tenant')}</TableColumn>
              <TableColumn>{t('billing.col_users')}</TableColumn>
              <TableColumn>{t('control.col_members')}</TableColumn>
              <TableColumn>{t('billing.col_current_plan')}</TableColumn>
              <TableColumn>{t('billing.col_effective_price')}</TableColumn>
              <TableColumn>{t('billing.col_pays')}</TableColumn>
              <TableColumn>{t('control.col_paid_until')}</TableColumn>
              <TableColumn>{t('billing.col_standing')}</TableColumn>
              <TableColumn>{t('over_limit_rule.col_if_over')}</TableColumn>
              {isGod
                ? <TableColumn>{t('billing.col_actions')}</TableColumn>
                : <TableColumn>{''}</TableColumn>
              }
            </TableHeader>
            <TableBody
              emptyContent={snapshot.length === 0 ? t('control.none_yet') : t('control.none_match')}
              items={shownRows}
            >
              {(row) => {
                const price = row.current_plan?.effective_price ?? null;
                const state = standingState(row);
                const busy = standingBusyId === row.id;
                const suggested = suggestedPlanName(row);

                return (
                  <TableRow key={row.id}>
                    {/* Community name with depth indent */}
                    <TableCell>
                      <div className={`block min-w-44 break-normal text-sm font-medium ${indentFor(row.depth)}`}>
                        {row.over_limit && !row.is_in_grace_period && (
                          <AlertTriangle size={14} className="inline mr-1 text-warning-soft-foreground" aria-hidden="true" />
                        )}
                        {row.name}
                      </div>
                    </TableCell>

                    {/* Users: own + subtree total */}
                    <TableCell>
                      <span className="text-sm text-muted whitespace-nowrap">
                        {formatUserCount(row)}
                      </span>
                    </TableCell>

                    {/* Active members against the package limit */}
                    <TableCell>
                      <span data-testid="billing-members" className={`text-sm whitespace-nowrap ${membersColour(row, warningPercent)}`}>
                        {formatMembers(row)}
                      </span>
                    </TableCell>

                    {/* Plan chip */}
                    <TableCell>
                      <div className="flex min-w-40 items-center gap-1 flex-wrap break-normal">
                        <Chip
                          size="sm"
                          variant="soft"
                          color={getPlanChipColor(row)}
                        >
                          {getPlanChipLabel(row)}
                        </Chip>
                        {row.over_limit ? (
                          <Chip size="sm" variant="soft" color="warning">{t('billing.over_limit')}</Chip>
                        ) : null}
                        {row.is_in_grace_period ? (
                          <Chip size="sm" variant="soft" color="danger">{t('billing.in_grace_period')}</Chip>
                        ) : null}
                        {row.current_plan && row.current_plan.assignment_status !== 'active' ? (
                          <Chip
                            size="sm"
                            variant="soft"
                            color={ASSIGNMENT_STATUS_COLOR[row.current_plan.assignment_status]}
                          >
                            {assignmentStatusLabel(row.current_plan.assignment_status)}
                          </Chip>
                        ) : null}
                      </div>
                      {/* The name and member number shown are its hub's version. */}
                      {row.current_plan?.terms === 'hub' ? (
                        <span className="mt-1 block text-xs text-muted">
                          {t('super_admin:branch_payments.plan_hub_terms')}
                        </span>
                      ) : null}
                      {suggested ? (
                        <span className="mt-1 block text-xs text-muted">
                          {t('control.suggested', { plan: suggested })}
                        </span>
                      ) : null}
                      {row.current_plan?.expires_at ? (
                        <span className="mt-1 block text-xs text-muted">
                          {t('control.review_on', { date: formatDate(row.current_plan.expires_at) })}
                        </span>
                      ) : null}
                    </TableCell>

                    {/* Effective price */}
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span data-testid="billing-price" className="text-sm text-foreground whitespace-nowrap">
                          {price && row.current_plan ? (
                            <>
                              {row.current_plan.billing_interval !== 'yearly' ? (
                                <span className="block">
                                  {t('billing.amount_per_month', { amount: money(price.monthly, row.current_plan.currency) })}
                                </span>
                              ) : null}
                              {row.current_plan.billing_interval !== 'monthly' ? (
                                <span className="block">
                                  {t('billing.amount_per_year', { amount: money(price.yearly, row.current_plan.currency) })}
                                </span>
                              ) : null}
                            </>
                          ) : '—'}
                        </span>
                        {price && (price.has_custom || price.discount_pct > 0) ? (
                          <Chip size="sm" variant="soft" className="text-xs">
                            {t('billing.custom_badge')}
                          </Chip>
                        ) : null}
                        {price?.nonprofit && (
                          <Leaf size={12} className="text-success-soft-foreground" aria-label={t('billing.nonprofit_verified')} />
                        )}
                      </div>
                    </TableCell>

                    {/* Who it pays */}
                    <TableCell>
                      <span className="inline-block min-w-24 text-sm text-muted">
                        {t(`billing.payer_${row.standing.payer}`)}
                      </span>
                    </TableCell>

                    {/* Paid until */}
                    <TableCell>
                      <span className="text-sm text-muted whitespace-nowrap">
                        {row.standing.paid_until ? formatDate(row.standing.paid_until) : t('control.no_date')}
                      </span>
                      {row.last_payment ? (
                        <span className="mt-1 block text-xs text-muted">
                          {t('control.last_payment', {
                            date: formatDate(row.last_payment.received_on),
                            method: t(`control.method_${row.last_payment.method}`),
                          })}
                        </span>
                      ) : null}
                      {/* The earliest day the daily check would pause it */}
                      {row.pause_on ? (
                        <span data-testid="billing-pause-on" className="mt-1 block text-xs text-muted">
                          {t('control.pause_on_line', { date: formatDate(row.pause_on) })}
                        </span>
                      ) : null}
                    </TableCell>

                    {/* Standing */}
                    <TableCell>
                      <Chip size="sm" variant="soft" color={STANDING_COLOR[state]}>
                        {t(`billing.standing_${state}`)}
                      </Chip>
                    </TableCell>

                    {/* What happens if it goes over its member number */}
                    <TableCell>
                      {row.over_limit_rule ? <OverLimitSummary rule={row.over_limit_rule} /> : null}
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      {isGod ? (
                        // Wide enough for the buttons to sit in rows, not a
                        // tall single column.
                        <div className="flex min-w-[26rem] items-center gap-1 flex-wrap">
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() => handleOpenAssign(row)}
                          >
                            {t('billing.assign_plan')}
                          </Button>

                          <Button
                            size="sm"
                            variant="secondary"
                            isDisabled={busy}
                            onPress={() => openPaidUntil(row)}
                          >
                            {t('control.set_paid_until')}
                          </Button>

                          <Button
                            size="sm"
                            variant="secondary"
                            isDisabled={busy}
                            onPress={() => setPaymentRow(row)}
                          >
                            {t('control.record_payment')}
                          </Button>

                          <Button
                            size="sm"
                            variant="tertiary"
                            isDisabled={busy}
                            onPress={() => setPayerRow(row)}
                          >
                            {t('control.change_payer')}
                          </Button>

                          {row.over_limit_rule ? (
                            <Button
                              size="sm"
                              variant="tertiary"
                              isDisabled={busy}
                              onPress={() => setRuleRow(row)}
                            >
                              {t('over_limit_rule.open_dialog')}
                            </Button>
                          ) : null}

                          {state === 'open' ? (
                            <Button
                              size="sm"
                              color="warning"
                              variant="tertiary"
                              isDisabled={busy}
                              onPress={() => openStandingDialog(row, 'pause')}
                            >
                              {t('billing.pause_community')}
                            </Button>
                          ) : null}

                          {/* Only where this community itself is paused. One
                              paused from above is restored on the community
                              above, or opened here by exempting it. */}
                          {state === 'paused' ? (
                            <Button
                              size="sm"
                              color="success"
                              variant="secondary"
                              isLoading={busy}
                              onPress={() => void sendStanding(row, 'restore', {}, 'billing.done_restored')}
                            >
                              {t('billing.restore_community')}
                            </Button>
                          ) : null}

                          {state === 'exempt' ? (
                            <Button
                              size="sm"
                              variant="tertiary"
                              isLoading={busy}
                              onPress={() => void sendStanding(row, 'exempt', { exempt: false }, 'billing.done_exemption_removed')}
                            >
                              {t('billing.remove_exemption')}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="tertiary"
                              isDisabled={busy}
                              onPress={() => openStandingDialog(row, 'exempt')}
                            >
                              {t('billing.exempt_community')}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              }}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Assign Plan Modal                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Modal isOpen={isAssignOpen} onClose={onAssignClose} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {t('billing.assign_plan_title')}
            {selectedTenant && (
              <span className="text-muted text-sm font-normal ml-2">
                — {selectedTenant.name}
              </span>
            )}
          </ModalHeader>
          <ModalBody>
            {plansLoading ? (
              <div className="flex justify-center py-4">
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="md" /></div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {selectedPaysByCard ? (
                  <Alert color="warning">
                    <span>{t('control.card_payer_note')}</span>
                  </Alert>
                ) : null}

                <Select
                  label={t('billing.select_plan')}
                  isDisabled={selectedPaysByCard && selectedTenant?.current_plan !== null}
                  selectedKeys={selectedPlanId ? new Set([selectedPlanId]) : new Set<string>()}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0];
                    setSelectedPlanId(val ? String(val) : '');
                  }}
                  isRequired
                >
                  {plansForDialog.map((plan) => (
                    <SelectItem key={String(plan.id)} id={String(plan.id)}>
                      {assignablePlans([plan]).length === 0 ? t('control.retired_plan', { name: plan.name }) : plan.name}
                    </SelectItem>
                  ))}
                </Select>

                {/* What the chosen plan allows and costs, in both currencies:
                    the list above gives a name only (owner, 21 Nov 2026). */}
                {selectedPlan ? (
                  <div className="rounded-lg border border-divider px-3 py-2 text-sm">
                    <p className="font-medium">
                      {selectedPlan.max_users == null
                        ? t('plan_facts.no_member_limit')
                        : t('plan_facts.members_up_to', { max: formatNumber(Number(selectedPlan.max_users)) })}
                    </p>
                    {planFactLines(selectedPlan).map((line) => (
                      <p key={line.currency} className="text-muted">
                        {[
                          line.monthly !== null ? t('billing.amount_per_month', { amount: line.monthly }) : null,
                          line.yearly !== null ? t('billing.amount_per_year', { amount: line.yearly }) : null,
                          line.setup !== null ? t('plan_facts.setup_fee', { amount: line.setup }) : t('plan_facts.no_setup_fee'),
                        ].filter((part) => part !== null).join(' · ')}
                      </p>
                    ))}
                  </div>
                ) : null}

                {/* Nothing acts on this date: it is a note of when to look
                    again. It was labelled "Expiry Date", which it never was. */}
                <Input
                  label={t('control.review_date')}
                  description={t('control.review_date_help')}
                  type="date"
                  value={expiresAt}
                  onValueChange={setExpiresAt}
                />

                <Input
                  label={t('billing.notes')}
                  value={notes}
                  onValueChange={setNotes}
                />

                {/* The placeholder is the plan's own price: what applies when
                    this is left empty. It used to show the plan's user limit. */}
                {/* The currency is the community's own, named in the label. A
                    hard-coded euro sign stood here while the email that
                    announces the price read the figure as the community's
                    currency. */}
                <Input
                  label={t('control.special_price_monthly', { currency: dialogCurrency })}
                  type="number"
                  min={0}
                  isDisabled={selectedPaysByCard}
                  value={customPriceMonthly}
                  onValueChange={setCustomPriceMonthly}
                  placeholder={placeholderPrice('monthly')}
                />

                <Input
                  label={t('control.special_price_yearly', { currency: dialogCurrency })}
                  type="number"
                  min={0}
                  isDisabled={selectedPaysByCard}
                  value={customPriceYearly}
                  onValueChange={setCustomPriceYearly}
                  placeholder={placeholderPrice('yearly')}
                />

                <Input
                  label={t('billing.discount_pct')}
                  type="number"
                  min={0}
                  max={100}
                  isDisabled={selectedPaysByCard}
                  value={discountPct}
                  onValueChange={setDiscountPct}
                  endContent={<span className="text-muted text-sm">%</span>}
                />

                <Input
                  label={t('billing.discount_reason')}
                  isDisabled={selectedPaysByCard}
                  value={discountReason}
                  onValueChange={setDiscountReason}
                  placeholder={t('billing.discount_reason_placeholder')}
                />

                <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{t('billing.nonprofit_verified')}</p>
                    <p className="text-xs text-muted">{t('billing.nonprofit_verified_desc')}</p>
                  </div>
                  <Switch
                    isSelected={nonprofitVerified}
                    isDisabled={selectedPaysByCard}
                    onValueChange={setNonprofitVerified}
                    aria-label={t('billing.nonprofit_verified')}
                  />
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onAssignClose} isDisabled={assigning}>
              {t('billing.cancel')}
            </Button>
            <Button
              onPress={() => void handleAssign()}
              isLoading={assigning}
              isDisabled={!selectedPlanId || plansLoading}
            >
              {t('billing.assign_plan')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Pause / Exempt dialog                                                */}
      {/* ------------------------------------------------------------------ */}
      <Modal isOpen={standingDialog !== null} onClose={closeStandingDialog} size="md">
        <ModalContent>
          <ModalHeader>
            {standingDialog?.kind === 'exempt' ? t('billing.exempt_modal_title') : t('billing.pause_modal_title')}
            {standingDialog && (
              <span className="text-muted text-sm font-normal ml-2">
                — {standingDialog.row.name}
              </span>
            )}
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                {standingDialog?.kind === 'exempt' ? t('billing.exempt_modal_body') : t('billing.pause_modal_body')}
              </p>
              <Input
                label={standingDialog?.kind === 'exempt' ? t('billing.exempt_reason_label') : t('billing.pause_note_label')}
                value={standingText}
                onValueChange={setStandingText}
                maxLength={500}
                isRequired={standingDialog?.kind === 'exempt'}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeStandingDialog} isDisabled={standingBusyId !== null}>
              {t('billing.cancel')}
            </Button>
            <Button
              color={standingDialog?.kind === 'exempt' ? 'primary' : 'warning'}
              onPress={() => void confirmStandingDialog()}
              isLoading={standingBusyId !== null}
              isDisabled={exemptNeedsReason}
            >
              {standingDialog?.kind === 'exempt' ? t('billing.exempt_modal_title') : t('billing.pause_modal_title')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Set paid-until date dialog                                           */}
      {/* ------------------------------------------------------------------ */}
      <Modal isOpen={paidUntilRow !== null} onClose={closePaidUntil} size="md">
        <ModalContent>
          <ModalHeader>
            {t('control.set_paid_until')}
            {paidUntilRow && (
              <span className="text-muted text-sm font-normal ml-2">
                — {paidUntilRow.name}
              </span>
            )}
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">{t('control.paid_until_help')}</p>
              <Input
                label={t('control.paid_until_label')}
                type="date"
                value={paidUntilText}
                onValueChange={setPaidUntilText}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closePaidUntil} isDisabled={standingBusyId !== null}>
              {t('billing.cancel')}
            </Button>
            <Button onPress={() => void confirmPaidUntil()} isLoading={standingBusyId !== null}>
              {t('control.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <RecordPaymentDialog
        community={paymentRow ? { id: paymentRow.id, name: paymentRow.name, paidUntil: paymentRow.standing.paid_until } : null}
        onClose={() => setPaymentRow(null)}
        onRecorded={() => {
          setPaymentRow(null);
          void fetchSnapshot();
        }}
      />

      <OverLimitRuleDialog
        target={ruleRow && ruleRow.over_limit_rule ? {
          id: ruleRow.id,
          name: ruleRow.name,
          state: ruleRow.over_limit_rule,
          upgradeAllowed: ruleRow.upgrade_allowed === true,
        } : null}
        onClose={() => setRuleRow(null)}
        onSave={saveRule}
      />

      <PayerDialog
        community={payerRow ? {
          id: payerRow.id,
          name: payerRow.name,
          payer: payerRow.standing.payer,
          payerIsDefault: payerRow.standing.payer_is_default,
          canPayParent: payerRow.parent_id !== null && payerRow.parent_id > 1,
        } : null}
        onClose={() => setPayerRow(null)}
        onSaved={() => {
          setPayerRow(null);
          void fetchSnapshot();
        }}
      />
    </div>
  );
}

export default BillingControl;
