<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers;

use App\Services\SitemapService;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/**
 * SitemapController — Every domain gets /sitemap.xml with its own URLs.
 *
 * Domain detection:
 *   1. Tenant custom domain (hour-timebank.ie) → that tenant's content
 *   2. Main app domain (app.project-nexus.ie) → all tenants without custom domains
 *   3. Any other domain serving the React app → master tenant's content
 *
 * URLs in the sitemap always use the requesting domain — no cross-domain leaks.
 */
class SitemapController
{
    /**
     * GET /sitemap.xml
     *
     * Every domain gets a proper sitemap with its own URLs.
     */
    public function index(SitemapService $service, Request $request): Response
    {
        $host = $request->header('X-Sitemap-Host', $request->getHost());
        $baseUrl = 'https://' . $host;
        $frontendHost = parse_url(env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST);

        // 1. Check if this domain belongs to a specific tenant
        $tenant = DB::selectOne(
            "SELECT id, slug FROM tenants WHERE domain = ? AND is_active = 1",
            [$host]
        );

        if ($tenant) {
            if ($this->sitemapDisabled((int) $tenant->id) || SitemapService::isNoindexTenant((int) $tenant->id)) {
                return $this->xmlResponse($this->emptyUrlset(), 404);
            }

            // Check if this tenant has direct sub-tenants that inherit its domain
            // (sub-tenants with no own domain). If so, return a sitemap index so
            // Google discovers both the parent's and sub-tenants' content.
            $subTenants = DB::select(
                "SELECT id, slug, updated_at FROM tenants
                  WHERE parent_id = ? AND is_active = 1
                    AND (domain IS NULL OR domain = '')
                  ORDER BY slug",
                [(int) $tenant->id]
            );

            // Filter to sub-tenants with a non-empty slug — a null slug would
            // generate an invalid '/sitemap-.xml' entry.
            $subTenants = array_filter($subTenants, fn ($s) => !empty($s->slug)
                && !$this->sitemapDisabled((int) $s->id) && !SitemapService::isNoindexTenant((int) $s->id));

            if (!empty($subTenants) && !empty($tenant->slug)) {
                $sitemaps = [
                    ['loc' => "{$baseUrl}/sitemap-{$tenant->slug}.xml", 'lastmod' => null],
                ];
                foreach ($subTenants as $sub) {
                    $lastmod = null;
                    if (!empty($sub->updated_at)) {
                        try {
                            $lastmod = substr((string) $sub->updated_at, 0, 10);
                        } catch (\Throwable) {}
                    }
                    $sitemaps[] = [
                        'loc'     => "{$baseUrl}/sitemap-{$sub->slug}.xml",
                        'lastmod' => $lastmod,
                    ];
                }
                $xml = $service->buildSitemapIndexPublic($sitemaps);
                return $this->xmlResponse($xml);
            }

            // No sub-tenants — single-tenant domain, serve flat sitemap
            $xml = $service->generateForTenant((int) $tenant->id, $baseUrl);
            return $this->xmlResponse($xml);
        }

        // 2. Main app domain — all tenants without custom domains
        if ($host === $frontendHost) {
            $xml = $service->generateForAppDomain();
            return $this->xmlResponse($xml);
        }

        // 3. Any other domain (e.g., api.project-nexus.ie accessed directly)
        //    Reuse the app domain sitemap — it already uses FRONTEND_URL for
        //    base URLs. Never generate content URLs pointing to the API domain.
        $xml = $service->generateForAppDomain();

        return $this->xmlResponse($xml);
    }

    /**
     * GET /sitemap-{slug}.xml
     */
    public function tenant(SitemapService $service, Request $request, string $slug): Response
    {
        $host = $request->header('X-Sitemap-Host', $request->getHost());

        // Single query: fetch the tenant and its parent's domain in one round-trip.
        // parent_domain is non-null only when the tenant has no own domain and its
        // immediate parent has one — signals sub-tenant path routing.
        // 'main' is the canonical alias SitemapService::generateIndex() uses for the
        // master tenant, which stores slug = NULL rather than the string 'main'.
        if ($slug === 'main') {
            // Master tenant is always id=1; using an explicit id match avoids returning
            // the wrong tenant if other rows ever have null/empty slug (data anomaly).
            $row = DB::selectOne(
                "SELECT t.id, t.slug, t.domain, p.domain AS parent_domain
                 FROM tenants t
                 LEFT JOIN tenants p ON p.id = t.parent_id AND p.is_active = 1 AND p.id > 1
                 WHERE t.id = 1 AND t.is_active = 1
                 LIMIT 1"
            );
        } else {
            $row = DB::selectOne(
                "SELECT t.id, t.slug, t.domain, p.domain AS parent_domain
                 FROM tenants t
                 LEFT JOIN tenants p ON p.id = t.parent_id AND p.is_active = 1 AND p.id > 1
                 WHERE t.slug = ? AND t.is_active = 1
                 LIMIT 1",
                [$slug]
            );
        }

        // A community whose robots setting says noindex publishes no sitemap
        // (2026-10-23): listing pages that each say "do not index" sends
        // search engines two contradicting signals.
        if (!$row || $this->sitemapDisabled((int) $row->id) || SitemapService::isNoindexTenant((int) $row->id)) {
            return $this->xmlResponse($this->emptyUrlset(), 404);
        }

        // Served only on the community's own host, with its own folder prefix
        // (2026-10-23). Until then any domain answered any community's sitemap
        // with addresses on the requesting host, so app.project-nexus.ie/sitemap-x.xml
        // listed platform-root pages (missing /x) and hour-timebank.ie/sitemap-x.xml
        // claimed another community's pages as its own.
        $target = SitemapService::targetFor((int) $row->id);
        if ($target === null || $target['host'] !== strtolower($host)) {
            return $this->xmlResponse($this->emptyUrlset(), 404);
        }
        $baseUrl = SitemapService::targetOrigin($target) . $target['prefix'];

        $xml = $service->generateForTenant((int) $row->id, $baseUrl);
        return $this->xmlResponse($xml);
    }

    /** The "Automatic sitemap" switch (SitemapService::isSitemapSwitchedOff). */
    private function sitemapDisabled(int $tenantId): bool
    {
        return SitemapService::isSitemapSwitchedOff($tenantId);
    }

    private function xmlResponse(string $xml, int $status = 200): Response
    {
        return response($xml, $status)
            ->header('Content-Type', 'application/xml; charset=UTF-8')
            ->header('Cache-Control', 'public, max-age=3600')
            ->header('X-Robots-Tag', 'noindex');
    }

    private function emptyUrlset(): string
    {
        return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
             . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>' . "\n";
    }
}
