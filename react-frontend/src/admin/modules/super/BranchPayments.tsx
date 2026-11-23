// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Branch payments
 *
 * A parent community's manager and the payment standing of the communities
 * below it: who each pays, the date it is paid up to, how late it is, and
 * whether it is paused, the plan it is on and how many active members it has
 * against that plan's limit, and what happens if it goes over that limit. The
 * manager records a payment (amount, reference, method and the new paid-until
 * date) and reads the payments made to its community, sets a paid-until date
 * on its own, pauses a community, restores it, changes its plan and sets its
 * own over-limit rule.
 *
 * 🔴 Layout (23 Nov 2026). This was a nine-column table 1,180px wide that
 * scrolled sideways inside its card; the scroll bar went unnoticed and half
 * the columns with it. It is still one HeroUI table (same roles, same keyboard
 * movement), but each row is laid out as a grid: five aligned columns from the
 * `xl` breakpoint, and a stacked block with its own small labels below it. It
 * never needs to scroll sideways. Do not put `min-w-[…]` back on the table.
 * The layout is shared with Billing control: `../billing/CommunityGrid`.
 *
 * 🔴 "Members" is two numbers. A plan's limit is on ACTIVE members (signed in
 * within `members.window_days`, the pricing page's definition); `members.total`
 * is everyone with an account in good standing and is shown for information
 * only. The page says which is which, because 35 read as broken beside a
 * community of 274.
 *
 * 🔴 The screen decides nothing about who may act. Every row arrives with
 * `can_act` and, when false, `cannot_act_reason`, worked out by the same rule
 * the server applies to the write (App\Support\Billing\BranchPayments). So a
 * button is never offered that the server would refuse.
 *
 * 🔴 The types are the server's shape, key for key
 * (BranchPayments::rows(), BillingStandingService::get()), pinned by
 * tests/Laravel/Feature/Billing/BranchPaymentsEndpointsTest.php. No mapping
 * layer: the Billing control screen once read a shape the server never sent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Building2 from 'lucide-react/icons/building-2';
