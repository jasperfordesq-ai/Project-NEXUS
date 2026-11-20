import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import CreditCard from 'lucide-react/icons/credit-card';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Leaf from 'lucide-react/icons/leaf';
import Download from 'lucide-react/icons/download';
import { usePageTitle } from '@/hooks';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { BillingDevelopmentNotice } from './BillingDevelopmentNotice';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BillingControl
 * Platform team billing dashboard — every community's plan and price, who it
 * pays, and whether it is paused for non-payment or exempt; assign a plan,
 * pause, restore, exempt, and export a CSV.
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
  price_monthly: number;
  price_yearly: number;
  custom_price_monthly: number | null;
  custom_price_yearly: number | null;
  discount_percentage: number;
  discount_reason: string | null;
  grace_period_ends_at: string | null;
  is_paused: boolean;
  nonprofit_verified: boolean;
  expires_at: string | null;
  effective_price: EffectivePrice;
}

type Payer = 'platform_card' | 'platform_invoice' | 'parent' | 'not_billed';

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
  suggested_plan: string;
  over_limit: boolean;
  is_in_grace_period: boolean;
  grace_days_remaining: number;
  standing: Standing;
}

/** A row of GET /v2/admin/plans. Prices arrive as the database's strings. */
interface PlanItem {
  id: number;
  name: string;
  slug: string;
  max_users: number | null;
  price_monthly: number | string | null;
  price_yearly: number | string | null;
}

