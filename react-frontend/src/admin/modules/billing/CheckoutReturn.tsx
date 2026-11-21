import { CardBody, Card, Button, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CheckoutReturn
 * Post-checkout landing page that polls for subscription activation.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertCircle from 'lucide-react/icons/circle-alert';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { billingApi, type SubscriptionDetails } from '../../api/billingApi';

const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 2000;

export function CheckoutReturn() {
  const { t } = useTranslation('admin_billing');
  usePageTitle(t('billing.checkout_title'));
  const { tenantPath } = useTenant();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [status, setStatus] = useState<'polling' | 'success' | 'failed'>('polling');
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    attemptRef.current += 1;

    try {
      const res = await billingApi.getSubscription();
      if (res.success && res.data) {
        const sub = res.data;
        // Paid means the card subscription this checkout created is on the
        // record (`has_card_subscription`), not merely "the community has an
        // active plan": a community given a plan by hand already had one, so
        // this page used to say "success" at once, for a payment that had
        // been abandoned, and could name the old plan.
        if (sub.has_card_subscription === true && (sub.status === 'active' || sub.status === 'trial')) {
          setSubscription(sub);
          setStatus('success');
          return;
        }
      }
    } catch {
      // Continue polling
    }

    if (attemptRef.current >= MAX_POLL_ATTEMPTS) {
      setStatus('failed');
      return;
    }

    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
  }, []);

  useEffect(() => {
    if (sessionId) {
      poll();
    } else {
      setStatus('failed');
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [sessionId, poll]);

  return (
    <div className="flex justify-center items-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardBody className="text-center py-10 px-8 gap-4">
          {status === 'polling' && (
            <>
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" className="mx-auto" /></div>
              <h2 className="text-xl font-semibold mt-4">
                {t('billing.processing')}
              </h2>
              <p className="text-muted">
                {t('billing.processing_desc')}
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-16 h-16 text-success mx-auto" />
              <h2 className="text-xl font-semibold mt-4">
                {t('billing.checkout_success')}
              </h2>
              <p className="text-muted">
                {subscription
                  ? t('billing.checkout_success_desc', {
                      plan: subscription.plan_name,
                    })
                  : t('billing.checkout_success_generic')}
              </p>
              <Button
                as={Link}
                to={tenantPath('/admin/billing')}
                endContent={<ArrowRight className="w-4 h-4" />}
                className="mt-4"
              >
                {t('billing.go_to_billing')}
              </Button>
            </>
          )}

          {status === 'failed' && (
            <>
              <AlertCircle className="w-16 h-16 text-danger mx-auto" />
              <h2 className="text-xl font-semibold mt-4">
                {t('billing.checkout_failed')}
              </h2>
              <p className="text-muted">{t('billing.checkout_failed_desc')}</p>
              <div className="flex gap-3 justify-center mt-4">
                <Button
                  as={Link}
                  to={tenantPath('/admin/billing/plans')}
                  variant="tertiary"
                >
                  {t('billing.try_again')}
                </Button>
                <Button
                  as={Link}
                  to={tenantPath('/admin/billing')}
                  variant="secondary"
                >
                  {t('billing.go_to_billing')}
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default CheckoutReturn;
