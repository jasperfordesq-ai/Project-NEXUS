<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\MarketplaceCollection;
use App\Models\MarketplaceCollectionItem;
use App\Models\MarketplaceListing;
use App\Models\MarketplaceSavedSearch;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * MarketplaceDiscoveryService — Saved searches and collections/wishlists.
 *
 * All methods are tenant-scoped via model global scopes (HasTenantScope).
 */
class MarketplaceDiscoveryService
{
    // ─────────────────────────────────────────────────────────────────
    //  Saved Searches
    // ─────────────────────────────────────────────────────────────────

    /**
     * Create a saved search for a user.
     */
    public static function createSavedSearch(int $userId, array $data): MarketplaceSavedSearch
    {
        $attributes = [
            'user_id' => $userId,
            'name' => $data['name'],
            'search_query' => $data['search_query'] ?? null,
            'filters' => $data['filters'] ?? null,
            'alert_frequency' => $data['alert_frequency'] ?? 'daily',
            'alert_channel' => $data['alert_channel'] ?? 'email',
            'is_active' => $data['is_active'] ?? true,
        ];

        return DB::transaction(function () use ($userId, $attributes): MarketplaceSavedSearch {
            // Serialize discovery creation per user so a client retry cannot
            // create two identical records even when requests overlap.
            DB::table('users')->where('id', $userId)->lockForUpdate()->value('id');

            $filters = self::normalizeComparablePayload($attributes['filters']);
            $existing = MarketplaceSavedSearch::where('user_id', $userId)
                ->where('name', $attributes['name'])
                ->where('search_query', $attributes['search_query'])
                ->where('alert_frequency', $attributes['alert_frequency'])
                ->where('alert_channel', $attributes['alert_channel'])
                ->where('is_active', $attributes['is_active'])
                ->get()
                ->first(static fn (MarketplaceSavedSearch $search): bool =>
                    self::normalizeComparablePayload($search->filters) === $filters
                );

            return $existing ?? MarketplaceSavedSearch::create($attributes);
        });
    }

    /**
     * Get all saved searches for a user.
     *
     * @return MarketplaceSavedSearch[]
     */
    public static function getSavedSearches(int $userId): array
    {
        return MarketplaceSavedSearch::where('user_id', $userId)
            ->orderBy('created_at', 'desc')
            ->get()
            ->all();
    }

    /**
     * Delete a saved search (only if owned by the user).
     */
    public static function deleteSavedSearch(int $id, int $userId): void
    {
        $search = MarketplaceSavedSearch::where('id', $id)
            ->where('user_id', $userId)
            ->first();

        if ($search) {
            $search->delete();
        }
    }

