<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Models\MarketplaceCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * AdminMarketplaceCategoryController — the community's own Marketplace &
 * Freecycle categories (owner, 17 Oct 2026: "check that there's a place to
 * add categories" — until this controller there was none).
 *
 * Two kinds of category reach a member:
 *   - PLATFORM categories (`tenant_id` NULL) seeded for every community. An
 *     admin sees them here, read-only, so the list matches what members see.
 *   - COMMUNITY categories (`tenant_id` = this tenant). Fully editable here.
 *
 * Tenant scoping: every write names `tenant_id`, a parent must be a platform
 * category or one of this community's own, and a category still used by a
 * listing cannot be deleted — only hidden — because the FK would otherwise
 * silently blank `category_id` on live listings.
 */
class AdminMarketplaceCategoryController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const MAX_DEPTH = 2;

    private function ensureFeature(): void
    {
        if (! TenantContext::hasFeature('marketplace')) {
            abort(403, __('api_controllers_1.admin_marketplace.feature_not_enabled'));
        }
    }

    /**
     * GET /v2/admin/marketplace/categories
     *
     * Every platform and community category, active or hidden, with the
     * number of live listings in each so an admin can see what hiding would do.
     */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_categories', 60, 60);

        $tenantId = TenantContext::getId();

        $rows = DB::table('marketplace_categories')
            ->where(static function ($q) use ($tenantId): void {
                $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
            })
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get();

        $counts = DB::table('marketplace_listings')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNotNull('category_id')
            ->groupBy('category_id')
            ->selectRaw('category_id, COUNT(*) as count')
            ->pluck('count', 'category_id');

        $data = $rows->map(fn ($c) => $this->present($c, (int) ($counts[$c->id] ?? 0), $tenantId))->values()->all();

        return $this->respondWithData($data);
    }

    /**
     * POST /v2/admin/marketplace/categories
     */
    public function store(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_categories_write', 30, 60);

        $tenantId = TenantContext::getId();
        $data = request()->validate([
            'name'        => 'required|string|max:100',
            'description' => 'nullable|string|max:1000',
            'icon'        => 'nullable|string|max:50',
            'parent_id'   => 'nullable|integer',
            'sort_order'  => 'nullable|integer|min:0|max:9999',
            'is_active'   => 'nullable|boolean',
        ]);

        $parentError = $this->validateParent($data['parent_id'] ?? null, null, $tenantId);
        if ($parentError !== null) {
            return $parentError;
        }

        $slug = $this->uniqueSlug((string) $data['name'], $tenantId);
        if ($slug === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.marketplace_category_slug_taken'), 'name', 422);
        }

        $id = DB::table('marketplace_categories')->insertGetId([
            'tenant_id'   => $tenantId,
            'name'        => trim((string) $data['name']),
            'slug'        => $slug,
            'description' => isset($data['description']) ? trim((string) $data['description']) : null,
            'icon'        => isset($data['icon']) ? trim((string) $data['icon']) : null,
            'parent_id'   => isset($data['parent_id']) ? (int) $data['parent_id'] : null,
            'sort_order'  => (int) ($data['sort_order'] ?? $this->nextSortOrder($tenantId)),
            'is_active'   => (bool) ($data['is_active'] ?? true),
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $row = DB::table('marketplace_categories')->where('id', $id)->first();

        return $this->respondWithData($this->present($row, 0, $tenantId), null, 201);
    }

    /**
     * PUT /v2/admin/marketplace/categories/{id}
     */
    public function update(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_categories_write', 30, 60);

        $tenantId = TenantContext::getId();
        $row = $this->findOwned($id, $tenantId);
        if ($row instanceof JsonResponse) {
            return $row;
        }

        $data = request()->validate([
            'name'        => 'sometimes|string|max:100',
            'description' => 'nullable|string|max:1000',
            'icon'        => 'nullable|string|max:50',
            'parent_id'   => 'nullable|integer',
            'sort_order'  => 'nullable|integer|min:0|max:9999',
            'is_active'   => 'nullable|boolean',
        ]);

        if (array_key_exists('parent_id', $data)) {
            $parentError = $this->validateParent($data['parent_id'], $id, $tenantId);
            if ($parentError !== null) {
                return $parentError;
            }
        }

        $update = ['updated_at' => now()];
        if (array_key_exists('name', $data) && trim((string) $data['name']) !== (string) $row->name) {
            $slug = $this->uniqueSlug((string) $data['name'], $tenantId, $id);
            if ($slug === null) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.marketplace_category_slug_taken'), 'name', 422);
            }
            $update['name'] = trim((string) $data['name']);
            $update['slug'] = $slug;
        }
        foreach (['description', 'icon'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = $data[$field] !== null ? trim((string) $data[$field]) : null;
            }
        }
        if (array_key_exists('parent_id', $data)) {
            $update['parent_id'] = $data['parent_id'] !== null ? (int) $data['parent_id'] : null;
        }
        if (array_key_exists('sort_order', $data) && $data['sort_order'] !== null) {
            $update['sort_order'] = (int) $data['sort_order'];
        }
        if (array_key_exists('is_active', $data) && $data['is_active'] !== null) {
            $update['is_active'] = (bool) $data['is_active'];
        }

        DB::table('marketplace_categories')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($update);

        // Hiding a parent hides its children too: a child of a hidden parent
        // would otherwise float to the top level of the member picker.
        if (($update['is_active'] ?? true) === false) {
            DB::table('marketplace_categories')
                ->where('tenant_id', $tenantId)
                ->where('parent_id', $id)
                ->update(['is_active' => false, 'updated_at' => now()]);
        }

        $fresh = DB::table('marketplace_categories')->where('id', $id)->first();
        $count = (int) DB::table('marketplace_listings')
            ->where('tenant_id', $tenantId)
            ->where('category_id', $id)
            ->where('status', 'active')
            ->count();

        return $this->respondWithData($this->present($fresh, $count, $tenantId));
    }

    /**
     * PUT /v2/admin/marketplace/categories/reorder
     *
     * Body: { "ids": [12, 7, 3] } — community categories in display order.
     * Platform categories keep their own order and are ignored if listed.
     */
    public function reorder(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_categories_write', 30, 60);

        $tenantId = TenantContext::getId();
        $data = request()->validate([
            'ids'   => 'required|array|min:1|max:500',
            'ids.*' => 'integer',
        ]);

        $owned = DB::table('marketplace_categories')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $data['ids'])
            ->pluck('id')
            ->all();
        $ownedSet = array_flip(array_map('intval', $owned));

        DB::transaction(static function () use ($data, $ownedSet, $tenantId): void {
            $position = 1;
            foreach ($data['ids'] as $id) {
                if (! isset($ownedSet[(int) $id])) {
                    continue;
                }
                DB::table('marketplace_categories')
                    ->where('id', (int) $id)
                    ->where('tenant_id', $tenantId)
                    ->update(['sort_order' => $position, 'updated_at' => now()]);
                $position++;
            }
        });

        return $this->respondWithData(['reordered' => count($ownedSet)]);
    }

    /**
     * DELETE /v2/admin/marketplace/categories/{id}
     *
     * Refused while any listing (in any status) still points at the category
     * or at one of its children — hide it instead.
     */
    public function destroy(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $this->rateLimit('admin_marketplace_categories_write', 30, 60);

        $tenantId = TenantContext::getId();
        $row = $this->findOwned($id, $tenantId);
        if ($row instanceof JsonResponse) {
            return $row;
        }

        $childIds = DB::table('marketplace_categories')
            ->where('tenant_id', $tenantId)
            ->where('parent_id', $id)
            ->pluck('id')
            ->all();
        $ids = array_merge([$id], array_map('intval', $childIds));

        $inUse = (int) DB::table('marketplace_listings')
            ->where('tenant_id', $tenantId)
            ->whereIn('category_id', $ids)
            ->whereNotIn('status', ['removed'])
            ->count();
        if ($inUse > 0) {
            return $this->respondWithError(
                'CATEGORY_IN_USE',
                __('api.marketplace_category_in_use', ['count' => $inUse]),
                null,
                409,
            );
        }

        DB::transaction(static function () use ($ids, $tenantId): void {
            DB::table('marketplace_category_templates')->whereIn('category_id', $ids)->delete();
            DB::table('marketplace_categories')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $ids)
                ->delete();
        });

        return $this->respondWithData(['deleted' => count($ids)]);
    }

    // -----------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------

    /** @return object|JsonResponse */
    private function findOwned(int $id, int $tenantId): object
    {
        $row = DB::table('marketplace_categories')
            ->where('id', $id)
            ->where(static function ($q) use ($tenantId): void {
                $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
            })
            ->first();

        if (! $row) {
            return $this->respondWithError('NOT_FOUND', __('api.marketplace_category_not_found'), null, 404);
        }
        if ($row->tenant_id === null) {
            return $this->respondWithError('CATEGORY_READ_ONLY', __('api.marketplace_category_global_readonly'), null, 403);
        }

        return $row;
    }

    private function validateParent(mixed $parentId, ?int $selfId, int $tenantId): ?JsonResponse
    {
        if ($parentId === null || $parentId === '') {
            return null;
        }
        $parentId = (int) $parentId;
        if ($selfId !== null && $parentId === $selfId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.marketplace_category_parent_invalid'), 'parent_id', 422);
        }

        $parent = DB::table('marketplace_categories')
            ->where('id', $parentId)
            ->where(static function ($q) use ($tenantId): void {
                $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
            })
            ->first();

        // A parent must be a top-level category: the member picker shows two
        // levels, so a grandchild would never be reachable.
        if (! $parent || $parent->parent_id !== null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.marketplace_category_parent_invalid'), 'parent_id', 422);
        }

        // A category that already has children cannot itself become a child.
        if ($selfId !== null) {
            $hasChildren = DB::table('marketplace_categories')
                ->where('tenant_id', $tenantId)
                ->where('parent_id', $selfId)
                ->exists();
            if ($hasChildren) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.marketplace_category_parent_invalid'), 'parent_id', 422);
            }
        }

        return null;
    }

    /**
     * Slug unique within the community AND distinct from every platform slug,
     * because members browse `/marketplace/category/{slug}` and the browse
     * endpoint resolves the slug against both sets.
     */
    private function uniqueSlug(string $name, int $tenantId, ?int $ignoreId = null): ?string
    {
        $base = Str::slug(trim($name));
        if ($base === '') {
            $base = 'category';
        }

        $taken = DB::table('marketplace_categories')
            ->where('slug', $base)
            ->where(static function ($q) use ($tenantId): void {
                $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
            })
            ->when($ignoreId !== null, static fn ($q) => $q->where('id', '!=', $ignoreId))
            ->exists();

        return $taken ? null : $base;
    }

    private function nextSortOrder(int $tenantId): int
    {
        $max = DB::table('marketplace_categories')
            ->where(static function ($q) use ($tenantId): void {
                $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
            })
            ->where('sort_order', '<', 99)
            ->max('sort_order');

        return ((int) $max) + 1;
    }

    private function present(object $row, int $listingCount, int $tenantId): array
    {
        return [
            'id'            => (int) $row->id,
            'name'          => $row->name,
            'slug'          => $row->slug,
            'description'   => $row->description,
            'icon'          => $row->icon,
            'parent_id'     => $row->parent_id !== null ? (int) $row->parent_id : null,
            'sort_order'    => (int) $row->sort_order,
            'is_active'     => (bool) $row->is_active,
            'is_platform'   => $row->tenant_id === null,
            'listing_count' => $listingCount,
            'updated_at'    => $row->updated_at,
        ];
    }
}
