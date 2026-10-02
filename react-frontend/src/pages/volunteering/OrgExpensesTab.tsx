// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgExpensesTab — the organisation's own review queue for volunteer expense
 * claims (organisation dashboard → Expenses).
 *
 * API: GET /v2/volunteering/organisations/{orgId}/expenses
 *      PUT /v2/volunteering/organisations/{orgId}/expenses/{expenseId}
 *      GET /v2/volunteering/organisations/{orgId}/expenses/{expenseId}/receipt
 *
 * Only the next steps the server accepts are offered (same rule as the admin
 * screen): pending → approve / reject, approved → mark as paid, rejected and
 * paid are final. A reviewer never sees actions on their own claim — the
 * server refuses those with 403.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import Receipt from 'lucide-react/icons/receipt';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import CreditCard from 'lucide-react/icons/credit-card';
import FileText from 'lucide-react/icons/file-text';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Info from 'lucide-react/icons/info';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { FilterChipGroup } from '@/components/ui/FilterChipGroup';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatCurrency, formatNumber, getFormattingLocale, resolveAvatarUrl } from '@/lib/helpers';
import { useTranslation } from 'react-i18next';

interface OrgExpensesTabProps {
  orgId: number;
}

type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid';
type ExpenseType = 'travel' | 'meals' | 'supplies' | 'equipment' | 'parking' | 'other';
type ReviewAction = 'approved' | 'rejected' | 'paid';
type StatusFilter = 'all' | ExpenseStatus;

interface OrgExpense {
  id: number;
  user_id: number;
  volunteer_name: string;
  avatar_url: string | null;
  organization_id: number;
  opportunity_id: number | null;
  expense_type: ExpenseType;
  amount: number | string;
  currency: string | null;
  description: string | null;
  status: ExpenseStatus;
  has_receipt: boolean;
  submitted_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_notes: string | null;
  paid_at: string | null;
  payment_reference: string | null;
}

interface OrgExpenseStats {
  total_submitted: number;
  pending_review: number;
  approved_total: number;
  paid_total: number;
}

interface OrgExpensesPayload {
  items?: OrgExpense[];
  stats?: OrgExpenseStats;
  cursor?: string | null;
  has_more?: boolean;
}

// The transitions the server accepts — anything else only earns a refusal.
const ALLOWED_ACTIONS: Record<ExpenseStatus, ReviewAction[]> = {
  pending: ['approved', 'rejected'],
  approved: ['paid'],
  rejected: [],
  paid: [],
};

const STATUS_COLOR: Record<ExpenseStatus, 'warning' | 'success' | 'danger' | 'accent'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paid: 'accent',
};

const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'approved', 'rejected', 'paid'];

