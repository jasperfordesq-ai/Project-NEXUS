<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Bookmark;
use App\Models\BookmarkCollection;
use App\Support\SavedItemVisibility;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/** @phpstan-type BookmarkWithTitle array{id:int,bookmarkable_type:string,bookmarkable_id:int,collection_id:int|null,created_at:mixed,title:string|null} */

class BookmarkService
{
    private const VALID_TYPES = ['post', 'listing', 'event', 'job', 'blog', 'discussion'];

    /**
     * Toggle a bookmark: add if not bookmarked, remove if already bookmarked.
     *
     * @return array{bookmarked: bool, count: int}
     */
    public function toggle(int $userId, string $type, int $id, ?int $collectionId = null): array
    {
        $this->validateType($type);
        $tenantId = TenantContext::getId();

        $existing = Bookmark::where('user_id', $userId)
            ->where('bookmarkable_type', $type)
            ->where('bookmarkable_id', $id)
            ->first();

        if ($existing) {
            $existing->delete();
            $count = $this->getBookmarkCount($type, $id);
            return ['bookmarked' => false, 'count' => $count];
        }

        // F-066: existence in the tenant is not enough — the saver must be able
        // to see the item, or its title/content leaks through the bookmark list.
        // Same message as a missing row, so the refusal is not an existence oracle.
        if (!$this->itemExistsInTenant($type, $id) || !SavedItemVisibility::canView($type, $id, $userId)) {
            throw new \InvalidArgumentException(__('api.saved_item_not_found'));
        }

        // Validate collection belongs to user if provided
        if ($collectionId !== null) {
            $collection = BookmarkCollection::where('id', $collectionId)
                ->where('user_id', $userId)
                ->first();
            if (!$collection) {
                $collectionId = null;
            }
        }

        Bookmark::create([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'bookmarkable_type' => $type,
            'bookmarkable_id' => $id,
            'collection_id' => $collectionId,
            'created_at' => now(),
        ]);

        $count = $this->getBookmarkCount($type, $id);
        return ['bookmarked' => true, 'count' => $count];
    }

    /** Table and title column for each bookmarkable type. */
    private const TYPE_TABLE_MAP = [
        // 'post' is a FEED post (feed_posts, title = post content) — both the
        // React FeedCard BookmarkButton and the accessible frontend's
        // storeFeedPostSave() bookmark ('post', feed_posts.id). Blog articles
        // bookmark as 'blog' -> pages. Mapping 'post' to the legacy blog
        // `posts` table made the existence check reject every real feed save.
        'post'       => ['table' => 'feed_posts',       'col' => 'content'],
        'listing'    => ['table' => 'listings',         'col' => 'title'],
        'event'      => ['table' => 'events',           'col' => 'title'],
        'job'        => ['table' => 'job_vacancies',    'col' => 'title'],
        'blog'       => ['table' => 'pages',            'col' => 'title'],
        'discussion' => ['table' => 'group_discussions','col' => 'title'],
    ];

    /**
     * Get paginated bookmarks for a user, optionally filtered by type and/or collection.
     * Each bookmark has a `title` field resolved from the bookmarked item.
     */
    public function getUserBookmarks(int $userId, ?string $type = null, ?int $collectionId = null, int $page = 1, int $perPage = 20): LengthAwarePaginator
    {
        $query = Bookmark::where('user_id', $userId)
            ->orderBy('created_at', 'desc');

        if ($type !== null) {
            $this->validateType($type);
            $query->where('bookmarkable_type', $type);
        }

        if ($collectionId !== null) {
            $query->where('collection_id', $collectionId);
        }

        $paginator = $query->paginate($perPage, ['*'], 'page', $page);

        $this->attachTitles($paginator->items(), $userId);

        return $paginator;
    }

