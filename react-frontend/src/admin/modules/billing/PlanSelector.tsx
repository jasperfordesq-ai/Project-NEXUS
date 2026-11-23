import { Alert, Card, CardBody, CardHeader, CardFooter, Button, Chip, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PlanSelector
 * Plan selection grid with monthly/yearly toggle and Stripe checkout.
 *
 * Each card quotes what card checkout would actually charge this community
 * (`plan.charge`, worked out by the server with the checkout's own rule), so a
 * community billed in pounds is quoted pounds. Until 21 Nov 2026 every price
 * here was formatted as euro, and the card showed neither how many members a
 * plan allows nor its one-off setup fee.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ButtonGroup } from '@/components/ui';
import { Separator } from '@/components/ui';
import Check from 'lucide-react/icons/check';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { billingApi, type Plan, type PlanCharge, type SubscriptionDetails } from '../../api/billingApi';
import { PageHeader } from '../../components/PageHeader';
import { formatCurrency, formatNumber } from '@/lib/helpers';

type Interval = 'monthly' | 'yearly';

/** Free only when nothing is charged in either currency (the server's rule). */
const isFreePlan = (plan: Plan) =>
  !Number(plan.price_monthly) && !Number(plan.price_yearly) &&
  !Number(plan.price_monthly_gbp) && !Number(plan.price_yearly_gbp);

/**
 * What checkout would charge. An older server (mid-deploy) sends no `charge`:
 * fall back to the euro columns, which is what it charged then.
 */
const chargeFor = (plan: Plan, interval: Interval): PlanCharge =>
  plan.charge?.[interval] ?? {
    currency: 'eur',
    amount: Number(interval === 'monthly' ? plan.price_monthly : plan.price_yearly) || 0,
    setup_fee: Number(plan.setup_fee) || 0,
  };

/** Whole amounts without ".00" (a plan reads "£199"), anything else to the penny. */
const formatPrice = (amount: number, currency: PlanCharge['currency']) =>
  Number.isInteger(amount)
    ? formatCurrency(amount, currency.toUpperCase(), { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : formatCurrency(amount, currency.toUpperCase());

/** The whole-number saving of paying yearly, from the first plan sold both ways. */
const yearlySavingPercent = (plans: Plan[]): number => {
  for (const plan of plans) {
    const monthly = chargeFor(plan, 'monthly');
    const yearly = chargeFor(plan, 'yearly');
    if (monthly.amount > 0 && yearly.amount > 0 && monthly.currency === yearly.currency) {
      return Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100);
    }
  }
  return 0;
};

export function PlanSelector() {
  const { t } = useTranslation('admin_billing');
  usePageTitle(t('billing.choose_plan'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [billingInterval, setBillingInterval] = useState<Interval>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        billingApi.getPlans(),
        billingApi.getSubscription().catch(() => null),
      ]);
      if (plansRes.success && plansRes.data) {
        const planData = plansRes.data as unknown;
        if (Array.isArray(planData)) {
          setPlans(planData);
        }
      }
      if (subRes?.success && subRes.data) {
        setSubscription(subRes.data as unknown as SubscriptionDetails);
      }
    } catch {
      toast.error(t('billing.load_error'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubscribe = async (planId: number) => {
    setCheckoutLoading(planId);
    try {
      const res = await billingApi.createCheckout({
        plan_id: planId,
        billing_interval: billingInterval,
      });
      if (res.success && res.data) {
        const data = res.data as unknown as { checkout_url: string | null; activated?: boolean };
        if (data.activated) {
          toast.success(t('billing.free_plan_activated'));
          navigate(tenantPath('/admin/billing'));
        } else if (data.checkout_url) {
          window.location.href = data.checkout_url;
        } else {
          toast.error(t('billing.checkout_error'));
        }
      } else {
        // The server says why in the reader's language ("pays its parent",
        // "not sold monthly"); that sentence used to be thrown away.
        // admin-i18n-ignore: localized server message — AdminBillingController checkout refusals (lang/*/api.php)
        toast.error(res.error || t('billing.checkout_error'));
      }
    } catch {
      toast.error(t('billing.checkout_error'));
    } finally {
      setCheckoutLoading(null);
    }
  };

  // The server names it `pay_plan_id`. Reading `plan_id` meant no plan was ever
  // marked current, so a card payer could subscribe to its own plan again.
  const currentPlanId = subscription?.pay_plan_id ?? null;

  // Stripe still has a card subscription open for this community. A checkout
  // always starts a NEW subscription, so a second one would be charged beside
  // the first; the server refuses it (ALREADY_SUBSCRIBED). A card payer
  // changes plan by changing the subscription it has (changePlan), which this
  // screen offers instead of "Subscribe".
  const paysByCard = subscription?.has_card_subscription === true;
  // The last card payment failed: the card is put right first (the server
  // refuses a change with CARD_NEEDS_ATTENTION).
  const cardStatus = subscription?.stripe_status ?? null;
  const cardNeedsFixing = paysByCard && cardStatus !== null && cardStatus !== 'active' && cardStatus !== 'trialing';
  // The period the card subscription is on, when known.
  const currentInterval = subscription?.billing_interval ?? null;

  // A card payer whose card has failed is recorded as `expired`, but its plan
  // is still the one it is on: Stripe is still collecting for it. For a card
  // payer the same plan on the OTHER period is a change it can make.
  const isCurrentPlan = (plan: Plan) =>
    subscription &&
    currentPlanId === plan.id &&
    (paysByCard
      ? currentInterval === null || currentInterval === billingInterval || cardNeedsFixing
      : subscription.status !== 'cancelled' && subscription.status !== 'expired');

  const isActivePaidSubscription =
    !!subscription &&
    subscription.status !== 'cancelled' &&
    subscription.status !== 'expired' &&
    subscription.plan_tier_level > 0;

  // Not on offer from this screen: a no-charge plan for a community on a paid
  // one, and anything at all for a card payer whose card has to be put right.
  const isDowngrade = (plan: Plan) =>
    !isCurrentPlan(plan) && (
      paysByCard ? cardNeedsFixing || isFreePlan(plan) : isActivePaidSubscription && isFreePlan(plan)
    );

  const [changeTo, setChangeTo] = useState<Plan | null>(null);
  const [changing, setChanging] = useState(false);

  const confirmChange = async () => {
    if (!changeTo) return;
    setChanging(true);
    try {
      const res = await billingApi.changePlan({ plan_id: changeTo.id, billing_interval: billingInterval });
      if (res.success) {
        toast.success(t('plan_facts.change_done', { plan: changeTo.name }));
        setChangeTo(null);
        await loadData();
      } else {
        // admin-i18n-ignore: localized server message — AdminBillingController change-plan refusals (lang/*/api.php)
        toast.error(res.error || t('billing.checkout_error'));
      }
    } catch {
      toast.error(t('billing.checkout_error'));
    } finally {
      setChanging(false);
    }
  };

  const savingPercent = yearlySavingPercent(plans);
  // Checkout adds the setup fee to the first payment, once. The server sends
  // 0 for a community that has paid before, so nothing is shown for it.
  const anySetupFee = plans.some((plan) => chargeFor(plan, billingInterval).setup_fee > 0);

  return (
    <div>
      <PageHeader
        title={t('billing.choose_plan')}
        description={t('billing.plans_description')}
      />

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {cardNeedsFixing ? (
            <Alert color="danger" className="mb-6" title={t('plan_facts.card_fix_first')} />
          ) : paysByCard ? (
            <Alert color="default" className="mb-6" title={t('plan_facts.already_by_card')} />
          ) : null}

          {/* Billing interval toggle */}
          <div className="flex justify-center mb-8">
            <ButtonGroup>
              <Button
                color={billingInterval === 'monthly' ? 'primary' : 'default'}
                variant={billingInterval === 'monthly' ? 'solid' : 'bordered'}
                onPress={() => setBillingInterval('monthly')}
              >
                {t('billing.monthly')}
              </Button>
              <Button
                color={billingInterval === 'yearly' ? 'primary' : 'default'}
                variant={billingInterval === 'yearly' ? 'solid' : 'bordered'}
                onPress={() => setBillingInterval('yearly')}
              >
                {t('billing.yearly')}
                {savingPercent > 0 ? (
                  <Chip size="sm" color="success" variant="soft" className="ml-2">
                    {t('billing.save_percent', { percent: savingPercent })}
                  </Chip>
                ) : null}
              </Button>
            </ButtonGroup>
          </div>

          {/* Plan cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {plans.map((plan) => {
              const isCurrent = isCurrentPlan(plan);
              const isDowngradeBlocked = isDowngrade(plan);
              const charge = chargeFor(plan, billingInterval);
              const members = plan.max_users != null ? Number(plan.max_users) : null;

              return (
                <Card
                  key={plan.id}
                  className={`relative ${isCurrent ? 'border-2 border-accent' : ''} ${isDowngradeBlocked ? 'opacity-60' : ''}`}
                >
                  {isCurrent && (
                    <Chip
                      size="sm"
                      variant="primary"
                      className="absolute top-3 right-3 z-10"
                    >
                      {t('billing.current')}
                    </Chip>
                  )}
                  {isDowngradeBlocked && (
                    <Chip
                      size="sm"
                      variant="soft"
                      className="absolute top-3 right-3 z-10"
                    >
                      {t('billing.not_available')}
                    </Chip>
                  )}
                  <CardHeader className="flex-col items-start gap-1 pb-0">
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    {/* How many members the plan allows, from its own number
                        (never from the description, which a person can edit). */}
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {members === null
                        ? t('plan_facts.no_member_limit')
                        : t('plan_facts.members_up_to', { max: formatNumber(members) })}
                    </p>
                    {plan.description ? (
                      <p className="text-sm text-muted">{plan.description}</p>
                    ) : null}
                  </CardHeader>
                  <CardBody className="gap-4">
                    <div className="flex flex-col gap-1">
                      <div>
                        <span className="text-3xl font-bold">{formatPrice(charge.amount, charge.currency)}</span>
                        <span className="text-muted text-sm ml-1">
                          /{billingInterval === 'monthly'
                            ? t('billing.per_month')
                            : t('billing.per_year')}
                        </span>
                      </div>
                      {isFreePlan(plan) ? null : (
                        <p className="text-sm">
                          {charge.setup_fee > 0
                            ? t('plan_facts.setup_fee', { amount: formatPrice(charge.setup_fee, charge.currency) })
                            : t('plan_facts.no_setup_fee')}
                        </p>
                      )}
                      {billingInterval === 'yearly' && charge.setup_fee > 0 && charge.amount > 0 ? (
                        <p className="text-xs text-muted">
                          {t('plan_facts.year_one', {
                            first: formatPrice(charge.amount + charge.setup_fee, charge.currency),
                            renewal: formatPrice(charge.amount, charge.currency),
                          })}
                        </p>
                      ) : null}
                    </div>

                    <Separator />

                    <ul className="space-y-2">
                      {(Array.isArray(plan.features) ? plan.features : []).map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                  <CardFooter>
                    {isDowngradeBlocked && !isCurrent ? (
                      // A plan this community cannot move to by itself. This
                      // was a greyed-out "Contact Support" button that led
                      // nowhere; it now opens the message box on Billing.
                      <Button
                        as={Link}
                        to={tenantPath('/admin/billing?message=1')}
                        color="default"
                        variant="flat"
                        fullWidth
                      >
                        {t('billing.request_upgrade')}
                      </Button>
                    ) : (
                      <Button
                        color={isCurrent ? 'default' : 'primary'}
                        variant={isCurrent ? 'flat' : 'solid'}
                        isDisabled={!!isCurrent}
                        isLoading={checkoutLoading === plan.id}
                        onPress={() => (paysByCard ? setChangeTo(plan) : handleSubscribe(plan.id))}
                        fullWidth
                      >
                        {isCurrent
                          ? t('billing.current')
                          : paysByCard
                            ? t('plan_facts.change_to_plan')
                            : t('billing.subscribe')}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {anySetupFee ? (
            <p className="mt-6 text-center text-sm text-muted">{t('plan_facts.setup_fee_first_payment')}</p>
          ) : null}

          {plans.length === 0 && (
            <div className="text-center py-12 text-muted">
              {t('billing.no_plans')}
            </div>
          )}
        </>
      )}

      {/* A change of plan moves money: it is confirmed, with what happens said plainly. */}
      <Modal isOpen={changeTo !== null} onClose={() => (changing ? undefined : setChangeTo(null))} size="md">
        <ModalContent>
          <ModalHeader>{changeTo ? t('plan_facts.change_confirm_title', { plan: changeTo.name }) : null}</ModalHeader>
          <ModalBody>
            {changeTo ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-medium">
                  {t(billingInterval === 'monthly' ? 'billing.amount_per_month' : 'billing.amount_per_year', {
                    amount: formatPrice(chargeFor(changeTo, billingInterval).amount, chargeFor(changeTo, billingInterval).currency),
                  })}
                </p>
                <p className="text-muted">{t('plan_facts.change_confirm_body')}</p>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setChangeTo(null)} isDisabled={changing}>
              {t('billing.cancel')}
            </Button>
            <Button color="primary" onPress={() => void confirmChange()} isLoading={changing}>
              {t('plan_facts.change_confirm_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default PlanSelector;
