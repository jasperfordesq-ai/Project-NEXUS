<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use App\Core\TenantContext;
use App\Models\ActivityLog;
use App\Models\Page;
use App\Services\PageContentPolicy;
use App\Services\RedisCache;
use App\Services\PrerenderContentInvalidator;
use App\Services\BillingStandingService;
use App\Services\StripeSubscriptionService;
use App\Support\Billing\PlanTerms;

/**
 * AdminContentController -- Content moderation, pages, menus, plans, subscriptions.
 *
 * Converted from legacy delegation to direct DB calls.
 */
class AdminContentController extends BaseApiController
{
    protected bool $isV2Api = true;
    private const PAGE_DESIGN_JSON_MAX_BYTES = 2_000_000;

    /**
     * Where a published page may appear: the About menu or the header column of
     * the More menu. The Footer placement was retired on 2026-10-17 (owner
     * decision); see the 2026_10_17_120000_retire_footer_page_placement migration.
     */
    private const MENU_LOCATIONS = ['about', 'header'];

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
        // A supplied slug must already be a clean address; only a derived one is generated.
        if ($slugInput !== '' && !$this->isValidSlug($slugInput)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.slug_invalid'), 'slug', 422);
        }
        $slug = $this->generateSlug($slugInput !== '' ? $slugInput : $title);
        $content = $input['content'] ?? '';
        $contentFormat = $input['content_format'] ?? 'richtext';
        $designJson = $input['design_json'] ?? null;
        $metaDescription = $input['meta_description'] ?? '';
        $status = $input['status'] ?? 'draft';
        $sortOrder = (int)($input['sort_order'] ?? 0);
        $showInMenu = (int)($input['show_in_menu'] ?? 0);
        $menuLocation = $input['menu_location'] ?? 'about';
        if (!in_array($menuLocation, self::MENU_LOCATIONS, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.menu_location_invalid'), 'menu_location', 422);
        }
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

        // A page that links to member profiles is hidden from the public, so refuse it here.
        if (PageContentPolicy::linksToMemberProfiles([
            'content' => (string) $content,
            'design_json' => $contentFormat === 'builder' ? $designJson : null,
            'tenant_id' => $tenantId,
        ])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.page_links_member_profiles'), 'content', 422);
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
        // An empty slug on update means "no change".
        if (isset($input['slug']) && trim((string) $input['slug']) !== '') {
            $slugInput = trim((string) $input['slug']);
            if (!$this->isValidSlug($slugInput)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.slug_invalid'), 'slug', 422);
            }
            $slug = $this->generateSlug($slugInput);
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
        if (array_key_exists('content', $data) || array_key_exists('design_json', $data)) {
            // A page that links to member profiles is hidden from the public, so refuse it here.
            // No id is passed: stored blocks the editor cannot remove must not lock the page.
            if (PageContentPolicy::linksToMemberProfiles([
                'content' => (string) ($data['content'] ?? ''),
                'design_json' => $data['design_json'] ?? null,
                'tenant_id' => $tenantId,
            ])) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.page_links_member_profiles'), 'content', 422);
            }
        } elseif (($input['status'] ?? null) === 'published') {
            // Publishing by status alone must check what is already stored, or a legacy
            // page that links to member profiles could be published without an edit.
            $stored = DB::table('pages')->where('id', $id)->where('tenant_id', $tenantId)->first(['content', 'design_json']);
            if ($stored && PageContentPolicy::linksToMemberProfiles([
                'content' => (string) ($stored->content ?? ''),
                'design_json' => $stored->design_json ?? null,
                'tenant_id' => $tenantId,
            ])) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.page_links_member_profiles'), 'content', 422);
            }
        }
        if (isset($input['status'])) {
            if (!in_array($input['status'], ['draft', 'published'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.status_must_be_draft_or_published'), 'status', 422);
            }
            $data['is_published'] = ($input['status'] === 'published') ? 1 : 0;
        }
        if (isset($input['sort_order'])) { $data['sort_order'] = (int)$input['sort_order']; }
        if (isset($input['show_in_menu'])) { $data['show_in_menu'] = (int)$input['show_in_menu']; }
        if (isset($input['menu_location'])) {
            if (!in_array($input['menu_location'], self::MENU_LOCATIONS, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.menu_location_invalid'), 'menu_location', 422);
            }
            $data['menu_location'] = $input['menu_location'];
        }
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
        $this->requireGodPlatformAdmin();
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
        $this->requireGodPlatformAdmin();
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
        $this->requireGodPlatformAdmin();
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
        $this->requireGodPlatformAdmin();
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
        $adminId = $this->requireGodPlatformAdmin();
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
        $this->requireGodPlatformAdmin();
        $tenantId = TenantContext::getId();
        $menuId = (int) $menuId;

        if ($menuId < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_menu_id'), 'id', 400); }

        $menu = DB::selectOne("SELECT id FROM menus WHERE id = ? AND tenant_id = ?", [$menuId, $tenantId]);
        if (!$menu) { return $this->respondWithError('NOT_FOUND', __('api.menu_not_found'), 'id', 404); }

        return $this->respondWithData($this->buildMenuItemTree($menuId));
    }

    public function createMenuItem($menuId): JsonResponse
    {
        $this->requireGodPlatformAdmin();
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
        $this->requireGodPlatformAdmin();
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
        $this->requireGodPlatformAdmin();
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
        $this->requireGodPlatformAdmin();
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

    /**
     * What every plan endpoint answers with, so GET one, POST and PUT carry
     * exactly the fields the list does and the edit form can read any of them.
     */
    private const PLAN_COLUMNS = 'pp.id, pp.name, pp.slug, pp.description, pp.tier_level, pp.features,
                    pp.max_menus, pp.max_menu_items, pp.max_users, pp.price_monthly, pp.price_yearly,
                    pp.is_active, pp.stripe_product_id, pp.stripe_price_id_monthly, pp.stripe_price_id_yearly,
                    pp.stripe_price_id_monthly_gbp, pp.stripe_price_id_yearly_gbp,
                    pp.created_at, pp.updated_at,
                    pp.is_standard, pp.price_monthly_gbp, pp.price_yearly_gbp, pp.setup_fee, pp.setup_fee_gbp,
                    pp.max_communities, pp.storage_gb, pp.emails_per_month,
                    (SELECT COUNT(*) FROM tenant_plan_assignments tpa WHERE tpa.pay_plan_id = pp.id AND tpa.status IN (\'active\',\'trial\')) AS tenant_count';

    /** Money fields: a number of 0 or more, or empty. */
    private const PLAN_MONEY_FIELDS = [
        'price_monthly', 'price_yearly', 'setup_fee',
        'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp',
    ];

    /** Recorded and shown, never enforced: a whole number, or empty (no limit). */
    private const PLAN_ALLOWANCE_FIELDS = ['max_communities', 'storage_gb', 'emails_per_month'];

    /**
     * The smallest value each allowance accepts (0 when not listed). A plan
     * including no community at all makes no sense; empty means unlimited.
     */
    private const PLAN_ALLOWANCE_MINIMUM = ['max_communities' => 1];

    /** Columns that cannot hold null; an empty value there means 0. */
    private const PLAN_NOT_NULL_MONEY = ['setup_fee'];

    /**
     * @return list<array<string, mixed>>
     */
    private function readPlans(?int $id = null): array
    {
        $rows = $id === null
            ? DB::select('SELECT ' . self::PLAN_COLUMNS . ' FROM pay_plans pp ORDER BY pp.tier_level ASC, pp.name ASC')
            : DB::select('SELECT ' . self::PLAN_COLUMNS . ' FROM pay_plans pp WHERE pp.id = ?', [$id]);

        $plans = array_map(fn($r) => (array) $r, $rows);
        foreach ($plans as &$plan) {
            if (isset($plan['features'])) { $plan['features'] = json_decode($plan['features'], true) ?: []; }
            $plan['stripe_synced'] = !empty($plan['stripe_product_id']);
            $plan['tenant_count'] = (int) $plan['tenant_count'];
            $plan['is_standard'] = (bool) $plan['is_standard'];
            foreach (self::PLAN_ALLOWANCE_FIELDS as $allowance) {
                $plan[$allowance] = $plan[$allowance] !== null ? (int) $plan[$allowance] : null;
            }
        }
        unset($plan);

        return $plans;
    }

    /**
     * Validate the plan fields present in $input and map them to columns.
     * Create and update share it, so both accept and refuse the same things.
     * Name and slug are handled by each caller (create requires a name and
     * makes the slug; update checks a changed slug is free).
     *
     * @param array<string, mixed> $input
     * @return array<string, mixed>|JsonResponse column => value, or the refusal
     */
    private function planFields(array $input): array|JsonResponse
    {
        $columns = [];

        if (array_key_exists('description', $input)) {
            if (is_string($input['description']) && mb_strlen($input['description']) > PlanTerms::MAX_DESCRIPTION_LENGTH) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.plan_text_too_long', ['field' => __('api.plan_field_description'), 'max' => PlanTerms::MAX_DESCRIPTION_LENGTH]), 'description', 422);
            }
            $columns['description'] = $input['description'];
        }
        if (isset($input['tier_level'])) { $columns['tier_level'] = (int) $input['tier_level']; }
        if (array_key_exists('features', $input)) { $columns['features'] = json_encode($input['features'] ?? []); }
        if (isset($input['max_menus'])) { $columns['max_menus'] = (int) $input['max_menus']; }
        if (isset($input['max_menu_items'])) { $columns['max_menu_items'] = (int) $input['max_menu_items']; }
        if (isset($input['is_active'])) { $columns['is_active'] = (int) $input['is_active']; }

        if (array_key_exists('max_users', $input)) {
            $value = $input['max_users'];
            if ($value === null || $value === '') {
                $columns['max_users'] = null;
            } else {
                $number = filter_var($value, FILTER_VALIDATE_INT);
                if ($number === false || $number < 1) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.plan_member_number_invalid', ['field' => __('api.plan_field_max_users')]), 'max_users', 422);
                }
                if ($number > PlanTerms::MAX_MEMBER_NUMBER) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.plan_value_too_large', ['field' => __('api.plan_field_max_users'), 'max' => PlanTerms::MAX_MEMBER_NUMBER]), 'max_users', 422);
                }
                $columns['max_users'] = $number;
            }
        }

        foreach (self::PLAN_MONEY_FIELDS as $field) {
            if (!array_key_exists($field, $input)) { continue; }
            $value = $input[$field];
            if ($value === null || $value === '') {
                $columns[$field] = in_array($field, self::PLAN_NOT_NULL_MONEY, true) ? 0.0 : null;
                continue;
            }
            if (!is_numeric($value) || (float) $value < 0 || !is_finite((float) $value)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.plan_price_invalid', ['field' => __("api.plan_field_{$field}")]), $field, 422);
            }
            if (round((float) $value, 2) > PlanTerms::MAX_MONEY) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.plan_value_too_large', ['field' => __("api.plan_field_{$field}"), 'max' => PlanTerms::MAX_MONEY]), $field, 422);
            }
            $columns[$field] = round((float) $value, 2);
        }

        foreach (self::PLAN_ALLOWANCE_FIELDS as $field) {
            if (!array_key_exists($field, $input)) { continue; }
            $value = $input[$field];
            if ($value === null || $value === '') {
                $columns[$field] = null;
                continue;
            }
            $number = filter_var($value, FILTER_VALIDATE_INT);
            $minimum = self::PLAN_ALLOWANCE_MINIMUM[$field] ?? 0;
            if ($number === false || $number < $minimum) {
                // Named in the reader's words: the column name means nothing to them.
                // "1 or more, or empty for no limit" is the member-number wording,
                // which says exactly what a minimum of 1 means here too.
                $key = $minimum >= 1 ? 'api.plan_member_number_invalid' : 'api.plan_allowance_invalid';

                return $this->respondWithError('VALIDATION_ERROR', __($key, ['field' => __("api.plan_field_{$field}")]), $field, 422);
            }
            $columns[$field] = $number;
        }

        return $columns;
    }

    private function planNameTooLong(): JsonResponse
    {
        return $this->respondWithError('VALIDATION_ERROR', __('api.plan_text_too_long', ['field' => __('api.plan_field_name'), 'max' => PlanTerms::MAX_NAME_LENGTH]), 'name', 422);
    }

    public function getPlans(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData($this->readPlans());
    }

    public function syncPlanToStripe($id): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        $existing = DB::selectOne("SELECT id FROM pay_plans WHERE id = ?", [$id]);
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        try {
            StripeSubscriptionService::syncPlanToStripe($id);
            // The Sync button is also the retry for a price change that
            // failed when the plan was saved: compare every stored price with
            // Stripe and replace or retire what differs. Never throws.
            $priceChanges = StripeSubscriptionService::reconcilePlanPrices($id);
            $plan = DB::selectOne(
                "SELECT stripe_product_id, stripe_price_id_monthly, stripe_price_id_yearly,
                        stripe_price_id_monthly_gbp, stripe_price_id_yearly_gbp
                 FROM pay_plans WHERE id = ?",
                [$id]
            );
            // The unsuffixed price ids are the euro ones.
            return $this->respondWithData([
                'synced'                      => true,
                'stripe_product_id'           => $plan->stripe_product_id ?? null,
                'stripe_price_id_monthly'     => $plan->stripe_price_id_monthly ?? null,
                'stripe_price_id_yearly'      => $plan->stripe_price_id_yearly ?? null,
                'stripe_price_id_monthly_gbp' => $plan->stripe_price_id_monthly_gbp ?? null,
                'stripe_price_id_yearly_gbp'  => $plan->stripe_price_id_yearly_gbp ?? null,
                'price_changes'               => $priceChanges,
            ]);
        } catch (\Exception $e) {
            Log::warning('Manual Stripe sync failed', ['plan_id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('STRIPE_ERROR', __('api.stripe_plan_sync_failed'), null, 500);
        }
    }

    public function getPlan($id): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        $plan = $this->readPlans($id)[0] ?? null;
        if ($plan === null) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        return $this->respondWithData($plan);
    }

    public function createPlan(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        $input = $this->getAllInput();
        $name = trim($input['name'] ?? '');
        if (empty($name)) { return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 422); }
        if (mb_strlen($name) > PlanTerms::MAX_NAME_LENGTH) { return $this->planNameTooLong(); }

        $fields = $this->planFields($input);
        if ($fields instanceof JsonResponse) { return $fields; }

        $slug = $this->generateSlug($name);
        $counter = 0;
        $originalSlug = $slug;
        while (DB::selectOne("SELECT id FROM pay_plans WHERE slug = ?", [$slug])) {
            $counter++;
            $slug = $originalSlug . '-' . $counter;
        }

        // Defaults as the create endpoint has always applied them; anything
        // sent overrides them.
        $columns = array_merge([
            'description' => '',
            'tier_level' => 0,
            'features' => '[]',
            'max_menus' => null,
            'max_menu_items' => null,
            'max_users' => null,
            'price_monthly' => null,
            'price_yearly' => null,
            'is_active' => 1,
        ], $fields, ['name' => $name, 'slug' => $slug]);
        if (($columns['description'] ?? null) === null) { $columns['description'] = ''; }

        DB::insert(
            'INSERT INTO pay_plans (' . implode(', ', array_keys($columns)) . ', created_at, updated_at)
             VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ', NOW(), NOW())',
            array_values($columns)
        );

        $newPlanId = (int) DB::getPdo()->lastInsertId();
        PlanTerms::flush();

        // Sync to Stripe (non-blocking — don't fail plan creation if Stripe is unreachable)
        try {
            StripeSubscriptionService::syncPlanToStripe($newPlanId);
        } catch (\Exception $e) {
            Log::warning('Stripe sync failed after plan creation', [
                'plan_id' => $newPlanId,
                'error' => $e->getMessage(),
            ]);
        }

        // A new plan has no stored Stripe price to replace, so nothing can
        // fail here; the key is sent so create and update answer alike.
        $plan = $this->readPlans($newPlanId)[0] ?? [];
        $plan['stripe_price_warnings'] = [];

        return $this->respondWithData($plan, null, 201);
    }

    /**
     * A changed default member number is new terms for every community on
     * the plan that is held to it, so their days over start again (hub plans
     * DESIGN 6.4). Not for a community whose hub set its own number for this
     * plan: that number has not changed.
     */
    private function restartLimitClockForDefaultMemberNumber(int $planId, ?int $before): void
    {
        $after = DB::table('pay_plans')->where('id', $planId)->value('max_users');
        $after = $after !== null ? (int) $after : null;
        if ($after === $before) {
            return;
        }

        $onPlan = DB::table('tenant_plan_assignments')
            ->where('pay_plan_id', $planId)
            ->whereIn('status', ['active', 'trial'])
            ->distinct()
            ->pluck('tenant_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();

        // A hub's own number for this plan comes through applyHubChanges();
        // asked with no default number, only those held to the default
        // still come back with none.
        $followDefault = array_values(array_filter(
            $onPlan,
            static fn (int $tenantId): bool => PlanTerms::applyHubChanges($tenantId, $planId, ['max_users' => null])['values']['max_users'] === null
        ));

        BillingStandingService::restartLimitClock($followDefault);
    }

    public function updatePlan($id): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        // Read in full before the update: which amounts changed, and which
        // already had a Stripe price, decide what is replaced in Stripe.
        $before = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$id]);
        if (!$before) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        $input = $this->getAllInput();
        $columns = [];

        if (isset($input['name'])) {
            $columns['name'] = trim((string) $input['name']);
            if (mb_strlen($columns['name']) > PlanTerms::MAX_NAME_LENGTH) { return $this->planNameTooLong(); }
        }
        if (isset($input['slug'])) {
            $slug = $this->generateSlug($input['slug']);
            $conflict = DB::selectOne("SELECT id FROM pay_plans WHERE slug = ? AND id != ?", [$slug, $id]);
            if ($conflict) { return $this->respondWithError('VALIDATION_ERROR', __('api.slug_already_in_use'), 'slug', 422); }
            $columns['slug'] = $slug;
        }

        $fields = $this->planFields($input);
        if ($fields instanceof JsonResponse) { return $fields; }
        $columns = array_merge($columns, $fields);

        if (empty($columns)) { return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422); }

