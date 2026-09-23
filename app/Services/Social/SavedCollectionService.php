<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Social;

use App\Core\TenantContext;
use App\Models\Social\SavedCollection;
use App\Models\Social\SavedItem;
use App\Support\SavedItemVisibility;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * SavedCollectionService — SOC10 bookmark/save-to-collection system.
 */
class SavedCollectionService
{
    public const ALLOWED_ITEM_TYPES = [
        'post', 'listing', 'event', 'group',
        'article', 'marketplace_listing', 'job', 'resource',
    ];

    /** Source table and preview columns for each item type. All tables are tenant-scoped. */
    private const TYPE_TABLE_MAP = [
        // 'post' is a FEED post (feed_posts) — the /saved UI deep-links it to
        // /feed?post={id}. It is NOT the legacy blog `posts` table (blog
        // articles save as 'article' -> pages). Mapping 'post' to `posts`
        // made the existence check reject every real feed save.
        'post' => ['table' => 'feed_posts', 'cols' => ['id', 'content as title']],
        'listing' => ['table' => 'listings', 'cols' => ['id', 'title']],
        'event' => ['table' => 'events', 'cols' => ['id', 'title']],
        'group' => ['table' => 'groups', 'cols' => ['id', 'name as title']],
        'article' => ['table' => 'pages', 'cols' => ['id', 'title']],
        'marketplace_listing' => ['table' => 'marketplace_listings', 'cols' => ['id', 'title']],
        'job' => ['table' => 'job_vacancies', 'cols' => ['id', 'title']],
        'resource' => ['table' => 'resources', 'cols' => ['id', 'title']],
    ];

    /**
     * Create a new collection for the user.
     */
    public function createCollection(
        int $userId,
        string $name,
        ?string $description = null,
        bool $isPublic = false,
        string $color = '#6366f1',
        string $icon = 'bookmark'
    ): SavedCollection {
        return SavedCollection::create([
            'user_id' => $userId,
            'tenant_id' => TenantContext::getId(),
            'name' => $name,
            'description' => $description,
            'is_public' => $isPublic,
            'color' => $color,
            'icon' => $icon,
            'items_count' => 0,
        ]);
    }

    /**
     * Ensure user has a default collection; create if missing.
     */
    public function ensureDefaultCollection(int $userId): SavedCollection
    {
        $tenantId = TenantContext::getId();
        $existing = SavedCollection::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();
        if ($existing) {
            return $existing;
        }
        return $this->createCollection($userId, 'Default', null, false);
    }

