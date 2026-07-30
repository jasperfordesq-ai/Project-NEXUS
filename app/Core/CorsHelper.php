<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use App\Support\CorsOriginMatcher;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * CORS header management with origin allowlisting.
 *
 * One of two copies of this class — see {@see \App\Helpers\CorsHelper} for the
 * full history. That one is the hot path (outermost middleware, every API
 * response); this one has a single call site, FederationController's legacy_v1
 * preflight. The origin-matching rules they share live in
 * {@see \App\Support\CorsOriginMatcher} so they cannot drift again. What still
 * differs on purpose: getAllowedOrigins() here returns only the configured list,
 * while the App\Helpers copy merges tenant custom domains from the database
 * because AppServiceProvider depends on that. Do not collapse the two without
 * reconciling it — tenant custom-domain CORS would silently break.
 */
class CorsHelper
{
    /**
     * Default allowed origins for CORS requests.
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
        // staging.timebank.local removed — stale domain
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

    /** Cached tenant domain origins */
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
     *
     * @param array $additionalOrigins Additional allowed origins for this request
     * @param array $methods Allowed HTTP methods
     * @param array $headers Allowed request headers
     * @return bool True if origin was allowed, false if blocked
     */
    public static function setHeaders(
        array $additionalOrigins = [],
        array $methods = ['GET', 'POST', 'OPTIONS'],
        array $headers = ['Content-Type', 'Authorization', 'Idempotency-Key']
    ): bool {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

        if (empty($origin)) {
            return true;
        }

        $allowedOrigins = array_merge(self::getConfiguredOrigins(), $additionalOrigins);

        if (!self::isOriginAllowed($origin, $allowedOrigins)) {
            return false;
        }

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
     * `$_SERVER['REQUEST_METHOD']` is always populated by PHP-FPM in production,
     * but Laravel's test HTTP kernel dispatches a Request object without writing
     * it, so reading the superglobal directly raised "Undefined array key
     * REQUEST_METHOD" and turned every controller calling handlePreflight() into
     * a 500 *under test only*. That is why the v1 OAuth token mint — the sharpest
     * authenticated surface on the platform — had no feature test until the
     * legacy_v1 audit: any attempt to write one failed inside CORS handling
     * before reaching the endpoint. Production behaviour is unchanged.
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
     */
    public static function isOriginAllowed(string $origin, array $allowedOrigins = []): bool
    {
        if (empty($allowedOrigins)) {
            $allowedOrigins = self::getConfiguredOrigins();
        }

        // Direct match, then the explicit subdomain allowlist (security
        // hardening 2026-04-12: previously ANY subdomain of an allowed host was
        // accepted; now only labels present in CORS_ALLOWED_SUBDOMAINS match).
        //
        // The rules moved into CorsOriginMatcher on 2026-07-30, when this
        // hardening was finally extended to the App\Helpers copy that serves
        // production. Keeping one implementation is the point: this hardening
        // sat in this class alone for 3.5 months precisely because it was a
        // second copy of logic that someone had to remember to update twice.
        if (CorsOriginMatcher::matchesAllowlist($origin, $allowedOrigins)) {
            return true;
        }

        // Dynamic check: tenant custom domains
        $tenantDomains = self::getTenantDomainOrigins();
        if (in_array($origin, $tenantDomains, true)) {
            return true;
        }

        return false;
    }

    /**
     * Get HTTPS origins for all active tenant custom domains.
     */
    private static function getTenantDomainOrigins(): array
    {
        if (self::$tenantDomainOrigins !== null) {
            return self::$tenantDomainOrigins;
        }

        $cacheKey = 'cors:tenant_domain_origins';
        $cacheTtl = 600;

        // Try cache first (Laravel Cache facade — uses Redis when available)
        try {
            $cached = Cache::get($cacheKey);
            if (is_array($cached)) {
                self::$tenantDomainOrigins = $cached;
                return $cached;
            }
        } catch (\Throwable $e) {
            // Cache unavailable
        }

        // Query all active tenant custom domains
        $origins = [];
        try {
            $rows = DB::select(
                "SELECT domain FROM tenants WHERE domain IS NOT NULL AND domain != '' AND is_active = 1"
            );

            foreach ($rows as $row) {
                $domain = trim($row->domain);
                if (empty($domain)) continue;
                $origins[] = 'https://' . $domain;
                if (!str_starts_with($domain, 'www.')) {
                    $origins[] = 'https://www.' . $domain;
                }
            }
        } catch (\Throwable $e) {
            // Database unavailable
        }

        // Cache the result
        try {
            Cache::put($cacheKey, $origins, $cacheTtl);
        } catch (\Throwable $e) {
            // Cache write failure is non-fatal
        }

        self::$tenantDomainOrigins = $origins;
        return $origins;
    }

    /**
     * Add an origin to the allowed list dynamically.
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
     * Get the list of allowed origins.
     */
    public static function getAllowedOrigins(): array
    {
        return self::getConfiguredOrigins();
    }
}