        $updates = array_map(static fn (string $column): string => "{$column} = ?", array_keys($columns));
        $updates[] = 'updated_at = NOW()';
        $params = array_values($columns);
        $params[] = $id;

        DB::update("UPDATE pay_plans SET " . implode(', ', $updates) . " WHERE id = ?", $params);
        PlanTerms::flush();

        if (array_key_exists('max_users', $columns)) {
            $this->restartLimitClockForDefaultMemberNumber($id, $before->max_users !== null ? (int) $before->max_users : null);
        }

        // Sync to Stripe (non-blocking — don't fail plan update if Stripe is unreachable)
        try {
            StripeSubscriptionService::syncPlanToStripe($id);
        } catch (\Exception $e) {
            Log::warning('Stripe sync failed after plan update', [
                'plan_id' => $id,
                'error' => $e->getMessage(),
            ]);
        }

        // The sync never replaces a stored price, so an amount this update
        // changed gets a new Stripe price here (or, taken to 0, loses its
        // price). Each one on its own: Stripe refusing one leaves its old
        // price in place, the plan saved, and the failure in the response so
        // the platform team knows to press Sync, which retries it.
        $warnings = [];
        foreach (StripeSubscriptionService::PRICE_COLUMNS as $currency => $intervals) {
            foreach ($intervals as $interval => $priceColumns) {
                $amountColumn = $priceColumns['amount'];
                $hadPrice = !empty($before->{$priceColumns['price_id']});
                if (!$hadPrice || !array_key_exists($amountColumn, $fields)) { continue; }

                $oldAmount = round((float) ($before->{$amountColumn} ?? 0), 2);
                $newAmount = round((float) ($fields[$amountColumn] ?? 0), 2);
                if ($oldAmount === $newAmount) { continue; }

                try {
                    StripeSubscriptionService::replacePlanPrice($id, $currency, $interval);
                } catch (\Exception $e) {
                    Log::error('Stripe price replacement failed after plan update; card checkout still charges the old price', [
                        'plan_id' => $id,
                        'currency' => $currency,
                        'interval' => $interval,
                        'error' => $e->getMessage(),
                    ]);
                    $warnings[] = ['currency' => $currency, 'interval' => $interval];
                }
            }
        }

