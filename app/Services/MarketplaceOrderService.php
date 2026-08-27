<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\MarketplaceEscrow;
use App\Models\MarketplaceListing;
use App\Models\MarketplaceOffer;
use App\Models\MarketplaceOrder;
use App\Models\MarketplacePayment;
use App\Models\MarketplaceSellerProfile;
use App\Models\MarketplaceShippingOption;
use App\Models\Notification;
use App\Support\StripeCurrency;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use App\Support\UserDisplayName;

/**
 * MarketplaceOrderService — Order lifecycle management for the marketplace module.
 *
 * Handles: create from offer / direct purchase → ship → deliver → complete / cancel.
 */
class MarketplaceOrderService
{
    private const MAX_ORDER_QUANTITY = 100;
    private const DELIVERY_CHANNEL_EMAIL = 'email';
    private const DELIVERY_CHANNEL_BELL = 'bell';
    private const DELIVERY_STATUS_CLAIMED = 'claimed';
    private const DELIVERY_STATUS_DELIVERED = 'delivered';
    private const DELIVERY_STATUS_FAILED = 'failed';
    private const DELIVERY_STATUS_SKIPPED = 'skipped';

    // -----------------------------------------------------------------
    //  Create
    // -----------------------------------------------------------------

    /**
     * Create an order from an accepted offer.
     */
    public static function createFromOffer(MarketplaceOffer $offer, array $data): MarketplaceOrder
    {
        self::assertAcceptedOfferCheckoutable($offer);

        $tenantId = (int) ($offer->tenant_id ?: TenantContext::getId());
        $quantity = (int) ($data['quantity'] ?? 1);
        if ($quantity !== 1
            || (int) ($data['listing_id'] ?? 0) !== (int) $offer->marketplace_listing_id) {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }
        $rawCheckoutKey = trim((string) ($data['idempotency_key'] ?? ''));
        if ($rawCheckoutKey === '') {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }
        $checkoutKey = hash('sha256', $rawCheckoutKey);
        $checkoutFingerprint = self::checkoutFingerprint(
            (int) $offer->marketplace_listing_id,
            $quantity,
            $data,
        );

        return TenantContext::runForTenant($tenantId, function () use (
            $offer,
            $tenantId,
            $data,
            $checkoutKey,
            $checkoutFingerprint,
        ): MarketplaceOrder {
            $created = false;

            try {
                $order = DB::transaction(function () use (
                    $offer,
                    $tenantId,
                    $data,
                    $checkoutKey,
                    $checkoutFingerprint,
                    &$created,
                ): MarketplaceOrder {
                    $lockedOffer = MarketplaceOffer::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($offer->id)
                        ->lockForUpdate()
                        ->first();
                    if (! $lockedOffer) {
                        throw new \InvalidArgumentException(__('api.marketplace_order_offer_not_accepted'));
                    }
                    self::assertAcceptedOfferCheckoutable($lockedOffer);

                    $existing = MarketplaceOrder::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->where('marketplace_offer_id', $lockedOffer->id)
                        ->lockForUpdate()
                        ->first();
                    if ($existing) {
                        if ((string) $existing->status !== 'cancelled') {
                            self::assertCheckoutReplayMatches($existing, $checkoutFingerprint);
                            return $existing;
                        }

                        // A terminal unpaid attempt must not permanently consume
                        // the offer's one-live-order constraint. Preserve the old
                        // order and all of its ledgers, but release the nullable
                        // unique claims before creating a fresh checkout attempt.
                        $existing->marketplace_offer_id = null;
                        $existing->checkout_key = null;
                        $existing->save();
                    }

                    $listing = MarketplaceListing::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($lockedOffer->marketplace_listing_id)
                        ->lockForUpdate()
                        ->firstOrFail();
                    self::assertListingPurchasable($listing, true);

                    if ((int) $listing->user_id !== (int) $lockedOffer->seller_id) {
                        throw new \InvalidArgumentException(__('api.marketplace_order_offer_seller_mismatch'));
                    }

                    self::assertOrderContactAllowed(
                        (int) $lockedOffer->buyer_id,
                        (int) $lockedOffer->seller_id,
                        $tenantId,
                    );

                    [$shippingOptionId, $shippingMethod, $shippingCost] = self::resolveShipping(
                        $listing,
                        $data,
                        $tenantId,
                    );
                    $paymentMethod = strtolower(trim((string) ($data['payment_method'] ?? 'cash')));
                    // Marketplace offers are monetary negotiations. A buyer
                    // cannot replace the accepted amount with another tender
                    // after the seller accepts it.
                    if ($paymentMethod !== 'cash') {
                        throw new \InvalidArgumentException(__('api.validation_failed'));
                    }

                    $currency = StripeCurrency::normalize((string) $lockedOffer->currency);
                    $subtotalMinor = StripeCurrency::toMinor(
                        (float) $lockedOffer->amount + $shippingCost,
                        $currency,
                    );
                    if ($subtotalMinor <= 0) {
                        throw new \InvalidArgumentException(__('api.marketplace_listing_cash_price_invalid'));
                    }
                    $subtotal = StripeCurrency::fromMinor($subtotalMinor, $currency);
                    $unitPriceMinor = StripeCurrency::toMinor((float) $lockedOffer->amount, $currency);
                    $coupon = null;
                    $couponDiscount = 0.0;
                    $couponDiscountMinor = 0;
                    $couponCode = trim((string) ($data['coupon_code'] ?? ''));
                    $loyaltyRedemptionId = isset($data['loyalty_redemption_id'])
                        ? (int) $data['loyalty_redemption_id']
                        : null;
                    if ($loyaltyRedemptionId !== null && $couponCode !== '') {
                        throw new \InvalidArgumentException(__('api.marketplace_coupon_loyalty_exclusive'));
                    }
                    if ($couponCode !== '') {
                        $coupon = MerchantCouponService::validateCoupon(
                            $couponCode,
                            (int) $lockedOffer->buyer_id,
                            $subtotalMinor,
                            (int) $listing->id,
                            $listing->category_id !== null ? (int) $listing->category_id : null,
                            $currency,
                        );
                        $couponDiscountMinor = MerchantCouponService::calculateOrderDiscountMinor(
                            $coupon,
                            $subtotalMinor,
                            $unitPriceMinor,
                            1,
                        );
                        $couponDiscount = StripeCurrency::fromMinor(
                            $couponDiscountMinor,
                            $currency,
                        );
                    }

                    $order = new MarketplaceOrder();
                    $order->tenant_id = $tenantId;
                    $order->order_number = self::generateOrderNumber($tenantId);
                    $order->buyer_id = $lockedOffer->buyer_id;
                    $order->seller_id = $lockedOffer->seller_id;
                    $order->marketplace_listing_id = $listing->id;
                    $order->marketplace_offer_id = $lockedOffer->id;
                    $order->checkout_key = $checkoutKey;
                    $order->checkout_fingerprint = $checkoutFingerprint;
                    $order->quantity = 1;
                    $order->unit_price = $lockedOffer->amount;
                    $order->total_price = max(
                        0.0,
                        StripeCurrency::roundMajor($subtotal - $couponDiscount, $currency),
                    );
                    $order->currency = $currency;
                    $order->shipping_method = $shippingMethod;
                    $order->shipping_option_id = $shippingOptionId;
                    $order->shipping_cost = $shippingCost;
                    $order->delivery_address = $data['delivery_address'] ?? null;
                    $order->delivery_notes = $data['delivery_notes'] ?? null;
                    $order->status = 'pending_payment';
                    $order->payment_expires_at = now()->addMinutes(30);
                    $order->save();

                    if ($loyaltyRedemptionId !== null) {
                        app(CaringLoyaltyService::class)->applyPendingToOrder(
                            $loyaltyRedemptionId,
                            $order,
                        );
                        $order->refresh();
                    }
                    self::finalizeCashCheckoutState($order);
                    self::assertSellerReadyForCardPayment($order);

                    if ($listing->inventory_count === null) {
                        // NULL means unlimited inventory, not a single implicit
                        // unit. Release the offer reservation for future sales.
                        if ($listing->status === 'reserved') {
                            $listing->status = 'active';
                            $listing->save();
                        }
                    } else {
                        MarketplaceInventoryService::decrementForOrder((int) $listing->id, 1);
                        $listing->refresh();
                        if ((int) $listing->inventory_count > 0 && $listing->status === 'reserved') {
                            $listing->status = 'active';
                            $listing->save();
                        }
                    }

                    if ($coupon) {
                        MerchantCouponService::redeemForOrder(
                            (int) $coupon->id,
                            (int) $order->id,
                            (int) $lockedOffer->buyer_id,
                            'online',
                            $couponDiscountMinor,
                        );
                    }

                    self::reservePickupSlotIfRequested(
                        $order,
                        $data,
                        (int) $lockedOffer->buyer_id,
                    );

                    $created = true;
                    return $order;
                });
            } catch (QueryException $exception) {
                $existing = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('marketplace_offer_id', $offer->id)
                    ->first();
                if (! $existing) {
                    throw $exception;
                }
                self::assertCheckoutReplayMatches($existing, $checkoutFingerprint);
                $order = $existing;
            }

            if ($created) {
                try {
                    $title = MarketplaceListing::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($order->marketplace_listing_id)
                        ->value('title') ?? '';
                    self::sendOrderConfirmationEmails($order, (string) $title);
                } catch (\Throwable $e) {
                    Log::warning('[MarketplaceOrderService] createFromOffer email failed: ' . $e->getMessage());
                }
            }

            return $order;
        });
    }