    /**
     * Batch-fetch titles for a list of Bookmark models and attach them as `title`.
     * Groups by type and runs one title query per type; the visibility check
     * below then runs per row (bounded by per_page, max 100).
     *
     * A title is only attached when the viewer may still see the item (F-066):
     * rows saved before that check existed, or items whose visibility changed
     * since, must not replay their content.
     *
     * @param Bookmark[] $bookmarks
     */
    private function attachTitles(array $bookmarks, int $viewerId): void
    {
        // Group IDs by type
        $grouped = [];
        foreach ($bookmarks as $bookmark) {
            $grouped[$bookmark->bookmarkable_type][] = $bookmark->bookmarkable_id;
        }

        // Fetch titles per type
        $titles = [];
        foreach ($grouped as $type => $ids) {
            $map = self::TYPE_TABLE_MAP[$type] ?? null;
            if ($map === null) {
                continue;
            }
            $rows = DB::table($map['table'])
                ->whereIn('id', array_unique($ids))
                ->where('tenant_id', TenantContext::getId())
                ->pluck($map['col'], 'id');

            foreach ($rows as $id => $title) {
                if (SavedItemVisibility::canView($type, (int) $id, $viewerId)) {
                    $titles[$type][$id] = $title;
                }
            }
        }

        // Attach to bookmark models
        foreach ($bookmarks as $bookmark) {
            $bookmark->title = $titles[$bookmark->bookmarkable_type][$bookmark->bookmarkable_id] ?? null;
        }
    }

    /**
     * Get all collections for a user, with bookmark counts.
     */
    public function getCollections(int $userId): Collection
    {
        return BookmarkCollection::where('user_id', $userId)
            ->withCount('bookmarks')
            ->orderBy('is_default', 'desc')
            ->orderBy('name', 'asc')
            ->get();
    }

    /**
     * Create a new bookmark collection.
     */
    public function createCollection(int $userId, string $name, ?string $description = null): BookmarkCollection
    {
        return BookmarkCollection::create([
            'tenant_id' => TenantContext::getId(),
            'user_id' => $userId,
            'name' => $name,
            'description' => $description,
            'is_default' => false,
        ]);
    }

    /**
     * Update a bookmark collection.
     */
    public function updateCollection(int $collectionId, int $userId, array $data): BookmarkCollection
    {
        $collection = BookmarkCollection::where('id', $collectionId)
            ->where('user_id', $userId)
            ->firstOrFail();

        $collection->update(array_filter([
            'name' => $data['name'] ?? null,
            'description' => $data['description'] ?? null,
        ], fn($v) => $v !== null));

        return $collection->fresh();
    }

    /**
     * Delete a bookmark collection. Bookmarks in it get their collection_id set to null.
     */
    public function deleteCollection(int $collectionId, int $userId): void
    {
        $collection = BookmarkCollection::where('id', $collectionId)
            ->where('user_id', $userId)
            ->firstOrFail();

        // Unlink bookmarks from this collection (FK has ON DELETE SET NULL, but be explicit)
        Bookmark::where('collection_id', $collectionId)
            ->where('user_id', $userId)
            ->update(['collection_id' => null]);

        $collection->delete();
    }

    /**
     * Move a bookmark to a different collection (or remove from collection with null).
     */
    public function moveToCollection(int $bookmarkId, int $userId, ?int $collectionId): void
    {
        $bookmark = Bookmark::where('id', $bookmarkId)
            ->where('user_id', $userId)
            ->firstOrFail();

        // Validate collection ownership if provided
        if ($collectionId !== null) {
            BookmarkCollection::where('id', $collectionId)
                ->where('user_id', $userId)
                ->firstOrFail();
        }

        $bookmark->update(['collection_id' => $collectionId]);
    }

    /**
     * Check if a user has bookmarked a specific item.
     */
    public function isBookmarked(int $userId, string $type, int $id): bool
    {
        return Bookmark::where('user_id', $userId)
            ->where('bookmarkable_type', $type)
            ->where('bookmarkable_id', $id)
            ->exists();
    }

    /**
     * Get the total bookmark count for an item across all users.
     */
    public function getBookmarkCount(string $type, int $id): int
    {
        return Bookmark::where('bookmarkable_type', $type)
            ->where('bookmarkable_id', $id)
            ->count();
    }

    private function validateType(string $type): void
    {
        if (!in_array($type, self::VALID_TYPES, true)) {
            throw new \InvalidArgumentException(__('api.invalid_bookmarkable_type'));
        }
    }

    /**
     * An item may only be bookmarked if its row exists in the caller's tenant —
     * bookmarking a foreign tenant's id would leak its title via attachTitles().
     */
    private function itemExistsInTenant(string $type, int $id): bool
    {
        $map = self::TYPE_TABLE_MAP[$type] ?? null;
        if ($map === null) {
            return false;
        }
        return DB::table($map['table'])
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->exists();
    }
}
