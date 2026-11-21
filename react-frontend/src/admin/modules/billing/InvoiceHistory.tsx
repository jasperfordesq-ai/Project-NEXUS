// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * InvoiceHistory
 * Displays invoice list with view/download actions.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState, useCallback } from 'react';import Receipt from 'lucide-react/icons/receipt';
import ExternalLink from 'lucide-react/icons/external-link';
import Download from 'lucide-react/icons/download';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { billingApi, type Invoice } from '../../api/billingApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Button, Chip, Spinner } from '@/components/ui';

function invoiceStatusColor(status: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'paid':
      return 'success';
    case 'open':
      return 'warning';
    case 'void':
    case 'uncollectible':
      return 'danger';
    default:
      return 'default';
  }
}

// The server sends the amount in the currency's main unit and an upper-case
// code (StripeSubscriptionService::getInvoiceHistory()). A value that is not
// a number is shown as a dash, never as "NaN".
const formatAmount = (amount: number, currency: string) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'currency',
    currency: (currency || 'EUR').toUpperCase(),
    minimumFractionDigits: 2,
  }).format(value);
};

export function InvoiceHistory() {
  const { t } = useTranslation('admin_billing');
  usePageTitle(t('billing.view_invoices'));
  const toast = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await billingApi.getInvoices();
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setInvoices(data);
        } else if (data && typeof data === 'object') {
          const pd = data as { data?: Invoice[] };
          setInvoices(pd.data || []);
        }
      } else if (!res.success) {
        // A refused or failed request is not "no invoices": say so. The API
        // client answers "not successful" instead of throwing.
        // admin-i18n-ignore: localized server message — AdminBillingController invoices (lang/*/api.php)
        toast.error(res.error || t('billing.invoices_error'));
      }
    } catch {
      toast.error(t('billing.invoices_error'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      label: t('billing.invoice_number'),
      sortable: true,
      render: (item) => (
        <span className="font-medium">{item.number || item.id}</span>
      ),
    },
    {
      key: 'date',
      label: t('billing.invoice_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.date ? new Date(item.date).toLocaleDateString(getFormattingLocale()) : '--'}
        </span>
      ),
    },
    {
      key: 'amount',
      label: t('billing.invoice_amount'),
      sortable: true,
      render: (item) => (
        <span className="font-medium">{formatAmount(item.amount, item.currency)}</span>
      ),
    },
    {
      key: 'status',
      label: t('billing.invoice_status'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color={invoiceStatusColor(item.status)}>
          {t(`billing.invoice_status_${item.status}`, { defaultValue: t('billing.status_unknown') })}
        </Chip>
      ),
    },
    {
      key: 'id',
      label: t('billing.actions'),
      render: (item) => (
        <div className="flex gap-2">
          {item.hosted_invoice_url && (
            <Button
              size="sm"
              variant="tertiary"
              startContent={<ExternalLink className="w-3 h-3" />}
              onPress={() => window.open(item.hosted_invoice_url!, '_blank', 'noopener,noreferrer')}
            >
              {t('billing.invoice_view')}
            </Button>
          )}
          {item.invoice_pdf && (
            <Button
              size="sm"
              variant="tertiary"
              startContent={<Download className="w-3 h-3" />}
              onPress={() => window.open(item.invoice_pdf!, '_blank', 'noopener,noreferrer')}
            >
              {t('billing.invoice_download')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div>
        <PageHeader
          title={t('billing.view_invoices')}
          description={t('billing.invoices_description')}
        />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('billing.view_invoices')}
        description={t('billing.invoices_description')}
      />

      {invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t('billing.no_invoices')}
          description={t('billing.no_invoices_desc')}
        />
      ) : (
        <DataTable
          columns={columns}
          data={invoices}
          searchPlaceholder={t('billing.search_invoices')}
          onRefresh={loadInvoices}
        />
      )}
    </div>
  );
}

export default InvoiceHistory;
