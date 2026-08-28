// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Receipt from 'lucide-react/icons/receipt';
import CreditCard from 'lucide-react/icons/credit-card';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import { PageMeta } from '@/components/seo/PageMeta';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
const StripeCheckoutModal = lazy(() =>
  import('@/components/marketplace/StripeCheckoutModal').then((module) => ({ default: module.StripeCheckoutModal }))
);

/**
 * MyVereinDuesPage — AG54
 *
 * Member-facing page that lists every Verein membership-dues row across all
 * the user's Vereine, with a "Pay now" button that opens an embedded Stripe
 * payment modal.
 *
 * API:
 *   GET  /api/v2/me/verein-dues
 *   POST /api/v2/me/verein-dues/{id}/pay
 */


interface DuesRow {
  id: number;
  organization_id: number;
  organization_name: string | null;
  membership_year: number;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'paid' | 'overdue' | 'waived' | 'refunded' | string;
  due_date: string | null;
  paid_at: string | null;
  stripe_payment_intent_id: string | null;
}

interface ListResponse {
  items: DuesRow[];
  total: number;
}

interface PayResponse {
  client_secret: string;
  payment_intent_id: string;
  public_key: string;
}

function statusColor(status: string): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'paid' || status === 'waived') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'overdue') return 'danger';
  return 'default';
}

const formatAmount = (cents: number, currency: string) =>
  new Intl.NumberFormat(getFormattingLocale(), { style: 'currency', currency: currency || 'CHF' }).format(cents / 100);

export function MyVereinDuesPage() {
  const { t } = useTranslation('common');
  usePageTitle(t('verein_dues.my_page_title'));
  const toast = useToast();

  const [rows, setRows] = useState<DuesRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activePayDuesId, setActivePayDuesId] = useState<number | null>(null);
  // Guards against double-clicking "Pay now": a second POST while the first is
  // in flight can surface a spurious error toast mid-payment.
  const [payingDuesId, setPayingDuesId] = useState<number | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payCurrency, setPayCurrency] = useState<string>('CHF');
  const [payTitle, setPayTitle] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.get<ListResponse>('/v2/me/verein-dues');
      if (res.success && res.data) {
        setRows(Array.isArray(res.data.items) ? res.data.items : []);
      } else {
        setError(t('verein_dues.errors.load_failed'));
      }
    } catch (err) {
      logError('MyVereinDuesPage load failed', err);
      setError(t('verein_dues.errors.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const onPayClick = useCallback(async (row: DuesRow) => {
    if (payingDuesId !== null) return;
    setPayingDuesId(row.id);
    try {
      const res = await api.post<PayResponse>(`/v2/me/verein-dues/${row.id}/pay`, {});
      if (res.success && res.data?.client_secret) {
        setActivePayDuesId(row.id);
        setClientSecret(res.data.client_secret);
        setPayAmount(row.amount_cents / 100);
        setPayCurrency(row.currency);
        setPayTitle(`${row.organization_name ?? ''} — ${row.membership_year}`);
      } else {
        toast.error(t('verein_dues.errors.start_payment_failed'));
      }
    } catch (err) {
      logError('MyVereinDuesPage pay failed', err);
      toast.error(t('verein_dues.errors.start_payment_failed'));
    } finally {
      setPayingDuesId(null);
    }
  }, [payingDuesId, toast, t]);

  const onPaymentSuccess = useCallback(() => {
    toast.success(t('verein_dues.payment_success'));
    setActivePayDuesId(null);
    setClientSecret(null);
    void load();
  }, [load, toast, t]);

  const onPaymentClose = useCallback(() => {
    setActivePayDuesId(null);
    setClientSecret(null);
  }, []);

  return (
    <>
      <PageMeta title={t('verein_dues.my_page_title')} noIndex />
      <div className="container max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Receipt className="w-7 h-7 text-accent" />
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            {t('verein_dues.my_page_heading')}
          </h1>
          <p className="text-sm text-muted">
            {t('verein_dues.my_page_subtitle')}
          </p>
        </div>
      </div>

      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-10"><Spinner size="lg" color="primary" /></div>
      )}

      {error && !isLoading && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-danger-50 text-danger text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <Card><CardBody className="text-center py-10 text-muted">
          {t('verein_dues.empty_state')}
        </CardBody></Card>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const isPayable = row.status === 'pending' || row.status === 'overdue';
          return (
            <Card key={row.id}>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="font-semibold text-foreground">
                      {row.organization_name ?? t('verein_dues.unnamed_verein')}
                    </div>
                    <div className="text-xs text-muted">
                      {t('verein_dues.year_label')} {row.membership_year}
                    </div>
                  </div>
                </div>
                <Chip color={statusColor(row.status)} variant="flat" size="sm">
                  {t(`verein_dues.status.${row.status}`, row.status)}
                </Chip>
              </CardHeader>
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{formatAmount(row.amount_cents, row.currency)}</div>
                  {row.due_date && row.status !== 'paid' && (
                    <div className="text-xs text-muted">
                      {t('verein_dues.due_label')} {row.due_date}
                    </div>
                  )}
                  {row.paid_at && (
                    <div className="text-xs text-success flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {t('verein_dues.paid_label')} {new Date(row.paid_at).toLocaleDateString(getFormattingLocale())}
                    </div>
                  )}
                </div>
                {isPayable && (
                  <Button
                    startContent={<CreditCard className="w-4 h-4" />}
                    isLoading={payingDuesId === row.id}
                    isDisabled={payingDuesId !== null}
                    onPress={() => onPayClick(row)}
                  >
                    {t('verein_dues.cta_pay_now')}
                  </Button>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {activePayDuesId !== null && clientSecret && (
        <Suspense fallback={null}>
          <StripeCheckoutModal
            isOpen={true}
            clientSecret={clientSecret}
            amount={payAmount}
            currency={payCurrency}
            listingTitle={payTitle}
            onSuccess={onPaymentSuccess}
            onClose={onPaymentClose}
          />
        </Suspense>
      )}
      </div>
    </>
  );
}

export default MyVereinDuesPage;
