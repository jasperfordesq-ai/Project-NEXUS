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
use App\Models\MarketplaceDispute;
use App\Models\MarketplaceOrder;
use App\Models\MarketplaceSellerProfile;
use App\Models\MarketplaceSellerRating;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * MarketplaceRatingService — Mutual ratings and dispute management.
 *
 * Handles: rate order → refresh seller stats, open/get disputes.
 */
class MarketplaceRatingService
{
    // -----------------------------------------------------------------
    //  Ratings
    // -----------------------------------------------------------------

    /**
     * Rate a completed order.
     *
     * Validates: order exists, user participated, order is completed,
     * and user hasn't already rated for this role.
     */
    public static function rateOrder(int $orderId, int $raterId, string $role, array $data, ?int $expectedTenantId = null): MarketplaceSellerRating
    {
        if (!in_array($role, ['buyer', 'seller'], true)) {
            throw new \InvalidArgumentException(__('api.marketplace_rating_role_invalid'));
        }

        $order = self::findOrderForTenant($orderId, $expectedTenantId);
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());

        return TenantContext::runForTenant($tenantId, function () use ($order, $orderId, $raterId, $role, $data, $tenantId): MarketplaceSellerRating {
            if ($order->status !== 'completed') {
                throw new \InvalidArgumentException(__('api.marketplace_rating_completed_order_required'));
            }

            // Verify the rater participated in this order with the claimed role
            if ($role === 'buyer' && $order->buyer_id !== $raterId) {
                throw new \InvalidArgumentException(__('api.marketplace_rating_buyer_required'));
            }
            if ($role === 'seller' && $order->seller_id !== $raterId) {
                throw new \InvalidArgumentException(__('api.marketplace_rating_seller_required'));
            }

            // Determine the ratee
            $rateeId = ($role === 'buyer') ? $order->seller_id : $order->buyer_id;

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $raterId,
                (int) $rateeId,
                $tenantId,
                'marketplace_order_rating',
            );

            // Check for existing rating
            $existingRating = MarketplaceSellerRating::where('order_id', $orderId)
                ->where('rater_role', $role)
                ->first();

            if ($existingRating) {
                throw new \InvalidArgumentException(__('api.marketplace_rating_duplicate'));
            }

            $rating = (int) ($data['rating'] ?? 0);
            if ($rating < 1 || $rating > 5) {
                throw new \InvalidArgumentException(__('api.marketplace_rating_range'));
            }

            $sellerRating = new MarketplaceSellerRating();
            $sellerRating->tenant_id = $tenantId;
            $sellerRating->order_id = $orderId;
            $sellerRating->rater_id = $raterId;
            $sellerRating->ratee_id = $rateeId;
            $sellerRating->rater_role = $role;
            $sellerRating->rating = $rating;
            $sellerRating->comment = $data['comment'] ?? null;
            $sellerRating->is_anonymous = (bool) ($data['is_anonymous'] ?? false);
            $sellerRating->save();

            // Refresh cached seller stats when a buyer rates a seller
            if ($role === 'buyer') {
                self::refreshSellerStats($rateeId);
            }

            // Notify ratee they received a rating (skip if anonymous)
            if (!$sellerRating->is_anonymous) {
                try {
                    $link = '/marketplace/orders/' . $orderId;
                    $emailSent = self::sendRatingEmail(
                        $rateeId,
                        'emails_misc.marketplace_rating.received_subject',
                        [],
                        'emails_misc.marketplace_rating.received_title',
                        'emails_misc.marketplace_rating.received_body',
                        [
                            'rating'       => $rating,
                            'order_number' => $order->order_number,
                        ],
                        $link,
                        'marketplace_rating'
                    );
                    self::markRatingNotificationEmail($sellerRating, $emailSent, $emailSent ? null : 'Marketplace rating notification email returned false');
                } catch (\Throwable $e) {
                    self::markRatingNotificationEmail($sellerRating, false, $e->getMessage());
                    Log::warning('[MarketplaceRatingService] rateOrder email failed: ' . $e->getMessage());
                }
            }

            return $sellerRating;
        });
    }

    /**
     * Get all ratings for a specific order.
     */
    public static function getOrderRatings(int $orderId): array
    {
        $ratings = MarketplaceSellerRating::with('rater:id,first_name,last_name,profile_type,organization_name,avatar_url')
            ->where('order_id', $orderId)
            ->get();

        return $ratings->map(fn ($r) => self::formatRating($r))->all();
    }

    /**
     * Get paginated ratings received by a seller (from buyers).
     */
    public static function getSellerRatings(int $userId, int $limit = 20, ?string $cursor = null): array
    {
        $query = MarketplaceSellerRating::with([
            'rater:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'order:id,order_number,marketplace_listing_id',
            'order.listing:id,title',
        ])
            ->where('ratee_id', $userId)
            ->where('rater_role', 'buyer')
            ->orderBy('id', 'desc');

        if ($cursor) {
            $query->where('id', '<', (int) base64_decode($cursor, true));
        }

        $ratings = $query->limit($limit + 1)->get();
        $hasMore = $ratings->count() > $limit;
        if ($hasMore) {
            $ratings->pop();
        }

        return [
            'items' => $ratings->map(fn ($r) => self::formatRating($r))->all(),
            'cursor' => $hasMore && $ratings->isNotEmpty() ? base64_encode((string) $ratings->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Recalculate avg_rating and total_ratings on the seller's profile.
     */
    public static function refreshSellerStats(int $userId): void
    {
        $stats = MarketplaceSellerRating::where('ratee_id', $userId)
            ->where('rater_role', 'buyer')
            ->selectRaw('COUNT(*) as total_ratings, AVG(rating) as avg_rating')
            ->first();

        $profile = MarketplaceSellerProfile::where('user_id', $userId)->first();
        if ($profile && $stats) {
            $profile->update([
                'total_ratings' => (int) $stats->total_ratings,
                'avg_rating' => round((float) $stats->avg_rating, 2),
            ]);
        }
    }

    // -----------------------------------------------------------------
    //  Disputes
    // -----------------------------------------------------------------

    /**
     * Open a dispute on an order.
     */
    public static function openDispute(int $orderId, int $userId, array $data, ?int $expectedTenantId = null): MarketplaceDispute
    {
        $order = self::findOrderForTenant($orderId, $expectedTenantId);
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());

        return TenantContext::runForTenant($tenantId, function () use ($order, $orderId, $userId, $data, $tenantId): MarketplaceDispute {
            // Only buyer or seller can open a dispute
            if ((int) $order->buyer_id !== $userId && (int) $order->seller_id !== $userId) {
                throw new \InvalidArgumentException(__('api.marketplace_order_participant_required'));
            }

            // Payment must have settled before either party can open a claim.
            if (! in_array((string) $order->status, ['paid', 'shipped', 'delivered', 'completed'], true)) {
                throw new \InvalidArgumentException(__('api.marketplace_dispute_order_not_eligible'));
            }

            $validReasons = ['not_received', 'not_as_described', 'damaged', 'wrong_item', 'other'];
            $reason = $data['reason'] ?? '';
            if (!in_array($reason, $validReasons, true)) {
                throw new \InvalidArgumentException(__('api.marketplace_dispute_invalid_reason'));
            }

            $dispute = DB::transaction(function () use ($orderId, $userId, $data, $reason, $tenantId) {
                $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                    ->whereKey($orderId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->firstOrFail();

                if (! in_array((string) $lockedOrder->status, ['paid', 'shipped', 'delivered', 'completed'], true)) {
                    throw new \InvalidArgumentException(__('api.marketplace_dispute_order_not_eligible'));
                }

                $existingDispute = MarketplaceDispute::where('order_id', $orderId)
                    ->where('tenant_id', $tenantId)
                    ->whereNotIn('status', ['closed'])
                    ->lockForUpdate()
                    ->first();

                if ($existingDispute) {
                    throw new \InvalidArgumentException(__('api.marketplace_dispute_duplicate'));
                }

                $dispute = new MarketplaceDispute();
                $dispute->tenant_id = $tenantId;
                $dispute->order_id = $orderId;
                $dispute->opened_by = $userId;
                $dispute->reason = $reason;
                $dispute->description = $data['description'];
                $dispute->evidence_urls = $data['evidence_urls'] ?? null;
                $dispute->status = 'open';
                $dispute->prior_order_status = $lockedOrder->status;
                $dispute->save();

                // Move order to disputed status
                $lockedOrder->status = 'disputed';
                $lockedOrder->save();

                return $dispute;
            });

            // Notify the other party that a dispute was opened
            try {
                $otherPartyId = ($userId === (int) $order->buyer_id) ? (int) $order->seller_id : (int) $order->buyer_id;
                $link = '/marketplace/orders/' . $orderId;
                $emailSent = self::sendRatingEmail(
                    $otherPartyId,
                    'emails_misc.marketplace_dispute.opened_subject',
                    ['order_number' => $order->order_number],
                    'emails_misc.marketplace_dispute.opened_title',
                    'emails_misc.marketplace_dispute.opened_body',
                    ['order_number' => $order->order_number],
                    $link,
                    'marketplace_order'
                );
                self::markDisputeNotificationEmail($dispute, $emailSent, $emailSent ? null : 'Marketplace dispute notification email returned false');
            } catch (\Throwable $e) {
                self::markDisputeNotificationEmail($dispute, false, $e->getMessage());
                Log::warning('[MarketplaceRatingService] openDispute email failed: ' . $e->getMessage());
            }

            return $dispute;
        });
    }

    /**
     * Get the dispute for a specific order.
     */
    public static function getDispute(int $orderId): ?MarketplaceDispute
    {
        return MarketplaceDispute::with('openedBy:id,first_name,last_name,profile_type,organization_name,avatar_url')
            ->where('order_id', $orderId)
            ->first();
    }

    private static function findOrderForTenant(int $orderId, ?int $expectedTenantId = null): MarketplaceOrder
    {
        $tenantId = $expectedTenantId ?? TenantContext::getId();
        $query = MarketplaceOrder::withoutGlobalScopes()->whereKey($orderId);

        if ($tenantId !== null) {
            $query->where('tenant_id', (int) $tenantId);
        } else {
            Log::warning('[MarketplaceRatingService] order lookup without tenant context', [
                'order_id' => $orderId,
            ]);
        }

        return $query->firstOrFail();
    }

    // -----------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------

    private static function sendRatingEmail(int $userId, string $subjectKey, array $subjectParams, string $titleKey, string $bodyKey, array $bodyParams, string $link, string $category): bool
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language', 'tenant_id'])->first();

        if (!$user || empty($user->email)) {
            return false;
        }

        $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

        return (bool) LocaleContext::withLocale($user, function () use ($user, $subjectKey, $subjectParams, $titleKey, $bodyKey, $bodyParams, $fullUrl, $userId, $tenantId, $category): bool {
            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');

            $html = EmailTemplateBuilder::make()
                ->title(__($titleKey))
                ->greeting($firstName)
                ->paragraph(__($bodyKey, $bodyParams))
                ->button(__('emails_misc.marketplace_rating.received_cta'), $fullUrl)
                ->render();

            if (!\App\Services\EmailDispatchService::sendRaw($user->email, __($subjectKey, $subjectParams), $html, null, null, null, $category, ['tenant_id' => $tenantId])) {
                Log::warning('[MarketplaceRatingService] email failed', ['user_id' => $userId]);
                return false;
            }

            return true;
        });
    }

    private static function markRatingNotificationEmail(MarketplaceSellerRating $rating, bool $sent, ?string $error): void
    {
        $rating->forceFill([
            'notification_email_sent_at' => $sent ? now() : null,
            'notification_email_failed_at' => $sent ? null : now(),
            'notification_email_last_error' => $sent ? null : ($error !== null ? mb_substr($error, 0, 2000) : null),
        ])->save();
    }

    private static function markDisputeNotificationEmail(MarketplaceDispute $dispute, bool $sent, ?string $error): void
    {
        $dispute->forceFill([
            'notification_email_sent_at' => $sent ? now() : null,
            'notification_email_failed_at' => $sent ? null : now(),
            'notification_email_last_error' => $sent ? null : ($error !== null ? mb_substr($error, 0, 2000) : null),
        ])->save();
    }

    private static function formatRating(MarketplaceSellerRating $rating): array
    {
        $rater = $rating->relationLoaded('rater') ? $rating->rater : null;
        $order = $rating->relationLoaded('order') ? $rating->order : null;
        $listing = $order && $order->relationLoaded('listing') ? $order->listing : null;

        return [
            'id' => $rating->id,
            'order_id' => $rating->order_id,
            'rater_role' => $rating->rater_role,
            'rating' => $rating->rating,
            'comment' => $rating->is_anonymous ? null : $rating->comment,
            'is_anonymous' => $rating->is_anonymous,
            'created_at' => $rating->created_at?->toISOString(),
            'rater' => $rating->is_anonymous ? null : ($rater ? [
                'id' => $rater->id,
                'name' => UserDisplayName::resolve($rater),
                'avatar_url' => $rater->avatar_url,
            ] : null),
            'order' => $order ? [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'listing' => $listing ? [
                    'id' => $listing->id,
                    'title' => $listing->title,
                ] : null,
            ] : null,
        ];
    }
}