    public function updateCollection(int $collectionId, int $userId, array $data): SavedCollection
    {
        $collection = SavedCollection::where('id', $collectionId)
            ->where('user_id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->firstOrFail();

        $allowed = array_intersect_key($data, array_flip([
            'name', 'description', 'is_public', 'color', 'icon',
        ]));
        if (!empty($allowed)) {
            $collection->update($allowed);
        }
        return $collection->fresh();
    }

    public function deleteCollection(int $collectionId, int $userId): void
    {
        $collection = SavedCollection::where('id', $collectionId)
            ->where('user_id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->firstOrFail();
        $collection->delete();
        $this->forgetSavedCache($userId);
    }

    /**
     * Save an item to a collection (idempotent).
     */
    public function saveItem(int $userId, ?int $collectionId, string $itemType, int $itemId, ?string $note = null): SavedItem
    {
        if (!in_array($itemType, self::ALLOWED_ITEM_TYPES, true)) {
            throw new \InvalidArgumentException(__('api.invalid_item_type'));
        }
        $tenantId = TenantContext::getId();

        // F-066: the saver must be able to see the item, not merely have it exist.
        if (!$this->itemExistsInTenant($itemType, $itemId) || !SavedItemVisibility::canView($itemType, $itemId, $userId)) {
            throw new \InvalidArgumentException(__('api.saved_item_not_found'));
        }

        $collection = $collectionId
            ? SavedCollection::where('id', $collectionId)
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->firstOrFail()
            : $this->ensureDefaultCollection($userId);

        return DB::transaction(function () use ($collection, $userId, $tenantId, $itemType, $itemId, $note) {
            $existing = SavedItem::where('collection_id', $collection->id)
                ->where('item_type', $itemType)
                ->where('item_id', $itemId)
                ->first();
            if ($existing) {
                if ($note !== null && $note !== $existing->note) {
                    $existing->note = $note;
                    $existing->save();
                }
                return $existing;
            }

            $item = SavedItem::create([
                'collection_id' => $collection->id,
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'item_type' => $itemType,
                'item_id' => $itemId,
                'note' => $note,
                'saved_at' => now(),
            ]);
            SavedCollection::where('id', $collection->id)->increment('items_count');
            $this->forgetSavedCache($userId);
            return $item;
        });
    }

    public function unsaveItem(int $savedItemId, int $userId): bool
    {
        $tenantId = TenantContext::getId();
        $item = SavedItem::where('id', $savedItemId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$item) {
            return false;
        }
        return DB::transaction(function () use ($item, $userId) {
            $collectionId = $item->collection_id;
            $item->delete();
            SavedCollection::where('id', $collectionId)
                ->where('items_count', '>', 0)
                ->decrement('items_count');
            $this->forgetSavedCache($userId);
            return true;
        });
    }

    public function unsaveByItem(int $userId, string $itemType, int $itemId): bool
    {
        $tenantId = TenantContext::getId();
        $items = SavedItem::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('item_type', $itemType)
            ->where('item_id', $itemId)
            ->get();
        if ($items->isEmpty()) {
            return false;
        }
        DB::transaction(function () use ($items, $userId) {
            foreach ($items as $item) {
                $collectionId = $item->collection_id;
                $item->delete();
                SavedCollection::where('id', $collectionId)
                    ->where('items_count', '>', 0)
                    ->decrement('items_count');
            }
            $this->forgetSavedCache($userId);
        });
        return true;
    }

    /**
     * Fast cached lookup: is this user saving this item anywhere?
     */
    public function isSaved(int $userId, string $itemType, int $itemId): bool
    {
        $cacheKey = $this->savedCacheKey($userId);
        $set = Cache::remember($cacheKey, 300, function () use ($userId) {
            return SavedItem::where('user_id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->get(['item_type', 'item_id'])
                ->map(fn ($r) => $r->item_type . ':' . $r->item_id)
                ->all();
        });
        return in_array($itemType . ':' . $itemId, $set, true);
    }

    /**
     * Bulk variant.
     *
     * @param array<int,array{item_type:string,item_id:int}> $pairs
     * @return array<string,bool>  keyed by "type:id"
     */
    public function isSavedBulk(int $userId, array $pairs): array
    {
        $out = [];
        foreach ($pairs as $p) {
            $type = $p['item_type'] ?? null;
            $id = (int) ($p['item_id'] ?? 0);
            if (!$type || !$id) continue;
            $out["{$type}:{$id}"] = $this->isSaved($userId, $type, $id);
        }
        return $out;
    }

    public function getSavedItems(int $collectionId, int $userId, int $page = 1, int $perPage = 20): array
    {
        $tenantId = TenantContext::getId();
        $collection = SavedCollection::where('id', $collectionId)
            ->where('tenant_id', $tenantId)
            ->firstOrFail();

        // Visibility: owner OR public
        if ($collection->user_id !== $userId && !$collection->is_public) {
            abort(403);
        }

        $paginator = SavedItem::where('collection_id', $collectionId)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('saved_at')
            ->paginate($perPage, ['*'], 'page', $page);

        $items = $paginator->items();
        // Previews are judged for the VIEWER: a public collection is read by
        // members who may not see what its owner can (F-066).
        $this->attachPreviews($items, $userId);

        return [
            'data' => $items,
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
            'collection' => $collection,
        ];
    }

    public function getUserCollections(int $userId, bool $publicOnly = false): array
    {
        $q = SavedCollection::where('user_id', $userId)
            ->where('tenant_id', TenantContext::getId());
        if ($publicOnly) {
            $q->where('is_public', true);
        }
        return $q->orderBy('name')->get()->all();
    }

    /**
     * Hydrate item previews using existing tables.
     *
     * @param SavedItem[] $items
     */
    private function attachPreviews(array $items, int $viewerId): void
    {
        $grouped = [];
        foreach ($items as $i) {
            $grouped[$i->item_type][] = $i->item_id;
        }

        $previews = [];
        foreach ($grouped as $type => $ids) {
            $map = self::TYPE_TABLE_MAP[$type] ?? null;
            if (!$map) continue;
            try {
                $rows = DB::table($map['table'])
                    ->whereIn('id', array_unique($ids))
                    ->where('tenant_id', TenantContext::getId())
                    ->select($map['cols'])
                    ->get();
                foreach ($rows as $r) {
                    if (SavedItemVisibility::canView($type, (int) $r->id, $viewerId)) {
                        $previews[$type][$r->id] = ['title' => $r->title ?? null];
                    }
                }
            } catch (\Throwable $e) {
                // Table may not exist in some installations; skip silently.
            }
        }
        foreach ($items as $i) {
            $i->preview = $previews[$i->item_type][$i->item_id] ?? null;
        }
    }

    /**
     * An item may only be saved if its row exists in the caller's tenant —
     * saving a foreign tenant's id would leak its content via previews.
     */
    private function itemExistsInTenant(string $itemType, int $itemId): bool
    {
        $map = self::TYPE_TABLE_MAP[$itemType] ?? null;
        if (!$map) {
            return false;
        }
        try {
            return DB::table($map['table'])
                ->where('id', $itemId)
                ->where('tenant_id', TenantContext::getId())
                ->exists();
        } catch (\Throwable $e) {
            // Table may not exist in some installations; fail closed.
            return false;
        }
    }

    private function savedCacheKey(int $userId): string
    {
        return 'saved_items:tenant:' . TenantContext::getId() . ':user:' . $userId;
    }

    public function forgetSavedCache(int $userId): void
    {
        Cache::forget($this->savedCacheKey($userId));
    }
}
