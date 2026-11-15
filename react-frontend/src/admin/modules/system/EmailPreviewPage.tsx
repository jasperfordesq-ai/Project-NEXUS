// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "What your members receive" (warmth phase 6, B6).
 *
 * One sample member email, rendered by the server through the real shared
 * email layout for this community: its logo, colour and name. Nothing is sent.
 *
 * The email is shown in an iframe with an EMPTY sandbox: no scripts, no
 * same-origin access, no forms, no pop-ups. The HTML comes from our own
 * server, but an email body is still treated as untrusted markup here.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Mail from 'lucide-react/icons/mail';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Alert, Button, Card, CardBody, CardHeader, Spinner } from '@/components/ui';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { adminEmailPreview, type AdminEmailPreview } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';

export function EmailPreviewPage() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('email_preview.page_title'));
  const { tenantPath } = useTenant();

  const [sample, setSample] = useState<AdminEmailPreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const res = await adminEmailPreview.get();
      if (res.success && res.data) {
        setSample(res.data);
      } else {
        setSample(null);
        setLoadFailed(true);
      }
    } catch {
      setSample(null);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('email_preview.title')}
        description={t('email_preview.description')}
        icon={<Mail size={20} aria-hidden="true" />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">{t('email_preview.where_title')}</h2>
          </CardHeader>
          <CardBody className="gap-4">
            <p className="text-sm text-muted">{t('email_preview.where_body')}</p>
            <div>
              <Button
                as={Link}
                to={tenantPath('/admin/make-it-yours')}
                size="sm"
                variant="secondary"
                endContent={<ArrowRight size={14} aria-hidden="true" />}
              >
                {t('email_preview.open_make_it_yours')}
              </Button>
            </div>
            <p className="text-sm text-muted">{t('email_preview.logo_formats')}</p>
            <p className="text-sm text-muted">{t('email_preview.language_note')}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">{t('email_preview.sample_title')}</h2>
          </CardHeader>
          <CardBody className="gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm text-muted">
                {sample ? (
                  <>
                    <span className="font-medium">{t('email_preview.subject_label')}</span>{' '}
                    <span>{sample.subject}</span>
                  </>
                ) : null}
              </p>
              <Button
                isIconOnly
                variant="ghost"
                aria-label={t('email_preview.refresh')}
                isDisabled={isLoading}
                onPress={() => void load()}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </Button>
            </div>
            {isLoading && !sample ? (
              <div className="flex h-64 items-center justify-center"><Spinner /></div>
            ) : loadFailed ? (
              <div className="space-y-3">
                <Alert color="danger" title={t('email_preview.load_failed')} />
                <Button size="sm" variant="secondary" onPress={() => void load()}>
                  {t('email_preview.try_again')}
                </Button>
              </div>
            ) : sample ? (
              <iframe
                title={t('email_preview.frame_title')}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={sample.html}
                className="h-[75vh] min-h-[520px] w-full rounded-lg border-0"
              />
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default EmailPreviewPage;
