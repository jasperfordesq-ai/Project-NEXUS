// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RecordPaymentDialog
 * The platform team records a payment that did not come through Stripe (a bank
 * transfer, a cheque …) and the date the community is now paid up to. Below
 * the form, the community's payment history: every payment recorded by hand
 * and every card payment Stripe reported. A payment recorded by hand can be
 * voided from its row: it stays in the history, struck through, with the
 * reason, and the paid-until date may be set in the same step.
 *
 * A parent community's manager uses the same dialog from Branch payments
 * (`via="branch"`) for a community that pays it.
 *
 * 23 Nov 2026 (ease of use). The dialog does the arithmetic: two buttons offer
 * the paid-until date one month or one year on, and fill in the amount and
 * currency from the community's plan (still the person's to change). "Card" is
 * no longer offered: card payments arrive from Stripe by themselves. With
 * `mode="history"` the dialog shows the payment history alone, so past
 * payments can be looked at without opening a form for a new one.
 *
 * 🔴 The body and the history rows are the SERVER's shape
 * (POST /v2/admin/super/billing/standing/record-payment and
 * BillingStandingService::payments(); for a manager,
 * POST /v2/admin/super/branch-payments/{id}/record-payment and
 * BillingStandingService::paymentsPaidTo()). There is no mapping layer on
 * purpose.
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

/**
 * What a person may record. Not `card`: Stripe reports a card payment by
 * itself, and one typed in here would be counted twice. A card payment still
 * appears in the history under that name.
 */
export const RECORDABLE_METHODS = PAYMENT_METHODS.filter((m) => m !== 'card');

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
  /** `card` = Stripe reported it; `manual` = a person recorded it. */
  source: 'card' | 'manual';
  /** Who was paid: null = the platform, otherwise the parent community. */
  payee_tenant_id: number | null;
  payee_name: string | null;
  /** True when a platform team member recorded it. A hub's manager is then given no name. */
  recorded_by_platform_team: boolean;
  /** A voided payment stays in the list, struck through. */
  voided_at: string | null;
  voided_by_name: string | null;
  voided_by_platform_team: boolean;
  void_reason: string | null;
  /** False for a card payment (undone in Stripe) and for one already voided. */
  can_void: boolean;
  /** What Stripe says has been refunded of a card payment, in total; a decimal as a string. */
  refunded_amount: string | null;
  refunded_at: string | null;
  /** A dispute on a card payment: still open, ended with the payment standing, or lost. */
  dispute_state: 'open' | 'won' | 'lost' | null;
  disputed_at: string | null;
}

export interface RecordPaymentCommunity {
  id: number;
  name: string;
  paidUntil: string | null;
  /** What its plan costs, so the amount can be offered. Left out or null when it has no plan. */
  plan?: { monthly: number | null; yearly: number | null; currency: 'eur' | 'gbp' } | null;
}

interface RecordPaymentDialogProps {
  /** null keeps the dialog closed. */
  community: RecordPaymentCommunity | null;
  onClose: () => void;
  /** Called after the server accepted the payment; the caller closes and reloads. */
  onRecorded: () => void;
  /**
   * Whose endpoints are used. `platform` (the default): the platform team's,
   * for any community. `branch`: a parent community's manager's, for a
   * community that pays it (Branch payments); the server stores the payment
   * as paid to that parent and lists only the payments made to it.
   */
  via?: 'platform' | 'branch';
  /** With `via="branch"`: the community the payment is made to. */
  payeeName?: string | null;
  /**
   * Called after a payment was voided. The dialog stays open; the caller
   * reloads its list, because the paid-until date may have been set with it.
   */
  onVoided?: () => void;
  /** `history`: the payment history alone, with no form for a new payment. */
  mode?: 'record' | 'history';
}

/** The two endpoints for one community, by who is asking. */
function endpointsFor(via: 'platform' | 'branch', tenantId: number): { history: string; record: string; void: string } {
  return via === 'branch'
    ? {
        history: `/v2/admin/super/branch-payments/${tenantId}/payments`,
        record: `/v2/admin/super/branch-payments/${tenantId}/record-payment`,
        void: `/v2/admin/super/branch-payments/${tenantId}/void-payment`,
      }
    : {
        history: `/v2/admin/super/billing/standing/payments?tenant_id=${tenantId}`,
        record: '/v2/admin/super/billing/standing/record-payment',
        void: '/v2/admin/super/billing/standing/void-payment',
      };
}