    /**
     * Create an order via direct purchase (buy-now flow, no offer).
     */
    public static function createDirectPurchase(int $buyerId, int $listingId, array $data): MarketplaceOrder
    {
        $listing = MarketplaceListing::findOrFail($listingId);
        $tenantId = (int) ($listing->tenant_id ?: TenantContext::getId());
        $quantity = (int) ($data['quantity'] ?? 1);
        if ($quantity < 1 || $quantity > self::MAX_ORDER_QUANTITY) {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }
        $rawCheckoutKey = trim((string) ($data['idempotency_key'] ?? ''));
        if ($rawCheckoutKey === '') {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }
        $checkoutKey = hash('sha256', $rawCheckoutKey);
        $checkoutFingerprint = self::checkoutFingerprint($listingId, $quantity, $data);

        return TenantContext::runForTenant($tenantId, function () use (
            $buyerId, $listingId, $tenantId, $quantity, $checkoutKey, $checkoutFingerprint, $data
        ): MarketplaceOrder {
            $existing = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('buyer_id', $buyerId)
                ->where('checkout_key', $checkoutKey)
                ->first();
            if ($existing) {
                self::assertCheckoutReplayMatches($existing, $checkoutFingerprint);
                if ($existing->status === 'pending_payment'
                    && (float) ($existing->time_credits_used ?? 0) > 0) {
                    return self::settleTimeCreditOrder($existing);
                }
                return $existing;
            }

            $created = false;
            try {
                $order = DB::transaction(function () use (
                    $buyerId,
                    $listingId,
                    $tenantId,
                    $quantity,
                    $checkoutKey,
                    $checkoutFingerprint,
                    $data,
                    &$created,
                ): MarketplaceOrder {
                    $lockedListing = MarketplaceListing::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($listingId)
                        ->lockForUpdate()
                        ->first();
                    if (! $lockedListing) {
                        throw new \InvalidArgumentException(__('api.marketplace_listing_unavailable_for_purchase'));
                    }
                    self::assertListingPurchasable($lockedListing, false);

                    if ((int) $lockedListing->user_id === $buyerId) {
                        throw new \InvalidArgumentException(__('api.marketplace_purchase_own_listing'));
                    }
                    self::assertOrderContactAllowed($buyerId, (int) $lockedListing->user_id, $tenantId);

                    [$shippingOptionId, $shippingMethod, $shippingCost] = self::resolveShipping(
                        $lockedListing,
                        $data,
                        $tenantId,
                    );

                    $priceType = (string) ($lockedListing->price_type ?? 'fixed');
                    $requestedPaymentMethod = (string) ($data['payment_method'] ?? 'cash');
                    if ($priceType === 'free') {
                        $requestedPaymentMethod = 'free';
                    } elseif ($requestedPaymentMethod === 'cash'
                        && (float) ($lockedListing->price ?? 0) <= 0
                        && (float) ($lockedListing->time_credit_price ?? 0) > 0) {
                        // A time-credit-only listing has no ambiguous method to
                        // choose, so older clients may safely omit this hint.
                        $requestedPaymentMethod = 'time_credits';
                    }
                    if (! in_array($priceType, ['fixed', 'free'], true)) {
                        throw new \InvalidArgumentException(__('api.marketplace_listing_offer_purchase_required'));
                    }
                    if ($requestedPaymentMethod === 'free' && $priceType !== 'free') {
                        throw new \InvalidArgumentException(__('api.marketplace_free_checkout_not_available'));
                    }

                    $unitPrice = $requestedPaymentMethod === 'cash'
                        ? (float) ($lockedListing->price ?? 0)
                        : 0.0;
                    $timeCredits = $requestedPaymentMethod === 'time_credits'
                        ? (float) ($lockedListing->time_credit_price ?? 0) * $quantity
                        : 0.0;
                    if ($requestedPaymentMethod === 'cash' && $priceType !== 'free' && $unitPrice <= 0) {
                        throw new \InvalidArgumentException(__('api.marketplace_listing_cash_price_invalid'));
                    }
                    if ($requestedPaymentMethod === 'time_credits' && $timeCredits <= 0) {
                        throw new \InvalidArgumentException(__('api.marketplace_listing_time_credits_unavailable'));
                    }
                    if ($requestedPaymentMethod !== 'cash' && $shippingCost > 0) {
                        throw new \InvalidArgumentException(
                            __('api.marketplace_paid_shipping_cash_only'),
                        );
                    }

                    $currency = (string) ($lockedListing->price_currency ?: TenantContext::getCurrency());
                    $subtotalMinor = null;
                    if ($requestedPaymentMethod === 'cash') {
                        $subtotalMinor = StripeCurrency::toMinor(
                            ($unitPrice * $quantity) + $shippingCost,
                            $currency,
                        );
                        if ($subtotalMinor <= 0) {
                            throw new \InvalidArgumentException(__('api.marketplace_listing_cash_price_invalid'));
                        }
                        $subtotal = StripeCurrency::fromMinor($subtotalMinor, $currency);
                    } else {
                        $subtotal = round(($unitPrice * $quantity) + $shippingCost, 2);
                    }
                    $coupon = null;
                    $couponDiscount = 0.0;
                    $couponDiscountMinor = 0;
                    $couponCode = trim((string) ($data['coupon_code'] ?? ''));
                    $loyaltyRedemptionId = isset($data['loyalty_redemption_id'])
                        ? (int) $data['loyalty_redemption_id']
                        : null;
                    if ($loyaltyRedemptionId !== null && $couponCode !== '') {
                        throw new \InvalidArgumentException(
                            __('api.marketplace_coupon_loyalty_exclusive'),
                        );
                    }
                    if ($loyaltyRedemptionId !== null && $requestedPaymentMethod !== 'cash') {
                        throw new \InvalidArgumentException(
                            __('api.marketplace_loyalty_cash_only'),
                        );
                    }
                    if ($couponCode !== '') {
                        if ($requestedPaymentMethod !== 'cash') {
                            throw new \InvalidArgumentException(__('api.marketplace_coupon_cash_only'));
                        }
                        $subtotalMinor ??= StripeCurrency::toMinor($subtotal, $currency);
                        $unitPriceMinor = StripeCurrency::toMinor($unitPrice, $currency);
                        $coupon = MerchantCouponService::validateCoupon(
                            $couponCode,
                            $buyerId,
                            $subtotalMinor,
                            (int) $lockedListing->id,
                            $lockedListing->category_id !== null ? (int) $lockedListing->category_id : null,
                            $currency,
                        );
                        $couponDiscountMinor = MerchantCouponService::calculateOrderDiscountMinor(
                            $coupon,
                            $subtotalMinor,
                            $unitPriceMinor,
                            $quantity,
                        );
                        $couponDiscount = StripeCurrency::fromMinor(
                            $couponDiscountMinor,
                            $currency,
                        );
                    }

                    $order = new MarketplaceOrder();
                    $order->tenant_id = $tenantId;
                    $order->order_number = self::generateOrderNumber($tenantId);
                    $order->buyer_id = $buyerId;
                    $order->seller_id = $lockedListing->user_id;
                    $order->marketplace_listing_id = $lockedListing->id;
                    $order->marketplace_offer_id = null;
                    $order->checkout_key = $checkoutKey;
                    $order->checkout_fingerprint = $checkoutFingerprint;
                    $order->quantity = $quantity;
                    $order->unit_price = $unitPrice;
                    $order->total_price = max(
                        0.0,
                        $requestedPaymentMethod === 'cash'
                            ? StripeCurrency::roundMajor($subtotal - $couponDiscount, $currency)
                            : round($subtotal - $couponDiscount, 2),
                    );
                    $order->currency = $currency;
                    $order->time_credits_used = $timeCredits > 0 ? $timeCredits : null;
                    $order->shipping_method = $shippingMethod;
                    $order->shipping_option_id = $shippingOptionId;
                    $order->shipping_cost = $shippingCost;
                    $order->delivery_address = $data['delivery_address'] ?? null;
                    $order->delivery_notes = $data['delivery_notes'] ?? null;
                    $order->status = $requestedPaymentMethod === 'free' ? 'paid' : 'pending_payment';
                    // Time-credit settlement happens immediately after this
                    // transaction. Keep the same checkout expiry backstop as
                    // cash until settlement clears it, so a worker/process
                    // interruption cannot reserve inventory indefinitely.
                    $order->payment_expires_at = $requestedPaymentMethod === 'free'
                        ? null
                        : now()->addMinutes(30);
                    $order->save();

                    if ($loyaltyRedemptionId !== null) {
                        app(CaringLoyaltyService::class)->applyPendingToOrder(
                            $loyaltyRedemptionId,
                            $order,
                        );
                        $order->refresh();
                    }
                    if ($requestedPaymentMethod === 'cash') {
                        self::finalizeCashCheckoutState($order);
                        self::assertSellerReadyForCardPayment($order);
                    }

                    // NULL inventory is unlimited and remains active.
                    if ($lockedListing->inventory_count !== null) {
                        MarketplaceInventoryService::decrementForOrder((int) $lockedListing->id, $quantity);
                    }

                    if ($coupon) {
                        MerchantCouponService::redeemForOrder(
                            (int) $coupon->id,
                            (int) $order->id,
                            $buyerId,
                            'online',
                            $couponDiscountMinor,
                        );
                    }

                    self::reservePickupSlotIfRequested($order, $data, $buyerId);

                    $created = true;
                    return $order;
                });
            } catch (QueryException $exception) {
                $existing = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('buyer_id', $buyerId)
                    ->where('checkout_key', $checkoutKey)
                    ->first();
                if (! $existing) {
                    throw $exception;
                }
                self::assertCheckoutReplayMatches($existing, $checkoutFingerprint);
                $order = $existing;
            }

            if ($created && (float) ($order->time_credits_used ?? 0) > 0) {
                try {
                    $order = self::settleTimeCreditOrder($order);
                } catch (\Throwable $exception) {
                    self::cancel($order, 'time_credit_payment_failed');
                    throw $exception;
                }
            }

            if ($created) {
                try {
                    $title = MarketplaceListing::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($listingId)
                        ->value('title') ?? '';
                    self::sendOrderConfirmationEmails($order, (string) $title);
                } catch (\Throwable $e) {
                    Log::warning('[MarketplaceOrderService] createDirectPurchase email failed: ' . $e->getMessage());
                }
            }

            return $order;
        });
    }

