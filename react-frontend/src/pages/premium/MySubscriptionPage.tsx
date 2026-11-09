import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, Button, Chip, Spinner, useConfirm } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Separator } from '@/components/ui';
import HandHeart from 'lucide-react/icons/hand-heart';
import ExternalLink from 'lucide-react/icons/external-link';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useToast } from '@/contexts';
import api from '@/lib/api';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


interface MeResponse {
  subscription: {
    id: number;
    tier_id: number;
    tier_name: string;
    tier_slug: string;
    status: string;
    billing_interval: 'monthly' | 'yearly';
    current_period_start: string | null;
    current_period_end: string | null;
    canceled_at: string | null;
    grace_period_ends_at: string | null;
    is_active: boolean;
  } | null;
  entitled_tier: {
    tier_id: number;
    tier_name: string;
    features: string[];
  } | null;
  unlocked_features: string[];
}

function statusChipColor(s: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'success';
    case 'past_due':
    case 'grace':
    case 'incomplete':
      return 'warning';
    case 'canceled':
      return 'danger';
    default:
      return 'default';
  }
}

const KNOWN_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'grace', 'canceled', 'incomplete'] as const;

function getStatusKey(status: string) {
  return KNOWN_SUBSCRIPTION_STATUSES.includes(status as (typeof KNOWN_SUBSCRIPTION_STATUSES)[number])
    ? `premium.status.${status}`
    : 'premium.status.unknown';
}

export function MySubscriptionPage() {
  const { t } = useTranslation('common');
  const confirmDialog = useConfirm();
  const { tenantPath } = useTenant();
  const { showToast } = useToast();
  usePageTitle(t('premium.manage_title'));

  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<'portal' | 'cancel' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<MeResponse>('/v2/member-premium/me');
      setData(res.data ?? null);
    } catch {
      setData({ subscription: null, entitled_tier: null, unlocked_features: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openPortal = async () => {
    setActionBusy('portal');
    try {
      const res = await api.post<{ portal_url: string }>('/v2/member-premium/billing-portal', {
        return_url: window.location.origin + tenantPath('/premium/manage'),
      });
      if (res.data?.portal_url) {
        window.location.href = res.data.portal_url;
      } else {
        showToast(t('premium.portal_failed'), 'error');
        setActionBusy(null);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t('premium.portal_failed'), 'error');
      setActionBusy(null);
    }
  };

  const cancel = async () => {
    const ok = await confirmDialog({
      title: t('premium.cancel_confirm'),
      status: 'warning',
      confirmLabel: t('confirm'),
    });
    if (!ok) {
      return;
    }
    setActionBusy('cancel');
    try {
      await api.post('/v2/member-premium/cancel', {});
      showToast(t('premium.cancel_scheduled'), 'success');
      await load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t('premium.cancel_failed'), 'error');
    } finally {
      setActionBusy(null);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
        <PageMeta title={t('premium.manage_title')} noIndex />
        <Spinner size="lg" />
      </div>
    );
  }

  const sub = data?.subscription;

  if (!sub) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <PageMeta title={t('premium.manage_title')} noIndex />
        {/* The same soft panel in the community colour that opens the offers,
            events and groups pages (AWID: warmer, more inviting). Was a grey
            bordered card. */}
        <PublicPageHero
          size="compact"
          title={t('premium.no_subscription_title')}
          description={t('premium.no_subscription_body')}
          icon={<HandHeart className="h-6 w-6" aria-hidden="true" />}
          accent="emerald"
          action={
            <Button as={Link} to={tenantPath('/premium')} variant="primary">
              {t('premium.view_pricing_cta')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <PageMeta title={t('premium.manage_title')} noIndex />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). Was the
          header of the grey bordered card below. */}
      <PublicPageHero
        size="compact"
        title={sub.tier_name}
        description={sub.billing_interval === 'yearly'
          ? t('premium.billed_yearly')
          : t('premium.billed_monthly')}
        icon={<HandHeart className="h-6 w-6" aria-hidden="true" />}
        accent="emerald"
      />
      <Card className="border border-border">
        <CardBody className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--color-text-secondary)]">
              {t('premium.status_label')}:
            </span>
            <Chip color={statusChipColor(sub.status)} size="sm" variant="soft">
              {t(getStatusKey(sub.status))}
            </Chip>
          </div>

          {sub.current_period_end && (
            <div className="text-sm">
              <span className="text-[var(--color-text-secondary)]">
                {sub.canceled_at
                  ? t('premium.ends_on')
                  : t('premium.next_billing')}
                :{' '}
              </span>
              <span className="font-medium">
                {new Date(sub.current_period_end).toLocaleDateString(getFormattingLocale())}
              </span>
            </div>
          )}

          {sub.grace_period_ends_at && (
            <div className="text-sm rounded-md p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200">
              {t('premium.grace_period_notice', {
                date: new Date(sub.grace_period_ends_at).toLocaleDateString(getFormattingLocale()),
              })}
            </div>
          )}

          <Separator />

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              startContent={<ExternalLink size={16} aria-hidden="true" />}
              onPress={openPortal}
              isLoading={actionBusy === 'portal'}
              isDisabled={actionBusy !== null}
            >
              {t('premium.manage_in_stripe')}
            </Button>
            {!sub.canceled_at && (
              <Button
                variant="danger-soft"
                onPress={cancel}
                isLoading={actionBusy === 'cancel'}
                isDisabled={actionBusy !== null}
              >
                {t('premium.cancel_subscription')}
              </Button>
            )}
            <Button as={Link} to={tenantPath('/premium')} variant="tertiary">
              {t('premium.change_plan')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default MySubscriptionPage;
