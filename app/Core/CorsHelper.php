<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * CORS header management with origin allowlisting.
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

        // Direct match
        if (in_array($origin, $allowedOrigins, true)) {
            return true;
        }

        // Parse origin for subdomain checks
        $originHost = parse_url($origin, PHP_URL_HOST);
        if ($originHost === null) {
            return false;
        }

        $originScheme = parse_url($origin, PHP_URL_SCHEME) ?: 'https';

        // Explicit subdomain allowlist (security hardening 2026-04-12).
        // Previously accepted ANY subdomain of an allowed host; now only
        // subdomains present in CORS_ALLOWED_SUBDOMAINS may match.
        $allowedSubsRaw = getenv('CORS_ALLOWED_SUBDOMAINS');
        if ($allowedSubsRaw === false || $allowedSubsRaw === '') {
            $allowedSubsRaw = $_ENV['CORS_ALLOWED_SUBDOMAINS'] ?? '';
        }
        if ($allowedSubsRaw === '') {
            $allowedSubsRaw = 'app,api,staging,admin,super-admin,project-nexus';
        }
        $allowedSubs = array_filter(array_map(
            static fn ($s) => strtolower(trim($s)),
            explode(',', $allowedSubsRaw)
        ));

        // Check subdomain matches against the explicit subdomain allowlist
        foreach ($allowedOrigins as $allowed) {
            $allowedHost = parse_url($allowed, PHP_URL_HOST);
            if ($allowedHost && str_ends_with($originHost, '.' . $allowedHost)) {
                $allowedScheme = parse_url($allowed, PHP_URL_SCHEME);
                if ($allowedScheme !== $originScheme) {
                    continue;
                }
                // Extract the leading label (e.g. "app" from "app.example.com")
                $prefixLen = strlen($originHost) - strlen('.' . $allowedHost);
                if ($prefixLen <= 0) {
                    continue;
                }
                $leadingLabels = substr($originHost, 0, $prefixLen);
                // Only match when the leading label set is a single entry in
                // the allowlist (no nested sub-subdomains like a.b.host.com).
                if (in_array(strtolower($leadingLabels), $allowedSubs, true)) {
                    return true;
                }
            }
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
