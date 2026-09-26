<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Tenancy;

use Illuminate\Support\Facades\DB;

/**
 * Decides whether an API request's Host is one this platform recognises.
 *
 * E-038 / F-035: TenantContext::resolve() falls back to the MASTER tenant for
 * any Host it does not recognise, so a domain nobody configured — a deleted
 * community's domain still pointed at the origin, or any hostname aimed at it
 * by mistake — quietly served Project NEXUS. The owner decided on 26 September
 * 2026 that such a request is refused with a plain not-found instead.
 *
 * Refusal is deliberately narrow. It applies ONLY when the Host is itself the
 * tenant signal, i.e. a syntactically valid, multi-label, public-looking name
 * that is not a community domain and not a platform host. Everything else
 * keeps the previous behaviour, because a wrong allowlist here takes the whole
 * platform offline:
 *
 *  - IP literals and invalid host strings (blue/green smoke tests hit
 *    127.0.0.1; resolve() already ignores invalid hosts);
 *  - single-label names — Docker service names. web-uk calls the API from the
 *    server with Node fetch, which DROPS a Host header, so every accessible
 *    frontend request arrives with Host `nexus-<colour>-php-app` and carries
 *    the community in X-Tenant-Slug / Origin instead;
 *  - developer and internal suffixes (.localhost, .test, .internal, .local);
 *  - configured platform hosts (see config/tenancy.php);
 *  - any community's domain or accessible domain, compared leniently so that a
 *    row stored as `https://Example.org/` is never refused.
 *
 * It is consulted by the ResolveTenant middleware only (the `api` group). CLI,
 * queue and scheduler work has no Host and never reaches it; the sitemap and
 * llms.txt routes do their own host lookup and are unchanged.
 */
final class PlatformHostPolicy
{
    public static function shouldRefuse(?string $rawHost): bool
    {
        if (!config('tenancy.refuse_unknown_hosts', true)) {
            return false;
        }

        $host = self::normalise((string) $rawHost);
        if ($host === '') {
            return false;
        }

        // IP literals (including bracketed IPv6) are internal callers.
        if (filter_var(trim($host, '[]'), FILTER_VALIDATE_IP) !== false) {
            return false;
        }

        // resolve() does not use an invalid host as a tenant signal; neither do we.
        if (filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false) {
            return false;
        }

        // Single-label names cannot be public DNS names routed to this origin.
        if (!str_contains($host, '.')) {
            return false;
        }

        foreach ((array) config('tenancy.internal_host_suffixes', []) as $suffix) {
            $suffix = strtolower((string) $suffix);
            if ($suffix !== '' && str_ends_with($host, $suffix)) {
                return false;
            }
        }

        if (in_array($host, self::platformHosts(), true)) {
            return false;
        }

        return !self::isCommunityHost($host);
    }

    /**
     * Lower-case, strip scheme, path, port, trailing dot and a leading `www.`.
     */
    public static function normalise(string $value): string
    {
        $value = strtolower(trim($value));
        if ($value === '') {
            return '';
        }

        $value = (string) preg_replace('#^[a-z][a-z0-9+.-]*://#', '', $value);
        $value = explode('/', $value, 2)[0];

        if (str_starts_with($value, '[')) {
            // Bracketed IPv6, optionally with a port.
            $end = strpos($value, ']');
            $value = $end !== false ? substr($value, 0, $end + 1) : $value;
        } elseif (substr_count($value, ':') === 1) {
            $value = explode(':', $value, 2)[0];
        }

        $value = rtrim($value, '.');

        return (string) preg_replace('/^www\./', '', $value);
    }

    /**
     * @return list<string>
     */
    public static function platformHosts(): array
    {
        $candidates = (array) config('tenancy.platform_hosts', []);

        foreach (['app.url', 'app.frontend_url', 'app.accessible_frontend_url'] as $key) {
            $candidates[] = (string) config($key, '');
        }

        foreach ((array) config('cors.allowed_origins', []) as $origin) {
            $candidates[] = (string) $origin;
        }

        $hosts = [];
        foreach ($candidates as $candidate) {
            $host = self::normalise((string) $candidate);
            if ($host !== '') {
                $hosts[$host] = true;
            }
        }

        return array_keys($hosts);
    }

    private static function isCommunityHost(string $host): bool
    {
        // Fast path: the same exact comparison TenantContext::resolve() makes.
        $exact = DB::table('tenants')
            ->where('domain', $host)
            ->orWhere('accessible_domain', $host)
            ->orWhere('domain', 'www.' . $host)
            ->orWhere('accessible_domain', 'www.' . $host)
            ->exists();
        if ($exact) {
            return true;
        }

        // Slow path, reached only by hosts that are about to be refused: compare
        // against every stored value leniently so a non-canonical row (scheme,
        // case, trailing slash, port) is never turned into a 404.
        $rows = DB::table('tenants')
            ->where(function ($query) {
                $query->whereNotNull('domain')->where('domain', '!=', '')
                    ->orWhere(function ($inner) {
                        $inner->whereNotNull('accessible_domain')->where('accessible_domain', '!=', '');
                    });
            })
            ->get(['domain', 'accessible_domain']);

        foreach ($rows as $row) {
            foreach ([$row->domain ?? null, $row->accessible_domain ?? null] as $stored) {
                if ($stored !== null && self::normalise((string) $stored) === $host) {
                    return true;
                }
            }
        }

        return false;
    }
}
