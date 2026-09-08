<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Middleware;

use App\Core\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * TenantModuleMiddleware
 *
 * Middleware to check if tenant platform modules are enabled before allowing access.
 * This is the single source of truth for module access control, using the
 * tenants.configuration.modules JSON object.
 *
 * Usage in controllers:
 *   TenantModuleMiddleware::require('messages');
 *   TenantModuleMiddleware::require('listings');
 */
class TenantModuleMiddleware
{
    /**
     * Module definitions with human-readable labels and default routes
     */
    private static array $modules = [
        'listings' => [
            'label' => 'Listings',
            'description' => 'Offers & Requests marketplace',
            'default_redirect' => '/'
        ],
        'wallet' => [
            'label' => 'Wallet',
            'description' => 'Time credit wallet and transactions',
            'default_redirect' => '/dashboard'
        ],
        'messages' => [
            'label' => 'Messages',
            'description' => 'Member conversations and message media',
            'default_redirect' => '/dashboard'
        ],
        'dashboard' => [
            'label' => 'Dashboard',
            'description' => 'Member dashboard',
            'default_redirect' => '/'
        ],
        'feed' => [
            'label' => 'Feed',
            'description' => 'Community activity feed',
            'default_redirect' => '/'
        ],
        'notifications' => [
            'label' => 'Notifications',
            'description' => 'Member notification inbox',
            'default_redirect' => '/dashboard'
        ],
        'profile' => [
            'label' => 'Profile',
            'description' => 'Member profile pages',
            'default_redirect' => '/dashboard'
        ],
        'settings' => [
            'label' => 'Settings',
            'description' => 'Member account settings',
            'default_redirect' => '/dashboard'
        ],
    ];

    /**
     * Check if a module is enabled for the current tenant
     *
     * @param string $module Module key (listings, messages, etc.)
     * @return bool
     */
    public static function isEnabled(string $module): bool
    {
        return TenantContext::hasModule($module);
    }

    /**
     * Laravel route middleware entrypoint.
     */
    public function handle(Request $request, Closure $next, string $module): Response
    {
        if (self::isEnabled($module)) {
            return $next($request);
        }

        return response()->json([
            'errors' => [[
                'code' => 'MODULE_DISABLED',
                'message' => __('api.module_disabled_for_community'),
            ]],
            'success' => false,
        ], 403, ['API-Version' => '2.0']);
    }

    /**
     * Check if module is enabled, return error array if not
     *
     * @param string $module Module key
     * @param string|null $customMessage Optional custom error message
     * @return bool|array Returns true if enabled, or error response array
     */
    public static function check(string $module, ?string $customMessage = null)
    {
        if (self::isEnabled($module)) {
            return true;
        }

        $definition = self::$modules[$module] ?? ['label' => ucfirst($module)];
        $basePath = TenantContext::getBasePath();
        $redirect = $basePath . ($definition['default_redirect'] ?? '/');

        http_response_code(404);
        return [
            'error' => true,
            'module' => $module,
            'message' => $customMessage ?? "The {$definition['label']} module is not enabled for this community.",
            'redirect' => $redirect
        ];
    }

    /**
     * Require a module to be enabled (exits if not)
     *
     * @param string $module Module key
     * @param string|null $customMessage Optional custom error message
     */
    public static function require(string $module, ?string $customMessage = null): void
    {
        $check = self::check($module, $customMessage);

        if (is_array($check)) {
            if (($_ENV['APP_ENV'] ?? getenv('APP_ENV')) === 'testing' || (function_exists('app') && app()->environment('testing'))) {
                throw new \Symfony\Component\HttpKernel\Exception\HttpException(403, json_encode($check));
            }
            $isAjax = isset($_SERVER['HTTP_X_REQUESTED_WITH'])
                && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest';

            if ($isAjax) {
                header('Content-Type: application/json');
                echo json_encode($check);
            } else {
                // Show a proper 404 page or redirect
                self::show404Page($check['message'], $check['redirect']);
            }
            exit;
        }
    }

    /**
     * Display a 404 page for disabled modules
     *
     * @param string $message Error message
     * @param string $redirect Redirect URL
     */
    private static function show404Page(string $message, string $redirect): void
    {
        $basePath = TenantContext::getBasePath();
        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? 'Community';

        // Try to use the tenant's 404 view if it exists
        $viewPaths = [
            __DIR__ . '/../../views/tenants/' . ($tenant['slug'] ?? 'default') . '/errors/404.php',
            __DIR__ . '/../../views/errors/404.php',
        ];

        foreach ($viewPaths as $path) {
            if (file_exists($path)) {
                $pageTitle = 'Module Not Available';
                $errorMessage = $message;
                include $path;
                return;
            }
        }

        // Fallback: simple HTML response
        echo '<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Module Not Available - ' . htmlspecialchars($tenantName) . '</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
               display: flex; align-items: center; justify-content: center;
               min-height: 100vh; margin: 0; background: #f3f4f6; }
        .container { text-align: center; padding: 2rem; }
        h1 { color: #1f2937; margin-bottom: 0.5rem; }
        p { color: #6b7280; margin-bottom: 1.5rem; }
        a { color: #3b82f6; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Module Not Available</h1>
        <p>' . htmlspecialchars($message) . '</p>
        <a href="' . htmlspecialchars($redirect) . '">Return to Home</a>
    </div>
</body>
</html>';
    }

    /**
     * Get all module states for current tenant
     *
     * @return array Associative array of module => enabled
     */
    public static function getAllModuleStates(): array
    {
        $states = [];
        foreach (array_keys(self::$modules) as $module) {
            $states[$module] = self::isEnabled($module);
        }
        return $states;
    }

    /**
     * Get module definition
     *
     * @param string $module Module key
     * @return array|null
     */
    public static function getModuleDefinition(string $module): ?array
    {
        return self::$modules[$module] ?? null;
    }

    /**
     * Get all module definitions
     *
     * @return array
     */
    public static function getAllModuleDefinitions(): array
    {
        return self::$modules;
    }

    /**
     * Helper for views - check if module can be shown
     *
     * @param string $module Module key
     * @return bool
     */
    public static function can(string $module): bool
    {
        return self::isEnabled($module);
    }
}