/** DECIMAL columns arrive as strings ("12.00"); coerce before formatting. */
function toNum(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function formatAmount(value: unknown, currency?: string | null): string {
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

const formatDate = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

function OrgExpensesTab({ orgId }: OrgExpensesTabProps) {
  const toast = useToast();
  const { user } = useAuth();
  const { t } = useTranslation('volunteering');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [items, setItems] = useState<OrgExpense[]>([]);
  const [stats, setStats] = useState<OrgExpenseStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<Set<number>>(new Set());

  // Reject / mark-paid dialog
  const [dialog, setDialog] = useState<{ mode: 'rejected' | 'paid'; expense: OrgExpense } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const currentUserId = user?.id !== undefined && user?.id !== null ? Number(user.id) : null;

  const loadItems = useCallback(async (append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      // The endpoint returns { data: { items, stats, cursor, has_more } } and
      // api.get() unwraps one level, so response.data IS that object.
      const response = await api.get<OrgExpensesPayload>(
        `/v2/volunteering/organisations/${orgId}/expenses?${params}`,
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const payload = response.data;
        const rows = Array.isArray(payload.items) ? payload.items : [];
        if (append) {
          setItems((prev) => [...prev, ...rows]);
        } else {
          setItems(rows);
          setStats(payload.stats ?? null);
        }
        cursorRef.current = payload.cursor ?? null;
        setHasMore(Boolean(payload.has_more));
      } else if (!append) {
        toastRef.current.error(tRef.current('org_expenses.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load organisation expenses', err);
      if (!append) {
        toastRef.current.error(tRef.current('org_expenses.load_failed'));
      }
    } finally {
      // Don't clear the spinner if this request was superseded by a newer one.
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [orgId, statusFilter]);

  // Reload whenever the org or the status filter changes.
  useEffect(() => {
    cursorRef.current = null;
    loadItems();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadItems]);

  const submitReview = async (
    expense: OrgExpense,
    action: ReviewAction,
    extra?: { review_notes?: string; payment_reference?: string },
  ) => {
    setActionInFlight((prev) => new Set(prev).add(expense.id));

    try {
      const body: { status: ReviewAction; review_notes?: string; payment_reference?: string } = { status: action };
      if (extra?.review_notes?.trim()) body.review_notes = extra.review_notes.trim();
      if (action === 'paid' && extra?.payment_reference?.trim()) {
        body.payment_reference = extra.payment_reference.trim();
      }

      const response = await api.put<{ success: boolean }>(
        `/v2/volunteering/organisations/${orgId}/expenses/${expense.id}`,
        body,
      );

      if (response.success) {
        const successKey = action === 'approved'
          ? 'org_expenses.approved_toast'
          : action === 'rejected'
            ? 'org_expenses.rejected_toast'
            : 'org_expenses.paid_toast';
        toastRef.current.success(tRef.current(successKey));
        setDialog(null);
        loadItems();
      } else if (response.code === 'INVALID_STATE' || response.code === 'NOT_FOUND') {
        // Someone else moved this claim on since the list loaded: say so in the
        // reviewer's own language and show the list as it now stands.
        toastRef.current.error(tRef.current('org_expenses.already_handled'));
        setDialog(null);
        loadItems();
      } else if (response.code === 'FORBIDDEN') {
        toastRef.current.error(response.error ?? tRef.current('something_wrong'));
      } else {
        toastRef.current.error(tRef.current('something_wrong'));
      }
    } catch (err) {
      logError('Failed to review organisation expense', err);
      toastRef.current.error(tRef.current('something_wrong'));
    } finally {
      setActionInFlight((prev) => {
        const next = new Set(prev);
        next.delete(expense.id);
        return next;
      });
    }
  };

  const openReceipt = async (expense: OrgExpense) => {
    try {
      // Receipts live on a private disk — fetch the bytes through the
      // authenticated, org-scoped endpoint and open them via an object URL.
      const blob = await api.download(
        `/v2/volunteering/organisations/${orgId}/expenses/${expense.id}/receipt`,
      );
      const objectUrl = URL.createObjectURL(blob);
      const opened = window.open(objectUrl, '_blank');
      if (!opened) {
        // Pop-up blocked: fall back to saving the file.
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `receipt-${expense.id}`;
        a.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      logError('Failed to load expense receipt', err);
      toastRef.current.error(tRef.current('org_expenses.receipt_failed'));
    }
  };

  const openDialog = (mode: 'rejected' | 'paid', expense: OrgExpense) => {
    setReviewNotes('');
    setPaymentReference('');
    setDialog({ mode, expense });
  };

  const statsCurrency = items.find((i) => i.currency)?.currency ?? null;
  const filterOptions = STATUS_FILTERS.map((key) => ({
    key,
    label: key === 'all' ? t('org_expenses.filter_all') : t(`expenses.status.${key}`),
  }));

  const dialogExpense = dialog?.expense ?? null;
  const dialogInFlight = dialogExpense ? actionInFlight.has(dialogExpense.id) : false;

  return (
    <div className="space-y-4">
      <p className="text-sm text-theme-muted">{t('org_expenses.intro')}</p>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t('org_expenses.stat_total'), value: stats.total_submitted },
            { label: t('org_expenses.stat_pending'), value: stats.pending_review },
            { label: t('org_expenses.stat_approved'), value: stats.approved_total },
            { label: t('org_expenses.stat_paid'), value: stats.paid_total },
          ].map((s) => (
            <GlassCard key={s.label} className="p-3 text-center">
              <p className="text-lg font-bold text-theme-primary">{formatAmount(s.value, statsCurrency)}</p>
              <p className="text-xs text-theme-muted">{s.label}</p>
            </GlassCard>
          ))}
        </div>
      )}

      <FilterChipGroup
        ariaLabel={t('org_expenses.filter_label')}
        selected={statusFilter}
        options={filterOptions}
        onChange={(key) => setStatusFilter(key as StatusFilter)}
      />

      {isLoading ? (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex items-center justify-center py-16">
          <Spinner size="lg" color="accent" />
        </div>
      ) : items.length === 0 ? (
        <GlassCard className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30 flex items-center justify-center">
            <Receipt className="w-7 h-7 text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-theme-primary font-semibold text-lg">
            {t('org_expenses.empty_title')}
          </p>
          <p className="text-theme-muted text-sm max-w-xs">
            {statusFilter === 'pending' ? t('org_expenses.empty_pending_desc') : t('org_expenses.empty_desc')}
          </p>
        </GlassCard>
      ) : (
        <>
          {items.map((expense) => {
            const inFlight = actionInFlight.has(expense.id);
            const isOwnClaim = currentUserId !== null && Number(expense.user_id) === currentUserId;
            const actions = isOwnClaim ? [] : ALLOWED_ACTIONS[expense.status] ?? [];

            return (
              <div
                key={expense.id}
                data-testid={`org-expense-${expense.id}`}
                className="p-4 rounded-xl bg-theme-elevated border border-theme-default flex flex-col sm:flex-row sm:items-start gap-4 transition-all duration-200"
              >
                <Avatar
                  src={resolveAvatarUrl(expense.avatar_url) || undefined}
                  name={expense.volunteer_name}
                  size="md"
                  className="shrink-0"
                />

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-theme-primary">{expense.volunteer_name}</span>
                    <Chip size="sm" variant="soft" color={STATUS_COLOR[expense.status] ?? 'default'}>
                      {t(`expenses.status.${expense.status}`)}
                    </Chip>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xl font-bold text-theme-primary">
                      {formatAmount(expense.amount, expense.currency)}
                    </span>
                    <Chip size="sm" variant="soft" color="default">
                      {t(`expenses.types.${expense.expense_type}`)}
                    </Chip>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm text-theme-muted">
                    <span>{t('org_expenses.submitted_on', { date: formatDate(expense.submitted_at) })}</span>
                  </div>

                  {expense.description && (
                    <p className="text-sm text-theme-subtle line-clamp-3 mt-1">
                      {expense.description}
                    </p>
                  )}

                  {expense.review_notes && (
                    <p className="text-xs text-theme-muted italic">
                      {t('expenses.note_prefix')} {expense.review_notes}
                    </p>
                  )}

                  {expense.payment_reference && (
                    <p className="text-xs text-theme-muted">
                      {t('org_expenses.payment_reference_display', { reference: expense.payment_reference })}
                    </p>
                  )}

                  {isOwnClaim && ALLOWED_ACTIONS[expense.status].length > 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-theme-muted">
                      <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      {t('org_expenses.own_claim_note')}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 shrink-0 sm:flex-col">
                  {expense.has_receipt && (
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<FileText className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => openReceipt(expense)}
                      aria-label={t('org_expenses.view_receipt_aria', { name: expense.volunteer_name })}
                    >
                      {t('org_expenses.view_receipt')}
                    </Button>
                  )}
                  {actions.includes('approved') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-success-soft text-success hover:bg-success-soft/80"
                      isDisabled={inFlight}
                      isLoading={inFlight}
                      startContent={!inFlight ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : undefined}
                      onPress={() => submitReview(expense, 'approved')}
                      aria-label={t('org_expenses.approve_aria', { name: expense.volunteer_name })}
                    >
                      {t('org_expenses.approve')}
                    </Button>
                  )}
                  {actions.includes('rejected') && (
                    <Button
                      size="sm"
                      variant="danger-soft"
                      isDisabled={inFlight}
                      startContent={<XCircle className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => openDialog('rejected', expense)}
                      aria-label={t('org_expenses.reject_aria', { name: expense.volunteer_name })}
                    >
                      {t('org_expenses.reject')}
                    </Button>
                  )}
                  {actions.includes('paid') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={inFlight}
                      startContent={<CreditCard className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => openDialog('paid', expense)}
                      aria-label={t('org_expenses.mark_paid_aria', { name: expense.volunteer_name })}
                    >
                      {t('org_expenses.mark_paid')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="tertiary"
                isLoading={isLoadingMore}
                startContent={!isLoadingMore ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : undefined}
                onPress={() => loadItems(true)}
              >
                {t('load_more')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Reject / mark-paid dialog */}
      <Modal isOpen={dialog !== null} onClose={() => setDialog(null)} size="md">
        <ModalContent>
          <ModalHeader>
            {dialog?.mode === 'paid' ? t('org_expenses.paid_title') : t('org_expenses.reject_title')}
          </ModalHeader>
          <ModalBody>
            {dialogExpense && (
              <div className="space-y-4">
                <p className="text-sm text-theme-muted">
                  {t('org_expenses.dialog_summary', {
                    name: dialogExpense.volunteer_name,
                    amount: formatAmount(dialogExpense.amount, dialogExpense.currency),
                  })}
                </p>
                {dialog?.mode === 'paid' ? (
                  <>
                    <p className="text-sm text-theme-muted">{t('org_expenses.paid_intro')}</p>
                    <Input
                      label={t('org_expenses.payment_reference_label')}
                      placeholder={t('org_expenses.payment_reference_placeholder')}
                      value={paymentReference}
                      onValueChange={setPaymentReference}
                      variant="secondary"
                      maxLength={255}
                    />
                  </>
                ) : (
                  <Textarea
                    label={t('org_expenses.reject_notes_label')}
                    placeholder={t('org_expenses.reject_notes_placeholder')}
                    value={reviewNotes}
                    onValueChange={setReviewNotes}
                    variant="secondary"
                    minRows={2}
                    maxRows={5}
                  />
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setDialog(null)}>
              {t('expenses.cancel')}
            </Button>
            <Button
              variant={dialog?.mode === 'paid' ? 'primary' : 'danger'}
              isLoading={dialogInFlight}
              isDisabled={!dialogExpense}
              startContent={!dialogInFlight
                ? (dialog?.mode === 'paid'
                  ? <CreditCard className="w-4 h-4" aria-hidden="true" />
                  : <XCircle className="w-4 h-4" aria-hidden="true" />)
                : undefined}
              onPress={() => {
                if (!dialog) return;
                void submitReview(
                  dialog.expense,
                  dialog.mode,
                  dialog.mode === 'paid' ? { payment_reference: paymentReference } : { review_notes: reviewNotes },
                );
              }}
            >
              {dialog?.mode === 'paid' ? t('org_expenses.paid_confirm') : t('org_expenses.reject_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default OrgExpensesTab;
