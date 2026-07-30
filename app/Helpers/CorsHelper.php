<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Helpers;

/**
 * CORS Helper
 *
 * Provides secure Cross-Origin Resource Sharing (CORS) header management.
 * Validates origins against an allowlist instead of using wildcard (*).
 *
 * 🔴 THIS CLASS IS ONE OF TWO COPIES, AND THEY HAVE DRIFTED IN BOTH DIRECTIONS.
 * The other is {@see \App\Core\CorsHelper}. Both were the same file until the
 * 2026-03-20 src/ inlining refactor (5842daef8) duplicated it. Neither is dead:
 *
 *  - THIS copy is on the hot path. EnsureCorsHeaders — prepended as the
 *    outermost middleware in bootstrap/app.php — calls isOriginAllowed() on
 *    every API response that HandleCors did not already stamp, and
 *    AppServiceProvider calls getAllowedOrigins() at boot to merge tenant
 *    custom domains into config('cors.allowed_origins').
 *  - The App\Core copy has exactly one call site: FederationController's
 *    legacy_v1 preflight/headers pair.
 *
 * Known divergences, both caused by a fix landing on one copy only:
 *
 *  1. isOriginAllowed() here still accepts ANY subdomain of an allowed host,
 *     including nested labels (a.b.project-nexus.ie). The App\Core copy was
 *     hardened on 2026-04-12 (9f2b2a00f) to match only single leading labels
 *     present in CORS_ALLOWED_SUBDOMAINS. That hardening never reached this
 *     copy — so it does not currently apply to the request path that actually
 *     serves production. Deliberately NOT changed here: it is a behaviour
 *     change to the outermost middleware on every API response and needs its
 *     own review, not a drive-by edit inside a duplication cleanup.
 *  2. handlePreflight() read $_SERVER['REQUEST_METHOD'] directly until
 *     2026-07-30, mirroring a bug fixed in the App\Core copy the day before.
 *     See requestMethod() below.
 *
 * getAllowedOrigins() also differs on purpose-by-accident: this copy merges
 * tenant custom domains from the database, the App\Core copy returns only the
 * configured list. AppServiceProvider depends on the merging behaviour, so the
 * two are NOT interchangeable — consolidating them requires reconciling that
 * first or tenant custom domains silently stop passing CORS.
 */
class CorsHelper
{
    /**
     * Default allowed origins for CORS requests.
     * Can be overridden via ALLOWED_ORIGINS environment variable.
     */
    private static array $defaultOrigins = [
        'https://project-nexus.ie',
        'https://www.project-nexus.ie',
        'https://app.project-nexus.ie',
        'https://api.project-nexus.ie',
        'https://hour-timebank.ie',
        'https://www.hour-timebank.ie',
        'https://nexuscivic.ie',
        'https://www.nexuscivic.ie',
        'https://timebank.global',
        'https://www.timebank.global',
        'http://staging.timebank.local',
        'http://localhost:5173',
        'http://localhost:5176',
        'http://localhost:4176',
        'http://localhost:8082',
        'http://localhost:8090',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5176',
        'http://127.0.0.1:4176',
        'http://127.0.0.1:8082',
    ];

    /** Cached tenant domain origins (null = not loaded yet) */
    private static ?array $tenantDomainOrigins = null;

    private static ?array $allowedOrigins = null;

    /**
     * Get allowed origins from environment or defaults.
     */
    private static function getConfiguredOrigins(): array
    {
        if (self::$allowedOrigins === null) {
            // Always start with the hardcoded defaults
            self::$allowedOrigins = self::$defaultOrigins;

            // Merge any additional origins from environment (additive, never replaces)
            $envOrigins = getenv('CORS_ALLOWED_ORIGINS') ?: ($_ENV['CORS_ALLOWED_ORIGINS'] ?? '');
            if (empty($envOrigins)) {
                $envOrigins = getenv('ALLOWED_ORIGINS') ?: ($_ENV['ALLOWED_ORIGINS'] ?? '');
            }
            if (!empty($envOrigins)) {
                $envList = array_filter(array_map('trim', explode(',', $envOrigins)));
                self::$allowedOrigins = array_values(array_unique(
                    array_merge(self::$allowedOrigins, $envList)
                ));
            }
        }
        return self::$allowedOrigins;
    }

