// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Activity Log
 * Read-only audit trail of admin actions with server-side pagination.
 * Parity: PHP AdminController::activityLogs()
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';

import Activity from 'lucide-react/icons/activity';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { usePageTitle } from '@/hooks';
import { adminSystem } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import type { ActivityLogEntry } from '../../api/types';
import { useActivityDescription } from './activityDescription';

import { useTranslation } from 'react-i18next';
import { Button, Chip, Avatar } from '@/components/ui';
// ─────────────────────────────────────────────────────────────────────────────
// Action colour mapping
// ─────────────────────────────────────────────────────────────────────────────

const actionColorMap: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'default' | 'secondary'> = {
  login: 'success',
  logout: 'default',
  create: 'primary',
  update: 'secondary',
  delete: 'danger',
  approve: 'success',
  reject: 'danger',
  suspend: 'warning',
  ban: 'danger',
  reactivate: 'success',
  import: 'primary',
  export: 'primary',
  reset: 'warning',
  transfer: 'secondary',
};


function getActionColor(action: string): 'success' | 'warning' | 'danger' | 'primary' | 'default' | 'secondary' {
  const lower = action.toLowerCase();
  for (const [key, color] of Object.entries(actionColorMap)) {
    if (lower.includes(key)) return color;
  }
  return 'default';
}

// ─────────────────────────────────────────────────────────────────────────────
// Date formatter
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ActivityLog() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.page_title'));

  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const getDescription = useActivityDescription();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSystem.getActivityLog({ page, limit: 20 });
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setEntries(data);
          const metaTotal = (res.meta as Record<string, unknown> | undefined)?.total;
          setTotal(typeof metaTotal === 'number' ? metaTotal : data.length);
        } else if (data && typeof data === 'object') {
          const paginatedData = data as { data: ActivityLogEntry[]; meta?: { total: number } };
          setEntries(paginatedData.data || []);
          setTotal(paginatedData.meta?.total || 0);
        }
      }
    } catch {
      // API may not be available yet
      setEntries([]);
      setTotal(0);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Client-side search filter (API doesn't support search param)
  const filteredEntries = search
    ? entries.filter(
        (e) =>
          e.action.toLowerCase().includes(search.toLowerCase()) ||
          getDescription(e).toLowerCase().includes(search.toLowerCase()) ||
          e.user_name.toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  const columns: Column<ActivityLogEntry>[] = [
    {
      key: 'user_name',
      label: t('system.col_user'),
      sortable: true,
      render: (entry) => (
        <div className="flex items-center gap-3">
          <Avatar
            src={entry.user_avatar || undefined}
            name={entry.user_name}
            size="sm"
          />
          <div>
            <p className="font-medium text-foreground">{entry.user_name}</p>
            {entry.user_email && (
              <p className="text-xs text-muted">{entry.user_email}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'action',
      label: t('system.col_action'),
      sortable: true,
      render: (entry) => {
        const label = t(`system.action.${entry.action}`, {
          defaultValue: t('system.action.unknown'),
        });
        return (
          <Chip size="sm" variant="soft" color={getActionColor(entry.action)}>
            {label}
          </Chip>
        );
      },
    },
    {
      key: 'description',
      label: t('system.col_description'),
      render: (entry) => (
        <span className="text-sm text-muted line-clamp-2">
          {getDescription(entry)}
        </span>
      ),
    },
    {
      key: 'ip_address',
      label: t('system.col_ip_address'),
      render: (entry) => (
        <code className="text-xs text-muted bg-surface-secondary px-1.5 py-0.5 rounded">
          {entry.ip_address || '—'}
        </code>
      ),
    },
    {
      key: 'created_at',
      label: t('system.col_date'),
      sortable: true,
      render: (entry) => (
        <span className="text-sm text-muted">
          {formatDate(entry.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('system.activity_log_title')}
        description={t('system.activity_log_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={loadData}
            isLoading={loading}
          >
            {t('system.btn_refresh')}
          </Button>
        }
      />

      {/* Empty state icon hint */}
      <DataTable
        columns={columns}
        data={filteredEntries}
        isLoading={loading}
        searchPlaceholder={t('system.filter_activity_placeholder')}
        onSearch={(q) => setSearch(q)}
        onRefresh={loadData}
        totalItems={total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        emptyContent={
          <div className="flex flex-col items-center gap-2 py-8 text-muted">
            <Activity aria-hidden="true" size={40} />
            <p>{t('system.no_activity_log_entries')}</p>
          </div>
        }
      />
    </div>
  );
}

export default ActivityLog;
