// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Error Logs
 * DataTable of recent error log entries.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState, useCallback } from 'react';import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import type { ErrorLogEntry } from '../../api/types';
import { Button, Chip } from '@/components/ui';

export function ErrorLogs() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.enterprise_dashboard_title'));
  const toast = useToast();

  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getLogs({ page });
      if (res.success && res.data) {
        const result = res.data as unknown;
        if (Array.isArray(result)) {
          setLogs(result);
          setTotal(result.length);
        } else if (result && typeof result === 'object') {
          const pd = result as { data?: ErrorLogEntry[]; meta?: { total?: number } };
          setLogs(pd.data || []);
          setTotal(pd.meta?.total ?? pd.data?.length ?? 0);
        }
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_error_logs'));
    } finally {
      setLoading(false);
    }
  }, [page, t, toast])


  useEffect(() => {
    loadData();
  }, [loadData]);

  const columns: Column<ErrorLogEntry>[] = [
    { key: 'id', label: t('enterprise.col_id'), sortable: true },
    {
      key: 'action',
      label: t('enterprise.col_action'),
      sortable: true,
      render: (entry) => (
        <Chip size="sm" variant="soft" color="danger" data-testid="error-log-action-chip" data-action={entry.action}>
          {t(`enterprise.error_log_action_${entry.action.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`, {
            defaultValue: t('enterprise.error_log_action_unknown'),
          })}
        </Chip>
      ),
    },
    { key: 'description', label: t('enterprise.col_description') },
    {
      key: 'user_name',
      label: t('enterprise.col_user'),
      render: (entry) => entry.user_name || '---',
    },
    {
      key: 'ip_address',
      label: t('enterprise.col_ip'),
      render: (entry) => (
        <span className="text-xs font-mono">{entry.ip_address || '---'}</span>
      ),
    },
    {
      key: 'created_at',
      label: t('enterprise.col_date'),
      sortable: true,
      render: (entry) => new Date(entry.created_at).toLocaleString(getFormattingLocale()),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.error_logs_title')}
        description={t('enterprise.error_logs_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
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
        data={logs}
        isLoading={loading}
        totalItems={total}
        page={page}
        onPageChange={setPage}
        searchable={false}
        emptyContent={t('enterprise.no_error_logs')}
      />
    </div>
  );
}

export default ErrorLogs;
