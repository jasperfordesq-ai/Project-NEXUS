// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, Button, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch } from '@/components/ui';

/**
 * DonationCheckout - Multi-step modal for making a Stripe donation
 *
 * Step 1: Form (amount, currency, fund, Gift Aid, message, anonymous toggle)
 * Step 2: Stripe payment via StripePaymentForm
 * Step 3: Success confirmation with receipt link
 */

import { lazy, Suspense, useState } from 'react';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Banknote from 'lucide-react/icons/banknote';
import Building2 from 'lucide-react/icons/building-2';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import CreditCard from 'lucide-react/icons/credit-card';
import FileText from 'lucide-react/icons/file-text';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { detectTenantFromUrl, tenantPath } from '@/lib/tenant-routing';
import { useTenant, useToast } from '@/contexts';

const StripePaymentForm = lazy(() =>
  import('./StripePaymentForm').then((module) => ({ default: module.StripePaymentForm }))
);

/* ───────────────────────── Props ───────────────────────── */

interface DonationCheckoutProps {
  isOpen: boolean;
  onClose: () => void;
  givingDayId?: number;
  opportunityId?: number;
  /** Shown to the donor: the organisation this campaign raises money for. */
  beneficiaryName?: string;
  onDonationComplete?: () => void;
}

/* ───────────────────────── Types ───────────────────────── */

type CheckoutStep = 'form' | 'payment' | 'success';

interface PaymentIntentResponse {
  client_secret: string;
  donation_id: number;
}

interface GiftAidDeclaration {
  declarationName: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  postcode: string;
}

const DONATION_FUNDS = [
  { key: 'general', labelKey: 'donations.fund_options.general' },
  { key: 'community', labelKey: 'donations.fund_options.community' },
  { key: 'hardship', labelKey: 'donations.fund_options.hardship' },
  { key: 'accessibility', labelKey: 'donations.fund_options.accessibility' },
];

/* ───────────────────────── Component ───────────────────────── */

