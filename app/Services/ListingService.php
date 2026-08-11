<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\Events\ListingCreated;
use App\Events\ListingUpdated;
use App\I18n\LocaleContext;
use App\Models\Listing;
use App\Models\User;
use App\Services\SearchService;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ListingService — Laravel DI-based service for listing operations.
 *
 * This is the Eloquent/DI counterpart to the legacy static
 * class via constructor type-hinting; the legacy static class remains
 * available for existing code that has not yet been migrated.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope
 * trait on the Listing model.
 */
class ListingService
{
    public function __construct(
        private readonly Listing $listing,
    ) {}

    private static function applyPublicVisibility(Builder $query): Builder
    {
        return $query
            ->where(function (Builder $q) {
                $q->whereNull('status')->orWhere('status', 'active');
            })
            ->where(function (Builder $q) {
                $q->whereNull('moderation_status')->orWhere('moderation_status', 'approved');
            });
    }

    private static function configBool(array $config, string $key): bool
    {
        return filter_var($config[$key] ?? ListingConfigurationService::DEFAULTS[$key] ?? false, FILTER_VALIDATE_BOOLEAN);
    }

    // -----------------------------------------------------------------
    //  Read
    // -----------------------------------------------------------------

    /**
     * Get active listings with optional filtering and cursor pagination.
     *
     * @param array{
     *   type?: string|string[],
     *   category_id?: int,
     *   category_slug?: string,
     *   user_id?: int,
     *   search?: string,
     *   skills?: string|string[],
     *   featured_first?: bool,
     *   with_coordinates?: bool,
     *   include_deleted?: bool,
     *   current_user_id?: int|null,
     *   limit?: int,
     *   cursor?: string|null,
     * } $filters
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getAll(array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;
        $currentUserId = ! empty($filters['current_user_id'])
            ? (int) $filters['current_user_id']
            : null;

        // ── Meilisearch search path ──────────────────────────────────────────
        // When a search term is present and Meilisearch is available, use it for
        // typo-tolerant, relevance-ranked ID retrieval, then hydrate from SQL.
        // Falls through to the SQL path below if Meilisearch is unavailable.
        // Skip Meilisearch when faceted filters are active — they're applied
        // post-search in SQL which breaks pagination (IDs filtered out → fewer
        // items than limit). The SQL path handles all filters correctly.
        $hasFacetedFilters = !empty($filters['min_hours']) || !empty($filters['max_hours'])
            || !empty($filters['service_type']) || !empty($filters['posted_within'])
            || !empty($filters['with_coordinates']) || !empty($filters['near_lat']);
        if (!empty($filters['search']) && !$hasFacetedFilters) {
            $tenantId = \App\Core\TenantContext::getId();

            // Decode Meilisearch offset cursor (format: "meili:<offset>")
            $meiliOffset = 0;
            if (is_string($cursor)) {
                $decoded = base64_decode($cursor, true);
                if ($decoded !== false && str_starts_with($decoded, 'meili:')) {
                    $meiliOffset = (int) substr($decoded, 6);
                }
            }

            // Filters expressible in Meilisearch
            $meiliFilters = [];

            if (!empty($filters['category_id'])) {
                $meiliFilters[] = 'category_id = ' . (int) $filters['category_id'];
            } elseif (!empty($filters['category_slug'])) {
                // Resolve slug → id so Meilisearch can apply the category filter
                $catId = self::resolveCategorySlug((string) $filters['category_slug']);
                if ($catId) {
                    $meiliFilters[] = 'category_id = ' . $catId;
                } else {
                    return ['items' => [], 'cursor' => null, 'has_more' => false];
                }
            }

            if (!empty($filters['type']) && is_string($filters['type'])) {
                $meiliFilters[] = SearchService::buildEqFilter('listings', 'type', $filters['type']);
            }

            if (!empty($filters['user_id'])) {
                $meiliFilters[] = 'user_id = ' . (int) $filters['user_id'];
            }

            if (!empty($filters['skills'])) {
                $skills = is_array($filters['skills'])
                    ? $filters['skills']
                    : explode(',', $filters['skills']);
                foreach (array_filter(array_map(fn($s) => strtolower(trim($s)), $skills)) as $skill) {
                    $meiliFilters[] = SearchService::buildEqFilter('listings', 'skill_tags', $skill);
                }
            }

            $meiliResult = SearchService::searchListingIds(
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

                $q = Listing::query()
                    ->with(['user:id,first_name,last_name,organization_name,profile_type,avatar_url,tagline,is_verified',
                            'category:id,name,color,slug'])
                    ->whereIn('id', $ids);

                self::applyPublicVisibility($q);

                // Multi-type arrays can't be expressed in the Meilisearch filter above
                if (!empty($filters['type']) && is_array($filters['type'])) {
                    $q->whereIn('type', $filters['type']);
                }

                // Faceted filters — applied post-Meilisearch on SQL hydration
                if (!empty($filters['min_hours'])) {
                    $q->where('hours_estimate', '>=', (float) $filters['min_hours']);
                }
                if (!empty($filters['max_hours'])) {
                    $q->where('hours_estimate', '<=', (float) $filters['max_hours']);
                }
                if (!empty($filters['service_type'])) {
                    $types = is_string($filters['service_type']) ? explode(',', $filters['service_type']) : $filters['service_type'];
                    $q->whereIn('service_type', $types);
                }
                if (!empty($filters['posted_within'])) {
                    $q->where('created_at', '>=', now()->subDays((int) $filters['posted_within']));
                }

                $listingsById = $q->get()->keyBy('id');

                $savedIds = [];
                if ($currentUserId && $listingsById->isNotEmpty()) {
                    $savedIds = DB::table('user_saved_listings')
                        ->where('user_id', $currentUserId)
                        ->where('tenant_id', $tenantId)
                        ->whereIn('listing_id', $listingsById->keys())
                        ->pluck('listing_id')->flip()->all();
                }

                // Batch author ratings to avoid N+1 in the loop below
                $authorRatings = [];
                if ($listingsById->isNotEmpty()) {
                    $userIds = $listingsById->pluck('user_id')->filter()->unique()->values()->all();
                    if (!empty($userIds)) {
                        $ratings = DB::table('reviews')
                            ->whereIn('receiver_id', $userIds)
                            ->where('tenant_id', $tenantId)
                            ->select('receiver_id', DB::raw('AVG(rating) as avg_rating'))
                            ->groupBy('receiver_id')
                            ->get();
                        foreach ($ratings as $r) {
                            $authorRatings[(int) $r->receiver_id] = round((float) $r->avg_rating, 1);
                        }
                    }
                }

                // Preserve Meilisearch relevance order
                $items = [];
                foreach ($ids as $id) {
                    $listing = $listingsById[$id] ?? null;
                    if ($listing) {
                        $items[] = self::formatListingItem($listing, $savedIds, $currentUserId, $authorRatings);
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

        // Delegate to haversine proximity search when coordinates are provided
        if (!empty($filters['near_lat']) && !empty($filters['near_lng']) && !empty($filters['radius_km'])) {
            return self::getNearby((float) $filters['near_lat'], (float) $filters['near_lng'], $filters);
        }

        $query = Listing::query()
            ->with(['user:id,first_name,last_name,organization_name,profile_type,avatar_url,tagline,is_verified',
                     'category:id,name,color,slug']);

        // Status filter
        if (empty($filters['include_deleted'])) {
            self::applyPublicVisibility($query);
        }

        // Type filter
        if (! empty($filters['type'])) {
            $type = $filters['type'];
            is_array($type)
                ? $query->whereIn('type', $type)
                : $query->where('type', $type);
        }

        // Category filter
        if (! empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        // Category slug filter (resolve slug → id, tenant-scoped)
        if (!empty($filters['category_slug'])) {
            $catId = self::resolveCategorySlug((string) $filters['category_slug']);
            if ($catId) {
                $query->where('category_id', $catId);
            } else {
                $query->whereRaw('1 = 0');
            }
        }

        // User filter
        if (! empty($filters['user_id'])) {
            $query->where('user_id', (int) $filters['user_id']);
        }

        // Search (basic LIKE — Meilisearch integration can be layered on)
        if (! empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function (Builder $q) use ($term) {
                $q->where('title', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term)
                  ->orWhere('location', 'LIKE', $term);
            });
        }

        // Skills filter
        if (! empty($filters['skills'])) {
            $skills = is_array($filters['skills'])
                ? $filters['skills']
                : explode(',', $filters['skills']);
            $skills = array_map(fn ($s) => strtolower(trim($s)), array_filter($skills));

            if (! empty($skills)) {
                $query->whereHas('skillTags', function (Builder $q) use ($skills) {
                    $q->whereIn('tag', $skills);
                });
            }
        }

        // Faceted filters: hours estimate range
        if (!empty($filters['min_hours'])) {
            $query->where('hours_estimate', '>=', (float) $filters['min_hours']);
        }
        if (!empty($filters['max_hours'])) {
            $query->where('hours_estimate', '<=', (float) $filters['max_hours']);
        }

        // Faceted filters: service delivery mode
        if (!empty($filters['service_type'])) {
            $types = is_string($filters['service_type']) ? explode(',', $filters['service_type']) : $filters['service_type'];
            $query->whereIn('service_type', $types);
        }

        // Faceted filters: posted within N days
        if (!empty($filters['posted_within'])) {
            $query->where('created_at', '>=', now()->subDays((int) $filters['posted_within']));
        }
        if (!empty($filters['with_coordinates'])) {
            $query->whereNotNull('latitude')
                ->whereNotNull('longitude');
        }

        // Cursor pagination (ID-based, descending)
        if (is_string($cursor)) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
        }

        // Ordering
        if (! empty($filters['featured_first'])) {
            $query->orderByDesc('is_featured');
        }
        $query->orderByDesc('id');

        // Fetch limit + 1 to determine has_more
        $items = $query->limit($limit + 1)->get();

        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $nextCursor = $hasMore && $items->isNotEmpty()
            ? base64_encode((string) $items->last()->id)
            : null;

        // If a current user is provided, eager-load the is_favorited flag
        $savedIds = [];
        if ($currentUserId && $items->isNotEmpty()) {
            $savedIds = DB::table('user_saved_listings')
                ->where('user_id', $currentUserId)
                ->where('tenant_id', \App\Core\TenantContext::getId())
                ->whereIn('listing_id', $items->pluck('id'))
                ->pluck('listing_id')
                ->flip()
                ->all();
        }

        // Batch author ratings — one query for all listings to avoid N+1
        $authorRatings = [];
        if ($items->isNotEmpty()) {
            $userIds = $items->pluck('user_id')->filter()->unique()->values()->all();
            if (!empty($userIds)) {
                $ratings = DB::table('reviews')
                    ->whereIn('receiver_id', $userIds)
                    ->where('tenant_id', \App\Core\TenantContext::getId())
                    ->select('receiver_id', DB::raw('AVG(rating) as avg_rating'))
                    ->groupBy('receiver_id')
                    ->get();
                foreach ($ratings as $r) {
                    $authorRatings[(int) $r->receiver_id] = round((float) $r->avg_rating, 1);
                }
            }
        }

        $result = $items->map(
            fn(Listing $listing) => self::formatListingItem($listing, $savedIds, $currentUserId, $authorRatings)
        )->all();

        return [
            'items'    => array_values($result),
            'cursor'   => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Shape a Listing model into the array contract expected by the React frontend.
     *
     * @param array $authorRatings Pre-fetched map of user_id => avg_rating (avoids N+1 when processing lists)
     */
    private static function formatListingItem(Listing $listing, array $savedIds, ?int $currentUserId, array $authorRatings = []): array
    {
        $data = $listing->toArray();

        $user = $listing->user;
        $data['user'] = $user ? [
            'id'         => $user->id,
            'name'       => ($user->profile_type === 'organisation' && $user->organization_name)
                                ? $user->organization_name
                                : trim($user->first_name . ' ' . $user->last_name),
            'avatar'     => $user->avatar_url,
            'avatar_url' => $user->avatar_url,
            'tagline'    => $user->tagline,
        ] : null;

        // The listings table has a legacy `category` timestamp column that shadows
        // the category() BelongsTo relation via magic __get. Read the eager-loaded
        // relation explicitly.
        $cat = $listing->relationLoaded('category') ? $listing->getRelation('category') : null;
        $data['category_name']  = $cat?->name;
        $data['category_color'] = $cat?->color;
        $data['category_slug']  = $cat?->slug;

        // Lightweight trust signals for list view
        if ($user) {
            $data['author_verified'] = (bool) ($user->is_verified ?? false);
            // Use pre-fetched ratings map when available; fall back to single query for single-item calls
            if (!empty($authorRatings)) {
                $data['author_rating'] = $authorRatings[$user->id] ?? null;
            } else {
                try {
                    $avgRating = DB::table('reviews')
                        ->where('receiver_id', $user->id)
                        ->where('tenant_id', \App\Core\TenantContext::getId())
                        ->avg('rating');
                    $data['author_rating'] = $avgRating ? round((float) $avgRating, 1) : null;
                } catch (\Throwable $e) {
                    $data['author_rating'] = null;
                }
            }
        }

        if ($currentUserId) {
            $data['is_favorited'] = isset($savedIds[$listing->id]);
        }

        return $data;
    }