        $plan = $this->readPlans($id)[0] ?? [];
        $plan['stripe_price_warnings'] = $warnings;

        return $this->respondWithData($plan);
    }

    public function deletePlan($id): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $id = (int) $id;

        if ($id < 1) { return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'id', 400); }

        $existing = DB::selectOne("SELECT id FROM pay_plans WHERE id = ?", [$id]);
        if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'id', 404); }

        $activeAssignments = DB::selectOne("SELECT COUNT(*) AS cnt FROM tenant_plan_assignments WHERE pay_plan_id = ? AND status = 'active'", [$id]);
        if ($activeAssignments && (int)$activeAssignments->cnt > 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.plan_has_active_assignments', ['count' => $activeAssignments->cnt]), 'id', 422);
        }

        // Every plan record points at its plan, the ended ones too: they are
        // the history of what a community was on. Only active records were
        // counted, so deleting a plan with an expired, cancelled or trial
        // record behind it ran into the database's own refusal and answered
        // with a server error. Said plainly instead: switch the plan off.
        $anyRecord = DB::selectOne("SELECT COUNT(DISTINCT tenant_id) AS cnt FROM tenant_plan_assignments WHERE pay_plan_id = ?", [$id]);
        if ($anyRecord && (int) $anyRecord->cnt > 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.plan_has_history', ['count' => (int) $anyRecord->cnt]), 'id', 422);
        }

        DB::transaction(static function () use ($id): void {
            // What hung off the plan and would otherwise be left pointing at nothing.
            DB::delete("DELETE FROM hub_plan_terms WHERE pay_plan_id = ?", [$id]);
            DB::delete("DELETE FROM pay_plan_stripe_prices WHERE pay_plan_id = ?", [$id]);
            DB::delete("DELETE FROM pay_plans WHERE id = ?", [$id]);
        });
        PlanTerms::flush();

        return $this->respondWithData(['deleted' => true]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private function generateSlug(string $value): string
    {
        $slug = Str::slug($value);

        // A title with no Latin form (e.g. Japanese) transliterates to nothing.
        return $slug !== '' ? $slug : 'page-' . substr(bin2hex(random_bytes(4)), 0, 6);
    }

    private function isValidSlug(string $slug): bool
    {
        return preg_match('/^[a-z0-9-]+$/', $slug) === 1;
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
