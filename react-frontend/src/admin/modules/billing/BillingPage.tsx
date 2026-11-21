import { formatPercentValue, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Spinner, Textarea, Progress, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';

import { Separator } from '@/components/ui';
import CreditCard from 'lucide-react/icons/credit-card';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Receipt from 'lucide-react/icons/receipt';
import Settings from 'lucide-react/icons/settings';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { billingApi, type SubscriptionDetails } from '../../api/billingApi';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BillingPage
 * Main billing dashboard showing current subscription, quick actions.
 */


function statusColor(status: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'active':
      return 'success';
    case 'trialing':
      return 'warning';
    case 'past_due':
    case 'incomplete':
      return 'warning';
    case 'cancelled':
    case 'expired':
      return 'danger';
    default:
      return 'default';
  }
}

type StatusLabelTranslator = (key: string, defaultValue?: string) => string;

function statusLabel(status: string, t: StatusLabelTranslator): string {
  switch (status) {
    case 'active':
      return t('billing.status_active');
    case 'trialing':
      return t('billing.status_trialing');
    case 'past_due':
      return t('billing.status_past_due');
    case 'cancelled':
      return t('billing.status_cancelled');
    case 'expired':
      return t('billing.status_expired');
    case 'incomplete':
      return t('billing.status_incomplete');
    default:
      return t('billing.status_unknown');
  }
}

// Extended subscription type with optional usage fields from the API
interface SubscriptionWithUsage extends SubscriptionDetails {
  user_count?: number;
  plan?: {
    max_users: number | null;
  };
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