    /**
     * Count total listings matching filters (without cursor/limit).
     *
     * Accepts the same filter array as getAll(), but ignores cursor and limit.
     */
    public static function countAll(array $filters = []): int
    {
        // Use Meilisearch's estimated total when a search term is present,
        // BUT only when no faceted filters are active (hours, service_type,
        // posted_within) since Meilisearch can't apply those — its total
        // would be inaccurate.
        $hasFacetedFilters = !empty($filters['min_hours']) || !empty($filters['max_hours'])
            || !empty($filters['service_type']) || !empty($filters['posted_within'])
            || !empty($filters['with_coordinates']) || !empty($filters['near_lat']);
        if (!empty($filters['search']) && !$hasFacetedFilters) {
            $tenantId     = \App\Core\TenantContext::getId();
            $meiliFilters = [];
            if (!empty($filters['category_id'])) {
                $meiliFilters[] = 'category_id = ' . (int) $filters['category_id'];
            } elseif (!empty($filters['category_slug'])) {
                $catId = self::resolveCategorySlug((string) $filters['category_slug']);
                if ($catId) {
                    $meiliFilters[] = 'category_id = ' . $catId;
                } else {
                    return 0;
                }
            }
            if (!empty($filters['type']) && is_string($filters['type'])) {
                $meiliFilters[] = SearchService::buildEqFilter('listings', 'type', $filters['type']);
            }
            if (!empty($filters['user_id'])) {
                $meiliFilters[] = 'user_id = ' . (int) $filters['user_id'];
            }
            if (!empty($filters['skills'])) {
                $skills = is_array($filters['skills'])
                    ? $filters['skills']
                    : explode(',', $filters['skills']);
                foreach (array_filter(array_map(fn($s) => strtolower(trim($s)), $skills)) as $skill) {
                    $meiliFilters[] = SearchService::buildEqFilter('listings', 'skill_tags', $skill);
                }
            }
            $meiliResult = SearchService::searchListingIds($filters['search'], $tenantId, $meiliFilters, 1, 0);
            if ($meiliResult !== null) {
                return $meiliResult['total'];
            }
        }

        // Proximity count — raw SQL with explicit binding order avoids Eloquent's
        // mergeBindings() reordering SELECT bindings after WHERE bindings.
        if (!empty($filters['near_lat']) && !empty($filters['near_lng']) && !empty($filters['radius_km'])) {
            $lat      = (float) $filters['near_lat'];
            $lon      = (float) $filters['near_lng'];
            $radiusKm = (float) $filters['radius_km'];
            $tenantId = TenantContext::getId();

            $whereClauses = [
                'tenant_id = ?',
                "status = 'active'",
                "(moderation_status IS NULL OR moderation_status = 'approved')",
                'latitude IS NOT NULL',
                'longitude IS NOT NULL',
            ];
            $bindings = [$lat, $lon, $lat, $tenantId];

            if (!empty($filters['type'])) {
                $type = $filters['type'];
                if (is_array($type)) {
                    $placeholders = implode(',', array_fill(0, count($type), '?'));
                    $whereClauses[] = "type IN ({$placeholders})";
                    $bindings = array_merge($bindings, array_values($type));
                } else {
                    $whereClauses[] = 'type = ?';
                    $bindings[]     = $type;
                }
            }
            if (!empty($filters['category_id'])) {
                $whereClauses[] = 'category_id = ?';
                $bindings[]     = (int) $filters['category_id'];
            }

            $bindings[] = $radiusKm;

            $whereStr = implode(' AND ', $whereClauses);
            $sql = "SELECT COUNT(*) AS total FROM (
                SELECT (6371 * acos(LEAST(1.0, GREATEST(-1.0,
                    cos(radians(?)) * cos(radians(latitude)) *
                    cos(radians(longitude) - radians(?)) +
                    sin(radians(?)) * sin(radians(latitude))
                )))) AS distance_km
                FROM listings
                WHERE {$whereStr}
            ) AS sub WHERE distance_km <= ?";

            $result = DB::selectOne($sql, $bindings);
            return (int) ($result->total ?? 0);
        }

