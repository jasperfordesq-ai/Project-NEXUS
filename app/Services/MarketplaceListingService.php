<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\MarketplaceListing;
use App\Models\MarketplaceOffer;
use App\Models\MarketplaceImage;
use App\Models\MarketplaceSellerProfile;
use App\Models\MarketplaceSavedListing;
use App\Support\StripeCurrency;
use App\Services\MarketplaceConfigurationService;
use App\Services\SearchService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * MarketplaceListingService — Standalone service for marketplace listings.
 *
 * Completely separate from ListingService (timebanking). Uses its own
 * marketplace_listings table and marketplace_listings Meilisearch index.
 */
class MarketplaceListingService
{
    // -----------------------------------------------------------------
    //  Read
    // -----------------------------------------------------------------

    /**
     * Get active marketplace listings with filtering and cursor pagination.
     *
     * @param array{
     *   category_id?: int,
     *   category_slug?: string,
     *   search?: string,
     *   price_min?: float,
     *   price_max?: float,
     *   price_type?: string,
     *   condition?: string|string[],
     *   seller_type?: string,
     *   delivery_method?: string,
     *   posted_within?: int,
     *   user_id?: int,
     *   current_user_id?: int|null,
     *   featured_first?: bool,
     *   limit?: int,
     *   cursor?: string|null,
     *   sort?: string,
     * } $filters
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getAll(array $filters = []): array
    {
        $limit = max(1, min((int) ($filters['limit'] ?? 20), 100));
        $cursor = $filters['cursor'] ?? null;
        $currentUserId = !empty($filters['current_user_id'])
            ? (int) $filters['current_user_id']
            : null;

        // ── Meilisearch search path ──────────────────────────────────────────
        // When a search term is present and Meilisearch is available, use it for
        // typo-tolerant, relevance-ranked ID retrieval, then hydrate from SQL.
        // Falls through to the SQL path below if Meilisearch is unavailable.
        // Skip Meilisearch when browsing own listings (user_id filter) or when
        // price range / posted_within facets are active — they're applied
        // post-search in SQL which breaks pagination.
        $hasFacetedFilters = !empty($filters['price_min']) || !empty($filters['price_max'])
            || !empty($filters['posted_within']);
        if (!empty($filters['search']) && empty($filters['user_id']) && !$hasFacetedFilters) {
            $tenantId = TenantContext::getId();

            // Decode Meilisearch offset cursor (format: "meili:<offset>")
            $meiliOffset = 0;
            if ($cursor !== null) {
                $decoded = base64_decode($cursor, true);
                if ($decoded !== false && str_starts_with($decoded, 'meili:')) {
                    $meiliOffset = (int) substr($decoded, 6);
                }
            }

            // Build Meilisearch filter expressions from applicable filters
            $meiliFilters = [];

            if (!empty($filters['category_id'])) {
                $meiliFilters[] = 'category_id = ' . (int) $filters['category_id'];
            } elseif (!empty($filters['category_slug'])) {
                $catId = DB::table('marketplace_categories')
                    ->where('slug', $filters['category_slug'])
                    ->where(function ($q) {
                        $q->where('tenant_id', TenantContext::getId())
                          ->orWhereNull('tenant_id');
                    })
                    ->value('id');
                if ($catId) {
                    $meiliFilters[] = 'category_id = ' . $catId;
                }
            }

            if (!empty($filters['price_type'])) {
                $meiliFilters[] = SearchService::buildEqFilter('marketplace_listings', 'price_type', (string) $filters['price_type']);
            }

            if (!empty($filters['condition'])) {
                $conditions = is_array($filters['condition'])
                    ? $filters['condition']
                    : explode(',', $filters['condition']);
                $conditions = array_values(array_filter(array_map('strval', $conditions), fn($c) => $c !== ''));
                if (count($conditions) === 1) {
                    $meiliFilters[] = SearchService::buildEqFilter('marketplace_listings', 'condition', $conditions[0]);
                } elseif (count($conditions) > 1) {
                    $inFilter = SearchService::buildInFilter('condition', $conditions);
                    if ($inFilter !== null) {
                        $meiliFilters[] = $inFilter;
                    }
                }
            }

            if (!empty($filters['seller_type'])) {
                $meiliFilters[] = SearchService::buildEqFilter('marketplace_listings', 'seller_type', (string) $filters['seller_type']);
            }

            if (!empty($filters['delivery_method'])) {
                $meiliFilters[] = SearchService::buildEqFilter('marketplace_listings', 'delivery_method', (string) $filters['delivery_method']);
            }

            $meiliResult = SearchService::searchMarketplaceListingIds(
                $filters['search'], $tenantId, $meiliFilters, $limit + 1, $meiliOffset
            );

            if ($meiliResult !== null) {
                $ids     = $meiliResult['ids'];
                $hasMore = count($ids) > $limit;
                if ($hasMore) {
                    array_pop($ids);
                }

                if (empty($ids)) {
                    return ['items' => [], 'cursor' => null, 'has_more' => false];
                }

                $q = MarketplaceListing::query()
                    ->with([
                        'user:id,first_name,last_name,profile_type,organization_name,avatar_url,is_verified',
                        'category:id,name,slug,icon',
                        'images' => fn ($qq) => $qq->orderByDesc('is_primary')->orderBy('sort_order')->limit(1),
                    ])
                    ->withCount('images')
                    ->whereIn('id', $ids);
                self::applyPublicVisibility($q);

                $listingsById = $q->get()->keyBy('id');

                // Saved listing IDs for current user
                $savedIds = [];
                if ($currentUserId && $listingsById->isNotEmpty()) {
                    $savedIds = DB::table('marketplace_saved_listings')
                        ->where('user_id', $currentUserId)
                        ->where('tenant_id', $tenantId)
                        ->whereIn('marketplace_listing_id', $listingsById->keys())
                        ->pluck('marketplace_listing_id')
                        ->flip()
                        ->all();
                }

                // Preserve Meilisearch relevance order
                $items = [];
                foreach ($ids as $id) {
                    $listing = $listingsById[$id] ?? null;
                    if ($listing) {
                        $items[] = self::formatListingItem($listing, $savedIds, $currentUserId);
                    }
                }

                return [
                    'items'    => $items,
                    'cursor'   => $hasMore ? base64_encode('meili:' . ($meiliOffset + $limit)) : null,
                    'has_more' => $hasMore,
                ];
            }
            // Meilisearch unavailable — fall through to SQL path
        }
        // ── End Meilisearch path ─────────────────────────────────────────────

        $query = MarketplaceListing::query()
            ->with([
                'user:id,first_name,last_name,profile_type,organization_name,avatar_url,is_verified',
                'category:id,name,slug,icon',
                'images' => fn ($q) => $q->orderByDesc('is_primary')->orderBy('sort_order')->limit(1),
            ])
            ->withCount('images')
            ;

        // Only the authenticated owner may expand a user_id browse beyond
        // active + approved listings. A requested user_id alone is not proof
        // of ownership and must never become an unpublished-listing preview.
        $requestedUserId = !empty($filters['user_id']) ? (int) $filters['user_id'] : null;
        $isOwnListings = $requestedUserId !== null
            && $currentUserId !== null
            && $requestedUserId === $currentUserId;

        if ($requestedUserId !== null) {
            $query->where('user_id', $requestedUserId);
        }

        if ($isOwnListings) {
            if (!empty($filters['status'])) {
                $query->where('status', $filters['status']);
            }
        } else {
            self::applyPublicVisibility($query);
        }

        // Category filter
        if (!empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        } elseif (!empty($filters['category_slug'])) {
            $catId = DB::table('marketplace_categories')
                ->where('slug', $filters['category_slug'])
                ->where(function ($q) {
                    $q->where('tenant_id', TenantContext::getId())
                      ->orWhereNull('tenant_id');
                })
                ->value('id');
            if ($catId) {
                $query->where('category_id', $catId);
            }
        }

        // Search (SQL fallback — used when Meilisearch is unavailable)
        if (!empty($filters['search'])) {
            $search = $filters['search'];
            $query->where(function (Builder $q) use ($search) {
                $q->whereRaw('MATCH(title, description) AGAINST(? IN BOOLEAN MODE)', [$search])
                  ->orWhere('title', 'LIKE', "%{$search}%");
            });
        }

        // Price range
        if (!empty($filters['price_min'])) {
            $query->where('price', '>=', (float) $filters['price_min']);
        }
        if (!empty($filters['price_max'])) {
            $query->where('price', '<=', (float) $filters['price_max']);
        }

        // Price type (free items)
        if (!empty($filters['price_type'])) {
            $query->where('price_type', $filters['price_type']);
        }

        // Condition
        if (!empty($filters['condition'])) {
            $conditions = is_array($filters['condition'])
                ? $filters['condition']
                : explode(',', $filters['condition']);
            $query->whereIn('condition', $conditions);
        }

        // Seller type
        if (!empty($filters['seller_type'])) {
            $query->where('seller_type', $filters['seller_type']);
        }

        // Delivery method
        if (!empty($filters['delivery_method'])) {
            $query->where('delivery_method', $filters['delivery_method']);
        }

        // Posted within X days
        if (!empty($filters['posted_within'])) {
            $query->where('created_at', '>=', now()->subDays((int) $filters['posted_within']));
        }

        // Featured first (must be BEFORE the main sort so it takes priority)
        if (!empty($filters['featured_first'])) {
            // Expired promotion markers are cleared by the hourly marketplace
            // maintenance job. Ordering the indexed timestamp directly avoids
            // the per-request boolean-expression filesort.
            $query->orderByDesc('promoted_until');
        }

        // Sorting
        $sort = $filters['sort'] ?? 'newest';
        match ($sort) {
            // MySQL/MariaDB's native NULL ordering matches the former
            // COALESCE(price, -1) semantics because marketplace prices cannot
            // be negative, while allowing a composite index to satisfy order.
            'price_asc' => $query->orderBy('price', 'asc')->orderBy('id', 'asc'),
            'price_desc' => $query->orderBy('price', 'desc')->orderBy('id', 'desc'),
            'popular' => $query->orderBy('views_count', 'desc')->orderBy('id', 'desc'),
            default => $query->orderBy('id', 'desc'), // newest
        };

        // Cursor pagination
        if ($cursor) {
            self::applySqlCursor($query, $sort, $cursor, ! empty($filters['featured_first']));
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
                ->where('tenant_id', TenantContext::getId())
                ->whereIn('marketplace_listing_id', $listings->pluck('id'))
                ->pluck('marketplace_listing_id')
                ->flip()
                ->all();
        }

        $items = $listings->map(fn ($l) => self::formatListingItem($l, $savedIds, $currentUserId))->values()->all();

        $nextCursor = $hasMore && $listings->isNotEmpty()
            ? self::encodeSqlCursor($listings->last(), $sort, ! empty($filters['featured_first']))
            : null;

        return [
            'items' => $items,
            'cursor' => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    private static function applySqlCursor(
        Builder $query,
        string $sort,
        string $cursor,
        bool $featuredFirst = false
    ): void
    {
        $decoded = base64_decode($cursor, true);
        if ($decoded === false || $decoded === '') {
            return;
        }

        $payload = json_decode($decoded, true);
        if (!is_array($payload) || ($payload['sort'] ?? null) !== $sort || !isset($payload['id'])) {
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

        if ($featuredFirst && array_key_exists('promoted_until', $payload)) {
            $promotedUntil = is_string($payload['promoted_until'])
                && $payload['promoted_until'] !== ''
                    ? $payload['promoted_until']
                    : null;

            $query->where(function (Builder $promotionCursor) use ($promotedUntil, $sort, $payload, $id): void {
                if ($promotedUntil === null) {
                    $promotionCursor->whereNull('promoted_until')
                        ->where(function (Builder $tie) use ($sort, $payload, $id): void {
                            self::applySortCursorPayload($tie, $sort, $payload, $id);
                        });
                    return;
                }

                $promotionCursor->where('promoted_until', '<', $promotedUntil)
                    ->orWhereNull('promoted_until')
                    ->orWhere(function (Builder $tie) use ($promotedUntil, $sort, $payload, $id): void {
                        $tie->where('promoted_until', $promotedUntil)
                            ->where(function (Builder $secondaryTie) use ($sort, $payload, $id): void {
                                self::applySortCursorPayload($secondaryTie, $sort, $payload, $id);
                            });
                    });
            });
            return;
        }

        self::applySortCursorPayload($query, $sort, $payload, $id);
    }

    /** @param array<string,mixed> $payload */
    private static function applySortCursorPayload(
        Builder $query,
        string $sort,
        array $payload,
        int $id
    ): void {

        if ($sort === 'price_asc' || $sort === 'price_desc') {
            $price = is_numeric($payload['value'] ?? null)
                ? (float) $payload['value']
                : null;

            if ($sort === 'price_asc') {
                $query->where(function (Builder $q) use ($price, $id): void {
                    if ($price === null) {
                        $q->where(static function (Builder $nullTie) use ($id): void {
                            $nullTie->whereNull('price')->where('id', '>', $id);
                        })->orWhereNotNull('price');
                        return;
                    }

                    $q->where('price', '>', $price)
                        ->orWhere(static function (Builder $tie) use ($price, $id): void {
                            $tie->where('price', $price)->where('id', '>', $id);
                        });
                });
                return;
            }

            $query->where(function (Builder $q) use ($price, $id): void {
                if ($price === null) {
                    $q->whereNull('price')->where('id', '<', $id);
                    return;
                }

                $q->where('price', '<', $price)
                    ->orWhere(static function (Builder $tie) use ($price, $id): void {
                        $tie->where('price', $price)->where('id', '<', $id);
                    })
                    ->orWhereNull('price');
            });
            return;
        }

        if ($sort === 'popular') {
            $views = (int) ($payload['value'] ?? 0);
            $query->where(function (Builder $q) use ($views, $id) {
                $q->where('views_count', '<', $views)
                    ->orWhere(function (Builder $tie) use ($views, $id) {
                        $tie->where('views_count', $views)
                            ->where('id', '<', $id);
                    });
            });
            return;
        }

        $query->where('id', '<', $id);
    }

