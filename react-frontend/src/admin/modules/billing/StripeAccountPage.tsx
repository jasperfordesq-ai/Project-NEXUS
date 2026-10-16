// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin — the community's own Stripe account (Stripe Connect Express).
 *
 * This is where an admin connects the account that card donations and
 * recurring support are paid into, finishes Stripe's checks, opens the
 * Stripe dashboard, or disconnects again. Until an account is connected and
 * ready, payments go to the platform's Stripe account and are recorded
 * against the community.
 *
 * It lives on its own page, reachable by any community that takes card
 * payments, because it used to sit inside Donations & Support — a feature
 * that is off by default — so most communities had no way to reach it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import CreditCard from 'lucide-react/icons/credit-card';
import ExternalLink from 'lucide-react/icons/external-link';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Unlink from 'lucide-react/icons/unlink';
import HandHeart from 'lucide-react/icons/hand-heart';

import { useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { Alert, Button, Card, CardBody, Chip, Skeleton, Snippet, useConfirm } from '@/components/ui';
import { memberPremiumAdminApi, type DonationSupportSettings } from '../../api/memberPremiumApi';
import { PageHeader } from '../../components/PageHeader';

type AccountState = 'not_connected' | 'pending' | 'ready' | 'restricted' | 'unknown';
type BusyAction = 'onboarding' | 'dashboard' | 'disconnect' | 'refresh' | null;

function stateChipColor(state: AccountState): 'success' | 'warning' | 'danger' | 'default' {
  switch (state) {
    case 'ready':
      return 'success';
    case 'restricted':
      return 'danger';
    case 'not_connected':
      return 'default';
    default:
      return 'warning';
  }
}

export function StripeAccountPage() {
  const { t } = useTranslation(['admin_premium', 'common']);
  usePageTitle(t('stripe_account.meta.title'));
  const toast = useToast();
  const confirm = useConfirm();
  const { tenantPath, hasFeature } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();

  const [settings, setSettings] = useState<DonationSupportSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const handledReturn = useRef(false);

  const load = useCallback(async (announce = false) => {
    setLoading(true);
    if (announce) setBusy('refresh');
    try {
      const res = await memberPremiumAdminApi.getSettings();
      if (res.success && res.data?.settings) {
        setSettings(res.data.settings);
        if (announce) toast.success(t('stripe_account.toasts.status_refreshed'));
      } else {
        toast.error(t('stripe_account.toasts.load_failed'));
      }
    } catch {
      toast.error(t('stripe_account.toasts.load_failed'));
    } finally {
      setLoading(false);
      if (announce) setBusy(null);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from Stripe: the onboarding link sends the admin to
  // ?stripe_connect=return when done and ?stripe_connect=refresh when the
  // link expired. Say which happened once, then clean the address bar.
  useEffect(() => {
    if (handledReturn.current) return;
    const params = new URLSearchParams(location.search);
    const outcome = params.get('stripe_connect');
    if (!outcome) return;
    handledReturn.current = true;

    if (outcome === 'return') {
      toast.success(t('stripe_account.toasts.returned'));
    } else if (outcome === 'refresh') {
      toast.error(t('stripe_account.toasts.link_expired'));
    }

    params.delete('stripe_connect');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate, t, toast]);

  const startOnboarding = async () => {
    setBusy('onboarding');
    try {
      const base = `${window.location.origin}${window.location.pathname}`;
      const res = await memberPremiumAdminApi.createConnectOnboardingLink({
        return_url: `${base}?stripe_connect=return`,
        refresh_url: `${base}?stripe_connect=refresh`,
      });
      if (res.success && res.data?.onboarding_url) {
        if (res.data.settings) setSettings(res.data.settings);
        window.location.assign(res.data.onboarding_url);
        return;
      }
      toast.error(t('stripe_account.toasts.onboarding_failed'));
    } catch {
      toast.error(t('stripe_account.toasts.onboarding_failed'));
    }
    setBusy(null);
  };

  const openDashboard = async () => {
    setBusy('dashboard');
    try {
      const res = await memberPremiumAdminApi.createConnectDashboardLink();
      if (res.success && res.data?.dashboard_url) {
        // Stripe login links are single-use and short-lived, so follow it
        // straight away rather than handing it to a pop-up a blocker may eat.
        window.location.assign(res.data.dashboard_url);
        return;
      }
      toast.error(t('stripe_account.toasts.dashboard_failed'));
    } catch {
      toast.error(t('stripe_account.toasts.dashboard_failed'));
    }
    setBusy(null);
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: t('stripe_account.disconnect_confirm.title'),
      body: t('stripe_account.disconnect_confirm.body'),
      status: 'danger',
      confirmLabel: t('stripe_account.actions.disconnect'),
    });
    if (!ok) return;

    setBusy('disconnect');
    try {
      const res = await memberPremiumAdminApi.updateSettings({ stripe_connect_account_id: '' });
      if (res.success && res.data?.settings) {
        setSettings(res.data.settings);
        toast.success(t('stripe_account.toasts.disconnected'));
      } else {
        toast.error(t('stripe_account.toasts.disconnect_failed'));
      }
    } catch {
      toast.error(t('stripe_account.toasts.disconnect_failed'));
    } finally {
      setBusy(null);
    }
  };

  const state: AccountState = settings?.account_status?.state ?? 'not_connected';
  const accountId = settings?.stripe_connect_account_id || '';
  const usingOwnAccount = settings?.payment_route === 'tenant_connect';
  const requirementsDue = settings?.account_status?.requirements_due?.length ?? 0;
  const statusError = settings?.account_status?.error ?? null;
  const anyBusy = busy !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('stripe_account.meta.title')}
        description={t('stripe_account.meta.description')}
        icon={<CreditCard size={24} />}
      />

      <Card>
        <CardBody className="space-y-4">
          {loading && !settings ? (
            <div className="space-y-3" role="status" aria-busy="true">
              <Skeleton className="h-6 w-48 rounded-lg" />
              <Skeleton className="h-4 w-full max-w-xl rounded-lg" />
              <Skeleton className="h-10 w-40 rounded-lg" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {t('stripe_account.status_heading')}
                </h2>
                <Chip size="sm" color={stateChipColor(state)} variant="soft">
                  {t(`member_premium_admin.settings.status.${state}`)}
                </Chip>
                <Chip size="sm" color={usingOwnAccount ? 'success' : 'default'} variant="soft">
                  {usingOwnAccount
                    ? t('stripe_account.route.own')
                    : t('stripe_account.route.platform')}
                </Chip>
              </div>

              <p className="text-sm text-muted">{t(`stripe_account.state.${state}`)}</p>

              {requirementsDue > 0 ? (
                <Alert color="warning" title={t('stripe_account.requirements_due', { count: requirementsDue })} />
              ) : null}

              {statusError ? <Alert color="danger" title={statusError} /> : null}

              {accountId ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    {t('stripe_account.account_id')}
                  </p>
                  <Snippet size="sm" symbol="">{accountId}</Snippet>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {!accountId ? (
                  <Button
                    onPress={startOnboarding}
                    isLoading={busy === 'onboarding'}
                    isDisabled={anyBusy}
                    startContent={<ExternalLink size={16} />}
                  >
                    {t('stripe_account.actions.connect')}
                  </Button>
                ) : null}

                {accountId && state !== 'ready' ? (
                  <Button
                    onPress={startOnboarding}
                    isLoading={busy === 'onboarding'}
                    isDisabled={anyBusy}
                    startContent={<ExternalLink size={16} />}
                  >
                    {t('stripe_account.actions.finish_setup')}
                  </Button>
                ) : null}

                {accountId ? (
                  <Button
                    variant={state === 'ready' ? 'primary' : 'secondary'}
                    onPress={openDashboard}
                    isLoading={busy === 'dashboard'}
                    isDisabled={anyBusy}
                    startContent={<ExternalLink size={16} />}
                  >
                    {t('stripe_account.actions.open_dashboard')}
                  </Button>
                ) : null}

                {accountId ? (
                  <Button
                    variant="tertiary"
                    onPress={() => void load(true)}
                    isLoading={busy === 'refresh'}
                    isDisabled={anyBusy}
                    startContent={<RefreshCw size={16} />}
                  >
                    {t('stripe_account.actions.check_status')}
                  </Button>
                ) : null}

                {accountId ? (
                  <Button
                    variant="danger-soft"
                    onPress={disconnect}
                    isLoading={busy === 'disconnect'}
                    isDisabled={anyBusy}
                    startContent={<Unlink size={16} />}
                  >
                    {t('stripe_account.actions.disconnect')}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              {t('stripe_account.how_it_works.title')}
            </h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
              <li>{t('stripe_account.how_it_works.item_1')}</li>
              <li>{t('stripe_account.how_it_works.item_2')}</li>
              <li>{t('stripe_account.how_it_works.item_3')}</li>
              <li>{t('stripe_account.how_it_works.item_4')}</li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              {t('stripe_account.before_you_start.title')}
            </h2>
            <p className="text-sm text-muted">{t('stripe_account.before_you_start.body')}</p>
            <p className="text-sm text-muted">{t('stripe_account.before_you_start.fees')}</p>
            {hasFeature('member_premium') ? (
              <Button
                as={Link}
                to={tenantPath('/admin/member-premium')}
                variant="tertiary"
                startContent={<HandHeart size={16} />}
              >
                {t('stripe_account.before_you_start.manage_levels')}
              </Button>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default StripeAccountPage;
