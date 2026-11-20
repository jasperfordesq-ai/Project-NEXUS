// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RecordPaymentDialog
 * The platform team records a payment that did not come through Stripe (a bank
 * transfer, a cheque …) and the date the community is now paid up to. Below
 * the form, every payment already recorded by hand for that community.
 *
 * 🔴 The body and the history rows are the SERVER's shape
 * (POST /v2/admin/super/billing/standing/record-payment and
 * BillingStandingService::payments()). There is no mapping layer on purpose.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Spinner,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatDate, getFormattingLocale } from '@/lib/helpers';

export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const CURRENCIES = ['GBP', 'EUR'] as const;

/** One row of GET /v2/admin/super/billing/standing/payments */
interface ManualPayment {
  id: number;
  received_on: string;
  method: PaymentMethod;
  reference: string | null;
  /** The database's decimal as a string, e.g. "480.00". */
  amount: string | null;
  currency: string | null;
  paid_until_before: string | null;
  paid_until_after: string;
  recorded_by_user_id: number | null;
  recorded_by_name: string | null;
  created_at: string | null;
}

export interface RecordPaymentCommunity {
  id: number;
  name: string;
  paidUntil: string | null;
}

interface RecordPaymentDialogProps {
  /** null keeps the dialog closed. */
  community: RecordPaymentCommunity | null;
  onClose: () => void;
  /** Called after the server accepted the payment; the caller closes and reloads. */
  onRecorded: () => void;
}