    private static function encodeSqlCursor(
        MarketplaceListing $listing,
        string $sort,
        bool $featuredFirst = false
    ): string
    {
        $value = match ($sort) {
            'price_asc', 'price_desc' => $listing->price !== null ? (float) $listing->price : null,
            'popular' => (int) ($listing->views_count ?? 0),
            default => (int) $listing->id,
        };

        $payload = [
            'sort' => $sort,
            'value' => $value,
            'id' => (int) $listing->id,
        ];
        if ($featuredFirst) {
            $payload['promoted_until'] = $listing->promoted_until?->format('Y-m-d H:i:s.u');
        }

        return base64_encode(json_encode($payload, JSON_THROW_ON_ERROR));
    }

    /**
     * Get a single marketplace listing by ID.
     */
    public static function getById(int $id, ?int $currentUserId = null): ?array
    {
        $query = self::listingDetailQuery();
        self::applyPublicVisibility($query);
        $listing = $query->find($id);

        return self::formatLoadedListingDetail($listing, $id, $currentUserId);
    }

    /**
     * Owner-only preview used after create/update/renew operations. This is kept
     * separate from getById() so ordinary detail lookups cannot reveal drafts,
     * pending moderation records, suspended listings, or removed listings.
     */
    public static function getByIdForOwner(int $id, int $ownerId): ?array
    {
        $listing = self::listingDetailQuery()
            ->where('user_id', $ownerId)
            ->find($id);

        return self::formatLoadedListingDetail($listing, $id, $ownerId);
    }

