// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Donation Refunds
 *
 * Lists every donation for the tenant and lets admins issue full Stripe
 * refunds for completed donations. Refunds mark the donation 'refunded'
 * and decrement the linked giving day's raised total on the backend.
 *
 * Backend:
 *   GET  /v2/admin/volunteering/donations  ({items: donation rows})
 *   POST /v2/admin/donations/{id}/refund   (Stripe full refund)
 */

import { formatCurrency, formatNumber, getFormattingLocale } from '@/lib/helpers';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import HandCoins from 'lucide-react/icons/hand-coins';
import Undo2 from 'lucide-react/icons/undo-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Heart from 'lucide-react/icons/heart';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';

import { Button, Card, CardBody, Chip, Tabs, Tab } from '@/components/ui';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminDonations, type AdminDonation } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { StatCard } from '../../components/StatCard';

const STATUS_FILTERS = ['all', 'completed', 'pending', 'refunded', 'failed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'secondary' | 'danger' | 'default'> = {
  completed: 'success',
  pending: 'warning',
  refunded: 'secondary',
  failed: 'danger',
};

const ROUTE_COLORS: Record<string, 'success' | 'warning' | 'default'> = {
  tenant_connect: 'success',
  platform_default: 'warning',
};

function formatAmount(amount: number | string, currency: string | null): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(value)) return String(amount);
  if (!currency) {
    return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const code = currency.toUpperCase();
  try {
    return formatCurrency(value, code);
  } catch {
    return `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DonationRefunds() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('donation_refunds.page_title'));
  useAdminPageMeta({ title: t('donation_refunds.page_title') });
  const toast = useToast();

  const [donations, setDonations] = useState<AdminDonation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Refund confirm state
  const [refundTarget, setRefundTarget] = useState<AdminDonation | null>(null);
  const [refunding, setRefunding] = useState(false);

  // Mark-completed confirm state (offline donations only)
  const [completeTarget, setCompleteTarget] = useState<AdminDonation | null>(null);
  const [completing, setCompleting] = useState(false);

  // ─── Data loading ───

  const loadDonations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminDonations.list();
      if (res.success && Array.isArray(res.data?.items)) {
        setDonations(res.data.items);
      } else if (res.success) {
        setDonations([]);
      } else {
        setLoadError(t('donation_refunds.load_failed'));
        toast.error(t('donation_refunds.load_failed'));
      }
    } catch {
      setLoadError(t('donation_refunds.load_failed'));
      toast.error(t('donation_refunds.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadDonations();
  }, [loadDonations]);

  // ─── Derived stats ───

  const stats = useMemo(() => {
    let completedTotal = 0;
    let refundedTotal = 0;
    let completedCount = 0;
    for (const d of donations) {
      const value = typeof d.amount === 'string' ? parseFloat(d.amount) : d.amount;
      if (Number.isNaN(value)) continue;
      if (d.status === 'completed') {
        completedTotal += value;
        completedCount += 1;
      } else if (d.status === 'refunded') {
        refundedTotal += value;
      }
    }
    return { completedTotal, refundedTotal, completedCount };
  }, [donations]);

  const primaryCurrency = useMemo(
    () => donations.find((d) => d.currency)?.currency ?? null,
    [donations],
  );

  const filtered = useMemo(
    () => (statusFilter === 'all' ? donations : donations.filter((d) => d.status === statusFilter)),
    [donations, statusFilter],
  );

  // ─── Refund ───

  const handleRefund = async () => {
    if (!refundTarget) return;
    setRefunding(true);

    const res = await adminDonations.refund(refundTarget.id);
    if (res.success) {
      toast.success(
        t('donation_refunds.refund_success', { refundId: res.data?.refund_id ?? '' }),
      );
      setRefundTarget(null);
      loadDonations();
    } else {
      // Keep the dialog target so the admin can retry or cancel deliberately.
      toast.error(t('donation_refunds.refund_failed'));
    }

    setRefunding(false);
  };

  // ─── Mark completed ───

  const handleComplete = async () => {
    if (!completeTarget) return;
    setCompleting(true);

    const res = await adminDonations.complete(completeTarget.id);
    if (res.success) {
      toast.success(t('donation_refunds.complete_success'));
      setCompleteTarget(null);
      loadDonations();
    } else {
      // Keep the dialog target so the admin can retry or cancel deliberately.
      toast.error(t('donation_refunds.complete_failed'));
    }

    setCompleting(false);
  };

  // ─── Table columns ───

  const statusLabel = (status: string) =>
    t(`donation_refunds.status_${status}`, { defaultValue: t('donation_refunds.status_unknown') });
  const routeLabel = (route?: string | null) =>
    t(`donation_refunds.route_${route || 'platform_default'}`, { defaultValue: t('donation_refunds.route_unknown') });
  const paymentMethodLabel = (method?: string | null) => method
    ? t(`donation_refunds.payment_method_${method}`, { defaultValue: t('donation_refunds.payment_method_unknown') })
    : t('donation_refunds.payment_method_unknown');

  const columns: Column<AdminDonation>[] = [
    {
      key: 'id',
      label: t('donation_refunds.donation'),
      sortable: true,
      isRowHeader: true,
      render: (d) => <span className="font-mono text-sm text-foreground">#{d.id}</span>,
    },
    {
      key: 'user_id',
      label: t('donation_refunds.donor'),
      render: (d) => (
        <span className="text-sm text-foreground">
          {d.is_anonymous
            ? t('donation_refunds.anonymous')
            : d.donor_name
              ? d.donor_name
              : d.user_id
              ? t('donation_refunds.user_number', { id: d.user_id })
              : t('donation_refunds.guest')}
        </span>
      ),
    },
    {
      key: 'amount',
      label: t('donation_refunds.amount'),
      sortable: true,
      render: (d) => (
        <span className="font-semibold text-foreground">{formatAmount(d.amount, d.currency)}</span>
      ),
    },
    {
      key: 'payment_method',
      label: t('donation_refunds.payment_method'),
      render: (d) => <span className="text-sm text-muted">{paymentMethodLabel(d.payment_method)}</span>,
    },
    {
      key: 'payment_route',
      label: t('donation_refunds.payment_route'),
      render: (d) => (
        <Chip size="sm" variant="soft" color={ROUTE_COLORS[d.payment_route || 'platform_default'] || 'default'}>
          {routeLabel(d.payment_route)}
        </Chip>
      ),
    },
    {
      key: 'stripe_account_id',
      label: t('donation_refunds.stripe_account'),
      render: (d) => (
        <span className="font-mono text-xs text-muted">
          {d.stripe_account_id || t('donation_refunds.platform_account')}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('donation_refunds.status'),
      sortable: true,
      render: (d) => (
        <Chip size="sm" variant="soft" color={STATUS_COLORS[d.status] || 'default'}>
          {statusLabel(d.status)}
        </Chip>
      ),
    },
    {
      key: 'created_at',
      label: t('donation_refunds.date'),
      sortable: true,
      render: (d) => <span className="text-sm text-muted">{formatDate(d.created_at)}</span>,
    },
    {
      key: 'actions',
      label: t('common.actions'),
      render: (d) =>
        d.status === 'completed' ? (
          <Button
            size="sm"
            variant="secondary"
            startContent={<Undo2 size={14} />}
            onPress={() => setRefundTarget(d)}
          >
            {t('donation_refunds.refund')}
          </Button>
        ) : d.status === 'pending' && d.payment_method !== 'stripe' ? (
          <Button
            size="sm"
            variant="secondary"
            startContent={<CheckCircle2 size={14} />}
            onPress={() => setCompleteTarget(d)}
          >
            {t('donation_refunds.mark_completed')}
          </Button>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
  ];

  // ─── Render ───

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('donation_refunds.page_title')}
        description={t('donation_refunds.description')}
        icon={<HandCoins size={22} />}
        actions={
          <Button
            size="sm"
            variant="secondary"
            startContent={<RefreshCw size={14} />}
            onPress={loadDonations}
            isDisabled={loading}
          >
            {t('common.refresh')}
          </Button>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={t('donation_refunds.total_donations')}
          value={donations.length.toLocaleString(getFormattingLocale())}
          icon={Heart}
          color="primary"
          loading={loading}
        />
        <StatCard
          label={t('donation_refunds.completed_total')}
          value={formatAmount(stats.completedTotal, primaryCurrency)}
          icon={CheckCircle2}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('donation_refunds.refunded_total')}
          value={formatAmount(stats.refundedTotal, primaryCurrency)}
          icon={RotateCcw}
          color="secondary"
          loading={loading}
        />
      </div>

      {/* Status filter */}
      <Tabs
        aria-label={t('donation_refunds.filter_status_aria')}
        selectedKey={statusFilter}
        onSelectionChange={(key) => setStatusFilter(key as StatusFilter)}
        variant="underlined"
        size="sm"
      >
        {STATUS_FILTERS.map((status) => (
          <Tab
            key={status}
            title={status === 'all' ? t('common.all') : statusLabel(status)}
          />
        ))}
      </Tabs>

      {loadError && !loading ? (
        <Card role="alert">
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle aria-hidden="true" size={32} className="text-danger" />
            <div className="text-base font-semibold">{t('common.error_loading_data')}</div>
            <div className="text-sm text-muted">{loadError}</div>
            <Button variant="tertiary" onPress={loadDonations}>{t('common.retry')}</Button>
          </CardBody>
        </Card>
      ) : filtered.length === 0 && !loading ? (
        <EmptyState
          icon={HandCoins}
          title={t('donation_refunds.empty_title')}
          description={t('donation_refunds.empty_description')}
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          isLoading={loading}
          searchPlaceholder={t('donation_refunds.search_placeholder')}
          onRefresh={loadDonations}
          emptyContent={t('donation_refunds.empty_title')}
        />
      )}

      {/* ─── Refund Confirmation ─── */}
      {refundTarget && (
        <ConfirmModal
          isOpen={!!refundTarget}
          onClose={() => {
            if (!refunding) setRefundTarget(null);
          }}
          onConfirm={handleRefund}
          title={t('donation_refunds.refund_title')}
          message={t('donation_refunds.refund_confirm', {
            amount: formatAmount(refundTarget.amount, refundTarget.currency),
            id: refundTarget.id,
          })}
          confirmLabel={t('donation_refunds.refund_confirm_label', {
            amount: formatAmount(refundTarget.amount, refundTarget.currency),
          })}
          cancelLabel={t('common.cancel')}
          confirmColor="danger"
          isLoading={refunding}
        />
      )}

      {/* ─── Mark Completed Confirmation ─── */}
      {completeTarget && (
        <ConfirmModal
          isOpen={!!completeTarget}
          onClose={() => {
            if (!completing) setCompleteTarget(null);
          }}
          onConfirm={handleComplete}
          title={t('donation_refunds.complete_title')}
          message={t('donation_refunds.complete_confirm', {
            amount: formatAmount(completeTarget.amount, completeTarget.currency),
            id: completeTarget.id,
          })}
          confirmLabel={t('donation_refunds.complete_confirm_label')}
          cancelLabel={t('common.cancel')}
          confirmColor="primary"
          isLoading={completing}
        />
      )}
    </div>
  );
}

export default DonationRefunds;
