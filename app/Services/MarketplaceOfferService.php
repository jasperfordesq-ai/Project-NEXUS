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
use App\Models\MarketplaceListing;
use App\Models\MarketplaceOffer;
use App\Models\MarketplaceOrder;
use App\Models\MarketplaceSellerProfile;
use App\Models\Notification;
use App\Support\StripeCurrency;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * MarketplaceOfferService — Offer/negotiation lifecycle for the marketplace module.
 *
 * Handles: create offer → accept / decline / counter → expiry.
 */
class MarketplaceOfferService
{
    private const ACCEPTED_CHECKOUT_TTL_DAYS = 2;

    /**
     * Create a new offer on a marketplace listing.
     */
    public static function create(int $buyerId, int $listingId, array $data): MarketplaceOffer
    {
        $tenantId = (int) MarketplaceListing::withoutGlobalScopes()
            ->whereKey($listingId)
            ->value('tenant_id');
        if ($tenantId <= 0) {
            throw new \InvalidArgumentException(__('api.marketplace_listing_unavailable_for_purchase'));
        }

        return TenantContext::runForTenant($tenantId, function () use ($buyerId, $listingId, $data, $tenantId): MarketplaceOffer {
            [$offer, $listing] = DB::transaction(function () use ($buyerId, $listingId, $data, $tenantId): array {
                // The listing row is the serialization point for offer creation.
                // Concurrent retries for the same buyer/listing cannot both pass
                // the active-offer check while this lock is held.
                $listing = MarketplaceListing::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($listingId)
                    ->lockForUpdate()
                    ->first();
                if (! $listing) {
                    throw new \InvalidArgumentException(__('api.marketplace_listing_unavailable_for_purchase'));
                }
                self::assertListingOfferable($listing);

                $buyerBelongsToTenant = DB::table('users')
                    ->where('id', $buyerId)
                    ->where('tenant_id', $tenantId)
                    ->exists();
                if (! $buyerBelongsToTenant) {
                    throw new \InvalidArgumentException(__('api_controllers_2.marketplace_offer.buyer_tenant_mismatch'));
                }
                if ((int) $listing->user_id === $buyerId) {
                    throw new \InvalidArgumentException(__('api.marketplace_offer_own_listing'));
                }

                $currency = StripeCurrency::normalize(
                    (string) ($listing->price_currency ?: TenantContext::getCurrency()),
                );
                if (isset($data['currency'])
                    && StripeCurrency::normalize((string) $data['currency']) !== $currency) {
                    throw new \InvalidArgumentException(__('api.marketplace_offer_currency_mismatch'));
                }
                $amount = self::normalizeOfferAmount((float) $data['amount'], $currency);

                app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $buyerId,
                    (int) $listing->user_id,
                    $tenantId,
                    'marketplace_offer',
                );

                $existingOffer = MarketplaceOffer::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('marketplace_listing_id', $listingId)
                    ->where('buyer_id', $buyerId)
                    ->whereIn('status', ['pending', 'countered'])
                    ->first();
                if ($existingOffer) {
                    throw new \InvalidArgumentException(__('api.marketplace_offer_duplicate_active'));
                }

                $offer = new MarketplaceOffer();
                $offer->tenant_id = $tenantId;
                $offer->marketplace_listing_id = $listingId;
                $offer->buyer_id = $buyerId;
                $offer->seller_id = $listing->user_id;
                $offer->amount = $amount;
                $offer->currency = $currency;
                $offer->message = $data['message'] ?? null;
                $offer->status = 'pending';
                $offer->expires_at = now()->addDays(2);
                $offer->save();

                $listing->increment('contacts_count');

                return [$offer, $listing];
            }, 3);

            // Notify seller of the new offer
            try {
                $buyerName = self::userName($buyerId);
                $amount = self::formatOfferAmount((float) $offer->amount, (string) $offer->currency);
                self::sendOfferEmail(
                    (int) $listing->user_id,
                    'emails_misc.marketplace_offer.received_subject',
                    'emails_misc.marketplace_offer.received_title',
                    'emails_misc.marketplace_offer.received_body',
                    ['title' => $listing->title, 'buyer' => $buyerName, 'amount' => $amount],
                    ['title' => $listing->title],
                    '/marketplace/listings/' . $listingId,
                    'emails_misc.marketplace_offer.received_cta'
                );
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceOfferService] create email failed: ' . $e->getMessage());
            }

            // In-app bell to seller
            self::sendOfferBell(
                (int) $listing->user_id,
                $tenantId,
                'api_controllers_3.marketplace_offer.received',
                ['buyer' => self::userName($buyerId), 'amount' => self::formatOfferAmount((float) $offer->amount, (string) $offer->currency), 'title' => $listing->title],
                '/marketplace/listings/' . $listingId
            );

            return $offer;
        });
    }

    /**
     * Accept an offer.
     */
    public static function accept(MarketplaceOffer $offer, int $sellerId): MarketplaceOffer
    {
        self::assertSellerOwns($offer, $sellerId);
        if (! $offer->exists) {
            self::assertOfferPreflightActionable($offer);
        }

        return self::withOfferTenant($offer, function () use ($offer, $sellerId): MarketplaceOffer {
            [$offer, $listing] = self::withLockedOffer(
                $offer,
                function (MarketplaceOffer $lockedOffer, MarketplaceListing $lockedListing) use ($sellerId): void {
                    self::assertSellerOwns($lockedOffer, $sellerId);
                    self::assertOfferActionable($lockedOffer);
                    self::assertListingOfferable($lockedListing);

                    $lockedOffer->status = 'accepted';
                    $lockedOffer->accepted_at = now();
                    $lockedOffer->expires_at = now()->addDays(self::ACCEPTED_CHECKOUT_TTL_DAYS);
                    $lockedOffer->save();

                    $lockedListing->status = 'reserved';
                    $lockedListing->save();

                    MarketplaceOffer::withoutGlobalScopes()
                        ->where('tenant_id', $lockedOffer->tenant_id)
                        ->where('marketplace_listing_id', $lockedOffer->marketplace_listing_id)
                        ->where('id', '!=', $lockedOffer->id)
                        ->whereIn('status', ['pending', 'countered'])
                        ->update(['status' => 'declined']);
                }
            );
            $tenantId = (int) $offer->tenant_id;

            // Notify buyer their offer was accepted
            try {
                $amount = self::formatOfferAmount((float) $offer->amount, (string) $offer->currency);
                self::sendOfferEmail(
                    (int) $offer->buyer_id,
                    'emails_misc.marketplace_offer.accepted_subject',
                    'emails_misc.marketplace_offer.accepted_title',
                    'emails_misc.marketplace_offer.accepted_body',
                    ['title' => $listing->title ?? '', 'amount' => $amount],
                    ['title' => $listing->title ?? ''],
                    '/marketplace/orders',
                    'emails_misc.marketplace_offer.accepted_cta'
                );
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceOfferService] accept email failed: ' . $e->getMessage());
            }

            // In-app bell to buyer
            self::sendOfferBell(
                (int) $offer->buyer_id,
                $tenantId,
                'api_controllers_3.marketplace_offer.accepted',
                ['title' => $listing->title ?? ''],
                '/marketplace/orders'
            );

            return $offer;
        });
    }

    /**
     * Decline an offer.
     */
    public static function decline(MarketplaceOffer $offer, int $sellerId): MarketplaceOffer
    {
        self::assertSellerOwns($offer, $sellerId);
        if (! $offer->exists) {
            self::assertOfferPreflightActionable($offer);
        }

        return self::withOfferTenant($offer, function () use ($offer, $sellerId): MarketplaceOffer {
            [$offer, $listing] = self::withLockedOffer(
                $offer,
                function (MarketplaceOffer $lockedOffer) use ($sellerId): void {
                    self::assertSellerOwns($lockedOffer, $sellerId);
                    self::assertOfferActionable($lockedOffer);
                    $lockedOffer->status = 'declined';
                    $lockedOffer->save();
                }
            );
            $tenantId = (int) $offer->tenant_id;

            // Notify buyer their offer was declined
            try {
                self::sendOfferEmail(
                    (int) $offer->buyer_id,
                    'emails_misc.marketplace_offer.declined_subject',
                    'emails_misc.marketplace_offer.declined_title',
                    'emails_misc.marketplace_offer.declined_body',
                    ['title' => $listing->title ?? ''],
                    ['title' => $listing->title ?? ''],
                    '/marketplace/listings/' . $offer->marketplace_listing_id,
                    'emails_misc.marketplace_offer.declined_cta'
                );
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceOfferService] decline email failed: ' . $e->getMessage());
            }

            // In-app bell to buyer
            self::sendOfferBell(
                (int) $offer->buyer_id,
                $tenantId,
                'api_controllers_3.marketplace_offer.declined',
                ['title' => $listing->title ?? ''],
                '/marketplace/listings/' . $offer->marketplace_listing_id
            );

            return $offer;
        });
    }

    /**
     * Counter an offer with a new amount.
     */
    public static function counter(MarketplaceOffer $offer, int $sellerId, array $data): MarketplaceOffer
    {
        self::assertSellerOwns($offer, $sellerId);
        if (! $offer->exists) {
            self::assertOfferPreflightActionable($offer);
            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $sellerId,
                (int) $offer->buyer_id,
                (int) $offer->tenant_id,
                'marketplace_counter_offer',
            );
            throw new \InvalidArgumentException(__('api.marketplace_offer_status_invalid', ['status' => $offer->status]));
        }

        return self::withOfferTenant($offer, function () use ($offer, $sellerId, $data): MarketplaceOffer {
            [$offer, $listing] = self::withLockedOffer(
                $offer,
                function (MarketplaceOffer $lockedOffer, MarketplaceListing $lockedListing) use ($sellerId, $data): void {
                    self::assertSellerOwns($lockedOffer, $sellerId);
                    self::assertOfferActionable($lockedOffer);
                    self::assertListingOfferable($lockedListing);
                    app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                        $sellerId,
                        (int) $lockedOffer->buyer_id,
                        (int) $lockedOffer->tenant_id,
                        'marketplace_counter_offer',
                    );

                    $currency = StripeCurrency::normalize((string) $lockedOffer->currency);
                    if ($currency !== StripeCurrency::normalize(
                        (string) ($lockedListing->price_currency ?: TenantContext::getCurrency()),
                    )) {
                        throw new \InvalidArgumentException(__('api.marketplace_offer_currency_mismatch'));
                    }
                    $amount = self::normalizeOfferAmount((float) $data['amount'], $currency);

                    $lockedOffer->status = 'countered';
                    $lockedOffer->counter_amount = $amount;
                    $lockedOffer->counter_message = $data['message'] ?? null;
                    $lockedOffer->expires_at = now()->addDays(2);
                    $lockedOffer->save();
                }
            );
            $tenantId = (int) $offer->tenant_id;

            // Notify buyer about the counter-offer
            try {
                $amount = self::formatOfferAmount((float) $offer->counter_amount, (string) $offer->currency);
                self::sendOfferEmail(
                    (int) $offer->buyer_id,
                    'emails_misc.marketplace_offer.countered_subject',
                    'emails_misc.marketplace_offer.countered_title',
                    'emails_misc.marketplace_offer.countered_body',
                    ['title' => $listing->title ?? '', 'amount' => $amount],
                    ['title' => $listing->title ?? ''],
                    '/marketplace/offers',
                    'emails_misc.marketplace_offer.countered_cta'
                );
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceOfferService] counter email failed: ' . $e->getMessage());
            }

            // In-app bell to buyer
            $counterAmount = self::formatOfferAmount((float) $offer->counter_amount, (string) $offer->currency);
            self::sendOfferBell(
                (int) $offer->buyer_id,
                $tenantId,
                'api_controllers_3.marketplace_offer.countered',
                ['title' => $listing->title ?? '', 'amount' => $counterAmount],
                '/marketplace/offers'
            );

            return $offer;
        });
    }

    /**
     * Withdraw an offer (buyer action).
     */
    public static function withdraw(MarketplaceOffer $offer, int $buyerId): MarketplaceOffer
    {
        if ($offer->buyer_id !== $buyerId) {
            throw new \InvalidArgumentException(__('api_controllers_2.marketplace_offer.only_buyer_withdraw'));
        }
        if (! $offer->exists) {
            self::assertOfferPreflightActionable($offer);
        }

        return self::withOfferTenant($offer, function () use ($offer, $buyerId): MarketplaceOffer {
            [$offer, $listing] = self::withLockedOffer(
                $offer,
                function (MarketplaceOffer $lockedOffer) use ($buyerId): void {
                    if ($lockedOffer->buyer_id !== $buyerId) {
                        throw new \InvalidArgumentException(__('api_controllers_2.marketplace_offer.only_buyer_withdraw'));
                    }
                    self::assertOfferActionable($lockedOffer);
                    $lockedOffer->status = 'withdrawn';
                    $lockedOffer->save();
                }
            );
            $tenantId = (int) $offer->tenant_id;

            // In-app bell to seller
            self::sendOfferBell(
                (int) $offer->seller_id,
                $tenantId,
                'api_controllers_3.marketplace_offer.withdrawn',
                ['buyer' => self::userName($buyerId), 'title' => $listing->title ?? ''],
                '/marketplace/listings/' . $offer->marketplace_listing_id
            );

            return $offer;
        });
    }

    /**
     * Accept a counter-offer (buyer action).
     */
    public static function acceptCounter(MarketplaceOffer $offer, int $buyerId): MarketplaceOffer
    {
        if ($offer->buyer_id !== $buyerId) {
            throw new \InvalidArgumentException(__('api_controllers_2.marketplace_offer.only_buyer_accept_counter'));
        }
        if (! $offer->exists) {
            if ($offer->status !== 'countered') {
                throw new \InvalidArgumentException(__('api.marketplace_offer_not_countered'));
            }
            self::assertOfferPreflightActionable($offer);
        }

        return self::withOfferTenant($offer, function () use ($offer, $buyerId): MarketplaceOffer {
            [$offer, $listing] = self::withLockedOffer(
                $offer,
                function (MarketplaceOffer $lockedOffer, MarketplaceListing $lockedListing) use ($buyerId): void {
                    if ($lockedOffer->buyer_id !== $buyerId) {
                        throw new \InvalidArgumentException(__('api_controllers_2.marketplace_offer.only_buyer_accept_counter'));
                    }
                    if ($lockedOffer->status !== 'countered') {
                        throw new \InvalidArgumentException(__('api.marketplace_offer_not_countered'));
                    }
                    self::assertOfferActionable($lockedOffer);
                    self::assertListingOfferable($lockedListing);

                    $currency = StripeCurrency::normalize((string) $lockedOffer->currency);
                    if ($currency !== StripeCurrency::normalize(
                        (string) ($lockedListing->price_currency ?: TenantContext::getCurrency()),
                    )) {
                        throw new \InvalidArgumentException(__('api.marketplace_offer_currency_mismatch'));
                    }
                    $acceptedAmount = self::normalizeOfferAmount(
                        (float) $lockedOffer->counter_amount,
                        $currency,
                    );

                    $lockedOffer->status = 'accepted';
                    $lockedOffer->amount = $acceptedAmount;
                    $lockedOffer->accepted_at = now();
                    $lockedOffer->expires_at = now()->addDays(self::ACCEPTED_CHECKOUT_TTL_DAYS);
                    $lockedOffer->save();

                    $lockedListing->status = 'reserved';
                    $lockedListing->save();

                    MarketplaceOffer::withoutGlobalScopes()
                        ->where('tenant_id', $lockedOffer->tenant_id)
                        ->where('marketplace_listing_id', $lockedOffer->marketplace_listing_id)
                        ->where('id', '!=', $lockedOffer->id)
                        ->whereIn('status', ['pending', 'countered'])
                        ->update(['status' => 'declined']);
                }
            );
            $tenantId = (int) $offer->tenant_id;

            // Notify seller their counter-offer was accepted
            try {
                $amount = self::formatOfferAmount((float) $offer->amount, (string) $offer->currency);
                self::sendOfferEmail(
                    (int) $offer->seller_id,
                    'emails_misc.marketplace_offer.counter_accepted_subject',
                    'emails_misc.marketplace_offer.counter_accepted_title',
                    'emails_misc.marketplace_offer.counter_accepted_body',
                    ['title' => $listing->title ?? '', 'amount' => $amount],
                    ['title' => $listing->title ?? ''],
                    '/marketplace/orders',
                    'emails_misc.marketplace_offer.counter_accepted_cta'
                );
            } catch (\Throwable $e) {
                Log::warning('[MarketplaceOfferService] acceptCounter email failed: ' . $e->getMessage());
            }

            // In-app bell to seller
            self::sendOfferBell(
                (int) $offer->seller_id,
                $tenantId,
                'api_controllers_3.marketplace_offer.counter_accepted',
                ['title' => $listing->title ?? ''],
                '/marketplace/orders'
            );

            return $offer;
        });
    }

    // -----------------------------------------------------------------
    //  Read
    // -----------------------------------------------------------------

    /**
     * Get offers for a listing (seller view).
     */
    public static function getOffersForListing(int $listingId, int $sellerId): array
    {
        $offers = MarketplaceOffer::with('buyer:id,first_name,last_name,profile_type,organization_name,avatar_url')
            ->where('marketplace_listing_id', $listingId)
            ->where('seller_id', $sellerId)
            ->orderBy('id', 'desc')
            ->get();

        return $offers->map(fn ($o) => self::formatOffer($o))->all();
    }

    /**
     * Get buyer's sent offers.
     */
    public static function getSentOffers(int $buyerId, int $limit = 20, ?string $cursor = null): array
    {
        $query = MarketplaceOffer::with([
            'listing:id,title,price,price_currency,status,shipping_available,local_pickup,delivery_method',
            'listing.images' => fn ($q) => $q->where('is_primary', true)->limit(1),
            'seller:id,first_name,last_name,profile_type,organization_name,avatar_url',
        ])
            ->where('buyer_id', $buyerId)
            ->orderBy('id', 'desc');

        if ($cursor) {
            $query->where('id', '<', (int) base64_decode($cursor, true));
        }

        $offers = $query->limit($limit + 1)->get();
        $hasMore = $offers->count() > $limit;
        if ($hasMore) {
            $offers->pop();
        }

        return [
            'items' => $offers->map(fn ($o) => self::formatOffer($o))->all(),
            'cursor' => $hasMore && $offers->isNotEmpty() ? base64_encode((string) $offers->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get seller's received offers.
     */
    public static function getReceivedOffers(int $sellerId, int $limit = 20, ?string $cursor = null): array
    {
        $query = MarketplaceOffer::with([
            'listing:id,title,price,price_currency,status,shipping_available,local_pickup,delivery_method',
            'listing.images' => fn ($q) => $q->where('is_primary', true)->limit(1),
            'buyer:id,first_name,last_name,profile_type,organization_name,avatar_url',
        ])
            ->where('seller_id', $sellerId)
            ->orderBy('id', 'desc');

        if ($cursor) {
            $query->where('id', '<', (int) base64_decode($cursor, true));
        }

        $offers = $query->limit($limit + 1)->get();
        $hasMore = $offers->count() > $limit;
        if ($hasMore) {
            $offers->pop();
        }

        return [
            'items' => $offers->map(fn ($o) => self::formatOffer($o))->all(),
            'cursor' => $hasMore && $offers->isNotEmpty() ? base64_encode((string) $offers->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    // -----------------------------------------------------------------
    //  Expire stale offers (called from scheduler)
    // -----------------------------------------------------------------

    /**
     * Expire all offers past their expiry date.
     */
    public static function expireStaleOffers(): int
    {
        $expired = MarketplaceOffer::withoutGlobalScopes()
            ->whereIn('status', ['pending', 'countered'])
            ->where('expires_at', '<', now())
            ->update(['status' => 'expired']);

        $acceptedIds = MarketplaceOffer::withoutGlobalScopes()
            ->where('status', 'accepted')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->orderBy('id')
            ->pluck('id');

        foreach ($acceptedIds as $offerId) {
            $expiredAccepted = false;
            $releasedListing = DB::transaction(function () use ($offerId, &$expiredAccepted): ?MarketplaceListing {
                $offer = MarketplaceOffer::withoutGlobalScopes()
                    ->whereKey((int) $offerId)
                    ->lockForUpdate()
                    ->first();
                if (! $offer
                    || (string) $offer->status !== 'accepted'
                    || $offer->expires_at === null
                    || $offer->expires_at->isFuture()) {
                    return null;
                }

                // A captured or otherwise non-cancelled order is durable proof
                // that the accepted offer was converted. Do not expire that
                // commercial record merely because its checkout deadline passed.
                $hasConvertedOrder = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $offer->tenant_id)
                    ->where('marketplace_offer_id', $offer->id)
                    ->where('status', '!=', 'cancelled')
                    ->exists();
                if ($hasConvertedOrder) {
                    return null;
                }

                $listing = MarketplaceListing::withoutGlobalScopes()
                    ->where('tenant_id', $offer->tenant_id)
                    ->whereKey($offer->marketplace_listing_id)
                    ->lockForUpdate()
                    ->first();

                $offer->status = 'expired';
                $offer->save();
                $expiredAccepted = true;

                if (! $listing
                    || (int) $listing->user_id !== (int) $offer->seller_id
                    || (string) $listing->status !== 'reserved') {
                    return null;
                }

                if ($listing->expires_at !== null && $listing->expires_at->isPast()) {
                    $listing->status = 'expired';
                } elseif ($listing->inventory_count !== null
                    && (int) $listing->inventory_count <= 0) {
                    $listing->status = 'sold';
                } else {
                    // Moderation remains authoritative: an active pending/rejected
                    // listing is still excluded by every public visibility query.
                    $listing->status = 'active';
                }
                $listing->save();

                return $listing;
            });

            if ($expiredAccepted) {
                $expired++;
            }

            if (! $releasedListing) {
                continue;
            }

            try {
                if ((string) $releasedListing->status === 'active'
                    && (string) $releasedListing->moderation_status === 'approved') {
                    SearchService::indexMarketplaceListing($releasedListing);
                } else {
                    SearchService::removeMarketplaceListing((int) $releasedListing->id);
                }
            } catch (\Throwable $exception) {
                Log::warning('[MarketplaceOfferService] expired-offer search refresh failed', [
                    'offer_id' => (int) $offerId,
                    'listing_id' => (int) $releasedListing->id,
                    'error' => $exception->getMessage(),
                ]);
            }
        }

        return $expired;
    }

    // -----------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------

    // -----------------------------------------------------------------
    //  Email helpers
    // -----------------------------------------------------------------

    /** Validate and normalize an offer amount without rounding it to zero. */
    private static function normalizeOfferAmount(float $amount, string $currency): float
    {
        $minor = StripeCurrency::toMinor($amount, $currency);
        if ($minor <= 0) {
            throw new \InvalidArgumentException(__('api.marketplace_offer_amount_invalid'));
        }

        return StripeCurrency::fromMinor($minor, $currency);
    }

    private static function formatOfferAmount(float $amount, string $currency): string
    {
        $currency = StripeCurrency::normalize($currency);
        return StripeCurrency::formatMajor($amount, $currency) . ' ' . $currency;
    }

    /**
     * Send a marketplace offer email to a user.
     *
     * @param int    $userId       Recipient user ID
     * @param string $subjectKey   Translation key for email subject
     * @param string $titleKey     Translation key for email title
     * @param string $bodyKey      Translation key for email body paragraph
     * @param array  $bodyParams   Body translation params
     * @param array  $subjectParams Subject translation params (subset of bodyParams)
     * @param string $link         Relative path for CTA button
     * @param string $ctaKey       Translation key for CTA button text
     */
    private static function sendOfferEmail(int $userId, string $subjectKey, string $titleKey, string $bodyKey, array $bodyParams, array $subjectParams, string $link, string $ctaKey): void
    {
        $tenantId = TenantContext::getId();
        $user     = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();

        if (!$user || empty($user->email)) {
            return;
        }

        $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

        LocaleContext::withLocale($user, function () use ($user, $subjectKey, $subjectParams, $titleKey, $bodyKey, $bodyParams, $ctaKey, $fullUrl, $userId, $tenantId): void {
            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
            $localizedBodyParams = self::localizeOfferParams($bodyParams);
            $localizedSubjectParams = self::localizeOfferParams($subjectParams);

            $html = EmailTemplateBuilder::make()
                ->title(__($titleKey))
                ->greeting($firstName)
                ->paragraph(__($bodyKey, $localizedBodyParams))
                ->button(__($ctaKey), $fullUrl)
                ->render();

            if (!\App\Services\EmailDispatchService::sendRaw($user->email, __($subjectKey, $localizedSubjectParams), $html, null, null, null, 'marketplace_offer', ['tenant_id' => $tenantId])) {
                Log::warning('[MarketplaceOfferService] email failed', ['user_id' => $userId, 'subject_key' => $subjectKey]);
            }
        });
    }

    /**
     * Render and persist an offer bell in the recipient's preferred locale.
     *
     * @param array<string, mixed> $messageParams
     */
    private static function sendOfferBell(int $userId, int $tenantId, string $messageKey, array $messageParams, string $link): void
    {
        $recipient = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'preferred_language'])
            ->first();

        if (!$recipient) {
            return;
        }

        LocaleContext::withLocale($recipient, function () use ($userId, $tenantId, $messageKey, $messageParams, $link): void {
            $localizedMessageParams = self::localizeOfferParams($messageParams);

            Notification::create([
                'tenant_id'  => $tenantId,
                'user_id'    => $userId,
                'message'    => __($messageKey, $localizedMessageParams),
                'link'       => $link,
                'type'       => 'marketplace_offer',
                'created_at' => now(),
            ]);
        });
    }

    private static function userName(int $userId): string
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
            ->first();
        if (!$user) {
            return '';
        }
        $full = UserDisplayName::resolve($user);
        return $full ?: ($user->name ?? '');
    }

    /**
     * Apply locale-sensitive fallback values while the recipient locale is active.
     *
     * @param array<string, mixed> $params
     * @return array<string, mixed>
     */
    private static function localizeOfferParams(array $params): array
    {
        if (array_key_exists('buyer', $params) && trim((string) $params['buyer']) === '') {
            $params['buyer'] = __('emails.common.fallback_member_name');
        }

        return $params;
    }

    private static function withOfferTenant(MarketplaceOffer $offer, callable $callback): mixed
    {
        $tenantId = (int) ($offer->tenant_id ?: TenantContext::getId());

        return TenantContext::runForTenant($tenantId, $callback);
    }

    /**
     * Lock the current offer and its listing in the same order used by order
     * creation, then run one atomic state transition.
     *
     * @param callable(MarketplaceOffer, MarketplaceListing):void $transition
     * @return array{0: MarketplaceOffer, 1: MarketplaceListing}
     */
    private static function withLockedOffer(MarketplaceOffer $offer, callable $transition): array
    {
        if (! $offer->exists || ! $offer->id) {
            throw new \InvalidArgumentException(__('api.marketplace_offer_status_invalid', [
                'status' => $offer->status,
            ]));
        }

        $tenantId = (int) ($offer->tenant_id ?: TenantContext::getId());

        return DB::transaction(function () use ($offer, $transition, $tenantId): array {
            $lockedOffer = MarketplaceOffer::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($offer->id)
                ->lockForUpdate()
                ->first();
            if (! $lockedOffer) {
                throw new \InvalidArgumentException(__('api.marketplace_offer_status_invalid', [
                    'status' => $offer->status,
                ]));
            }

            $lockedListing = MarketplaceListing::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($lockedOffer->marketplace_listing_id)
                ->lockForUpdate()
                ->first();
            if (! $lockedListing
                || (int) $lockedListing->user_id !== (int) $lockedOffer->seller_id) {
                throw new \InvalidArgumentException(__('api.marketplace_listing_unavailable_for_purchase'));
            }

            $transition($lockedOffer, $lockedListing);

            $lockedOffer->refresh();
            $lockedListing->refresh();

            return [$lockedOffer, $lockedListing];
        }, 3);
    }

    /** Apply the same public availability boundary throughout offer negotiation. */
    private static function assertListingOfferable(MarketplaceListing $listing): void
    {
        if ((string) $listing->status !== 'active') {
            throw new \InvalidArgumentException(__('api.marketplace_listing_unavailable_for_purchase'));
        }
        if ((string) $listing->moderation_status !== 'approved') {
            throw new \InvalidArgumentException(__('api.marketplace_listing_not_approved'));
        }
        if ($listing->expires_at !== null && $listing->expires_at->isPast()) {
            throw new \InvalidArgumentException(__('api.marketplace_listing_expired'));
        }

        $tenantId = (int) $listing->tenant_id;
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
        if ((string) $sellerStatus !== 'active') {
            throw new \InvalidArgumentException(__('api.marketplace_seller_transactions_unavailable'));
        }
    }

    private static function assertSellerOwns(MarketplaceOffer $offer, int $sellerId): void
    {
        if ($offer->seller_id !== $sellerId) {
            throw new \InvalidArgumentException(__('api.marketplace_offer_seller_required'));
        }
    }

    private static function assertOfferActionable(MarketplaceOffer $offer): void
    {
        if (!in_array($offer->status, ['pending', 'countered'], true)) {
            throw new \InvalidArgumentException(__('api.marketplace_offer_status_invalid', ['status' => $offer->status]));
        }

        if ($offer->expires_at && $offer->expires_at < now()) {
            throw new \InvalidArgumentException(__('api.marketplace_offer_expired'));
        }
    }

    /** Fast rejection for stale controller models; the locked row is rechecked. */
    private static function assertOfferPreflightActionable(MarketplaceOffer $offer): void
    {
        self::assertOfferActionable($offer);
    }

    private static function formatOffer(MarketplaceOffer $offer): array
    {
        $listing = $offer->relationLoaded('listing') ? $offer->listing : null;
        $primaryImage = $listing && $listing->relationLoaded('images')
            ? $listing->images->first()
            : null;

        return [
            'id' => $offer->id,
            'amount' => $offer->amount,
            'currency' => $offer->currency,
            'message' => $offer->message,
            'status' => $offer->status,
            'counter_amount' => $offer->counter_amount,
            'counter_message' => $offer->counter_message,
            'expires_at' => $offer->expires_at?->toISOString(),
            'accepted_at' => $offer->accepted_at?->toISOString(),
            'created_at' => $offer->created_at?->toISOString(),
            'listing' => $listing ? [
                'id' => $listing->id,
                'title' => $listing->title,
                'price' => $listing->price !== null ? (float) $listing->price : null,
                'price_currency' => $listing->price_currency,
                'status' => $listing->status,
                'shipping_available' => (bool) $listing->shipping_available,
                'local_pickup' => (bool) $listing->local_pickup,
                'delivery_method' => (string) $listing->delivery_method,
                'image' => $primaryImage ? [
                    'url' => $primaryImage->image_url,
                    'thumbnail_url' => $primaryImage->thumbnail_url,
                ] : null,
            ] : null,
            'buyer' => $offer->relationLoaded('buyer') && $offer->buyer ? [
                'id' => $offer->buyer->id,
                'name' => UserDisplayName::resolve($offer->buyer),
                'avatar_url' => $offer->buyer->avatar_url,
            ] : null,
            'seller' => $offer->relationLoaded('seller') && $offer->seller ? [
                'id' => $offer->seller->id,
                'name' => UserDisplayName::resolve($offer->seller),
                'avatar_url' => $offer->seller->avatar_url,
            ] : null,
        ];
    }
}