    /**
     * Permit only the buyer named on an accepted offer to inspect its reserved
     * listing during checkout. This deliberately does not broaden ordinary
     * public visibility for reserved or otherwise unpublished listings.
     */
    public static function getByIdForAcceptedOfferBuyer(int $id, int $buyerId, int $offerId): ?array
    {
        $tenantId = (int) TenantContext::getId();
        $authorized = MarketplaceOffer::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($offerId)
            ->where('marketplace_listing_id', $id)
            ->where('buyer_id', $buyerId)
            ->where('status', 'accepted')
            ->exists();
        if (! $authorized) {
            return null;
        }

        $listing = self::listingDetailQuery()
            ->where('tenant_id', $tenantId)
            ->whereKey($id)
            ->where('status', 'reserved')
            ->where('moderation_status', 'approved')
            ->first();

        return self::formatLoadedListingDetail($listing, $id, $buyerId);
    }

    private static function listingDetailQuery(): Builder
    {
        return MarketplaceListing::query()
            ->with([
                'user:id,first_name,last_name,profile_type,organization_name,avatar_url,is_verified,created_at',
                'category:id,name,slug,icon',
                'images' => fn ($q) => $q->orderBy('sort_order'),
            ]);
    }

    private static function formatLoadedListingDetail(
        ?MarketplaceListing $listing,
        int $id,
        ?int $currentUserId
    ): ?array {
        if (!$listing) {
            return null;
        }

        $isSaved = false;
        if ($currentUserId) {
            $isSaved = MarketplaceSavedListing::where('user_id', $currentUserId)
                ->where('marketplace_listing_id', $id)
                ->exists();
        }

        return self::formatListingDetail($listing, $isSaved, $currentUserId);
    }

