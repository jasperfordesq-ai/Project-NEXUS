<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Tenancy;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The accessible frontend's (web-uk) base address for a community.
 *
 * TenantContext::getFrontendUrl() only ever knows the React website, so every
 * place that sends a member back to "the frontend" sent accessible-site members
 * to React. This resolves the accessible equivalent, in the same order the
 * accessible site itself is reachable:
 *
 *   1. the community's own accessible domain (tenants.accessible_domain), served
 *      slug-less at its root;
 *   2. a sub-community with no domain of its own: its parent's accessible domain
 *      plus `/{slug}/accessible`;
 *   3. the platform accessible host (config app.accessible_frontend_url, https
 *      only) plus `/{slug}/accessible`.
 *
 * Only registered tenant domains or the configured platform host are ever
 * returned, so callers may use the result as an allowlist entry for return
 * addresses. Extracted 26 Oct 2026 from SendPasswordResetEmail, unchanged.
 */
final class AccessibleFrontendUrl
{
    /**
     * @param array<string,mixed>|null $tenant tenant row; the current tenant when null
     */
    public static function base(?array $tenant = null): ?string
    {
        $tenant ??= TenantContext::get();
        if (!is_array($tenant) || $tenant === []) {
            return null;
        }

        $domain = trim((string) ($tenant['accessible_domain'] ?? ''));
        if ($domain !== '' && filter_var($domain, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
            return 'https://' . $domain;
        }

        $slug = (string) ($tenant['slug'] ?? '');
        $parentId = (int) ($tenant['parent_id'] ?? 0);
        if ($parentId > 0 && $slug !== '') {
            $parentDomain = trim((string) DB::table('tenants')
                ->where('id', $parentId)->where('is_active', 1)->value('accessible_domain'));
            if ($parentDomain !== '' && filter_var($parentDomain, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)) {
                return 'https://' . $parentDomain . '/' . rawurlencode($slug) . '/accessible';
            }
        }

        $platformUrl = rtrim((string) config('app.accessible_frontend_url', ''), '/');
        $host = parse_url($platformUrl, PHP_URL_HOST);
        if (parse_url($platformUrl, PHP_URL_SCHEME) === 'https'
            && is_string($host)
            && filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME)
            && $slug !== '') {
            return $platformUrl . '/' . rawurlencode($slug) . '/accessible';
        }

        return null;
    }
}
