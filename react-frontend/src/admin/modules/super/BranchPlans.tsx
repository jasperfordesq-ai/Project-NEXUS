// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Branch plans
 *
 * A hub's manager and the platform's standard plans as their hub offers them
 * to the communities that pay it: the name, description, member number and
 * prices of each, and whether it is offered at all. A value left empty follows
 * the platform's standard, so a later change to the standard reaches the hub.
 *
 * 🔴 Layout (23 Nov 2026). The table had a fixed minimum width of 860px and
 * scrolled sideways inside its card on a tablet or phone. It is now laid out
 * as a grid (`../billing/CommunityGrid`): six aligned columns from `xl`, a
 * stacked block per plan below it, never wider than its card. "Standard or
 * changed" was a column of its own; it now sits beside the plan's name.
 *
 * 🔴 The screen decides nothing about who may act. The server lists only the
 * hubs the caller may edit (App\Support\Billing\BranchPlans::hubs()) and
 * refuses everything else with its own words, which are shown as sent.
 *
 * 🔴 The types are the server's shape, key for key (PlanTerms::offeredBy(),
 * AdminSuperController::branchPlans()), pinned by
 * tests/Laravel/Feature/Billing/BranchPlansEndpointsTest.php. No mapping layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Layers from 'lucide-react/icons/layers';