    /**
     * Get nearby marketplace listings using haversine distance.
     *
     * @param array{search?: string, category_id?: mixed} $filters
     */
    public static function getNearby(
        float $lat,
        float $lng,
        float $radiusKm = 25,
        int $limit = 20,
        array $filters = []
    ): array
    {
        $query = MarketplaceListing::query()
            ->with([
                'user:id,first_name,last_name,profile_type,organization_name,avatar_url',
                'category:id,name,slug,icon',
                'images' => fn ($q) => $q->orderByDesc('is_primary')->orderBy('sort_order')->limit(1),
            ])
            ->withCount('images')
            ->withinRadiusBoundingBox($lat, $lng, $radiusKm)
            ->select('marketplace_listings.*')
            ->selectRaw('(
                6371 * acos(LEAST(1, GREATEST(-1,
                    cos(radians(?)) * cos(radians(latitude)) *
                    cos(radians(longitude) - radians(?)) +
                    sin(radians(?)) * sin(radians(latitude))
                )))
            ) AS distance_km', [$lat, $lng, $lat])
            ->having('distance_km', '<=', $radiusKm)
            ->orderBy('distance_km')
            ->limit($limit);

        if (($search = trim((string) ($filters['search'] ?? ''))) !== '') {
            $query->where(static function (Builder $searchQuery) use ($search): void {
                $searchQuery->where('title', 'like', '%' . $search . '%')
                    ->orWhere('description', 'like', '%' . $search . '%');
            });
        }
        if (($categoryId = filter_var($filters['category_id'] ?? null, FILTER_VALIDATE_INT)) !== false
            && $categoryId > 0) {
            $query->where('category_id', $categoryId);
        }

        self::applyPublicVisibility($query);
        $listings = $query->get();

        return $listings->map(fn ($l) => array_merge(
            self::formatListingItem($l, [], null),
            [
                // Nearby results are public. Map pins need coordinates, but
                // exact seller/profile coordinates must never leave the API.
                'latitude' => round((float) $l->latitude, 2),
                'longitude' => round((float) $l->longitude, 2),
                'distance_km' => round((float) $l->distance_km, 1),
            ]
        ))->all();
    }

    // -----------------------------------------------------------------
    //  Write
    // -----------------------------------------------------------------

    /**
     * Create a new marketplace listing.
     */
    public static function create(int $userId, array $data): MarketplaceListing
    {
        $data = self::normalizePricingInput($data);
        self::assertListingPolicy($data);
        self::ensureCategoryAvailable($data['category_id'] ?? null);

        self::assertSellerCanPublish($userId);

        // Serialize quota check + insert per seller. A plain count-then-save
        // allows two concurrent requests to exceed the tenant limit.
        $tenantId = (int) TenantContext::getId();
        $listing = Cache::lock("marketplace-listing-quota:{$tenantId}:{$userId}", 15)
            ->block(10, static function () use ($userId, $tenantId, $data): MarketplaceListing {
                $maxListings = MarketplaceConfigurationService::maxActiveListings();
                if ($maxListings > 0) {
                    $activeCount = MarketplaceListing::where('user_id', $userId)
                        ->where('status', 'active')
                        ->count();
                    if ($activeCount >= $maxListings) {
                        throw new \InvalidArgumentException(__('api.marketplace_active_listing_limit', ['max' => $maxListings]));
                    }
                }

                $listing = new MarketplaceListing();
                $listing->tenant_id = $tenantId;
                $listing->user_id = $userId;
                $listing->title = $data['title'];
                $listing->description = $data['description'];
                $listing->tagline = $data['tagline'] ?? null;
                $listing->price = $data['price'] ?? null;
                $listing->price_currency = $data['price_currency'] ?? strtoupper(TenantContext::getCurrency());
                $listing->price_type = $data['price_type'] ?? 'fixed';
                $listing->time_credit_price = $data['time_credit_price'] ?? null;
                $listing->category_id = $data['category_id'] ?? null;
                $listing->condition = $data['condition'] ?? null;
                $listing->quantity = $data['quantity'] ?? 1;
                if (array_key_exists('inventory_count', $data)) {
                    $listing->inventory_count = $data['inventory_count'];
                }
                if (array_key_exists('low_stock_threshold', $data)) {
                    $listing->low_stock_threshold = $data['low_stock_threshold'];
                }
                if (array_key_exists('is_oversold_protected', $data)) {
                    $listing->is_oversold_protected = (bool) $data['is_oversold_protected'];
                }
                $listing->location = $data['location'] ?? null;
                $listing->latitude = $data['latitude'] ?? null;
                $listing->longitude = $data['longitude'] ?? null;
                $listing->shipping_available = $data['shipping_available'] ?? false;
                $listing->local_pickup = $data['local_pickup'] ?? true;
                $listing->delivery_method = $data['delivery_method'] ?? 'pickup';
                $listing->seller_type = $data['seller_type'] ?? 'private';
                $listing->status = $data['status'] ?? 'active';
                $listing->moderation_status = MarketplaceConfigurationService::moderationEnabled()
                    ? 'pending'
                    : 'approved';
                $listing->template_data = $data['template_data'] ?? null;
                $durationDays = (int) ($data['duration_days'] ?? MarketplaceConfigurationService::listingDurationDays());
                $listing->expires_at = now()->addDays($durationDays);
                $listing->save();

                return $listing;
            });

        // Geocode if location provided but no coordinates
        if ($listing->location && !$listing->latitude) {
            self::geocodeListing($listing);
        }

        // Pending or draft content must never enter the public search index.
        if ($listing->status === 'active' && $listing->moderation_status === 'approved') {
            SearchService::indexMarketplaceListing($listing);
        } else {
            SearchService::removeMarketplaceListing($listing->id);
        }

        return $listing;
    }

