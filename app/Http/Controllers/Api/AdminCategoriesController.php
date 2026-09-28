<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Models\ActivityLog;

/**
 * AdminCategoriesController -- Admin category and attribute management.
 *
 * Provides full CRUD for categories and attributes in the admin panel.
 * All endpoints require admin authentication.
 */
class AdminCategoriesController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/admin/categories
     *
     * Lists all categories for the current tenant, ordered by type then name.
     * Query params: type (filter by category type)
     */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $typeFilter = $this->query('type');
        $page    = max(1, (int) ($this->query('page') ?? 1));
        $perPage = min(200, max(1, (int) ($this->query('per_page') ?? 200)));
        $offset  = ($page - 1) * $perPage;

        $conditions = ['c.tenant_id = ?'];
        $params = [$tenantId];

        if ($typeFilter && $typeFilter !== 'all') {
            $conditions[] = 'c.type = ?';
            $params[] = $typeFilter;
        }

        $where = implode(' AND ', $conditions);

        $items = DB::select(
            "SELECT c.*,
                    (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id) as listing_count
             FROM categories c
             WHERE {$where}
             ORDER BY c.type ASC, c.name ASC
             LIMIT {$perPage} OFFSET {$offset}",
            $params
        );

        $formatted = array_map(function ($row) {
            return [
                'id' => (int) $row->id,
                'name' => $row->name ?? '',
                'slug' => $row->slug ?? '',
                'color' => $row->color ?? 'blue',
                'type' => $row->type ?? 'listing',
                'listing_count' => (int) ($row->listing_count ?? 0),
                'created_at' => $row->created_at,
            ];
        }, $items);

        return $this->respondWithData($formatted);
    }

    /**
     * POST /api/v2/admin/categories
     *
     * Create a new category.
     * Required: name. Optional: color, type.
     */
    public function store(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $name = trim($this->input('name', ''));
        if ($name === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.category_name_required'), 'name', 422);
        }

        $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', trim($name)));
        $slug = trim($slug, '-');

        $color = trim($this->input('color', 'blue'));
        $type = trim($this->input('type', 'listing'));

        $allowedTypes = ['listing', 'event', 'blog', 'resource', 'vol_opportunity'];
        if (!in_array($type, $allowedTypes)) {
            return $this->respondWithError(
                'VALIDATION_INVALID_VALUE',
                __('api.invalid_category_type', ['types' => implode(', ', $allowedTypes)]),
                'type',
                422
            );
        }

        // Check name uniqueness within tenant
        $existing = DB::selectOne(
            "SELECT id FROM categories WHERE name = ? AND tenant_id = ?",
            [$name, $tenantId]
        );

        if ($existing) {
            return $this->respondWithError('VALIDATION_DUPLICATE', __('api.category_duplicate'), 'name', 409);
        }

        $newId = DB::table('categories')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'slug' => $slug,
            'color' => $color,
            'type' => $type,
        ]);

        ActivityLog::log($adminId, 'admin_create_category', "Created category #{$newId}: {$name} (type: {$type})");

        return $this->respondWithData([
            'id' => (int) $newId,
            'name' => $name,
            'slug' => $slug,
            'color' => $color,
            'type' => $type,
            'listing_count' => 0,
            'created_at' => date('Y-m-d H:i:s'),
        ], null, 201);
    }

    /**
     * PUT /api/v2/admin/categories/{id}
     *
     * Update an existing category.
     * Optional: name, color, type.
     */
    public function update(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $category = DB::selectOne(
            "SELECT * FROM categories WHERE id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$category) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.category_not_found'), null, 404);
        }

        $data = $this->getAllInput();

        $name = isset($data['name']) && trim($data['name']) !== '' ? trim($data['name']) : $category->name;
        $color = isset($data['color']) && trim($data['color']) !== '' ? trim($data['color']) : $category->color;
        $type = isset($data['type']) && trim($data['type']) !== '' ? trim($data['type']) : $category->type;

        $allowedTypes = ['listing', 'event', 'blog', 'resource', 'vol_opportunity'];
        if (!in_array($type, $allowedTypes)) {
            return $this->respondWithError(
                'VALIDATION_INVALID_VALUE',
                __('api.invalid_category_type', ['types' => implode(', ', $allowedTypes)]),
                'type',
                422
            );
        }

        // Check name uniqueness if name changed
        if ($name !== $category->name) {
            $existing = DB::selectOne(
                "SELECT id FROM categories WHERE name = ? AND tenant_id = ? AND id != ?",
                [$name, $tenantId, $id]
            );

            if ($existing) {
                return $this->respondWithError('VALIDATION_DUPLICATE', __('api.category_duplicate'), 'name', 409);
            }
        }

        // Regenerate slug if name changed
        $slug = $category->slug;
        if ($name !== $category->name) {
            $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', trim($name)));
            $slug = trim($slug, '-');
        }

        DB::update(
            "UPDATE categories SET name = ?, slug = ?, color = ?, type = ? WHERE id = ? AND tenant_id = ?",
            [$name, $slug, $color, $type, $id, $tenantId]
        );

        ActivityLog::log($adminId, 'admin_update_category', "Updated category #{$id}: {$name}");

        // Fetch updated record with listing count
        $updated = DB::selectOne(
            "SELECT c.*,
                    (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id) as listing_count
             FROM categories c
             WHERE c.id = ? AND c.tenant_id = ?",
            [$id, $tenantId]
        );

        return $this->respondWithData([
            'id' => (int) $updated->id,
            'name' => $updated->name,
            'slug' => $updated->slug,
            'color' => $updated->color,
            'type' => $updated->type,
            'listing_count' => (int) ($updated->listing_count ?? 0),
            'created_at' => $updated->created_at,
        ]);
    }

    /**
     * DELETE /api/v2/admin/categories/{id}
     *
     * Delete a category. Unassigns any listings first.
     */
    public function destroy(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $category = DB::selectOne(
            "SELECT c.*,
                    (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id) as listing_count
             FROM categories c
             WHERE c.id = ? AND c.tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$category) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.category_not_found'), null, 404);
        }

        $listingCount = (int) ($category->listing_count ?? 0);

        // Nullify category_id on affected listings
        if ($listingCount > 0) {
            DB::update(
                "UPDATE listings SET category_id = NULL WHERE category_id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );
        }

        DB::delete("DELETE FROM categories WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        ActivityLog::log(
            $adminId,
            'admin_delete_category',
            "Deleted category #{$id}: {$category->name}" . ($listingCount > 0 ? " ({$listingCount} listings unassigned)" : '')
        );

        return $this->respondWithData([
            'deleted' => true,
            'id' => $id,
            'listings_unassigned' => $listingCount,
        ]);
    }

    // ========================================
    // Attributes CRUD
    // ========================================

    /**
     * An attribute may only point at a category of the same community (F-256).
     */
    private function categoryBelongsToTenant(int $categoryId, int $tenantId): bool
    {
        return DB::table('categories')
            ->where('id', $categoryId)
            ->where('tenant_id', $tenantId)
            ->exists();
    }

    /**
     * GET /api/v2/admin/categories/attributes
     *
     * Lists all attributes for the current tenant.
     */
    public function listAttributes(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $items = DB::select(
            "SELECT a.*, c.name as category_name
             FROM attributes a
             LEFT JOIN categories c ON a.category_id = c.id AND c.tenant_id = a.tenant_id
             WHERE a.tenant_id = ?
             ORDER BY a.category_id ASC, a.name ASC
             LIMIT 500",
            [$tenantId]
        );

        $formatted = array_map(function ($row) {
            return [
                'id' => (int) $row->id,
                'name' => $row->name ?? '',
                'slug' => strtolower(preg_replace('/[^a-z0-9]+/i', '-', trim($row->name ?? ''))),
                'type' => $row->input_type ?? 'checkbox',
                'options' => null,
                'category_id' => $row->category_id ? (int) $row->category_id : null,
                'category_name' => $row->category_name ?? null,
                'is_active' => (bool) ($row->is_active ?? true),
                'target_type' => $row->target_type ?? 'any',
            ];
        }, $items);

        return $this->respondWithData($formatted);
    }

    /**
     * POST /api/v2/admin/categories/attributes
     *
     * Create a new attribute.
     */
    public function storeAttribute(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $name = trim($this->input('name', ''));
        if ($name === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.attribute_name_required'), 'name', 422);
        }

        $categoryId = $this->input('category_id') ? (int) $this->input('category_id') : null;
        if ($categoryId !== null && !$this->categoryBelongsToTenant($categoryId, $tenantId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.category_not_found'), 'category_id', 404);
        }
        $inputType = trim($this->input('type', $this->input('input_type', 'checkbox')));

        $attribute = \App\Models\Attribute::create([
            'tenant_id' => $tenantId,
            'name' => $name,
            'category_id' => $categoryId,
            'input_type' => $inputType,
            'is_active' => true,
        ]);
        $id = $attribute->id;

        ActivityLog::log($adminId, 'admin_create_attribute', "Created attribute #{$id}: {$name}");

        return $this->respondWithData([
            'id' => (int) $id,
            'name' => $name,
            'slug' => strtolower(preg_replace('/[^a-z0-9]+/i', '-', $name)),
            'type' => $inputType,
            'options' => null,
            'category_id' => $categoryId,
            'is_active' => true,
        ], null, 201);
    }

    /**
     * PUT /api/v2/admin/categories/attributes/{id}
     *
     * Update an existing attribute.
     */
    public function updateAttribute(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $data = $this->getAllInput();

        $attribute = \App\Models\Attribute::where('id', $id)->where('tenant_id', $tenantId)->first();
        if (!$attribute) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.attribute_not_found'), null, 404);
        }

        $name = isset($data['name']) && trim($data['name']) !== '' ? trim($data['name']) : $attribute->name;
        $categoryId = array_key_exists('category_id', $data) ? ($data['category_id'] ?: null) : ($attribute->category_id ?: null);
        if (array_key_exists('category_id', $data) && $categoryId !== null
            && !$this->categoryBelongsToTenant((int) $categoryId, $tenantId)
        ) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.category_not_found'), 'category_id', 404);
        }
        $inputType = isset($data['type']) ? trim($data['type']) : (isset($data['input_type']) ? trim($data['input_type']) : $attribute->input_type);
        $isActive = isset($data['is_active']) ? ($data['is_active'] ? 1 : 0) : ($attribute->is_active ?? 1);

        $attribute->update([
            'name' => $name,
            'category_id' => $categoryId,
            'input_type' => $inputType,
            'is_active' => $isActive,
        ]);

        ActivityLog::log($adminId, 'admin_update_attribute', "Updated attribute #{$id}: {$name}");

        return $this->respondWithData([
            'id' => (int) $id,
            'name' => $name,
            'slug' => strtolower(preg_replace('/[^a-z0-9]+/i', '-', $name)),
            'type' => $inputType,
            'is_active' => (bool) $isActive,
        ]);
    }

    /**
     * DELETE /api/v2/admin/categories/attributes/{id}
     *
     * Delete an attribute.
     */
    public function destroyAttribute(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $attribute = \App\Models\Attribute::where('id', $id)->where('tenant_id', $tenantId)->first();
        if (!$attribute) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.attribute_not_found'), null, 404);
        }

        $attribute->delete();

        ActivityLog::log($adminId, 'admin_delete_attribute', "Deleted attribute #{$id}: {$attribute->name}");

        return $this->respondWithData(['deleted' => true, 'id' => $id]);
    }
}
