// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BuyNowButton — Creates a marketplace order and starts Stripe payment.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import CreditCard from 'lucide-react/icons/credit-card';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { useAuth, useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { toFiniteMarketplaceNumber } from '@/lib/marketplaceNumbers';
import type { MarketplaceShippingOption } from '@/types/marketplace';

const StripeCheckoutModal = lazy(() =>
  import('./StripeCheckoutModal').then((module) => ({ default: module.StripeCheckoutModal })),
);

interface BuyNowButtonProps {
  listingId: number;
  offerId?: number;
  listingTitle?: string;
  price: number;
  currency: string;
  sellerId: number;
  onSuccess: () => void;
  className?: string;
  selectedShippingOption?: MarketplaceShippingOption | null;
  shippingRequired?: boolean;
  buttonLabelKey?: string;
  allowCoupons?: boolean;
  loyaltyRedemptionId?: number;
  loyaltyDiscount?: number;
  paymentMethod?: 'cash' | 'time_credits' | 'free';
  timeCredits?: number;
  shippingMethod?: 'pickup' | 'community_delivery';
}

interface CreateOrderResponse {
  id: number;
  order_number: string;
  status: string;
  requires_payment?: boolean;
}

interface CreateIntentResponse {
  checkout_url?: string;
  client_secret?: string;
}

interface PickupSlotOption {
  id: number;
  slot_start: string | null;
  slot_end: string | null;
  remaining: number;
}

function createCheckoutIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `marketplace-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function BuyNowButton({
  listingId,
  offerId,
  listingTitle,
  price,
  currency,
  sellerId,
  onSuccess,
  className,
  selectedShippingOption,
  shippingRequired = false,
  buttonLabelKey = 'orders.buy.buy_now',
  allowCoupons = true,
  loyaltyRedemptionId,
  loyaltyDiscount = 0,
  paymentMethod = 'cash',
  timeCredits = 0,
  shippingMethod = 'pickup',
}: BuyNowButtonProps) {
  const { t } = useTranslation('marketplace');
  const { t: tCommon } = useTranslation('common');
  const { user } = useAuth();
  const { hasFeature } = useTenant();
  const toast = useToast();
  const checkoutModal = useDisclosure();
  const idempotencyKeyRef = useRef<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponDiscountAmount, setCouponDiscountAmount] = useState(0);
  const [pickupSlots, setPickupSlots] = useState<PickupSlotOption[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<PickupSlotOption[]>(
          `/v2/marketplace/listings/${listingId}/pickup-slots${offerId ? `?offer_id=${offerId}` : ''}`,
        );
        if (!cancelled && res.success && Array.isArray(res.data)) {
          setPickupSlots(res.data);
        }
      } catch {
        // Pickup is optional; the buy flow can continue without slots.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId, offerId]);

  const couponsEnabled = paymentMethod === 'cash' && allowCoupons && hasFeature('merchant_coupons');
  const isOwnListing = user?.id === sellerId;
  const normalizedPrice = Math.max(0, toFiniteMarketplaceNumber(price, 0) ?? 0);
  const shippingCost = Math.max(
    0,
    toFiniteMarketplaceNumber(selectedShippingOption?.price, 0) ?? 0,
  );
  const orderSubtotal = Math.max(0, normalizedPrice + shippingCost);
  const normalizedLoyaltyDiscount = Math.max(
    0,
    toFiniteMarketplaceNumber(loyaltyDiscount, 0) ?? 0,
  );
  const orderTotal = Math.max(
    0,
    orderSubtotal - normalizedLoyaltyDiscount - couponDiscountAmount,
  );
  const hasRequiredShipping = !shippingRequired || selectedShippingOption !== undefined;
  const fulfilmentIsPickup = selectedShippingOption === null
    || (!shippingRequired && shippingMethod === 'pickup');
  const pickupSelectionRequired = fulfilmentIsPickup && pickupSlots.length > 0;
  const checkoutReady = hasRequiredShipping
    && (!pickupSelectionRequired || selectedSlotId !== '');

  const priceFormatter = useMemo(
    () =>
      new Intl.NumberFormat(getFormattingLocale(), {
        style: 'currency',
        currency: currency || 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    [currency]
  );
  const priceLabel = paymentMethod === 'time_credits'
    ? t('community_delivery.time_credits_value', { count: timeCredits })
    : paymentMethod === 'free'
      ? t('listing.free')
      : priceFormatter.format(orderTotal);
  const buttonAriaLabel = buttonLabelKey === 'orders.buy.buy_now'
    ? t('orders.buy.buy_now_aria', { price: priceLabel })
    : `${t(buttonLabelKey)} ${priceLabel}`;

  useEffect(() => {
    setCouponApplied(false);
    setCouponDiscountAmount(0);
  }, [listingId, normalizedPrice, shippingCost]);

  useEffect(() => {
    if (!fulfilmentIsPickup) {
      setSelectedSlotId('');
    }
  }, [fulfilmentIsPickup]);

  const handleBuyNow = useCallback(async () => {
    if (isOwnListing || !user || !checkoutReady) return;

    setIsProcessing(true);
    try {
      const orderPayload: Record<string, unknown> = { listing_id: listingId };
      idempotencyKeyRef.current ??= createCheckoutIdempotencyKey();
      orderPayload.idempotency_key = idempotencyKeyRef.current;
      orderPayload.payment_method = paymentMethod;
      if (offerId) {
        orderPayload.offer_id = offerId;
      }
      if (selectedShippingOption) {
        orderPayload.shipping_option_id = selectedShippingOption.id;
      } else if (selectedShippingOption === null) {
        orderPayload.shipping_method = 'pickup';
      } else if (!shippingRequired) {
        orderPayload.shipping_method = shippingMethod;
      }
      if (fulfilmentIsPickup && selectedSlotId) {
        orderPayload.pickup_slot_id = parseInt(selectedSlotId, 10);
      }
      if (paymentMethod === 'cash' && couponApplied && couponCode.trim()) {
        orderPayload.coupon_code = couponCode.trim().toUpperCase();
      }
      if (paymentMethod === 'cash' && loyaltyRedemptionId) {
        orderPayload.loyalty_redemption_id = loyaltyRedemptionId;
      }

      const orderRes = await api.post<CreateOrderResponse>('/v2/marketplace/orders', orderPayload);
      if (!orderRes.success || !orderRes.data?.id) {
        toast.error(orderRes.error || t('orders.buy.create_order_failed'));
        return;
      }

      const orderId = orderRes.data.id;

      if (orderRes.data.requires_payment === false || orderRes.data.status === 'paid') {
        idempotencyKeyRef.current = null;
        onSuccess();
        return;
      }

      const intentRes = await api.post<CreateIntentResponse>('/v2/marketplace/payments/create-intent', {
        order_id: orderId,
      });
      if (!intentRes.success || !intentRes.data) {
        toast.error(intentRes.error || t('orders.buy.payment_failed'));
        return;
      }

      if (intentRes.data.client_secret) {
        setClientSecret(intentRes.data.client_secret);
        checkoutModal.onOpen();
        return;
      }
      if (intentRes.data.checkout_url) {
        idempotencyKeyRef.current = null;
        window.location.href = intentRes.data.checkout_url;
        return;
      }

      toast.info(t('orders.buy.contact_seller'));
      idempotencyKeyRef.current = null;
      onSuccess();
    } catch (err) {
      logError('BuyNowButton: payment flow failed', err);
      toast.error(t('orders.buy.error'));
    } finally {
      setIsProcessing(false);
    }
  }, [
    listingId,
    offerId,
    isOwnListing,
    user,
    checkoutReady,
    selectedShippingOption,
    shippingRequired,
    toast,
    onSuccess,
    checkoutModal,
    t,
    couponApplied,
    couponCode,
    loyaltyRedemptionId,
    selectedSlotId,
    paymentMethod,
    shippingMethod,
    fulfilmentIsPickup,
  ]);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      const res = await api.post<{
        discount_amount: number;
        discount_cents: number;
        currency: string;
      }>('/v2/coupons/validate', {
        code: couponCode.trim().toUpperCase(),
        listing_id: listingId,
        ...(selectedShippingOption ? { shipping_option_id: selectedShippingOption.id } : {}),
      });
      if (res.success) {
        setCouponDiscountAmount(Math.max(0, res.data?.discount_amount ?? 0));
        setCouponApplied(true);
        toast.success(tCommon('coupon.applied'));
      } else {
        toast.error(tCommon('coupon.invalid_code'));
      }
    } catch {
      toast.error(tCommon('coupon.invalid_code'));
    }
  };

  const formatSlotLabel = (s: PickupSlotOption) => {
    try {
      return s.slot_start ? new Date(s.slot_start).toLocaleString(getFormattingLocale()) : t('pickup.slot_fallback', { id: s.id });
    } catch {
      return t('pickup.slot_fallback', { id: s.id });
    }
  };

  return (
    <>
      {pickupSlots.length > 0 && fulfilmentIsPickup && !isOwnListing && user && (
        <div className="mb-2">
          <Select
            size="sm"
            label={t('pickup.choose_slot')}
            placeholder={t('pickup.no_slot_selected')}
            selectedKeys={selectedSlotId ? [selectedSlotId] : []}
            onSelectionChange={(keys) => {
              const v = Array.from(keys)[0];
              setSelectedSlotId(v ? String(v) : '');
            }}
          >
            {pickupSlots.map((s) => (
              <SelectItem key={String(s.id)} id={String(s.id)} textValue={formatSlotLabel(s)}>
                {formatSlotLabel(s)} ({s.remaining} {t('pickup.left')})
              </SelectItem>
            ))}
          </Select>
        </div>
      )}
      {couponsEnabled && !isOwnListing && user && (
        <div className="flex gap-2 mb-2">
          <Input
            size="sm"
            placeholder={tCommon('coupon.enter_code')}
            aria-label={tCommon('coupon.enter_code')}
            value={couponCode}
            onValueChange={(v) => {
              setCouponCode(v);
              if (couponApplied) {
                setCouponApplied(false);
                setCouponDiscountAmount(0);
              }
            }}
            isDisabled={couponApplied}
          />
          <Button
            size="sm"
            variant="tertiary"
            onPress={handleApplyCoupon}
            isDisabled={!couponCode.trim() || couponApplied}
          >
            {couponApplied ? tCommon('coupon.applied') : tCommon('coupon.apply')}
          </Button>
        </div>
      )}
      {(shippingCost > 0 || normalizedLoyaltyDiscount > 0 || couponDiscountAmount > 0) && (
        <div className="mb-2 space-y-1 rounded-md border border-separator bg-surface-secondary p-3 text-sm">
          {shippingCost > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">{t('checkout.shipping')}</span>
              <span className="font-medium text-foreground">{priceFormatter.format(shippingCost)}</span>
            </div>
          )}
          {couponDiscountAmount > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">{t('checkout.discount')}</span>
              <span className="font-medium text-success">-{priceFormatter.format(couponDiscountAmount)}</span>
            </div>
          )}
          {normalizedLoyaltyDiscount > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">{t('checkout.discount')}</span>
              <span className="font-medium text-success">-{priceFormatter.format(normalizedLoyaltyDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-separator pt-1">
            <span className="font-medium text-foreground">{t('checkout.total')}</span>
            <span className="font-semibold text-foreground">{priceLabel}</span>
          </div>
        </div>
      )}
      <Button
        variant="secondary"
        fullWidth
        startContent={!isProcessing ? <CreditCard className="w-4 h-4" /> : undefined}
        onPress={handleBuyNow}
        isLoading={isProcessing}
        isDisabled={isOwnListing || !user || !checkoutReady}
        className={className}
        aria-label={buttonAriaLabel}
      >
        {t(buttonLabelKey)} {priceLabel}
      </Button>
      {!hasRequiredShipping && (
        <p className="text-xs text-danger text-center">{t('shipping.choose_required')}</p>
      )}

      {clientSecret && checkoutModal.isOpen && (
        <Suspense fallback={null}>
          <StripeCheckoutModal
            isOpen={checkoutModal.isOpen}
            clientSecret={clientSecret}
            amount={orderTotal}
            currency={currency}
            listingTitle={listingTitle}
            onSuccess={() => {
              checkoutModal.onClose();
              setClientSecret(null);
              idempotencyKeyRef.current = null;
              onSuccess();
            }}
            onClose={() => {
              checkoutModal.onClose();
              setClientSecret(null);
              idempotencyKeyRef.current = null;
            }}
          />
        </Suspense>
      )}
    </>
  );
}

export default BuyNowButton;
