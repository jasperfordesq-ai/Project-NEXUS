<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\Models\ActivityLog;
use App\Models\Page;
use App\Services\RedisCache;
use App\Services\PrerenderContentInvalidator;
use App\Services\StripeSubscriptionService;

/**
 * AdminContentController -- Content moderation, pages, menus, plans, subscriptions.
 *
 * Converted from legacy delegation to direct DB calls.
 */
class AdminContentController extends BaseApiController
{
    protected bool $isV2Api = true;
    private const PAGE_DESIGN_JSON_MAX_BYTES = 2_000_000;

    public function __construct(
        private readonly RedisCache $redisCache,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Content Reports — REMOVED 2026-08-28
    //
    // reports(), approveContent() and rejectContent() read and wrote a
    // `content_reports` table that exists in no migration, no schema dump and
    // no live database. None of the three was ever routed and nothing called
    // them internally, so the feature never ran. Content moderation in use is
    // App\Services\ContentModerationService (content_moderation_queue) via
    // AdminAnalyticsReportsController.
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Pages
    // ─────────────────────────────────────────────────────────────────────────

    public function getPages(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $rows = array_map(fn($r) => (array)$r, DB::select(
            "SELECT id, tenant_id, title, slug, meta_description, is_published, sort_order, show_in_menu, menu_location, menu_order, publish_at, created_at, updated_at
             FROM pages WHERE tenant_id = ? ORDER BY sort_order ASC, created_at DESC",
            [$tenantId]
        ));

        $pages = array_map(function ($row) {
            $row['status'] = $row['is_published'] ? 'published' : 'draft';
            unset($row['is_published']);
            return $row;
        }, $rows);

        return $this->respondWithData($pages);
    }

    public function getPage($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_page_id'), 'id', 400);
        }

        $result = DB::selectOne(
            "SELECT id, tenant_id, title, slug, content, content_format, design_json, meta_description, is_published, sort_order, show_in_menu, menu_location, menu_order, publish_at, created_at, updated_at
             FROM pages WHERE id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.page_not_found'), 'id', 404);
        }

        $row = (array)$result;
        $row['status'] = $row['is_published'] ? 'published' : 'draft';
        unset($row['is_published']);

        return $this->respondWithData($row);
    }

    public function createPage(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $input = $this->getAllInput();
        $title = trim($input['title'] ?? '');

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.title_required'), 'title', 422);
        }

        $slugInput = trim((string) ($input['slug'] ?? ''));
        $slug = $this->generateSlug($slugInput !== '' ? $slugInput : $title);
        $content = $input['content'] ?? '';
        $contentFormat = $input['content_format'] ?? 'richtext';
        $designJson = $input['design_json'] ?? null;
        $metaDescription = $input['meta_description'] ?? '';
        $status = $input['status'] ?? 'draft';
        $sortOrder = (int)($input['sort_order'] ?? 0);
        $showInMenu = (int)($input['show_in_menu'] ?? 0);
        $menuLocation = $input['menu_location'] ?? 'about';
        $menuOrder = (int)($input['menu_order'] ?? 0);