    /**
     * Set CORS headers for the current request.
     * Validates the Origin header against allowed origins.
     *
     * @param array $additionalOrigins Additional allowed origins for this request
     * @param array $methods Allowed HTTP methods (default: GET, POST, OPTIONS)
     * @param array $headers Allowed request headers
     * @return bool True if origin was allowed, false if blocked
     */
    public static function setHeaders(
        array $additionalOrigins = [],
        array $methods = ['GET', 'POST', 'OPTIONS'],
        array $headers = ['Content-Type', 'Authorization', 'Idempotency-Key']
    ): bool {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

        // No origin header - not a CORS request (same-origin or non-browser client)
        if (empty($origin)) {
            return true;
        }

        // Build complete allowlist
        $allowedOrigins = array_merge(self::getConfiguredOrigins(), $additionalOrigins);

        // Check if origin is allowed
        if (!self::isOriginAllowed($origin, $allowedOrigins)) {
            return false;
        }

        // Set CORS headers with the specific origin (not wildcard)
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Methods: ' . implode(', ', $methods));
        header('Access-Control-Allow-Headers: ' . implode(', ', $headers));
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');

        return true;
    }

    /**
     * The request method, from Laravel's request when there is one.
     *
     * Identical to {@see \App\Core\CorsHelper::requestMethod()}, which carries the
     * full reasoning: `$_SERVER['REQUEST_METHOD']` is always populated by PHP-FPM
     * in production, but Laravel's test HTTP kernel dispatches a Request object
     * without writing it, so reading the superglobal directly raised "Undefined
     * array key REQUEST_METHOD" and turned every controller calling
     * handlePreflight() into a 500 *under test only*.
     *
     * That defect was fixed in App\Core\CorsHelper on 2026-07-29 during the
     * legacy_v1 federation audit. This class is a second copy of it, created by
     * the 2026-03-20 src/ inlining refactor, and it kept the superglobal read.
     * Nothing calls handlePreflight() on *this* copy today — the sole call site,
     * FederationController, uses the App\Core one — so the bug was latent here
     * rather than live. It is fixed anyway because the two copies have already
     * drifted once in the other direction (see the class docblock), and a latent
     * copy of a known 500-under-test trap is exactly what the next caller steps in.
     */
    private static function requestMethod(): string
    {
        if (function_exists('request')) {
            $request = request();
            if ($request !== null) {
                return strtoupper($request->getMethod());
            }
        }

        return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    }

    /**
     * Handle preflight OPTIONS request.
     * Sets CORS headers and exits with 204 No Content.
     *
     * @param array $additionalOrigins Additional allowed origins
     * @param array $methods Allowed HTTP methods
     * @param array $headers Allowed request headers
     * @param int $maxAge Cache duration for preflight response in seconds
     */
    public static function handlePreflight(
        array $additionalOrigins = [],
        array $methods = ['GET', 'POST', 'OPTIONS'],
        array $headers = ['Content-Type', 'Authorization'],
        int $maxAge = 86400
    ): void {
        if (self::requestMethod() !== 'OPTIONS') {
            return;
        }

        if (self::setHeaders($additionalOrigins, $methods, $headers)) {
            header('Access-Control-Max-Age: ' . $maxAge);
        }

        if (($_ENV['APP_ENV'] ?? getenv('APP_ENV')) === 'testing' || (function_exists('app') && app()->environment('testing'))) {
            throw new \Symfony\Component\HttpKernel\Exception\HttpException(204, '');
        }
        http_response_code(204);
        exit;
    }

