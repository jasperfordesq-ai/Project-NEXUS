// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { Button, Card, CardBody } from '@/components/ui';
import { getFormattingLocale } from '@/lib/helpers';
import { adminLegalDocs } from '../../api/adminApi';

type PolicyEmailRow = {
  document_id: number;
  title: string;
  version_id: number;
  version_number: string;
  published_at: string | null;
  recipients: number;
  queued: number;
  submitted: number;
  delivered: number;
  bounced: number;
  exceptions: number;
  unique_opens: number;
  unique_clicks: number;
};

export function PolicyEmailActivity() {
  const { t } = useTranslation('admin_newsletters');
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PolicyEmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminLegalDocs.publicationEmails();
      if (!response.success || !Array.isArray(response.data)) throw new Error('policy email activity unavailable');
      setRows(response.data);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section aria-labelledby="policy-email-heading" className="mb-8">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="policy-email-heading" className="text-lg font-semibold">{t('newsletters.policy_email_title')}</h2>
          <p className="text-sm text-muted">{t('newsletters.policy_email_description')}</p>
        </div>
        <Button variant="tertiary" size="sm" onPress={refresh} isLoading={loading}>{t('newsletters.refresh')}</Button>
      </div>
      <p className="mb-3 text-xs text-muted">{t('newsletters.policy_email_status_note')}</p>
      {error ? <p role="alert" className="text-sm text-danger">{t('newsletters.policy_email_error')}</p>
        : !loading && rows.length === 0 ? <p className="text-sm text-muted">{t('newsletters.policy_email_empty')}</p>
          : <div className="grid gap-3">
            {rows.map((row) => (
              <Card key={row.version_id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{t('newsletters.policy_email_version', { title: row.title, version: row.version_number })}</p>
                    <p className="text-sm text-muted">
                      {t('newsletters.policy_email_recipients', { count: Number(row.recipients) })}
                      {row.published_at && ` · ${new Date(row.published_at).toLocaleDateString(getFormattingLocale())}`}
                    </p>
                    <p className="text-sm">{t('newsletters.policy_email_counts', {
                      queued: Number(row.queued), submitted: Number(row.submitted),
                      delivered: Number(row.delivered), bounced: Number(row.bounced),
                      exceptions: Number(row.exceptions),
                    })}</p>
                    <p className="text-sm">{t('newsletters.policy_email_engagement', {
                      opens: Number(row.unique_opens), clicks: Number(row.unique_clicks),
                    })}</p>
                  </div>
                  <Button variant="tertiary" size="sm" onPress={() => navigate(tenantPath(`/admin/newsletters/policy-emails/${row.version_id}`))}>
                    {t('newsletters.policy_email_stats')}
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>}
    </section>
  );
}
