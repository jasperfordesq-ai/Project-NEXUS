// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Select, SelectItem, Button, Chip, Input } from '@/components/ui';

/**
 * Federation Audit Log
 * Dedicated federation-specific audit log with category/level filtering,
 * date range, search, pagination, and CSV export.
 */

import { useState, useCallback, useEffect } from 'react';import Download from 'lucide-react/icons/download';
import X from 'lucide-react/icons/x';
import Activity from 'lucide-react/icons/activity';
import Network from 'lucide-react/icons/network';
import Handshake from 'lucide-react/icons/handshake';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { usePageTitle } from '@/hooks';
import { adminSuper } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import type { SuperAuditEntry } from '../../api/types';

import { useTranslation } from 'react-i18next';
const PAGE_SIZE = 25;

const CATEGORIES = [
  { key: '', labelKey: 'super.cat_all_categories' },
  { key: 'system_controls', labelKey: 'super.cat_system_controls' },
  { key: 'partnerships', labelKey: 'super.cat_partnerships' },
  { key: 'whitelist', labelKey: 'super.cat_whitelist' },
  { key: 'features', labelKey: 'super.cat_features' },
  { key: 'lockdown', labelKey: 'super.cat_lockdown' },
];

const LEVELS = [
  { key: '', labelKey: 'super.level_all_levels' },
  { key: 'info', labelKey: 'super.level_info' },
  { key: 'warning', labelKey: 'super.level_warning' },
  { key: 'critical', labelKey: 'super.level_critical' },
];

const FEDERATION_ACTION_TYPES = [
  'federation_lockdown',
  'federation_updated',
  'federation_whitelist_add',
  'federation_whitelist_remove',
  'federation_partnership_suspend',
  'federation_partnership_terminate',
  'federation_feature_toggle',
  'federation_controls_updated',
];

function categorizeAction(actionType: string): string {
  if (actionType.includes('lockdown')) return 'lockdown';
  if (actionType.includes('partnership')) return 'partnerships';
  if (actionType.includes('whitelist')) return 'whitelist';
  if (actionType.includes('feature') || actionType.includes('toggle')) return 'features';
  if (actionType.includes('control') || actionType.includes('updated')) return 'system_controls';
  return 'system_controls';
}

function inferLevel(actionType: string): string {
  if (actionType.includes('lockdown') || actionType.includes('terminate')) return 'critical';
  if (actionType.includes('suspend') || actionType.includes('remove')) return 'warning';
  return 'info';
}

const levelColorMap: Record<string, 'primary' | 'warning' | 'danger'> = {
  info: 'primary',
  warning: 'warning',
  critical: 'danger',
};

const categoryColorMap: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'danger'> = {
  system_controls: 'primary',
  partnerships: 'secondary',
  whitelist: 'success',
  features: 'primary',
  lockdown: 'danger',
};