    /**
     * Update an existing marketplace listing.
     */
    public static function update(MarketplaceListing $listing, array $data): MarketplaceListing
    {
        $data = self::normalizePricingInput($data, $listing);
        self::assertListingPolicy($data, $listing);
        if (array_key_exists('status', $data)) {
            if (! in_array((string) $listing->status, ['active', 'draft'], true)) {
                throw new \InvalidArgumentException(__('api.validation_failed'));
            }
            if ((string) $data['status'] === 'active') {
                self::assertSellerCanPublish((int) $listing->user_id);
            }
        }
        if (array_key_exists('category_id', $data)) {
            self::ensureCategoryAvailable($data['category_id']);
        }

        $fillable = [
            'title', 'description', 'tagline', 'price', 'price_currency',
            'price_type', 'time_credit_price', 'category_id', 'condition',
            'quantity', 'inventory_count', 'low_stock_threshold', 'is_oversold_protected',
            'location', 'latitude', 'longitude',
            'shipping_available', 'local_pickup', 'delivery_method',
            'seller_type', 'status', 'template_data',
        ];

        foreach ($fillable as $field) {
            if (array_key_exists($field, $data)) {
                $listing->{$field} = $data[$field];
            }
        }

        $moderatedFields = [
            'title',
            'description',
            'tagline',
            'price',
            'price_currency',
            'price_type',
            'time_credit_price',
            'category_id',
            'condition',
            'quantity',
            'template_data',
        ];
        $requiresRemoderation = $listing->moderation_status === 'approved'
            && MarketplaceConfigurationService::moderationEnabled()
            && $listing->isDirty($moderatedFields);
        if ($requiresRemoderation) {
            $listing->moderation_status = 'pending';
            $listing->moderation_notes = null;
            $listing->moderated_by = null;
            $listing->moderated_at = null;
        }

        $listing->save();

        // Re-geocode if location changed
        if (isset($data['location']) && !isset($data['latitude'])) {
            self::geocodeListing($listing);
        }

        // Pending content must leave public search until an administrator
        // approves the material changes.
        if ($listing->status === 'active' && $listing->moderation_status === 'approved') {
            SearchService::indexMarketplaceListing($listing);
        } else {
            SearchService::removeMarketplaceListing($listing->id);
        }

        return $listing;
    }

    /**
     * Soft-remove a marketplace listing.
     */
    public static function remove(MarketplaceListing $listing): void
    {
        $listing->status = 'removed';
        $listing->save();

        // Remove from Meilisearch index (non-blocking, best-effort)
        SearchService::removeMarketplaceListing($listing->id);
    }

    /**
     * Renew an expired listing.
     */
    public static function renew(MarketplaceListing $listing, int $durationDays = 30): MarketplaceListing
    {
        self::assertSellerCanPublish((int) $listing->user_id);
        if (! in_array((string) $listing->status, ['active', 'draft', 'expired'], true)) {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }
        $listing->status = 'active';
        $listing->expires_at = now()->addDays($durationDays);
        $listing->renewed_at = now();
        $listing->renewal_count = ($listing->renewal_count ?? 0) + 1;
        $listing->save();

        // Renewal does not bypass moderation.
        if ($listing->moderation_status === 'approved') {
            SearchService::indexMarketplaceListing($listing);
        } else {
            SearchService::removeMarketplaceListing($listing->id);
        }

        return $listing;
    }

    /** Publish a seller draft without altering renewal accounting. */
    public static function activate(MarketplaceListing $listing): MarketplaceListing
    {
        self::assertSellerCanPublish((int) $listing->user_id);
        if ((string) $listing->status !== 'draft') {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }

        $listing->status = 'active';
        if ($listing->expires_at === null || $listing->expires_at->isPast()) {
            $listing->expires_at = now()->addDays(MarketplaceConfigurationService::listingDurationDays());
        }
        $listing->save();

        if ($listing->moderation_status === 'approved') {
            SearchService::indexMarketplaceListing($listing);
        } else {
            SearchService::removeMarketplaceListing($listing->id);
        }

        return $listing;
    }

    // -----------------------------------------------------------------
    //  Images
    // -----------------------------------------------------------------

    /**
     * Add images to a marketplace listing.
     *
     * @param MarketplaceListing $listing
     * @param array<array{url: string, thumbnail_url?: string, alt_text?: string}> $images
     */
    public static function addImages(MarketplaceListing $listing, array $images): void
    {
        $maxSort = MarketplaceImage::where('marketplace_listing_id', $listing->id)->max('sort_order') ?? -1;

        foreach ($images as $i => $img) {
            MarketplaceImage::create([
                'tenant_id' => $listing->tenant_id,
                'marketplace_listing_id' => $listing->id,
                'image_url' => $img['url'],
                'thumbnail_url' => $img['thumbnail_url'] ?? null,
                'alt_text' => $img['alt_text'] ?? null,
                'sort_order' => $maxSort + $i + 1,
                'is_primary' => $maxSort < 0 && $i === 0,
            ]);
        }

        self::markPendingForModeration($listing);
    }

