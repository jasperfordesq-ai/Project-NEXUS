// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Button, Chip, Input, Card, CardBody, CardHeader, Select, SelectItem, Tab, Tabs, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useState, useCallback, useEffect, useMemo } from 'react';

import Clock from 'lucide-react/icons/clock';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Hourglass from 'lucide-react/icons/hourglass';
import CreditCard from 'lucide-react/icons/credit-card';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ThumbsUp from 'lucide-react/icons/thumbs-up';
import ThumbsDown from 'lucide-react/icons/thumbs-down';
import Download from 'lucide-react/icons/download';
import Building2 from 'lucide-react/icons/building-2';
import Banknote from 'lucide-react/icons/banknote';
import CalendarRange from 'lucide-react/icons/calendar-range';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useTranslation } from 'react-i18next';

/**
 * Volunteer Hours Audit
 * Admin page for auditing volunteer hours, approving/declining pending entries, * and viewing payment trail.
 */


// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Coerce a numeric value to a number. MySQL DECIMAL columns (vol_logs.hours,
 * vol_org_transactions.amount) serialize as JSON strings, so `hours`/`paid_amount`
 * arrive as strings at runtime — `.toFixed()` throws and `+` concatenates.
 */
function toNum(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

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

interface HoursStats {
  total_hours: number;
  approved_hours: number;
  pending_hours: number;
  total_paid: number;
}

interface HourLog {
  id: number;
  hours: number;
  status: string;
  created_at: string;
  paid: number | boolean;
  paid_amount: number;
  first_name: string;
  last_name: string;
  org_name: string;
}

const STATUS_COLORS: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
  approved: 'success',
  declined: 'danger',
  pending: 'warning',
};

// Safety cap so a runaway cursor can't loop forever during a full export.
const MAX_EXPORT_PAGES = 200;

/**
 * Parse one page of the hours endpoint into { items, meta }. Mirrors the
 * unwrapping in loadData so the CSV export can page through every result set,
 * not just the pages currently rendered on screen.
 */
function extractHoursPage(res: { data?: unknown; meta?: unknown }): {
  items: HourLog[];
  meta: { next_cursor?: string; has_more?: boolean } | null;
} {
  const payload = res.data as unknown;
  let items: HourLog[] = [];
  let meta: { next_cursor?: string; has_more?: boolean } | null = null;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const inner = ('data' in p && typeof p.data === 'object' && p.data !== null && 'stats' in (p.data as Record<string, unknown>))
      ? (p.data as Record<string, unknown>)
      : p;
    if (Array.isArray(inner.items)) items = inner.items as HourLog[];
    else if (Array.isArray(inner.data)) items = inner.data as HourLog[];
    else if (Array.isArray(inner)) items = inner as unknown as HourLog[];
    if (inner.meta && typeof inner.meta === 'object') meta = inner.meta as { next_cursor?: string; has_more?: boolean };
  }
  meta = meta || (res.meta as { next_cursor?: string; has_more?: boolean } | undefined) || null;
  return { items, meta };
}

