import { Card } from '@/components/ui';
import { Button, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import XCircle from 'lucide-react/icons/x-circle';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import api from '@/lib/api';
import { logError } from '@/lib/logger';

interface SubscriptionResponse {
  subscription: {
    id: number;
    tier_id: number;
    tier_name: string;
    status: string;
    is_active: boolean;
  } | null;
  entitled_tier: {
    tier_id: number;
    tier_name: string;
    features: string[];
  } | null;
  unlocked_features: string[];
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 20;

export function SubscriptionReturnPage() {
  const { t } = useTranslation('common');
  const { tenantPath, hasModule } = useTenant();
  const [search] = useSearchParams();
  const cancelled = search.get('cancelled') === '1';
  usePageTitle(t('premium.return_title'));

  const [status, setStatus] = useState<'pending' | 'success' | 'cancelled' | 'timeout'>(
    cancelled ? 'cancelled' : 'pending'
  );
  const [tierName, setTierName] = useState<string | null>(null);

  useEffect(() => {
    if (cancelled) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let mounted = true;

    const poll = async () => {
      attempts += 1;
      try {
        const res = await api.get<SubscriptionResponse>('/v2/member-premium/me');
        if (!mounted) return;
        if (res.data?.subscription?.is_active && res.data.entitled_tier) {
          setTierName(res.data.entitled_tier.tier_name);
          setStatus('success');
          return;
        }
      } catch (err) {
        logError('SubscriptionReturnPage.poll', err);
      }
      if (attempts >= MAX_POLLS) {
        if (mounted) setStatus('timeout');
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [cancelled]);

  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <PageMeta
        title={t('premium.return_title')}
        description={t('premium.return_meta_description')}
        noIndex
      />
      <Card className="border border-border bg-surface/95">
        <Card.Content className="text-center py-10 flex flex-col items-center gap-4">
          {status === 'pending' && (
            <div role="status" aria-busy="true" aria-label={t('premium.return_pending')} className="flex flex-col items-center gap-4">
              <Spinner size="lg" aria-hidden="true" />
              <h1 className="text-xl font-semibold">
                {t('premium.return_pending')}
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                {t('premium.return_pending_body')}
              </p>
            </div>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 size={56} className="text-green-500" aria-hidden="true" />
              <h1 className="text-2xl font-semibold">
                {t('premium.return_success_title')}
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                {tierName
                  ? t('premium.return_success_with_tier', { tier: tierName })
                  : t('premium.return_success_body')}
              </p>
              <div className="flex gap-2 mt-2">
                <Button as={Link} to={tenantPath('/premium/manage')} variant="primary">
                  {t('premium.manage_cta')}
                </Button>
                <Button as={Link} to={tenantPath(hasModule('dashboard') ? '/dashboard' : '/')} variant="tertiary">
                  {hasModule('dashboard') ? t('premium.go_to_dashboard') : t('not_found.go_home', { ns: 'utility' })}
                </Button>
              </div>
            </>
          )}

          {status === 'cancelled' && (
            <>
              <XCircle size={48} className="text-[var(--color-text-secondary)]" aria-hidden="true" />
              <h1 className="text-xl font-semibold">
                {t('premium.return_cancelled_title')}
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                {t('premium.return_cancelled_body')}
              </p>
              <Button as={Link} to={tenantPath('/premium')} variant="primary">
                {t('premium.back_to_pricing')}
              </Button>
            </>
          )}

          {status === 'timeout' && (
            <>
              <h1 className="text-xl font-semibold">
                {t('premium.return_timeout_title')}
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                {t('premium.return_timeout_body')}
              </p>
              <Button as={Link} to={tenantPath('/premium/manage')} variant="primary">
                {t('premium.check_status')}
              </Button>
            </>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

export default SubscriptionReturnPage;
