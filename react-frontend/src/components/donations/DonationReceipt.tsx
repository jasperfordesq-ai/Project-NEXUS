import { Button, Card, CardBody, CardHeader, Chip, Spinner } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Printer from 'lucide-react/icons/printer';
import Receipt from 'lucide-react/icons/receipt';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { formatCurrency, formatDateValue } from '@/lib/helpers';
import { logError } from '@/lib/logger';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * DonationReceipt - Displays and prints a donation receipt
 *
 * Fetches receipt data from the API and renders it in a print-friendly
 * layout using HeroUI Card with @media print styles.
 */


/* ───────────────────────── Types ───────────────────────── */

/**
 * Mirrors StripeDonationService::getDonationReceipt(). Until 2026-10-05 this
 * declared `community_name` / `reference` / `id`, which the server never
 * sends, so every receipt showed a blank Community line and no reference.
 */
interface ReceiptData {
  donation_id: number;
  donor_name: string;
  amount: number | string;
  currency: string;
  date: string;
  tenant_name: string;
  organization_name?: string | null;
  giving_day_title?: string | null;
  message: string | null;
  status: string;
  payment_method: string;
  payment_reference: string | null;
}

/** Stored method keys -> the labels the Donations tab already uses. */
function methodLabelKey(method: string | null | undefined): string {
  if (method === 'stripe' || method === 'card') return 'donations.methods.card';
  if (method === 'bank_transfer' || method === 'paypal' || method === 'cash') return `donations.methods.${method}`;
  return 'donations.methods.other';
}

interface DonationReceiptProps {
  donationId: number;
}

/* ───────────────────────── Component ───────────────────────── */

const handlePrint = () => {
  window.print();
};

export function DonationReceipt({ donationId }: DonationReceiptProps) {
  const { t } = useTranslation('volunteering');
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReceipt = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<ReceiptData>(`/v2/donations/${donationId}/receipt`);

      if (response.success && response.data) {
        setReceipt(response.data);
      } else {
        setError(response.error || t('donations.receipt_error'));
      }
    } catch (err) {
      logError('Failed to fetch donation receipt', err);
      setError(t('donations.receipt_error'));
    } finally {
      setIsLoading(false);
    }
  }, [donationId, t]);

  useEffect(() => {
    void fetchReceipt();
  }, [fetchReceipt]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-busy="true" aria-label={t('common:loading')}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
        <p className="text-theme-muted mb-4">{error || t('donations.receipt_not_found')}</p>
        <Button
          variant="flat"
          startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
          onPress={() => { void fetchReceipt(); }}
        >
          {t('try_again')}
        </Button>
      </div>
    );
  }

  const formattedAmount = formatCurrency(Number(receipt.amount) || 0, receipt.currency);

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .donation-receipt, .donation-receipt * { visibility: visible; }
          .donation-receipt { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <Card className="donation-receipt max-w-lg mx-auto">
        <CardHeader className="flex items-center gap-2 pb-2">
          <Receipt className="w-5 h-5 text-theme-muted" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">
            {t('donations.receipt_title')}
          </h2>
        </CardHeader>

        <CardBody className="space-y-4">
          {/* Reference */}
          {receipt.payment_reference && (
            <div className="text-xs text-theme-subtle text-right break-all">
              {t('donations.receipt_ref', { ref: receipt.payment_reference })}
            </div>
          )}

          {/* Amount */}
          <div className="text-center py-4 border-b border-theme-default">
            <p className="text-3xl font-bold text-theme-primary">{formattedAmount}</p>
            <Chip
              size="sm"
              color={receipt.status === 'completed' ? 'success' : 'warning'}
              variant="flat"
              className="mt-2"
            >
              {t(`donations.status.${receipt.status}`)}
            </Chip>
          </div>

          {/* Details */}
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-theme-muted">{t('donations.receipt_donor')}</span>
              <span className="text-theme-primary font-medium">{receipt.donor_name}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-theme-muted">{t('donations.receipt_date')}</span>
              <span className="text-theme-primary">{formatDateValue(receipt.date)}</span>
            </div>

            {receipt.organization_name && (
              <div className="flex justify-between gap-4">
                <span className="text-theme-muted">{t('donations.receipt_organisation')}</span>
                <span className="text-theme-primary text-right">{receipt.organization_name}</span>
              </div>
            )}

            {receipt.giving_day_title && (
              <div className="flex justify-between gap-4">
                <span className="text-theme-muted">{t('donations.receipt_campaign')}</span>
                <span className="text-theme-primary text-right">{receipt.giving_day_title}</span>
              </div>
            )}

            <div className="flex justify-between gap-4">
              <span className="text-theme-muted">{t('donations.receipt_community')}</span>
              <span className="text-theme-primary text-right">{receipt.tenant_name}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-theme-muted">{t('donations.receipt_method')}</span>
              <span className="text-theme-primary text-right">{t(methodLabelKey(receipt.payment_method))}</span>
            </div>

            {receipt.message && (
              <div className="pt-2 border-t border-theme-default">
                <p className="text-theme-muted text-xs mb-1">{t('donations.receipt_message')}</p>
                <p className="text-theme-secondary italic">{receipt.message}</p>
              </div>
            )}
          </div>

          {/* Print button */}
          <div className="pt-4 no-print">
            <Button
              variant="flat"
              className="w-full"
              startContent={<Printer className="w-4 h-4" aria-hidden="true" />}
              onPress={handlePrint}
            >
              {t('donations.print_receipt')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

export default DonationReceipt;
