// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NewCommunityBilling
 * The billing part of the new-community form: its plan, who it pays and the
 * date it is paid up to. All three are optional.
 *
 * A new community used to start with none of them, and nothing on the form
 * set them: it ran free until somebody found it (owner decision, 23 Nov 2026:
 * "Yes, on the form").
 *
 * 🔴 Nothing here is a new way to write billing. Once the community exists,
 * `saveNewCommunityBilling()` calls the SAME addresses Billing control and
 * Branch payments call, so every rule, refusal and audit line applies exactly
 * as it does there. Which addresses depends on who is creating:
 *
 *   - `platform_team`  the platform team: any active plan, who it pays, and
 *                      the date (the Billing control addresses, which the
 *                      server keeps for the platform team alone);
 *   - `parent_manager` anyone else creating under a parent community: one of
 *                      the plans that parent offers, and the date (the Branch
 *                      payments addresses). Who it pays is not theirs to set:
 *                      it pays its parent.
 *   - `none`           anyone else creating directly under the platform: the
 *                      platform team sets all three. Nothing is offered.
 *
 * The server decides each of those again on every request. This only stops
 * the form offering what would be refused.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, CardBody, Input, Select, SelectItem } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/helpers';
import { assignablePlans } from './assignablePlans';

export type NewCommunityBillingMode = 'platform_team' | 'parent_manager' | 'none';

/** '' is "the usual way": nothing is stored and the server's own rule applies. */
export type NewCommunityPayer = '' | 'platform_invoice' | 'parent' | 'not_billed';

export interface NewCommunityBillingValue {
  /** '' = no plan yet. */
  planId: string;
  payer: NewCommunityPayer;
  /** YYYY-MM-DD, or '' = no date yet. */
  paidUntil: string;
}

export const EMPTY_NEW_COMMUNITY_BILLING: NewCommunityBillingValue = { planId: '', payer: '', paidUntil: '' };

export type BillingSaveStep = 'payer' | 'plan' | 'date';

export interface BillingSaveFailure {
  step: BillingSaveStep;
  /** The server's own reason, in the reader's language, when it gave one. */
  reason: string | null;
}

/**
 * Save what was chosen for a community that now exists. Every step is tried:
 * a refused plan does not stop the date being saved. Returns the steps that
 * failed; an empty list means everything chosen was saved.
 */
export async function saveNewCommunityBilling(
  tenantId: number,
  mode: NewCommunityBillingMode,
  value: NewCommunityBillingValue,
): Promise<BillingSaveFailure[]> {
  if (mode === 'none') return [];

  const failures: BillingSaveFailure[] = [];
  const attempt = async (step: BillingSaveStep, call: () => Promise<{ success: boolean; error?: string }>) => {
    try {
      const response = await call();
      // admin-i18n-ignore: localized server message — the billing addresses' own refusals (lang/*/api.php)
      if (!response.success) failures.push({ step, reason: response.error || null });
    } catch {
      failures.push({ step, reason: null });
    }
  };
  // Nobody bills it: there is no date to count from.
  const paidUntil = value.payer === 'not_billed' ? '' : value.paidUntil;

  if (mode === 'platform_team') {
    // Who it pays first: it decides whose terms the plan is held to.
    if (value.payer !== '') {
      await attempt('payer', () => api.post('/v2/admin/super/billing/standing/payer', { tenant_id: tenantId, payer: value.payer }));
    }
    if (value.planId !== '') {
      await attempt('plan', () => api.post('/v2/admin/super/billing/assign-plan', { tenant_id: tenantId, pay_plan_id: Number(value.planId) }));
    }
    if (paidUntil !== '') {
      await attempt('date', () => api.post('/v2/admin/super/billing/standing/paid-until', { tenant_id: tenantId, paid_until: paidUntil }));
    }
    return failures;
  }

  if (value.planId !== '') {
    await attempt('plan', () => api.post(`/v2/admin/super/branch-payments/${tenantId}/plan`, { plan_id: Number(value.planId) }));
  }
  if (paidUntil !== '') {
    await attempt('date', () => api.post(`/v2/admin/super/branch-payments/${tenantId}/paid-until`, { paid_until: paidUntil }));
  }
  return failures;
}

interface PlanChoice {
  id: number;
  name: string;
  maxUsers: number | null;
}

type PlanList = 'loading' | 'failed' | PlanChoice[];

interface PlatformPlan {
  id: number;
  name: string;
  max_users: number | string | null;
  is_active?: number | boolean | string | null;
}

interface OfferedPlan {
  plan_id: number;
  name: string;
  max_users: number | null;
  is_offered: boolean;
}

interface NewCommunityBillingProps {
  mode: NewCommunityBillingMode;
  /** The community it will sit under; 1 or null = the platform itself. */
  parentId: number | null;
  parentName: string | null;
  value: NewCommunityBillingValue;
  onChange: (value: NewCommunityBillingValue) => void;
}