  const [subscription, setSubscription] = useState<SubscriptionWithUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  const loadSubscription = useCallback(async () => {
    setLoading(true);
    try {
      const res = await billingApi.getSubscription();
      if (res.success && res.data) {
        setSubscription(res.data as unknown as SubscriptionWithUsage);
      }
    } catch {
      // No subscription found — that's OK
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  const handleManagePayment = async () => {
    setPortalLoading(true);
    try {
      const res = await billingApi.createPortal();
      if (res.success && res.data) {
        const data = res.data as unknown as { portal_url: string };
        window.open(data.portal_url, '_blank', 'noopener,noreferrer');
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
      // Fallback: open mailto link
      const subject = encodeURIComponent(t('billing.upgrade_mailto_subject'));
      const body = encodeURIComponent(upgradeMessage);
      window.location.href = `mailto:jasper@hour-timebank.ie?subject=${subject}&body=${body}`;
    }
    setUpgradeSending(false);
  };

  // A card payer whose card has failed is recorded as `expired`, but Stripe
  // still has its subscription open and is still collecting for it
  // (`has_card_subscription`). Treating that as "no subscription" hid the plan
  // and the "Manage Payment" button at the one moment the admin needed it to
  // put the card right.
  const hasActiveSubscription =
    subscription &&
    (subscription.has_card_subscription === true ||
      (subscription.status !== 'cancelled' && subscription.status !== 'expired'));

  // Usage bar values
  const userCount = subscription?.user_count ?? null;
  const maxUsers = subscription?.plan?.max_users ?? null;
  const usagePct =
    userCount !== null && maxUsers !== null && maxUsers > 0
      ? Math.round((userCount / maxUsers) * 100)
      : null;

  return (
    <div>
      <PageHeader
        title={t('billing.title')}
        description={t('billing.description')}
      />

      {/* ─── Plan Usage Card ─── */}
      {!loading && subscription && (
        <Card className="mb-6">
          <CardHeader className="flex gap-3">
            <Users aria-hidden="true" className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold">
              {t('billing.your_plan_usage')}
            </h3>
          </CardHeader>
          <Separator />
          <CardBody className="gap-4">
            {maxUsers === null ? (
              <p className="text-success font-medium">
                {t('billing.unlimited_users')}
              </p>
            ) : userCount !== null && usagePct !== null ? (
              <>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted">
                    {t('billing.user_count_label', {
                      count: userCount,
                      max: maxUsers,
                    })}
                  </span>
                  <span className="text-muted">{formatPercentValue(usagePct)}</span>
                </div>
                <Progress
                  value={usagePct}
                  color={usagePct >= 100 ? 'danger' : usagePct >= 80 ? 'warning' : 'primary'}
                  className="w-full"
                  aria-label={t('billing.your_plan_usage')}
                />
                {usagePct >= 100 && (
                  <p className="text-danger text-sm">
                    {t('billing.over_limit_warning')}
                  </p>
                )}
                {usagePct >= 80 && usagePct < 100 && (
                  <p className="text-warning text-sm">
                    {t('billing.approaching_limit')}
                  </p>
                )}
              </>
            ) : null}

            <Button
              variant="tertiary"
              size="sm"
              className="self-start"
              onPress={onUpgradeOpen}
            >
              {t('billing.request_upgrade')}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* ─── Upgrade Request Modal ─── */}
      <Modal isOpen={isUpgradeOpen} onClose={onUpgradeClose} size="md">
        <ModalContent>
          <ModalHeader>{t('billing.request_upgrade')}</ModalHeader>
          <ModalBody>
            <p className="text-muted text-sm mb-3">
              {t('billing.upgrade_modal_desc')}
            </p>
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

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Current Plan Card */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex gap-3">
              <CreditCard aria-hidden="true" className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold">{t('billing.current_plan')}</h3>
            </CardHeader>
            <Separator />
            <CardBody className="gap-4">
              {hasActiveSubscription ? (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h4 className="text-xl font-bold">{subscription.plan_name}</h4>
                    <Chip size="sm" variant="soft">
                      {t('billing.tier')} {subscription.plan_tier_level}
                    </Chip>
                    <Chip size="sm" variant="soft" color={statusColor(subscription.status)}>
                      {statusLabel(subscription.status, (key, defaultValue) =>
                        defaultValue === undefined ? t(key) : t(key, defaultValue)
                      )}
                    </Chip>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                    <div>
                      <p className="text-sm text-muted">
                        {t('billing.billing_interval')}
                      </p>
                      <p className="font-medium">
                        {t(`billing.interval_${subscription.billing_interval}`, { defaultValue: t('billing.interval_unknown') })}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted">
                        {t('billing.next_billing_date')}
                      </p>
                      <p className="font-medium">
                        {subscription.current_period_end
                          ? new Date(subscription.current_period_end).toLocaleDateString(getFormattingLocale())
                          : '--'}
                      </p>
                    </div>
                    {subscription.trial_ends_at && (
                      <div>
                        <p className="text-sm text-muted">
                          {t('billing.trial_ends')}
                        </p>
                        <p className="font-medium">
                          {new Date(subscription.trial_ends_at).toLocaleDateString(getFormattingLocale())}
                        </p>
                      </div>
                    )}
                    {subscription.cancel_at_period_end && (
                      <div>
                        <Chip size="sm" color="warning" variant="soft">
                          {t('billing.cancels_at_period_end')}
                        </Chip>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <CreditCard aria-hidden="true" className="w-12 h-12 text-muted mx-auto mb-3" />
                  <p className="text-muted mb-4">
                    {t('billing.no_subscription')}
                  </p>
                  <Button
                    as={Link}
                    to={tenantPath('/admin/billing/plans')}
                    endContent={<ArrowRight aria-hidden="true" className="w-4 h-4" />}
                  >
                    {t('billing.choose_plan')}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold">{t('billing.actions')}</h3>
            </CardHeader>
            <Separator />
            <CardBody className="gap-3">
              <Button
                as={Link}
                to={tenantPath('/admin/billing/plans')}
                variant="tertiary"
                className="justify-start"
                startContent={<CreditCard aria-hidden="true" className="w-4 h-4" />}
                endContent={<ArrowRight aria-hidden="true" className="w-4 h-4 ml-auto" />}
                fullWidth
              >
                {t('billing.change_plan')}
              </Button>

              {hasActiveSubscription && (
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
              )}

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
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

export default BillingPage;