        if (!in_array($status, ['draft', 'published'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.status_must_be_draft_or_published'), 'status', 422);
        }

        if (!in_array($contentFormat, ['plaintext', 'richtext', 'html', 'builder'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_content_format'), 'content_format', 422);
        }

        $designJson = $this->validatedPageDesignJson($contentFormat, $designJson);
        if ($designJson instanceof JsonResponse) {
            return $designJson;
        }

        if ($this->isReservedPageSlug($slug)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.slug_reserved', ['slug' => $slug]), 'slug', 422);
        }

        $isPublished = ($status === 'published') ? 1 : 0;
        $slug = $this->ensureUniqueSlug('pages', $slug, $tenantId);

        DB::insert(
            "INSERT INTO pages (tenant_id, title, slug, content, content_format, design_json, meta_description, is_published, sort_order, show_in_menu, menu_location, menu_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [$tenantId, $title, $slug, $content, $contentFormat, $contentFormat === 'builder' ? $designJson : null, $metaDescription, $isPublished, $sortOrder, $showInMenu, $menuLocation, $menuOrder]
        );

        $newId = DB::getPdo()->lastInsertId();

        $result = DB::selectOne(
            "SELECT id, tenant_id, title, slug, content, content_format, design_json, meta_description, is_published, sort_order, show_in_menu, menu_location, menu_order, publish_at, created_at, updated_at
             FROM pages WHERE id = ? AND tenant_id = ?", [$newId, $tenantId]
        );

        $row = (array)$result;
        $row['status'] = $row['is_published'] ? 'published' : 'draft';
        unset($row['is_published']);

        try { $this->redisCache->delete('tenant_bootstrap', $tenantId); } catch (\Exception $e) {
            \Log::warning('Failed to invalidate tenant_bootstrap cache on page create', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }
        app(PrerenderContentInvalidator::class)->refreshRoutes($tenantId, ["/page/{$slug}"]);

        return $this->respondWithData($row, null, 201);
    }

    public function updatePage($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_page_id'), 'id', 400);
        }

        $existing = DB::selectOne("SELECT id, slug FROM pages WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$existing) {
            return $this->respondWithError('NOT_FOUND', __('api.page_not_found'), 'id', 404);
        }

        $input = $this->getAllInput();
        // NOTE: Dynamic-SQL → Eloquent migration started here (2026-04-13).
        // This one updatePage() call has been refactored below as the pilot; the
        // remaining ~30 dynamic DB::update/DB::insert sites in this controller
        // should be converted to Eloquent Model::where(...)->update([...]) in a
        // follow-up pass. See CLAUDE.md / audit notes.
        $data = [];

        if (isset($input['title'])) { $data['title'] = trim($input['title']); }
        if (isset($input['slug'])) {
            $slug = $this->generateSlug($input['slug']);
            if ($this->isReservedPageSlug($slug)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.slug_reserved_short', ['slug' => $slug]), 'slug', 422);
            }
            $conflict = DB::selectOne("SELECT id FROM pages WHERE slug = ? AND tenant_id = ? AND id != ?", [$slug, $tenantId, $id]);
            if ($conflict) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.slug_already_in_use'), 'slug', 422);
            }
            $data['slug'] = $slug;
        }
        if (array_key_exists('content', $input)) { $data['content'] = $input['content']; }
        if (isset($input['content_format'])) {
            if (!in_array($input['content_format'], ['plaintext', 'richtext', 'html', 'builder'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_content_format'), 'content_format', 422);
            }
            $data['content_format'] = $input['content_format'];
            if ($input['content_format'] !== 'builder') {
                $data['design_json'] = null;
            }
        }
        if (array_key_exists('design_json', $input)) {
            $format = $data['content_format']
                ?? (string) (DB::table('pages')->where('id', $id)->where('tenant_id', $tenantId)->value('content_format') ?: 'richtext');
            $designJson = $this->validatedPageDesignJson($format, $input['design_json'] ?? null);
            if ($designJson instanceof JsonResponse) {
                return $designJson;
            }
            $data['design_json'] = $designJson;
        }
        if (isset($input['status'])) {
            if (!in_array($input['status'], ['draft', 'published'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.status_must_be_draft_or_published'), 'status', 422);
            }
            $data['is_published'] = ($input['status'] === 'published') ? 1 : 0;
        }
        if (isset($input['sort_order'])) { $data['sort_order'] = (int)$input['sort_order']; }
        if (isset($input['show_in_menu'])) { $data['show_in_menu'] = (int)$input['show_in_menu']; }
        if (isset($input['menu_location'])) { $data['menu_location'] = $input['menu_location']; }
        if (array_key_exists('meta_description', $input)) { $data['meta_description'] = $input['meta_description']; }
        if (isset($input['menu_order'])) { $data['menu_order'] = (int)$input['menu_order']; }

        if (empty($data)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422);
        }

        // Eloquent update — HasTenantScope on Page model auto-applies tenant_id.
        // Explicit where(tenant_id) kept as defense-in-depth per CLAUDE.md rule
        // "every DELETE/UPDATE must include AND tenant_id = ?".
        Page::where('id', $id)->where('tenant_id', $tenantId)->update($data);

        $result = DB::selectOne(
            "SELECT id, tenant_id, title, slug, content, content_format, design_json, meta_description, is_published, sort_order, show_in_menu, menu_location, menu_order, publish_at, created_at, updated_at
             FROM pages WHERE id = ? AND tenant_id = ?", [$id, $tenantId]
        );

        $row = (array)$result;
        $row['status'] = $row['is_published'] ? 'published' : 'draft';
        unset($row['is_published']);

        try { $this->redisCache->delete('tenant_bootstrap', $tenantId); } catch (\Exception $e) {
            \Log::warning('Failed to invalidate tenant_bootstrap cache on page update', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }
        $newSlug = (string) ($row['slug'] ?? $existing->slug);
        app(PrerenderContentInvalidator::class)->refreshRoutes($tenantId, array_values(array_unique([
            "/page/{$existing->slug}",
            "/page/{$newSlug}",
        ])));

        return $this->respondWithData($row);
    }

    public function deletePage($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_page_id'), 'id', 400);
        }

        $existing = DB::selectOne("SELECT id, title, slug FROM pages WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$existing) {
            return $this->respondWithError('NOT_FOUND', __('api.page_not_found'), 'id', 404);
        }

        DB::delete("DELETE FROM menu_items WHERE page_id = ? AND page_id IN (SELECT id FROM pages WHERE tenant_id = ?)", [$id, $tenantId]);
        DB::delete("DELETE FROM pages WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        ActivityLog::log($adminId, 'admin_delete_page', "Deleted page #{$id}: " . ($existing->title ?? ''));

        try { $this->redisCache->delete('tenant_bootstrap', $tenantId); } catch (\Exception $e) {
            \Log::warning('Failed to invalidate tenant_bootstrap cache on page delete', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        }
        app(PrerenderContentInvalidator::class)->refreshRoutes($tenantId, ["/page/{$existing->slug}"]);

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Menus
    // ─────────────────────────────────────────────────────────────────────────

    public function getMenus(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $menus = array_map(fn($r) => (array)$r, DB::select(
            "SELECT m.id, m.tenant_id, m.name, m.slug, m.description, m.location, m.layout,
                    m.min_plan_tier, m.is_active, m.created_at, m.updated_at, COUNT(mi.id) AS item_count
             FROM menus m LEFT JOIN menu_items mi ON mi.menu_id = m.id
             WHERE m.tenant_id = ? GROUP BY m.id ORDER BY m.name ASC",
            [$tenantId]
        ));

        return $this->respondWithData($menus);
    }

    public function getMenu($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_id'), 'id', 400);
        }

        $result = DB::selectOne(
            "SELECT id, tenant_id, name, slug, description, location, layout, min_plan_tier, is_active, created_at, updated_at
             FROM menus WHERE id = ? AND tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.menu_not_found'), 'id', 404);
        }

        $menu = (array)$result;
        $menu['items'] = $this->buildMenuItemTree($id);

        return $this->respondWithData($menu);
    }

    public function createMenu(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $input = $this->getAllInput();
        $name = trim($input['name'] ?? '');
        $location = trim($input['location'] ?? '');

        if (empty($name)) { return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 422); }
        if (empty($location)) { return $this->respondWithError('VALIDATION_ERROR', __('api.location_required'), 'location', 422); }

        $slug = $this->generateSlug($name);
        $slug = $this->ensureUniqueSlug('menus', $slug, $tenantId);

        DB::insert(
            "INSERT INTO menus (tenant_id, name, slug, description, location, layout, min_plan_tier, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [$tenantId, $name, $slug, $input['description'] ?? '', $location, $input['layout'] ?? null, (int)($input['min_plan_tier'] ?? 0), (int)($input['is_active'] ?? 1)]
        );

        $result = DB::selectOne("SELECT id, tenant_id, name, slug, description, location, layout, min_plan_tier, is_active, created_at, updated_at FROM menus WHERE id = ? AND tenant_id = ?", [DB::getPdo()->lastInsertId(), $tenantId]);
        $menu = (array)$result;
        app(PrerenderContentInvalidator::class)->refreshTenant($tenantId);

        return $this->respondWithData($menu, null, 201);
    }

    public function updateMenu($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_id'), 'id', 400); }

        $existing = DB::selectOne("SELECT id FROM menus WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.menu_not_found'), 'id', 404); }

        $input = $this->getAllInput();
        $updates = [];
        $params = [];

        if (isset($input['name'])) { $updates[] = 'name = ?'; $params[] = trim($input['name']); }
        if (isset($input['slug'])) {
            $slug = $this->generateSlug($input['slug']);
            $conflict = DB::selectOne("SELECT id FROM menus WHERE slug = ? AND tenant_id = ? AND id != ?", [$slug, $tenantId, $id]);
            if ($conflict) { return $this->respondWithError('VALIDATION_ERROR', __('api.slug_already_in_use'), 'slug', 422); }
            $updates[] = 'slug = ?'; $params[] = $slug;
        }
        if (array_key_exists('description', $input)) { $updates[] = 'description = ?'; $params[] = $input['description']; }
        if (isset($input['location'])) { $updates[] = 'location = ?'; $params[] = trim($input['location']); }
        if (array_key_exists('layout', $input)) { $updates[] = 'layout = ?'; $params[] = $input['layout']; }
        if (isset($input['min_plan_tier'])) { $updates[] = 'min_plan_tier = ?'; $params[] = (int)$input['min_plan_tier']; }
        if (isset($input['is_active'])) { $updates[] = 'is_active = ?'; $params[] = (int)$input['is_active']; }

        if (empty($updates)) { return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422); }

        $updates[] = 'updated_at = NOW()';
        $params[] = $id;
        $params[] = $tenantId;

        DB::update("UPDATE menus SET " . implode(', ', $updates) . " WHERE id = ? AND tenant_id = ?", $params);

        $result = DB::selectOne("SELECT id, tenant_id, name, slug, description, location, layout, min_plan_tier, is_active, created_at, updated_at FROM menus WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        $menu = (array)$result;
        app(PrerenderContentInvalidator::class)->refreshTenant($tenantId);

        return $this->respondWithData($menu);
    }

    public function deleteMenu($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_id'), 'id', 400); }

        $existing = DB::selectOne("SELECT id, name FROM menus WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.menu_not_found'), 'id', 404); }

        DB::delete("DELETE FROM menu_items WHERE menu_id = ? AND menu_id IN (SELECT id FROM menus WHERE tenant_id = ?)", [$id, $tenantId]);
        DB::delete("DELETE FROM menus WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);

        ActivityLog::log($adminId, 'admin_delete_menu', "Deleted menu #{$id}: " . ($existing->name ?? ''));
        app(PrerenderContentInvalidator::class)->refreshTenant($tenantId);

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Menu Items
    // ─────────────────────────────────────────────────────────────────────────

    public function getMenuItems($menuId): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $menuId = (int) $menuId;

        if ($menuId < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_id'), 'id', 400); }

        $menu = DB::selectOne("SELECT id FROM menus WHERE id = ? AND tenant_id = ?", [$menuId, $tenantId]);
        if (!$menu) { return $this->respondWithError('NOT_FOUND', __('api.menu_not_found'), 'id', 404); }

        return $this->respondWithData($this->buildMenuItemTree($menuId));
    }

    public function createMenuItem($menuId): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $menuId = (int) $menuId;

        if ($menuId < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_id'), 'id', 400); }

        $menu = DB::selectOne("SELECT id FROM menus WHERE id = ? AND tenant_id = ?", [$menuId, $tenantId]);
        if (!$menu) { return $this->respondWithError('NOT_FOUND', __('api.menu_not_found'), 'id', 404); }

        $input = $this->getAllInput();
        $label = trim($input['label'] ?? '');
        if (empty($label)) { return $this->respondWithError('VALIDATION_ERROR', __('api.label_required'), 'label', 422); }

        $parentId = isset($input['parent_id']) ? (int)$input['parent_id'] : null;
        $pageId = isset($input['page_id']) ? (int)$input['page_id'] : null;
        $visibilityRules = isset($input['visibility_rules']) ? json_encode($input['visibility_rules']) : null;

        // Validate parent_id belongs to the same menu (and therefore same tenant)
        if ($parentId !== null) {
            $parentExists = DB::selectOne("SELECT id FROM menu_items WHERE id = ? AND menu_id = ?", [$parentId, $menuId]);
            if (!$parentExists) { return $this->respondWithError('VALIDATION_ERROR', __('api.parent_menu_item_not_found'), 'parent_id', 422); }
        }

        // Validate page_id belongs to the same tenant
        if ($pageId !== null) {
            $pageExists = DB::selectOne("SELECT id FROM pages WHERE id = ? AND tenant_id = ?", [$pageId, $tenantId]);
            if (!$pageExists) { return $this->respondWithError('VALIDATION_ERROR', __('api.page_not_found'), 'page_id', 422); }
        }

        DB::insert(
            "INSERT INTO menu_items (menu_id, parent_id, type, label, url, route_name, page_id, icon, css_class, target, sort_order, visibility_rules, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [$menuId, $parentId, $input['type'] ?? 'link', $label, $input['url'] ?? null, $input['route_name'] ?? null,
             $pageId, $input['icon'] ?? null, $input['css_class'] ?? null,
             $input['target'] ?? '_self', (int)($input['sort_order'] ?? 0), $visibilityRules, (int)($input['is_active'] ?? 1)]
        );

        $result = DB::selectOne(
            "SELECT id, menu_id, parent_id, type, label, url, route_name, page_id, icon, css_class, target, sort_order, visibility_rules, is_active, created_at, updated_at
             FROM menu_items WHERE id = ? AND menu_id IN (SELECT id FROM menus WHERE tenant_id = ?)", [DB::getPdo()->lastInsertId(), $tenantId]
        );

        $item = (array)$result;
        if ($item && $item['visibility_rules']) {
            $item['visibility_rules'] = json_decode($item['visibility_rules'], true);
        }
        app(PrerenderContentInvalidator::class)->refreshTenant($tenantId);

        return $this->respondWithData($item, null, 201);
    }

    public function reorderMenuItems($menuId): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $menuId = (int) $menuId;

        if ($menuId < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_id'), 'id', 400); }

        $menu = DB::selectOne("SELECT id FROM menus WHERE id = ? AND tenant_id = ?", [$menuId, $tenantId]);
        if (!$menu) { return $this->respondWithError('NOT_FOUND', __('api.menu_not_found'), 'id', 404); }

        $input = $this->getAllInput();
        $items = $input['items'] ?? [];
        if (!is_array($items) || empty($items)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.items_array_required'), 'items', 422);
        }

        // Collect valid item IDs in this menu for parent_id validation
        $validItemIds = array_map(
            fn($r) => (int) $r->id,
            DB::select("SELECT id FROM menu_items WHERE menu_id = ?", [$menuId])
        );

        DB::beginTransaction();
        try {
            foreach ($items as $item) {
                $itemId = (int)($item['id'] ?? 0);
                if ($itemId < 1) continue;
                $parentId = isset($item['parent_id']) ? (int)$item['parent_id'] : null;

                // Validate parent_id belongs to the same menu
                if ($parentId !== null && !in_array($parentId, $validItemIds, true)) {
                    DB::rollBack();
                    return $this->respondWithError('VALIDATION_ERROR', __('api.parent_menu_item_not_found'), 'parent_id', 422);
                }

                DB::update("UPDATE menu_items SET sort_order = ?, parent_id = ?, updated_at = NOW() WHERE id = ? AND menu_id = ?",
                    [(int)($item['sort_order'] ?? 0), $parentId, $itemId, $menuId]);
            }
            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
        app(PrerenderContentInvalidator::class)->refreshTenant($tenantId);

        return $this->respondWithData($this->buildMenuItemTree($menuId));
    }

    public function updateMenuItem($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_item_id'), 'id', 400); }

        $existing = DB::selectOne(
            "SELECT mi.id, mi.menu_id FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE mi.id = ? AND m.tenant_id = ?",
            [$id, $tenantId]
        );
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.menu_item_not_found'), 'id', 404); }

        $input = $this->getAllInput();
        $updates = [];
        $params = [];

        if (isset($input['label'])) { $updates[] = 'label = ?'; $params[] = trim($input['label']); }
        if (isset($input['type'])) {
            // Whitelist menu-item types so callers cannot smuggle arbitrary
            // strings through to the database (was previously accepting any
            // value, leaking into the admin UI's rendering logic).
            $allowedTypes = ['link', 'page', 'custom', 'divider', 'route'];
            if (!in_array($input['type'], $allowedTypes, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_item_type'), 'type', 422);
            }
            $updates[] = 'type = ?';
            $params[] = $input['type'];
        }
        if (array_key_exists('url', $input)) { $updates[] = 'url = ?'; $params[] = $input['url']; }
        if (array_key_exists('route_name', $input)) { $updates[] = 'route_name = ?'; $params[] = $input['route_name']; }
        if (array_key_exists('page_id', $input)) {
            $pageId = isset($input['page_id']) ? (int)$input['page_id'] : null;
            if ($pageId !== null) {
                $pageExists = DB::selectOne("SELECT id FROM pages WHERE id = ? AND tenant_id = ?", [$pageId, $tenantId]);
                if (!$pageExists) { return $this->respondWithError('VALIDATION_ERROR', __('api.page_not_found'), 'page_id', 422); }
            }
            $updates[] = 'page_id = ?'; $params[] = $pageId;
        }
        if (array_key_exists('parent_id', $input)) {
            $parentId = isset($input['parent_id']) ? (int)$input['parent_id'] : null;
            if ($parentId !== null) {
                $parentExists = DB::selectOne("SELECT id FROM menu_items WHERE id = ? AND menu_id = ?", [$parentId, $existing->menu_id]);
                if (!$parentExists) { return $this->respondWithError('VALIDATION_ERROR', __('api.parent_menu_item_not_found'), 'parent_id', 422); }
            }
            $updates[] = 'parent_id = ?'; $params[] = $parentId;
        }
        if (array_key_exists('icon', $input)) { $updates[] = 'icon = ?'; $params[] = $input['icon']; }
        if (array_key_exists('css_class', $input)) { $updates[] = 'css_class = ?'; $params[] = $input['css_class']; }
        if (isset($input['target'])) { $updates[] = 'target = ?'; $params[] = $input['target']; }
        if (isset($input['sort_order'])) { $updates[] = 'sort_order = ?'; $params[] = (int)$input['sort_order']; }
        if (array_key_exists('visibility_rules', $input)) {
            $updates[] = 'visibility_rules = ?';
            $params[] = isset($input['visibility_rules']) ? json_encode($input['visibility_rules']) : null;
        }
        if (isset($input['is_active'])) { $updates[] = 'is_active = ?'; $params[] = (int)$input['is_active']; }

        if (empty($updates)) { return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422); }

        $updates[] = 'updated_at = NOW()';
        $params[] = $id;
        $params[] = $tenantId;

        DB::update("UPDATE menu_items SET " . implode(', ', $updates) . " WHERE id = ? AND menu_id IN (SELECT id FROM menus WHERE tenant_id = ?)", $params);

        $result = DB::selectOne(
            "SELECT id, menu_id, parent_id, type, label, url, route_name, page_id, icon, css_class, target, sort_order, visibility_rules, is_active, created_at, updated_at
             FROM menu_items WHERE id = ? AND menu_id IN (SELECT id FROM menus WHERE tenant_id = ?)", [$id, $tenantId]
        );

        $item = (array)$result;
        if ($item && $item['visibility_rules']) {
            $item['visibility_rules'] = json_decode($item['visibility_rules'], true);
        }
        app(PrerenderContentInvalidator::class)->refreshTenant($tenantId);

        return $this->respondWithData($item);
    }

    public function deleteMenuItem($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_item_id'), 'id', 400); }

        $existing = DB::selectOne(
            "SELECT mi.id FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE mi.id = ? AND m.tenant_id = ?",
            [$id, $tenantId]
        );
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.menu_item_not_found'), 'id', 404); }

        DB::delete("DELETE FROM menu_items WHERE parent_id = ? AND menu_id IN (SELECT id FROM menus WHERE tenant_id = ?)", [$id, $tenantId]);
        DB::delete("DELETE FROM menu_items WHERE id = ? AND menu_id IN (SELECT id FROM menus WHERE tenant_id = ?)", [$id, $tenantId]);
        app(PrerenderContentInvalidator::class)->refreshTenant($tenantId);

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Plans
    // ─────────────────────────────────────────────────────────────────────────

    public function getPlans(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $plans = array_map(fn($r) => (array)$r, DB::select(
            "SELECT pp.id, pp.name, pp.slug, pp.description, pp.tier_level, pp.features,
                    pp.max_menus, pp.max_menu_items, pp.max_users, pp.price_monthly, pp.price_yearly,
                    pp.is_active, pp.stripe_product_id, pp.stripe_price_id_monthly, pp.stripe_price_id_yearly,
                    pp.created_at, pp.updated_at,
                    (SELECT COUNT(*) FROM tenant_plan_assignments tpa WHERE tpa.pay_plan_id = pp.id AND tpa.status IN ('active','trialing','trial')) AS tenant_count
             FROM pay_plans pp ORDER BY pp.tier_level ASC, pp.name ASC"
        ));

        foreach ($plans as &$plan) {
            if (isset($plan['features'])) { $plan['features'] = json_decode($plan['features'], true) ?: []; }
            $plan['stripe_synced'] = !empty($plan['stripe_product_id']);
            $plan['tenant_count'] = (int) $plan['tenant_count'];
        }
        unset($plan);

        return $this->respondWithData($plans);
    }

    public function syncPlanToStripe($id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        $existing = DB::selectOne("SELECT id FROM pay_plans WHERE id = ?", [$id]);
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        try {
            StripeSubscriptionService::syncPlanToStripe($id);
            $plan = DB::selectOne("SELECT stripe_product_id, stripe_price_id_monthly, stripe_price_id_yearly FROM pay_plans WHERE id = ?", [$id]);
            return $this->respondWithData([
                'synced'                  => true,
                'stripe_product_id'       => $plan->stripe_product_id ?? null,
                'stripe_price_id_monthly' => $plan->stripe_price_id_monthly ?? null,
                'stripe_price_id_yearly'  => $plan->stripe_price_id_yearly ?? null,
            ]);
        } catch (\Exception $e) {
            Log::warning('Manual Stripe sync failed', ['plan_id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('STRIPE_ERROR', __('api.stripe_plan_sync_failed'), null, 500);
        }
    }

    public function getPlan($id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        $result = DB::selectOne(
            "SELECT id, name, slug, description, tier_level, features,
                    max_menus, max_menu_items, max_users, price_monthly, price_yearly, is_active, created_at, updated_at
             FROM pay_plans WHERE id = ?", [$id]
        );

        if (!$result) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        $plan = (array)$result;
        if (isset($plan['features'])) { $plan['features'] = json_decode($plan['features'], true) ?: []; }

        return $this->respondWithData($plan);
    }

    public function createPlan(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $input = $this->getAllInput();
        $name = trim($input['name'] ?? '');
        if (empty($name)) { return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 422); }

        $slug = $this->generateSlug($name);
        $counter = 0;
        $originalSlug = $slug;
        while (DB::selectOne("SELECT id FROM pay_plans WHERE slug = ?", [$slug])) {
            $counter++;
            $slug = $originalSlug . '-' . $counter;
        }

        DB::insert(
            "INSERT INTO pay_plans (name, slug, description, tier_level, features, max_menus, max_menu_items, max_users, price_monthly, price_yearly, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
            [$name, $slug, $input['description'] ?? '', (int)($input['tier_level'] ?? 0),
             isset($input['features']) ? json_encode($input['features']) : '[]',
             isset($input['max_menus']) ? (int)$input['max_menus'] : null,
             isset($input['max_menu_items']) ? (int)$input['max_menu_items'] : null,
             isset($input['max_users']) && $input['max_users'] !== '' ? (int)$input['max_users'] : null,
             isset($input['price_monthly']) ? (float)$input['price_monthly'] : null,
             isset($input['price_yearly']) ? (float)$input['price_yearly'] : null,
             (int)($input['is_active'] ?? 1)]
        );

        $newPlanId = (int) DB::getPdo()->lastInsertId();

        // Sync to Stripe (non-blocking — don't fail plan creation if Stripe is unreachable)
        try {
            StripeSubscriptionService::syncPlanToStripe($newPlanId);
        } catch (\Exception $e) {
            Log::warning('Stripe sync failed after plan creation', [
                'plan_id' => $newPlanId,
                'error' => $e->getMessage(),
            ]);
        }

        $result = DB::selectOne(
            "SELECT id, name, slug, description, tier_level, features, max_menus, max_menu_items, max_users, price_monthly, price_yearly, is_active, created_at, updated_at
             FROM pay_plans WHERE id = ?", [$newPlanId]
        );

        $plan = $result ? (array)$result : null;
        if ($plan) {
            if (isset($plan['features'])) { $plan['features'] = json_decode($plan['features'], true) ?: []; }
        }

        return $this->respondWithData($plan, null, 201);
    }

    public function updatePlan($id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        $existing = DB::selectOne("SELECT id FROM pay_plans WHERE id = ?", [$id]);
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        $input = $this->getAllInput();
        $updates = [];
        $params = [];

        if (isset($input['name'])) { $updates[] = 'name = ?'; $params[] = trim($input['name']); }
        if (isset($input['slug'])) {
            $slug = $this->generateSlug($input['slug']);
            $conflict = DB::selectOne("SELECT id FROM pay_plans WHERE slug = ? AND id != ?", [$slug, $id]);
            if ($conflict) { return $this->respondWithError('VALIDATION_ERROR', __('api.slug_already_in_use'), 'slug', 422); }
            $updates[] = 'slug = ?'; $params[] = $slug;
        }
        if (array_key_exists('description', $input)) { $updates[] = 'description = ?'; $params[] = $input['description']; }
        if (isset($input['tier_level'])) { $updates[] = 'tier_level = ?'; $params[] = (int)$input['tier_level']; }
        if (array_key_exists('features', $input)) { $updates[] = 'features = ?'; $params[] = json_encode($input['features'] ?? []); }
        if (isset($input['max_menus'])) { $updates[] = 'max_menus = ?'; $params[] = (int)$input['max_menus']; }
        if (isset($input['max_menu_items'])) { $updates[] = 'max_menu_items = ?'; $params[] = (int)$input['max_menu_items']; }
        if (array_key_exists('max_users', $input)) { $updates[] = 'max_users = ?'; $params[] = ($input['max_users'] !== '' && $input['max_users'] !== null) ? (int)$input['max_users'] : null; }
        if (array_key_exists('price_monthly', $input)) { $updates[] = 'price_monthly = ?'; $params[] = isset($input['price_monthly']) ? (float)$input['price_monthly'] : null; }
        if (array_key_exists('price_yearly', $input)) { $updates[] = 'price_yearly = ?'; $params[] = isset($input['price_yearly']) ? (float)$input['price_yearly'] : null; }
        if (isset($input['is_active'])) { $updates[] = 'is_active = ?'; $params[] = (int)$input['is_active']; }

        if (empty($updates)) { return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422); }

        $updates[] = 'updated_at = NOW()';
        $params[] = $id;

        DB::update("UPDATE pay_plans SET " . implode(', ', $updates) . " WHERE id = ?", $params);

        // Sync to Stripe (non-blocking — don't fail plan update if Stripe is unreachable)
        try {
            StripeSubscriptionService::syncPlanToStripe($id);
        } catch (\Exception $e) {
            Log::warning('Stripe sync failed after plan update', [
                'plan_id' => $id,
                'error' => $e->getMessage(),
            ]);
        }

        $result = DB::selectOne(
            "SELECT id, name, slug, description, tier_level, features, max_menus, max_menu_items, max_users, price_monthly, price_yearly, is_active, created_at, updated_at
             FROM pay_plans WHERE id = ?", [$id]
        );

        $plan = $result ? (array)$result : null;
        if ($plan) {
            if (isset($plan['features'])) { $plan['features'] = json_decode($plan['features'], true) ?: []; }
        }

        return $this->respondWithData($plan);
    }

    public function deletePlan($id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        $existing = DB::selectOne("SELECT id FROM pay_plans WHERE id = ?", [$id]);
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        $activeAssignments = DB::selectOne("SELECT COUNT(*) AS cnt FROM tenant_plan_assignments WHERE pay_plan_id = ? AND status = 'active'", [$id]);
        if ($activeAssignments && (int)$activeAssignments->cnt > 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.plan_has_active_assignments', ['count' => $activeAssignments->cnt]), 'id', 422);
        }

        DB::delete("DELETE FROM pay_plans WHERE id = ?", [$id]);

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Subscriptions
    // ─────────────────────────────────────────────────────────────────────────

    public function getSubscriptions(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        // Platform super-admins may view all subscriptions (cross-tenant).
        // Tenant admins see only their own tenant's subscription.
        $user = \Illuminate\Support\Facades\Auth::user();
        $isPlatformSuperAdmin = in_array($user->role ?? '', ['super_admin', 'god'], true)
            || ($user->is_super_admin ?? false);

        if ($isPlatformSuperAdmin) {
            $subscriptions = array_map(fn($r) => (array)$r, DB::select(
                "SELECT tpa.id, tpa.tenant_id, tpa.pay_plan_id, tpa.status, tpa.starts_at, tpa.expires_at,
                        tpa.trial_ends_at, tpa.stripe_subscription_id, tpa.stripe_current_period_end,
                        tpa.created_at, tpa.updated_at,
                        pp.name AS plan_name, pp.slug AS plan_slug, pp.tier_level AS plan_tier_level,
                        t.name AS tenant_name
                 FROM tenant_plan_assignments tpa
                 JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
                 LEFT JOIN tenants t ON t.id = tpa.tenant_id
                 ORDER BY tpa.created_at DESC"
            ));
        } else {
            $subscriptions = array_map(fn($r) => (array)$r, DB::select(
                "SELECT tpa.id, tpa.tenant_id, tpa.pay_plan_id, tpa.status, tpa.starts_at, tpa.expires_at,
                        tpa.trial_ends_at, tpa.stripe_subscription_id, tpa.stripe_current_period_end,
                        tpa.created_at, tpa.updated_at,
                        pp.name AS plan_name, pp.slug AS plan_slug, pp.tier_level AS plan_tier_level,
                        t.name AS tenant_name
                 FROM tenant_plan_assignments tpa
                 JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
                 LEFT JOIN tenants t ON t.id = tpa.tenant_id
                 WHERE tpa.tenant_id = ?
                 ORDER BY tpa.created_at DESC",
                [$tenantId]
            ));
        }

        return $this->respondWithData($subscriptions);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private function generateSlug(string $value): string
    {
        return strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', $value), '-'));
    }

    private const RESERVED_PAGE_SLUGS = [
        'login', 'register', 'password', 'logout', 'dashboard', 'listings',
        'events', 'groups', 'messages', 'notifications', 'wallet', 'feed',
        'search', 'members', 'profile', 'settings', 'exchanges', 'achievements',
        'leaderboard', 'goals', 'volunteering', 'blog', 'resources',
        'organisations', 'federation', 'onboarding', 'group-exchanges', 'matches', 'newsletter',
        'help', 'contact', 'about', 'faq', 'legal', 'terms',
        'privacy', 'accessibility', 'cookies', 'development-status', 'features', 'changelog',
        'timebanking-guide', 'partner', 'social-prescribing', 'impact-summary', 'impact-report', 'strategic-plan',
        'admin', 'admin-legacy', 'super-admin', 'api', 'assets',
        'uploads', 'classic', 'health', 'page',
    ];

    private function isReservedPageSlug(string $slug): bool
    {
        return in_array(strtolower($slug), self::RESERVED_PAGE_SLUGS, true);
    }

    private function ensureUniqueSlug(string $table, string $slug, int $tenantId): string
    {
        if (!in_array($table, ['pages', 'menus'], true)) {
            throw new \InvalidArgumentException(__('api.invalid_table_parameter'));
        }
        $counter = 0;
        $originalSlug = $slug;
        while (DB::selectOne("SELECT id FROM `{$table}` WHERE slug = ? AND tenant_id = ?", [$slug, $tenantId])) {
            $counter++;
            $slug = $originalSlug . '-' . $counter;
        }
        return $slug;
    }

    private function validatedPageDesignJson(string $contentFormat, mixed $designJson): string|null|JsonResponse
    {
        if ($contentFormat !== 'builder') {
            return null;
        }

        if ($designJson === null || $designJson === '') {
            return null;
        }

        if (!is_string($designJson)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_design_json'), 'design_json', 422);
        }

        if (strlen($designJson) > self::PAGE_DESIGN_JSON_MAX_BYTES) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.design_json_too_large'), 'design_json', 422);
        }

        try {
            $decoded = json_decode($designJson, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_design_json'), 'design_json', 422);
        }

        if (!is_array($decoded) || !$this->isPlausiblePageDesignProject($decoded)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_design_json'), 'design_json', 422);
        }

        return $designJson;
    }

    private function isPlausiblePageDesignProject(array $project): bool
    {
        if (array_is_list($project)) {
            return false;
        }

        $knownKeys = ['pages', 'assets', 'styles', 'symbols', 'dataSources', 'custom', 'components', 'css'];
        if (count(array_intersect(array_keys($project), $knownKeys)) === 0) {
            return false;
        }

        foreach (['pages', 'assets', 'styles', 'symbols', 'dataSources'] as $listKey) {
            if (array_key_exists($listKey, $project) && !is_array($project[$listKey])) {
                return false;
            }
        }

        if (isset($project['pages']) && is_array($project['pages'])) {
            foreach ($project['pages'] as $page) {
                if (!is_array($page) || array_is_list($page)) {
                    return false;
                }
                if (isset($page['frames']) && !is_array($page['frames'])) {
                    return false;
                }
            }
        }

        return true;
    }

    private function buildMenuItemTree(int $menuId): array
    {
        $items = array_map(fn($r) => (array)$r, DB::select(
            "SELECT id, menu_id, parent_id, type, label, url, route_name, page_id, icon, css_class, target, sort_order, visibility_rules, is_active, created_at, updated_at
             FROM menu_items WHERE menu_id = ? ORDER BY sort_order ASC, id ASC",
            [$menuId]
        ));

        foreach ($items as &$item) {
            if (isset($item['visibility_rules']) && $item['visibility_rules']) {
                $item['visibility_rules'] = json_decode($item['visibility_rules'], true);
            }
        }
        unset($item);

        $indexed = [];
        foreach ($items as &$item) {
            $item['children'] = [];
            $indexed[$item['id']] = &$item;
        }
        unset($item);

        $tree = [];
        foreach ($indexed as &$item) {
            if (!empty($item['parent_id']) && isset($indexed[$item['parent_id']])) {
                $indexed[$item['parent_id']]['children'][] = &$item;
            } else {
                $tree[] = &$item;
            }
        }
        unset($item);

        return $tree;
    }
}
