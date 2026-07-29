// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDPR Consents
 * Read-only DataTable of consent records.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState, useCallback } from 'react';import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import { useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import type { GdprConsent } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { Button, Chip } from '@/components/ui';

export function GdprConsents() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.gdpr_consents_title') });
  const toast = useToast();

  const [consents, setConsents] = useState<GdprConsent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getGdprConsents();
      if (res.success && res.data) {
        const data = res.data as unknown;
        setConsents(Array.isArray(data) ? data : []);
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_load_consent_records'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    loadData();
  }, [loadData]);

  const columns: Column<GdprConsent>[] = [
    { key: 'id', label: t('enterprise.gdpr_id'), sortable: true },
    { key: 'user_name', label: t('enterprise.gdpr_user'), sortable: true },
    {
      key: 'consent_type',
      label: t('enterprise.gdpr_type'),
      sortable: true,
      render: (c) => (
        <Chip size="sm" variant="soft" data-testid="consent-type-chip" data-consent-type={c.consent_type}>
          {c.consent_type_name || t('enterprise.gdpr_consent_type_unknown')}
        </Chip>
      ),
    },
    {
      key: 'consented',
      label: t('enterprise.gdpr_consented'),
      render: (c) =>
        c.consented ? (
          <div className="flex items-center gap-1 text-success">
            <CheckCircle size={14} />
            <span className="text-sm">{t('enterprise.gdpr_yes')}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-danger">
            <XCircle size={14} />
            <span className="text-sm">{t('enterprise.gdpr_no')}</span>
          </div>
        ),
    },
    {
      key: 'created_at',
      label: t('enterprise.gdpr_date'),
      sortable: true,
      render: (c) => new Date(c.consented_at || c.created_at).toLocaleDateString(getFormattingLocale()),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.gdpr_consents_title')}
        description={t('enterprise.gdpr_consents_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={loadData}
            isLoading={loading}
            size="sm"
          >
            {t('enterprise.refresh')}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={consents}
        isLoading={loading}
        searchable={false}
        emptyContent={t('enterprise.gdpr_no_consent_records')}
      />
    </div>
  );
}

export default GdprConsents;
