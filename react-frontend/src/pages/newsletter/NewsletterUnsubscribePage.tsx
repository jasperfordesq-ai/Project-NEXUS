import { Card } from '@/components/ui';
import { Button, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Mail from 'lucide-react/icons/mail';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';

type State = 'loading' | 'success' | 'already_done' | 'invalid' | 'error';

/**
 * Public page for newsletter unsubscribe via email link.
 *
 * Linked from the weekly digest email footer:
 *   {APP_URL}/{tenant}/newsletter/unsubscribe?token=...
 *
 * Calls POST /api/v2/newsletter/unsubscribe with the token from the URL.
 * No authentication required — the token acts as the credential.
 */
export default function NewsletterUnsubscribePage() {
  const { t } = useTranslation('utility');
  usePageTitle(t('newsletter.page_title'));

  const [searchParams] = useSearchParams();
  const { tenantPath, hasModule } = useTenant();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<State>(token ? 'loading' : 'invalid');

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }

    type UnsubBody = { success: boolean; already_done?: boolean };
    api
      .post<UnsubBody>('/v2/newsletter/unsubscribe', { token }, { skipAuth: true, skipTenant: true })
      .then((res) => {
        if (!res.success) {
          // ApiResponse.success is false when PHP returned 4xx/5xx
          setState('invalid');
          return;
        }
        if (res.data?.already_done) {
          setState('already_done');
        } else {
          setState('success');
        }
      })
      .catch(() => {
        setState('error');
      });
   
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-secondary px-4">
      <PageMeta title={t('page_meta.newsletter_unsubscribe.title')} noIndex />
      <Card className="w-full max-w-md">
      <Card.Content className="p-8 text-center">
        <div className="mb-6">
          <Mail className="mx-auto text-muted" size={40} aria-hidden="true" />
        </div>

        {state === 'loading' && (
          <div role="status" aria-busy="true" aria-label={t('newsletter.processing')}>
            <Spinner size="lg" className="mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-foreground">{t('newsletter.processing')}</h1>
            <p className="mt-2 text-muted text-sm">{t('newsletter.removing_from_list')}</p>
          </div>
        )}

        {state === 'success' && (
          <>
            <CheckCircle className="mx-auto text-success mb-4" size={36} aria-hidden="true" />
            <h1 className="text-xl font-semibold text-foreground">{t('newsletter.unsubscribed')}</h1>
            <p className="mt-2 text-muted text-sm">
              {t('newsletter.unsubscribed_description')}
            </p>
            {hasModule('settings') && <Button
              className="mt-6"
              variant="secondary"
              as="a"
              href={tenantPath('/settings')}
            >
              {t('newsletter.manage_preferences')}
            </Button>}
          </>
        )}

        {state === 'already_done' && (
          <>
            <CheckCircle className="mx-auto text-success mb-4" size={36} aria-hidden="true" />
            <h1 className="text-xl font-semibold text-foreground">{t('newsletter.already_unsubscribed')}</h1>
            <p className="mt-2 text-muted text-sm">
              {t('newsletter.already_unsubscribed_description')}
            </p>
          </>
        )}

        {state === 'invalid' && (
          <>
            <XCircle className="mx-auto text-danger mb-4" size={36} aria-hidden="true" />
            <h1 className="text-xl font-semibold text-foreground">{t('newsletter.invalid_link')}</h1>
            <p className="mt-2 text-muted text-sm">
              {t('newsletter.invalid_link_description')}
            </p>
            {hasModule('settings') && <Button
              className="mt-6"
              variant="secondary"
              as="a"
              href={tenantPath('/settings')}
            >
              {t('newsletter.go_to_settings')}
            </Button>}
          </>
        )}

        {state === 'error' && (
          <>
            <XCircle className="mx-auto text-danger mb-4" size={36} aria-hidden="true" />
            <h1 className="text-xl font-semibold text-foreground">{t('newsletter.something_went_wrong')}</h1>
            <p className="mt-2 text-muted text-sm">
              {t('newsletter.error_description')}
            </p>
            <Button
              className="mt-6"
              color="default"
              variant="secondary"
              onPress={() => window.location.reload()}
            >
              {t('newsletter.try_again')}
            </Button>
          </>
        )}
      </Card.Content>
      </Card>
    </div>
  );
}
