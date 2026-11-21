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
 * against that plan's limit. The manager records a paid-until date, pauses a
 * community, restores it and changes its plan.
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
import Banknote from 'lucide-react/icons/banknote';
import { Button, Card, CardBody, CardHeader, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Radio, RadioGroup, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';

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

/** Active members (TenantBillingService::getSubtreeActiveMemberCount()) against the plan's limit. */
interface Members {
  active: number;
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
}

type PlanList = Terms[] | 'loading' | 'failed';

type StandingState = 'open' | 'paused' | 'paused_from_above' | 'exempt';
type Dialog = { row: BranchRow; kind: 'date' | 'pause' } | null;
type ChipColor = 'success' | 'warning' | 'danger' | 'primary';

function standingState(row: BranchRow): StandingState {
  if (row.standing.exempt) return 'exempt';
  if (row.standing.suspended_at !== null) return 'paused';
  if (row.standing.locked) return 'paused_from_above';
  return 'open';
}

// How far a community sits below the top of the list, as whole class names so
// the stylesheet keeps them (inline styles are not allowed in new pages).
const INDENT = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'] as const;

function indentFor(depth: number): string {
  return INDENT[Math.min(INDENT.length - 1, Math.max(0, depth - 1))] ?? INDENT[0];
}

/** Warning colour from 80% of the plan's limit, danger and bold from 100%. */
function membersClass(members: Members): string {
  if (members.percent !== null && members.percent >= 100) return 'text-sm font-semibold text-danger';
  if (members.percent !== null && members.percent >= 80) return 'text-sm text-warning';
  return 'text-sm';
}

function membersText(members: Members): string {
  return members.max === null
    ? formatNumber(members.active)
    : `${formatNumber(members.active)} / ${formatNumber(members.max)}`;
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
  exempt: 'primary',
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

  const openDialog = (row: BranchRow, kind: 'date' | 'pause') => {
    setText(kind === 'date' ? (row.standing.paid_until ?? '') : '');
    setDialog({ row, kind });
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
      closePlanDialog();
      void load();
      return;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController Branch payments plan refusals (lang/*/api.php)
    toast.error(response.error || t('admin_billing:billing.standing_failed'));
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
        <p role="alert" className="text-sm text-danger">{t('branch_payments.load_failed')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <Banknote size={18} className="text-accent" aria-hidden="true" />
          <span className="font-semibold text-sm">{t('branch_payments.title')}</span>
        </CardHeader>
        <CardBody className="p-0">
          <Table aria-label={t('branch_payments.title')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('branch_payments.col_community')}</TableColumn>
              <TableColumn>{t('admin_billing:billing.col_pays')}</TableColumn>
              <TableColumn>{t('branch_payments.col_plan')}</TableColumn>
              <TableColumn>{t('branch_payments.col_members')}</TableColumn>
              <TableColumn>{t('branch_payments.col_paid_until')}</TableColumn>
              <TableColumn>{t('branch_payments.col_days_late')}</TableColumn>
              <TableColumn>{t('admin_billing:billing.col_standing')}</TableColumn>
              <TableColumn>{t('admin_billing:billing.col_actions')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('branch_payments.empty')} items={rows}>
              {(row) => {
                const state = standingState(row);
                const busy = busyId === row.id;
                const paysParent = row.standing.payer === 'parent';

                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className={`text-sm font-medium ${indentFor(row.depth)}`}>
                        {row.name}
                      </span>
                    </TableCell>

                    <TableCell>
                      <span className="text-sm text-muted">
                        {paysParent && row.parent_name ? row.parent_name : t('branch_payments.pays_platform')}
                      </span>
                    </TableCell>

                    <TableCell>
                      {row.plan ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{row.plan.name}</span>
                          {row.plan.terms === 'hub' ? (
                            <span className="text-xs text-muted">{t('branch_payments.plan_hub_terms')}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-sm text-muted">{t('branch_payments.no_plan')}</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className={membersClass(row.members)}>{membersText(row.members)}</span>
                    </TableCell>

                    <TableCell>
                      <span className="text-sm text-muted">
                        {row.standing.paid_until ? formatDate(row.standing.paid_until) : t('branch_payments.no_date')}
                      </span>
                    </TableCell>

                    <TableCell>
                      <span className={`text-sm ${row.days_late ? 'font-semibold text-danger' : 'text-muted'}`}>
                        {row.days_late ?? '—'}
                      </span>
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Chip size="sm" variant="soft" color={STANDING_COLOR[state]}>
                          {t(`admin_billing:billing.standing_${state}`)}
                        </Chip>
                        {row.paused_from_above ? (
                          <span className="text-xs text-muted">{t('branch_payments.paused_from_above_note')}</span>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>
                      {row.can_act ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => openDialog(row, 'date')}>
                            {t('branch_payments.set_date')}
                          </Button>

                          {row.plan_change_refusal === 'card_subscription' ? (
                            <span className="text-xs text-muted">{t('branch_payments.plan_card_subscription')}</span>
                          ) : (
                            <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void openPlanDialog(row)}>
                              {t('branch_payments.change_plan')}
                            </Button>
                          )}

                          {state === 'open' ? (
                            <Button size="sm" color="warning" variant="tertiary" isDisabled={busy} onPress={() => openDialog(row, 'pause')}>
                              {t('admin_billing:billing.pause_community')}
                            </Button>
                          ) : null}

                          {/* Only where this community itself is paused. One
                              paused from above is restored on the community
                              above it. */}
                          {state === 'paused' ? (
                            <Button
                              size="sm"
                              color="success"
                              variant="secondary"
                              isLoading={busy}
                              onPress={() => void send(row, 'restore', {}, 'admin_billing:billing.done_restored')}
                            >
                              {t('admin_billing:billing.restore_community')}
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">
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
          <ModalHeader>
            {dialog?.kind === 'pause' ? t('admin_billing:billing.pause_modal_title') : t('branch_payments.set_date')}
            {dialog && (
              <span className="text-muted text-sm font-normal ml-2">— {dialog.row.name}</span>
            )}
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
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

      <Modal isOpen={planRow !== null} onClose={closePlanDialog} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
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
