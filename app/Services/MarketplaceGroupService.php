<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\MarketplaceListing;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * MarketplaceGroupService — Group-scoped marketplace operations.
 *
 * Provides listings filtered to group members, membership checks,
 * and group-level marketplace statistics. This is a NEXUS differentiator
 * that leverages community groups for marketplace scoping.
 */
class MarketplaceGroupService
{
    /**
     * Get marketplace listings created by members of a specific group.
     *
     * Fetches active, approved listings whose user_id is in the group's
     * active member list, with standard filters and cursor pagination.
     *
     * @param int $groupId
     * @param array{
     *   category_id?: int,
     *   search?: string,
     *   price_min?: float,
     *   price_max?: float,
     *   condition?: string,
     *   sort?: string,
     *   limit?: int,
     *   cursor?: string|null,
     *   current_user_id?: int|null,
     * } $filters
     * @return array{items: array, cursor: string|null, has_more: bool, total: int}
     */
    public static function getGroupListings(int $groupId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();
        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $cursor = $filters['cursor'] ?? null;
        $currentUserId = !empty($filters['current_user_id']) ? (int) $filters['current_user_id'] : null;

        // Get active member user_ids for this group
        $memberUserIds = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', 'active')
            ->pluck('user_id')
            ->all();

        if (empty($memberUserIds)) {
            return ['items' => [], 'cursor' => null, 'has_more' => false, 'total' => 0];
        }

        $query = MarketplaceListing::query()
            ->with([
                'user:id,first_name,last_name,profile_type,organization_name,avatar_url,is_verified',
                'category:id,name,slug,icon',
                'images' => fn ($q) => $q->orderBy('sort_order')->limit(5),
            ])
            ->whereIn('user_id', $memberUserIds);
        MarketplaceListingService::applyPublicVisibility($query);

        // Category filter
        if (!empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        // Search
        if (!empty($filters['search'])) {
            $search = addcslashes((string) $filters['search'], '%_\\');
            $query->where(function ($q) use ($search) {
                $q->where('title', 'LIKE', "%{$search}%")
                  ->orWhere('description', 'LIKE', "%{$search}%");
            });
        }

        // Price range
        if (!empty($filters['price_min'])) {
            $query->where('price', '>=', (float) $filters['price_min']);
        }
        if (!empty($filters['price_max'])) {
            $query->where('price', '<=', (float) $filters['price_max']);
        }

        // Condition
        if (!empty($filters['condition'])) {
            $conditions = is_array($filters['condition'])
                ? $filters['condition']
                : explode(',', $filters['condition']);
            $query->whereIn('condition', $conditions);
        }

        // Sorting
        $sort = $filters['sort'] ?? 'newest';
        match ($sort) {
            'price_asc' => $query->orderBy('price', 'asc')->orderBy('id', 'asc'),
            'price_desc' => $query->orderBy('price', 'desc')->orderBy('id', 'desc'),
            'popular' => $query->orderBy('views_count', 'desc')->orderBy('id', 'desc'),
            default => $query->orderBy('id', 'desc'),
        };

        // Total count (before cursor pagination)
        $total = (clone $query)->count();

        // Cursor pagination
        if ($cursor) {
            self::applyCursor($query, $sort, $cursor);
        }

        $listings = $query->limit($limit + 1)->get();
        $hasMore = $listings->count() > $limit;
        if ($hasMore) {
            $listings->pop();
        }

        // Saved listing IDs for current user
        $savedIds = [];
        if ($currentUserId && $listings->isNotEmpty()) {
            $savedIds = DB::table('marketplace_saved_listings')
                ->where('user_id', $currentUserId)
                ->where('tenant_id', $tenantId)
                ->whereIn('marketplace_listing_id', $listings->pluck('id'))
                ->pluck('marketplace_listing_id')
                ->flip()
                ->all();
        }

        $items = $listings->map(fn ($l) => self::formatGroupListingItem($l, $savedIds, $currentUserId))->values()->all();

        $nextCursor = $hasMore && $listings->isNotEmpty()
            ? self::encodeCursor($listings->last(), $sort)
            : null;

        return [
            'items' => $items,
            'cursor' => $nextCursor,
            'has_more' => $hasMore,
            'total' => $total,
        ];
    }

    /**
     * Check if a user is an active member of a group.
     *
     * @param int $groupId
     * @param int $userId
     * @return bool
     */
    public static function isGroupMember(int $groupId, int $userId): bool
    {
        return DB::table('group_members')
            ->where('tenant_id', TenantContext::getId())
            ->where('group_id', $groupId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->exists();
    }

    /**
     * Get marketplace statistics for a group.
     *
     * Returns aggregate data about marketplace activity within the group:
     * active listings count, total sold, total revenue, top sellers, etc.
     *
     * @param int $groupId
     * @return array{active_listings: int, total_listed: int, total_sellers: int, categories: array}
     */
    public static function getGroupMarketplaceStats(int $groupId): array
    {
        $tenantId = TenantContext::getId();

        // Get active member user_ids
        $memberUserIds = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', 'active')
            ->pluck('user_id')
            ->all();

        if (empty($memberUserIds)) {
            return [
                'active_listings' => 0,
                'total_listed' => 0,
                'total_sellers' => 0,
                'categories' => [],
            ];
        }

        // Active listings count
        $activeQuery = MarketplaceListing::query()->whereIn('user_id', $memberUserIds);
        MarketplaceListingService::applyPublicVisibility($activeQuery);
        $activeListings = $activeQuery->count();

        // Total ever listed
        $totalListed = MarketplaceListing::query()
            ->whereIn('user_id', $memberUserIds)
            ->count();

        // Unique sellers who have listed
        $totalSellers = MarketplaceListing::query()
            ->whereIn('user_id', $memberUserIds)
            ->distinct('user_id')
            ->count('user_id');

        // Category breakdown for active listings
        $categoryQuery = DB::table('marketplace_listings as ml')
            ->join('marketplace_categories as mc', 'mc.id', '=', 'ml.category_id')
            ->where('ml.status', 'active')
            ->where('ml.moderation_status', 'approved')
            ->where('ml.tenant_id', $tenantId)
            ->where(static function ($expiry): void {
                $expiry->whereNull('ml.expires_at')->orWhere('ml.expires_at', '>', now());
            })
            ->whereIn('ml.user_id', $memberUserIds)
            ->whereNotExists(static function ($inactiveSeller): void {
                $inactiveSeller->selectRaw('1')
                    ->from('users as group_marketplace_seller')
                    ->whereColumn('group_marketplace_seller.id', 'ml.user_id')
                    ->whereColumn('group_marketplace_seller.tenant_id', 'ml.tenant_id')
                    ->where(static function ($inactive): void {
                        $inactive->where('group_marketplace_seller.status', '!=', 'active')
                            ->orWhere('group_marketplace_seller.is_approved', false);
                    });
            })
            ->whereNotExists(static function ($suspendedSeller): void {
                $suspendedSeller->selectRaw('1')
                    ->from('marketplace_seller_profiles as group_marketplace_profile')
                    ->whereColumn('group_marketplace_profile.user_id', 'ml.user_id')
                    ->whereColumn('group_marketplace_profile.tenant_id', 'ml.tenant_id')
                    ->where('group_marketplace_profile.is_suspended', true);
            });
        if (! MarketplaceConfigurationService::allowFreeItems()) {
            $categoryQuery->where('ml.price_type', '!=', 'free');
        }

        $categories = $categoryQuery
            ->groupBy('mc.id', 'mc.name', 'mc.slug', 'mc.icon')
            ->selectRaw('mc.id, mc.name, mc.slug, mc.icon, COUNT(*) as listing_count')
            ->orderByDesc('listing_count')
            ->limit(10)
            ->get()
            ->map(fn ($c) => [
                'id' => $c->id,
                'name' => $c->name,
                'slug' => $c->slug,
                'icon' => $c->icon,
                'listing_count' => (int) $c->listing_count,
            ])
            ->all();

        return [
            'active_listings' => $activeListings,
            'total_listed' => $totalListed,
            'total_sellers' => $totalSellers,
            'categories' => $categories,
        ];
    }

    // -----------------------------------------------------------------
    //  Formatting helpers
    // -----------------------------------------------------------------

    private static function applyCursor(Builder $query, string $sort, string $cursor): void
    {
        $decoded = base64_decode($cursor, true);
        if ($decoded === false || $decoded === '') {
            return;
        }
        $payload = json_decode($decoded, true);
        if (! is_array($payload) || ($payload['sort'] ?? null) !== $sort || ! isset($payload['id'])) {
            $legacyId = (int) $decoded;
            if ($legacyId > 0) {
                $query->where('id', $sort === 'price_asc' ? '>' : '<', $legacyId);
            }
            return;
        }

        $id = (int) $payload['id'];
        if ($id <= 0) {
            return;
        }
        if ($sort === 'price_asc' || $sort === 'price_desc') {
            $price = is_numeric($payload['value'] ?? null) ? (float) $payload['value'] : null;
            $query->where(function (Builder $cursorQuery) use ($sort, $price, $id): void {
                if ($sort === 'price_asc') {
                    if ($price === null) {
                        $cursorQuery->where(static function (Builder $nullTie) use ($id): void {
                            $nullTie->whereNull('price')->where('id', '>', $id);
                        })->orWhereNotNull('price');
                        return;
                    }
                    $cursorQuery->where('price', '>', $price)
                        ->orWhere(static function (Builder $tie) use ($price, $id): void {
                            $tie->where('price', $price)->where('id', '>', $id);
                        });
                    return;
                }
                if ($price === null) {
                    $cursorQuery->whereNull('price')->where('id', '<', $id);
                    return;
                }
                $cursorQuery->where('price', '<', $price)
                    ->orWhere(static function (Builder $tie) use ($price, $id): void {
                        $tie->where('price', $price)->where('id', '<', $id);
                    })
                    ->orWhereNull('price');
            });
            return;
        }
        if ($sort === 'popular') {
            $views = (int) ($payload['value'] ?? 0);
            $query->where(static function (Builder $cursorQuery) use ($views, $id): void {
                $cursorQuery->where('views_count', '<', $views)
                    ->orWhere(static function (Builder $tie) use ($views, $id): void {
                        $tie->where('views_count', $views)->where('id', '<', $id);
                    });
            });
            return;
        }

        $query->where('id', '<', $id);
    }

    private static function encodeCursor(MarketplaceListing $listing, string $sort): string
    {
        return base64_encode((string) json_encode([
            'sort' => $sort,
            'value' => match ($sort) {
                'price_asc', 'price_desc' => $listing->price !== null ? (float) $listing->price : null,
                'popular' => (int) ($listing->views_count ?? 0),
                default => (int) $listing->id,
            },
            'id' => (int) $listing->id,
        ], JSON_THROW_ON_ERROR));
    }

    private static function formatGroupListingItem(MarketplaceListing $listing, array $savedIds, ?int $currentUserId): array
    {
        $primaryImage = $listing->relationLoaded('images')
            ? $listing->images->first()
            : null;

        return [
            'id' => $listing->id,
            'title' => $listing->title,
            'tagline' => $listing->tagline,
            'price' => $listing->price !== null ? (float) $listing->price : null,
            'price_currency' => $listing->price_currency,
            'price_type' => $listing->price_type,
            'time_credit_price' => $listing->time_credit_price !== null
                ? (float) $listing->time_credit_price
                : null,
            'condition' => $listing->condition,
            'location' => $listing->location,
            'delivery_method' => $listing->delivery_method,
            'seller_type' => $listing->seller_type,
            'status' => $listing->status,
            'image' => $primaryImage ? [
                'url' => $primaryImage->image_url,
                'thumbnail_url' => $primaryImage->thumbnail_url,
                'alt_text' => $primaryImage->alt_text,
            ] : null,
            'image_count' => $listing->images_count ?? $listing->images->count(),
            'category' => $listing->category ? [
                'id' => $listing->category->id,
                'name' => $listing->category->name,
                'slug' => $listing->category->slug,
                'icon' => $listing->category->icon,
            ] : null,
            'user' => $listing->user ? [
                'id' => $listing->user->id,
                'name' => UserDisplayName::resolve($listing->user),
                'avatar_url' => $listing->user->avatar_url,
                'is_verified' => $listing->user->is_verified ?? false,
            ] : null,
            'is_saved' => isset($savedIds[$listing->id]),
            'is_own' => $currentUserId && $listing->user_id === $currentUserId,
            'is_promoted' => $listing->promoted_until && $listing->promoted_until > now(),
            'views_count' => $listing->views_count,
            'created_at' => $listing->created_at?->toISOString(),
        ];
    }
}
