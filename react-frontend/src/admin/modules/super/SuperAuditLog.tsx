import { getFormattingLocale } from '@/lib/helpers';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Select, SelectItem, Button, Input } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Audit Log
 * Cross-tenant action history with date range filtering, action/target type
 * filters, search, pagination, and CSV export.
 */

import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';import Download from 'lucide-react/icons/download';
import X from 'lucide-react/icons/x';
import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import type { SuperAuditEntry } from '../../api/types';

const PAGE_SIZE = 25;

const auditDisplayKeys: Record<string, string> = {
  bulk_users_move_target: 'super.audit_display.bulk_users_move_target',
  bulk_users_moved: 'super.audit_display.bulk_users_moved',
  bulk_users_moved_with_super_admin: 'super.audit_display.bulk_users_moved_with_super_admin',
  bulk_tenants_update_target: 'super.audit_display.bulk_tenants_update_target',
  bulk_tenants_updated: 'super.audit_display.bulk_tenants_updated',
};

export default function SuperAuditLog() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));
  const { tenantPath } = useTenant();

  const [logs, setLogs] = useState<SuperAuditEntry[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionType, setActionType] = useState('');
  const [targetType, setTargetType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSuper.getAudit({
        search: search || undefined,
        action_type: actionType || undefined,
        target_type: targetType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      if (res.success && res.data) {
        const entries = Array.isArray(res.data) ? res.data : [];
        setLogs(entries);
        // If the API returns a full page, assume there are more; otherwise we're on the last page
        if (entries.length < PAGE_SIZE) {
          setTotalItems((page - 1) * PAGE_SIZE + entries.length);
        } else {
          setTotalItems(page * PAGE_SIZE + 1);
        }
      } else {
        setLogs([]);
        setTotalItems(0);
      }
    } catch {
      setLogs([]);
      setTotalItems(0);
    }
    setLoading(false);
  }, [search, actionType, targetType, dateFrom, dateTo, page]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  // Reset to page 1 when filters change
  const resetAndFilter = () => {
    if (page !== 1) setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setActionType('');
    setTargetType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const hasFilters = !!(search || actionType || targetType || dateFrom || dateTo);
  const actionLabel = (action: string) => t(`super.audit_action_${action}`, {
    defaultValue: t('super.audit_action_unknown'),
  });
  const targetTypeLabel = (target: string) => t(`super.target_type_${target}`, {
    defaultValue: t('super.target_type_unknown'),
  });
  const localizeAuditParams = (params?: Record<string, string | number>) => {
    const localized = { ...(params ?? {}) };
    if (typeof localized.action === 'string') {
      localized.action = t(`super.audit_bulk_action.${localized.action}`, {
        defaultValue: t('super.audit_bulk_action.unknown'),
      });
    }
    return localized;
  };
  const auditDisplay = (
    code: string | null | undefined,
    params: Record<string, string | number> | undefined,
    legacy: string | null,
  ): string => {
    if (code) {
      const key = auditDisplayKeys[code];
      return key
        ? t(key, localizeAuditParams(params))
        : t('super.audit_display.unknown', { code });
    }

    // Historical rows stored localized/free-form prose. New rows always carry
    // a stable display code and never use this compatibility fallback.
    return legacy || '—';
  };
  const targetLabel = (entry: SuperAuditEntry) => auditDisplay(
    entry.target_label_code,
    entry.target_label_params,
    entry.target_label,
  );
  const description = (entry: SuperAuditEntry) => auditDisplay(
    entry.description_code,
    entry.description_params,
    entry.description,
  );

  const exportCsv = () => {
    if (logs.length === 0) return;
    const headers = [
      t('super.col_id'),
      t('super.col_action'),
      t('super.col_target'),
      t('super.label_target_type'),
      t('super.col_actor'),
      t('super.col_description'),
      t('super.col_date'),
    ];
    // Target and actor names are user text and were not quoted; every cell is
    // formula-neutralised (lib/csv). Target / target-type now sit under the
    // matching headings (they were swapped).
    const rows = logs.map((entry) => [
      entry.id,
      actionLabel(entry.action_type),
      targetLabel(entry),
      targetTypeLabel(entry.target_type),
      entry.actor_name || t('super.user_with_id', { id: entry.actor_id }),
      description(entry),
      entry.created_at,
    ]);
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
  };

  const columns: Column<SuperAuditEntry>[] = [
    {
      key: 'action_type', label: t('super.col_action'), sortable: true,
      render: (entry) => <StatusBadge status={entry.action_type} />,
    },
    {
      key: 'target_label', label: t('super.col_target'), sortable: true,
      render: (entry) => {
        const targetLink = entry.target_type === 'user' && entry.target_id
          ? tenantPath(`/super-admin/users/${entry.target_id}`)
          : entry.target_type === 'tenant' && entry.target_id
            ? tenantPath(`/super-admin/tenants/${entry.target_id}`)
            : null;
        return (
          <div>
            {targetLink ? (
              <Link to={targetLink} className="font-medium text-foreground hover:text-accent">
                {targetLabel(entry)}
              </Link>
            ) : (
              <span className="font-medium">{targetLabel(entry)}</span>
            )}
            <span className="text-xs text-muted ml-2">({targetTypeLabel(entry.target_type)})</span>
          </div>
        );
      },
    },
    {
      key: 'actor_name', label: t('super.col_actor'),
      render: (entry) => entry.actor_id ? (
        <Link to={tenantPath(`/super-admin/users/${entry.actor_id}`)} className="hover:text-accent">
          {entry.actor_name || t('super.user_with_id', { id: entry.actor_id })}
        </Link>
      ) : (
        <span>{entry.actor_name || t('super.system')}</span>
      ),
    },
    {
      key: 'description', label: t('super.col_description'),
      render: (entry) => <span className="text-sm text-muted">{description(entry)}</span>,
    },
    {
      key: 'created_at', label: t('super.col_date'), sortable: true,
      render: (entry) => (
        <span className="text-sm text-muted">
          {new Date(entry.created_at).toLocaleString(getFormattingLocale())}
        </span>
      ),
    },
  ];

  return (
    <div>
      <nav aria-label={t('super.breadcrumb_nav_aria')} className="flex items-center gap-1 text-sm text-muted mb-1">
        <Link to={tenantPath('/super-admin')} className="hover:text-accent">{t('super.breadcrumb_super_admin')}</Link>
        <span>/</span>
        <span className="text-foreground">{t('super.audit_log')}</span>
      </nav>
      <PageHeader
        title={t('super.super_audit_log_title')}
        description={t('super.super_audit_log_desc')}
        actions={
          <Button
            variant="tertiary"
            size="sm"
            startContent={<Download aria-hidden="true" size={16} />}
            onPress={exportCsv}
            isDisabled={logs.length === 0}
          >
            {t('super.export_csv')}
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Select
          label={t('super.label_action_type')}
          size="sm"
          className="max-w-[180px]"
          selectedKeys={actionType ? [actionType] : []}
          onSelectionChange={(keys) => {
            setActionType(String(Array.from(keys)[0] || ''));
            resetAndFilter();
          }}
        >
          <SelectItem key="user_created" id="user_created">{t('super.event_user_created')}</SelectItem>
          <SelectItem key="user_moved" id="user_moved">{t('super.event_user_moved')}</SelectItem>
          <SelectItem key="tenant_created" id="tenant_created">{t('super.event_tenant_created')}</SelectItem>
          <SelectItem key="tenant_updated" id="tenant_updated">{t('super.event_tenant_updated')}</SelectItem>
          <SelectItem key="bulk_users_moved" id="bulk_users_moved">{t('super.event_bulk_users_moved')}</SelectItem>
          <SelectItem key="bulk_tenants_updated" id="bulk_tenants_updated">{t('super.event_bulk_tenants_updated')}</SelectItem>
          <SelectItem key="federation_lockdown" id="federation_lockdown">{t('super.event_federation_lockdown')}</SelectItem>
          <SelectItem key="federation_updated" id="federation_updated">{t('super.event_federation_updated')}</SelectItem>
        </Select>

        <Select
          label={t('super.label_target_type')}
          size="sm"
          className="max-w-[160px]"
          selectedKeys={targetType ? [targetType] : []}
          onSelectionChange={(keys) => {
            setTargetType(String(Array.from(keys)[0] || ''));
            resetAndFilter();
          }}
        >
          <SelectItem key="user" id="user">{t('super.target_type_user')}</SelectItem>
          <SelectItem key="tenant" id="tenant">{t('super.target_type_tenant')}</SelectItem>
          <SelectItem key="bulk" id="bulk">{t('super.target_type_bulk')}</SelectItem>
          <SelectItem key="federation" id="federation">{t('super.target_type_federation')}</SelectItem>
        </Select>

        <Input
          label={t('super.label_from_date')}
          type="date"
          size="sm"
          className="max-w-[170px]"
          value={dateFrom}
          onValueChange={(v) => { setDateFrom(v); resetAndFilter(); }}
        />

        <Input
          label={t('super.label_to_date')}
          type="date"
          size="sm"
          className="max-w-[170px]"
          value={dateTo}
          onValueChange={(v) => { setDateTo(v); resetAndFilter(); }}
        />

        <Input
          label={t('super.label_search')}
          size="sm"
          className="max-w-[200px]"
          value={search}
          onValueChange={(v) => { setSearch(v); resetAndFilter(); }}
          isClearable
          onClear={() => { setSearch(''); resetAndFilter(); }}
        />

        {hasFilters && (
          <Button
            size="sm"
            variant="danger"
            startContent={<X aria-hidden="true" size={14} />}
            onPress={clearFilters}
          >
            {t('super.clear_filters')}
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={logs}
        isLoading={loading}
        searchable={false}
        onRefresh={loadLogs}
        totalItems={totalItems}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}