        $query = Listing::query();

        // Status filter
        if (empty($filters['include_deleted'])) {
            self::applyPublicVisibility($query);
        }

        // Type filter
        if (! empty($filters['type'])) {
            $type = $filters['type'];
            is_array($type)
                ? $query->whereIn('type', $type)
                : $query->where('type', $type);
        }

        // Category filter
        if (! empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        // Category slug filter (resolve slug → id, tenant-scoped)
        if (!empty($filters['category_slug'])) {
            $catId = self::resolveCategorySlug((string) $filters['category_slug']);
            if ($catId) {
                $query->where('category_id', $catId);
            } else {
                $query->whereRaw('1 = 0');
            }
        }

        // User filter
        if (! empty($filters['user_id'])) {
            $query->where('user_id', (int) $filters['user_id']);
        }

        // Search
        if (! empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function (Builder $q) use ($term) {
                $q->where('title', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term)
                  ->orWhere('location', 'LIKE', $term);
            });
        }

        // Skills filter
        if (! empty($filters['skills'])) {
            $skills = is_array($filters['skills'])
                ? $filters['skills']
                : explode(',', $filters['skills']);
            $skills = array_map(fn ($s) => strtolower(trim($s)), array_filter($skills));

            if (! empty($skills)) {
                $query->whereHas('skillTags', function (Builder $q) use ($skills) {
                    $q->whereIn('tag', $skills);
                });
            }
        }

        // Faceted filters: hours estimate range
        if (!empty($filters['min_hours'])) {
            $query->where('hours_estimate', '>=', (float) $filters['min_hours']);
        }
        if (!empty($filters['max_hours'])) {
            $query->where('hours_estimate', '<=', (float) $filters['max_hours']);
        }

        // Faceted filters: service delivery mode
        if (!empty($filters['service_type'])) {
            $types = is_string($filters['service_type']) ? explode(',', $filters['service_type']) : $filters['service_type'];
            $query->whereIn('service_type', $types);
        }

