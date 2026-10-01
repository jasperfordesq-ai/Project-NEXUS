<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * GroupCollectionService — Group bundles/collections for organized discovery.
 */
class GroupCollectionService
{
    public static function getAll(?int $viewerId = null): array
    {
        $tenantId = TenantContext::getId();
        $collections = DB::table('group_collections')
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get()
            ->toArray();

        $visible = [];
        foreach ($collections as $collection) {
            $col = (array) $collection;
            $col['groups'] = self::groupsForCollection((int) $col['id'], $viewerId, false);

            // A collection is only meaningful to the member-facing endpoint
            // when at least one parent group is itself visible. This avoids
            // leaking curated metadata for inaccessible lifecycle/tenant rows.
            if ($viewerId !== null && $col['groups'] === []) {
                continue;
            }

            $col['group_count'] = count($col['groups']);
            $visible[] = $col;
        }

        return $visible;
    }

    public static function get(int $id, ?int $viewerId = null): ?array
    {
        $tenantId = TenantContext::getId();
        $query = DB::table('group_collections')
            ->where('id', $id)
            ->where('tenant_id', $tenantId);

        if ($viewerId !== null) {
            $query->where('is_active', true);
        }

        $col = $query->first();
        if (!$col) return null;
        $col = (array) $col;
        $col['groups'] = self::groupsForCollection($id, $viewerId, true);

        if ($viewerId !== null && $col['groups'] === []) {
            return null;
        }

        $col['group_count'] = count($col['groups']);
        return $col;
    }

    private static function groupsForCollection(int $collectionId, ?int $viewerId, bool $withDescription): array
    {
        $tenantId = (int) TenantContext::getId();
        $columns = ['g.id', 'g.name', 'g.image_url', 'g.cached_member_count', 'g.visibility'];
        if ($withDescription) {
            $columns[] = 'g.description';
        }

        $query = DB::table('group_collection_items as gci')
            ->join('groups as g', 'gci.group_id', '=', 'g.id')
            ->where('gci.collection_id', $collectionId)
            ->where('g.tenant_id', $tenantId)
            ->select($columns)
            ->orderBy('gci.sort_order');

        // Admin callers historically omit a viewer ID. Preserve their active
        // management list, but use the canonical lifecycle column.
        if ($viewerId === null) {
            $query->where('g.status', 'active');
        }

        $groups = $query->get();
        if ($viewerId !== null) {
            $groups = $groups->filter(
                static fn (object $group): bool => GroupAccessService::canViewOverview((int) $group->id, $viewerId),
            );
        }

        return $groups->map(static fn (object $group): array => (array) $group)->values()->all();
    }

    public static function create(array $data, int $userId): int
    {
        $tenantId = TenantContext::getId();
        return DB::table('group_collections')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'image_url' => $data['image_url'] ?? null,
            'sort_order' => $data['sort_order'] ?? 0,
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public static function update(int $id, array $data): bool
    {
        $tenantId = TenantContext::getId();
        $update = ['updated_at' => now()];
        foreach (['name', 'description', 'image_url', 'sort_order', 'is_active'] as $f) {
            if (array_key_exists($f, $data)) $update[$f] = $data[$f];
        }
        return DB::table('group_collections')
            ->where('id', $id)->where('tenant_id', $tenantId)
            ->update($update) > 0;
    }

    public static function delete(int $id): bool
    {
        $tenantId = TenantContext::getId();

        // Verify the collection belongs to THIS tenant before touching its items.
        // group_collection_items has no tenant_id column, so deleting by
        // collection_id alone would remove another tenant's items if a foreign
        // (e.g. enumerated) id is passed — the tenant-scoped parent delete below
        // would then no-op, leaving the cross-tenant child rows already gone.
        $owned = DB::table('group_collections')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();
        if (!$owned) {
            return false;
        }

        DB::table('group_collection_items')->where('collection_id', $id)->delete();
        return DB::table('group_collections')
            ->where('id', $id)->where('tenant_id', $tenantId)->delete() > 0;
    }

    /**
     * @return bool false when the collection is not this tenant's, so the
     *              caller can refuse rather than report a recomposition that
     *              did not happen (F-482)
     */
    public static function setGroups(int $collectionId, array $groupIds): bool
    {
        $tenantId = TenantContext::getId();

        // Validate collection belongs to current tenant
        $collection = DB::table('group_collections')
            ->where('id', $collectionId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$collection) {
            return false;
        }

        // Validate group IDs belong to current tenant
        $validGroupIds = DB::table('groups')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $groupIds)
            ->pluck('id')
            ->toArray();

        DB::table('group_collection_items')->where('collection_id', $collectionId)->delete();
        foreach ($validGroupIds as $i => $gid) {
            DB::table('group_collection_items')->insert([
                'collection_id' => $collectionId,
                'group_id' => $gid,
                'sort_order' => $i,
            ]);
        }

        return true;
    }
}