    /**
     * Reorder images for a listing.
     *
     * @param MarketplaceListing $listing
     * @param int[] $imageIds Ordered array of image IDs
     */
    public static function reorderImages(MarketplaceListing $listing, array $imageIds): void
    {
        $requestedIds = array_values(array_map('intval', $imageIds));
        $currentIds = MarketplaceImage::query()
            ->where('marketplace_listing_id', $listing->id)
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        $requestedSet = $requestedIds;
        $currentSet = $currentIds;
        sort($requestedSet);
        sort($currentSet);
        if (count($requestedIds) !== count(array_unique($requestedIds))
            || $requestedSet !== $currentSet) {
            throw new \InvalidArgumentException(__('api.validation_failed'));
        }

        DB::transaction(static function () use ($listing, $requestedIds): void {
            MarketplaceImage::query()
                ->where('marketplace_listing_id', $listing->id)
                ->update(['is_primary' => false]);
            foreach ($requestedIds as $order => $imageId) {
                MarketplaceImage::query()
                    ->whereKey($imageId)
                    ->where('marketplace_listing_id', $listing->id)
                    ->update([
                        'sort_order' => $order,
                        'is_primary' => $order === 0,
                    ]);
            }
        });
    }

    /**
     * Delete an image from a listing.
     */
    public static function deleteImage(MarketplaceListing $listing, int $imageId): bool
    {
        $deleted = DB::transaction(static function () use ($listing, $imageId): bool {
            $image = MarketplaceImage::query()
                ->whereKey($imageId)
                ->where('marketplace_listing_id', $listing->id)
                ->lockForUpdate()
                ->first();
            if ($image === null) {
                return false;
            }

            $wasPrimary = (bool) $image->is_primary;
            $image->delete();
            if ($wasPrimary) {
                $replacement = MarketplaceImage::query()
                    ->where('marketplace_listing_id', $listing->id)
                    ->orderBy('sort_order')
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->first();
                if ($replacement !== null) {
                    $replacement->is_primary = true;
                    $replacement->save();
                }
            }

            return true;
        });

        if ($deleted) {
            self::markPendingForModeration($listing);
        }

        return $deleted;
    }

    /**
     * Return an approved listing to moderation after its public media changes.
     */
    public static function markPendingForModeration(MarketplaceListing $listing): bool
    {
        if ($listing->moderation_status !== 'approved'
            || !MarketplaceConfigurationService::moderationEnabled()) {
            return false;
        }

        $listing->moderation_status = 'pending';
        $listing->moderation_notes = null;
        $listing->moderated_by = null;
        $listing->moderated_at = null;
        $listing->save();
        SearchService::removeMarketplaceListing($listing->id);

        return true;
    }

    // -----------------------------------------------------------------
    //  Saved / Favorites
    // -----------------------------------------------------------------

    /**
     * Save/bookmark a listing for a user.
     */
    public static function saveListing(int $userId, int $listingId): void
    {
        // Validate the listing belongs to the current tenant (HasTenantScope returns null if cross-tenant)
        if (!MarketplaceListing::find($listingId)) {
            return;
        }

        $saved = MarketplaceSavedListing::firstOrCreate([
            'tenant_id' => TenantContext::getId(),
            'user_id' => $userId,
            'marketplace_listing_id' => $listingId,
        ]);

        if ($saved->wasRecentlyCreated) {
            MarketplaceListing::where('id', $listingId)->increment('saves_count');
        }
    }

    /**
     * Unsave/unbookmark a listing.
     */
    public static function unsaveListing(int $userId, int $listingId): void
    {
        $deleted = MarketplaceSavedListing::where('user_id', $userId)
            ->where('marketplace_listing_id', $listingId)
            ->delete();

        if ($deleted) {
            MarketplaceListing::where('id', $listingId)->update([
                'saves_count' => DB::raw('GREATEST(saves_count - 1, 0)'),
            ]);
        }
    }