type StandingState = 'open' | 'paused' | 'paused_from_above' | 'exempt';
type StandingDialog = { row: TenantSnapshot; kind: 'pause' | 'exempt' } | null;
type ChipColor = 'success' | 'warning' | 'danger' | 'default' | 'primary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEur(amount: number): string {
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const formatUserCount = (row: TenantSnapshot): string => {
  if (row.subtree_user_count !== row.own_user_count) {
    return `${row.own_user_count} (${row.subtree_user_count})`;
  }
  return String(row.own_user_count);
};

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
  exempt: 'primary',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BillingControl() {
  const { t } = useTranslation('admin_billing');
  usePageTitle(t('billing.control_title'));
  const { user } = useAuth();
  const toast = useToast();

  const userRecord = user as Record<string, unknown> | null;
  const isGod = userRecord?.is_god === true;

  // ---- snapshot state ----
  const [snapshot, setSnapshot] = useState<TenantSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- plans state ----
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  // ---- assign plan modal ----
  const { isOpen: isAssignOpen, onOpen: onAssignOpen, onClose: onAssignClose } = useDisclosure();
  const [selectedTenant, setSelectedTenant] = useState<TenantSnapshot | null>(null);
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

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    const response = await api.get<TenantSnapshot[]>('/v2/admin/super/billing/snapshot');
    if (response.success && Array.isArray(response.data)) {
      setSnapshot(response.data);
    } else {
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

  // ---------------------------------------------------------------------------
  // Assign plan handlers
  // ---------------------------------------------------------------------------

  const handleOpenAssign = (tenant: TenantSnapshot) => {
    const plan = tenant.current_plan;
    setSelectedTenant(tenant);
    setSelectedPlanId(plan ? String(plan.id) : '');
    setExpiresAt('');
    setNotes('');
    setCustomPriceMonthly(plan && plan.custom_price_monthly !== null ? String(plan.custom_price_monthly) : '');
    setCustomPriceYearly(plan && plan.custom_price_yearly !== null ? String(plan.custom_price_yearly) : '');
    setDiscountPct(String(plan?.discount_percentage ?? 0));
    setDiscountReason(plan?.discount_reason ?? '');
    setNonprofitVerified(plan?.nonprofit_verified ?? false);
    void fetchPlans();
    onAssignOpen();
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
      toast.error(t('billing.failed_to_assign'));
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
  // Plan chip rendering
  // ---------------------------------------------------------------------------

  const getPlanChipColor = (row: TenantSnapshot): ChipColor => {
    if (!row.current_plan) return 'default';
    if (row.is_in_grace_period) return 'danger';
    if (row.over_limit) return 'warning';
    return 'success';
  };

  const getPlanChipLabel = (row: TenantSnapshot): string => {
    if (!row.current_plan) return t('billing.status_no_plan');
    if (row.is_in_grace_period) return t('billing.in_grace_period');
    if (row.over_limit) return t('billing.over_limit');
    return row.current_plan.name;
  };

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

      <Card>
        <CardHeader className="flex items-center gap-2 pb-0">
          <CreditCard size={18} className="text-accent" />
          <span className="font-semibold text-sm">{t('billing.control_title')}</span>
        </CardHeader>
        <CardBody className="p-0">
          <Table aria-label={t('billing.control_title')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('billing.col_tenant')}</TableColumn>
              <TableColumn>{t('billing.col_users')}</TableColumn>
              <TableColumn>{t('billing.col_current_plan')}</TableColumn>
              <TableColumn>{t('billing.col_effective_price')}</TableColumn>
              <TableColumn>{t('billing.col_pays')}</TableColumn>
              <TableColumn>{t('billing.col_standing')}</TableColumn>
              {isGod
                ? <TableColumn>{t('billing.col_actions')}</TableColumn>
                : <TableColumn>{''}</TableColumn>
              }
            </TableHeader>
            <TableBody emptyContent={t('billing.failed_to_load')} items={snapshot}>
              {(row) => {
                const price = row.current_plan?.effective_price ?? null;
                const state = standingState(row);
                const busy = standingBusyId === row.id;

                return (
                  <TableRow key={row.id}>
                    {/* Community name with depth indent */}
                    <TableCell>
                      <span
                        className="text-sm font-medium"
                        style={{ paddingLeft: `${row.depth * 16}px` }}
                      >
                        {row.over_limit && !row.is_in_grace_period && (
                          <AlertTriangle size={14} className="inline mr-1 text-warning-soft-foreground" aria-hidden="true" />
                        )}
                        {row.name}
                      </span>
                    </TableCell>

                    {/* Users: own + subtree total */}
                    <TableCell>
                      <span className="text-sm text-muted">
                        {formatUserCount(row)}
                      </span>
                    </TableCell>

                    {/* Plan chip */}
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={getPlanChipColor(row)}
                      >
                        {getPlanChipLabel(row)}
                      </Chip>
                    </TableCell>

                    {/* Effective price */}
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-sm text-foreground">
                          {price
                            ? `${formatEur(price.yearly)}/${t('billing.yearly_suffix')}`
                            : '—'
                          }
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
                      <span className="text-sm text-muted">
                        {t(`billing.payer_${row.standing.payer}`)}
                      </span>
                    </TableCell>

                    {/* Standing */}
                    <TableCell>
                      <Chip size="sm" variant="soft" color={STANDING_COLOR[state]}>
                        {t(`billing.standing_${state}`)}
                      </Chip>
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      {isGod ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() => handleOpenAssign(row)}
                          >
                            {t('billing.assign_plan')}
                          </Button>

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
                <Select
                  label={t('billing.select_plan')}
                  selectedKeys={selectedPlanId ? new Set([selectedPlanId]) : new Set<string>()}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0];
                    setSelectedPlanId(val ? String(val) : '');
                  }}
                  isRequired
                >
                  {plans.map((plan) => (
                    <SelectItem key={String(plan.id)} id={String(plan.id)}>
                      {plan.name}
                    </SelectItem>
                  ))}
                </Select>

                <Input
                  label={t('billing.expiry_date')}
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
                <Input
                  label={t('billing.custom_price_monthly')}
                  type="number"
                  min={0}
                  value={customPriceMonthly}
                  onValueChange={setCustomPriceMonthly}
                  placeholder={selectedPlan?.price_monthly != null ? String(selectedPlan.price_monthly) : ''}
                  startContent={<span className="text-muted text-sm">€</span>}
                />

                <Input
                  label={t('billing.custom_price_yearly')}
                  type="number"
                  min={0}
                  value={customPriceYearly}
                  onValueChange={setCustomPriceYearly}
                  placeholder={selectedPlan?.price_yearly != null ? String(selectedPlan.price_yearly) : ''}
                  startContent={<span className="text-muted text-sm">€</span>}
                />

                <Input
                  label={t('billing.discount_pct')}
                  type="number"
                  min={0}
                  max={100}
                  value={discountPct}
                  onValueChange={setDiscountPct}
                  endContent={<span className="text-muted text-sm">%</span>}
                />

                <Input
                  label={t('billing.discount_reason')}
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
    </div>
  );
}

export default BillingControl;
