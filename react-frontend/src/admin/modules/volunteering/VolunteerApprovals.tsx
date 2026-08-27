// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { Select, SelectItem, Button, Input, Avatar, Tabs, Tab, Checkbox } from '@/components/ui';

/**
 * Volunteer Approvals
 * Lists pending volunteer applications requiring admin review.
 * Parity: PHP VolunteeringController::approvals() + approve() + decline()
 */

import { useState, useCallback, useEffect, useMemo } from 'react';

import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Search from 'lucide-react/icons/search';
import Download from 'lucide-react/icons/download';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';

import { useTranslation } from 'react-i18next';

// Prefix cells that spreadsheet apps would treat as formulas (=, +, -, @)
// so member-supplied text can't execute when the CSV is opened in Excel.
function csvCell(value: unknown): string {
  const str = String(value ?? '');
  return JSON.stringify(/^[=+\-@\t\r]/.test(str) ? `'${str}` : str);
}

function exportToCsv(headers: string[], rows: unknown[][], filename: string) {
  if (rows.length === 0) return;
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
interface VolApplication {
  id: number;
  user_id: number;
  first_name: string;
  last_name: string;
  email: string;
  opportunity_title: string;
  status: string;
  created_at: string;
}

export function VolunteerApprovals() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.volunteer_approvals_title'));
  const toast = useToast();
  const [items, setItems] = useState<VolApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);

  // Search, filter, and bulk state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusTab, setStatusTab] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkConfirmAction, setBulkConfirmAction] = useState<'approve' | 'decline' | null>(null);
  const [declineConfirmId, setDeclineConfirmId] = useState<number | null>(null);
  const [opportunityFilter, setOpportunityFilter] = useState<string>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getApprovals();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setItems(payload);
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          setItems((payload as { data: VolApplication[] }).data || []);
        }
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_approvals'));
      setItems([]);
    }
    setLoading(false);
    setSelectedIds(new Set());
  }, [toast, t]);


  useEffect(() => { loadData(); }, [loadData]);

  // Derive unique opportunity titles for filter dropdown
  const opportunityOptions = useMemo(() => {
    const titles = [...new Set(items.map(i => i.opportunity_title).filter(Boolean))];
    titles.sort();
    return titles;
  }, [items]);

  // Filtered data
  const filteredItems = useMemo(() => {
    let result = items;
    // Status tab filter
    if (statusTab !== 'all') {
      result = result.filter(i => i.status === statusTab);
    }
    // Search by name
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        resolveUserDisplayName(i).toLowerCase().includes(q) ||
        i.email?.toLowerCase().includes(q)
      );
    }
    // Opportunity filter
    if (opportunityFilter !== 'all') {
      result = result.filter(i => i.opportunity_title === opportunityFilter);
    }
    return result;
  }, [items, statusTab, searchQuery, opportunityFilter]);

  const handleApprove = useCallback(async (id: number) => {
    setActionId(id);
    try {
      const res = await adminVolunteering.approveApplication(id);
      if (res.success) {
        toast.success(t('volunteering.application_approved'));
        loadData();
      } else {
        toast.error(t('volunteering.failed_to_approve_application'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_approve_application'));
    } finally {
      setActionId(null);
    }
  }, [loadData, toast, t]);

  const handleDecline = useCallback(async (id: number) => {
    setActionId(id);
    try {
      const res = await adminVolunteering.declineApplication(id);
      if (res.success) {
        toast.success(t('volunteering.application_declined'));
        loadData();
      } else {
        toast.error(t('volunteering.failed_to_decline_application'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_decline_application'));
    } finally {
      setActionId(null);
    }
  }, [loadData, toast, t]);

  // Bulk operations — both are gated behind a ConfirmModal (see bulkConfirmAction)
  const handleBulkApprove = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    let successCount = 0;
    const pendingIds = new Set(items.filter((item) => item.status === 'pending').map((item) => item.id));
    for (const id of selectedIds) {
      if (!pendingIds.has(id)) continue;
      try {
        const res = await adminVolunteering.approveApplication(id);
        if (res.success) successCount++;
      } catch { /* continue */ }
    }
    toast.success(t('volunteering.bulk_approved', { count: successCount }));
    setBulkLoading(false);
    setBulkConfirmAction(null);
    loadData();
  }, [items, loadData, selectedIds, toast, t]);

  const handleBulkDecline = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    let successCount = 0;
    const pendingIds = new Set(items.filter((item) => item.status === 'pending').map((item) => item.id));
    for (const id of selectedIds) {
      if (!pendingIds.has(id)) continue;
      try {
        const res = await adminVolunteering.declineApplication(id);
        if (res.success) successCount++;
      } catch { /* continue */ }
    }
    toast.success(t('volunteering.bulk_declined', { count: successCount }));
    setBulkLoading(false);
    setBulkConfirmAction(null);
    loadData();
  }, [items, loadData, selectedIds, toast, t]);

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pendingFilteredItems = useMemo(
    () => filteredItems.filter((item) => item.status === 'pending'),
    [filteredItems],
  );

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === pendingFilteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingFilteredItems.map(i => i.id)));
    }
  }, [pendingFilteredItems, selectedIds.size]);

  const handleExport = useCallback(() => {
    const headers = [
      t('volunteering.export_columns.name'),
      t('volunteering.export_columns.email'),
      t('volunteering.export_columns.opportunity'),
      t('volunteering.export_columns.status'),
      t('volunteering.export_columns.applied'),
    ];
    const rows = filteredItems.map((item) => [
      resolveUserDisplayName(item),
      item.email,
      item.opportunity_title,
      t(`volunteering.status_${item.status}`, { defaultValue: t('volunteering.status_unknown') }),
      item.created_at ? new Date(item.created_at).toLocaleDateString(getFormattingLocale()) : '',
    ]);
    exportToCsv(headers, rows, 'volunteer-approvals.csv');
    toast.success(t('volunteering.export_success'));
  }, [filteredItems, toast, t]);

  const columns: Column<VolApplication>[] = [
    {
      key: 'select', label: '',
      render: (item) => (
        item.status === 'pending' ? (
          <Checkbox
            isSelected={selectedIds.has(item.id)}
            onValueChange={() => handleToggleSelect(item.id)}
            aria-label={t('volunteering.select_application')}
          />
        ) : null
      ),
    },
    {
      key: 'applicant', label: t('volunteering.col_applicant'), sortable: true,
      render: (item) => (
        <div className="flex items-center gap-3">
          <Avatar name={resolveUserDisplayName(item)} size="sm" className="ring-2 ring-surface" />
          <div>
            <p className="font-medium text-foreground">{item.first_name} {item.last_name}</p>
            <p className="text-xs text-muted">{item.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'opportunity_title', label: t('volunteering.col_opportunity'), sortable: true },
    {
      key: 'status', label: t('volunteering.col_status'),
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'created_at', label: t('volunteering.col_applied'), sortable: true,
      render: (item) => <span className="text-sm text-muted">{item.created_at ? new Date(item.created_at).toLocaleDateString(getFormattingLocale()) : '--'}</span>,
    },
    {
      key: 'actions', label: t('volunteering.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {item.status === 'pending' && (
            <>
              <Button
                size="sm"
                variant="tertiary"
                color="success"
                startContent={<CheckCircle size={14} />}
                onPress={() => handleApprove(item.id)}
                isLoading={actionId === item.id}
                isDisabled={bulkLoading || (actionId !== null && actionId !== item.id)}
              >
                {t('volunteering.approve')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                startContent={<XCircle size={14} />}
                onPress={() => setDeclineConfirmId(item.id)}
                isLoading={actionId === item.id}
                isDisabled={bulkLoading || (actionId !== null && actionId !== item.id)}
              >
                {t('volunteering.decline')}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  // Status tab counts
  const statusCounts = useMemo(() => ({
    all: items.length,
    pending: items.filter(i => i.status === 'pending').length,
    approved: items.filter(i => i.status === 'approved').length,
    declined: items.filter(i => i.status === 'declined').length,
  }), [items]);

  // Top content: search + filters + bulk actions
  const topContent = useMemo(() => (
    <div className="flex flex-col gap-4 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03]">
      {/* Status Tabs */}
      <Tabs
        aria-label={t('volunteering.approvals_tabs_aria')}
        selectedKey={statusTab}
        onSelectionChange={(key) => { setStatusTab(key as string); setSelectedIds(new Set()); }}
        variant="underlined"
        size="sm"
      >
        <Tab key="all" title={`${t('volunteering.tab_all')} (${statusCounts.all})`} />
        <Tab key="pending" title={`${t('volunteering.tab_pending')} (${statusCounts.pending})`} />
        <Tab key="approved" title={`${t('volunteering.tab_approved')} (${statusCounts.approved})`} />
        <Tab key="declined" title={`${t('volunteering.declined')} (${statusCounts.declined})`} />
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {/* Search */}
          <Input type="search" name="admin-search" autoComplete="off"
            className="max-w-xs"
            placeholder={t('volunteering.search_applicants')}
            aria-label={t('volunteering.search_applicants')}
            startContent={<Search size={16} className="text-muted" />}
            value={searchQuery}
            onValueChange={setSearchQuery}
            isClearable
            onClear={() => setSearchQuery('')}
            size="sm"
          />

          {/* Opportunity filter */}
          {opportunityOptions.length > 1 && (
            <Select
              className="max-w-[220px]"
              label={t('volunteering.filter_opportunity')}
              size="sm"
              selectedKeys={new Set([opportunityFilter])}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string;
                setOpportunityFilter(val || 'all');
              }}
              items={[{ key: 'all', label: t('volunteering.tab_all') }, ...opportunityOptions.map(title => ({ key: title, label: title }))]}
            >
              {(item) => <SelectItem key={item.key} id={item.key}>{item.label}</SelectItem>}
            </Select>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Select all checkbox */}
          {pendingFilteredItems.length > 0 && (
            <Checkbox
              isSelected={selectedIds.size === pendingFilteredItems.length && pendingFilteredItems.length > 0}
              isIndeterminate={selectedIds.size > 0 && selectedIds.size < pendingFilteredItems.length}
              onValueChange={handleSelectAll}
              size="sm"
            >
              <span className="text-xs text-muted">
                {selectedIds.size > 0
                  ? t('volunteering.selected_count', { count: selectedIds.size })
                  : t('volunteering.select_all')}
              </span>
            </Checkbox>
          )}

          {/* Bulk actions — confirmed via ConfirmModal before firing */}
          {selectedIds.size > 0 && (
            <>
              <Button
                size="sm"
                variant="tertiary"
                color="success"
                startContent={<CheckCircle size={14} />}
                onPress={() => setBulkConfirmAction('approve')}
                isLoading={bulkLoading}
              >
                {t('volunteering.bulk_approve', { count: selectedIds.size })}
              </Button>
              <Button
                size="sm"
                variant="danger"
                startContent={<XCircle size={14} />}
                onPress={() => setBulkConfirmAction('decline')}
                isLoading={bulkLoading}
              >
                {t('volunteering.bulk_decline', { count: selectedIds.size })}
              </Button>
            </>
          )}

          {/* Export */}
          <Button
            size="sm"
            variant="tertiary"
            startContent={<Download size={14} />}
            onPress={handleExport}
            isDisabled={filteredItems.length === 0}
          >
            {t('volunteering.export')}
          </Button>
        </div>
      </div>
    </div>
  ), [statusTab, statusCounts, searchQuery, opportunityFilter, opportunityOptions, selectedIds, pendingFilteredItems.length, filteredItems, bulkLoading, t, handleSelectAll, handleExport]);

  if (!loading && items.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('volunteering.volunteer_approvals_title')} description={t('volunteering.volunteer_approvals_desc')} />
        <EmptyState icon={ClipboardCheck} title={t('volunteering.no_pending_approvals')} description={t('volunteering.desc_all_volunteer_applications_have_been_rev')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.volunteer_approvals_title')}
        description={t('volunteering.volunteer_approvals_desc')}
        actions={<Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={loadData} isLoading={loading}>{t('volunteering.refresh')}</Button>}
      />
      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={loading}
        onRefresh={loadData}
        searchable={false}
        topContent={topContent}
      />

      {/* Bulk approve/decline confirmation */}
      <ConfirmModal
        isOpen={bulkConfirmAction !== null}
        onClose={() => { if (!bulkLoading) setBulkConfirmAction(null); }}
        onConfirm={bulkConfirmAction === 'approve' ? handleBulkApprove : handleBulkDecline}
        title={bulkConfirmAction === 'approve'
          ? t('volunteering.bulk_approve_title')
          : t('volunteering.bulk_decline_title')}
        message={bulkConfirmAction === 'approve'
          ? t('volunteering.bulk_approve_confirm', { count: selectedIds.size })
          : t('volunteering.bulk_decline_confirm', { count: selectedIds.size })}
        confirmLabel={bulkConfirmAction === 'approve' ? t('volunteering.approve') : t('volunteering.decline')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor={bulkConfirmAction === 'approve' ? 'primary' : 'danger'}
        isLoading={bulkLoading}
      />

      {/* Single-row decline confirmation — a misclick must not decline instantly */}
      <ConfirmModal
        isOpen={declineConfirmId !== null}
        onClose={() => { if (actionId === null) setDeclineConfirmId(null); }}
        onConfirm={async () => {
          if (declineConfirmId !== null) {
            await handleDecline(declineConfirmId);
          }
          setDeclineConfirmId(null);
        }}
        title={t('volunteering.decline')}
        message={t('volunteering.decline_confirm')}
        confirmLabel={t('volunteering.decline')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor="danger"
        isLoading={actionId !== null && actionId === declineConfirmId}
      />
    </div>
  );
}

export default VolunteerApprovals;
