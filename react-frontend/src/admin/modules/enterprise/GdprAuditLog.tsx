import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Select, SelectItem, Button, Chip, Spinner, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDPR Audit Log
 * Activity log for GDPR actions with advanced filtering, CSV export, and detail modal.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';

import RefreshCw from 'lucide-react/icons/refresh-cw';
import Download from 'lucide-react/icons/download';
import Filter from 'lucide-react/icons/filter';
import Eye from 'lucide-react/icons/eye';
import { useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import type { GdprAuditEntry } from '../../api/types';
import { translationToken } from './gdprAuditTranslations';
import { useTranslation } from 'react-i18next';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ActionColor = 'danger' | 'warning' | 'success' | 'primary' | 'default';

function getActionColor(action: string): ActionColor {
  const lower = action.toLowerCase();
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('purge')) return 'danger';
  if (lower.includes('update') || lower.includes('edit') || lower.includes('modify')) return 'warning';
  if (lower.includes('create') || lower.includes('approve') || lower.includes('grant')) return 'success';
  if (lower.includes('view') || lower.includes('export') || lower.includes('access')) return 'primary';
  return 'default';
}

interface AuditFilters {
  action: string;
  entity_type: string;
  date_from: string;
  date_to: string;
}

const EMPTY_FILTERS: AuditFilters = {
  action: '',
  entity_type: '',
  date_from: '',
  date_to: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GdprAuditLog() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.gdpr_audit_log_title') });
  const toast = useToast();

  const [entries, setEntries] = useState<GdprAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const perPage = 25;

  // Filters
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(EMPTY_FILTERS);

  // Detail modal
  const [selectedEntry, setSelectedEntry] = useState<GdprAuditEntry | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Derived unique values from loaded data for filter dropdowns
  const [allActions, setAllActions] = useState<string[]>([]);
  const [allEntityTypes, setAllEntityTypes] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getGdprAudit({
        page,
        per_page: perPage,
        action: appliedFilters.action || undefined,
        entity_type: appliedFilters.entity_type || undefined,
        date_from: appliedFilters.date_from || undefined,
        date_to: appliedFilters.date_to || undefined,
      });
      if (res.success && res.data) {
        const result = res.data as unknown;
        if (result && typeof result === 'object') {
          const pd = result as { data?: GdprAuditEntry[]; meta?: { total?: number } };
          const items = pd.data || [];
          setEntries(items);
          setTotal(pd.meta?.total ?? items.length);

          // Build unique action/entity_type lists from returned data
          // (we accumulate across pages so the dropdown stays populated)
          setAllActions((prev) => {
            const set = new Set(prev);
            items.forEach((e) => { if (e.action) set.add(e.action); });
            return Array.from(set).sort();
          });
          setAllEntityTypes((prev) => {
            const set = new Set(prev);
            items.forEach((e) => { if (e.entity_type) set.add(e.entity_type); });
            return Array.from(set).sort();
          });
        } else if (Array.isArray(result)) {
          setEntries(result);
          setTotal(result.length);
        }
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_g_d_p_r_audit_log'));
    } finally {
      setLoading(false);
    }
  }, [page, appliedFilters, t, toast]);


  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApplyFilters = useCallback(() => {
    setPage(1);
    setAppliedFilters({ ...filters });
  }, [filters]);

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const hasActiveFilters = useMemo(
    () => Object.values(appliedFilters).some((v) => v !== ''),
    [appliedFilters]
  );

  const handleExportCsv = useCallback(() => {
    const url = adminEnterprise.getGdprAuditExportUrl({
      action: appliedFilters.action || undefined,
      entity_type: appliedFilters.entity_type || undefined,
      date_from: appliedFilters.date_from || undefined,
      date_to: appliedFilters.date_to || undefined,
    });
    window.open(url, '_blank');
  }, [appliedFilters]);

  const handleViewEntry = useCallback((entry: GdprAuditEntry) => {
    setSelectedEntry(entry);
    setIsDetailOpen(true);
  }, []);

  // ─── Columns ────────────────────────────────────────────────────────

  const columns: Column<GdprAuditEntry>[] = useMemo(
    () => [
      { key: 'id', label: t('enterprise.gdpr_id'), sortable: true },
      { key: 'user_name', label: t('enterprise.gdpr_user'), sortable: true },
      {
        key: 'action',
        label: t('enterprise.gdpr_action'),
        sortable: true,
        render: (e) => (
          <Chip
            size="sm"
            variant="soft"
            color={getActionColor(e.action)}
            data-testid="audit-action-chip"
            data-action={e.action}
          >
            {t(`enterprise.gdpr_audit_action_${translationToken(e.action)}`, { defaultValue: t('enterprise.gdpr_audit_action_unknown') })}
          </Chip>
        ),
      },
      {
        key: 'entity_type',
        label: t('enterprise.gdpr_col_entity_type'),
        render: (e) => (
          <Chip size="sm" variant="soft" color="default">
            {t(`enterprise.gdpr_entity_type_${translationToken(e.entity_type)}`, { defaultValue: t('enterprise.gdpr_entity_type_unknown') })}
          </Chip>
        ),
      },
      { key: 'entity_id', label: t('enterprise.gdpr_col_entity_id') },
      {
        key: 'ip_address',
        label: t('enterprise.gdpr_col_ip_address'),
        render: (e) => (
          <span className="font-mono text-xs">{e.ip_address || '-'}</span>
        ),
      },
      {
        key: 'created_at',
        label: t('enterprise.gdpr_date'),
        sortable: true,
        render: (e) => new Date(e.created_at).toLocaleString(getFormattingLocale()),
      },
      {
        key: 'actions',
        label: '',
        render: (e) => (
          <Button
            isIconOnly
            variant="tertiary"
            size="sm"
            onPress={() => handleViewEntry(e)}
            aria-label={t('enterprise.gdpr_view_details')}
          >
            <Eye size={16} />
          </Button>
        ),
      },
    ],
    [handleViewEntry, t]
  );

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('enterprise.gdpr_audit_log_title')}
        description={t('enterprise.gdpr_audit_log_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="tertiary"
              startContent={<Download size={16} />}
              onPress={handleExportCsv}
              size="sm"
            >
              {t('enterprise.gdpr_export_csv')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadData}
              isLoading={loading}
              size="sm"
            >
              {t('enterprise.refresh')}
            </Button>
          </div>
        }
      />

      {/* Filter Bar */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={t('enterprise.gdpr_filter_action')}
              size="sm"
              className="w-40"
              selectedKeys={filters.action ? [filters.action] : []}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string | undefined;
                setFilters((f) => ({ ...f, action: val || '' }));
              }}
            >
              {allActions.map((a) => (
                <SelectItem key={a} id={a}>
                  {t(`enterprise.gdpr_audit_action_${translationToken(a)}`, { defaultValue: t('enterprise.gdpr_audit_action_unknown') })}
                </SelectItem>
              ))}
            </Select>

            <Select
              label={t('enterprise.gdpr_filter_entity_type')}
              size="sm"
              className="w-40"
              selectedKeys={filters.entity_type ? [filters.entity_type] : []}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string | undefined;
                setFilters((f) => ({ ...f, entity_type: val || '' }));
              }}
            >
              {allEntityTypes.map((et) => (
                <SelectItem key={et} id={et}>
                  {t(`enterprise.gdpr_entity_type_${translationToken(et)}`, { defaultValue: t('enterprise.gdpr_entity_type_unknown') })}
                </SelectItem>
              ))}
            </Select>

            <Input
              label={t('enterprise.gdpr_filter_date_from')}
              type="date"
              size="sm"
              className="w-40"
              value={filters.date_from}
              onValueChange={(v) => setFilters((f) => ({ ...f, date_from: v }))}
            />

            <Input
              label={t('enterprise.gdpr_filter_date_to')}
              type="date"
              size="sm"
              className="w-40"
              value={filters.date_to}
              onValueChange={(v) => setFilters((f) => ({ ...f, date_to: v }))}
            />

            <Button
              variant="tertiary"
              size="sm"
              startContent={<Filter size={16} />}
              onPress={handleApplyFilters}
            >
              {t('enterprise.gdpr_apply')}
            </Button>

            {hasActiveFilters && (
              <Button
                variant="tertiary"
                size="sm"
                onPress={handleClearFilters}
              >
                {t('enterprise.gdpr_clear')}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={entries}
        isLoading={loading}
        searchable={false}
        emptyContent={t('enterprise.no_gdpr_audit_entries')}
        totalItems={total}
        page={page}
        pageSize={perPage}
        onPageChange={setPage}
      />

      {/* Detail Modal */}
      <Modal isOpen={isDetailOpen} onOpenChange={setIsDetailOpen} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                {t('enterprise.gdpr_audit_entry')}
              </ModalHeader>
              <ModalBody>
                {selectedEntry ? (
                  <div className="space-y-4">
                    {/* Top metadata grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted">{t('enterprise.gdpr_detail_action')}</p>
                        <Chip size="sm" variant="soft" color={getActionColor(selectedEntry.action)}>
                          {t(`enterprise.gdpr_audit_action_${translationToken(selectedEntry.action)}`, { defaultValue: t('enterprise.gdpr_audit_action_unknown') })}
                        </Chip>
                      </div>
                      <div>
                        <p className="text-xs text-muted">{t('enterprise.gdpr_detail_entity_type')}</p>
                        <Chip size="sm" variant="soft" color="default">
                          {t(`enterprise.gdpr_entity_type_${translationToken(selectedEntry.entity_type)}`, { defaultValue: t('enterprise.gdpr_entity_type_unknown') })}
                        </Chip>
                      </div>
                      <div>
                        <p className="text-xs text-muted">{t('enterprise.gdpr_detail_entity_id')}</p>
                        <p className="text-sm">{selectedEntry.entity_id}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">{t('enterprise.gdpr_detail_admin_user')}</p>
                        <p className="text-sm">
                          {selectedEntry.user_name || t('enterprise.gdpr_admin_id', { id: selectedEntry.admin_id })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">{t('enterprise.gdpr_detail_ip_address')}</p>
                        <p className="text-sm font-mono">{selectedEntry.ip_address || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">{t('enterprise.gdpr_detail_timestamp')}</p>
                        <p className="text-sm">{new Date(selectedEntry.created_at).toLocaleString(getFormattingLocale())}</p>
                      </div>
                    </div>

                    {/* Old/New Values */}
                    {(selectedEntry.old_value || selectedEntry.new_value) && (
                      <div className={`grid gap-4 ${selectedEntry.old_value && selectedEntry.new_value ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                        {selectedEntry.old_value && (
                          <div>
                            <p className="text-xs text-muted mb-1">{t('enterprise.gdpr_old_value')}</p>
                            <pre className="text-xs bg-surface-secondary border border-border rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap break-all">
                              {selectedEntry.old_value}
                            </pre>
                          </div>
                        )}
                        {selectedEntry.new_value && (
                          <div>
                            <p className="text-xs text-muted mb-1">{t('enterprise.gdpr_new_value')}</p>
                            <pre className="text-xs bg-surface-secondary border border-border rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap break-all">
                              {selectedEntry.new_value}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-8">
                    <Spinner />
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('enterprise.gdpr_close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GdprAuditLog;
