// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer Expenses
 * Admin page for managing volunteer expense submissions, reviews, and policies.
 */

import { formatCurrency, formatNumber, getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useMemo, useState } from 'react';

import Building2 from 'lucide-react/icons/building-2';
import CalendarRange from 'lucide-react/icons/calendar-range';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import CreditCard from 'lucide-react/icons/credit-card';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Download from 'lucide-react/icons/download';
import ExternalLink from 'lucide-react/icons/external-link';
import Eye from 'lucide-react/icons/eye';
import FileText from 'lucide-react/icons/file-text';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Settings from 'lucide-react/icons/settings';
import XCircle from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { Accordion, AccordionItem, Button, Card, CardBody, CardHeader, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, Textarea, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Expense {
  id: number;
  volunteer_name: string;
  organization_name: string;
  amount: number;
  currency: string;
  type: 'travel' | 'meals' | 'supplies' | 'equipment' | 'parking' | 'other';
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  submitted_at: string;
  has_receipt: boolean;
  receipt_path?: string;
  description?: string;
  review_notes?: string;
  payment_reference?: string;
}

interface ExpenseStats {
  total_submitted: number;
  pending_review: number;
  approved_total: number;
  paid_total: number;
}

interface ExpensePolicy {
  id?: number;
  type: string;
  expense_type?: string;
  max_amount: number;
  max_monthly: number;
  requires_receipt_above: number;
  requires_approval: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'danger' | 'accent'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paid: 'accent',
};

type ReviewAction = 'approved' | 'rejected';

// The transitions a community admin may make here (VolunteerExpenseService::
// reviewExpense takes only a pending expense). Marking an approved claim as
// paid belongs to the organisation that pays it — it records payment from its
// own dashboard, and this endpoint now answers 403 for status 'paid' (owner
// decision, 2026-10-02). Paid and rejected are final.
const ALLOWED_ACTIONS: Record<Expense['status'], ReviewAction[]> = {
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
  paid: [],
};

function parsePayload<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

/**
 * Coerce a monetary value to a number. MySQL DECIMAL columns serialize as JSON
 * strings (e.g. "12.00"), so `amount` arrives as a string at runtime despite the
 * `number` type — calling `.toFixed()` on it throws and `+=` concatenates.
 */
function toNum(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function formatExpenseAmount(value: unknown, currency?: string | null): string {
  const amount = toNum(value);
  if (!currency) {
    return formatNumber(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  try {
    return formatCurrency(amount, currency.toUpperCase());
  } catch {
    return `${formatNumber(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;
  }
}

// Safety cap so a runaway cursor can't loop forever during a full export.
const MAX_EXPORT_PAGES = 200;

// Prefix cells that spreadsheet apps would treat as formulas (=, +, -, @) so
// member-supplied text can't execute when the CSV is opened in Excel.
function csvCell(value: unknown): string {
  const str = String(value ?? '');
  return JSON.stringify(/^[=+\-@\t\r]/.test(str) ? `'${str}` : str);
}

function buildCsv(headers: string[], rows: unknown[][], filename: string) {
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

/**
 * Parse one page of the expenses endpoint into { items, cursor, has_more }.
 * Mirrors loadData so the CSV export can page through every matching row, not
 * just the pages currently rendered on screen.
 */
function extractExpensesPage(raw: unknown): { items: Expense[]; cursor: string | null; has_more: boolean } {
  const payload = parsePayload<{ items?: Expense[]; expenses?: Expense[]; cursor?: string | null; has_more?: boolean } | Expense[]>(raw);
  if (Array.isArray(payload)) return { items: payload, cursor: null, has_more: false };
  return {
    items: payload.items || payload.expenses || [],
    cursor: payload.cursor ?? null,
    has_more: Boolean(payload.has_more),
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VolunteerExpenses() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.expenses_page_title'));
  const toast = useToast();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stats, setStats] = useState<ExpenseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Review modal
  const [reviewModal, setReviewModal] = useState(false);
  const [reviewExpense, setReviewExpense] = useState<Expense | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction>('approved');
  const [reviewNotes, setReviewNotes] = useState('');

  // Date range filter
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Receipt preview modal
  const [receiptModal, setReceiptModal] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string>('');
  const [receiptIsPdf, setReceiptIsPdf] = useState(false);

  // Policies
  const [policies, setPolicies] = useState<ExpensePolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyModal, setPolicyModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ExpensePolicy | null>(null);
  const [policyForm, setPolicyForm] = useState({
    max_amount: '',
    max_monthly: '',
    requires_receipt_above: '',
    requires_approval: true,
  });

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadData = useCallback(async (opts?: { cursor?: string; append?: boolean }) => {
    const append = opts?.append ?? false;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const res = await adminVolunteering.getExpenses(opts?.cursor);
      if (res.success && res.data) {
        const payload = parsePayload<{ items?: Expense[]; expenses?: Expense[]; stats?: ExpenseStats; cursor?: string | null; has_more?: boolean } | Expense[]>(res.data);
        const rows = Array.isArray(payload) ? payload : payload.items || payload.expenses || [];
        setExpenses((prev) => (append ? [...prev, ...rows] : rows));
        if (Array.isArray(payload)) {
          if (!append) setStats(null);
          setCursor(null);
          setHasMore(false);
        } else {
          if (!append) setStats(payload.stats || null);
          setCursor(payload.cursor ?? null);
          setHasMore(Boolean(payload.has_more));
        }
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_expenses'));
      if (!append) {
        setExpenses([]);
        setStats(null);
        setCursor(null);
        setHasMore(false);
      }
    }
    if (append) setLoadingMore(false); else setLoading(false);
  }, [toast, t]);

  const loadMore = useCallback(() => {
    if (cursor) loadData({ cursor, append: true });
  }, [cursor, loadData]);


  const loadPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    try {
      const res = await adminVolunteering.getExpensePolicies();
      if (res.success && res.data) {
        const payload = parsePayload<ExpensePolicy[] | { policies: ExpensePolicy[] }>(res.data);
        setPolicies(Array.isArray(payload) ? payload : (payload as { policies: ExpensePolicy[] }).policies || []);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_policies'));
    }
    setPoliciesLoading(false);
  }, [toast, t]);


  useEffect(() => { loadData(); loadPolicies(); }, [loadData, loadPolicies]);

  // ── Filtered data (by date range) ─────────────────────────────────────────
  const filteredExpenses = useMemo(() => {
    return expenses.filter((item) => {
      if (!item.submitted_at) return true;
      const itemDate = new Date(item.submitted_at);
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
  }, [expenses, dateFrom, dateTo]);

  // ── Per-org breakdown ───────────────────────────────────────────────────────
  const orgBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; count: number; pending: number; approved: number }>();
    filteredExpenses.forEach((item) => {
      const orgName = item.organization_name || t('volunteering.unknown_org');
      if (!map.has(orgName)) map.set(orgName, { total: 0, count: 0, pending: 0, approved: 0 });
      const entry = map.get(orgName)!;
      const amount = toNum(item.amount);
      entry.total += amount;
      entry.count += 1;
      if (item.status === 'pending') entry.pending += amount;
      if (item.status === 'approved' || item.status === 'paid') entry.approved += amount;
    });
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredExpenses, t]);


  // ── Actions ────────────────────────────────────────────────────────────────

  const openReceipt = async (expense: Expense) => {
    if (!expense.has_receipt) return;
    const isPdf = (expense.receipt_path || '').toLowerCase().endsWith('.pdf');
    try {
      // Receipts live on a private disk with no public URL — fetch the bytes
      // through the authenticated, tenant-scoped download endpoint and preview
      // via an object URL (the old code linked the raw storage path, which 404'd).
      const res = await adminVolunteering.getReceiptBlob(expense.id);
      const blob = res instanceof Blob ? res : new Blob([res as BlobPart]);
      const objectUrl = URL.createObjectURL(blob);
      setReceiptUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return objectUrl; });
      setReceiptIsPdf(isPdf);
      if (isPdf) {
        window.open(objectUrl, '_blank');
      } else {
        setReceiptModal(true);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_receipt'));
    }
  };

  const closeReceiptModal = () => {
    setReceiptModal(false);
    setReceiptUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return ''; });
  };

  const openReview = (expense: Expense) => {
    setReviewExpense(expense);
    setReviewAction(ALLOWED_ACTIONS[expense.status]?.[0] ?? 'approved');
    setReviewNotes('');
    setReviewModal(true);
  };

  const handleReview = async () => {
    if (!reviewExpense) return;
    setActionLoading(true);
    try {
      const data: { status: string; review_notes?: string } = {
        status: reviewAction,
      };
      if (reviewNotes.trim()) data.review_notes = reviewNotes.trim();
      const res = await adminVolunteering.reviewExpense(reviewExpense.id, data);
      if (res.success) {
        toast.success(t('volunteering.expense_updated'));
        setReviewModal(false);
        loadData();
      } else {
        // Someone else moved this claim on since the list loaded: say why in the
        // admin's own language (the server's text is not shown directly), close
        // the now-stale dialog and show the claim as it now stands.
        if (res.code === 'INVALID_STATE') {
          toast.error(t('volunteering.expense_already_reviewed'));
        } else if (res.code === 'SELF_REVIEW_FORBIDDEN') {
          toast.error(t('volunteering.expense_review_own_forbidden'));
        } else {
          toast.error(t('volunteering.failed_to_update_expense'));
        }
        if (res.code === 'INVALID_STATE') {
          setReviewModal(false);
          loadData();
        }
      }
    } catch {
      toast.error(t('volunteering.failed_to_update_expense'));
    }
    setActionLoading(false);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      // Export every matching row, not just the page currently on screen: page
      // through the cursor until the server reports no more data (with a cap).
      const allRows: Expense[] = [];
      let exportCursor: string | undefined;
      let pageCount = 0;
      let truncated = false;

      for (;;) {
        const res = await adminVolunteering.getExpenses(exportCursor);
        if (!res.success || !res.data) {
          if (pageCount === 0) throw new Error('expenses_export_failed');
          break;
        }
        const { items, cursor: nextCursor, has_more } = extractExpensesPage(res.data);
        allRows.push(...items);
        pageCount += 1;
        if (!has_more || !nextCursor) break;
        if (pageCount >= MAX_EXPORT_PAGES) { truncated = true; break; }
        exportCursor = nextCursor;
      }

      // Apply the same on-screen date-range filter to the full result set.
      const rows = allRows.filter((item) => {
        if (!item.submitted_at) return true;
        const itemDate = new Date(item.submitted_at);
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
        t('volunteering.export_columns.amount'),
        t('volunteering.export_columns.currency'),
        t('volunteering.export_columns.type'),
        t('volunteering.export_columns.status'),
        t('volunteering.export_columns.submitted'),
        t('volunteering.export_columns.has_receipt'),
        t('volunteering.export_columns.payment_reference'),
      ];
      const exportRows = rows.map((item) => [
        item.volunteer_name || '',
        item.organization_name || '',
        toNum(item.amount).toLocaleString(getFormattingLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        item.currency || '',
        t(`volunteering.expense_type_${item.type}`, { defaultValue: t('volunteering.expense_type_unknown') }),
        t(`volunteering.status_${item.status}`, { defaultValue: t('volunteering.status_unknown') }),
        item.submitted_at ? new Date(item.submitted_at).toLocaleDateString(getFormattingLocale()) : '',
        item.has_receipt ? t('volunteering.yes') : t('volunteering.no'),
        item.payment_reference || '',
      ]);
      buildCsv(headers, exportRows, `volunteer-expenses-${new Date().toISOString().split('T')[0]}.csv`);

      if (truncated) {
        toast.warning(t('volunteering.export_truncated', { count: MAX_EXPORT_PAGES }));
      }
    } catch {
      toast.error(t('volunteering.export_failed'));
    }
    setExporting(false);
  };

  const openPolicyEdit = (policy: ExpensePolicy) => {
    setEditingPolicy(policy);
    setPolicyForm({
      max_amount: String(policy.max_amount),
      max_monthly: String(policy.max_monthly),
      requires_receipt_above: String(policy.requires_receipt_above),
      requires_approval: policy.requires_approval,
    });
    setPolicyModal(true);
  };

  const handlePolicySave = async () => {
    if (!editingPolicy) return;
    setActionLoading(true);
    try {
      const res = await adminVolunteering.updateExpensePolicies({
        id: editingPolicy.id,
        expense_type: editingPolicy.expense_type ?? editingPolicy.type,
        max_amount: Number(policyForm.max_amount),
        max_monthly: Number(policyForm.max_monthly),
        requires_receipt_above: Number(policyForm.requires_receipt_above),
        requires_approval: policyForm.requires_approval,
      });
      if (res.success) {
        toast.success(t('volunteering.policy_updated'));
        setPolicyModal(false);
        loadPolicies();
      } else {
        toast.error(t('volunteering.failed_to_update_policy'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_update_policy'));
    }
    setActionLoading(false);
  };

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: Column<Expense>[] = [
    {
      key: 'volunteer_name',
      label: t('volunteering.col_volunteer'),
      sortable: true,
    },
    {
      key: 'organization_name',
      label: t('volunteering.col_organization'),
      sortable: true,
    },
    {
      key: 'amount',
      label: t('volunteering.col_amount'),
      sortable: true,
      render: (item) => (
        <span className="font-semibold">
          {formatExpenseAmount(item.amount, item.currency)}
        </span>
      ),
    },
    {
      key: 'type',
      label: t('volunteering.col_type'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft">
          {t(`volunteering.expense_type_${item.type}`)}
        </Chip>
      ),
    },
    {
      key: 'status',
      label: t('volunteering.col_status'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" color={STATUS_COLORS[item.status] || 'default'} variant="soft">
          {t(`volunteering.status_${item.status}`)}
        </Chip>
      ),
    },
    {
      key: 'submitted_at',
      label: t('volunteering.col_submitted'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.submitted_at ? new Date(item.submitted_at).toLocaleDateString(getFormattingLocale()) : '--'}
        </span>
      ),
    },
    {
      key: 'has_receipt',
      label: t('volunteering.col_receipt'),
      render: (item) =>
        item.has_receipt ? (
          <div className="flex items-center gap-1.5">
            <Chip size="sm" color="success" variant="soft" startContent={<FileText aria-hidden="true" size={12} />}>
              {t('volunteering.yes')}
            </Chip>
            {item.receipt_path && (
              <Button
                size="sm"
                variant="tertiary"
                startContent={item.receipt_path.toLowerCase().endsWith('.pdf') ? <ExternalLink aria-hidden="true" size={12} /> : <Eye aria-hidden="true" size={12} />}
                onPress={() => openReceipt(item)}
                className="min-w-0 px-2"
              >
                {t('volunteering.view_receipt')}
              </Button>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted/80">{t('volunteering.no')}</span>
        ),
    },
    {
      key: 'actions',
      label: t('volunteering.col_actions'),
      render: (item) =>
        (ALLOWED_ACTIONS[item.status]?.length ?? 0) > 0 ? (
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => openReview(item)}
          >
            {t('volunteering.review')}
          </Button>
        ) : item.status === 'approved' ? (
          <span className="text-xs text-muted">{t('volunteering.expense_paid_by_org_hint')}</span>
        ) : null,
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.expenses_title')}
        description={t('volunteering.expenses_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="tertiary"
              startContent={<Download aria-hidden="true" size={16} />}
              onPress={handleExport}
              isLoading={exporting}
            >
              {t('volunteering.export_csv')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw aria-hidden="true" size={16} />}
              onPress={() => loadData()}
              isLoading={loading}
            >
              {t('volunteering.refresh')}
            </Button>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('volunteering.stat_total_submitted')}
          value={stats?.total_submitted ?? 0}
          icon={FileText}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_pending_review')}
          value={stats?.pending_review ?? 0}
          icon={Clock}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_approved_total')}
          value={stats?.approved_total ?? 0}
          icon={CheckCircle}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_paid_total')}
          value={stats?.paid_total ?? 0}
          icon={CreditCard}
          color="default"
          loading={loading}
        />
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03]">
        <Input
          type="date"
          label={t('volunteering.date_from')}
          size="sm"
          className="w-44"
          value={dateFrom}
          onValueChange={setDateFrom}
          startContent={<CalendarRange aria-hidden="true" size={14} className="text-muted" />}
        />
        <Input
          type="date"
          label={t('volunteering.date_to')}
          size="sm"
          className="w-44"
          value={dateTo}
          onValueChange={setDateTo}
          startContent={<CalendarRange aria-hidden="true" size={14} className="text-muted" />}
        />
        {(dateFrom || dateTo) && (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => { setDateFrom(''); setDateTo(''); }}
          >
            {t('volunteering.clear_dates')}
          </Button>
        )}
        {hasMore && (
          <p className="w-full text-xs text-muted">
            {t('volunteering.export_partial_note')}
          </p>
        )}
      </div>

      {/* Expenses Table */}
      {!loading && filteredExpenses.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title={t('volunteering.no_expenses')}
          description={t('volunteering.no_expenses_desc')}
        />
      ) : (
        <>
          <DataTable columns={columns} data={filteredExpenses} isLoading={loading} onRefresh={() => loadData()} />
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="tertiary"
                onPress={loadMore}
                isLoading={loadingMore}
              >
                {t('volunteering.load_more')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Per-org expense breakdown */}
      {orgBreakdown.length > 0 && (
        <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 aria-hidden="true" size={18} />
              <span className="font-semibold">
                {t('volunteering.expense_org_breakdown_title')}
              </span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <Table
                aria-label={t('volunteering.expense_org_breakdown_title')}
                removeWrapper
              >
                <TableHeader>
                  <TableColumn>{t('volunteering.col_organization')}</TableColumn>
                  <TableColumn className="text-right">{t('volunteering.col_claims')}</TableColumn>
                  <TableColumn className="text-right">{t('volunteering.col_pending_amount')}</TableColumn>
                  <TableColumn className="text-right">{t('volunteering.col_approved_amount')}</TableColumn>
                  <TableColumn className="text-right">{t('volunteering.col_total_amount')}</TableColumn>
                </TableHeader>
                <TableBody>
                  {orgBreakdown.map((org) => (
                    <TableRow key={org.name}>
                      <TableCell>
                        <span className="font-medium">{org.name}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(org.count)}</TableCell>
                      <TableCell className="text-right font-mono text-warning">
                        {org.pending > 0 ? formatNumber(org.pending, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-success">
                        {org.approved > 0 ? formatNumber(org.approved, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatNumber(org.total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Expense Policies (collapsible) */}
      <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings aria-hidden="true" size={18} />
            <span className="font-semibold">
              {t('volunteering.expense_policies_title')}
            </span>
          </div>
        </CardHeader>
        <CardBody>
          {policiesLoading ? (
            <p className="text-muted/80 text-sm">{t('volunteering.loading')}</p>
          ) : policies.length === 0 ? (
            <p className="text-muted/80 text-sm">
              {t('volunteering.no_policies')}
            </p>
          ) : (
            <Accordion variant="splitted">
              {policies.map((policy) => (
                <AccordionItem
                  key={policy.type} id={policy.type}
                  title={
                    <span className="font-medium">
                      {t(`volunteering.expense_type_${policy.type}`)}
                    </span>
                  }
                >
                  <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <span className="text-muted/80">
                        {t('volunteering.policy_max_amount')}:
                      </span>{' '}
                      <span className="font-medium">{policy.max_amount}</span>
                    </div>
                    <div>
                      <span className="text-muted/80">
                        {t('volunteering.policy_max_monthly')}:
                      </span>{' '}
                      <span className="font-medium">{policy.max_monthly}</span>
                    </div>
                    <div>
                      <span className="text-muted/80">
                        {t('volunteering.policy_receipt_threshold')}:
                      </span>{' '}
                      <span className="font-medium">{policy.requires_receipt_above}</span>
                    </div>
                    <div>
                      <span className="text-muted/80">
                        {t('volunteering.policy_requires_approval')}:
                      </span>{' '}
                      <span className="font-medium">
                        {policy.requires_approval ? t('volunteering.yes') : t('volunteering.no')}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => openPolicyEdit(policy)}
                  >
                    {t('volunteering.edit')}
                  </Button>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardBody>
      </Card>

      {/* Review Modal */}
      <Modal isOpen={reviewModal} onClose={() => setReviewModal(false)} size="lg">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.review_expense')}
          </ModalHeader>
          <ModalBody>
            {reviewExpense && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted/80">{t('volunteering.col_volunteer')}:</span>
                    <p className="font-medium">{reviewExpense.volunteer_name}</p>
                  </div>
                  <div>
                    <span className="text-muted/80">{t('volunteering.col_organization')}:</span>
                    <p className="font-medium">{reviewExpense.organization_name}</p>
                  </div>
                  <div>
                    <span className="text-muted/80">{t('volunteering.col_amount')}:</span>
                    <p className="font-semibold">{formatExpenseAmount(reviewExpense.amount, reviewExpense.currency)}</p>
                  </div>
                  <div>
                    <span className="text-muted/80">{t('volunteering.col_type')}:</span>
                    <p className="font-medium">{t(`volunteering.expense_type_${reviewExpense.type}`)}</p>
                  </div>
                </div>

                {reviewExpense.description && (
                  <div>
                    <span className="text-muted/80 text-sm">{t('volunteering.description')}:</span>
                    <p className="text-sm">{reviewExpense.description}</p>
                  </div>
                )}

                <Select
                  label={t('volunteering.action')}
                  selectedKeys={[reviewAction]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    setReviewAction(val as ReviewAction);
                  }}
                >
                  {ALLOWED_ACTIONS[reviewExpense.status].map((action) => (
                    <SelectItem key={action} id={action}>
                      {action === 'approved' && t('volunteering.approve')}
                      {action === 'rejected' && t('volunteering.reject')}
                    </SelectItem>
                  ))}
                </Select>

                <Textarea
                  label={t('volunteering.review_notes')}
                  placeholder={t('volunteering.review_notes_placeholder')}
                  value={reviewNotes}
                  onValueChange={setReviewNotes}
                />

              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setReviewModal(false)}>
              {t('volunteering.cancel')}
            </Button>
            <Button
              variant={reviewAction === 'rejected' ? 'danger' : 'primary'}
              onPress={handleReview}
              isLoading={actionLoading}
              startContent={
                reviewAction === 'rejected' ? <XCircle aria-hidden="true" size={16} /> :
                <CheckCircle aria-hidden="true" size={16} />
              }
            >
              {reviewAction === 'approved' && t('volunteering.approve')}
              {reviewAction === 'rejected' && t('volunteering.reject')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Receipt Preview Modal */}
      <Modal isOpen={receiptModal} onClose={closeReceiptModal} size="lg">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.receipt_preview')}
          </ModalHeader>
          <ModalBody>
            {receiptUrl && !receiptIsPdf && (
              <div className="flex justify-center">
                <img
                  src={receiptUrl}
                  alt={t('volunteering.receipt_image')}
                  className="max-h-[500px] object-contain rounded-lg"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,' + encodeURIComponent(
                      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#f4f4f5" width="200" height="200"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#a1a1aa" font-size="14">${t('volunteering.image_unavailable')}</text></svg>`
                    );
                  }}
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeReceiptModal}>
              {t('volunteering.close')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<ExternalLink aria-hidden="true" size={14} />}
              onPress={() => window.open(receiptUrl, '_blank')}
            >
              {t('volunteering.open_full_size')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Policy Edit Modal */}
      <Modal isOpen={policyModal} onClose={() => setPolicyModal(false)} size="md">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.edit_policy')} - {editingPolicy ? t(`volunteering.expense_type_${editingPolicy.type}`) : ''}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label={t('volunteering.policy_max_amount')}
                type="number"
                value={policyForm.max_amount}
                onValueChange={(v) => setPolicyForm({ ...policyForm, max_amount: v })}
              />
              <Input
                label={t('volunteering.policy_max_monthly')}
                type="number"
                value={policyForm.max_monthly}
                onValueChange={(v) => setPolicyForm({ ...policyForm, max_monthly: v })}
              />
              <Input
                label={t('volunteering.policy_receipt_threshold')}
                type="number"
                value={policyForm.requires_receipt_above}
                onValueChange={(v) => setPolicyForm({ ...policyForm, requires_receipt_above: v })}
              />
              <Select
                label={t('volunteering.policy_requires_approval')}
                selectedKeys={[policyForm.requires_approval ? 'yes' : 'no']}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  setPolicyForm({ ...policyForm, requires_approval: val === 'yes' });
                }}
              >
                <SelectItem key="yes" id="yes">{t('volunteering.yes')}</SelectItem>
                <SelectItem key="no" id="no">{t('volunteering.no')}</SelectItem>
              </Select>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setPolicyModal(false)}>
              {t('volunteering.cancel')}
            </Button>
            <Button onPress={handlePolicySave} isLoading={actionLoading}>
              {t('volunteering.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default VolunteerExpenses;
