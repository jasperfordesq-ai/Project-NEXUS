<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use App\Models\Menu;
use App\Models\MenuItem;
use App\Models\PayPlan;
use Illuminate\Support\Facades\DB;

/**
 * MenuManager - Tenant-aware, Pay Layout-aware Menu System.
 *
 *
 * Provides:
 * - Custom menu management (DB-driven)
 * - Default fallback menus (built-in)
 * - Page-builder menu pages (from pages table)
 * - Pay plan restrictions
 * - Layout-specific menus
 * - Advanced visibility rules
 * - Menu caching
 */
class MenuManager
{
    /**
     * Menu location constants
     */
    const LOCATION_HEADER_MAIN = 'header-main';
    const LOCATION_HEADER_SECONDARY = 'header-secondary';
    const LOCATION_FOOTER = 'footer';
    const LOCATION_SIDEBAR = 'sidebar';
    const LOCATION_MOBILE = 'mobile';

    // Legacy support
    const MENU_ABOUT = 'about';
    const MENU_MAIN = 'main';
    const MENU_FOOTER = 'footer';

    /**
     * Get menu for a specific location and layout.
     *
     * @param string $location Menu location
     * @param string|null $layout Current layout (modern)
     * @param bool $useCache Whether to use cached menus
     * @return array Hierarchical menu structure
     */
    public static function getMenu($location, $layout = null, $useCache = true)
    {
        // MASTER KILL SWITCH: Check if menu manager is enabled
        if (!self::isEnabled()) {
            return self::getOriginalNavigation($location, $layout);
        }

        $tenantId = TenantContext::getId();
        if (!$tenantId) {
            return [];
        }

        // Get current user and plan info
        $user = self::getCurrentUser();
        $userRole = $user['role'] ?? $_SESSION['user_role'] ?? 'guest';

        // Check cache first
        if ($useCache) {
            $cached = self::getFromCache($tenantId, $location, $layout, $userRole);
            if ($cached !== null) {
                return $cached;
            }
        }

        // Get tenant's features for visibility filtering
        $tenantFeatures = self::getTenantModuleFeatures($tenantId);

        // Get menus for this location/layout
        $menus = self::queryMenusByLocation($location, $layout, $tenantId);

        if (empty($menus)) {
            // Use default platform menu if available
            $defaultMenu = self::getDefaultMenu($location, TenantContext::getBasePath());
            if (!empty($defaultMenu)) {
                return [$defaultMenu];
            }

            // Fallback to pages-table menu for backwards compatibility
            return self::getLegacyMenu($location);
        }

        // Build menu structure
        $menuData = [];
        foreach ($menus as $menu) {
            // Check plan tier requirement
            $currentTier = self::queryTierLevel($tenantId);
            if ($menu['min_plan_tier'] > $currentTier) {
                continue; // Skip menus requiring higher tier
            }

            // Get menu items
            $items = self::queryMenuItems($menu['id'], true);

            // Filter by visibility rules
            $filteredItems = self::filterVisibleItems($items, $user, $tenantFeatures);

            // Resolve URLs
            $basePath = TenantContext::getBasePath();
            $filteredItems = self::resolveItemUrls($filteredItems, $basePath);

            $menuData[] = [
                'id' => $menu['id'],
                'name' => $menu['name'],
                'slug' => $menu['slug'],
                'location' => $menu['location'],
                'items' => $filteredItems
            ];
        }

        // Cache the result
        if ($useCache) {
            self::saveToCache($tenantId, $location, $layout, $userRole, $menuData);
        }

        return $menuData;
    }

