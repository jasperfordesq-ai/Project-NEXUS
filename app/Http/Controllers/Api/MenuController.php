<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\MenuManager;

/**
 * MenuController — Navigation menu management.
 *
 * Native implementation using MenuManager (which itself handles DB queries,
 * caching, and feature-gated visibility). No legacy delegation.
 */
class MenuController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/menus
     *
     * Get all menus for current tenant and layout.
     * Auth is optional — menus are available to guests too.
     */
    public function index(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        if (!$tenantId) {
            return $this->respondWithError('TENANT_NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }

        $layout = $this->query('layout');
        $location = $this->query('location');

        try {
            if ($location) {
                $menus = MenuManager::getMenu($location, $layout, true);
            } else {
                $locations = [
                    MenuManager::LOCATION_HEADER_MAIN,
                    MenuManager::LOCATION_HEADER_SECONDARY,
                    MenuManager::LOCATION_FOOTER,
                    MenuManager::LOCATION_MOBILE,
                ];

                $allMenus = [];
                foreach ($locations as $loc) {
                    $locMenus = MenuManager::getMenu($loc, $layout, true);
                    if (!empty($locMenus)) {
                        $allMenus[$loc] = $locMenus;
                    }
                }
                $menus = $allMenus;
            }

            return $this->respondWithData($menus, [
                'tenant_id' => $tenantId,
                'layout'    => $layout,
                'location'  => $location,
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('MENU_LOAD_FAILED', __('api.fetch_failed', ['resource' => 'menus']), null, 500);
        }
    }

    /**
     * GET /api/menus/{slug}
     *
     * Get a specific menu by slug.
     * Auth is optional — menus are available to guests too.
     */
    public function show(string $slug): JsonResponse
    {
        $tenantId = $this->getTenantId();
        if (!$tenantId) {
            return $this->respondWithError('TENANT_NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }

        $layout = $this->query('layout');

        try {
            $menu = MenuManager::getMenuBySlug($slug, $layout, true);

            if (!$menu) {
                return $this->respondWithError('MENU_NOT_FOUND', __('api.menu_not_found'), null, 404);
            }

            return $this->respondWithData($menu, [
                'tenant_id' => $tenantId,
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('MENU_LOAD_FAILED', __('api.fetch_failed', ['resource' => 'menu']), null, 500);
        }
    }

    /**
     * GET /api/menus/config
     *
     * Get menu configuration.
     * Auth is optional — config is available to guests too.
     */
    public function config(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        if (!$tenantId) {
            return $this->respondWithError('TENANT_NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }

        return $this->respondWithData([
            'tenant_id'           => $tenantId,
            'available_locations' => [
                'header-main'      => 'Header - Main Navigation',
                'header-secondary' => 'Header - Secondary Navigation',
                'footer'           => 'Footer',
                'sidebar'          => 'Sidebar',
                'mobile'           => 'Mobile Menu',
            ],
        ]);
    }

    /**
     * GET /api/menus/mobile
     *
     * Optimized endpoint for mobile apps — returns simplified menu structure.
     * Auth is optional — mobile menus are available to guests too.
     */
    public function mobile(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        if (!$tenantId) {
            return $this->respondWithError('TENANT_NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }

        try {
            // Get mobile-specific menu or fallback to header-main
            $mobileMenu = MenuManager::getMenu(MenuManager::LOCATION_MOBILE, null, true);

            if (empty($mobileMenu)) {
                $mobileMenu = MenuManager::getMenu(MenuManager::LOCATION_HEADER_MAIN, null, true);
            }

            // Simplify structure for mobile.
            // 🔴 `id` is optional: MenuManager's built-in fallback menus
            // (getDefaultMobileMenu / getOriginalNavigation) are hand-written
            // arrays, not database rows, so they carry no id. Reading the key
            // unguarded raised an ErrorException that this method's own
            // catch turned into a 500 for every caller (F-439).
            $simplified = [];
            foreach ($mobileMenu as $menu) {
                foreach ($menu['items'] as $item) {
                    $simplified[] = [
                        'id'       => $item['id'] ?? null,
                        'label'    => $item['label'],
                        'icon'     => $item['icon'] ?? null,
                        'url'      => $item['url'] ?? '#',
                        'type'     => $item['type'],
                        'children' => $this->simplifyChildren($item['children'] ?? []),
                    ];
                }
            }

            return $this->respondWithData($simplified, [
                'tenant_id' => $tenantId,
                'cache_key' => md5(json_encode($simplified)),
            ]);
        } catch (\Throwable $e) {
            return $this->respondWithError('MOBILE_MENU_LOAD_FAILED', __('api.fetch_failed', ['resource' => 'mobile menu']), null, 500);
        }
    }

    /**
     * POST /api/menus/clear-cache
     *
     * Clear menu cache (admin only).
     */
    public function clearCache(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            MenuManager::clearCache($tenantId);

            return $this->respondWithData(['message' => __('api_controllers_2.menu.cache_cleared')]);
        } catch (\Throwable $e) {
            return $this->respondWithError('CACHE_CLEAR_FAILED', __('api.failed_to_clear_cache'), null, 500);
        }
    }

    /**
     * Helper: Simplify child items for mobile.
     */
    private function simplifyChildren(array $children): array
    {
        $simplified = [];
        foreach ($children as $child) {
            $simplified[] = [
                'id'    => $child['id'] ?? null,
                'label' => $child['label'],
                'icon'  => $child['icon'] ?? null,
                'url'   => $child['url'] ?? '#',
                'type'  => $child['type'],
            ];
        }
        return $simplified;
    }
}