/** Today in the browser's own calendar, as the date field writes it. */
function todayYmd(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatAmount(amount: string, currency: string | null): string {
  const value = Number(amount);
  if (!currency || Number.isNaN(value)) return amount;
  try {
    return new Intl.NumberFormat(getFormattingLocale(), { style: 'currency', currency }).format(value);
  } catch {
    // An unexpected currency code: show what was stored rather than nothing.
    return `${amount} ${currency}`;
  }
}

export function RecordPaymentDialog({ community, onClose, onRecorded }: RecordPaymentDialogProps) {
  const { t } = useTranslation('admin_billing');
  const toast = useToast();

  const [receivedOn, setReceivedOn] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [paidUntil, setPaidUntil] = useState('');
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<ManualPayment[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  const communityId = community?.id ?? null;
  const communityPaidUntil = community?.paidUntil ?? null;

  const loadHistory = useCallback(async (tenantId: number) => {
    setHistory(null);
    setHistoryFailed(false);
    const response = await api.get<ManualPayment[]>(`/v2/admin/super/billing/standing/payments?tenant_id=${tenantId}`);
    if (response.success && Array.isArray(response.data)) {
      setHistory(response.data);
    } else {
      setHistoryFailed(true);
    }
  }, []);

  // A fresh form each time the dialog opens on a community.
  useEffect(() => {
    if (communityId === null) return;
    setReceivedOn(todayYmd());
    setMethod('bank_transfer');
    setReference('');
    setAmount('');
    setCurrency('');
    // Left empty on purpose. Prefilled with the current date it was sent back
    // unchanged, and a payment that does not move the date changes nothing.
    setPaidUntil('');
    void loadHistory(communityId);
  }, [communityId, loadHistory]);

  const hasAmount = amount.trim() !== '';
  // What the server accepts: up to ten digits and at most two decimals. A
  // number field also lets "1e400" through, which reads as Infinity and would
  // be sent as "no amount" without a word.
  const amountInvalid = hasAmount && !/^\d{1,10}(\.\d{1,2})?$/.test(amount.trim());
  const currencyMissing = hasAmount && !amountInvalid && currency === '';
  // Y-m-d strings sort as dates. The server refuses a date that is not later.
  const notLater = communityPaidUntil !== null && paidUntil.trim() !== '' && paidUntil.trim() <= communityPaidUntil;
  const canSave = receivedOn.trim() !== '' && paidUntil.trim() !== '' && !notLater && !amountInvalid && !currencyMissing && !saving;

  const save = async () => {
    if (!community || !canSave) return;
    setSaving(true);
    const trimmedReference = reference.trim();
    const response = await api.post('/v2/admin/super/billing/standing/record-payment', {
      tenant_id: community.id,
      paid_until: paidUntil.trim(),
      received_on: receivedOn.trim(),
      method,
      reference: trimmedReference === '' ? null : trimmedReference,
      amount: hasAmount ? Number(amount) : null,
      currency: hasAmount ? currency : null,
    });
    setSaving(false);

    if (response.success) {
      toast.success(t('control.done_payment_recorded'));
      onRecorded();
      return;
    }

    // The server names the rule that was broken, in the reader's language.
    toast.error(response.error || t('billing.standing_failed'));
  };

  return (
    <Modal isOpen={community !== null} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>
          {t('control.record_payment')}
          {community && (
            <span className="text-muted text-sm font-normal ml-2">
              — {community.name}
            </span>
          )}
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">{t('control.record_payment_help')}</p>

            <Input
              label={t('control.received_on_label')}
              type="date"
              value={receivedOn}
              onValueChange={setReceivedOn}
              isRequired
            />

            <RadioGroup
              label={t('control.method_label')}
              orientation="horizontal"
              value={method}
              onValueChange={(value) => {
                const found = PAYMENT_METHODS.find((m) => m === value);
                if (found) setMethod(found);
              }}
            >
              {PAYMENT_METHODS.map((m) => (
                <Radio key={m} value={m}>{t(`control.method_${m}`)}</Radio>
              ))}
            </RadioGroup>

            <Input
              label={t('control.reference_label')}
              value={reference}
              onValueChange={setReference}
              maxLength={190}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('control.amount_label')}
                // A text field on purpose: a number field hands back an empty
                // value for anything it cannot read ("1e400"), so a mistyped
                // amount would be dropped without a word.
                type="text"
                inputMode="decimal"
                isInvalid={amountInvalid}
                value={amount}
                onValueChange={setAmount}
              />
              <RadioGroup
                label={t('control.currency_label')}
                orientation="horizontal"
                value={currency}
                onValueChange={setCurrency}
                isInvalid={currencyMissing}
              >
                {CURRENCIES.map((code) => (
                  <Radio key={code} value={code}>{code}</Radio>
                ))}
              </RadioGroup>
            </div>
            {amountInvalid ? (
              <p role="alert" className="text-sm text-danger">{t('control.amount_invalid')}</p>
            ) : null}
            {currencyMissing ? (
              <p role="alert" className="text-sm text-danger">{t('control.currency_required')}</p>
            ) : null}

            <Input
              label={t('control.payment_paid_until_label')}
              type="date"
              value={paidUntil}
              onValueChange={setPaidUntil}
              isRequired
              isInvalid={notLater}
              description={communityPaidUntil
                ? t('control.currently_paid_until', { date: formatDate(communityPaidUntil) })
                : undefined}
            />

            <section className="flex flex-col gap-2" aria-labelledby="record-payment-history-title">
              <h3 id="record-payment-history-title" className="text-sm font-semibold">
                {t('control.history_title')}
              </h3>
              {historyFailed ? (
                <p role="alert" className="text-sm text-danger">{t('control.history_failed')}</p>
              ) : history === null ? (
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-2">
                  <Spinner size="sm" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted">{t('control.history_empty')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {history.map((payment) => (
                    <li key={payment.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid-cols-6">
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_received_on')}</span>
                        <span>{formatDate(payment.received_on)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_method')}</span>
                        <span>{t(`control.method_${payment.method}`)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_reference')}</span>
                        <span className="break-all">{payment.reference ?? '—'}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_amount')}</span>
                        <span>{payment.amount !== null ? formatAmount(payment.amount, payment.currency) : '—'}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_paid_until')}</span>
                        <span>{formatDate(payment.paid_until_after)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_recorded_by')}</span>
                        <span>{payment.recorded_by_name ?? '—'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
            {t('billing.cancel')}
          </Button>
          <Button onPress={() => void save()} isLoading={saving} isDisabled={!canSave}>
            {t('control.record_payment_save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default RecordPaymentDialog;