    /**
     * Get a single menu by slug.
     */
    public static function getMenuBySlug($slug, $layout = null, $useCache = true)
    {
        $tenantId = TenantContext::getId();

        $menu = DB::table('menus')
            ->where('slug', $slug)
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->first();

        if (!$menu) {
            return null;
        }

        $menu = (array) $menu;

        $user = self::getCurrentUser();
        $tenantFeatures = self::getTenantModuleFeatures($tenantId);

        // Get items
        $items = self::queryMenuItems($menu['id'], true);
        $filteredItems = self::filterVisibleItems($items, $user, $tenantFeatures);

        $basePath = TenantContext::getBasePath();
        $filteredItems = self::resolveItemUrls($filteredItems, $basePath);

        return [
            'id' => $menu['id'],
            'name' => $menu['name'],
            'slug' => $menu['slug'],
            'location' => $menu['location'],
            'items' => $filteredItems
        ];
    }

    /**
     * Render menu as HTML.
     *
     * @param string $location Menu location
     * @param string|null $layout Current layout
     * @param string $cssClass CSS class for the menu container
     * @return string HTML markup
     */
    public static function renderMenu($location, $layout = null, $cssClass = 'menu')
    {
        $menus = self::getMenu($location, $layout);

        if (empty($menus)) {
            return '';
        }

        $html = '';
        foreach ($menus as $menu) {
            $html .= '<nav class="' . htmlspecialchars($cssClass) . '" data-menu-id="' . $menu['id'] . '">';
            $html .= '<ul>';
            $html .= self::renderMenuItems($menu['items']);
            $html .= '</ul>';
            $html .= '</nav>';
        }

        return $html;
    }

    /**
     * Render menu items recursively.
     */
    private static function renderMenuItems($items, $depth = 0)
    {
        $html = '';

        foreach ($items as $item) {
            $html .= '<li class="menu-item menu-item-' . $item['type'] . '">';

            if ($item['type'] === 'dropdown' && !empty($item['children'])) {
                $html .= '<details role="list">';
                $html .= '<summary aria-haspopup="listbox" role="link">';
                if ($item['icon']) {
                    $html .= '<i class="' . htmlspecialchars($item['icon']) . '"></i> ';
                }
                $html .= htmlspecialchars($item['label']);
                $html .= '</summary>';
                $html .= '<ul role="listbox">';
                $html .= self::renderMenuItems($item['children'], $depth + 1);
                $html .= '</ul>';
                $html .= '</details>';
            } elseif ($item['type'] === 'divider') {
                $html .= '<hr class="menu-divider">';
            } else {
                $target = $item['target'] ?? '_self';
                $cssClass = $item['css_class'] ?? '';

                $html .= '<a href="' . htmlspecialchars($item['url']) . '" target="' . $target . '" class="' . htmlspecialchars($cssClass) . '">';
                if ($item['icon']) {
                    $html .= '<i class="' . htmlspecialchars($item['icon']) . '"></i> ';
                }
                $html .= htmlspecialchars($item['label']);
                $html .= '</a>';
            }

            $html .= '</li>';
        }

        return $html;
    }

    /**
     * Resolve URLs for menu items recursively.
     */
    private static function resolveItemUrls($items, $basePath)
    {
        foreach ($items as &$item) {
            $item['url'] = self::resolveMenuItemUrl($item, $basePath);

            if (!empty($item['children'])) {
                $item['children'] = self::resolveItemUrls($item['children'], $basePath);
            }
        }

        return $items;
    }

    /**
     * Resolve URL for a single menu item.
     */
    private static function resolveMenuItemUrl(array $item, string $basePath): string
    {
        // If item has an explicit URL, use it
        if (!empty($item['url'])) {
            $url = $item['url'];
            // If it's a relative URL and doesn't start with basePath, prepend it
            if (strpos($url, '/') === 0 && strpos($url, $basePath) !== 0 && !empty($basePath)) {
                return $basePath . $url;
            }
            return $url;
        }

        // If item has a page_id, resolve the page slug
        if (!empty($item['page_id'])) {
            try {
                $page = DB::table('pages')->where('id', $item['page_id'])->first();
                if ($page) {
                    return $basePath . '/page/' . $page->slug;
                }
            } catch (\Exception $e) {
                // Fall through
            }
        }

        return '#';
    }