    /**
     * Hash the canonical fields that define one checkout attempt. Client price
     * hints are intentionally absent because all money is resolved server-side.
     */
    private static function checkoutFingerprint(int $listingId, int $quantity, array $data): string
    {
        $shippingOptionId = isset($data['shipping_option_id'])
            ? max(1, (int) $data['shipping_option_id'])
            : null;
        $shippingSelection = $shippingOptionId !== null
            ? ['option_id' => $shippingOptionId, 'method' => null]
            : [
                'option_id' => null,
                'method' => strtolower(trim((string) ($data['shipping_method'] ?? 'default'))),
            ];
        $paymentMethod = strtolower(trim((string) ($data['payment_method'] ?? 'default')));
        if (! in_array($paymentMethod, ['default', 'cash', 'time_credits', 'free'], true)) {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }

        $canonical = [
            'offer_id' => isset($data['offer_id']) ? max(1, (int) $data['offer_id']) : null,
            'listing_id' => $listingId,
            'quantity' => $quantity,
            'shipping' => $shippingSelection,
            'pickup_slot_id' => isset($data['pickup_slot_id'])
                ? max(1, (int) $data['pickup_slot_id'])
                : null,
            'delivery_address' => self::canonicalizeCheckoutValue($data['delivery_address'] ?? null),
            'delivery_notes' => trim((string) ($data['delivery_notes'] ?? '')),
            'coupon_code' => strtoupper(trim((string) ($data['coupon_code'] ?? ''))),
            'loyalty_redemption_id' => isset($data['loyalty_redemption_id'])
                ? max(1, (int) $data['loyalty_redemption_id'])
                : null,
            'payment_method' => $paymentMethod,
        ];

        return hash('sha256', json_encode($canonical, JSON_THROW_ON_ERROR));
    }

    private static function canonicalizeCheckoutValue(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map(
            static fn (mixed $item): mixed => self::canonicalizeCheckoutValue($item),
            $value,
        );
    }

    private static function assertCheckoutReplayMatches(
        MarketplaceOrder $existing,
        string $checkoutFingerprint,
    ): void {
        if (empty($existing->checkout_fingerprint)
            || ! hash_equals((string) $existing->checkout_fingerprint, $checkoutFingerprint)) {
            throw new \InvalidArgumentException(__('api.marketplace_checkout_idempotency_conflict'));
        }
    }

    /** Accepted offers remain checkoutable only until their accepted deadline. */
    private static function assertAcceptedOfferCheckoutable(MarketplaceOffer $offer): void
    {
        if ((string) $offer->status !== 'accepted') {
            throw new \InvalidArgumentException(__('api.marketplace_order_offer_not_accepted'));
        }
        if ($offer->expires_at !== null && $offer->expires_at->isPast()) {
            throw new \InvalidArgumentException(__('api.marketplace_offer_expired'));
        }
    }

    /** Reserve checkout pickup while the order transaction is still open. */
    private static function reservePickupSlotIfRequested(
        MarketplaceOrder $order,
        array $data,
        int $buyerId,
    ): void {
        $hasSlotSelection = isset($data['pickup_slot_id']);
        if ((string) $order->shipping_method !== 'pickup') {
            if ($hasSlotSelection) {
                throw new \InvalidArgumentException(__('api.marketplace_pickup_reservation_failed'));
            }
            return;
        }

        $sellerProfileId = MarketplaceSellerProfile::withoutGlobalScopes()
            ->where('tenant_id', $order->tenant_id)
            ->where('user_id', $order->seller_id)
            ->value('id');
        $hasScheduledSlots = $sellerProfileId !== null
            && DB::table('marketplace_pickup_slots')
                ->where('tenant_id', $order->tenant_id)
                ->where('seller_id', $sellerProfileId)
                ->where('is_active', true)
                ->where('slot_start', '>=', now())
                ->exists();
        if ($hasScheduledSlots && ! $hasSlotSelection) {
            throw new \InvalidArgumentException(__('api.marketplace_pickup_reservation_failed'));
        }
        if (! $hasSlotSelection) {
            return;
        }

        try {
            MarketplacePickupSlotService::reserve(
                (int) $data['pickup_slot_id'],
                (int) $order->id,
                $buyerId,
            );
        } catch (\DomainException $exception) {
            throw new \InvalidArgumentException(
                __('api.marketplace_pickup_reservation_failed'),
                previous: $exception,
            );
        }
    }

    /** Validate the final cash total and settle seller-funded zero-total orders locally. */
    private static function finalizeCashCheckoutState(MarketplaceOrder $order): void
    {
        $minor = StripeCurrency::toMinor((float) $order->total_price, (string) $order->currency);
        if ($minor === 0 && $order->status === 'pending_payment') {
            $order->status = 'paid';
            $order->payment_expires_at = null;
            $order->save();
        }
    }

    /** Positive cash orders must be payable before reserving stock or coupons. */
    private static function assertSellerReadyForCardPayment(MarketplaceOrder $order): void
    {
        if ($order->status !== 'pending_payment'
            || StripeCurrency::toMinor(
                (float) $order->total_price,
                (string) $order->currency,
            ) <= 0) {
            return;
        }

        if (! (bool) MarketplaceConfigurationService::get(
            MarketplaceConfigurationService::CONFIG_STRIPE_ENABLED,
            false,
        )) {
            throw new \InvalidArgumentException(__('api.marketplace_stripe_disabled'));
        }

        $profile = MarketplaceSellerProfile::withoutGlobalScopes()
            ->where('tenant_id', $order->tenant_id)
            ->where('user_id', $order->seller_id)
            ->lockForUpdate()
            ->first();
        if (! $profile || empty($profile->stripe_account_id)) {
            throw new \InvalidArgumentException(__('api.marketplace_seller_onboarding_required'));
        }
        if (! $profile->stripe_onboarding_complete) {
            throw new \InvalidArgumentException(__('api.marketplace_seller_onboarding_incomplete'));
        }
    }