import CirclePause from 'lucide-react/icons/circle-pause';
import Clock from 'lucide-react/icons/clock';
import Info from 'lucide-react/icons/info';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { Alert, Button, Card, CardBody, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Radio, RadioGroup, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import {
  ActiveMembersNote, COMMUNITY_GRID_CLASSES, COMMUNITY_GRID_LEAD_CELL, MemberNumbers, StackedLabel,
  blockIndentFor, nameIndentFor, type MembersLevel,
} from '../billing/CommunityGrid';
import { OverLimitRuleDialog, OverLimitSummary, type OverLimitChoice, type OverLimitState } from '../billing/OverLimitRuleDialog';
import { Glance } from '../billing/Glance';
import { LoadFailed } from '../billing/LoadFailed';
import { RecordPaymentDialog } from '../billing/RecordPaymentDialog';
import { StillToSetUp, type SetupItem } from '../billing/StillToSetUp';

/**
 * As the Branch payments list sends it: without the note against a pause and
 * the reason for an exemption, which are not a parent's manager's to read.
 */
interface Standing {
  tenant_id: number;
  payer: 'platform_card' | 'platform_invoice' | 'parent' | 'not_billed';
  payer_is_default: boolean;
  paid_until: string | null;
  suspended_at: string | null;
  suspension_source: 'auto' | 'manual' | null;
  exempt: boolean;
  locked: boolean;
  locked_by_tenant_id: number | null;
}

/**
 * A plan as it applies to one community (PlanTerms::forCommunity() and
 * PlanTerms::availableTo()): on its hub's terms when it pays its hub.
 */
interface Terms {
  plan_id: number;
  slug: string;
  name: string;
  description: string | null;
  max_users: number | null;
  currency: 'eur' | 'gbp';
  price_monthly: number | null;
  price_yearly: number | null;
  setup_fee: number | null;
  terms: 'default' | 'hub';
  hub_tenant_id: number | null;
  is_standard: boolean;
}

/**
 * `active`: signed in within `window_days`, whole branch
 * (TenantBillingService::getSubtreeActiveMemberCount()), against the plan's
 * limit. `total`: every member of the branch with an account in good standing
 * (getSubtreeUserCount()); shown for information, checked against nothing.
 */
interface Members {
  active: number;
  total: number;
  window_days: number;
  max: number | null;
  percent: number | null;
}

interface BranchRow {
  id: number;
  name: string;
  depth: number;
  parent_id: number | null;
  parent_name: string | null;
  standing: Standing;
  days_late: number | null;
  can_act: boolean;
  cannot_act_reason: 'not_in_reach' | 'pays_platform' | 'exempt' | null;
  paused_from_above: boolean;
  plan: Terms | null;
  members: Members;
  /** Set when the plan is the platform team's to change (it pays the platform by card). */
  plan_change_refusal: 'card_subscription' | null;
  /** What happens if it goes over its member number, and where that rule comes from. */
  over_limit: OverLimitState;
  /** False when "Move up to the next plan" may not be chosen for it. */
  upgrade_allowed: boolean;
}

type PlanList = Terms[] | 'loading' | 'failed';

type StandingState = 'open' | 'paused' | 'paused_from_above' | 'exempt';
type Dialog = { row: BranchRow; kind: 'date' | 'pause'; afterPlan?: boolean } | null;
type ChipColor = 'success' | 'warning' | 'danger' | 'default';

function standingState(row: BranchRow): StandingState {
  if (row.standing.exempt) return 'exempt';
  if (row.standing.suspended_at !== null) return 'paused';
  if (row.standing.locked) return 'paused_from_above';
  return 'open';
}

/** Near from 80% of the plan's limit, over from 100%. */
function membersLevel(members: Members): MembersLevel {
  if (members.percent !== null && members.percent >= 100) return 'over';
  if (members.percent !== null && members.percent >= 80) return 'near';
  return 'ok';
}

/** Money may arrive as a numeric string from a decimal column. */
function amount(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Whole amounts without ".00", as on Branch plans; anything else to the penny. */
function money(value: number, currency: 'eur' | 'gbp'): string {
  const code = currency === 'gbp' ? 'GBP' : 'EUR';
  return Number.isInteger(value)
    ? formatCurrency(value, code, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : formatCurrency(value, code);
}

const STANDING_COLOR: Record<StandingState, ChipColor> = {
  open: 'success',
  paused: 'danger',
  paused_from_above: 'warning',
  // Neutral: an exemption is not a warning, and the brand colour read as one.
  exempt: 'default',
};

export function BranchPayments() {
  // Chips, the pause dialog and its messages are shared with the Platform
  // team's Billing control screen, so both say the same thing the same way.
  const { t } = useTranslation(['super_admin', 'admin_billing']);
  usePageTitle(t('branch_payments.title'));
  const toast = useToast();

  const [rows, setRows] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [planRow, setPlanRow] = useState<BranchRow | null>(null);
  const [plans, setPlans] = useState<PlanList>('loading');
  const [planChoice, setPlanChoice] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [ruleRow, setRuleRow] = useState<BranchRow | null>(null);
  const [paymentRow, setPaymentRow] = useState<BranchRow | null>(null);
  // The same dialog showing the payment history alone.
  const [historyRow, setHistoryRow] = useState<BranchRow | null>(null);
  // The community the plan dialog is open on now: a late reply for another is dropped.
  const planFor = useRef<number | null>(null);

  const load = useCallback(async () => {
    const response = await api.get<BranchRow[]>('/v2/admin/super/branch-payments');
    if (response.success && Array.isArray(response.data)) {
      setRows(response.data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (row: BranchRow, action: 'paid-until' | 'suspend' | 'restore', body: Record<string, unknown>, doneKey: string): Promise<boolean> => {
    setBusyId(row.id);
    const response = await api.post(`/v2/admin/super/branch-payments/${row.id}/${action}`, body);
    setBusyId(null);

    if (response.success) {
      toast.success(t(doneKey));
      void load();
      return true;
    }

    // The server explains its own refusals in the reader's language.
    // admin-i18n-ignore: localized server message — AdminSuperController Branch payments refusals (lang/*/api.php)
    toast.error(response.error || t('admin_billing:billing.standing_failed'));
    return false;
  };

  const openDialog = (row: BranchRow, kind: 'date' | 'pause', afterPlan = false) => {
    setText(kind === 'date' ? (row.standing.paid_until ?? '') : '');
    setDialog({ row, kind, afterPlan });
  };

  const closeDialog = () => {
    setDialog(null);
    setText('');
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const value = text.trim();

    const done = dialog.kind === 'date'
      ? await send(dialog.row, 'paid-until', { paid_until: value === '' ? null : value }, 'branch_payments.done_date')
      : await send(dialog.row, 'suspend', value ? { note: value } : {}, 'admin_billing:billing.done_paused');

    if (done) closeDialog();
  };

  const openPlanDialog = async (row: BranchRow) => {
    planFor.current = row.id;
    setPlanRow(row);
    setPlans('loading');
    setPlanChoice(row.plan ? String(row.plan.plan_id) : '');

    const response = await api.get<Terms[]>(`/v2/admin/super/branch-payments/${row.id}/plans`);
    if (planFor.current !== row.id) return;
    setPlans(response.success && Array.isArray(response.data) ? response.data : 'failed');
  };

  const closePlanDialog = () => {
    planFor.current = null;
    setPlanRow(null);
    setPlans('loading');
    setPlanChoice('');
  };

  const savePlan = async () => {
    if (!planRow || planChoice === '') return;
    setSavingPlan(true);
    const response = await api.post(`/v2/admin/super/branch-payments/${planRow.id}/plan`, { plan_id: Number(planChoice) });
    setSavingPlan(false);

    if (response.success) {
      toast.success(t('branch_payments.done_plan'));
      const saved = planRow;
      closePlanDialog();
      void load();
      // A plan with no paid-until date is never reminded or checked: the
      // daily check looks only at communities that have a date. So the date
      // is asked for straight away where one is still missing.
      if (saved.standing.paid_until === null && saved.standing.payer !== 'not_billed') {
        openDialog(saved, 'date', true);
      }
      return;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController Branch payments plan refusals (lang/*/api.php)
    toast.error(response.error || t('admin_billing:billing.standing_failed'));
  };

  const saveRule = async (choice: OverLimitChoice): Promise<boolean> => {
    if (!ruleRow) return false;
    const response = await api.post(`/v2/admin/super/branch-payments/${ruleRow.id}/over-limit`, choice);

    if (response.success) {
      toast.success(t('admin_billing:over_limit_rule.saved'));
      void load();
      return true;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController Branch payments over-limit refusals (lang/*/api.php)
    toast.error(response.error || t('admin_billing:over_limit_rule.save_failed'));
    return false;
  };

  const header = (
    <PageHeader title={t('branch_payments.title')} description={t('branch_payments.description')} />
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <div role="status" aria-busy="true" aria-label={t('admin_billing:common.loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed
          message={t('branch_payments.load_failed')}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        />
      </div>
    );
  }

  // The same switch for every row: the platform's automatic checks.
  const automationOff = rows[0]?.over_limit?.automation_enabled === false;

  // At a glance, above the list: how many need a look, and for what.
  const overCount = rows.filter((row) => membersLevel(row.members) === 'over').length;
  const lateCount = rows.filter((row) => (row.days_late ?? 0) > 0).length;
  const pausedCount = rows.filter((row) => row.standing.suspended_at !== null || row.standing.locked).length;
  const windowDays = rows[0]?.members.window_days ?? null;
  // The communities this person bills that have nothing to be billed by yet.
  const setupItems: SetupItem[] = rows
    .filter((row) => row.can_act && row.standing.payer !== 'not_billed'
      && (row.plan === null || row.standing.paid_until === null))
    .map((row) => ({
      id: row.id,
      name: row.name,
      noPlan: row.plan === null,
      noDate: row.standing.paid_until === null,
      canAssignPlan: row.plan_change_refusal !== 'card_subscription',
    }));
  const rowById = (id: number) => rows.find((row) => row.id === id);

  return (
    <div className="space-y-6">
      {header}

      {automationOff ? (
        <Alert color="warning" title={t('admin_billing:over_limit_rule.automation_off_note')} />
      ) : null}

      {rows.length > 0 ? (
        <div data-testid="branch-summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Glance icon={Building2} label={t('branch_payments.summary_communities')} value={formatNumber(rows.length)} tone="accent" />
          <Glance icon={TriangleAlert} label={t('branch_payments.summary_over')} value={formatNumber(overCount)} tone={overCount > 0 ? 'danger' : 'quiet'} />
          <Glance icon={Clock} label={t('branch_payments.summary_late')} value={formatNumber(lateCount)} tone={lateCount > 0 ? 'warning' : 'quiet'} />
          <Glance icon={CirclePause} label={t('branch_payments.summary_paused')} value={formatNumber(pausedCount)} tone={pausedCount > 0 ? 'danger' : 'quiet'} />
        </div>
      ) : null}

      <StillToSetUp
        items={setupItems}
        isDisabled={busyId !== null}
        onAssignPlan={(id) => {
          const row = rowById(id);
          if (row) void openPlanDialog(row);
        }}
        onSetDate={(id) => {
          const row = rowById(id);
          if (row) openDialog(row, 'date');
        }}
      />

      <Card>
        <CardBody className="p-0">
          {/* What "active" means, said once: the plan's limit is on active
              members, not on everyone with an account. */}
          {windowDays !== null ? (
            <ActiveMembersNote days={windowDays} icon={<Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />} />
          ) : null}

          {/* One table, laid out as a grid: five aligned columns from `xl`,
              a stacked block per community below it. Never wider than its
              card, so nothing has to be found by scrolling sideways. */}
          <Table
            aria-label={t('branch_payments.title')}
            removeWrapper
            classNames={COMMUNITY_GRID_CLASSES}
          >
            <TableHeader>
              <TableColumn>{t('branch_payments.col_community')}</TableColumn>
              <TableColumn>{t('branch_payments.col_plan_members')}</TableColumn>
              <TableColumn>{t('admin_billing:over_limit_rule.col_if_over')}</TableColumn>
              <TableColumn>{t('branch_payments.col_payment')}</TableColumn>
              <TableColumn>{t('admin_billing:billing.col_actions')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('branch_payments.empty')} items={rows}>
              {(row) => {
                const state = standingState(row);
                const busy = busyId === row.id;
                const paysParent = row.standing.payer === 'parent';
                const canChangePlan = row.plan_change_refusal !== 'card_subscription';
                const level: MembersLevel = membersLevel(row.members);
                // Nobody is paid by a community that is not billed: it read "The platform".
                const paysText = row.standing.payer === 'not_billed'
                  ? t('admin_billing:billing.payer_not_billed')
                  : paysParent && row.parent_name
                    ? t('branch_payments.pays_named', { name: row.parent_name })
                    : t('branch_payments.pays_the_platform');

                return (
                  <TableRow key={row.id} className={blockIndentFor(row.depth - 1)}>
                    <TableCell className={COMMUNITY_GRID_LEAD_CELL}>
                      {/* A block, so every line of a long name is indented and
                          the hierarchy shows; words wrap whole. */}
                      <div className={`break-normal ${nameIndentFor(row.depth - 1)}`}>
                        <div className="text-sm font-semibold text-foreground">{row.name}</div>
                        <div className="mt-0.5 text-xs text-muted">{paysText}</div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <StackedLabel>{t('branch_payments.col_plan_members')}</StackedLabel>
                      <div className="flex flex-col gap-1.5 break-normal">
                        {row.plan ? (
                          <div>
                            <span className="text-sm font-medium">{row.plan.name}</span>
                            {row.plan.terms === 'hub' ? (
                              <span className="block text-xs text-muted">{t('branch_payments.plan_hub_terms')}</span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-sm text-muted">{t('branch_payments.no_plan')}</span>
                        )}

                        <MemberNumbers
                          active={row.members.active}
                          max={row.members.max}
                          level={level}
                          total={row.members.total}
                          activeTestId={`members-active-${row.id}`}
                          totalTestId={`members-total-${row.id}`}
                        />
                      </div>
                    </TableCell>

                    <TableCell>
                      <StackedLabel>{t('admin_billing:over_limit_rule.col_if_over')}</StackedLabel>
                      <OverLimitSummary rule={row.over_limit ?? null} />
                    </TableCell>

                    <TableCell>
                      <StackedLabel>{t('branch_payments.col_payment')}</StackedLabel>
                      <div className="flex flex-col items-start gap-1.5 break-normal">
                        <Chip size="sm" variant="soft" color={STANDING_COLOR[state]}>
                          {t(`admin_billing:billing.standing_${state}`)}
                        </Chip>
                        {row.paused_from_above ? (
                          <span className="text-xs text-muted">{t('branch_payments.paused_from_above_note')}</span>
                        ) : null}
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                          <dt className="text-muted">{t('branch_payments.col_paid_until')}</dt>
                          <dd>{row.standing.paid_until ? formatDate(row.standing.paid_until) : t('branch_payments.no_date')}</dd>
                          {row.days_late ? (
                            <>
                              <dt className="text-muted">{t('branch_payments.col_days_late')}</dt>
                              <dd data-testid={`days-late-${row.id}`} className="font-semibold text-danger">{formatNumber(row.days_late)}</dd>
                            </>
                          ) : null}
                        </dl>
                      </div>
                    </TableCell>

                    <TableCell>
                      {row.can_act ? (
                        // One action in view (a payment, the commonest) and
                        // the rest in a menu, as the admin lists do: a row of
                        // buttons was cut off at the table's edge.
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => setPaymentRow(row)} className="whitespace-nowrap">
                              {t('admin_billing:control.record_payment')}
                            </Button>
                            <Dropdown>
                              <DropdownTrigger>
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="tertiary"
                                  aria-label={t('admin_billing:billing.more_actions_for', { name: row.name })}
                                  isDisabled={busyId !== null}
                                  isLoading={busy}
                                >
                                  <MoreVertical size={16} />
                                </Button>
                              </DropdownTrigger>
                              <DropdownMenu
                                aria-label={t('admin_billing:billing.more_actions_for', { name: row.name })}
                                onAction={(key) => {
                                  if (key === 'date') openDialog(row, 'date');
                                  else if (key === 'history') setHistoryRow(row);
                                  else if (key === 'plan') void openPlanDialog(row);
                                  else if (key === 'rule') setRuleRow(row);
                                  else if (key === 'pause') openDialog(row, 'pause');
                                  else if (key === 'restore') void send(row, 'restore', {}, 'admin_billing:billing.done_restored');
                                }}
                              >
                                {[
                                  <DropdownItem key="date" id="date">{t('branch_payments.set_date')}</DropdownItem>,
                                  <DropdownItem key="history" id="history">{t('admin_billing:control.history_title')}</DropdownItem>,
                                  ...(canChangePlan ? [
                                    <DropdownItem key="plan" id="plan">{t('branch_payments.change_plan')}</DropdownItem>,
                                  ] : []),
                                  <DropdownItem key="rule" id="rule">{t('admin_billing:over_limit_rule.open_dialog')}</DropdownItem>,
                                  ...(state === 'open' ? [
                                    <DropdownItem key="pause" id="pause" className="text-warning">{t('admin_billing:billing.pause_community')}</DropdownItem>,
                                  ] : []),
                                  // Only where this community itself is paused: one
                                  // paused from above is restored on the community
                                  // above it.
                                  ...(state === 'paused' ? [
                                    <DropdownItem key="restore" id="restore" className="text-success">{t('admin_billing:billing.restore_community')}</DropdownItem>,
                                  ] : []),
                                ]}
                              </DropdownMenu>
                            </Dropdown>
                          </div>
                          {canChangePlan ? null : (
                            <span className="text-xs text-muted break-normal">{t('branch_payments.plan_card_subscription')}</span>
                          )}
                        </div>
                      ) : (
                        <span className="block text-xs text-muted break-normal">
                          {row.cannot_act_reason === 'exempt'
                            ? t('branch_payments.cannot_exempt')
                            : t('branch_payments.cannot_pays_platform')}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              }}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <Modal isOpen={dialog !== null} onClose={closeDialog} size="md">
        <ModalContent>
          <ModalHeader className="pr-10">
            {dialog?.kind === 'pause' ? t('admin_billing:billing.pause_modal_title') : t('branch_payments.set_date')}
            {dialog && (
              <span className="text-muted text-sm font-normal ml-2">— {dialog.row.name}</span>
            )}
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              {dialog?.kind === 'date' && dialog.afterPlan ? (
                <p className="text-sm font-medium">{t('admin_billing:control.paid_until_after_plan')}</p>
              ) : null}
              <p className="text-sm text-muted">
                {dialog?.kind === 'pause' ? t('admin_billing:billing.pause_modal_body') : t('branch_payments.date_help')}
              </p>
              {dialog?.kind === 'pause' ? (
                <Input
                  label={t('admin_billing:billing.pause_note_label')}
                  value={text}
                  onValueChange={setText}
                  maxLength={500}
                />
              ) : (
                <Input
                  label={t('branch_payments.date_label')}
                  type="date"
                  value={text}
                  onValueChange={setText}
                />
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeDialog} isDisabled={busyId !== null}>
              {t('admin_billing:billing.cancel')}
            </Button>
            <Button
              color={dialog?.kind === 'pause' ? 'warning' : 'primary'}
              onPress={() => void confirmDialog()}
              isLoading={busyId !== null}
            >
              {dialog?.kind === 'pause' ? t('admin_billing:billing.pause_modal_title') : t('branch_payments.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <RecordPaymentDialog
        via="branch"
        community={paymentRow ? {
          id: paymentRow.id,
          name: paymentRow.name,
          paidUntil: paymentRow.standing.paid_until,
          // The plan on its parent community's terms: what it is asked to pay.
          plan: paymentRow.plan ? {
            monthly: amount(paymentRow.plan.price_monthly),
            yearly: amount(paymentRow.plan.price_yearly),
            currency: paymentRow.plan.currency,
          } : null,
        } : null}
        payeeName={paymentRow?.parent_name ?? null}
        onClose={() => setPaymentRow(null)}
        onRecorded={() => {
          setPaymentRow(null);
          void load();
        }}
        onVoided={() => void load()}
      />

      {/* The payment history alone, from the row's menu. */}
      <RecordPaymentDialog
        via="branch"
        mode="history"
        community={historyRow ? { id: historyRow.id, name: historyRow.name, paidUntil: historyRow.standing.paid_until } : null}
        payeeName={historyRow?.parent_name ?? null}
        onClose={() => setHistoryRow(null)}
        onRecorded={() => setHistoryRow(null)}
        onVoided={() => void load()}
      />

      <OverLimitRuleDialog
        target={ruleRow ? { id: ruleRow.id, name: ruleRow.name, state: ruleRow.over_limit, upgradeAllowed: ruleRow.upgrade_allowed } : null}
        onClose={() => setRuleRow(null)}
        onSave={saveRule}
      />

      <Modal isOpen={planRow !== null} onClose={closePlanDialog} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="pr-10">
            {t('branch_payments.change_plan')}
            {planRow && (
              <span className="text-muted text-sm font-normal ml-2">— {planRow.name}</span>
            )}
          </ModalHeader>
          <ModalBody>
            {plans === 'loading' ? (
              <div role="status" aria-busy="true" aria-label={t('admin_billing:common.loading')} className="flex justify-center py-6">
                <Spinner size="md" />
              </div>
            ) : plans === 'failed' ? (
              <p role="alert" className="text-sm text-danger">{t('branch_payments.plans_load_failed')}</p>
            ) : plans.length === 0 ? (
              <p className="text-sm text-muted">{t('branch_payments.plans_empty')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">{t('branch_payments.plan_help')}</p>
                <RadioGroup label={t('branch_payments.plan_choice_label')} value={planChoice} onValueChange={setPlanChoice}>
                  {plans.map((plan) => {
                    const price = amount(plan.price_monthly);
                    // Sent by the server all along, shown nowhere until 21 Nov 2026.
                    const yearly = amount(plan.price_yearly);
                    const setup = amount(plan.setup_fee);
                    const isCurrent = planRow?.plan?.plan_id === plan.plan_id;
                    const tooSmall = planRow !== null && plan.max_users !== null && plan.max_users < planRow.members.active;

                    return (
                      <Radio
                        key={plan.plan_id}
                        value={String(plan.plan_id)}
                        description={(
                          <span className="flex flex-col gap-0.5">
                            <span>
                              {plan.max_users === null
                                ? t('branch_payments.plan_no_limit')
                                : t('branch_payments.plan_up_to', { max: formatNumber(plan.max_users) })}
                            </span>
                            <span>
                              {price === null || price === 0
                                ? t('branch_payments.plan_no_price')
                                : t('branch_payments.plan_price_monthly', { price: money(price, plan.currency) })}
                            </span>
                            {yearly !== null && yearly > 0 ? (
                              <span>{t('admin_billing:billing.amount_per_year', { amount: money(yearly, plan.currency) })}</span>
                            ) : null}
                            {price !== null && price > 0 ? (
                              <span>
                                {setup !== null && setup > 0
                                  ? t('admin_billing:plan_facts.setup_fee', { amount: money(setup, plan.currency) })
                                  : t('admin_billing:plan_facts.no_setup_fee')}
                              </span>
                            ) : null}
                            {tooSmall && planRow ? (
                              <span className="text-warning">
                                {t('branch_payments.plan_too_small', { active: formatNumber(planRow.members.active) })}
                              </span>
                            ) : null}
                          </span>
                        )}
                      >
                        <span className="flex items-center gap-2">
                          {plan.name}
                          {isCurrent ? (
                            <Chip size="sm" variant="soft" color="primary">{t('branch_payments.plan_current')}</Chip>
                          ) : null}
                        </span>
                      </Radio>
                    );
                  })}
                </RadioGroup>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closePlanDialog} isDisabled={savingPlan}>
              {t('admin_billing:billing.cancel')}
            </Button>
            <Button
              color="primary"
              onPress={() => void savePlan()}
              isLoading={savingPlan}
              isDisabled={!Array.isArray(plans) || planChoice === '' || planChoice === String(planRow?.plan?.plan_id ?? '')}
            >
              {t('branch_payments.save_plan')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default BranchPayments;