export function DonationCheckout({
  isOpen,
  onClose,
  givingDayId,
  opportunityId,
  beneficiaryName,
  onDonationComplete,
}: DonationCheckoutProps) {
  const { t } = useTranslation('volunteering');
  const { tenant } = useTenant();
  const toast = useToast();

  // The server accepts donations only in the community's own currency (the
  // giving-day total sums raw amounts with no FX), so the currency is read
  // from the tenant bootstrap and shown, never chosen. Gift Aid is a UK
  // scheme and is offered only when that currency is GBP.
  const currency = (tenant?.currency || 'EUR').toUpperCase();
  const isGbp = currency === 'GBP';

  // Form state
  const [amount, setAmount] = useState('');
  const [fundCode, setFundCode] = useState('general');
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [giftAidEnabled, setGiftAidEnabled] = useState(false);
  const [giftAid, setGiftAid] = useState<GiftAidDeclaration>({
    declarationName: '',
    addressLine1: '',
    addressLine2: '',
    town: '',
    postcode: '',
  });

  // Checkout flow state
  const [step, setStep] = useState<CheckoutStep>('form');
  const [clientSecret, setClientSecret] = useState('');
  const [donationId, setDonationId] = useState<number | null>(null);
  const [isCreatingIntent, setIsCreatingIntent] = useState(false);

  const resetForm = () => {
    setAmount('');
    setFundCode('general');
    setMessage('');
    setIsAnonymous(false);
    setGiftAidEnabled(false);
    setGiftAid({
      declarationName: '',
      addressLine1: '',
      addressLine2: '',
      town: '',
      postcode: '',
    });
    setStep('form');
    setClientSecret('');
    setDonationId(null);
    setIsCreatingIntent(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleContinueToPayment = async () => {
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount < 0.5) {
      toast.error(t('donations.min_amount'));
      return;
    }

    const canUseGiftAid = giftAidEnabled && isGbp;
    if (giftAidEnabled && !canUseGiftAid) {
      toast.error(t('donations.gift_aid_gbp_required'));
      return;
    }

    if (
      canUseGiftAid &&
      (!giftAid.declarationName.trim() ||
        !giftAid.addressLine1.trim() ||
        !giftAid.postcode.trim())
    ) {
      toast.error(t('donations.gift_aid_required'));
      return;
    }

    try {
      setIsCreatingIntent(true);

      const response = await api.post<PaymentIntentResponse>('/v2/donations/payment-intent', {
        amount: numAmount,
        currency,
        fund_code: fundCode,
        giving_day_id: givingDayId ?? null,
        opportunity_id: opportunityId ?? null,
        message: message || null,
        is_anonymous: isAnonymous,
        gift_aid_enabled: canUseGiftAid,
        gift_aid: canUseGiftAid
          ? {
              declaration_name: giftAid.declarationName.trim(),
              address_line1: giftAid.addressLine1.trim(),
              address_line2: giftAid.addressLine2.trim() || null,
              town: giftAid.town.trim() || null,
              postcode: giftAid.postcode.trim().toUpperCase(),
              country: 'GB',
            }
          : null,
      });

      if (response.success && response.data) {
        setClientSecret(response.data.client_secret);
        setDonationId(response.data.donation_id);
        setStep('payment');
      } else {
        logError('Donation payment intent API error', response.error);
        toast.error(t('donations.intent_error'));
      }
    } catch (err) {
      logError('Failed to create payment intent', err);
      toast.error(t('donations.intent_error'));
    } finally {
      setIsCreatingIntent(false);
    }
  };

  const handlePaymentSuccess = () => {
    setStep('success');
    onDonationComplete?.();
  };

  const handlePaymentError = (error: string) => {
    logError('Donation payment failed', error);
    toast.error(t('donations.payment_error'));
  };

  const updateGiftAid = (field: keyof GiftAidDeclaration) => (value: string) => {
    setGiftAid((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const formattedAmount = amount
    ? parseFloat(amount).toLocaleString(getFormattingLocale(), {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
      })
    : '';

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      size="lg"
      classNames={{
        base: 'bg-overlay border border-theme-default',
        header: 'border-b border-theme-default',
        footer: 'border-t border-theme-default',
      }}
      isDismissable={step !== 'payment'}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="text-theme-primary flex items-center gap-2">
              {step === 'success' ? (
                <CheckCircle className="w-5 h-5 text-[var(--color-success)]" aria-hidden="true" />
              ) : (
                <CreditCard className="w-5 h-5" aria-hidden="true" />
              )}
              {step === 'success'
                ? t('donations.success_title')
                : t('donations.checkout_title')}
            </ModalHeader>

            <ModalBody className="gap-4 py-4">
              {/* ── Step 1: Form ── */}
              {step === 'form' && (
                <>
                  {beneficiaryName && (
                    <p className="flex items-start gap-2 rounded-lg border border-theme-default bg-surface-secondary/50 p-3 text-sm text-theme-primary">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-theme-subtle" aria-hidden="true" />
                      <span>{t('donations.checkout_for_organisation', { name: beneficiaryName })}</span>
                    </p>
                  )}
                  <Input
                    label={t('donations.amount_label')}
                    type="number"
                    min="0.50"
                    step="0.01"
                    variant="bordered"
                    value={amount}
                    onValueChange={setAmount}
                    startContent={<Banknote className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                    endContent={<span className="text-xs font-semibold text-theme-subtle">{currency}</span>}
                    description={t('donations.currency_fixed_hint', { currency })}
                    isRequired
                    placeholder={t('donations.placeholder_amount')}
                  />

                  <Select
                    label={t('donations.fund_label')}
                    variant="bordered"
                    selectedKeys={[fundCode]}
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0] as string;
                      if (selected) setFundCode(selected);
                    }}
                  >
                    {DONATION_FUNDS.map((fund) => (
                      <SelectItem key={fund.key} id={fund.key}>{t(fund.labelKey)}</SelectItem>
                    ))}
                  </Select>

                  {isGbp && (
                  <div className="rounded-lg border border-theme-default bg-surface-secondary/50 p-3">
                    <Switch
                      isSelected={giftAidEnabled}
                      onValueChange={setGiftAidEnabled}
                      size="sm"
                    >
                      {t('donations.gift_aid_toggle')}
                    </Switch>
                    <p className="mt-2 text-xs text-theme-muted">{t('donations.gift_aid_description')}</p>

                    {giftAidEnabled && (
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                          label={t('donations.gift_aid_name_label')}
                          variant="bordered"
                          value={giftAid.declarationName}
                          onValueChange={updateGiftAid('declarationName')}
                          isRequired
                          className="sm:col-span-2"
                        />
                        <Input
                          label={t('donations.gift_aid_address1_label')}
                          variant="bordered"
                          value={giftAid.addressLine1}
                          onValueChange={updateGiftAid('addressLine1')}
                          isRequired
                          className="sm:col-span-2"
                        />
                        <Input
                          label={t('donations.gift_aid_address2_label')}
                          variant="bordered"
                          value={giftAid.addressLine2}
                          onValueChange={updateGiftAid('addressLine2')}
                          className="sm:col-span-2"
                        />
                        <Input
                          label={t('donations.gift_aid_town_label')}
                          variant="bordered"
                          value={giftAid.town}
                          onValueChange={updateGiftAid('town')}
                        />
                        <Input
                          label={t('donations.gift_aid_postcode_label')}
                          variant="bordered"
                          value={giftAid.postcode}
                          onValueChange={updateGiftAid('postcode')}
                          isRequired
                        />
                      </div>
                    )}
                  </div>
                  )}

                  <Textarea
                    label={t('donations.message_label')}
                    variant="bordered"
                    value={message}
                    onValueChange={setMessage}
                    maxRows={3}
                    placeholder={t('donations.message_placeholder')}
                  />

                  <Switch
                    isSelected={isAnonymous}
                    onValueChange={setIsAnonymous}
                    size="sm"
                  >
                    {t('donations.anonymous_toggle')}
                  </Switch>
                </>
              )}

              {/* ── Step 2: Stripe Payment ── */}
              {step === 'payment' && clientSecret && (
                <div className="space-y-4">
                  <div className="text-center text-sm text-theme-muted mb-2">
                    {t('donations.paying_amount', { amount: formattedAmount })}
                  </div>
                  <Suspense fallback={null}>
                    <StripePaymentForm
                      clientSecret={clientSecret}
                      onSuccess={handlePaymentSuccess}
                      onError={handlePaymentError}
                    />
                  </Suspense>
                </div>
              )}

              {/* ── Step 3: Success ── */}
              {step === 'success' && (
                <div className="text-center py-6 space-y-4">
                  <CheckCircle className="w-16 h-16 text-[var(--color-success)] mx-auto" aria-hidden="true" />
                  <div>
                    <p className="text-lg font-semibold text-theme-primary">
                      {t('donations.success_title')}
                    </p>
                    <p className="text-sm text-theme-muted mt-1">
                      {t('donations.success_message', {
                        amount: formattedAmount,
                      })}
                    </p>
                  </div>
                  {donationId && (
                    <Button
                      variant="flat"
                      size="sm"
                      startContent={<FileText className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => {
                        const detected = detectTenantFromUrl();
                        const receiptPath = detected.source === 'path'
                          ? tenantPath(`/donations/${donationId}/receipt`, detected.slug)
                          : `/donations/${donationId}/receipt`;
                        window.open(receiptPath, '_blank');
                      }}
                    >
                      {t('donations.view_receipt')}
                    </Button>
                  )}
                </div>
              )}
            </ModalBody>

            <ModalFooter>
              {step === 'form' && (
                <>
                  <Button variant="flat" onPress={handleClose}>
                    {t('donations.cancel')}
                  </Button>
                  <Button
                    color="primary"
                    onPress={handleContinueToPayment}
                    isLoading={isCreatingIntent}
                    isDisabled={!amount || parseFloat(amount) < 0.5}
                  >
                    {t('donations.continue_to_payment')}
                  </Button>
                </>
              )}

              {step === 'payment' && (
                <Button
                  variant="flat"
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                  onPress={() => setStep('form')}
                >
                  {t('donations.back')}
                </Button>
              )}

              {step === 'success' && (
                <Button
                  color="primary"
                  onPress={handleClose}
                >
                  {t('donations.close')}
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default DonationCheckout;