export function VolunteerHoursAudit() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.hours_audit_title'));
  const toast = useToast();

  const [stats, setStats] = useState<HoursStats>({
    total_hours: 0,
    approved_hours: 0,
    pending_hours: 0,
    total_paid: 0,
  });
  const [items, setItems] = useState<HourLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  // Decline requires confirmation; approve is direct
  const [declineTarget, setDeclineTarget] = useState<HourLog | null>(null);

  // Date range filter
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Active tab
  const [activeTab, setActiveTab] = useState<string>('hours');

  const loadData = useCallback(async (appendCursor?: string) => {
    if (!appendCursor) setLoading(true);
    try {
      const params: { status?: string; cursor?: string } = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (appendCursor) params.cursor = appendCursor;

      const res = await adminVolunteering.listHours(params);
      if (res.success) {
        const payload = res.data as unknown;

        // Current endpoint returns { data: { items, stats, meta }, meta }.
        // Older responses used { data: [...], stats, meta }, so keep both.
        let hours: HourLog[] = [];
        let newStats: HoursStats | null = null;
        let meta: { next_cursor?: string; has_more?: boolean } | null = null;

        if (payload && typeof payload === 'object') {
          // Check for double-wrap
          const p = payload as Record<string, unknown>;
          const inner = ('data' in p && typeof p.data === 'object' && p.data !== null && 'stats' in (p.data as Record<string, unknown>))
            ? p.data as Record<string, unknown>
            : p;

          if (Array.isArray(inner.items)) {
            hours = inner.items as HourLog[];
          } else if (Array.isArray(inner.data)) {
            hours = inner.data as HourLog[];
          } else if (Array.isArray(inner)) {
            hours = inner as unknown as HourLog[];
          }

          if (inner.stats && typeof inner.stats === 'object') {
            newStats = inner.stats as HoursStats;
          }
          if (inner.meta && typeof inner.meta === 'object') {
            meta = inner.meta as { next_cursor?: string; has_more?: boolean };
          }
        }

        meta = meta || (res.meta as { next_cursor?: string; has_more?: boolean } | undefined) || null;

        if (appendCursor) {
          setItems((prev) => [...prev, ...hours]);
        } else {
          setItems(hours);
          if (newStats) setStats(newStats);
        }

        setCursor(meta?.next_cursor || null);
        setHasMore(meta?.has_more || false);
      }
    } catch {
      toast.error(t('volunteering.failed_load_hours'));
      if (!appendCursor) {
        setItems([]);
      }
    }
    setLoading(false);
  }, [statusFilter, toast, t]);


  useEffect(() => { loadData(); }, [loadData]);

  const handleVerify = useCallback(async (logId: number, action: 'approve' | 'decline') => {
    setActionInProgress(logId);
    try {
      const res = await adminVolunteering.verifyHours(logId, action);
      if (res.success) {
        toast.success(
          action === 'approve'
            ? t('volunteering.hours_approved')
            : t('volunteering.hours_declined')
        );
        setDeclineTarget(null);
        // Refresh all data to update stats
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — a failed ApiResponse
        // carries `error`, never `message`; the old `.message` read was dead.
        toast.error(res.error || t('volunteering.verify_failed'));
      }
    } catch {
      toast.error(t('volunteering.verify_failed'));
    }
    setActionInProgress(null);
  }, [toast, t, loadData]);

  // ── Filtered data (by date range) ─────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (!item.created_at) return true;
      const itemDate = new Date(item.created_at);
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        if (itemDate < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (itemDate > to) return false;
      }
      return true;
    });
  }, [items, dateFrom, dateTo]);

  // ── Per-org breakdown ───────────────────────────────────────────────────────
  const orgBreakdown = useMemo(() => {
    const map = new Map<string, { approved: number; pending: number }>();
    filteredItems.forEach((item) => {
      const orgName = item.org_name || t('volunteering.unknown_org');
      if (!map.has(orgName)) map.set(orgName, { approved: 0, pending: 0 });
      const entry = map.get(orgName)!;
      const hours = Number.parseFloat(String(item.hours)) || 0;
      if (item.status === 'approved') entry.approved += hours;
      else if (item.status === 'pending') entry.pending += hours;
    });
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        approved: Number(data.approved.toFixed(2)),
        pending: Number(data.pending.toFixed(2)),
      }))
      .sort((a, b) => (b.approved + b.pending) - (a.approved + a.pending));
  }, [filteredItems, t]);


  // ── Payment reconciliation data ─────────────────────────────────────────────
  const paidEntries = useMemo(() => {
    return filteredItems.filter((item) => item.paid === 1 || item.paid === true);
  }, [filteredItems]);

  const handleExportCsv = useCallback(async () => {
    setExporting(true);
    try {
      // Export every matching row, not just the pages already on screen: page
      // through the cursor until the server reports no more data (with a cap).
      const allItems: HourLog[] = [];
      let exportCursor: string | undefined;
      let pageCount = 0;
      let truncated = false;

      for (;;) {
        const params: { status?: string; cursor?: string } = {};
        if (statusFilter !== 'all') params.status = statusFilter;
        if (exportCursor) params.cursor = exportCursor;

        const res = await adminVolunteering.listHours(params);
        if (!res.success) {
          if (pageCount === 0) throw new Error('hours_export_failed');
          break;
        }

        const { items: pageItems, meta } = extractHoursPage(res);
        allItems.push(...pageItems);
        pageCount += 1;

        if (!meta?.has_more || !meta?.next_cursor) break;
        if (pageCount >= MAX_EXPORT_PAGES) { truncated = true; break; }
        exportCursor = meta.next_cursor;
      }

      // Apply the same on-screen date-range filter to the full result set.
      const rows = allItems.filter((item) => {
        if (!item.created_at) return true;
        const itemDate = new Date(item.created_at);
        if (dateFrom) {
          const from = new Date(dateFrom);
          from.setHours(0, 0, 0, 0);
          if (itemDate < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59, 999);
          if (itemDate > to) return false;
        }
        return true;
      });

      const headers = [
        t('volunteering.export_columns.volunteer'),
        t('volunteering.export_columns.organization'),
        t('volunteering.export_columns.hours'),
        t('volunteering.export_columns.status'),
        t('volunteering.export_columns.date'),
        t('volunteering.export_columns.paid'),
        t('volunteering.export_columns.paid_amount'),
      ];
      const exportRows = rows.map((item) => [
        `${item.first_name} ${item.last_name}`,
        item.org_name || '',
        item.hours,
        t(`volunteering.status_${item.status}`, { defaultValue: t('volunteering.status_unknown') }),
        item.created_at ? new Date(item.created_at).toLocaleDateString(getFormattingLocale()) : '',
        (item.paid === 1 || item.paid === true) ? t('volunteering.yes') : t('volunteering.no'),
        item.paid_amount || 0,
      ]);
      exportToCsv(headers, exportRows, `volunteer-hours-${new Date().toISOString().split('T')[0]}.csv`);

      if (truncated) {
        toast.warning(t('volunteering.export_truncated', { count: MAX_EXPORT_PAGES }));
      }
    } catch {
      toast.error(t('volunteering.export_failed'));
    }
    setExporting(false);
  }, [statusFilter, dateFrom, dateTo, t, toast]);

  const columns: Column<HourLog>[] = useMemo(() => [
    {
      key: 'volunteer',
      label: t('volunteering.col_volunteer'),
      sortable: true,
      render: (item) => (
        <span className="font-medium">
          {item.first_name} {item.last_name}
        </span>
      ),
    },
    {
      key: 'org_name',
      label: t('volunteering.col_organization'),
      sortable: true,
      render: (item) => <span>{item.org_name || '--'}</span>,
    },
    {
      key: 'hours',
      label: t('volunteering.col_hours'),
      sortable: true,
      render: (item) => <span className="font-mono">{item.hours}</span>,
    },
    {
      key: 'created_at',
      label: t('volunteering.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.created_at ? new Date(item.created_at).toLocaleDateString(getFormattingLocale()) : '--'}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('volunteering.col_status'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status] || 'default'} className="capitalize">
          {t(`volunteering.status_${item.status}`, { defaultValue: t('volunteering.status_unknown') })}
        </Chip>
      ),
    },
    {
      key: 'paid',
      label: t('volunteering.col_paid'),
      render: (item) => {
        const isPaid = item.paid === 1 || item.paid === true;
        return (
          <div className="flex items-center gap-1">
            <Chip size="sm" variant="soft" color={isPaid ? 'success' : 'default'}>
              {isPaid ? t('volunteering.yes') : t('volunteering.no')}
            </Chip>
            {isPaid && item.paid_amount > 0 && (
              <span className="text-xs text-muted font-mono">{formatNumber(toNum(item.paid_amount), { maximumFractionDigits: 2 })}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: t('volunteering.col_actions'),
      render: (item) => {
        if (item.status !== 'pending') return null;
        const isThisItem = actionInProgress === item.id;
        const isOtherItem = actionInProgress !== null && actionInProgress !== item.id;
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="tertiary"
              color="success"
              startContent={<ThumbsUp size={14} />}
              isLoading={isThisItem}
              isDisabled={isOtherItem}
              onPress={() => handleVerify(item.id, 'approve')}
            >
              {t('volunteering.approve')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              startContent={<ThumbsDown size={14} />}
              isLoading={isThisItem}
              isDisabled={isOtherItem}
              onPress={() => setDeclineTarget(item)}
            >
              {t('volunteering.decline')}
            </Button>
          </div>
        );
      },
    },
  ], [actionInProgress, handleVerify, t]);

  const topContent = useMemo(() => (
    <div className="flex flex-col gap-4 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03]">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          className="w-48"
          label={t('volunteering.filter_by_status')}
          size="sm"
          selectedKeys={new Set([statusFilter])}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as string;
            setStatusFilter(val || 'all');
          }}
        >
          <SelectItem key="all" id="all">{t('volunteering.tab_all')}</SelectItem>
          <SelectItem key="pending" id="pending">{t('volunteering.tab_pending')}</SelectItem>
          <SelectItem key="approved" id="approved">{t('volunteering.tab_approved')}</SelectItem>
          <SelectItem key="declined" id="declined">{t('volunteering.declined')}</SelectItem>
        </Select>
        <Input
          type="date"
          label={t('volunteering.date_from')}
          size="sm"
          className="w-44"
          value={dateFrom}
          onValueChange={setDateFrom}
          startContent={<CalendarRange size={14} className="text-muted" />}
        />
        <Input
          type="date"
          label={t('volunteering.date_to')}
          size="sm"
          className="w-44"
          value={dateTo}
          onValueChange={setDateTo}
          startContent={<CalendarRange size={14} className="text-muted" />}
        />
        {(dateFrom || dateTo) && (
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => { setDateFrom(''); setDateTo(''); }}
          >
            {t('volunteering.clear_dates')}
          </Button>
        )}
        <Button
          size="sm"
          variant="tertiary"
          startContent={<Download size={14} />}
          onPress={handleExportCsv}
          isLoading={exporting}
          isDisabled={filteredItems.length === 0 && !hasMore}
        >
          {t('volunteering.export_csv')}
        </Button>
        {hasMore && (
          <Button size="sm" variant="tertiary" onPress={() => loadData(cursor ?? undefined)} isLoading={loading}>
            {t('volunteering.load_more')}
          </Button>
        )}
      </div>
      {hasMore && (
        <p className="text-xs text-muted">
          {t('volunteering.export_partial_note')}
        </p>
      )}
    </div>
  ), [statusFilter, hasMore, cursor, loading, exporting, t, loadData, dateFrom, dateTo, handleExportCsv, filteredItems.length]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.hours_audit_title')}
        description={t('volunteering.hours_audit_desc')}
        actions={
          <Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={() => loadData()} isLoading={loading}>
            {t('volunteering.refresh')}
          </Button>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('volunteering.stat_total_hours')}
          value={stats.total_hours}
          icon={Clock}
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_approved_hours')}
          value={stats.approved_hours}
          icon={CheckCircle}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_pending_hours')}
          value={stats.pending_hours}
          icon={Hourglass}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_total_paid')}
          value={stats.total_paid}
          icon={CreditCard}
          loading={loading}
        />
      </div>

      {/* Per-org breakdown */}
      {orgBreakdown.length > 0 && (
        <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 size={18} />
              <span className="font-semibold">
                {t('volunteering.org_breakdown_title')}
              </span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {orgBreakdown.map((org) => (
                <div
                  key={org.name}
                  className="flex items-center justify-between rounded-xl border border-divider/70 bg-surface-secondary/30 p-3"
                >
                  <span className="font-medium text-sm truncate mr-2">{org.name}</span>
                  <div className="flex gap-3 text-xs shrink-0">
                    <span className="text-success">
                      {org.approved} {t('volunteering.approved_abbr')}
                    </span>
                    {org.pending > 0 && (
                      <span className="text-warning">
                        {org.pending} {t('volunteering.pending_abbr')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Tabs: Hours table + Payment reconciliation */}
      <Tabs
        aria-label={t('volunteering.hours_audit_tabs_aria')}
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(key as string)}
        variant="underlined"
      >
        <Tab key="hours" title={t('volunteering.tab_hours')} />
        <Tab
          key="payments"
          title={
            <div className="flex items-center gap-1.5">
              <Banknote size={14} />
              {t('volunteering.tab_payments')}
            </div>
          }
        />
      </Tabs>

      {activeTab === 'hours' && (
        <>
          {!loading && filteredItems.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={t('volunteering.no_hours')}
              description={t('volunteering.no_hours_desc')}
            />
          ) : (
            <DataTable
              columns={columns}
              data={filteredItems}
              isLoading={loading}
              onRefresh={() => loadData()}
              searchable={false}
              topContent={topContent}
            />
          )}
        </>
      )}

      {activeTab === 'payments' && (
        <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Banknote size={18} />
              <span className="font-semibold">
                {t('volunteering.payment_reconciliation_title')}
              </span>
            </div>
          </CardHeader>
          <CardBody>
            {paidEntries.length === 0 ? (
              <div className="text-center py-8">
                <CreditCard size={40} className="mx-auto mb-3 text-muted" />
                <p className="text-muted text-sm">
                  {t('volunteering.no_paid_entries')}
                </p>
                <p className="text-muted text-xs mt-1">
                  {t('volunteering.payment_tracking_note')}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table
                  aria-label={t('volunteering.payment_reconciliation_title')}
                  removeWrapper
                >
                  <TableHeader>
                    <TableColumn>{t('volunteering.col_volunteer')}</TableColumn>
                    <TableColumn>{t('volunteering.col_organization')}</TableColumn>
                    <TableColumn>{t('volunteering.col_hours')}</TableColumn>
                    <TableColumn>{t('volunteering.col_amount_paid')}</TableColumn>
                    <TableColumn>{t('volunteering.col_date')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {paidEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <span className="font-medium">
                            {entry.first_name} {entry.last_name}
                          </span>
                        </TableCell>
                        <TableCell>{entry.org_name || '--'}</TableCell>
                        <TableCell className="font-mono">{formatNumber(toNum(entry.hours), { maximumFractionDigits: 2 })}</TableCell>
                        <TableCell className="font-mono text-success">
                          {toNum(entry.paid_amount) > 0
                            ? formatNumber(toNum(entry.paid_amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '--'}
                        </TableCell>
                        <TableCell className="text-muted">
                          {entry.created_at ? new Date(entry.created_at).toLocaleDateString(getFormattingLocale()) : '--'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-3 grid grid-cols-1 gap-2 border-t border-divider pt-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <span className="font-semibold">{t('volunteering.total')}</span>
                  <span className="font-mono font-semibold">
                    {formatNumber(paidEntries.reduce((sum, e) => sum + toNum(e.hours), 0), { maximumFractionDigits: 2 })}
                  </span>
                  <span className="font-mono font-semibold text-success">
                    {formatNumber(paidEntries.reduce((sum, e) => sum + toNum(e.paid_amount), 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Decline Confirmation */}
      <ConfirmModal
        isOpen={declineTarget !== null}
        onClose={() => { if (actionInProgress === null) setDeclineTarget(null); }}
        onConfirm={() => { if (declineTarget) handleVerify(declineTarget.id, 'decline'); }}
        title={t('volunteering.decline_hours_title')}
        message={t('volunteering.decline_hours_confirm', {
          hours: declineTarget?.hours ?? 0,
          name: [declineTarget?.first_name, declineTarget?.last_name].filter(Boolean).join(' '),
        })}
        confirmLabel={t('volunteering.decline')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor="danger"
        isLoading={actionInProgress !== null}
      />
    </div>
  );
}

export default VolunteerHoursAudit;
