<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support;

/**
 * The single implementation of CORS origin allowlist matching.
 *
 * There are two CorsHelper classes — {@see \App\Helpers\CorsHelper} (hot path:
 * the outermost middleware, every API response) and {@see \App\Core\CorsHelper}
 * (one call site: the legacy_v1 federation preflight). They were the same file
 * until the 2026-03-20 src/ inlining refactor (5842daef8) duplicated it, and
 * they then drifted in BOTH directions, each time because a fix landed on one
 * copy only:
 *
 *  - The subdomain hardening (9f2b2a00f, 2026-04-12) reached App\Core alone, so
 *    for 3.5 months it did not apply to the path that actually serves
 *    production. Confirmed live on 2026-07-30: api.project-nexus.ie reflected
 *    `Access-Control-Allow-Origin: https://evil.project-nexus.ie` — and
 *    `https://a.b.project-nexus.ie` — alongside
 *    `Access-Control-Allow-Credentials: true`.
 *  - The REQUEST_METHOD fix (2026-07-29) reached App\Core alone; the App\Helpers
 *    copy was patched separately the next day.
 *
 * So this class exists to make the security-critical half un-duplicatable:
 * both helpers delegate their static-list and subdomain matching here. What
 * legitimately differs between them stays in them — App\Helpers merges tenant
 * custom domains from the database into getAllowedOrigins() and AppServiceProvider
 * depends on that, App\Core returns only the configured list. That difference is
 * why the classes cannot simply be collapsed into one; the matching rules are
 * not, and must never diverge again.
 *
 * The tenant-custom-domain lookup is deliberately NOT here: it hits the database
 * and cache, while everything in this class is pure and side-effect free.
 */
final class CorsOriginMatcher
{
    /**
     * Subdomain labels accepted when CORS_ALLOWED_SUBDOMAINS is unset.
     *
     * Verified against production on 2026-07-30 before the hardening was
     * extended to the hot path: neither CORS_ALLOWED_SUBDOMAINS nor
     * CORS_ALLOWED_ORIGINS is set there, so this default governs. The only live
     * hosts that sit under a configured apex host and are NOT covered by a
     * label here are the accessible (GOV.UK) frontends —
     * accessible.project-nexus.ie and accessible-uk.timebank.global — which are
     * server-rendered by the PHP app and call same-origin Laravel routes only
     * (accessible-frontend/views/wallet.blade.php passes a route() URL as the
     * autocomplete source), so they never needed a cross-origin grant.
     * uk.timebank.global (tenant 11) DOES serve the React app and does call the
     * API cross-origin, but it is a row in `tenants.domain`, so it is allowed by
     * exact match in the tenant-domain step rather than by this wildcard.
     */
    public const DEFAULT_ALLOWED_SUBDOMAINS = 'app,api,staging,admin,super-admin,project-nexus';

    /**
     * Whether an origin matches the allowlist directly, or as a permitted
     * subdomain of an allowlisted host.
     *
     * A subdomain matches only when its scheme matches AND its leading label
     * set is a single label present in the allowlist. That rejects nested
     * sub-subdomains (a.b.project-nexus.ie) as well as any unlisted single
     * label (evil.project-nexus.ie), which is the whole point of the 2026-04-12
     * hardening: with supports_credentials enabled, reflecting an arbitrary
     * subdomain hands a hijacked or dangling subdomain full authenticated
     * read/write access to the API.
     *
     * @param array<int|string, mixed> $allowedOrigins
     */
    public static function matchesAllowlist(string $origin, array $allowedOrigins): bool
    {
        if (in_array($origin, $allowedOrigins, true)) {
            return true;
        }

        $originHost = parse_url($origin, PHP_URL_HOST);
        // parse_url() yields null when the component is absent and false when
        // the URL is malformed. Both must stop here: the callers only guarded
        // null, so a malformed Origin reached str_ends_with() and raised a
        // TypeError (a 500) rather than being rejected.
        if (!is_string($originHost) || $originHost === '') {
            return false;
        }

        $originScheme = parse_url($origin, PHP_URL_SCHEME) ?: 'https';
        $allowedSubdomains = self::allowedSubdomains();

        foreach ($allowedOrigins as $allowed) {
            if (!is_string($allowed)) {
                continue;
            }

            $allowedHost = parse_url($allowed, PHP_URL_HOST);
            if (!is_string($allowedHost) || $allowedHost === '') {
                continue;
            }

            $suffix = '.' . $allowedHost;
            if (!str_ends_with($originHost, $suffix)) {
                continue;
            }

            if (parse_url($allowed, PHP_URL_SCHEME) !== $originScheme) {
                continue;
            }

            $prefixLength = strlen($originHost) - strlen($suffix);
            if ($prefixLength <= 0) {
                continue;
            }

            $leadingLabels = substr($originHost, 0, $prefixLength);

            // Single allowlisted label only. `a.b` is not in the allowlist, so
            // nested sub-subdomains fall through here without a special case.
            if (in_array(strtolower($leadingLabels), $allowedSubdomains, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The configured subdomain label allowlist, lowercased.
     *
     * Read from the environment directly rather than through config() because
     * App\Helpers\CorsHelper is called by AppServiceProvider during boot, before
     * the config cache is necessarily warm.
     *
     * @return list<string>
     */
    public static function allowedSubdomains(): array
    {
        $raw = getenv('CORS_ALLOWED_SUBDOMAINS');
        if ($raw === false || $raw === '') {
            $raw = (string) ($_ENV['CORS_ALLOWED_SUBDOMAINS'] ?? '');
        }
        if ($raw === '') {
            $raw = self::DEFAULT_ALLOWED_SUBDOMAINS;
        }

        return array_values(array_filter(array_map(
            static fn (string $label): string => strtolower(trim($label)),
            explode(',', $raw)
        )));
    }
}
