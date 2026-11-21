// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BillingPage
 * A community's own billing page: the plan it is on, what that plan allows
 * and costs, how many active members it has against it, who it pays, and the
 * dates that matter.
 *
 * 🔴 The types are the server's shape, key for key, and are pinned from the
 * other end by tests/Laravel/Feature/Billing/CommunityBillingPageContractTest.php.
 * Until 21 November 2026 this page read fields the server never sent
 * (`plan_id`, `current_period_end`, `user_count`, `plan.max_users`), so it
 * said "Unlimited Users" for every community, "Unknown interval", and "--"
 * for the next payment, while its test passed on invented data.
 *
 *  - GET /v2/admin/billing/subscription: the plan record and the card
 *    subscription (StripeSubscriptionService::getSubscriptionDetails()).
 *  - GET /v2/admin/billing/standing: the plan as it applies to the community
 *    in its own currency, its active members, who it pays and its dates
 *    (AdminBillingController::getStanding()).
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import CreditCard from 'lucide-react/icons/credit-card';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Receipt from 'lucide-react/icons/receipt';
import Settings from 'lucide-react/icons/settings';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { Alert, Card, CardBody, CardHeader, Button, Chip, Spinner, Textarea, Progress, Separator, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, formatNumber, formatPercentValue } from '@/lib/helpers';
import { billingApi, type OwnStanding, type SubscriptionDetails } from '../../api/billingApi';
import { PageHeader } from '../../components/PageHeader';

/** Stripe's words for a card subscription whose last payment did not go through. */
const CARD_NEEDS_ATTENTION = ['past_due', 'unpaid', 'incomplete'];

function statusColor(status: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'active':
      return 'success';
    case 'trial':
    case 'trialing':
      return 'warning';
    case 'cancelled':
    case 'expired':
      return 'danger';
    default:
      return 'default';
  }
}

/** The label key for a plan record's status. The record says `trial`; Stripe says `trialing`. */
function statusLabelKey(status: string): string {
  switch (status) {
    case 'active':
      return 'billing.status_active';
    case 'trial':
    case 'trialing':
      return 'billing.status_trialing';
    case 'cancelled':
      return 'billing.status_cancelled';
    case 'expired':
      return 'billing.status_expired';
    default:
      return 'billing.status_unknown';
  }
}