    /**
     * Get current user data.
     */
    private static function getCurrentUser()
    {
        if (!isset($_SESSION['user_id'])) {
            return null;
        }

        return [
            'id' => $_SESSION['user_id'],
            'role' => $_SESSION['user_role'] ?? 'user',
            'is_super_admin' => $_SESSION['is_super_admin'] ?? false,
            'is_tenant_super_admin' => $_SESSION['is_tenant_super_admin'] ?? false
        ];
    }

    // ---------------------------------------------------------------
    // Database query helpers (replacing legacy model static methods)
    // ---------------------------------------------------------------

    /**
     * Query menus by location (replaces Menu::getByLocation).
     */
    private static function queryMenusByLocation(string $location, ?string $layout, int $tenantId): array
    {
        $query = DB::table('menus')
            ->where('tenant_id', $tenantId)
            ->where('location', $location)
            ->where('is_active', 1);

        if ($layout !== null) {
            $query->where(function ($q) use ($layout) {
                $q->where('layout', $layout)
                  ->orWhereNull('layout');
            });
        }

        return array_map(function ($row) {
            return (array) $row;
        }, $query->orderBy('min_plan_tier')->get()->all());
    }

    /**
     * Query menu items by menu ID (replaces MenuItem::getByMenu).
     *
     * @param int $menuId
     * @param bool $hierarchical Build parent-child tree
     * @return array
     */
    private static function queryMenuItems(int $menuId, bool $hierarchical = false): array
    {
        $rows = DB::table('menu_items')
            ->where('menu_id', $menuId)
            ->where('is_active', 1)
            ->orderBy('sort_order')
            ->get()
            ->map(function ($row) {
                $item = (array) $row;
                if (isset($item['visibility_rules']) && is_string($item['visibility_rules'])) {
                    $item['visibility_rules'] = json_decode($item['visibility_rules'], true) ?? [];
                }
                $item['children'] = [];
                return $item;
            })
            ->all();

        if (!$hierarchical) {
            return $rows;
        }

        // Build tree
        $indexed = [];
        foreach ($rows as $item) {
            $indexed[$item['id']] = $item;
        }

        $tree = [];
        foreach ($indexed as &$item) {
            if (!empty($item['parent_id']) && isset($indexed[$item['parent_id']])) {
                $indexed[$item['parent_id']]['children'][] = &$item;
            } else {
                $tree[] = &$item;
            }
        }

        return $tree;
    }

    /**
     * Filter menu items by visibility rules (replaces MenuItem::filterVisible).
     */
    private static function filterVisibleItems(array $items, ?array $user, array $tenantFeatures): array
    {
        $filtered = [];

        foreach ($items as $item) {
            $rules = $item['visibility_rules'] ?? [];

            // Feature requirement. Accept both the legacy `require_feature` key
            // and the canonical `requires_feature` key — the latter is what the
            // React renderer (MenuNavItems), the admin VisibilityRulesEditor, and
            // TenantDefaultsSeeder all write, so server-side gating must honour it
            // too (otherwise feature-gated items leak on the mobile/prerender path).
            $requiredFeature = $rules['require_feature'] ?? $rules['requires_feature'] ?? null;
            if (!empty($requiredFeature) && empty($tenantFeatures[$requiredFeature])) {
                continue;
            }

            // Role requirement (legacy `require_role`). Note: the canonical
            // `min_role` ordered gate is intentionally NOT enforced here — the
            // server-side role vocabulary (member/admin/broker/moderator/…) does
            // not align with the ordered list the `min_role` editor uses, so an
            // ordered comparison would mis-gate. `min_role` is enforced
            // client-side by the React renderer; server-side we gate on the
            // unambiguous `requires_auth` / feature signals only.
            if (!empty($rules['require_role'])) {
                $requiredRole = $rules['require_role'];
                $currentRole = $user['role'] ?? 'guest';

                if ($requiredRole === 'admin' && !in_array($currentRole, ['admin', 'super_admin'])) {
                    continue;
                }
                if ($requiredRole === 'user' && $currentRole === 'guest') {
                    continue;
                }
            }

            // Auth requirement. Accept both `require_auth` and the canonical
            // `requires_auth`.
            if ((!empty($rules['require_auth']) || !empty($rules['requires_auth'])) && !$user) {
                continue;
            }
            if (!empty($rules['require_guest']) && $user) {
                continue;
            }

            // Recursively filter children
            if (!empty($item['children'])) {
                $item['children'] = self::filterVisibleItems($item['children'], $user, $tenantFeatures);
            }

            $filtered[] = $item;
        }

        return $filtered;
    }

