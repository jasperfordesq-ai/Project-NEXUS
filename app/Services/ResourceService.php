<?php
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\ResourceItem;
use Illuminate\Database\Eloquent\Builder;

/**
 * ResourceService — Laravel DI-based service for resource/file operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class ResourceService
{
    public function __construct(
        private readonly ResourceItem $resource,
    ) {}

    /**
     * Get resources with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->resource->newQuery()
            ->with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url', 'category:id,name,color']);

        if (! empty($filters['category_id'])) {
            $query->where('category_id', (int) $filters['category_id']);
        }

        if (! empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function (Builder $q) use ($term) {
                $q->where('title', 'LIKE', $term)
                  ->orWhere('description', 'LIKE', $term);
            });
        }

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Store a new resource entry.
     */
    public function store(int $userId, array $data): ResourceItem
    {
        $resource = $this->resource->newInstance([
            'user_id'     => $userId,
            'title'       => trim($data['title']),
            'description' => trim($data['description'] ?? ''),
            'file_path'   => $data['file_path'],
            'file_type'   => $data['file_type'] ?? null,
            'file_size'   => $data['file_size'] ?? null,
            'category_id' => $data['category_id'] ?? null,
            'downloads'   => 0,
        ]);

        $resource->save();

        return $resource->fresh(['user', 'category']);
    }

    /**
     * Increment download count and return file path.
     */
    public function download(int $id): ?string
    {
        $resource = $this->resource->newQuery()->find($id);
        if (! $resource) {
            return null;
        }

        $resource->increment('downloads');

        return $resource->file_path;
    }

    /**
     * Delete a resource (only by its uploader).
     */
    public function delete(int $id, int $userId): bool
    {
        return (bool) $this->resource->newQuery()
            ->where('id', $id)
            ->where('user_id', $userId)
            ->delete();
    }
}