/** Whole amounts without ".00" (a plan reads "£199"), anything else to the penny. */
function money(amount: number, currency: 'eur' | 'gbp'): string {
  const code = currency === 'gbp' ? 'GBP' : 'EUR';
  return Number.isInteger(amount)
    ? formatCurrency(amount, code, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : formatCurrency(amount, code);
}

function positive(value: number | string | null | undefined): number | null {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function BillingPage() {
  const { t } = useTranslation('admin_billing');
  usePageTitle(t('billing.title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (searchParams.get('cancelled') === '1') {
      toast.warning(t('billing.checkout_cancelled'));
      navigate(tenantPath('/admin/billing'), { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { isOpen: isUpgradeOpen, onOpen: onUpgradeOpen, onClose: onUpgradeClose } = useDisclosure();
  const [upgradeMessage, setUpgradeMessage] = useState('');
  const [upgradeSending, setUpgradeSending] = useState(false);

  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null);
  const [standing, setStanding] = useState<OwnStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // The API client answers "not successful" instead of throwing, so a
    // refused or failed load is told apart from "nothing there" by `success`.
    const [subRes, standingRes] = await Promise.all([
      billingApi.getSubscription().catch(() => null),
      billingApi.getStanding().catch(() => null),
    ]);

    setSubscription(subRes?.success && subRes.data ? subRes.data : null);
    setStanding(standingRes?.success && standingRes.data ? standingRes.data : null);
    // "No plan record" is a successful answer with no data; only a failed
    // request for the standing means the page has nothing reliable to show.
    setLoadFailed(!standingRes?.success);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleManagePayment = async () => {
    setPortalLoading(true);
    try {
      const res = await billingApi.createPortal();
      if (res.success && res.data?.portal_url) {
        window.open(res.data.portal_url, '_blank', 'noopener,noreferrer');
      } else {
        // The server says why in the reader's language.
        // admin-i18n-ignore: localized server message — AdminBillingController portal refusals (lang/*/api.php)
        toast.error(res.error || t('billing.portal_error'));
      }
    } catch {
      toast.error(t('billing.portal_error'));
    } finally {
      setPortalLoading(false);
    }
  };

  const handleUpgradeRequest = async () => {
    setUpgradeSending(true);
    const response = await api.post('/v2/admin/billing/upgrade-request', {
      message: upgradeMessage,
    });
    if (response.success) {
      toast.success(t('billing.upgrade_sent'));
      onUpgradeClose();
      setUpgradeMessage('');
    } else {
      // Said plainly, and the message is kept so it can be sent again. This
      // used to open the admin's email program addressed to one person.
      // admin-i18n-ignore: localized server message — AdminBillingController upgrade request (lang/*/api.php)
      toast.error(response.error || t('own_billing.request_failed'));
    }
    setUpgradeSending(false);
  };

  const plan = standing?.plan ?? null;
  const payer = standing?.payer ?? null;
  const paysParent = payer === 'parent';
  // Stripe still has a card subscription open (paying, on trial, or with a
  // failed card): the card can be managed in Stripe's own pages.
  const hasCard = subscription?.has_card_subscription === true;
  const cardNeedsAttention = hasCard && CARD_NEEDS_ATTENTION.includes(subscription?.stripe_status ?? '');
  // The plan record's own status, shown only when it is not plainly active.
  const recordStatus = subscription?.status ?? null;
  const planName = plan?.name ?? (recordStatus === 'active' || recordStatus === 'trial' ? subscription?.plan_name : null) ?? null;

  const members = standing?.member_limit ?? null;
  const maxMembers = plan?.max_users ?? null;

  const monthly = plan ? positive(plan.price_monthly) : null;
  const yearly = plan ? positive(plan.price_yearly) : null;
  const setupFee = plan ? positive(plan.setup_fee) : null;
  const interval = subscription?.billing_interval ?? null;

  const header = <PageHeader title={t('billing.title')} description={t('billing.description')} />;

  if (loading) {
    return (
      <div>
        {header}
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div>
        {header}
        {/* The words go inside: the shared Alert drops its `title` when it
            is given children. */}
        <Alert color="danger">
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">{t('own_billing.load_failed')}</span>
            <Button size="sm" variant="secondary" onPress={() => void load()}>
              {t('billing.try_again')}
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      {header}

      {paysParent ? (
        <Alert color="default" className="mb-6" title={t('own_billing.pays_parent_note')} />
      ) : null}

      {cardNeedsAttention ? (
        <Alert color="danger" className="mb-6" title={t('own_billing.card_failed')} />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── The plan ─── */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex gap-3">
            <CreditCard aria-hidden="true" className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold">{t('billing.current_plan')}</h3>
          </CardHeader>
          <Separator />
          <CardBody className="gap-4">
            {planName ? (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <h4 className="text-xl font-bold">{planName}</h4>
                  {/* A failed card is recorded as `expired`, but the plan has
                      not ended: Stripe is still collecting. Say "Past Due". */}
                  {cardNeedsAttention ? (
                    <Chip size="sm" variant="soft" color="warning">{t('billing.status_past_due')}</Chip>
                  ) : recordStatus && recordStatus !== 'active' ? (
                    <Chip size="sm" variant="soft" color={statusColor(recordStatus)}>
                      {t(statusLabelKey(recordStatus))}
                    </Chip>
                  ) : null}
                </div>

                {plan ? (
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {maxMembers === null
                      ? t('plan_facts.no_member_limit')
                      : t('plan_facts.members_up_to', { max: formatNumber(maxMembers) })}
                  </p>
                ) : null}

                {plan?.description ? <p className="text-sm text-muted">{plan.description}</p> : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                  {plan && (monthly !== null || yearly !== null) ? (
                    <div>
                      <p className="text-sm text-muted">{t('own_billing.price_label')}</p>
                      {monthly !== null ? (
                        <p className="font-medium">{t('billing.amount_per_month', { amount: money(monthly, plan.currency) })}</p>
                      ) : null}
                      {yearly !== null ? (
                        <p className="font-medium">{t('billing.amount_per_year', { amount: money(yearly, plan.currency) })}</p>
                      ) : null}
                      <p className="text-sm">
                        {setupFee !== null
                          ? t('plan_facts.setup_fee', { amount: money(setupFee, plan.currency) })
                          : t('plan_facts.no_setup_fee')}
                      </p>
                    </div>
                  ) : null}

                  {payer ? (
                    <div>
                      <p className="text-sm text-muted">{t('control.payer_label')}</p>
                      <p className="font-medium">{t(`billing.payer_${payer}`)}</p>
                    </div>
                  ) : null}

                  {standing?.paid_until ? (
                    <div>
                      <p className="text-sm text-muted">{t('control.paid_until_label')}</p>
                      <p className="font-medium">{formatDate(standing.paid_until)}</p>
                    </div>
                  ) : null}

                  {interval ? (
                    <div>
                      <p className="text-sm text-muted">{t('billing.billing_interval')}</p>
                      <p className="font-medium">{t(`billing.interval_${interval}`)}</p>
                    </div>
                  ) : null}

                  {hasCard && subscription?.current_period_end ? (
                    <div>
                      <p className="text-sm text-muted">{t('billing.next_billing_date')}</p>
                      <p className="font-medium">{formatDate(subscription.current_period_end)}</p>
                    </div>
                  ) : null}

                  {subscription?.trial_ends_at ? (
                    <div>
                      <p className="text-sm text-muted">{t('billing.trial_ends')}</p>
                      <p className="font-medium">{formatDate(subscription.trial_ends_at)}</p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <CreditCard aria-hidden="true" className="w-12 h-12 text-muted mx-auto mb-3" />
                <p className="text-muted mb-4">{t('own_billing.no_plan')}</p>
                {!paysParent ? (
                  <Button
                    as={Link}
                    to={tenantPath('/admin/billing/plans')}
                    endContent={<ArrowRight aria-hidden="true" className="w-4 h-4" />}
                  >
                    {t('billing.choose_plan')}
                  </Button>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>

        {/* ─── Actions ─── */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">{t('billing.actions')}</h3>
          </CardHeader>
          <Separator />
          <CardBody className="gap-3">
            {/* A community that pays the community above it arranges its
                plan and payments there: nothing here would apply to it. */}
            {!paysParent ? (
              <Button
                as={Link}
                to={tenantPath('/admin/billing/plans')}
                variant="tertiary"
                className="justify-start"
                startContent={<CreditCard aria-hidden="true" className="w-4 h-4" />}
                endContent={<ArrowRight aria-hidden="true" className="w-4 h-4 ml-auto" />}
                fullWidth
              >
                {planName ? t('billing.change_plan') : t('billing.choose_plan')}
              </Button>
            ) : null}

            {hasCard ? (
              <Button
                variant="tertiary"
                className="justify-start"
                startContent={<Settings aria-hidden="true" className="w-4 h-4" />}
                endContent={<ArrowRight aria-hidden="true" className="w-4 h-4 ml-auto" />}
                isLoading={portalLoading}
                onPress={handleManagePayment}
                fullWidth
              >
                {t('billing.manage_payment')}
              </Button>
            ) : null}

            {!paysParent ? (
              <Button
                as={Link}
                to={tenantPath('/admin/billing/invoices')}
                variant="tertiary"
                className="justify-start"
                startContent={<Receipt aria-hidden="true" className="w-4 h-4" />}
                endContent={<ArrowRight aria-hidden="true" className="w-4 h-4 ml-auto" />}
                fullWidth
              >
                {t('billing.view_invoices')}
              </Button>
            ) : null}

            {!paysParent ? (
              <Button variant="tertiary" className="justify-start" onPress={onUpgradeOpen} fullWidth>
                {t('billing.request_upgrade')}
              </Button>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* ─── Active members against the plan ─── */}
      {members ? (
        <Card className="mt-6">
          <CardHeader className="flex gap-3">
            <Users aria-hidden="true" className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold">{t('own_billing.members_title')}</h3>
          </CardHeader>
          <Separator />
          <CardBody className="gap-3">
            <div className="flex items-center justify-between text-sm">
              <span>
                {t('own_billing.members_used', { used: formatNumber(members.used), max: formatNumber(members.max) })}
              </span>
              <span className="text-muted">{formatPercentValue(members.percent)}</span>
            </div>
            <Progress
              value={Math.min(100, members.percent)}
              color={members.used > members.max ? 'danger' : members.stage ? 'warning' : 'primary'}
              className="w-full"
              aria-label={t('own_billing.members_title')}
            />
            {members.stage === 'over' ? (
              <p className="text-danger text-sm">
                {t('paused_banner.limit_over', { used: formatNumber(members.used), max: formatNumber(members.max) })}
              </p>
            ) : members.stage === 'reached' ? (
              <p className="text-warning text-sm">{t('paused_banner.limit_reached', { max: formatNumber(members.max) })}</p>
            ) : members.stage === 'approaching' ? (
              <p className="text-warning text-sm">
                {t('paused_banner.limit_approaching', {
                  used: formatNumber(members.used),
                  percent: formatNumber(members.percent),
                  max: formatNumber(members.max),
                })}
              </p>
            ) : null}
            <p className="text-xs text-muted">{t('own_billing.members_help')}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* ─── Upgrade request ─── */}
      <Modal isOpen={isUpgradeOpen} onClose={onUpgradeClose} size="md">
        <ModalContent>
          <ModalHeader>{t('billing.request_upgrade')}</ModalHeader>
          <ModalBody>
            <p className="text-muted text-sm mb-3">{t('billing.upgrade_modal_desc')}</p>
            <Textarea
              label={t('billing.upgrade_message')}
              placeholder={t('billing.upgrade_message_placeholder')}
              value={upgradeMessage}
              onValueChange={setUpgradeMessage}
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onUpgradeClose}>
              {t('billing.cancel')}
            </Button>
            <Button isLoading={upgradeSending} onPress={handleUpgradeRequest}>
              {t('billing.send_request')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default BillingPage;
