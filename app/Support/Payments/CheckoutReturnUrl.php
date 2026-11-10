<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Payments;

use App\Core\TenantContext;
use App\Support\Tenancy\AccessibleFrontendUrl;

/**
 * Where Stripe may send a member back to after a hosted payment page.
 *
 * A return address is caller-supplied, so it is an open-redirect surface. It is
 * accepted only when it points at THIS community on one of its two frontends:
 *
 *  - the React website (TenantContext::getFrontendUrl() plus the slug prefix), or
 *  - the accessible site (AccessibleFrontendUrl::base()).
 *
 * Anything else — another host, another community's path, a protocol-relative
 * or backslash trick, a control character — falls back to the website page
 * named by $fallbackPath. A bare path ("/premium/return") keeps its historic
 * meaning: a page on the website.
 *
 * 🔴 Until 26 Oct 2026 only the website was allowed, so a member who paid from
 * the accessible site landed on the React site afterwards.
 */
final class CheckoutReturnUrl
{
    public static function safe(string $returnUrl, string $fallbackPath): string
    {
        $fallback = self::websiteUrl($fallbackPath);
        $returnUrl = trim($returnUrl);

        if ($returnUrl === '' || preg_match('/[\x00-\x1F\x7F\\\\]/', $returnUrl) === 1) {
            return $fallback;
        }
        if (str_starts_with($returnUrl, '//')) {
            return $fallback;
        }
        if (str_starts_with($returnUrl, '/')) {
            return self::websiteUrl($returnUrl);
        }

        $scheme = strtolower((string) (parse_url($returnUrl, PHP_URL_SCHEME) ?? ''));
        if (!in_array($scheme, ['http', 'https'], true)) {
            return $fallback;
        }

        $website = rtrim(TenantContext::getFrontendUrl(), '/') . TenantContext::getSlugPrefix();
        if (self::isWithinAnyPlatformHost($returnUrl, $website, 'platform_app_hosts')) {
            return $returnUrl;
        }

        $accessible = AccessibleFrontendUrl::base();
        if ($accessible !== null && self::isWithinAnyPlatformHost($returnUrl, $accessible, 'platform_accessible_hosts')) {
            return $returnUrl;
        }

        return $fallback;
    }

    /**
     * Within $base, or — only when $base is on one of the platform's own shared
     * hosts — within the same path on another of those hosts. While the app is
     * served on both app.project-nexus.ie and app.project-nexus.net, a member
     * must return to the address they paid from: sign-in belongs to one address,
     * so the other one would have them signed out. A community on its own
     * domain never gains the platform hosts.
     */
    private static function isWithinAnyPlatformHost(string $url, string $base, string $hostListKey): bool
    {
        if (self::isWithin($url, $base)) {
            return true;
        }

        $baseHost = strtolower((string) (parse_url($base, PHP_URL_HOST) ?? ''));
        $hosts = config('tenancy.' . $hostListKey, []);
        $hosts = is_array($hosts) ? array_map(static fn ($h): string => strtolower((string) $h), $hosts) : [];
        if ($baseHost === '' || !in_array($baseHost, $hosts, true)) {
            return false;
        }

        foreach ($hosts as $host) {
            if ($host === '' || $host === $baseHost) {
                continue;
            }
            $alternate = preg_replace('#^(https?://)[^/]+#i', '${1}' . $host, $base, 1);
            if (is_string($alternate) && self::isWithin($url, $alternate)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Append query parameters, whether or not the address already has a query.
     * Values are encoded EXCEPT Stripe's literal `{CHECKOUT_SESSION_ID}`
     * placeholder, which Stripe only substitutes when it is left unencoded.
     *
     * @param array<string,string> $params
     */
    public static function withQuery(string $url, array $params): string
    {
        $fragment = '';
        $hashAt = strpos($url, '#');
        if ($hashAt !== false) {
            $fragment = substr($url, $hashAt);
            $url = substr($url, 0, $hashAt);
        }

        $pairs = [];
        foreach ($params as $key => $value) {
            $encoded = $value === '{CHECKOUT_SESSION_ID}' ? $value : rawurlencode($value);
            $pairs[] = rawurlencode((string) $key) . '=' . $encoded;
        }
        if ($pairs === []) {
            return $url . $fragment;
        }

        $separator = str_contains($url, '?') ? (str_ends_with($url, '?') || str_ends_with($url, '&') ? '' : '&') : '?';

        return $url . $separator . implode('&', $pairs) . $fragment;
    }

    private static function websiteUrl(string $path): string
    {
        $base = rtrim(TenantContext::getFrontendUrl(), '/');
        $slugPrefix = TenantContext::getSlugPrefix();
        $path = '/' . ltrim($path, '/');

        if ($slugPrefix !== '' && $path !== $slugPrefix && !str_starts_with($path, $slugPrefix . '/')) {
            $path = $slugPrefix . $path;
        }

        return $base . $path;
    }

    /** Same scheme, host and port as $base, and a path at or below $base's path. */
    private static function isWithin(string $url, string $base): bool
    {
        $u = parse_url($url);
        $b = parse_url($base);
        if (!is_array($u) || !is_array($b)) {
            return false;
        }
        if (isset($u['user']) || isset($u['pass'])) {
            return false;
        }

        $uScheme = strtolower((string) ($u['scheme'] ?? ''));
        $bScheme = strtolower((string) ($b['scheme'] ?? ''));
        $uHost = strtolower((string) ($u['host'] ?? ''));
        $bHost = strtolower((string) ($b['host'] ?? ''));
        if ($uScheme === '' || $uHost === '' || $uScheme !== $bScheme || $uHost !== $bHost) {
            return false;
        }

        $uPort = (int) ($u['port'] ?? ($uScheme === 'https' ? 443 : 80));
        $bPort = (int) ($b['port'] ?? ($bScheme === 'https' ? 443 : 80));
        if ($uPort !== $bPort) {
            return false;
        }

        $basePath = rtrim((string) ($b['path'] ?? ''), '/');
        if ($basePath === '') {
            return true;
        }
        $path = '/' . ltrim((string) ($u['path'] ?? '/'), '/');

        return $path === $basePath || str_starts_with($path, $basePath . '/');
    }
}