export function FederationAuditLog() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));

  const actionLabel = (action: string) => t(`super.audit_action_${action}`, {
    defaultValue: t('super.audit_action_unknown'),
  });

  const [logs, setLogs] = useState<SuperAuditEntry[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  // Stats
  const [stats, setStats] = useState({ total: 0, federation: 0, partnerships: 0, emergency: 0 });

  const loadLogs = useCallback(async () => {
    setLoading(true);

    // Build action_type filter based on category and/or level.
    // When a level is selected, map it to the action_type patterns that
    // match that level so filtering happens server-side, keeping pagination
    // counts accurate.
    let actionTypeFilter: string | undefined;

    if (level) {
      // Derive matching action types for the selected level
      const matchingActions = FEDERATION_ACTION_TYPES.filter(
        (at) => inferLevel(at) === level,
      );
      if (matchingActions.length > 0) {
        // If a category is also selected, intersect the two sets
        const categoryActions = category
          ? matchingActions.filter((at) => categorizeAction(at) === category)
          : matchingActions;
        // Pass as comma-separated list; backend accepts first match in the
        // current implementation — use the most representative action type
        actionTypeFilter = (categoryActions.length > 0 ? categoryActions : matchingActions)[0];
      }
    } else if (category) {
      const matchingActions = FEDERATION_ACTION_TYPES.filter(
        (at) => categorizeAction(at) === category,
      );
      actionTypeFilter = matchingActions.length > 0 ? matchingActions[0] : category;
    }

    const res = await adminSuper.getAudit({
      search: search || undefined,
      action_type: actionTypeFilter,
      target_type: 'federation',
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });

    if (res.success && res.data) {
      const entries = Array.isArray(res.data) ? res.data : [];
      setLogs(entries);
      if (entries.length < PAGE_SIZE) {
        setTotalItems((page - 1) * PAGE_SIZE + entries.length);
      } else {
        setTotalItems(page * PAGE_SIZE + 1);
      }
    }
    setLoading(false);
  }, [search, category, level, dateFrom, dateTo, page]);

  // Load stats once
  useEffect(() => {
    (async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateStr = thirtyDaysAgo.toISOString().slice(0, 10);

      const res = await adminSuper.getAudit({
        target_type: 'federation',
        date_from: dateStr,
        limit: 200,
        offset: 0,
      });
      if (res.success && res.data) {
        const all = Array.isArray(res.data) ? res.data : [];
        setStats({
          total: all.length,
          federation: all.filter((e) => categorizeAction(e.action_type) === 'system_controls' || categorizeAction(e.action_type) === 'features').length,
          partnerships: all.filter((e) => categorizeAction(e.action_type) === 'partnerships').length,
          emergency: all.filter((e) => inferLevel(e.action_type) === 'critical').length,
        });
      }
    })();
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const resetAndFilter = () => {
    if (page !== 1) setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setLevel('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const hasFilters = !!(search || category || level || dateFrom || dateTo);

  const exportCsv = () => {
    if (logs.length === 0) return;
    const headers = [
      t('super.csv_id'),
      t('super.label_timestamp'),
      t('super.label_category'),
      t('super.label_level'),
      t('super.label_description'),
      t('super.label_actor'),
    ];
    // Actor names and descriptions are user text, and the actor column was not
    // even quoted; every cell is formula-neutralised (lib/csv).
    const rows = logs.map((entry) => [
      entry.id,
      entry.created_at,
      t(`super.cat_${categorizeAction(entry.action_type)}`),
      t(`super.level_${inferLevel(entry.action_type)}`),
      entry.description || '',
      entry.actor_name || t('super.user_with_id', { id: entry.actor_id }),
    ]);
    downloadCsv(`federation-audit-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
  };

  const columns: Column<SuperAuditEntry>[] = [
    {
      key: 'created_at',
      label: t('super.label_timestamp'),
      sortable: true,
      render: (entry) => (
        <span className="text-sm text-muted">
          {new Date(entry.created_at).toLocaleString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'category',
      label: t('super.label_category'),
      render: (entry) => {
        const cat = categorizeAction(entry.action_type);
        return (
          <Chip size="sm" variant="soft" color={categoryColorMap[cat] || 'primary'}>
            {t(`super.cat_${cat}`)}
          </Chip>
        );
      },
    },
    {
      key: 'level',
      label: t('super.label_level'),
      render: (entry) => {
        const lvl = inferLevel(entry.action_type);
        return (
          <Chip size="sm" variant="soft" color={levelColorMap[lvl] || 'primary'}>
            {t(`super.level_${lvl}`)}
          </Chip>
        );
      },
    },
    {
      key: 'description',
      label: t('super.label_description'),
      render: (entry) => (
        <span className="text-sm">{entry.description || actionLabel(entry.action_type)}</span>
      ),
    },
    {
      key: 'actor',
      label: t('super.label_actor'),
      render: (entry) => (
        <span className="text-sm text-muted">
          {entry.actor_name || t('super.user_with_id', { id: entry.actor_id })}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('super.federation_audit_log_title')}
        description={t('super.federation_audit_log_desc')}
        actions={
          <Button
            variant="tertiary"
            size="sm"
            startContent={<Download size={16} />}
            onPress={exportCsv}
          isDisabled={logs.length === 0}
        >
          {t('super.export_csv')}
        </Button>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label={t('super.label_total_actions_30d')}
          value={stats.total}
          icon={Activity}
          loading={loading && stats.total === 0}
        />
        <StatCard
          label={t('super.label_federation_changes')}
          value={stats.federation}
          icon={Network}
          color="success"
          loading={loading && stats.total === 0}
        />
        <StatCard
          label={t('super.label_partnership_actions')}
          value={stats.partnerships}
          icon={Handshake}
          loading={loading && stats.total === 0}
        />
        <StatCard
          label={t('super.label_emergency_actions')}
          value={stats.emergency}
          icon={AlertTriangle}
          color="danger"
          loading={loading && stats.total === 0}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Select
          label={t('super.label_category')}
          size="sm"
          className="max-w-[200px]"
          selectedKeys={category ? [category] : []}
          onSelectionChange={(keys) => {
            setCategory(String(Array.from(keys)[0] || ''));
            resetAndFilter();
          }}
        >
          {CATEGORIES.filter((c) => c.key !== '').map((c) => (
            <SelectItem key={c.key} id={c.key}>{t(c.labelKey)}</SelectItem>
          ))}
        </Select>

        <Select
          label={t('super.label_level')}
          size="sm"
          className="max-w-[160px]"
          selectedKeys={level ? [level] : []}
          onSelectionChange={(keys) => {
            setLevel(String(Array.from(keys)[0] || ''));
            resetAndFilter();
          }}
        >
          {LEVELS.filter((l) => l.key !== '').map((l) => (
            <SelectItem key={l.key} id={l.key}>{t(l.labelKey)}</SelectItem>
          ))}
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
            startContent={<X size={14} />}
          onPress={clearFilters}
        >
          {t('super.clear')}
        </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={logs}
        isLoading={loading}
        onRefresh={loadLogs}
        totalItems={totalItems}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

export default FederationAuditLog;