        // Faceted filters: posted within N days
        if (!empty($filters['posted_within'])) {
            $query->where('created_at', '>=', now()->subDays((int) $filters['posted_within']));
        }
        if (!empty($filters['with_coordinates'])) {
            $query->whereNotNull('latitude')
                ->whereNotNull('longitude');
        }

        return $query->count();
    }

    /**
     * Get a single listing by ID.
     */
    public static function getById(int $id, bool $includeDeleted = false, ?int $currentUserId = null): ?array
    {
        $query = Listing::query()
            ->with([
                'user:id,first_name,last_name,organization_name,profile_type,avatar_url,tagline,is_verified',
                'category',
                'skillTags',
            ]);

        if (! $includeDeleted) {
            $query->where(function (Builder $q) {
                $q->whereNull('status')->orWhere('status', '!=', 'deleted');
            });
        }

        /** @var Listing|null $listing */
        $listing = $query->find($id);

        if (! $listing) {
            return null;
        }

        // Draft/pending/suspended listings are only visible to their owner
        $listingStatus = $listing->status ?? 'active';
        if (!in_array($listingStatus, ['active', null], true) && $listing->user_id !== $currentUserId) {
            return null;
        }

        $moderationStatus = $listing->moderation_status;
        if ($listing->user_id !== $currentUserId && $moderationStatus !== null && $moderationStatus !== 'approved') {
            return null;
        }

        $data = $listing->toArray();
        $tenantId = \App\Core\TenantContext::getId();

        // Author info — replace the eager-loaded user relation with safe public fields only
        $user = $listing->user;
        if ($user) {
            $data['author_name'] = ($user->profile_type === 'organisation' && $user->organization_name)
                ? $user->organization_name
                : trim($user->first_name . ' ' . $user->last_name);
            $data['author_avatar'] = $user->avatar_url ?? null;
            $data['user'] = [
                'id'         => $user->id,
                'name'       => $data['author_name'],
                'avatar'     => $user->avatar_url,
                'avatar_url' => $user->avatar_url,
                'tagline'    => $user->tagline,
            ];

            // Trust signals — full stats for detail view
            $data['author_verified'] = (bool) ($user->is_verified ?? false);
            try {
                $reviewStats = DB::table('reviews')
                    ->where('receiver_id', $user->id)
                    ->where('tenant_id', $tenantId)
                    ->selectRaw('AVG(rating) as avg_rating, COUNT(*) as review_count')
                    ->first();
                $data['author_rating'] = $reviewStats && $reviewStats->avg_rating
                    ? round((float) $reviewStats->avg_rating, 1) : null;
                $data['author_reviews_count'] = $reviewStats ? (int) $reviewStats->review_count : 0;
            } catch (\Throwable $e) {
                $data['author_rating'] = null;
                $data['author_reviews_count'] = 0;
            }
            try {
                $data['author_exchanges_count'] = (int) DB::table('exchange_requests')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'completed')
                    ->where(function ($q) use ($user) {
                        $q->where('requester_id', $user->id)
                          ->orWhere('provider_id', $user->id);
                    })
                    ->count();
            } catch (\Throwable $e) {
                $data['author_exchanges_count'] = 0;
            }
        } else {
            $data['author_name'] = __('api.unknown_user');
            $data['author_avatar'] = null;
            $data['user'] = null;
        }

        // Category — `category` column on listings shadows the relation, read it explicitly.
        $cat = $listing->relationLoaded('category') ? $listing->getRelation('category') : null;
        $data['category_name'] = $cat?->name;
        $data['category_color'] = $cat?->color;
        $data['category_slug'] = $cat?->slug;

        // Engagement counts (wrapped in try/catch — tables may not exist during migration)
        try {
            $data['likes_count'] = (int) DB::table('likes')
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'listing')
                ->where('target_id', $id)
                ->count();
        } catch (\Throwable $e) {
            $data['likes_count'] = 0;
        }

        try {
            $data['comments_count'] = (int) DB::table('comments')
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'listing')
                ->where('target_id', $id)
                ->count();
        } catch (\Throwable $e) {
            $data['comments_count'] = 0;
        }

        // Favorited / liked flags for the current user
        $data['is_favorited'] = false;
        $data['is_liked'] = false;

        if ($currentUserId) {
            try {
                $data['is_favorited'] = DB::table('user_saved_listings')
                    ->where('listing_id', $id)
                    ->where('user_id', $currentUserId)
                    ->where('tenant_id', $tenantId)
                    ->exists();
            } catch (\Throwable $e) {
                // Table may not exist
            }

            try {
                $data['is_liked'] = DB::table('likes')
                    ->where('tenant_id', $tenantId)
                    ->where('target_type', 'listing')
                    ->where('target_id', $id)
                    ->where('user_id', $currentUserId)
                    ->exists();
            } catch (\Throwable $e) {
                // Table may not exist
            }
        }

        return $data;
    }

    // -----------------------------------------------------------------
    //  Nearby (Haversine geospatial query)
    // -----------------------------------------------------------------

    /**
     * Get listings near a geographic point using the Haversine formula.
     *
     * @param float $lat Latitude of search centre
     * @param float $lon Longitude of search centre
     * @param array{radius_km?: float, limit?: int, type?: string|string[], category_id?: int} $filters
     * @return array{items: array, has_more: bool}
     */
    public static function getNearby(float $lat, float $lon, array $filters = []): array
    {
        $radiusKm = (float) ($filters['radius_km'] ?? 25);
        $limit = min((int) ($filters['limit'] ?? 20), 100);

        // Decode offset cursor (format: "nearby:<offset>")
        $offset = 0;
        $cursor = $filters['cursor'] ?? null;
        if (is_string($cursor)) {
            $decoded = base64_decode($cursor, true);
            if ($decoded !== false && str_starts_with($decoded, 'nearby:')) {
                $offset = (int) substr($decoded, 7);
                $offset = max(0, min($offset, 10000)); // Cap at 10,000 results
            }
        }

        $haversine = '(6371 * acos(LEAST(1.0, GREATEST(-1.0, '
            . 'cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + '
            . 'sin(radians(?)) * sin(radians(latitude))'
            . '))))';

        $query = Listing::query()
            ->with([
                'user:id,first_name,last_name,organization_name,profile_type,avatar_url',
                'category:id,name,color',
            ])
            ->selectRaw("listings.*, {$haversine} AS distance_km", [$lat, $lon, $lat])
            ->where('status', 'active')
            ->where(function (Builder $q) {
                $q->whereNull('moderation_status')->orWhere('moderation_status', 'approved');
            })
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->having('distance_km', '<=', $radiusKm)
            ->orderBy('distance_km');

        // Type filter
        if (! empty($filters['type'])) {
            $type = $filters['type'];
            is_array($type)
                ? $query->whereIn('type', $type)
                : $query->where('type', $type);
        }

        // Category filter
        if (! empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        // Category slug filter (resolve slug → id, tenant-scoped)
        if (!empty($filters['category_slug'])) {
            $catId = self::resolveCategorySlug((string) $filters['category_slug']);
            if ($catId) {
                $query->where('category_id', $catId);
            } else {
                return ['items' => [], 'cursor' => null, 'has_more' => false];
            }
        }

        // Search (basic LIKE on title/description)
        if (! empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function (\Illuminate\Database\Eloquent\Builder $q) use ($term) {
                $q->where('title', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term);
            });
        }

        // Faceted filters: hours estimate range
        if (!empty($filters['min_hours'])) {
            $query->where('hours_estimate', '>=', (float) $filters['min_hours']);
        }
        if (!empty($filters['max_hours'])) {
            $query->where('hours_estimate', '<=', (float) $filters['max_hours']);
        }

        // Faceted filters: service delivery mode
        if (!empty($filters['service_type'])) {
            $types = is_string($filters['service_type']) ? explode(',', $filters['service_type']) : $filters['service_type'];
            $query->whereIn('service_type', $types);
        }

        // Faceted filters: posted within N days
        if (!empty($filters['posted_within'])) {
            $query->where('created_at', '>=', now()->subDays((int) $filters['posted_within']));
        }

        $items = $query->offset($offset)->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $currentUserId = !empty($filters['current_user_id']) ? (int) $filters['current_user_id'] : null;
        $tenantId = \App\Core\TenantContext::getId();

        // Eager-load is_favorited flag
        $savedIds = [];
        if ($currentUserId && $items->isNotEmpty()) {
            $savedIds = DB::table('user_saved_listings')
                ->where('user_id', $currentUserId)
                ->where('tenant_id', $tenantId)
                ->whereIn('listing_id', $items->pluck('id'))
                ->pluck('listing_id')->flip()->all();
        }

        $result = $items->map(function (Listing $listing) use ($savedIds, $currentUserId) {
            $data = $listing->toArray();
            $user = $listing->user;
            $data['author_name'] = ($user && $user->profile_type === 'organisation' && $user->organization_name)
                ? $user->organization_name
                : trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));
            $data['author_avatar'] = $user->avatar_url ?? null;
            $data['author_verified'] = (bool) ($user->is_verified ?? false);
            $data['user'] = $user ? [
                'id'         => $user->id,
                'name'       => $data['author_name'],
                'avatar'     => $user->avatar_url,
                'avatar_url' => $user->avatar_url,
            ] : null;
            $cat = $listing->relationLoaded('category') ? $listing->getRelation('category') : null;
            $data['category_name'] = $cat?->name;
            $data['category_color'] = $cat?->color;
            $data['distance_km'] = round((float) $listing->distance_km, 2);
            $data['is_favorited'] = isset($savedIds[$listing->id]);
            $data['can_edit'] = $currentUserId === $listing->user_id;
            $data['can_delete'] = $currentUserId === $listing->user_id;
            return $data;
        })->all();

        $nextCursor = $hasMore ? base64_encode('nearby:' . ($offset + $limit)) : null;

        return [
            'items'    => array_values($result),
            'cursor'   => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    // -----------------------------------------------------------------
    //  Featured listings
    // -----------------------------------------------------------------

    /**
     * Get currently featured listings.
     *
     * @param int $limit Max listings to return
     * @return array Featured listings
     */
    public static function getFeatured(int $limit = 10): array
    {
        return Listing::query()
            ->with([
                'user:id,first_name,last_name,organization_name,profile_type,avatar_url',
                'category:id,name,color',
            ])
            ->where('status', 'active')
            ->where(function (Builder $q) {
                $q->whereNull('moderation_status')->orWhere('moderation_status', 'approved');
            })
            ->where('is_featured', true)
            ->where(function (Builder $q) {
                $q->whereNull('featured_until')
                   ->orWhere('featured_until', '>', now());
            })
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get()
            ->map(function (Listing $listing) {
                $data = $listing->toArray();
                $user = $listing->user;
                $data['author_name'] = ($user && $user->profile_type === 'organisation' && $user->organization_name)
                    ? $user->organization_name
                    : trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));
                $data['author_avatar'] = $user->avatar_url ?? null;
                $cat = $listing->relationLoaded('category') ? $listing->getRelation('category') : null;
                $data['category_name'] = $cat?->name;
                $data['category_color'] = $cat?->color;
                return $data;
            })
            ->all();
    }

    // -----------------------------------------------------------------
    //  Saved / Favourite Listings
    // -----------------------------------------------------------------

    /**
     * Get listing IDs saved by the user in the current tenant.
     *
     * @return int[]
     */
    public static function getSavedListingIds(int $userId): array
    {
        return DB::table('user_saved_listings')
            ->where('user_id', $userId)
            ->where('tenant_id', \App\Core\TenantContext::getId())
            ->pluck('listing_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Save (favourite) a listing. Idempotent via INSERT IGNORE.
     *
     * @return bool False if listing not found in tenant
     */
    public static function saveListing(int $userId, int $listingId): bool
    {
        if (! self::configBool(ListingConfigurationService::getAll(), ListingConfigurationService::CONFIG_ENABLE_FAVOURITES)) {
            return false;
        }

        // Verify listing exists in tenant and is in a saveable state
        $listing = Listing::query()
            ->where('id', $listingId)
            ->where('tenant_id', TenantContext::getId())
            ->first();

        if (! $listing || ($listing->status ?? 'active') !== 'active') {
            return false;
        }

        if ($listing->moderation_status !== null && $listing->moderation_status !== 'approved') {
            return false;
        }

        DB::table('user_saved_listings')->insertOrIgnore([
            'user_id'    => $userId,
            'listing_id' => $listingId,
            'tenant_id'  => \App\Core\TenantContext::getId(),
        ]);

        return true;
    }

    /**
     * Unsave (un-favourite) a listing. Always succeeds (idempotent).
     */
    public static function unsaveListing(int $userId, int $listingId): void
    {
        DB::table('user_saved_listings')
            ->where('user_id', $userId)
            ->where('listing_id', $listingId)
            ->where('tenant_id', \App\Core\TenantContext::getId())
            ->delete();
    }

    // -----------------------------------------------------------------
    //  Write
    // -----------------------------------------------------------------

    /**
     * Create a new listing.
     *
     * @param int   $userId Owner of the listing.
     * @param array $data   Listing attributes (title, description, type, etc.)
     * @return Listing
     *
     * @throws ValidationException
     */
    /**
     * @param int|null $actingUserId When a linked-account carer/guardian is posting
     *        on the owner's behalf, the carer's id. NULL (the default, and every
     *        ordinary create) means the owner posted it themselves. The listing
     *        belongs to $userId either way; this only records who acted.
     */
    public static function create(int $userId, array $data, ?int $actingUserId = null): Listing
    {
        self::validateData($data);
        self::enforceMaxListingsPerUser($userId);

        $moderationEnabled = (new ListingModerationService())->isModerationEnabled();
        $initialStatus = $moderationEnabled ? 'pending' : 'active';
        $initialModerationStatus = $moderationEnabled ? 'pending_review' : 'approved';

        // Fall back to user's location when not provided
        if (
            empty($data['location'])
            || !array_key_exists('latitude', $data)
            || $data['latitude'] === null
            || $data['latitude'] === ''
            || !array_key_exists('longitude', $data)
            || $data['longitude'] === null
            || $data['longitude'] === ''
        ) {
            $user = User::find($userId);
            if ($user) {
                $data['location']  = $data['location']  ?? $user->location;
                $data['latitude']  = $data['latitude']  ?? $user->latitude;
                $data['longitude'] = $data['longitude'] ?? $user->longitude;
            }
        }

        $listing = DB::transaction(function () use ($userId, $data, $initialStatus, $initialModerationStatus, $actingUserId) {
            $listing = new Listing([
                'user_id'               => $userId,
                'acting_user_id'        => $actingUserId,
                'title'                 => trim($data['title']),
                'description'           => trim($data['description']),
                'type'                  => $data['type'] ?? 'offer',
                'category_id'           => $data['category_id'] ?? null,
                'image_url'             => $data['image_url'] ?? null,
                'location'              => $data['location'] ?? null,
                'latitude'              => $data['latitude'] ?? null,
                'longitude'             => $data['longitude'] ?? null,
                'hours_estimate'        => isset($data['hours_estimate']) ? (float) $data['hours_estimate'] : null,
                // NULL = no cap on the total hours offered. An empty string from
                // a cleared form field must also mean "no cap", not 0.
                'hours_available'       => (isset($data['hours_available']) && $data['hours_available'] !== '')
                    ? (float) $data['hours_available']
                    : null,
                'service_type'          => $data['service_type'] ?? 'physical_only',
                'federated_visibility'  => $data['federated_visibility'] ?? 'none',
                'availability'          => $data['availability'] ?? null,
                'status'                => $initialStatus,
                'moderation_status'     => $initialModerationStatus,
            ]);

            // tenant_id is set automatically by HasTenantScope
            $listing->save();

            // SDG goals
            if (! empty($data['sdg_goals'])) {
                $listing->sdg_goals = is_array($data['sdg_goals'])
                    ? $data['sdg_goals']
                    : json_decode($data['sdg_goals'], true);
                $listing->save();
            }

            return $listing->fresh(['user', 'category', 'skillTags']);
        });

        // Dispatch event after DB transaction commits — triggers feed activity,
        // WebSocket broadcast, and Meilisearch indexing.
        $user = User::find($userId);
        if ($user) {
            event(new ListingCreated($listing, $user, TenantContext::getId()));
        }

        // Send creation confirmation email to the listing creator
        try {
            $creator = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->select(['email', 'first_name', 'name', 'preferred_language', 'tenant_id'])
                ->first();

            if ($creator && !empty($creator->email)) {
                $tenantId = TenantContext::getId();
                LocaleContext::withLocale($creator, function () use ($creator, $listing, $tenantId) {
                    $firstName   = $creator->first_name ?? $creator->name ?? __('emails.common.fallback_name');
                    $tenantName  = TenantContext::getSetting('site_name', 'Project NEXUS');
                    $listingUrl  = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/listings/' . $listing->id;
                    $listingTitle = $listing->title ?? '';

                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails_created.listing.title'))
                        ->previewText(__('emails_created.listing.preview', ['title' => $listingTitle, 'community' => $tenantName]))
                        ->greeting($firstName)
                        ->paragraph(__('emails_created.listing.body', ['community' => $tenantName]))
                        ->highlight($listingTitle)
                        ->button(__('emails_created.listing.cta'), $listingUrl)
                        ->render();

                    if (!\App\Services\EmailDispatchService::sendRaw(
                        $creator->email,
                        __('emails_created.listing.subject', ['title' => $listingTitle, 'community' => $tenantName]),
                        $html,
                        null,
                        null,
                        null,
                        'listing',
                        ['tenant_id' => $tenantId]
                    )) {
                        Log::warning('[ListingService] creation email send returned false', ['listing_id' => $listing->id]);
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[ListingService] creation email failed: ' . $e->getMessage());
        }

        return $listing;
    }

    /**
     * Update an existing listing.
     *
     * @param int   $id   Listing ID.
     * @param array $data Fields to update.
     * @return Listing
     *
     * @throws \Illuminate\Database\Eloquent\ModelNotFoundException
     * @throws ValidationException
     */
    public static function update(int $id, array $data, bool $isAdmin = false): Listing
    {
        self::validateData($data, isUpdate: true);

        /** @var Listing $listing */
        $listing = Listing::query()->findOrFail($id);

        // Validate status transitions — prevent un-deleting or setting invalid statuses
        if (isset($data['status'])) {
            $validStatuses = ['active', 'draft', 'paused', 'pending', 'suspended', 'expired'];
            $currentStatus = $listing->status ?? 'active';
            $currentModerationStatus = $listing->moderation_status;

            if (!in_array($data['status'], $validStatuses, true)) {
                throw ValidationException::withMessages(['status' => [__('api.listing_invalid_status')]]);
            }
            // Moderated/removed listings cannot be reactivated by non-admin callers
            // (admin reactivation should go through a dedicated admin endpoint)
            if (
                !$isAdmin
                && $data['status'] === 'active'
                && (
                    in_array($currentStatus, ['deleted', 'suspended', 'rejected'], true)
                    || in_array($currentModerationStatus, ['pending_review', 'rejected'], true)
                )
            ) {
                $blockedStatus = $currentModerationStatus ?: $currentStatus;
                throw ValidationException::withMessages(['status' => [
                    __('api.listing_cannot_reactivate_status', ['status' => $blockedStatus]),
                ]]);
            }
            // Non-admin callers may only set user-facing statuses
            $userAllowedStatuses = ['active', 'draft', 'paused'];
            if (!$isAdmin && !in_array($data['status'], $userAllowedStatuses, true)) {
                throw ValidationException::withMessages(['status' => [__('api.listing_status_forbidden')]]);
            }
        }

        $allowed = [
            'title', 'description', 'type', 'category_id', 'image_url',
            'location', 'latitude', 'longitude', 'hours_estimate', 'hours_available',
            'service_type', 'federated_visibility', 'status', 'sdg_goals', 'availability',
        ];

        $updates = collect($data)->only($allowed)->all();

        // Clearing the cap field must remove the cap. Without this an empty
        // string would be cast to 0.00 by the decimal cast, silently turning
        // "no limit" into "no hours left".
        if (array_key_exists('hours_available', $updates) && $updates['hours_available'] === '') {
            $updates['hours_available'] = null;
        }

        $listing->fill($updates);
        $listing->save();

        // Notify users who have saved/favourited this listing (exclude the listing owner)
        try {
            $tenantId     = TenantContext::getId();
            $listingOwner = (int) ($listing->user_id ?? 0);
            $listingTitle = $listing->title ?? '';

            $savedUsers = DB::table('user_saved_listings as usl')
                ->join('users as u', 'usl.user_id', '=', 'u.id')
                ->where('usl.listing_id', $id)
                ->where('usl.tenant_id', $tenantId)
                ->where('u.tenant_id', $tenantId)
                ->whereNotNull('u.email')
                ->when($listingOwner > 0, fn ($q) => $q->where('usl.user_id', '!=', $listingOwner))
                ->select(['u.email', 'u.first_name', 'u.name', 'u.preferred_language', 'u.tenant_id'])
                ->limit(50)
                ->get();

            if ($savedUsers->isNotEmpty()) {
                $tenantName  = TenantContext::getSetting('site_name', 'Project NEXUS');
                $listingUrl  = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/listings/' . $id;

                foreach ($savedUsers as $savedUser) {
                    try {
                        LocaleContext::withLocale($savedUser, function () use ($savedUser, $listingTitle, $tenantName, $listingUrl, $tenantId, $id) {
                            $firstName = $savedUser->first_name ?? $savedUser->name ?? __('emails.common.fallback_name');

                            $html = EmailTemplateBuilder::make()
                                ->theme('brand')
                                ->title(__('emails_created.listing_updated.title'))
                                ->previewText(__('emails_created.listing_updated.preview', ['title' => $listingTitle, 'community' => $tenantName]))
                                ->greeting($firstName)
                                ->paragraph(__('emails_created.listing_updated.body', ['title' => $listingTitle, 'community' => $tenantName]))
                                ->button(__('emails_created.listing_updated.cta'), $listingUrl)
                                ->render();

                            if (!\App\Services\EmailDispatchService::sendRaw(
                                $savedUser->email,
                                __('emails_created.listing_updated.subject', ['community' => $tenantName]),
                                $html,
                                null,
                                null,
                                null,
                                'listing_update',
                                ['tenant_id' => $tenantId]
                            )) {
                                Log::warning('[ListingService] listing updated email send returned false', ['listing_id' => $id]);
                            }
                        });
                    } catch (\Throwable $e) {
                        Log::warning('[ListingService] listing updated email failed for user: ' . $e->getMessage());
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[ListingService] listing updated notifications failed: ' . $e->getMessage());
        }

        $freshListing = $listing->fresh(['user', 'category', 'skillTags']);

        // Dispatch ListingUpdated so federation partners receive the edit
        try {
            $owner = $freshListing->user ?? User::find($freshListing->user_id);
            if ($owner) {
                event(new ListingUpdated($freshListing, $owner, TenantContext::getId()));
            }
        } catch (\Throwable $e) {
            Log::warning('[ListingService] ListingUpdated event dispatch failed: ' . $e->getMessage());
        }

        return $freshListing;
    }

    /**
     * Soft-delete a listing by setting status = 'deleted'.
     */
    public static function delete(int $id): bool
    {
        /** @var Listing|null $listing */
        $listing = Listing::query()->find($id);

        if (! $listing) {
            return false;
        }

        $listing->status = 'deleted';
        $listing->save();

        // Clean up related records to avoid orphans.
        $tenantId = TenantContext::getId();
        DB::table('listing_skill_tags')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();
        DB::table('user_saved_listings')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();
        DB::table('listing_views')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();
        DB::table('listing_contacts')->where('tenant_id', $tenantId)->where('listing_id', $id)->delete();

        // Remove from search index
        try {
            SearchService::removeListing($id);
        } catch (\Throwable $e) {
            Log::warning("Failed to remove listing {$id} from search index: " . $e->getMessage());
        }

        return true;
    }

    private static function resolveCategorySlug(string $slug): ?int
    {
        $categoryId = DB::table('categories')
            ->where('slug', $slug)
            ->where('type', 'listing')
            ->where('tenant_id', TenantContext::getId())
            ->value('id');

        return $categoryId ? (int) $categoryId : null;
    }

    // -----------------------------------------------------------------
    //  Search (simple — wraps getAll for now)
    // -----------------------------------------------------------------

    /**
     * Search listings by term with optional type filter.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function search(string $term, ?string $type = null, int $limit = 20): array
    {
        $filters = ['search' => $term, 'limit' => $limit];

        if ($type !== null) {
            $filters['type'] = $type;
        }

        return self::getAll($filters);
    }

    // -----------------------------------------------------------------
    //  Permissions
    // -----------------------------------------------------------------

    /**
     * Check if a user can modify a listing (owner or admin).
     */
    public static function canModify(array $listing, int $userId): bool
    {
        // Owner can always modify
        if ((int) ($listing['user_id'] ?? 0) === $userId) {
            return true;
        }

        // Check if user is admin
        $user = User::find($userId);

        if ($user) {
            $role = $user->role ?? '';
            if (in_array($role, ['admin', 'tenant_admin']) || $user->is_super_admin || $user->is_tenant_super_admin) {
                return true;
            }
        }

        return false;
    }

    /**
     * Validation errors from the last operation.
     *
     * @var array
     */
    private static array $errors = [];

    /**
     * Get validation errors from the last operation.
     */
    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Validate listing data and return boolean (for test compatibility).
     *
     * @return bool True if valid, false if errors (check getErrors()).
     */
    public static function validate(array $data): bool
    {
        self::$errors = [];

        $title = $data['title'] ?? null;
        $type = $data['type'] ?? null;

        // title is required and max 255
        if ($title === null || $title === '') {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.title_required'), 'field' => 'title'];
        } elseif (strlen($title) > 255) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.listing_title_max'), 'field' => 'title'];
        }

        // type must be offer or request
        if ($type !== null && !in_array($type, ['offer', 'request'], true)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.listing_type_invalid'), 'field' => 'type'];
        }

        return empty(self::$errors);
    }

    // -----------------------------------------------------------------
    //  Validation
    // -----------------------------------------------------------------

    private static function enforceMaxListingsPerUser(int $userId): void
    {
        $maxListings = (int) ListingConfigurationService::get(
            ListingConfigurationService::CONFIG_MAX_PER_USER,
            ListingConfigurationService::DEFAULTS[ListingConfigurationService::CONFIG_MAX_PER_USER]
        );

        if ($maxListings <= 0) {
            return;
        }

        $currentCount = Listing::query()
            ->where('user_id', $userId)
            ->where(function (Builder $q) {
                $q->whereNull('status')->orWhere('status', '!=', 'deleted');
            })
            ->count();

        if ($currentCount >= $maxListings) {
            throw ValidationException::withMessages([
                'user_id' => [__('api.listing_max_per_user_reached', ['max' => $maxListings])],
            ]);
        }
    }

    /**
     * Validate listing input data.
     *
     * @throws ValidationException
     */
    private static function validateData(array $data, bool $isUpdate = false): void
    {
        $rules = [];
        $config = ListingConfigurationService::getAll();
        $minTitle = max(1, min(255, (int) ($config[ListingConfigurationService::CONFIG_MIN_TITLE_LENGTH] ?? 5)));
        $minDescription = max(1, min(10000, (int) ($config[ListingConfigurationService::CONFIG_MIN_DESCRIPTION_LENGTH] ?? 20)));
        $allowedTypes = [];

        if (self::configBool($config, ListingConfigurationService::CONFIG_ALLOW_OFFERS)) {
            $allowedTypes[] = 'offer';
        }
        if (self::configBool($config, ListingConfigurationService::CONFIG_ALLOW_REQUESTS)) {
            $allowedTypes[] = 'request';
        }

        if (! $isUpdate) {
            $rules['title']       = ['required', 'string', "min:{$minTitle}", 'max:255'];
            $rules['description'] = ['required', 'string', "min:{$minDescription}", 'max:10000'];
            $rules['type']        = ['required', Rule::in($allowedTypes)];
        } else {
            $rules['title']       = ['sometimes', 'string', "min:{$minTitle}", 'max:255'];
            $rules['description'] = ['sometimes', 'string', "min:{$minDescription}", 'max:10000'];
            $rules['type']        = ['sometimes', Rule::in($allowedTypes)];
        }

        $tenantId = \App\Core\TenantContext::getId();
        $categoryRules = [$isUpdate ? 'sometimes' : (self::configBool($config, ListingConfigurationService::CONFIG_REQUIRE_CATEGORY) ? 'required' : 'sometimes')];
        if (! self::configBool($config, ListingConfigurationService::CONFIG_REQUIRE_CATEGORY)) {
            $categoryRules[] = 'nullable';
        }
        $categoryRules[] = 'integer';
        $categoryRules[] = Rule::exists('categories', 'id')->where(fn ($query) => $query
            ->where('tenant_id', $tenantId)
            ->where('type', 'listing'));

        $locationRules = [$isUpdate ? 'sometimes' : (self::configBool($config, ListingConfigurationService::CONFIG_REQUIRE_LOCATION) ? 'required' : 'sometimes')];
        if (! self::configBool($config, ListingConfigurationService::CONFIG_REQUIRE_LOCATION)) {
            $locationRules[] = 'nullable';
        }
        $locationRules[] = 'string';
        $locationRules[] = 'max:255';

        $hoursRules = [$isUpdate ? 'sometimes' : (self::configBool($config, ListingConfigurationService::CONFIG_REQUIRE_HOURS_ESTIMATE) ? 'required' : 'sometimes')];
        if (! self::configBool($config, ListingConfigurationService::CONFIG_REQUIRE_HOURS_ESTIMATE)) {
            $hoursRules[] = 'nullable';
        }
        $hoursRules[] = 'numeric';
        $hoursRules[] = 'min:0.5';
        $hoursRules[] = 'max:2000';

        $rules['category_id']          = $categoryRules;
        $rules['service_type']         = 'sometimes|in:physical_only,remote_only,hybrid,location_dependent';
        $rules['federated_visibility'] = 'sometimes|in:none,listed,bookable';
        $rules['hours_estimate']       = $hoursRules;

        // Total hours the member is willing to give. Always optional — absent or
        // null means no cap, which is what every listing did before this field
        // existed.
        $availableRules = ['sometimes', 'nullable', 'numeric', 'min:0.5', 'max:100000'];

        // Reject a cap that cannot fit even one exchange (e.g. a 3-hour task with
        // a 2-hour total), which would leave the listing unbookable the moment it
        // was published. Only comparable when BOTH numbers are in this payload:
        // Laravel's `gte:<field>` compares against null when the other field is
        // absent, which does not mean what it looks like it means.
        if (
            isset($data['hours_estimate'], $data['hours_available'])
            && is_numeric($data['hours_estimate'])
            && is_numeric($data['hours_available'])
        ) {
            $availableRules[] = 'gte:hours_estimate';
        }

        $rules['hours_available']      = implode('|', $availableRules);
        $rules['location']             = $locationRules;
        $rules['latitude']             = 'sometimes|nullable|numeric|min:-90|max:90';
        $rules['longitude']            = 'sometimes|nullable|numeric|min:-180|max:180';
        $rules['availability']         = 'sometimes|nullable|array';

        $validator = validator($data, $rules);

        if ($validator->fails()) {
            throw new ValidationException($validator);
        }

        // Validate sdg_goals separately (array of ints 1-17, max 17 entries)
        if (isset($data['sdg_goals'])) {
            if (!is_array($data['sdg_goals'])) {
                throw ValidationException::withMessages(['sdg_goals' => [__('api.sdg_goals_must_be_array')]]);
            }
            if (count($data['sdg_goals']) > 17) {
                throw ValidationException::withMessages(['sdg_goals' => [__('api.sdg_goals_max')]]);
            }
            foreach ($data['sdg_goals'] as $goal) {
                if (!is_int($goal) || $goal < 1 || $goal > 17) {
                    throw ValidationException::withMessages(['sdg_goals' => [__('api.sdg_goals_invalid')]]);
                }
            }
        }
    }
}