    /**
     * Query current pay plan tier level for a tenant (replaces PayPlan::getTierLevel).
     */
    private static function queryTierLevel(int $tenantId): int
    {
        try {
            $tenant = DB::table('tenants')->where('id', $tenantId)->first(['pay_plan_id']);
            if (!$tenant || empty($tenant->pay_plan_id)) {
                return 0;
            }

            $plan = DB::table('pay_plans')->where('id', $tenant->pay_plan_id)->first(['tier_level']);
            return $plan ? (int) $plan->tier_level : 0;
        } catch (\Exception $e) {
            return 0;
        }
    }

    // ---------------------------------------------------------------
    // Cache management (using DB::table instead of Database::getConnection)
    // ---------------------------------------------------------------

    private static function getFromCache($tenantId, $location, $layout, $userRole)
    {
        try {
            $cacheKey = self::generateCacheKey($tenantId, $location, $layout, $userRole);

            $cache = DB::table('menu_cache')
                ->where('cache_key', $cacheKey)
                ->where(function ($q) {
                    $q->whereNull('expires_at')
                      ->orWhere('expires_at', '>', DB::raw('NOW()'));
                })
                ->first();

            if ($cache) {
                return json_decode($cache->cached_data, true);
            }

            return null;
        } catch (\Exception $e) {
            return null;
        }
    }