    /**
     * Get saved marketplace listings for a user.
     */
    public static function getSavedListings(int $userId, int $limit = 20, ?string $cursor = null): array
    {
        $query = MarketplaceSavedListing::query()
            ->where('user_id', $userId)
            ->orderBy('id', 'desc');

        if ($cursor) {
            $query->where('id', '<', (int) base64_decode($cursor, true));
        }

        $saved = $query->limit($limit + 1)->get();
        $hasMore = $saved->count() > $limit;
        if ($hasMore) {
            $saved->pop();
        }

        $listingIds = $saved->pluck('marketplace_listing_id');
        $listingsQuery = MarketplaceListing::query()
            ->with([
                'user:id,first_name,last_name,profile_type,organization_name,avatar_url',
                'category:id,name,slug,icon',
                'images' => fn ($q) => $q->orderByDesc('is_primary')->orderBy('sort_order')->limit(1),
            ])
            ->withCount('images')
            ->whereIn('id', $listingIds);
        self::applyPublicVisibility($listingsQuery);
        $listings = $listingsQuery->get()
            ->keyBy('id');

        $items = $saved->map(function ($s) use ($listings) {
            $listing = $listings[$s->marketplace_listing_id] ?? null;
            if (!$listing) {
                return null;
            }
            return self::formatListingItem($listing, [$listing->id => true], null);
        })->filter()->values()->all();

        return [
            'items' => $items,
            'cursor' => $hasMore && $saved->isNotEmpty() ? base64_encode((string) $saved->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    // -----------------------------------------------------------------
    //  Analytics
    // -----------------------------------------------------------------

    /**
     * Increment view count for a listing.
     */
    public static function recordView(int $listingId): void
    {
        MarketplaceListing::where('id', $listingId)->increment('views_count');
    }

    /**
     * Get analytics for a listing (owner view).
     */
    public static function getAnalytics(MarketplaceListing $listing): array
    {
        $offerCount = DB::table('marketplace_offers')
            ->where('marketplace_listing_id', $listing->id)
            ->where('tenant_id', $listing->tenant_id)
            ->count();

        return [
            'views' => $listing->views_count,
            'saves' => $listing->saves_count,
            'contacts' => $listing->contacts_count,
            'offers' => $offerCount,
            'created_at' => $listing->created_at?->toISOString(),
            'expires_at' => $listing->expires_at?->toISOString(),
            'days_active' => $listing->created_at?->diffInDays(now()),
        ];
    }

    // -----------------------------------------------------------------
    //  Categories
    // -----------------------------------------------------------------

    /**
     * Get marketplace categories with listing counts.
     */
    public static function getCategories(): array
    {
        $tenantId = TenantContext::getId();

        $categories = DB::table('marketplace_categories')
            ->where(function ($q) use ($tenantId) {
                $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
            })
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get();

        // Get listing counts per category
        $counts = DB::table('marketplace_listings')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('moderation_status', 'approved')
            ->where(static function ($query): void {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->groupBy('category_id')
            ->selectRaw('category_id, COUNT(*) as count')
            ->pluck('count', 'category_id');

        return $categories->map(fn ($c) => [
            'id' => $c->id,
            'name' => $c->name,
            'slug' => $c->slug,
            'description' => $c->description,
            'icon' => $c->icon,
            'parent_id' => $c->parent_id,
            'listing_count' => $counts[$c->id] ?? 0,
        ])->all();
    }

    // -----------------------------------------------------------------
    //  Formatting helpers
    // -----------------------------------------------------------------

    private static function formatListingItem(MarketplaceListing $listing, array $savedIds, ?int $currentUserId): array
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

    private static function formatListingDetail(MarketplaceListing $listing, bool $isSaved, ?int $currentUserId): array
    {
        $isOwner = $currentUserId !== null && (int) $listing->user_id === $currentUserId;
        $latitude = $listing->latitude !== null
            ? ($isOwner ? (float) $listing->latitude : round((float) $listing->latitude, 2))
            : null;
        $longitude = $listing->longitude !== null
            ? ($isOwner ? (float) $listing->longitude : round((float) $listing->longitude, 2))
            : null;
        $images = $listing->relationLoaded('images')
            ? $listing->images->map(fn ($img) => [
                'id' => $img->id,
                'url' => $img->image_url,
                'thumbnail_url' => $img->thumbnail_url,
                'alt_text' => $img->alt_text,
                'is_primary' => $img->is_primary,
            ])->all()
            : [];

        $detail = [
            'id' => $listing->id,
            'title' => $listing->title,
            'description' => $listing->description,
            'tagline' => $listing->tagline,
            'price' => $listing->price !== null ? (float) $listing->price : null,
            'price_currency' => $listing->price_currency,
            'price_type' => $listing->price_type,
            'time_credit_price' => $listing->time_credit_price !== null
                ? (float) $listing->time_credit_price
                : null,
            'category' => $listing->category ? [
                'id' => $listing->category->id,
                'name' => $listing->category->name,
                'slug' => $listing->category->slug,
                'icon' => $listing->category->icon,
            ] : null,
            'condition' => $listing->condition,
            'quantity' => $listing->quantity,
            'location' => $listing->location,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'shipping_available' => $listing->shipping_available,
            'local_pickup' => $listing->local_pickup,
            'delivery_method' => $listing->delivery_method,
            'seller_type' => $listing->seller_type,
            'status' => $listing->status,
            'template_data' => $listing->template_data,
            'video_url' => $listing->video_url,
            'images' => $images,
            'user' => $listing->user ? [
                'id' => $listing->user->id,
                'name' => UserDisplayName::resolve($listing->user),
                'avatar_url' => $listing->user->avatar_url,
                'is_verified' => $listing->user->is_verified ?? false,
                'member_since' => $listing->user->created_at?->toISOString(),
            ] : null,
            'is_saved' => $isSaved,
            'is_own' => $isOwner,
            'is_promoted' => $listing->promoted_until && $listing->promoted_until > now(),
            'views_count' => $listing->views_count,
            'saves_count' => $listing->saves_count,
            'expires_at' => $listing->expires_at?->toISOString(),
            'created_at' => $listing->created_at?->toISOString(),
            'updated_at' => $listing->updated_at?->toISOString(),
        ];

        // Inventory is commercially sensitive and only needed by the seller's
        // edit workflow. Preserve the fields for owners without exposing exact
        // stock levels to public listing viewers.
        if ($isOwner) {
            $detail['inventory_count'] = $listing->inventory_count !== null
                ? (int) $listing->inventory_count
                : null;
            $detail['low_stock_threshold'] = $listing->low_stock_threshold !== null
                ? (int) $listing->low_stock_threshold
                : null;
            $detail['is_oversold_protected'] = (bool) $listing->is_oversold_protected;
        }

        return $detail;
    }

    // -----------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------

    /**
     * Apply the canonical public-listing visibility contract.
     */
    public static function applyPublicVisibility(Builder $query): Builder
    {
        $query->where('status', 'active')
            ->where('moderation_status', 'approved')
            ->where(static function (Builder $expiryQuery): void {
                $expiryQuery->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->whereNotExists(static function ($inactiveSeller): void {
                $inactiveSeller->selectRaw('1')
                    ->from('users as marketplace_public_seller')
                    ->whereColumn('marketplace_public_seller.id', 'marketplace_listings.user_id')
                    ->whereColumn('marketplace_public_seller.tenant_id', 'marketplace_listings.tenant_id')
                    ->where(static function ($inactive): void {
                        $inactive->where('marketplace_public_seller.status', '!=', 'active')
                            ->orWhere('marketplace_public_seller.is_approved', false);
                    });
            })
            ->whereNotExists(static function ($suspendedSeller): void {
                $suspendedSeller->selectRaw('1')
                    ->from('marketplace_seller_profiles as marketplace_public_profile')
                    ->whereColumn('marketplace_public_profile.user_id', 'marketplace_listings.user_id')
                    ->whereColumn('marketplace_public_profile.tenant_id', 'marketplace_listings.tenant_id')
                    ->where('marketplace_public_profile.is_suspended', true);
            });

        if (! MarketplaceConfigurationService::allowFreeItems()) {
            $query->where('price_type', '!=', 'free');
        }

        return $query;
    }

    /** Block every publication path for an administratively suspended seller. */
    public static function assertSellerCanPublish(int $userId): void
    {
        $isSuspended = MarketplaceSellerProfile::query()
            ->where('user_id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->where('is_suspended', true)
            ->exists();

        if ($isSuspended) {
            throw new \DomainException('SELLER_SUSPENDED');
        }
    }

    /**
     * Canonicalize monetary input at the service boundary so CSV imports and
     * other non-HTTP callers cannot create prices Stripe cannot represent.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private static function normalizePricingInput(
        array $data,
        ?MarketplaceListing $existing = null,
    ): array {
        $rawCurrency = array_key_exists('price_currency', $data)
            ? (string) $data['price_currency']
            : (string) ($existing?->price_currency ?? TenantContext::getCurrency());
        $currency = StripeCurrency::normalize($rawCurrency);

        if ($existing === null || array_key_exists('price_currency', $data)) {
            $data['price_currency'] = $currency;
        }

        $price = array_key_exists('price', $data) ? $data['price'] : $existing?->price;
        if ($price !== null && $price !== '') {
            $numericPrice = (float) $price;
            if (! is_finite($numericPrice) || $numericPrice < 0) {
                throw new \InvalidArgumentException(__('api.validation_failed'));
            }
            StripeCurrency::toMinor($numericPrice, $currency);
            if (array_key_exists('price', $data)) {
                $data['price'] = StripeCurrency::roundMajor($numericPrice, $currency);
            }
        }

        if (array_key_exists('time_credit_price', $data)
            && $data['time_credit_price'] !== null
            && $data['time_credit_price'] !== '') {
            $timeCreditPrice = (float) $data['time_credit_price'];
            if (! is_finite($timeCreditPrice) || $timeCreditPrice < 0) {
                throw new \InvalidArgumentException(__('api.validation_failed'));
            }
        }

        return $data;
    }

    /**
     * Enforce tenant marketplace policy at the service boundary so imports and
     * future non-HTTP callers cannot bypass the maintained controller UI.
     *
     * Existing legacy listings remain editable unless a governed field is
     * changed; checkout independently re-checks the current policy.
     *
     * @param array<string,mixed> $data
     */
    private static function assertListingPolicy(
        array $data,
        ?MarketplaceListing $existing = null,
    ): void {
        $isCreate = $existing === null;
        $priceType = (string) ($data['price_type'] ?? $existing?->price_type ?? 'fixed');
        if (($isCreate || array_key_exists('price_type', $data))
            && $priceType === 'free'
            && ! MarketplaceConfigurationService::allowFreeItems()) {
            throw new \InvalidArgumentException(__('api.marketplace_free_items_disabled'));
        }

        $sellerType = (string) ($data['seller_type'] ?? $existing?->seller_type ?? 'private');
        if (($isCreate || array_key_exists('seller_type', $data))
            && $sellerType === 'business'
            && ! MarketplaceConfigurationService::allowBusinessSellers()) {
            throw new \InvalidArgumentException(__('api.marketplace_business_sellers_disabled'));
        }

        $deliveryMethod = (string) ($data['delivery_method'] ?? $existing?->delivery_method ?? 'pickup');
        $shippingAvailable = (bool) ($data['shipping_available'] ?? $existing?->shipping_available ?? false);
        if (($isCreate
                || array_key_exists('delivery_method', $data)
                || array_key_exists('shipping_available', $data))
            && ($shippingAvailable || in_array($deliveryMethod, ['shipping', 'both'], true))
            && ! MarketplaceConfigurationService::allowShipping()) {
            throw new \InvalidArgumentException(__('api.marketplace_shipping_disabled'));
        }
        if (($isCreate || array_key_exists('delivery_method', $data))
            && $deliveryMethod === 'community_delivery'
            && ! MarketplaceConfigurationService::allowCommunityDelivery()) {
            throw new \InvalidArgumentException(__('api.marketplace_community_delivery_disabled'));
        }

        $cashPrice = (float) ($data['price'] ?? $existing?->price ?? 0);
        $creditPrice = (float) ($data['time_credit_price'] ?? $existing?->time_credit_price ?? 0);
        if (($isCreate
                || array_key_exists('price', $data)
                || array_key_exists('time_credit_price', $data))
            && $cashPrice > 0
            && $creditPrice > 0
            && ! MarketplaceConfigurationService::allowHybridPricing()) {
            throw new \InvalidArgumentException(__('api.marketplace_hybrid_pricing_disabled'));
        }
    }

    /**
     * Allow current-tenant and system categories only.
     */
    private static function ensureCategoryAvailable(mixed $categoryId): void
    {
        if ($categoryId === null || $categoryId === '') {
            return;
        }

        $tenantId = TenantContext::getId();
        $available = DB::table('marketplace_categories')
            ->where('id', (int) $categoryId)
            ->where('is_active', true)
            ->where(static function ($query) use ($tenantId): void {
                $query->where('tenant_id', $tenantId)
                    ->orWhereNull('tenant_id');
            })
            ->exists();

        if (!$available) {
            throw new \DomainException('MARKETPLACE_CATEGORY_UNAVAILABLE');
        }
    }

    /**
     * Geocode a listing's location to lat/lng coordinates.
     */
    private static function geocodeListing(MarketplaceListing $listing): void
    {
        if (!$listing->location) {
            return;
        }

        try {
            $coords = GeocodingService::geocode($listing->location);
            if ($coords) {
                $listing->latitude = $coords['latitude'];
                $listing->longitude = $coords['longitude'];
                $listing->save();
            }
        } catch (\Throwable $e) {
            // Geocoding is best-effort — don't fail the listing operation
            \Illuminate\Support\Facades\Log::warning('Marketplace geocoding failed', [
                'listing_id' => $listing->id,
                'location' => $listing->location,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