/** What the server answers a void with: the community's standing afterwards. */
interface VoidAnswer {
  standing?: { paid_until?: string | null };
}

/** Today in the browser's own calendar, as the date field writes it. */
function todayYmd(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A Y-m-d date one month or one year later. A day that the later month does
 * not have (31 January + one month) becomes that month's last day, not a day
 * in the month after.
 */
export function laterDate(ymd: string, step: 'month' | 'year'): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  const months = step === 'year' ? 12 : 1;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
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

export function RecordPaymentDialog({ community, onClose, onRecorded, via = 'platform', payeeName = null, onVoided, mode = 'record' }: RecordPaymentDialogProps) {
  const { t } = useTranslation('admin_billing');
  const toast = useToast();

  const [receivedOn, setReceivedOn] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [paidUntil, setPaidUntil] = useState('');
  const [saving, setSaving] = useState(false);
  // True while the amount on screen is the one offered from the plan.
  const [amountFromPlan, setAmountFromPlan] = useState(false);

  const [history, setHistory] = useState<ManualPayment[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  // Voiding a payment: the dialog shows this form in place of the other.
  const [voiding, setVoiding] = useState<ManualPayment | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidDate, setVoidDate] = useState('');
  const [voidSaving, setVoidSaving] = useState(false);
  // The paid-until date after a void that set one, until the caller's own
  // list has been reloaded: `undefined` = as the caller gave it.
  const [paidUntilAfterVoid, setPaidUntilAfterVoid] = useState<string | null | undefined>(undefined);

  const communityId = community?.id ?? null;
  // The currency of its plan, when it has one: a plain word, so the form is
  // reset only when it really changes.
  const planCurrency = community?.plan ? community.plan.currency.toUpperCase() : '';
  const communityPaidUntil = paidUntilAfterVoid !== undefined ? paidUntilAfterVoid : (community?.paidUntil ?? null);

  const loadHistory = useCallback(async (tenantId: number) => {
    setHistory(null);
    setHistoryFailed(false);
    const response = await api.get<ManualPayment[]>(endpointsFor(via, tenantId).history);
    if (response.success && Array.isArray(response.data)) {
      setHistory(response.data);
    } else {
      setHistoryFailed(true);
    }
  }, [via]);

  // A fresh form each time the dialog opens on a community.
  useEffect(() => {
    if (communityId === null) return;
    setReceivedOn(todayYmd());
    setMethod('bank_transfer');
    setReference('');
    setAmount('');
    setAmountFromPlan(false);
    // The community's own currency when its plan is known; the amount is
    // offered with the date, below.
    setCurrency(planCurrency);
    // Left empty on purpose. Prefilled with the current date it was sent back
    // unchanged, and a payment that does not move the date changes nothing.
    setPaidUntil('');
    setVoiding(null);
    setPaidUntilAfterVoid(undefined);
    void loadHistory(communityId);
  }, [communityId, loadHistory, planCurrency]);

  const startVoiding = (payment: ManualPayment) => {
    setVoidReason('');
    // Left empty on purpose: an empty date leaves the paid-until date alone.
    setVoidDate('');
    setVoiding(payment);
  };

  const confirmVoid = async () => {
    if (!community || !voiding || voidReason.trim() === '' || voidSaving) return;
    setVoidSaving(true);
    const newDate = voidDate.trim();
    const response = await api.post<VoidAnswer>(endpointsFor(via, community.id).void, {
      ...(via === 'branch' ? {} : { tenant_id: community.id }),
      payment_id: voiding.id,
      reason: voidReason.trim(),
      // Only said when a date was chosen: the server leaves the date alone otherwise.
      ...(newDate === '' ? {} : { paid_until: newDate }),
    });
    setVoidSaving(false);

    if (response.success) {
      toast.success(t('control.done_payment_voided'));
      if (newDate !== '') setPaidUntilAfterVoid(response.data?.standing?.paid_until ?? newDate);
      setVoiding(null);
      void loadHistory(community.id);
      onVoided?.();
      return;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController void-payment refusals (lang/*/api.php)
    toast.error(response.error || t('billing.standing_failed'));
  };

  // One month or one year on from the date it is paid up to now, or from the
  // day the payment was received when it has no date yet.
  const dateBase = communityPaidUntil ?? receivedOn;
  const offers = (['month', 'year'] as const).map((step) => ({ step, date: dateBase ? laterDate(dateBase, step) : '' }))
    .filter((offer) => offer.date !== '');

  const takeOffer = (step: 'month' | 'year', date: string) => {
    setPaidUntil(date);
    // The plan's price for that period, unless the person has typed their own.
    const price = step === 'year' ? community?.plan?.yearly : community?.plan?.monthly;
    if (community?.plan && typeof price === 'number' && price > 0 && (amount.trim() === '' || amountFromPlan)) {
      setAmount(String(price));
      setCurrency(community.plan.currency.toUpperCase());
      setAmountFromPlan(true);
    }
  };

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
    const response = await api.post(endpointsFor(via, community.id).record, {
      // The platform team's endpoint is told which community; a manager's
      // has it in its address.
      ...(via === 'branch' ? {} : { tenant_id: community.id }),
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
    // admin-i18n-ignore: localized server message — AdminSuperController::recordCommunityPayment and branchPaymentsRecordPayment refusals (lang/*/api.php)
    toast.error(response.error || t('billing.standing_failed'));
  };

  return (
    <Modal isOpen={community !== null} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>
          {voiding ? t('control.void_title') : mode === 'history' ? t('control.history_title') : t('control.record_payment')}
          {community && (
            <span className="text-muted text-sm font-normal ml-2">
              — {community.name}
            </span>
          )}
        </ModalHeader>
        <ModalBody>
          {voiding ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium">
                {[
                  formatDate(voiding.received_on),
                  t(`control.method_${voiding.method}`),
                  voiding.reference,
                  voiding.amount !== null ? formatAmount(voiding.amount, voiding.currency) : null,
                ].filter((part) => part !== null && part !== '').join(' · ')}
              </p>
              <p className="text-sm text-muted">{t('control.void_help')}</p>
              <Input
                label={t('control.void_reason_label')}
                value={voidReason}
                onValueChange={setVoidReason}
                maxLength={500}
                isRequired
              />
              <p className="text-sm text-muted">{t('control.void_date_note')}</p>
              <Input
                label={t('control.void_date_label')}
                type="date"
                value={voidDate}
                onValueChange={setVoidDate}
                description={[
                  communityPaidUntil
                    ? t('control.void_date_now', { date: formatDate(communityPaidUntil) })
                    : t('control.void_date_none'),
                  voiding.paid_until_before
                    ? t('control.void_date_before', { date: formatDate(voiding.paid_until_before) })
                    : null,
                ].filter((part) => part !== null).join(' ')}
              />
            </div>
          ) : (
          <div className="flex flex-col gap-4">
            {mode === 'history' ? null : (
            <>
            <p className="text-sm text-muted">
              {via === 'branch' && payeeName
                ? t('control.record_payment_help_branch', { payee: payeeName })
                : t('control.record_payment_help')}
            </p>

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
                const found = RECORDABLE_METHODS.find((m) => m === value);
                if (found) setMethod(found);
              }}
            >
              {RECORDABLE_METHODS.map((m) => (
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
                onValueChange={(value: string) => {
                  setAmount(value);
                  setAmountFromPlan(false);
                }}
                description={amountFromPlan ? t('control.amount_from_plan') : undefined}
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
            {/* The usual answers, one press each: nobody should have to work
                out a date in their head. */}
            {offers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {offers.map((offer) => (
                  <Button
                    key={offer.step}
                    size="sm"
                    variant={paidUntil === offer.date ? 'secondary' : 'tertiary'}
                    onPress={() => takeOffer(offer.step, offer.date)}
                  >
                    {t(offer.step === 'year' ? 'control.quick_year' : 'control.quick_month', { date: formatDate(offer.date) })}
                  </Button>
                ))}
              </div>
            ) : null}
            </>
            )}

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
                <>
                {history.some((payment) => payment.source === 'card') ? (
                  <p className="text-xs text-muted">{t('control.history_card_note')}</p>
                ) : null}
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {history.map((payment) => {
                    const voided = payment.voided_at !== null;
                    // A voided payment is struck through; its label lines are not.
                    const value = voided ? 'line-through text-muted' : undefined;
                    const voidedBy = payment.voided_by_name
                      ?? (payment.voided_by_platform_team ? t('control.history_by_platform_team') : null);

                    return (
                    <li key={payment.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid-cols-6">
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_received_on')}</span>
                        <span className={value}>{formatDate(payment.received_on)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_method')}</span>
                        <span className={value}>{t(`control.method_${payment.method}`)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_reference')}</span>
                        <span className={`break-all ${value ?? ''}`}>{payment.reference ?? '—'}</span>
                        {/* Only the platform team sees payments made to different payees. */}
                        {via === 'platform' && payment.payee_name ? (
                          <span className="block text-xs text-muted">{t('control.history_paid_to', { name: payment.payee_name })}</span>
                        ) : null}
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_amount')}</span>
                        <span className={value}>{payment.amount !== null ? formatAmount(payment.amount, payment.currency) : '—'}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_paid_until')}</span>
                        <span className={value}>{formatDate(payment.paid_until_after)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-muted">{t('control.history_col_recorded_by')}</span>
                        <span>
                          {payment.source === 'card'
                            ? t('control.history_by_stripe')
                            : payment.recorded_by_name
                              ?? (payment.recorded_by_platform_team ? t('control.history_by_platform_team') : '—')}
                        </span>
                      </span>
                      {voided && payment.voided_at ? (
                        <span className="col-span-2 text-xs text-danger sm:col-span-6">
                          {voidedBy
                            ? t('control.history_voided', { date: formatDate(payment.voided_at), name: voidedBy, reason: payment.void_reason ?? '' })
                            : t('control.history_voided_no_name', { date: formatDate(payment.voided_at), reason: payment.void_reason ?? '' })}
                        </span>
                      ) : null}
                      {payment.refunded_amount !== null && payment.refunded_at ? (
                        <span className="col-span-2 text-xs text-warning sm:col-span-6">
                          {t('control.history_refunded', {
                            amount: formatAmount(payment.refunded_amount, payment.currency),
                            date: formatDate(payment.refunded_at),
                          })}
                        </span>
                      ) : null}
                      {payment.dispute_state !== null && payment.disputed_at ? (
                        <span className={`col-span-2 text-xs sm:col-span-6 ${payment.dispute_state === 'won' ? 'text-muted' : 'text-danger'}`}>
                          {t(`control.history_dispute_${payment.dispute_state}`, { date: formatDate(payment.disputed_at) })}
                        </span>
                      ) : null}
                      {payment.can_void ? (
                        <span className="col-span-2 flex justify-end sm:col-span-6">
                          <Button
                            size="sm"
                            variant="tertiary"
                            aria-label={t('control.void_action_for', { date: formatDate(payment.received_on) })}
                            onPress={() => startVoiding(payment)}
                          >
                            {t('control.void_action')}
                          </Button>
                        </span>
                      ) : null}
                    </li>
                    );
                  })}
                </ul>
                </>
              )}
            </section>
          </div>
          )}
        </ModalBody>
        {voiding ? (
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setVoiding(null)} isDisabled={voidSaving}>
              {t('common.back')}
            </Button>
            <Button color="danger" onPress={() => void confirmVoid()} isLoading={voidSaving} isDisabled={voidReason.trim() === '' || voidSaving}>
              {t('control.void_confirm')}
            </Button>
          </ModalFooter>
        ) : (
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
              {mode === 'history' ? t('common.close') : t('billing.cancel')}
            </Button>
            {mode === 'history' ? null : (
              <Button onPress={() => void save()} isLoading={saving} isDisabled={!canSave}>
                {t('control.record_payment_save')}
              </Button>
            )}
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  );
}

export default RecordPaymentDialog;