export function NewCommunityBilling({ mode, parentId, parentName, value, onChange }: NewCommunityBillingProps) {
  const { t } = useTranslation('admin_billing');
  const [plans, setPlans] = useState<PlanList>('loading');

  const hasParent = parentId !== null && parentId > 1;

  useEffect(() => {
    if (mode === 'none') return undefined;
    let current = true;
    setPlans('loading');

    const load = async (): Promise<PlanList> => {
      if (mode === 'platform_team') {
        const response = await api.get<PlatformPlan[]>('/v2/admin/plans');
        if (!response.success || !Array.isArray(response.data)) return 'failed';
        return assignablePlans(response.data).map((plan) => ({
          id: plan.id,
          name: plan.name,
          maxUsers: plan.max_users == null ? null : Number(plan.max_users),
        }));
      }
      // The plans its parent offers, on its parent's terms.
      const response = await api.get<{ plans: OfferedPlan[] }>(`/v2/admin/super/branch-plans?hub_id=${parentId}`);
      if (!response.success || !response.data || !Array.isArray(response.data.plans)) return 'failed';
      return response.data.plans
        .filter((plan) => plan.is_offered)
        .map((plan) => ({ id: plan.plan_id, name: plan.name, maxUsers: plan.max_users }));
    };

    load()
      .catch((): PlanList => 'failed')
      .then((list) => {
        if (current) setPlans(list);
      });

    return () => {
      current = false;
    };
  }, [mode, parentId]);

  // A plan chosen from one list is not a plan in another (the parent changed).
  const planId = value.planId;
  useEffect(() => {
    if (!Array.isArray(plans) || planId === '') return;
    if (!plans.some((plan) => String(plan.id) === planId)) {
      onChange({ ...value, planId: '' });
    }
    // Only when the list or the choice changes: `value`/`onChange` are read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, planId]);

  // "Its parent community" is not a choice for a community directly under the platform.
  const payer = value.payer;
  useEffect(() => {
    if (payer === 'parent' && !hasParent) onChange({ ...value, payer: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payer, hasParent]);

  if (mode === 'none') return null;

  const usualWay = hasParent && parentName
    ? t('control.new_payer_usual_parent', { name: parentName })
    : t('control.new_payer_usual_platform');
  const payerChoices: NewCommunityPayer[] = hasParent
    ? ['', 'platform_invoice', 'parent', 'not_billed']
    : ['', 'platform_invoice', 'not_billed'];
  const notBilled = value.payer === 'not_billed';

  return (
    <Card data-testid="new-community-billing" className="mb-4">
      <CardBody className="gap-4 p-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('control.new_title')}</h2>
          <p className="mt-1 text-sm text-muted">
            {mode === 'platform_team' ? t('control.new_help_platform') : t('control.new_help_branch')}
          </p>
        </div>

        {plans === 'failed' ? (
          <Alert color="warning" role="alert">
            <span>{t('control.new_plans_failed')}</span>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Select
            label={t('control.new_plan_label')}
            isDisabled={!Array.isArray(plans)}
            selectedKeys={new Set([value.planId === '' ? 'none' : value.planId])}
            onSelectionChange={(keys) => {
              const chosen = String(Array.from(keys)[0] ?? 'none');
              onChange({ ...value, planId: chosen === 'none' ? '' : chosen });
            }}
          >
            {[
              <SelectItem key="none" id="none">{t('control.new_plan_none')}</SelectItem>,
              ...(Array.isArray(plans) ? plans : []).map((plan) => (
                <SelectItem
                  key={String(plan.id)}
                  id={String(plan.id)}
                  description={plan.maxUsers === null
                    ? t('plan_facts.no_member_limit')
                    : t('plan_facts.members_up_to', { max: formatNumber(plan.maxUsers) })}
                >
                  {plan.name}
                </SelectItem>
              )),
            ]}
          </Select>

          {mode === 'platform_team' ? (
            <Select
              label={t('control.new_payer_label')}
              description={t('control.new_payer_card_note')}
              selectedKeys={new Set([value.payer === '' ? 'usual' : value.payer])}
              onSelectionChange={(keys) => {
                const chosen = String(Array.from(keys)[0] ?? 'usual');
                const next = payerChoices.find((choice) => choice === chosen) ?? '';
                onChange({ ...value, payer: next });
              }}
            >
              {payerChoices.map((choice) => (
                <SelectItem key={choice === '' ? 'usual' : choice} id={choice === '' ? 'usual' : choice}>
                  {choice === '' ? usualWay : t(`billing.payer_${choice}`)}
                </SelectItem>
              ))}
            </Select>
          ) : (
            <div className="self-center text-sm">
              <span className="block text-xs text-muted">{t('control.new_payer_label')}</span>
              <span data-testid="new-community-pays" className="font-medium text-foreground">
                {parentName ? t('control.new_pays_parent', { name: parentName }) : t('billing.payer_parent')}
              </span>
            </div>
          )}

          <Input
            label={t('control.paid_until_label')}
            description={notBilled ? t('control.payer_help_not_billed') : t('control.new_paid_until_help')}
            type="date"
            isDisabled={notBilled}
            value={notBilled ? '' : value.paidUntil}
            onValueChange={(next: string) => onChange({ ...value, paidUntil: next })}
          />
        </div>
      </CardBody>
    </Card>
  );
}

export default NewCommunityBilling;
