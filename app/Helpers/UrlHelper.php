<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Helpers;

use App\Core\TenantContext;

/**
 * URL Helper
 *
 * Provides utilities for safe URL handling and redirect validation
 */
class UrlHelper
{
    /**
     * Default allowed hosts for redirects.
     * Can be overridden via ALLOWED_HOSTS environment variable.
     */
    private static array $defaultHosts = [
        'project-nexus.ie',
        'www.project-nexus.ie',
        'hour-timebank.ie',
        'www.hour-timebank.ie',
        'staging.timebank.local',
    ];

    private static ?array $allowedHosts = null;

    /**
     * Get allowed hosts from environment or defaults.
     */
    private static function getConfiguredHosts(): array
    {
        if (self::$allowedHosts === null) {
            $envHosts = getenv('ALLOWED_HOSTS') ?: ($_ENV['ALLOWED_HOSTS'] ?? '');
            if (!empty($envHosts)) {
                self::$allowedHosts = array_map('trim', explode(',', $envHosts));
            } else {
                self::$allowedHosts = self::$defaultHosts;
            }
        }
        return self::$allowedHosts;
    }

    /**
     * Validate and sanitize a redirect URL to prevent open redirect attacks.
     *
     * Only allows:
     * - Relative URLs (starting with /)
     * - URLs on allowed hosts
     *
     * @param string|null $url The URL to validate
     * @param string $fallback Fallback URL if validation fails (must be relative)
     * @return string Safe URL to redirect to
     */
    public static function safeRedirect(?string $url, string $fallback = '/dashboard'): string
    {
        if ($url === null || trim($url) === '') {
            return self::ensureRelative($fallback);
        }

        $url = trim($url);

        // Block javascript:, data:, vbscript:, etc.
        if (preg_match('/^[a-z]+:/i', $url)) {
            $scheme = strtolower(parse_url($url, PHP_URL_SCHEME) ?? '');

            if (!in_array($scheme, ['http', 'https'], true)) {
                return self::ensureRelative($fallback);
            }

            $host = parse_url($url, PHP_URL_HOST);
            if ($host === null || !self::isAllowedHost($host)) {
                return self::ensureRelative($fallback);
            }

            // Absolute URL with allowed host — pass through
            return $url;
        }

        // Prevent protocol-relative URLs (//evil.com)
        if (str_starts_with($url, '//')) {
            return self::ensureRelative($fallback);
        }

        // Relative URLs are safe
        if (str_starts_with($url, '/')) {
            if (preg_match('#^/[\\\\]#', $url)) {
                return self::ensureRelative($fallback);
            }
            return $url;
        }

        return self::ensureRelative($fallback);
    }

    /**
     * Get safe redirect URL from HTTP_REFERER.
     *
     * @param string $fallback Fallback URL if referer is invalid
     * @return string Safe URL to redirect to
     */
    public static function safeReferer(string $fallback = '/dashboard'): string
    {
        $referer = $_SERVER['HTTP_REFERER'] ?? null;
        return self::safeRedirect($referer, $fallback);
    }

    /**
     * Check if a host is in the allowed list.
     *
     * @param string $host Host to check
     * @return bool True if allowed
     */
    public static function isAllowedHost(string $host): bool
    {
        $host = strtolower($host);
        $allowedHosts = self::getConfiguredHosts();

        if (in_array($host, $allowedHosts, true)) {
            return true;
        }

        // Check for subdomain matches (e.g., tenant.project-nexus.ie)
        foreach ($allowedHosts as $allowed) {
            if (str_ends_with($host, '.' . $allowed)) {
                return true;
            }
        }

        // Dynamic check: tenant custom domains from DB
        try {
            $stripped = preg_replace('/^www\./', '', $host);
            $result = \Illuminate\Support\Facades\DB::select(
                "SELECT 1 FROM tenants WHERE (domain = ? OR domain = ?) AND is_active = 1 LIMIT 1",
                [$host, $stripped]
            );
            if (!empty($result)) {
                return true;
            }
        } catch (\Throwable $e) {
            // DB unavailable -- fall through
        }

        return false;
    }

    /**
     * Add a host to the allowed list dynamically.
     *
     * @param string $host Host to add
     */
    public static function addAllowedHost(string $host): void
    {
        $host = strtolower(trim($host));
        $hosts = self::getConfiguredHosts();
        if (!empty($host) && !in_array($host, $hosts, true)) {
            self::$allowedHosts[] = $host;
        }
    }

    /**
     * Ensure a fallback URL is relative.
     *
     * @param string $url URL to check
     * @return string Relative URL
     */
    private static function ensureRelative(string $url): string
    {
        if (str_starts_with($url, '/') && !str_starts_with($url, '//')) {
            return $url;
        }
        return '/dashboard';
    }

    // ============================================
    // ABSOLUTE URL HELPERS (for API responses)
    // ============================================

    /**
     * Get the base URL for the current tenant/request.
     * Used for converting relative URLs to absolute in API responses.
     *
     * @return string Base URL (e.g., 'https://project-nexus.ie')
     */
    public static function getBaseUrl(): string
    {
        // Try tenant domain first — never the platform master's: its `domain`
        // is the sales site, which serves none of our files (same rule as
        // TenantContext::getFrontendUrl() and the sitemap, id > 1).
        $tenantDomain = TenantContext::getId() > 1 ? TenantContext::getDomain() : '';
        if (!empty($tenantDomain)) {
            return $tenantDomain;
        }

        // Fall back to current request host
        if (isset($_SERVER['HTTP_HOST'])) {
            $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            return $protocol . '://' . $_SERVER['HTTP_HOST'];
        }

        // Last resort - check environment
        $siteUrl = getenv('SITE_URL') ?: ($_ENV['SITE_URL'] ?? null);
        if ($siteUrl) {
            return rtrim($siteUrl, '/');
        }

        return 'https://project-nexus.ie';
    }

    /**
     * Convert a relative URL to an absolute URL.
     * If the URL is already absolute, returns it unchanged.
     *
     * @param string|null $url The URL to convert (e.g., '/uploads/images/foo.jpg')
     * @return string|null Absolute URL or null if input was null
     */
    public static function absolute(?string $url): ?string
    {
        if ($url === null || $url === '') {
            return $url;
        }

        // Already absolute
        if (preg_match('#^https?://#i', $url)) {
            return $url;
        }

        // Protocol-relative
        if (str_starts_with($url, '//')) {
            return 'https:' . $url;
        }

        // Relative path - make absolute
        $baseUrl = self::getBaseUrl();

        if (!str_starts_with($url, '/')) {
            $url = '/' . $url;
        }

        return $baseUrl . $url;
    }

    /**
     * Convert avatar URL to absolute, with fallback to default avatar.
     *
     * @param string|null $avatarUrl The avatar URL
     * @param string $default Default avatar path
     * @return string Absolute avatar URL
     */
    public static function absoluteAvatar(?string $avatarUrl, string $default = '/assets/img/defaults/default_avatar.png'): string
    {
        if (empty($avatarUrl)) {
            return self::absolute($default);
        }
        return self::absolute($avatarUrl);
    }

    /**
     * Convert an array of URLs to absolute URLs.
     *
     * @param array $urls Array of URLs
     * @return array Array of absolute URLs
     */
    public static function absoluteAll(array $urls): array
    {
        return array_map([self::class, 'absolute'], $urls);
    }
}