    /**
     * Toggle saved search active status.
     */
    public static function toggleSavedSearch(int $id, int $userId, bool $isActive): ?MarketplaceSavedSearch
    {
        $search = MarketplaceSavedSearch::where('id', $id)
            ->where('user_id', $userId)
            ->first();

        if (!$search) {
            return null;
        }

        $search->is_active = $isActive;
        $search->save();

        return $search;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Collections
    // ─────────────────────────────────────────────────────────────────

    /**
     * Create a collection for a user.
     */
    public static function createCollection(int $userId, array $data): MarketplaceCollection
    {
        $attributes = [
            'user_id' => $userId,
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'is_public' => $data['is_public'] ?? false,
        ];

        return DB::transaction(function () use ($userId, $attributes): MarketplaceCollection {
            DB::table('users')->where('id', $userId)->lockForUpdate()->value('id');

            return MarketplaceCollection::firstOrCreate($attributes);
        });
    }

    /**
     * Get all collections for a user.
     *
     * @return MarketplaceCollection[]
     */
    public static function getCollections(int $userId): array
    {
        return MarketplaceCollection::where('user_id', $userId)
            ->orderBy('created_at', 'desc')
            ->get()
            ->all();
    }

    /**
     * Update a collection's metadata.
     */
    public static function updateCollection(MarketplaceCollection $collection, array $data): MarketplaceCollection
    {
        $fillable = ['name', 'description', 'is_public'];

        foreach ($fillable as $field) {
            if (array_key_exists($field, $data)) {
                $collection->{$field} = $data[$field];
            }
        }

        $collection->save();

        return $collection;
    }

    /**
     * Delete a collection (only if owned by the user).
     */
    public static function deleteCollection(int $id, int $userId): void
    {
        $collection = MarketplaceCollection::where('id', $id)
            ->where('user_id', $userId)
            ->first();

        if ($collection) {
            // Items are cascade-deleted by FK
            $collection->delete();
        }
    }

    /**
     * Add a listing to a collection.
     */
    public static function addToCollection(int $collectionId, int $listingId, ?string $note = null): void
    {
        DB::transaction(static function () use ($collectionId, $listingId, $note): void {
            // Both models are tenant-scoped. Resolving both before insertion is
            // a defence-in-depth check against cross-tenant foreign keys.
            $collection = MarketplaceCollection::query()->lockForUpdate()->find($collectionId);
            $listing = MarketplaceListing::query()->find($listingId);
            if (!$collection || !$listing || (int) $collection->tenant_id !== (int) $listing->tenant_id) {
                throw new \DomainException('COLLECTION_LISTING_TENANT_MISMATCH');
            }

            $isOwnedListing = (int) $listing->user_id === (int) $collection->user_id;
            $isPubliclyVisible = (string) $listing->status === 'active'
                && (string) $listing->moderation_status === 'approved'
                && ($listing->expires_at === null || $listing->expires_at->isFuture());
            if (! $isOwnedListing && ! $isPubliclyVisible) {
                // A collection must not become an existence/item-count oracle
                // for another seller's unpublished listing.
                throw new \DomainException('COLLECTION_LISTING_NOT_VISIBLE');
            }

            $item = MarketplaceCollectionItem::firstOrCreate(
                [
                    'collection_id' => $collectionId,
                    'marketplace_listing_id' => $listingId,
                ],
                ['note' => $note]
            );

            if ($item->wasRecentlyCreated) {
                $collection->increment('item_count');
            }
        });
    }

    /**
     * Remove a listing from a collection.
     */
    public static function removeFromCollection(int $collectionId, int $listingId): void
    {
        $deleted = MarketplaceCollectionItem::where('collection_id', $collectionId)
            ->where('marketplace_listing_id', $listingId)
            ->delete();

        if ($deleted) {
            MarketplaceCollection::where('id', $collectionId)->decrement('item_count');
        }
    }

    /**
     * Get items in a collection with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getCollectionItems(
        int $collectionId,
        int $limit = 20,
        ?string $cursor = null,
        bool $publicOnly = false,
        ?int $viewerUserId = null
    ): array
    {
        $limit = max(1, min($limit, 100));
        $publicVisibility = static function ($query): void {
            // Eager-load constraints receive a BelongsTo relation, while
            // whereHas receives an Eloquent builder.
            $builder = $query instanceof Builder ? $query : $query->getQuery();
            MarketplaceListingService::applyPublicVisibility($builder);
        };
        $listingConstraint = static function ($query) use ($publicOnly, $viewerUserId, $publicVisibility): void {
            if ($publicOnly) {
                $publicVisibility($query);
                return;
            }

            // A private collection grants access to the collection metadata,
            // not to another seller's draft/pending/expired listing.
            $query->where(static function ($visibilityQuery) use ($viewerUserId, $publicVisibility): void {
                $visibilityQuery->where($publicVisibility);
                if ($viewerUserId !== null) {
                    $visibilityQuery->orWhere('user_id', $viewerUserId);
                }
            });
        };

        $query = MarketplaceCollectionItem::where('collection_id', $collectionId);

        $query->whereHas('listing', $listingConstraint);

        $query->with([
                'listing' => static function ($q) use ($listingConstraint): void {
                    $listingConstraint($q);
                    $q->with([
                    'user:id,first_name,last_name,profile_type,organization_name,avatar_url',
                    'category:id,name,slug,icon',
                    'images' => fn ($iq) => $iq->where('is_primary', true)->limit(1),
                    ]);
                },
            ])
            ->orderBy('id', 'desc');

        if ($cursor) {
            $decodedCursor = (int) base64_decode($cursor, true);
            if ($decodedCursor > 0) {
                $query->where('id', '<', $decodedCursor);
            }
        }

        $results = $query->limit($limit + 1)->get();
        $hasMore = $results->count() > $limit;
        if ($hasMore) {
            $results->pop();
        }

        $items = $results->map(function (MarketplaceCollectionItem $item) {
            $listing = $item->listing;
            if (!$listing) {
                return null;
            }

            $primaryImage = $listing->relationLoaded('images') ? $listing->images->first() : null;

            return [
                'collection_item_id' => $item->id,
                'note' => $item->note,
                'added_at' => $item->created_at?->toISOString(),
                'listing' => [
                    'id' => $listing->id,
                    'title' => $listing->title,
                    'price' => $listing->price !== null ? (float) $listing->price : null,
                    'price_currency' => $listing->price_currency,
                    'price_type' => $listing->price_type,
                    'condition' => $listing->condition,
                    'location' => $listing->location,
                    'status' => $listing->status,
                    'image' => $primaryImage ? [
                        'url' => $primaryImage->image_url,
                        'thumbnail_url' => $primaryImage->thumbnail_url,
                        'alt_text' => $primaryImage->alt_text,
                    ] : null,
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
                    ] : null,
                    'created_at' => $listing->created_at?->toISOString(),
                ],
            ];
        })->filter()->values()->all();

        $nextCursor = $hasMore && $results->isNotEmpty()
            ? base64_encode((string) $results->last()->id)
            : null;

        return [
            'items' => $items,
            'cursor' => $nextCursor,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Canonicalize nested filter objects before comparing retry payloads.
     */
    private static function normalizeComparablePayload(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map(
            static fn (mixed $item): mixed => self::normalizeComparablePayload($item),
            $value
        );
    }
}