    /** Enforce the complete server-side availability boundary. */
    private static function assertListingPurchasable(
        MarketplaceListing $listing,
        bool $fromAcceptedOffer,
    ): void {
        $allowedStatuses = $fromAcceptedOffer ? ['active', 'reserved'] : ['active'];
        if (! in_array((string) $listing->status, $allowedStatuses, true)) {
            throw new \InvalidArgumentException(__('api.marketplace_listing_unavailable_for_purchase'));
        }
        if ((string) $listing->moderation_status !== 'approved') {
            throw new \InvalidArgumentException(__('api.marketplace_listing_not_approved'));
        }
        if ($listing->expires_at !== null && $listing->expires_at->isPast()) {
            throw new \InvalidArgumentException(__('api.marketplace_listing_expired'));
        }

        self::assertCheckoutPolicy($listing);

        $tenantId = (int) ($listing->tenant_id ?: TenantContext::getId());
        $sellerProfile = MarketplaceSellerProfile::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('user_id', $listing->user_id)
            ->first();
        if ($sellerProfile && (bool) $sellerProfile->is_suspended) {
            throw new \InvalidArgumentException(__('api.marketplace_seller_suspended'));
        }

        $sellerStatus = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $listing->user_id)
            ->value('status');
        if ($sellerStatus === null || in_array((string) $sellerStatus, [
            'banned', 'suspended', 'inactive', 'deactivated',
        ], true)) {
            throw new \InvalidArgumentException(__('api.marketplace_seller_transactions_unavailable'));
        }
    }

    /**
     * Re-check tenant policy against the locked listing at checkout time.
     *
     * A listing can outlive the configuration under which it was published.
     * Both direct and accepted-offer checkout must therefore fail closed when
     * an administrator subsequently disables a governed commerce capability.
     */
    private static function assertCheckoutPolicy(MarketplaceListing $listing): void
    {
        if ((string) $listing->price_type === 'free'
            && ! MarketplaceConfigurationService::allowFreeItems()) {
            throw new \InvalidArgumentException(__('api.marketplace_free_items_disabled'));
        }

        $deliveryMethod = (string) ($listing->delivery_method ?? 'pickup');
        if (((bool) $listing->shipping_available
                || in_array($deliveryMethod, ['shipping', 'both'], true))
            && ! MarketplaceConfigurationService::allowShipping()) {
            throw new \InvalidArgumentException(__('api.marketplace_shipping_disabled'));
        }
        if ($deliveryMethod === 'community_delivery'
            && ! MarketplaceConfigurationService::allowCommunityDelivery()) {
            throw new \InvalidArgumentException(__('api.marketplace_community_delivery_disabled'));
        }

        if ((float) ($listing->price ?? 0) > 0
            && (float) ($listing->time_credit_price ?? 0) > 0
            && ! MarketplaceConfigurationService::allowHybridPricing()) {
            throw new \InvalidArgumentException(__('api.marketplace_hybrid_pricing_disabled'));
        }
    }

    /**
     * Resolve a delivery selection from seller-owned, tenant-scoped data.
     *
     * @return array{0:int|null,1:string|null,2:float}
     */
    private static function resolveShipping(
        MarketplaceListing $listing,
        array $data,
        int $tenantId,
    ): array {
        $shippingOptionId = isset($data['shipping_option_id'])
            ? (int) $data['shipping_option_id']
            : null;
        $requestedMethod = (string) ($data['shipping_method'] ?? '');

        if ($shippingOptionId !== null) {
            if (! (bool) $listing->shipping_available) {
                throw new \InvalidArgumentException(__('api.marketplace_shipping_unavailable'));
            }

            $sellerProfileId = MarketplaceSellerProfile::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('user_id', $listing->user_id)
                ->value('id');
            $option = $sellerProfileId === null ? null : MarketplaceShippingOption::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('seller_id', $sellerProfileId)
                ->whereKey($shippingOptionId)
                ->where('is_active', true)
                ->lockForUpdate()
                ->first();
            if (! $option) {
                throw new \InvalidArgumentException(__('api.marketplace_shipping_option_unavailable'));
            }

            $listingCurrency = strtoupper((string) ($listing->price_currency ?: TenantContext::getCurrency()));
            if (strtoupper((string) $option->currency) !== $listingCurrency) {
                throw new \InvalidArgumentException(__('api.marketplace_shipping_currency_mismatch'));
            }

            return [
                (int) $option->id,
                (string) ($option->courier_code ?: $option->courier_name),
                round((float) $option->price, 2),
            ];
        }

        if ($requestedMethod === 'community_delivery') {
            if ((string) $listing->delivery_method !== 'community_delivery') {
                throw new \InvalidArgumentException(__('api.marketplace_community_delivery_unavailable'));
            }
            return [null, 'community_delivery', 0.0];
        }

        if ($requestedMethod === 'pickup' || (bool) $listing->local_pickup) {
            if (! (bool) $listing->local_pickup) {
                throw new \InvalidArgumentException(__('api.marketplace_local_pickup_unavailable'));
            }
            return [null, 'pickup', 0.0];
        }

        if ((bool) $listing->shipping_available) {
            throw new \InvalidArgumentException(__('api.marketplace_shipping_option_required'));
        }

        return [null, null, 0.0];
    }

    /** Settle a time-credit purchase atomically against the wallet ledger. */
    private static function settleTimeCreditOrder(MarketplaceOrder $order): MarketplaceOrder
    {
        return app(MarketplaceTimeCreditSettlementService::class)->settle($order);
    }

    /** Release a reserved pickup slot when an unpaid order is cancelled. */
    private static function cancelPickupReservation(int $orderId, int $tenantId): void
    {
        if (! Schema::hasTable('marketplace_pickup_reservations')) {
            return;
        }
        $reservation = DB::table('marketplace_pickup_reservations')
            ->where('tenant_id', $tenantId)
            ->where('order_id', $orderId)
            ->where('status', 'reserved')
            ->lockForUpdate()
            ->first();
        if (! $reservation) {
            return;
        }

        $slot = DB::table('marketplace_pickup_slots')
            ->where('tenant_id', $tenantId)
            ->where('id', $reservation->slot_id)
            ->lockForUpdate()
            ->first();
        if ($slot) {
            DB::table('marketplace_pickup_slots')
                ->where('tenant_id', $tenantId)
                ->where('id', $slot->id)
                ->update([
                    'booked_count' => max(0, (int) $slot->booked_count - 1),
                    'updated_at' => now(),
                ]);
        }
        DB::table('marketplace_pickup_reservations')
            ->where('id', $reservation->id)
            ->update([
                'status' => 'cancelled',
                'updated_at' => now(),
            ]);
    }

    /** Restore fulfilment reservations after a full, durable refund. */
    public static function restoreInventoryForRefund(MarketplaceOrder $order): void
    {
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());
        $listing = MarketplaceListing::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($order->marketplace_listing_id)
            ->lockForUpdate()
            ->first();

        if ($listing) {
            if ($listing->inventory_count === null) {
                if ((string) $listing->moderation_status === 'approved') {
                    $listing->status = 'active';
                    $listing->save();
                }
            } else {
                MarketplaceInventoryService::incrementForCancellation(
                    (int) $listing->id,
                    (int) ($order->quantity ?? 1),
                );
            }
        }

        self::cancelPickupReservation((int) $order->id, $tenantId);
        MerchantCouponService::releaseForOrder((int) $order->id, 'payment_refunded');
        app(CaringLoyaltyService::class)->reverseForOrder(
            (int) $order->id,
            'payment_refunded',
        );
    }

    /**
     * Orders open a durable buyer/seller contact channel and notify both
     * parties, so re-check both directions immediately before the write.
     */
    private static function assertOrderContactAllowed(int $buyerId, int $sellerId, int $tenantId): void
    {
        $policy = app(SafeguardingInteractionPolicy::class);
        $policy->assertLocalContactAllowed($buyerId, $sellerId, $tenantId, 'marketplace_order');
        $policy->assertLocalContactAllowed($sellerId, $buyerId, $tenantId, 'marketplace_order');
    }

    // -----------------------------------------------------------------
    //  Lifecycle transitions
    // -----------------------------------------------------------------

    /**
     * Seller marks order as shipped with optional tracking info.
     */
    public static function markShipped(MarketplaceOrder $order, array $data): MarketplaceOrder
    {
        $order = self::withOrderTenant($order, function () use ($order, $data): MarketplaceOrder {
            return DB::transaction(function () use ($order, $data): MarketplaceOrder {
                $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $order->tenant_id)
                    ->whereKey($order->id)
                    ->lockForUpdate()
                    ->first();
                if (! $lockedOrder
                    || ! in_array((string) $lockedOrder->status, ['paid', 'shipped'], true)) {
                    throw new \InvalidArgumentException(__('api.marketplace_order_paid_before_shipping'));
                }

                if ((string) $lockedOrder->status === 'paid') {
                    $lockedOrder->status = 'shipped';
                    $lockedOrder->seller_confirmed_at = now();
                    // Fulfilment was selected and priced at checkout. A seller
                    // may attach tracking evidence, but cannot rewrite that
                    // authoritative method after the buyer has paid.
                    $lockedOrder->tracking_number = $data['tracking_number'] ?? null;
                    $lockedOrder->tracking_url = $data['tracking_url'] ?? null;
                    $lockedOrder->save();
                }

                return $lockedOrder;
            });
        });

        self::withOrderTenant($order, function () use ($order): void {
            // Notify buyer their order has shipped
            self::deliverOrderEmail($order, 'shipped', (int) $order->buyer_id, function () use ($order): string {
                $listing = MarketplaceListing::find($order->marketplace_listing_id);
                $title   = $listing->title ?? '';
                $extraLines = [];
                if (!empty($order->tracking_number)) {
                    $extraLines[] = [
                        'key'    => 'emails_misc.marketplace_order.shipped_tracking',
                        'params' => ['tracking' => htmlspecialchars($order->tracking_number, ENT_QUOTES, 'UTF-8')],
                    ];
                }
                return self::sendOrderEmail(
                    (int) $order->buyer_id,
                    'emails_misc.marketplace_order.shipped_subject',
                    ['order_number' => $order->order_number],
                    'emails_misc.marketplace_order.shipped_title',
                    'emails_misc.marketplace_order.shipped_body',
                    ['order_number' => $order->order_number, 'title' => htmlspecialchars($title, ENT_QUOTES, 'UTF-8')],
                    '/marketplace/orders/' . $order->id,
                    $extraLines
                );
            });

            // In-app bell to buyer
            self::deliverOrderBell($order, 'shipped', (int) $order->buyer_id, [
                'user_id'    => $order->buyer_id,
                'message_key' => 'api_controllers_3.marketplace_order.shipped',
                'message_params' => ['order_number' => $order->order_number],
                'link'       => '/marketplace/orders/' . $order->id,
                'type'       => 'marketplace_order',
                'created_at' => now(),
            ]);
        });

        return $order;
    }

    /**
     * Buyer confirms receipt of the order and starts the 14-day dispute window.
     *
     * Confirmation deliberately does not release escrow immediately: the
     * delivered notification promises both parties that completion happens
     * after 14 days unless a dispute is raised. The escrow auto-release path
     * therefore requires this auto_complete_at deadline to have elapsed.
     */
    public static function confirmDelivery(MarketplaceOrder $order): MarketplaceOrder
    {
        $order = self::withOrderTenant($order, function () use ($order): MarketplaceOrder {
            return DB::transaction(function () use ($order): MarketplaceOrder {
                $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $order->tenant_id)
                    ->whereKey($order->id)
                    ->lockForUpdate()
                    ->first();
                if (! $lockedOrder
                    || ! in_array((string) $lockedOrder->status, ['shipped', 'paid', 'delivered'], true)) {
                    throw new \InvalidArgumentException(__('api.marketplace_order_delivery_state_invalid'));
                }

                if ((string) $lockedOrder->status !== 'delivered') {
                    $lockedOrder->status = 'delivered';
                    $lockedOrder->buyer_confirmed_at = now();
                    $lockedOrder->auto_complete_at = now()->addDays(14);
                    $lockedOrder->save();
                }

                return $lockedOrder;
            });
        });

        self::withOrderTenant($order, function () use ($order): void {
            // Notify seller delivery was confirmed
            self::deliverOrderEmail($order, 'delivered', (int) $order->seller_id, function () use ($order): string {
                return self::sendOrderEmail(
                    (int) $order->seller_id,
                    'emails_misc.marketplace_order.delivered_subject',
                    ['order_number' => $order->order_number],
                    'emails_misc.marketplace_order.delivered_title',
                    'emails_misc.marketplace_order.delivered_body',
                    ['order_number' => $order->order_number],
                    '/marketplace/orders/' . $order->id
                );
            });

            // In-app bell to seller
            self::deliverOrderBell($order, 'delivered', (int) $order->seller_id, [
                'user_id'    => $order->seller_id,
                'message_key' => 'api_controllers_3.marketplace_order.delivered',
                'message_params' => ['order_number' => $order->order_number],
                'link'       => '/marketplace/orders/' . $order->id,
                'type'       => 'marketplace_order',
                'created_at' => now(),
            ]);
        });

        return $order;
    }

    /**
     * Cancel an order (only before shipped).
     */
    public static function cancel(MarketplaceOrder $order, string $reason): MarketplaceOrder
    {
        $cancelledNow = false;
        $order = self::withOrderTenant($order, function () use (
            $order,
            $reason,
            &$cancelledNow,
        ): MarketplaceOrder {
            return DB::transaction(function () use ($order, $reason, &$cancelledNow): MarketplaceOrder {
                $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $order->tenant_id)
                    ->whereKey($order->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                if ($lockedOrder->status === 'cancelled') {
                    return $lockedOrder;
                }
                $hasSuccessfulPayment = MarketplacePayment::withoutGlobalScopes()
                    ->where('tenant_id', $lockedOrder->tenant_id)
                    ->where('order_id', $lockedOrder->id)
                    ->whereIn('status', ['succeeded', 'partially_refunded', 'refunded'])
                    ->exists();
                $isCancellableLocalPaid = $lockedOrder->status === 'paid'
                    && StripeCurrency::toMinor(
                        (float) $lockedOrder->total_price,
                        (string) $lockedOrder->currency,
                    ) === 0
                    && $lockedOrder->wallet_transaction_id === null
                    && ! $hasSuccessfulPayment;
                if (! $isCancellableLocalPaid && in_array($lockedOrder->status, [
                    'paid', 'shipped', 'delivered', 'completed', 'refunded', 'disputed',
                ], true)) {
                    throw new \InvalidArgumentException(
                        __('api.marketplace_order_cancel_paid_refund_required'),
                    );
                }

                $lockedOrder->status = 'cancelled';
                $lockedOrder->cancelled_at = now();
                $lockedOrder->cancellation_reason = $reason;
                $lockedOrder->payment_expires_at = null;
                $lockedOrder->save();

                $listing = MarketplaceListing::withoutGlobalScopes()
                    ->where('tenant_id', $lockedOrder->tenant_id)
                    ->whereKey($lockedOrder->marketplace_listing_id)
                    ->lockForUpdate()
                    ->first();
                if ($listing) {
                    if ($listing->inventory_count === null) {
                        $listing->status = 'active';
                        $listing->save();
                    } else {
                        MarketplaceInventoryService::incrementForCancellation(
                            (int) $listing->id,
                            (int) ($lockedOrder->quantity ?? 1),
                        );
                    }
                }

                MerchantCouponService::releaseForOrder((int) $lockedOrder->id, $reason);
                app(CaringLoyaltyService::class)->reverseForOrder(
                    (int) $lockedOrder->id,
                    $reason,
                );
                self::cancelPickupReservation((int) $lockedOrder->id, (int) $lockedOrder->tenant_id);
                $cancelledNow = true;
                return $lockedOrder;
            });
        });

        if (! $cancelledNow) {
            return $order;
        }

        self::withOrderTenant($order, function () use ($order, $reason): void {
            // Notify both parties of the cancellation
            $listing = MarketplaceListing::find($order->marketplace_listing_id);
            $title   = htmlspecialchars($listing->title ?? '', ENT_QUOTES, 'UTF-8');
            $extraLines = [];
            if (!empty($reason)) {
                $extraLines[] = [
                    'key'    => 'emails_misc.marketplace_order.cancelled_reason',
                    'params' => ['reason' => htmlspecialchars($reason, ENT_QUOTES, 'UTF-8')],
                ];
            }
            $subjectKey    = 'emails_misc.marketplace_order.cancelled_subject';
            $subjectParams = ['order_number' => $order->order_number];
            $titleKey      = 'emails_misc.marketplace_order.cancelled_title';
            $bodyKey       = 'emails_misc.marketplace_order.cancelled_body';
            $bodyParams    = ['order_number' => $order->order_number, 'title' => $title];
            $link          = '/marketplace/orders/' . $order->id;
            self::deliverOrderEmail($order, 'cancelled', (int) $order->buyer_id, fn (): string => self::sendOrderEmail((int) $order->buyer_id, $subjectKey, $subjectParams, $titleKey, $bodyKey, $bodyParams, $link, $extraLines));
            self::deliverOrderEmail($order, 'cancelled', (int) $order->seller_id, fn (): string => self::sendOrderEmail((int) $order->seller_id, $subjectKey, $subjectParams, $titleKey, $bodyKey, $bodyParams, $link, $extraLines));

            // In-app bells to both parties
            $cancelLink = '/marketplace/orders/' . $order->id;
            $cancelParams = ['order_number' => $order->order_number];
            self::deliverOrderBell($order, 'cancelled', (int) $order->buyer_id, ['user_id' => $order->buyer_id, 'message_key' => 'api_controllers_3.marketplace_order.cancelled', 'message_params' => $cancelParams, 'link' => $cancelLink, 'type' => 'marketplace_order', 'created_at' => now()]);
            self::deliverOrderBell($order, 'cancelled', (int) $order->seller_id, ['user_id' => $order->seller_id, 'message_key' => 'api_controllers_3.marketplace_order.cancelled', 'message_params' => $cancelParams, 'link' => $cancelLink, 'type' => 'marketplace_order', 'created_at' => now()]);
        });

        return $order;
    }

    /**
     * Finalize an order — mark as completed and release escrow.
     */
    public static function complete(MarketplaceOrder $order): MarketplaceOrder
    {
        // Prevent double-completion (and double stat increment)
        if ($order->status === 'completed') {
            self::sendCompletedNotifications($order);
            return $order;
        }

        if (!in_array($order->status, ['delivered', 'paid', 'shipped'], true)) {
            throw new \InvalidArgumentException(__('api.marketplace_order_delivery_before_completion'));
        }

        $claimed = false;
        $order = self::withOrderTenant($order, function () use ($order, &$claimed): MarketplaceOrder {
            return DB::transaction(function () use ($order, &$claimed) {
            // A completed order must never imply that held escrow was paid out.
            // The escrow release path marks the hold released before calling
            // complete(); non-escrow payment methods have no escrow row.
            $escrow = MarketplaceEscrow::withoutGlobalScopes()
                ->where('tenant_id', $order->tenant_id)
                ->where('order_id', $order->id)
                ->lockForUpdate()
                ->first();
            if ($escrow !== null && $escrow->status !== 'released') {
                $order->refresh();
                return $order;
            }

            // Atomic claim — the in-memory status check above can race
            // (buyer confirm vs auto-release cron, or a double-click): both
            // would pass and double-increment seller stats. The status
            // predicate makes exactly one caller win.
            $updates = ['status' => 'completed'];
            if ($escrow !== null) {
                $updates['escrow_released_at'] = $escrow->released_at ?? now();
            }
            $claimedRows = MarketplaceOrder::query()
                ->whereKey($order->id)
                ->whereIn('status', ['delivered', 'paid', 'shipped'])
                ->update($updates);

            $claimed = $claimedRows > 0;
            $order->refresh();

            if (!$claimed) {
                return $order; // another request completed it first
            }

            $sellerProfile = \App\Models\MarketplaceSellerProfile::where('user_id', $order->seller_id)
                ->lockForUpdate()
                ->first();
            if ($sellerProfile) {
                $sellerProfile->increment('total_sales');
                // Revenue is queried from orders grouped by currency. The
                // legacy scalar cache cannot represent multi-currency sales.
            }

            return $order;
            });
        });

        // Race loser: stats untouched, and the winner already notified.
        if ($claimed) {
            self::sendCompletedNotifications($order);
        }

        return $order;
    }

    private static function sendCompletedNotifications(MarketplaceOrder $order): void
    {
        self::withOrderTenant($order, function () use ($order): void {
            // Notify both parties of completion
            $listing = MarketplaceListing::find($order->marketplace_listing_id);
            $title   = htmlspecialchars($listing->title ?? '', ENT_QUOTES, 'UTF-8');
            $subjectKey    = 'emails_misc.marketplace_order.completed_subject';
            $subjectParams = ['order_number' => $order->order_number];
            $titleKey      = 'emails_misc.marketplace_order.completed_title';
            $link          = '/marketplace/orders/' . $order->id;
            self::deliverOrderEmail($order, 'completed', (int) $order->buyer_id, function () use ($order, $subjectKey, $subjectParams, $titleKey, $title, $link): string {
                return self::sendOrderEmail(
                    (int) $order->buyer_id, $subjectKey, $subjectParams,
                    $titleKey,
                    'emails_misc.marketplace_order.completed_buyer_body',
                    ['order_number' => $order->order_number, 'title' => $title],
                    $link
                );
            });
            self::deliverOrderEmail($order, 'completed', (int) $order->seller_id, function () use ($order, $subjectKey, $subjectParams, $titleKey, $title, $link): string {
                return self::sendOrderEmail(
                    (int) $order->seller_id, $subjectKey, $subjectParams,
                    $titleKey,
                    'emails_misc.marketplace_order.completed_seller_body',
                    ['order_number' => $order->order_number, 'title' => $title],
                    $link
                );
            });

            // In-app bells to both parties
            $completeLink = '/marketplace/orders/' . $order->id;
            $completeParams = ['order_number' => $order->order_number];
            self::deliverOrderBell($order, 'completed', (int) $order->buyer_id, ['user_id' => $order->buyer_id, 'message_key' => 'api_controllers_3.marketplace_order.completed', 'message_params' => $completeParams, 'link' => $completeLink, 'type' => 'marketplace_order', 'created_at' => now()]);
            self::deliverOrderBell($order, 'completed', (int) $order->seller_id, ['user_id' => $order->seller_id, 'message_key' => 'api_controllers_3.marketplace_order.completed', 'message_params' => $completeParams, 'link' => $completeLink, 'type' => 'marketplace_order', 'created_at' => now()]);
        });
    }

    public static function sendPaidNotifications(MarketplaceOrder $order, \App\Models\MarketplacePayment $payment): void
    {
        self::withOrderTenant($order, function () use ($order, $payment): void {
            $listing = MarketplaceListing::find($order->marketplace_listing_id);
            $title = htmlspecialchars($listing->title ?? '', ENT_QUOTES, 'UTF-8');
            $link = '/marketplace/orders/' . $order->id;
            $currency = StripeCurrency::normalize(
                (string) ($payment->currency ?: $order->currency ?: TenantContext::getCurrency()),
            );
            $amount = StripeCurrency::formatMajor((float) $payment->amount, $currency) . ' ' . $currency;

            self::deliverOrderEmail($order, 'paid', (int) $order->buyer_id, function () use ($order, $title, $amount, $link): string {
                return self::sendOrderEmail(
                    (int) $order->buyer_id,
                    'emails_misc.marketplace_order.paid_buyer_subject',
                    ['order_number' => $order->order_number],
                    'emails_misc.marketplace_order.paid_buyer_title',
                    'emails_misc.marketplace_order.paid_buyer_body',
                    ['order_number' => $order->order_number, 'title' => $title, 'amount' => $amount],
                    $link
                );
            });
            self::deliverOrderEmail($order, 'paid', (int) $order->seller_id, function () use ($order, $title, $amount, $link): string {
                return self::sendOrderEmail(
                    (int) $order->seller_id,
                    'emails_misc.marketplace_order.paid_seller_subject',
                    ['order_number' => $order->order_number],
                    'emails_misc.marketplace_order.paid_seller_title',
                    'emails_misc.marketplace_order.paid_seller_body',
                    ['order_number' => $order->order_number, 'title' => $title, 'amount' => $amount],
                    $link
                );
            });

            self::deliverOrderBell($order, 'paid', (int) $order->buyer_id, [
                'user_id' => $order->buyer_id,
                'message_key' => 'api_controllers_3.marketplace_order.paid_buyer',
                'message_params' => ['order_number' => $order->order_number, 'amount' => $amount],
                'link' => $link,
                'type' => 'marketplace_order',
                'created_at' => now(),
            ]);
            self::deliverOrderBell($order, 'paid', (int) $order->seller_id, [
                'user_id' => $order->seller_id,
                'message_key' => 'api_controllers_3.marketplace_order.paid_seller',
                'message_params' => ['order_number' => $order->order_number, 'amount' => $amount],
                'link' => $link,
                'type' => 'marketplace_order',
                'created_at' => now(),
            ]);
        });
    }

    // -----------------------------------------------------------------
    //  Read
    // -----------------------------------------------------------------

    /**
     * Get paginated orders for a buyer.
     */
    public static function getBuyerOrders(int $userId, ?string $status, int $limit = 20, ?string $cursor = null): array
    {
        $query = MarketplaceOrder::with([
            'listing:id,title,price,price_currency,status,delivery_method',
            'listing.images' => fn ($q) => $q->where('is_primary', true)->limit(1),
            'seller:id,first_name,last_name,profile_type,organization_name,avatar_url',
        ])
            ->forBuyer($userId)
            ->orderBy('id', 'desc');

        if ($status) {
            if (str_contains($status, ',')) {
                $query->whereIn('status', explode(',', $status));
            } else {
                $query->where('status', $status);
            }
        }

        if ($cursor) {
            $query->where('id', '<', (int) base64_decode($cursor, true));
        }

        $orders = $query->limit($limit + 1)->get();
        $hasMore = $orders->count() > $limit;
        if ($hasMore) {
            $orders->pop();
        }

        return [
            'items' => $orders->map(fn ($o) => self::formatOrder($o))->all(),
            'cursor' => $hasMore && $orders->isNotEmpty() ? base64_encode((string) $orders->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get paginated orders for a seller.
     */
    public static function getSellerOrders(int $userId, ?string $status, int $limit = 20, ?string $cursor = null): array
    {
        $query = MarketplaceOrder::with([
            'listing:id,title,price,price_currency,status,delivery_method',
            'listing.images' => fn ($q) => $q->where('is_primary', true)->limit(1),
            'buyer:id,first_name,last_name,profile_type,organization_name,avatar_url',
        ])
            ->forSeller($userId)
            ->orderBy('id', 'desc');

        if ($status) {
            if (str_contains($status, ',')) {
                $query->whereIn('status', explode(',', $status));
            } else {
                $query->where('status', $status);
            }
        }

        if ($cursor) {
            $query->where('id', '<', (int) base64_decode($cursor, true));
        }

        $orders = $query->limit($limit + 1)->get();
        $hasMore = $orders->count() > $limit;
        if ($hasMore) {
            $orders->pop();
        }

        return [
            'items' => $orders->map(fn ($o) => self::formatOrder($o))->all(),
            'cursor' => $hasMore && $orders->isNotEmpty() ? base64_encode((string) $orders->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Find an order by ID.
     */
    public static function getById(int $id): ?MarketplaceOrder
    {
        return MarketplaceOrder::with([
            'listing:id,title,price,price_currency,status,delivery_method',
            'listing.images' => fn ($q) => $q->where('is_primary', true)->limit(1),
            'buyer:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'seller:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'ratings',
            'dispute',
        ])->find($id);
    }

    // -----------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------

    /**
     * Send an order email to a single user.
     *
     * Accepts translation KEYS (not resolved strings) so the email renders under
     * the recipient's preferred_language via LocaleContext.
     *
     * Optional $extraLines is a list of ['key' => ..., 'params' => [...]] entries
     * appended to the body paragraph (each prefixed with <br>). Each extra line
     * is resolved via __() under the recipient locale wrap.
     *
     * @param array<int, array{key: string, params?: array}> $extraLines
     */
    private static function sendOrderEmail(int $userId, string $subjectKey, array $subjectParams, string $titleKey, string $bodyKey, array $bodyParams, string $link, array $extraLines = []): string
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language', 'tenant_id'])->first();

        if (!$user || empty($user->email)) {
            return self::DELIVERY_STATUS_SKIPPED;
        }

        $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

        return LocaleContext::withLocale($user, function () use ($user, $subjectKey, $subjectParams, $titleKey, $bodyKey, $bodyParams, $fullUrl, $userId, $extraLines, $tenantId): string {
            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');

            $body = __($bodyKey, $bodyParams);
            foreach ($extraLines as $line) {
                $body .= '<br>' . __($line['key'], $line['params'] ?? []);
            }

            $html = EmailTemplateBuilder::make()
                ->title(__($titleKey))
                ->greeting($firstName)
                ->paragraph($body)
                ->button(__('emails_misc.marketplace_order.order_cta'), $fullUrl)
                ->render();

            if (!\App\Services\EmailDispatchService::sendRaw($user->email, __($subjectKey, $subjectParams), $html, null, null, null, 'marketplace_order', ['tenant_id' => $tenantId])) {
                Log::warning('[MarketplaceOrderService] email failed', ['user_id' => $userId]);
                return self::DELIVERY_STATUS_FAILED;
            }

            return self::DELIVERY_STATUS_DELIVERED;
        });
    }

    /**
     * Send order confirmation emails to both buyer and seller.
     */
    private static function sendOrderConfirmationEmails(MarketplaceOrder $order, string $listingTitle): void
    {
        $title      = htmlspecialchars($listingTitle, ENT_QUOTES, 'UTF-8');
        $link       = '/marketplace/orders/' . $order->id;

        self::deliverOrderEmail($order, 'confirmed', (int) $order->buyer_id, fn (): string => self::sendOrderEmail(
            (int) $order->buyer_id,
            'emails_misc.marketplace_order.confirmed_buyer_subject',
            ['order_number' => $order->order_number],
            'emails_misc.marketplace_order.confirmed_buyer_title',
            'emails_misc.marketplace_order.confirmed_buyer_body',
            ['order_number' => $order->order_number, 'title' => $title],
            $link
        ));

        self::deliverOrderEmail($order, 'confirmed', (int) $order->seller_id, fn (): string => self::sendOrderEmail(
            (int) $order->seller_id,
            'emails_misc.marketplace_order.confirmed_seller_subject',
            ['order_number' => $order->order_number],
            'emails_misc.marketplace_order.confirmed_seller_title',
            'emails_misc.marketplace_order.confirmed_seller_body',
            ['order_number' => $order->order_number, 'title' => $title],
            $link
        ));

        // In-app bells
        self::deliverOrderBell($order, 'confirmed', (int) $order->buyer_id, [
            'user_id'    => $order->buyer_id,
            'message_key' => 'api_controllers_3.marketplace_order.confirmed_buyer',
            'message_params' => ['order_number' => $order->order_number, 'title' => $title],
            'link'       => $link,
            'type'       => 'marketplace_order',
            'created_at' => now(),
        ]);
        self::deliverOrderBell($order, 'confirmed', (int) $order->seller_id, [
            'user_id'    => $order->seller_id,
            'message_key' => 'api_controllers_3.marketplace_order.confirmed_seller',
            'message_params' => ['order_number' => $order->order_number, 'title' => $title],
            'link'       => $link,
            'type'       => 'marketplace_order',
            'created_at' => now(),
        ]);
    }

    /**
     * Run marketplace side effects under the order's tenant so Eloquent scopes,
     * notification tenant resolution, URLs, and mailer config match the order.
     *
     * @template T
     * @param callable():T $callback
     * @return T
     */
    private static function withOrderTenant(MarketplaceOrder $order, callable $callback)
    {
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());

        return TenantContext::runForTenant($tenantId, $callback);
    }

    /**
     * @param array<string,mixed> $attributes
     */
    private static function deliverOrderEmail(MarketplaceOrder $order, string $event, int $userId, callable $send): void
    {
        if (!self::claimOrderNotificationDelivery($order, $event, $userId, self::DELIVERY_CHANNEL_EMAIL)) {
            return;
        }

        try {
            $status = $send();
            if ($status === self::DELIVERY_STATUS_DELIVERED || $status === self::DELIVERY_STATUS_SKIPPED) {
                self::markOrderNotificationDelivered($order, $event, $userId, self::DELIVERY_CHANNEL_EMAIL, $status);
                return;
            }

            self::markOrderNotificationFailed($order, $event, $userId, self::DELIVERY_CHANNEL_EMAIL, __('emails_misc.marketplace_order.delivery_failed'));
        } catch (\Throwable $e) {
            self::markOrderNotificationFailed($order, $event, $userId, self::DELIVERY_CHANNEL_EMAIL, $e->getMessage());
            Log::warning('[MarketplaceOrderService] order email delivery failed: ' . $e->getMessage());
        }
    }

    /**
     * @param array<string,mixed> $attributes
     */
    private static function deliverOrderBell(MarketplaceOrder $order, string $event, int $userId, array $attributes): void
    {
        if (!self::claimOrderNotificationDelivery($order, $event, $userId, self::DELIVERY_CHANNEL_BELL)) {
            return;
        }

        try {
            $notificationId = self::createOrderBell($attributes);
            if ($notificationId === null) {
                self::markOrderNotificationDelivered($order, $event, $userId, self::DELIVERY_CHANNEL_BELL, self::DELIVERY_STATUS_SKIPPED);
                return;
            }

            self::markOrderNotificationDelivered($order, $event, $userId, self::DELIVERY_CHANNEL_BELL, self::DELIVERY_STATUS_DELIVERED, (string) $notificationId);
        } catch (\Throwable $e) {
            self::markOrderNotificationFailed($order, $event, $userId, self::DELIVERY_CHANNEL_BELL, $e->getMessage());
            Log::warning('[MarketplaceOrderService] order bell delivery failed: ' . $e->getMessage());
        }
    }

    private static function claimOrderNotificationDelivery(MarketplaceOrder $order, string $event, int $userId, string $channel): bool
    {
        if ((int) ($order->id ?? 0) <= 0 || $userId <= 0 || !Schema::hasTable('marketplace_order_notification_deliveries')) {
            return $userId > 0;
        }

        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());
        $now = now();
        $staleBefore = $now->copy()->subMinutes(10);

        return DB::transaction(function () use ($tenantId, $order, $event, $userId, $channel, $now, $staleBefore): bool {
            $record = DB::table('marketplace_order_notification_deliveries')
                ->where('tenant_id', $tenantId)
                ->where('order_id', (int) $order->id)
                ->where('event', $event)
                ->where('user_id', $userId)
                ->where('channel', $channel)
                ->lockForUpdate()
                ->first();

            if (!$record) {
                DB::table('marketplace_order_notification_deliveries')->insert([
                    'tenant_id' => $tenantId,
                    'order_id' => (int) $order->id,
                    'event' => $event,
                    'user_id' => $userId,
                    'channel' => $channel,
                    'status' => self::DELIVERY_STATUS_CLAIMED,
                    'attempts' => 1,
                    'claimed_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                return true;
            }

            if (in_array($record->status, [self::DELIVERY_STATUS_DELIVERED, self::DELIVERY_STATUS_SKIPPED], true)) {
                return false;
            }

            if ($record->status === self::DELIVERY_STATUS_CLAIMED && $record->claimed_at !== null && Carbon::parse($record->claimed_at)->greaterThan($staleBefore)) {
                return false;
            }

            DB::table('marketplace_order_notification_deliveries')
                ->where('id', $record->id)
                ->update([
                    'status' => self::DELIVERY_STATUS_CLAIMED,
                    'attempts' => DB::raw('attempts + 1'),
                    'claimed_at' => $now,
                    'failed_at' => null,
                    'last_error' => null,
                    'updated_at' => $now,
                ]);

            return true;
        });
    }

    private static function markOrderNotificationDelivered(MarketplaceOrder $order, string $event, int $userId, string $channel, string $status, ?string $evidenceId = null): void
    {
        if ((int) ($order->id ?? 0) <= 0 || $userId <= 0 || !Schema::hasTable('marketplace_order_notification_deliveries')) {
            return;
        }

        DB::table('marketplace_order_notification_deliveries')
            ->where('tenant_id', (int) ($order->tenant_id ?: TenantContext::getId()))
            ->where('order_id', (int) $order->id)
            ->where('event', $event)
            ->where('user_id', $userId)
            ->where('channel', $channel)
            ->update([
                'status' => $status,
                'delivered_at' => $status === self::DELIVERY_STATUS_DELIVERED ? now() : null,
                'failed_at' => null,
                'evidence_id' => $evidenceId,
                'last_error' => null,
                'updated_at' => now(),
            ]);
    }

    private static function markOrderNotificationFailed(MarketplaceOrder $order, string $event, int $userId, string $channel, string $error): void
    {
        if ((int) ($order->id ?? 0) <= 0 || $userId <= 0 || !Schema::hasTable('marketplace_order_notification_deliveries')) {
            return;
        }

        DB::table('marketplace_order_notification_deliveries')
            ->where('tenant_id', (int) ($order->tenant_id ?: TenantContext::getId()))
            ->where('order_id', (int) $order->id)
            ->where('event', $event)
            ->where('user_id', $userId)
            ->where('channel', $channel)
            ->update([
                'status' => self::DELIVERY_STATUS_FAILED,
                'failed_at' => now(),
                'last_error' => mb_substr($error, 0, 2000),
                'updated_at' => now(),
            ]);
    }

    /**
     * @param array<string,mixed> $attributes
     */
    private static function createOrderBell(array $attributes): ?int
    {
        $userId = (int) ($attributes['user_id'] ?? 0);
        if ($userId <= 0) {
            Log::warning('[MarketplaceOrderService] skipped marketplace bell without recipient', [
                'type' => $attributes['type'] ?? null,
                'link' => $attributes['link'] ?? null,
            ]);
            return null;
        }

        $messageKey = (string) ($attributes['message_key'] ?? '');
        $messageParams = is_array($attributes['message_params'] ?? null)
            ? $attributes['message_params']
            : [];
        unset($attributes['message_key'], $attributes['message_params']);

        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->select(['id', 'preferred_language'])
            ->first();
        if (! $recipient) {
            return null;
        }

        return (int) LocaleContext::withLocale($recipient, function () use ($attributes, $messageKey, $messageParams): int {
            $localized = $attributes;
            if ($messageKey !== '') {
                $localized['message'] = __($messageKey, $messageParams);
            }

            return (int) Notification::create($localized)->id;
        });
    }

    /** Generate a concurrency-safe, non-enumerable marketplace order number. */
    public static function generateOrderNumber(int $tenantId): string
    {
        return 'MKT-' . strtoupper((string) Str::ulid());
    }

    /**
     * Format an order for API responses.
     */
    public static function formatOrder(MarketplaceOrder $order): array
    {
        $listing = $order->relationLoaded('listing') ? $order->listing : null;
        $primaryImage = $listing && $listing->relationLoaded('images')
            ? $listing->images->first()
            : null;

        return [
            'id' => $order->id,
            'order_number' => $order->order_number,
            'status' => $order->status,
            'quantity' => $order->quantity,
            'unit_price' => (float) $order->unit_price,
            'total_price' => (float) $order->total_price,
            'currency' => $order->currency,
            'time_credits_used' => $order->time_credits_used !== null
                ? (float) $order->time_credits_used
                : null,
            'wallet_transaction_id' => $order->wallet_transaction_id,
            'wallet_refund_transaction_id' => $order->wallet_refund_transaction_id,
            'loyalty_redemption_id' => $order->loyalty_redemption_id,
            'payment_method' => $order->wallet_transaction_id !== null
                ? 'time_credits'
                : ((float) $order->total_price <= 0 ? 'free' : 'cash'),
            'requires_payment' => $order->status === 'pending_payment'
                && $order->wallet_transaction_id === null
                && (float) $order->total_price > 0,
            'payment_expires_at' => $order->payment_expires_at?->toISOString(),
            'shipping_method' => $order->shipping_method,
            'shipping_option_id' => $order->shipping_option_id,
            'shipping_cost' => $order->shipping_cost !== null
                ? (float) $order->shipping_cost
                : null,
            'tracking_number' => $order->tracking_number,
            'tracking_url' => $order->tracking_url,
            'delivery_address' => $order->delivery_address,
            'delivery_notes' => $order->delivery_notes,
            'buyer_confirmed_at' => $order->buyer_confirmed_at?->toISOString(),
            'seller_confirmed_at' => $order->seller_confirmed_at?->toISOString(),
            'auto_complete_at' => $order->auto_complete_at?->toISOString(),
            'cancelled_at' => $order->cancelled_at?->toISOString(),
            'cancellation_reason' => $order->cancellation_reason,
            'escrow_released_at' => $order->escrow_released_at?->toISOString(),
            'created_at' => $order->created_at?->toISOString(),
            'updated_at' => $order->updated_at?->toISOString(),
            'listing' => $listing ? [
                'id' => $listing->id,
                'title' => $listing->title,
                'price' => $listing->price !== null ? (float) $listing->price : null,
                'price_currency' => $listing->price_currency,
                'status' => $listing->status,
                'delivery_method' => $listing->delivery_method,
                'image' => $primaryImage ? [
                    'url' => $primaryImage->image_url,
                    'thumbnail_url' => $primaryImage->thumbnail_url,
                ] : null,
            ] : null,
            'buyer' => $order->relationLoaded('buyer') && $order->buyer ? [
                'id' => $order->buyer->id,
                'name' => UserDisplayName::resolve($order->buyer),
                'avatar_url' => $order->buyer->avatar_url,
            ] : null,
            'seller' => $order->relationLoaded('seller') && $order->seller ? [
                'id' => $order->seller->id,
                'name' => UserDisplayName::resolve($order->seller),
                'avatar_url' => $order->seller->avatar_url,
            ] : null,
            'ratings' => $order->relationLoaded('ratings')
                ? $order->ratings->map(fn ($r) => [
                    'id' => $r->id,
                    'rater_role' => $r->rater_role,
                    'rating' => $r->rating,
                    'comment' => $r->is_anonymous ? null : $r->comment,
                    'is_anonymous' => $r->is_anonymous,
                    'created_at' => $r->created_at?->toISOString(),
                ])->all()
                : [],
            'dispute' => $order->relationLoaded('dispute') && $order->dispute ? [
                'id' => $order->dispute->id,
                'reason' => $order->dispute->reason,
                'status' => $order->dispute->status,
                'created_at' => $order->dispute->created_at?->toISOString(),
            ] : null,
        ];
    }
}