    /**
     * Check if an origin is in the allowed list.
     * Checks static allowlist, subdomain patterns, AND dynamic tenant custom domains.
     *
     * @param string $origin Origin to check
     * @param array $allowedOrigins List of allowed origins
     * @return bool True if allowed
     */
    public static function isOriginAllowed(string $origin, array $allowedOrigins = []): bool
    {
        if (empty($allowedOrigins)) {
            $allowedOrigins = self::getConfiguredOrigins();
        }

        // Direct match against static list
        if (in_array($origin, $allowedOrigins, true)) {
            return true;
        }

        // Parse origin to check subdomains and dynamic domains
        $originHost = parse_url($origin, PHP_URL_HOST);
        if ($originHost === null) {
            return false;
        }

        $originScheme = parse_url($origin, PHP_URL_SCHEME) ?: 'https';

        // Check subdomain matches (e.g., https://tenant.project-nexus.ie)
        foreach ($allowedOrigins as $allowed) {
            $allowedHost = parse_url($allowed, PHP_URL_HOST);
            if ($allowedHost && str_ends_with($originHost, '.' . $allowedHost)) {
                $allowedScheme = parse_url($allowed, PHP_URL_SCHEME);
                if ($allowedScheme === $originScheme) {
                    return true;
                }
            }
        }

        // Dynamic check: is this a tenant's custom domain?
        // Covers origins like https://hour-timebank.ie from tenants with custom domains.
        $tenantDomains = self::getTenantDomainOrigins();
        if (in_array($origin, $tenantDomains, true)) {
            return true;
        }

        return false;
    }

    /**
     * Get HTTPS origins for all active tenant custom domains.
     * Results are cached in Redis for 10 minutes to avoid per-request DB queries.
     *
     * @return array List of origins like ['https://hour-timebank.ie', 'https://www.hour-timebank.ie', ...]
     */
    private static function getTenantDomainOrigins(): array
    {
        if (self::$tenantDomainOrigins !== null) {
            return self::$tenantDomainOrigins;
        }

        $cacheKey = 'cors:tenant_domain_origins';
        $cacheTtl = 600; // 10 minutes

        // Try Redis cache first
        try {
            if (class_exists('\App\Services\RedisCache') && \App\Services\RedisCache::has($cacheKey, null)) {
                $cached = \App\Services\RedisCache::get($cacheKey, null);
                if (is_array($cached)) {
                    self::$tenantDomainOrigins = $cached;
                    return $cached;
                }
            }
        } catch (\Throwable $e) {
            // Redis unavailable - fall through to DB
        }

        // Query all active tenant custom domains
        $origins = [];
        try {
            $rows = \Illuminate\Support\Facades\DB::select(
                "SELECT domain FROM tenants WHERE domain IS NOT NULL AND domain != '' AND is_active = 1"
            );

            foreach ($rows as $row) {
                $domain = trim($row->domain);
                if (empty($domain)) continue;
                // Add both with and without www
                $origins[] = 'https://' . $domain;
                if (!str_starts_with($domain, 'www.')) {
                    $origins[] = 'https://www.' . $domain;
                }
            }
        } catch (\Throwable $e) {
            // Database or class unavailable (e.g., called before autoloader) - return empty
        }

        // Cache the result
        try {
            if (class_exists('\App\Services\RedisCache')) {
                \App\Services\RedisCache::set($cacheKey, $origins, $cacheTtl, null);
            }
        } catch (\Throwable $e) {
            // Cache write failure is non-fatal
        }

        self::$tenantDomainOrigins = $origins;
        return $origins;
    }

    /**
     * Add an origin to the allowed list dynamically.
     *
     * @param string $origin Origin to add (must include scheme, e.g., https://example.com)
     */
    public static function addAllowedOrigin(string $origin): void
    {
        $origin = rtrim($origin, '/');
        $origins = self::getConfiguredOrigins();
        if (!empty($origin) && !in_array($origin, $origins, true)) {
            self::$allowedOrigins[] = $origin;
        }
    }

    /**
     * Get the list of allowed origins (static + dynamic tenant domains).
     *
     * @return array List of allowed origins
     */
    public static function getAllowedOrigins(): array
    {
        return array_values(array_unique(array_merge(
            self::getConfiguredOrigins(),
            self::getTenantDomainOrigins()
        )));
    }
}