import { Alert, Button, Card, CardBody, CardHeader, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, Spinner, Switch, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { COMMUNITY_GRID_LEAD_CELL, PLAN_GRID_CLASSES, StackedLabel } from '../billing/CommunityGrid';
import { LoadFailed } from '../billing/LoadFailed';
import {
  OverLimitRuleFields,
  isOverLimitAction,
  overLimitLabel,
  parseGraceDays,
  type OverLimitAction,
} from '../billing/OverLimitRuleDialog';

/** Money arrives as a number, or as a numeric string from a decimal column. */
type Money = number | string | null;

interface PlanValues {
  name: string;
  description: string | null;
  max_users: number | null;
  price_monthly: Money;
  price_yearly: Money;
  setup_fee: Money;
  price_monthly_gbp: Money;
  price_yearly_gbp: Money;
  setup_fee_gbp: Money;
}

interface HubPlan extends PlanValues {
  plan_id: number;
  slug: string;
  is_offered: boolean;
  changed: boolean;
  changed_fields: string[];
  default: PlanValues;
  communities_on_plan: number;
}

interface Hub {
  id: number;
  name: string;
  depth: number;
  children_paying: number;
}

/**
 * The selected hub's default rule for the communities that pay it, and the
 * platform default it falls back to. Null for both of the hub's values means
 * it follows the platform. Null as a whole when there is no hub to set it on.
 */
interface HubOverLimit {
  action: string | null;
  grace_days: number | null;
  platform_action: string;
  platform_grace_days: number;
  /** The platform team's master switch: while off, no rule acts on anyone. */
  automation_enabled: boolean;
}

interface BranchPlansResponse {
  hubs: Hub[];
  hub_id: number | null;
  /** The selected hub's own billing currency; its column leads the table. */
  hub_currency: 'eur' | 'gbp' | null;
  plans: HubPlan[];
  over_limit: HubOverLimit | null;
}

const MONEY_FIELDS = ['price_monthly', 'price_yearly', 'setup_fee', 'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp'] as const;
const FIELDS = ['name', 'description', 'max_users', ...MONEY_FIELDS] as const;

type MoneyField = typeof MONEY_FIELDS[number];
type Field = typeof FIELDS[number];
type Form = Record<Field, string>;
type FormErrors = Partial<Record<Field, string>>;

const FIELD_LABEL: Record<Field, string> = {
  name: 'branch_plans.field_name',
  description: 'branch_plans.field_description',
  max_users: 'branch_plans.col_members',
  price_monthly: 'branch_plans.col_monthly_eur',
  price_yearly: 'branch_plans.field_yearly_eur',
  setup_fee: 'branch_plans.field_setup_eur',
  price_monthly_gbp: 'branch_plans.col_monthly_gbp',
  price_yearly_gbp: 'branch_plans.field_yearly_gbp',
  setup_fee_gbp: 'branch_plans.field_setup_gbp',
};

const WHOLE_NUMBER = /^\d+$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

// The server's limits (AdminSuperController::branchPlansUpdate), refused here
// first so the manager learns which field is wrong before anything is sent.
const MAX_NAME = 100;
const MAX_DESCRIPTION = 5000;
const MAX_MEMBERS = 10_000_000;
const MAX_AMOUNT = 99_999_999.99;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function currencyOf(field: MoneyField): 'EUR' | 'GBP' {
  return field.endsWith('_gbp') ? 'GBP' : 'EUR';
}

/** Whole amounts without ".00" (a plan reads "£199"), anything else to the penny. */
function money(value: unknown, currency: 'EUR' | 'GBP'): string | null {
  const n = toNumber(value);
  if (n === null) return null;
  return Number.isInteger(n)
    ? formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : formatCurrency(n, currency);
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Only a field the hub has changed starts filled; the rest show the standard as a hint. */
function formFor(plan: HubPlan): Form {
  const form = {} as Form;
  for (const field of FIELDS) {
    form[field] = plan.changed_fields.includes(field) ? asText(plan[field]) : '';
  }
  return form;
}

export function BranchPlans() {
  const { t } = useTranslation(['super_admin', 'admin_billing']);
  usePageTitle(t('branch_plans.title'));
  const toast = useToast();

  const [data, setData] = useState<BranchPlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  // After the first good load, a failed reload keeps the last good table on
  // screen, so the manager can pick another hub or try again.
  const loadedOnce = useRef(false);
  const lastAsked = useRef<number | null>(null);
  const [dialog, setDialog] = useState<HubPlan | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  // The hub's over-limit rule as being edited; refilled from each load.
  const [ruleAction, setRuleAction] = useState<OverLimitAction | null>(null);
  const [ruleDays, setRuleDays] = useState('');
  const [ruleDaysError, setRuleDaysError] = useState<string | undefined>(undefined);
  const [savingRule, setSavingRule] = useState(false);

  const load = useCallback(async (hubId?: number | null) => {
    lastAsked.current = hubId ?? null;
    const path = hubId ? `/v2/admin/super/branch-plans?hub_id=${hubId}` : '/v2/admin/super/branch-plans';
    const response = await api.get<BranchPlansResponse>(path);
    if (response.success && response.data && Array.isArray(response.data.plans) && Array.isArray(response.data.hubs)) {
      setData(response.data);
      const rule = response.data.over_limit ?? null;
      setRuleAction(rule && isOverLimitAction(rule.action) ? rule.action : null);
      setRuleDays(rule && rule.grace_days !== null ? String(rule.grace_days) : '');
      setRuleDaysError(undefined);
      setLoadFailed(false);
      setReloadFailed(false);
      loadedOnce.current = true;
    } else if (loadedOnce.current) {
      setReloadFailed(true);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hubId = data?.hub_id ?? null;
  const hub = data?.hubs.find((h) => h.id === hubId) ?? null;

  const write = async (
    plan: HubPlan,
    method: 'put' | 'delete',
    body: Record<string, unknown> | null,
    doneKey: string,
  ): Promise<boolean> => {
    if (hubId === null) return false;
    const path = `/v2/admin/super/branch-plans/${hubId}/plans/${plan.plan_id}`;
    setBusyId(plan.plan_id);
    const response = method === 'put' ? await api.put(path, body ?? {}) : await api.delete(path);
    setBusyId(null);

    if (response.success) {
      toast.success(t(doneKey));
      void load(hubId);
      return true;
    }

    // The server explains its own refusals in the reader's language.
    // admin-i18n-ignore: localized server message — AdminSuperController Branch plans refusals (lang/*/api.php)
    toast.error(response.error || t('branch_plans.save_failed'));
    return false;
  };

  const openDialog = (plan: HubPlan) => {
    setForm(formFor(plan));
    setErrors({});
    setDialog(plan);
  };

  const closeDialog = () => {
    setDialog(null);
    setForm(null);
    setErrors({});
  };

  const setField = (field: Field, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  const confirmDialog = async () => {
    if (!dialog || !form) return;

    const found: FormErrors = {};
    const body: Record<string, string | number | null> = {};

    for (const field of FIELDS) {
      const value = form[field].trim();
      if (value === '') {
        // Empty means "follow the standard", never zero.
        body[field] = null;
      } else if (field === 'name' || field === 'description') {
        const max = field === 'name' ? MAX_NAME : MAX_DESCRIPTION;
        if (value.length > max) found[field] = t('branch_plans.error_too_long', { field: t(FIELD_LABEL[field]), max: formatNumber(max) });
        else body[field] = value;
      } else if (field === 'max_users') {
        if (!WHOLE_NUMBER.test(value) || Number(value) < 1 || Number(value) > MAX_MEMBERS) {
          found[field] = t('branch_plans.error_members', { field: t(FIELD_LABEL[field]), max: formatNumber(MAX_MEMBERS) });
        } else {
          body[field] = Number(value);
        }
      } else if (!AMOUNT.test(value) || Number(value) > MAX_AMOUNT) {
        found[field] = t('branch_plans.error_price', {
          field: t(FIELD_LABEL[field]),
          max: formatNumber(MAX_AMOUNT, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        });
      } else {
        body[field] = Number(value);
      }
    }

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (await write(dialog, 'put', body, 'branch_plans.done_saved')) closeDialog();
  };

  const saveRule = async () => {
    if (hubId === null) return;
    const days = parseGraceDays(ruleDays);
    if (days === 'invalid') {
      setRuleDaysError(t('admin_billing:over_limit_rule.days_invalid'));
      return;
    }
    setRuleDaysError(undefined);
    setSavingRule(true);
    const response = await api.put(`/v2/admin/super/branch-plans/${hubId}/over-limit`, { action: ruleAction, grace_days: days });
    setSavingRule(false);

    if (response.success) {
      toast.success(t('admin_billing:over_limit_rule.saved'));
      void load(hubId);
      return;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController Branch plans over-limit refusals (lang/*/api.php)
    toast.error(response.error || t('admin_billing:over_limit_rule.save_failed'));
  };

  /** "Standard: £199" under each field, so the manager sees what empty means. */
  const standardLine = (plan: HubPlan, field: Field): string => {
    const standard = plan.default[field];
    let shown: string;
    if (field === 'max_users') {
      const n = toNumber(standard);
      shown = n === null ? t('branch_plans.no_limit') : formatNumber(n);
    } else if (field === 'name' || field === 'description') {
      shown = asText(standard) || '—';
    } else {
      shown = money(standard, currencyOf(field)) ?? '—';
    }
    return t('branch_plans.standard_value', { value: shown });
  };

  const placeholderFor = (plan: HubPlan, field: Field): string => {
    const standard = plan.default[field];
    if (field === 'max_users' || field === 'name' || field === 'description') return asText(standard);
    const n = toNumber(standard);
    return n === null ? '' : String(n);
  };

  const hubPicker = data && data.hubs.length > 1 ? (
    // The community that is PAID, not one that pays: the label read as a list
    // of payers, and a community that only pays another was looked for here
    // (owner, 23 Nov 2026). The line under it says who is listed.
    <Select
      label={t('branch_plans.hub_picker')}
      description={t('branch_plans.hub_picker_help')}
      size="sm"
      className="w-72 max-w-full"
      selectedKeys={hubId !== null ? [String(hubId)] : []}
      onSelectionChange={(keys) => {
        if (keys === 'all') return;
        const picked = Number(Array.from(keys)[0]);
        if (Number.isInteger(picked) && picked > 0 && picked !== hubId) void load(picked);
      }}
    >
      {data.hubs.map((h) => (
        <SelectItem key={String(h.id)} id={String(h.id)}>{h.name}</SelectItem>
      ))}
    </Select>
  ) : null;

  const header = (
    <PageHeader title={t('branch_plans.title')} description={t('branch_plans.description')} actions={hubPicker} />
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

  if (loadFailed || !data) {
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed
          message={t('branch_plans.load_failed')}
          onRetry={() => {
            setLoading(true);
            void load(lastAsked.current);
          }}
        />
      </div>
    );
  }

  if (hubId === null) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted">{t('branch_plans.no_hub')}</p>
      </div>
    );
  }

  const fieldInput = (plan: HubPlan, field: Field) => {
    if (!form) return null;
    const isNumber = field !== 'name' && field !== 'description';
    return (
      <Input
        key={field}
        label={t(FIELD_LABEL[field])}
        value={form[field]}
        onValueChange={(value: string) => setField(field, value)}
        placeholder={placeholderFor(plan, field)}
        description={standardLine(plan, field)}
        inputMode={isNumber ? (field === 'max_users' ? 'numeric' : 'decimal') : undefined}
        maxLength={field === 'name' ? MAX_NAME : field === 'description' ? MAX_DESCRIPTION : 12}
        isInvalid={errors[field] !== undefined}
        errorMessage={errors[field]}
      />
    );
  };

  // The hub's default over-limit rule; none when the server sends none.
  const rule = data.over_limit;
  const platformAction = rule && isOverLimitAction(rule.platform_action) ? rule.platform_action : null;
  const ruleCard = rule ? (
    <Card>
      <CardHeader className="flex flex-col items-start gap-1 pb-0">
        <span className="font-semibold text-sm">{t('admin_billing:over_limit_rule.card_title')}</span>
        <span className="text-xs text-muted">{t('admin_billing:over_limit_rule.card_help')}</span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {/* Said up front so a saved rule is never read as already acting. */}
        {rule.automation_enabled === false ? (
          <Alert color="warning" title={t('admin_billing:over_limit_rule.automation_off_note')} />
        ) : null}
        <div className="sm:max-w-md">
          <OverLimitRuleFields
            action={ruleAction}
            onActionChange={setRuleAction}
            days={ruleDays}
            onDaysChange={setRuleDays}
            followLabel={platformAction
              ? t('admin_billing:over_limit_rule.follow_platform_current', { rule: overLimitLabel(t, platformAction) })
              : t('admin_billing:over_limit_rule.follow_default')}
            inheritedAction={platformAction}
            defaultDays={rule.platform_grace_days}
            // The communities that pay a hub never pay the platform by card.
            allowUpgrade
            daysError={ruleDaysError}
          />
        </div>
        <div className="flex justify-end">
          <Button color="primary" onPress={() => void saveRule()} isLoading={savingRule}>
            {t('admin_billing:over_limit_rule.save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  ) : null;

  // The hub's own currency leads; the other stays beside it.
  const monthlyOrder: MoneyField[] = data.hub_currency === 'gbp'
    ? ['price_monthly_gbp', 'price_monthly']
    : ['price_monthly', 'price_monthly_gbp'];

  return (
    <div className="space-y-6">
      {header}

      {reloadFailed ? (
        // The words go inside: the shared Alert drops its `title` when it is
        // given children, so this showed a "Try again" button with no words.
        <Alert color="danger">
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">{t('branch_plans.reload_failed')}</span>
            <Button size="sm" variant="secondary" onPress={() => void load(lastAsked.current ?? hubId)}>
              {t('branch_plans.try_again')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col items-start gap-1 pb-0">
          <div className="flex flex-row items-center justify-start gap-2">
            <Layers size={18} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="font-semibold text-sm">
              {hub ? t('branch_plans.for_hub', { hub: hub.name }) : t('branch_plans.title')}
            </span>
          </div>
          {/* Who these plans reach. A community that may have others below it
              is listed before any exist, and its plans then apply to nobody. */}
          {hub ? (
            hub.children_paying > 0 ? (
              <span data-testid="branch-plans-payers" className="text-xs text-muted">
                {t('branch_plans.payers_label')}: <span className="font-medium text-foreground">{formatNumber(hub.children_paying)}</span>
              </span>
            ) : (
              <span data-testid="branch-plans-no-payers" className="text-xs text-warning">
                {t('branch_plans.no_payers_note', { hub: hub.name })}
              </span>
            )
          ) : null}
        </CardHeader>
        <CardBody className="p-0">
          {/* One table, laid out as a grid: six aligned columns from `xl`, a
              stacked block per plan below it. Never wider than its card. */}
          <Table aria-label={t('branch_plans.title')} removeWrapper classNames={PLAN_GRID_CLASSES}>
            <TableHeader>
              <TableColumn>{t('branch_plans.col_plan')}</TableColumn>
              <TableColumn>{t('branch_plans.col_members')}</TableColumn>
              {monthlyOrder.map((field) => (
                <TableColumn key={field}>{t(FIELD_LABEL[field])}</TableColumn>
              ))}
              <TableColumn>{t('branch_plans.col_offered')}</TableColumn>
              <TableColumn>{t('admin_billing:billing.col_actions')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('branch_plans.empty')} items={data.plans.map((plan) => ({ ...plan, id: plan.plan_id }))}>
              {(plan) => {
                const busy = busyId === plan.plan_id;
                const members = toNumber(plan.max_users);
                // Showing a plan again is always allowed; hiding one a community is on is not.
                const inUse = plan.is_offered && plan.communities_on_plan > 0;

                return (
                  <TableRow key={plan.plan_id}>
                    <TableCell className={COMMUNITY_GRID_LEAD_CELL}>
                      {/* Words wrap whole: a plan name never breaks letter by letter. */}
                      <div className="flex flex-col gap-1 break-normal">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                          {/* Whether the hub has its own version of this plan. */}
                          <Chip size="sm" variant="soft" color={plan.changed ? 'warning' : 'default'}>
                            {plan.changed ? t('branch_plans.changed') : t('branch_plans.standard')}
                          </Chip>
                        </div>
                        {plan.description ? (
                          <span className="text-xs text-muted line-clamp-2">{plan.description}</span>
                        ) : null}
                        {plan.communities_on_plan > 0 ? (
                          <span data-testid={`plan-in-use-${plan.plan_id}`} className="text-xs text-muted">
                            {t('branch_plans.on_plan_label')}: <span className="font-medium text-foreground">{formatNumber(plan.communities_on_plan)}</span>
                          </span>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>
                      <StackedLabel>{t('branch_plans.col_members')}</StackedLabel>
                      <span className="text-sm">{members === null ? t('branch_plans.no_limit') : formatNumber(members)}</span>
                    </TableCell>

                    {monthlyOrder.map((field) => {
                      // The yearly price and the one-off setup fee sit under
                      // the monthly price in the same currency: both were
                      // only visible inside the Change dialog (owner, 21 Nov 2026).
                      const pounds = field.endsWith('_gbp');
                      const yearlyField: MoneyField = pounds ? 'price_yearly_gbp' : 'price_yearly';
                      const setupField: MoneyField = pounds ? 'setup_fee_gbp' : 'setup_fee';
                      const yearly = money(plan[yearlyField], currencyOf(yearlyField));
                      const setup = money(plan[setupField], currencyOf(setupField));
                      return (
                        <TableCell key={field}>
                          <StackedLabel>{t(FIELD_LABEL[field])}</StackedLabel>
                          <div className="flex flex-col gap-0.5 break-normal">
                            <span data-testid="plan-monthly" className="text-sm font-medium">{money(plan[field], currencyOf(field)) ?? '—'}</span>
                            {yearly !== null ? (
                              <span className="text-xs text-muted">{t(FIELD_LABEL[yearlyField])}: {yearly}</span>
                            ) : null}
                            {setup !== null ? (
                              <span className="text-xs text-muted">{t(FIELD_LABEL[setupField])}: {setup}</span>
                            ) : null}
                          </div>
                        </TableCell>
                      );
                    })}

                    <TableCell>
                      <StackedLabel>{t('branch_plans.col_offered')}</StackedLabel>
                      <div className="flex flex-col items-start gap-1 break-normal">
                        <Switch
                          size="sm"
                          aria-label={t('branch_plans.offered_aria', { plan: plan.name })}
                          isSelected={plan.is_offered}
                          isDisabled={busy || inUse}
                          onValueChange={(offered: boolean) => void write(
                            plan,
                            'put',
                            { is_offered: offered },
                            offered ? 'branch_plans.done_offered' : 'branch_plans.done_hidden',
                          )}
                        />
                        {inUse ? (
                          <span className="text-xs text-muted">{t('branch_plans.in_use_note')}</span>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => openDialog(plan)}>
                          {t('branch_plans.change')}
                        </Button>
                        {plan.changed ? (
                          <Button
                            size="sm"
                            variant="tertiary"
                            isLoading={busy}
                            onPress={() => void write(plan, 'delete', null, 'branch_plans.done_reset')}
                          >
                            {t('branch_plans.back_to_standard')}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {ruleCard}

      <Modal isOpen={dialog !== null} onClose={closeDialog} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {t('branch_plans.change')}
            {dialog && (
              <span className="text-muted text-sm font-normal ml-2">— {dialog.default.name}</span>
            )}
          </ModalHeader>
          <ModalBody>
            {dialog ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">{t('branch_plans.dialog_help')}</p>
                {/* Lowering the member number can put a community that pays
                    this hub over its limit at once, so say so before saving. */}
                {dialog.communities_on_plan > 0 ? (
                  <Alert color="warning" title={t('branch_plans.caution_in_use', { count: dialog.communities_on_plan })} />
                ) : null}
                {fieldInput(dialog, 'name')}
                {fieldInput(dialog, 'description')}
                {fieldInput(dialog, 'max_users')}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fieldInput(dialog, 'price_monthly')}
                  {fieldInput(dialog, 'price_monthly_gbp')}
                  {fieldInput(dialog, 'price_yearly')}
                  {fieldInput(dialog, 'price_yearly_gbp')}
                  {fieldInput(dialog, 'setup_fee')}
                  {fieldInput(dialog, 'setup_fee_gbp')}
                </div>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeDialog} isDisabled={busyId !== null}>
              {t('admin_billing:billing.cancel')}
            </Button>
            <Button color="primary" onPress={() => void confirmDialog()} isLoading={busyId !== null}>
              {t('branch_plans.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default BranchPlans;