    private static function saveToCache($tenantId, $location, $layout, $userRole, $menuData)
    {
        try {
            $cacheKey = self::generateCacheKey($tenantId, $location, $layout, $userRole);
            $expiresAt = date('Y-m-d H:i:s', strtotime('+1 hour'));

            // Delete old cache entry
            DB::table('menu_cache')->where('cache_key', $cacheKey)->delete();

            // Insert new cache
            DB::table('menu_cache')->insert([
                'tenant_id'  => $tenantId,
                'layout'     => $layout,
                'location'   => $location,
                'user_role'  => $userRole,
                'cache_key'  => $cacheKey,
                'cached_data' => json_encode($menuData),
                'expires_at' => $expiresAt,
                'created_at' => DB::raw('NOW()'),
            ]);

            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    private static function generateCacheKey($tenantId, $location, $layout, $userRole)
    {
        return md5("menu:{$tenantId}:{$location}:{$layout}:{$userRole}");
    }

    /**
     * Clear menu cache for a tenant.
     */
    public static function clearCache($tenantId = null)
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        try {
            DB::table('menu_cache')->where('tenant_id', $tenantId)->delete();
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Legacy support - get menu pages from the pages table for a location.
     */
    private static function getLegacyMenu($location)
    {
        $legacyMap = [
            'header-main' => 'main',
            'footer' => 'footer',
            'about' => 'about'
        ];

        $legacyLocation = $legacyMap[$location] ?? $location;

        try {
            $pages = self::getMenuPages($legacyLocation);

            if (empty($pages)) {
                return [];
            }

            return [[
                'id' => 'legacy-' . $legacyLocation,
                'name' => ucfirst($legacyLocation) . ' (Legacy)',
                'slug' => 'legacy-' . $legacyLocation,
                'location' => $location,
                'items' => array_map(function ($page) {
                    return [
                        'type' => 'link',
                        'label' => $page['title'],
                        'url' => $page['url'],
                        'target' => '_self',
                        'icon' => null,
                        'css_class' => ''
                    ];
                }, $pages)
            ]];
        } catch (\Exception $e) {
            return [];
        }
    }

    /**
     * Get pages from the pages table for a specific menu location.
     *
     * @param string $location Menu location (about, main, footer)
     * @return array List of pages with title, slug, url
     */
    public static function getMenuPages(string $location = 'about'): array
    {
        try {
            $tenantId = TenantContext::getId();
            if (!$tenantId) {
                return [];
            }

            // Check if page builder module is enabled (gracefully handle missing column)
            try {
                $tenant = DB::table('tenants')
                    ->where('id', $tenantId)
                    ->first(['module_page_builder_enabled']);
                if ($tenant && empty($tenant->module_page_builder_enabled)) {
                    return [];
                }
            } catch (\Exception $e) {
                // Column doesn't exist - assume page builder is enabled by default
            }

            $basePath = TenantContext::getBasePath();

            // Fetch published pages for the specified menu location
            try {
                $pages = DB::table('pages')
                    ->where('tenant_id', $tenantId)
                    ->where('is_published', 1)
                    ->where('show_in_menu', 1)
                    ->where('menu_location', $location)
                    ->orderBy('sort_order')
                    ->orderBy('title')
                    ->get(['title', 'slug'])
                    ->map(function ($row) { return (array) $row; })
                    ->all();
            } catch (\Exception $e) {
                // Fallback: columns don't exist yet, show all published pages in About
                if ($location === 'about') {
                    $pages = DB::table('pages')
                        ->where('tenant_id', $tenantId)
                        ->where('is_published', 1)
                        ->orderBy('sort_order')
                        ->orderBy('title')
                        ->get(['title', 'slug'])
                        ->map(function ($row) { return (array) $row; })
                        ->all();
                } else {
                    $pages = [];
                }
            }

            // Add full URL to each page
            foreach ($pages as &$page) {
                $page['url'] = $basePath . '/page/' . $page['slug'];
            }

            return $pages;

        } catch (\Exception $e) {
            return [];
        }
    }

    /**
     * Render the "About" dropdown menu HTML for the current tenant.
     *
     * @return string HTML markup
     */
    public static function renderAboutMenu()
    {
        try {
            $tenantId = TenantContext::getId();
            if (!$tenantId) {
                return '';
            }

            $pages = self::getMenuPages('about');
            if (empty($pages)) {
                return '';
            }

            $basePath = TenantContext::getBasePath();
            $html = '<li>';
            $html .= '<details role="list" dir="rtl">';
            $html .= '<summary aria-haspopup="listbox" role="link">About</summary>';
            $html .= '<ul role="listbox">';

            foreach ($pages as $page) {
                $slug = htmlspecialchars($page['slug']);
                $title = htmlspecialchars($page['title']);
                $html .= "<li><a href=\"{$basePath}/page/{$slug}\">{$title}</a></li>";
            }

            $html .= '</ul>';
            $html .= '</details>';
            $html .= '</li>';

            return $html;
        } catch (\Exception $e) {
            return '';
        }
    }

    /**
     * Get pages for the main navigation bar.
     */
    public static function getMainNavPages()
    {
        return self::getMenuPages('main');
    }

    /**
     * Get pages for the footer.
     */
    public static function getFooterPages()
    {
        return self::getMenuPages('footer');
    }

    /**
     * Check if there are any pages for a menu location.
     */
    public static function hasMenuPages($location)
    {
        return !empty(self::getMenuPages($location));
    }

    /**
     * MASTER KILL SWITCH: Check if menu manager is enabled.
     */
    public static function isEnabled()
    {
        static $config = null;

        if ($config === null) {
            $configFile = __DIR__ . '/../../config/menu-manager.php';
            if (file_exists($configFile)) {
                $config = require $configFile;
            } else {
                $config = ['enabled' => false];
            }
        }

        // Check for admin override
        if (!empty($config['allow_admin_override'])) {
            if (isset($_GET['enable_menu_manager'])) {
                $_SESSION['menu_manager_override'] = (bool)$_GET['enable_menu_manager'];
            }
            if (isset($_SESSION['menu_manager_override'])) {
                return $_SESSION['menu_manager_override'];
            }
        }

        return $config['enabled'] ?? false;
    }

    /**
     * Get original navigation (fallback when menu manager is disabled).
     */
    private static function getOriginalNavigation($location, $layout = null)
    {
        $configFile = __DIR__ . '/../../config/menu-manager.php';
        $config = file_exists($configFile) ? require $configFile : [];
        $navClass = $config['original_nav_config'] ?? 'App\Config\Navigation';

        if (!class_exists($navClass)) {
            $defaultMenu = self::getDefaultMenu($location, TenantContext::getBasePath());
            if (!empty($defaultMenu)) {
                return [$defaultMenu];
            }
            return [];
        }

        $basePath = TenantContext::getBasePath();
        $items = [];

        switch ($location) {
            case 'header-main':
                $mainItems = $navClass::getMainNavItems();
                $exploreItems = $navClass::getExploreItems();

                foreach ($mainItems as $key => $item) {
                    if ($navClass::shouldShow($item)) {
                        $items[] = [
                            'type' => 'link',
                            'label' => $item['label'],
                            'url' => $item['url'],
                            'icon' => $item['icon'] ?? null,
                            'is_active' => 1
                        ];
                    }
                }

                $exploreChildren = [];
                foreach ($exploreItems as $key => $item) {
                    if ($navClass::shouldShow($item)) {
                        $childItem = [
                            'type' => 'link',
                            'label' => $item['label'],
                            'url' => $item['url'],
                            'icon' => $item['icon'] ?? null,
                            'is_active' => 1
                        ];

                        if (isset($item['color'])) {
                            $childItem['color'] = $item['color'];
                        }
                        if (isset($item['separator_before'])) {
                            $childItem['separator_before'] = $item['separator_before'];
                        }
                        if (isset($item['highlight'])) {
                            $childItem['highlight'] = $item['highlight'];
                        }

                        $exploreChildren[] = $childItem;
                    }
                }

                if (!empty($exploreChildren)) {
                    $items[] = [
                        'type' => 'dropdown',
                        'label' => 'Explore',
                        'icon' => 'fa-solid fa-compass',
                        'is_active' => 1,
                        'children' => $exploreChildren
                    ];
                }

                break;

            case 'footer':
                $items = [
                    ['type' => 'link', 'label' => 'Privacy Policy', 'url' => $basePath . '/privacy', 'is_active' => 1],
                    ['type' => 'link', 'label' => 'Terms of Service', 'url' => $basePath . '/terms', 'is_active' => 1],
                    ['type' => 'link', 'label' => 'Contact', 'url' => $basePath . '/contact', 'is_active' => 1],
                    ['type' => 'link', 'label' => 'Help', 'url' => $basePath . '/help', 'is_active' => 1]
                ];
                break;

            case 'mobile':
                $bottomNavItems = $navClass::getBottomNavItems();
                foreach ($bottomNavItems as $key => $item) {
                    $items[] = [
                        'type' => 'link',
                        'label' => $item['display_label'],
                        'url' => $item['url'],
                        'is_active' => 1
                    ];
                }
                break;
        }

        return [[
            'id' => 'original-nav-' . $location,
            'name' => 'Original Navigation',
            'slug' => 'original-nav',
            'location' => $location,
            'is_active' => 1,
            'items' => $items
        ]];
    }

    /**
     * Get menu manager configuration.
     */
    public static function getConfig()
    {
        $configFile = __DIR__ . '/../../config/menu-manager.php';
        return file_exists($configFile) ? require $configFile : [];
    }

    /**
     * Get tenant module features from tenants.features column.
     *
     * @param int|null $tenantId
     * @return array Feature flags keyed by module name
     */
    public static function getTenantModuleFeatures($tenantId = null)
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        if (!$tenantId) {
            return [];
        }

        // Get tenant record
        $tenant = TenantContext::get();
        if (!$tenant || (int)($tenant['id'] ?? 0) !== (int)$tenantId) {
            // Fetch directly if context doesn't match
            $row = DB::table('tenants')
                ->where('id', $tenantId)
                ->first(['features']);
            $featuresJson = $row->features ?? '{}';
        } else {
            $featuresJson = $tenant['features'] ?? '{}';
        }

        $features = is_string($featuresJson)
            ? json_decode($featuresJson, true)
            : $featuresJson;

        if (!is_array($features)) {
            $features = [];
        }

        $moduleDefaults = [
            'listings' => true,
            'groups' => true,
            'wallet' => true,
            'volunteering' => true,
            'events' => true,
            'resources' => true,
            'polls' => true,
            'goals' => true,
            'blog' => true,
            'help_center' => true,
        ];

        $result = [];
        foreach ($moduleDefaults as $key => $default) {
            if (array_key_exists($key, $features)) {
                $result[$key] = (bool)$features[$key];
            } else {
                $result[$key] = $default;
            }
        }

        return $result;
    }

    // ---------------------------------------------------------------
    // Default Menu Builders
    // ---------------------------------------------------------------

    /**
     * Get default platform menu for a specific location.
     */
    public static function getDefaultMenu($location, $basePath = '')
    {
        $basePath = $basePath ?: TenantContext::getBasePath();

        switch ($location) {
            case 'header-main':
                return self::getDefaultMainMenu($basePath);
            case 'footer':
                return self::getDefaultFooterMenu($basePath);
            case 'mobile':
                return self::getDefaultMobileMenu($basePath);
            default:
                return [];
        }
    }

    private static function getDefaultMainMenu($basePath)
    {
        $items = [];

        $items[] = [
            'type' => 'link',
            'label' => 'News Feed',
            'url' => $basePath . '/',
            'icon' => 'fa-solid fa-newspaper',
            'sort_order' => 10,
            'is_active' => 1
        ];

        $items[] = [
            'type' => 'link',
            'label' => 'Listings',
            'url' => $basePath . '/listings',
            'icon' => 'fa-solid fa-list',
            'sort_order' => 20,
            'is_active' => 1
        ];

        if (TenantContext::hasFeature('volunteering')) {
            $items[] = [
                'type' => 'link',
                'label' => 'Volunteering',
                'url' => $basePath . '/volunteering',
                'icon' => 'fa-solid fa-hands-helping',
                'sort_order' => 25,
                'is_active' => 1
            ];
        }

        $items[] = [
            'type' => 'link',
            'label' => 'Groups',
            'url' => $basePath . '/community-groups',
            'icon' => 'fa-solid fa-users',
            'sort_order' => 30,
            'is_active' => 1
        ];

        $items[] = [
            'type' => 'link',
            'label' => 'Local Hubs',
            'url' => $basePath . '/groups',
            'icon' => 'fa-solid fa-map-marker-alt',
            'sort_order' => 40,
            'is_active' => 1
        ];

        $items[] = [
            'type' => 'link',
            'label' => 'Members',
            'url' => $basePath . '/members',
            'icon' => 'fa-solid fa-user-group',
            'sort_order' => 50,
            'is_active' => 1
        ];

        $exploreItems = self::getDefaultExploreMenuItems($basePath);
        if (!empty($exploreItems)) {
            $items[] = [
                'type' => 'dropdown',
                'label' => 'Explore',
                'icon' => 'fa-solid fa-compass',
                'sort_order' => 60,
                'is_active' => 1,
                'children' => $exploreItems
            ];
        }

        return [
            'id' => 'default-main',
            'name' => 'Default Main Navigation',
            'slug' => 'default-main-nav',
            'location' => 'header-main',
            'is_active' => 1,
            'items' => $items
        ];
    }

    private static function getDefaultExploreMenuItems($basePath)
    {
        $items = [];
        $order = 10;

        $exploreConfig = [
            'events' => [
                'label' => 'Events',
                'url' => '/events',
                'icon' => 'fa-solid fa-calendar-days',
                'feature' => 'events'
            ],
            'polls' => [
                'label' => 'Polls',
                'url' => '/polls',
                'icon' => 'fa-solid fa-square-poll-vertical',
                'feature' => 'polls'
            ],
            'goals' => [
                'label' => 'Goals',
                'url' => '/goals',
                'icon' => 'fa-solid fa-bullseye',
                'feature' => 'goals'
            ],
            'resources' => [
                'label' => 'Resources',
                'url' => '/resources',
                'icon' => 'fa-solid fa-folder-open',
                'feature' => 'resources'
            ],
            'smart_matching' => [
                'label' => 'Smart Matching',
                'url' => '/matches',
                'icon' => 'fa-solid fa-wand-magic-sparkles',
                'color' => '#ec4899',
                'separator_before' => true
            ],
            'leaderboard' => [
                'label' => 'Leaderboards',
                'url' => '/leaderboard',
                'icon' => 'fa-solid fa-trophy',
                'separator_before' => true
            ],
            'achievements' => [
                'label' => 'Achievements',
                'url' => '/achievements',
                'icon' => 'fa-solid fa-medal'
            ],
            'ai' => [
                'label' => 'AI Assistant',
                'url' => '/ai',
                'icon' => 'fa-solid fa-robot',
                'color' => '#6366f1',
                'separator_before' => true
            ],
            // /mobile-download has no React route — this link 404'd. Points at
            // the install instructions page added 2026-08-12.
            'get_app' => [
                'label' => 'Get App',
                'url' => '/install-app',
                'icon' => 'fa-solid fa-mobile-screen-button',
                'separator_before' => true
            ]
        ];

        foreach ($exploreConfig as $key => $config) {
            if (!isset($config['feature']) || TenantContext::hasFeature($config['feature'])) {
                $item = [
                    'type' => 'link',
                    'label' => $config['label'],
                    'url' => $basePath . $config['url'],
                    'icon' => $config['icon'],
                    'sort_order' => $order,
                    'is_active' => 1
                ];

                if (isset($config['color'])) {
                    $item['color'] = $config['color'];
                }
                if (isset($config['separator_before'])) {
                    $item['separator_before'] = $config['separator_before'];
                }
                if (isset($config['highlight'])) {
                    $item['highlight'] = $config['highlight'];
                }

                $items[] = $item;
                $order += 10;
            }
        }

        return $items;
    }

    private static function getDefaultFooterMenu($basePath)
    {
        $items = [
            [
                'type' => 'link',
                'label' => 'Privacy Policy',
                'url' => $basePath . '/privacy',
                'sort_order' => 10,
                'is_active' => 1
            ],
            [
                'type' => 'link',
                'label' => 'Terms of Service',
                'url' => $basePath . '/terms',
                'sort_order' => 20,
                'is_active' => 1
            ],
            [
                'type' => 'link',
                'label' => 'Contact Us',
                'url' => $basePath . '/contact',
                'sort_order' => 30,
                'is_active' => 1
            ],
            [
                'type' => 'link',
                'label' => 'Help Center',
                'url' => $basePath . '/help',
                'sort_order' => 40,
                'is_active' => 1
            ]
        ];

        return [
            'id' => 'default-footer',
            'name' => 'Default Footer Navigation',
            'slug' => 'default-footer-nav',
            'location' => 'footer',
            'is_active' => 1,
            'items' => $items
        ];
    }

    private static function getDefaultMobileMenu($basePath)
    {
        $mainMenu = self::getDefaultMainMenu($basePath);

        $items = array_filter($mainMenu['items'], function ($item) {
            return $item['type'] !== 'dropdown';
        });

        return [
            'id' => 'default-mobile',
            'name' => 'Default Mobile Navigation',
            'slug' => 'default-mobile-nav',
            'location' => 'mobile',
            'is_active' => 1,
            'items' => array_values($items)
        ];
    }

    /**
     * Check if default menus should be used for a location.
     */
    public static function shouldUseDefault($location, $tenantId = null)
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        try {
            $menus = self::queryMenusByLocation($location, 'modern', $tenantId);
            return empty($menus);
        } catch (\Exception $e) {
            return true;
        }
    }
}
